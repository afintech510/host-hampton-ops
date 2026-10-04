import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cronAuth'
import { getSupabase } from '@/lib/supabase'
import { checkSmsBudget, recordSmsSent } from '@/lib/marketing/budget'
import { writeLedger } from '@/lib/marketing/graph'
import { enqueueReminders, smsCost } from '@/lib/reminderQueue'
import { smsReviewAsk } from '@/lib/sms-templates'
import {
  DEFAULT_PER_DAY,
  MAX_PER_DAY,
  REVIEW_ASK_EMAIL_HOUR_ET,
  REVIEW_ASK_SMS_HOUR_ET,
  askTime,
  emailRow,
  loadReviewAskInput,
  planReviewAsks,
  reviewAskTextsEnabled,
  smsRow,
} from '@/lib/reviewAsk'

export const dynamic = 'force-dynamic'

/**
 * Daily: queue today's past-client review asks (migration 061, `lib/reviewAsk.ts`).
 *
 * ENQUEUES ONLY. `/api/cron/send-reminders` delivers, so this route is useless
 * without that one also being scheduled — the same pairing as `event-reminders`.
 * Suggested schedule: once a day at ~10:30 ET, ahead of the 11am email slot.
 *
 *   ?perDay=N   1..100, default 40 — people per channel per run
 *   ?smsGapDays=N  0..14, default 3 — days a text waits after the email ask;
 *               0 texts the same people the same day
 *   ?dryRun=1   plan and report, write NOTHING (no rows, no budget, no ledger)
 *
 * Bounds, stated plainly because this is the one route that can put a large
 * part of the customer list into the send queue:
 *   WHO   — past clients only: a `customer` contact, or the address on a past
 *           non-cancelled booking or a past non-refunded event ticket. Our own
 *           addresses are excluded.
 *   HOW MANY — `perDay` per channel per run, never more.
 *   HOW OFTEN — once per person ever (unique index + any-prior-row exclusion).
 *   CONSENT — read here to avoid queueing a row that will only be cancelled,
 *           and READ AGAIN by send-reminders at send time, which is the check
 *           that counts.
 *   SMS BUDGET — every text is charged to the monthly marketing-SMS cap at
 *           enqueue, in SEGMENTS. When the cap is hit the rest wait for next
 *           month's run; nothing is dropped.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = req.nextUrl.searchParams
  let perDay = DEFAULT_PER_DAY
  const perDayParam = params.get('perDay')
  if (perDayParam !== null) {
    const n = Number(perDayParam)
    if (!Number.isInteger(n) || n < 1 || n > MAX_PER_DAY) {
      return NextResponse.json({ error: `perDay must be an integer 1..${MAX_PER_DAY}` }, { status: 400 })
    }
    perDay = n
  }
  let smsGapDays: number | undefined
  const gapParam = params.get('smsGapDays')
  if (gapParam !== null) {
    const n = Number(gapParam)
    if (!Number.isInteger(n) || n < 0 || n > 14) {
      return NextResponse.json({ error: 'smsGapDays must be an integer 0..14' }, { status: 400 })
    }
    smsGapDays = n
  }
  const dryRunParam = params.get('dryRun')
  const dryRun = dryRunParam === '1' || dryRunParam === 'true'

  const supabase = getSupabase()
  const now = new Date()

  const load = await loadReviewAskInput(supabase, now)
  if (load.kind === 'unavailable') {
    console.error('cron:review-asks —', load.error)
    // 503 so the scheduler shows red. Nothing was queued.
    return NextResponse.json({ error: 'Could not read the audience', detail: load.error }, { status: 503 })
  }

  const planned = planReviewAsks(load.input, { perDay, now, smsGapDays })
  // Texts switched off by Adam 2026-10-04 (`reviewAskTextsEnabled`): plan them
  // as nothing, so no row is queued, no budget is charged and no ledger entry
  // claims a text. Emails go on as before.
  const textsEnabled = reviewAskTextsEnabled()
  const plan = textsEnabled ? planned : { ...planned, sms: [] }
  const emailAt = askTime(now, REVIEW_ASK_EMAIL_HOUR_ET)
  const smsAt = askTime(now, REVIEW_ASK_SMS_HOUR_ET)

  const segmentsFor = (firstName: string | null) => smsCost(smsReviewAsk({ firstName: firstName || 'there' }))

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      perDay,
      textsEnabled,
      wouldQueue: { email: plan.email.length, sms: plan.sms.length },
      smsSegments: plan.sms.reduce((n, p) => n + segmentsFor(p.contact.first_name), 0),
      emailAt: emailAt.toISOString(),
      smsAt: smsAt.toISOString(),
      counts: plan.counts,
    })
  }

  // ── email ──
  const emailRes = await enqueueReminders(supabase, plan.email.map(p => emailRow(p.contact.id, emailAt)))

  // ── sms, charged to the budget one at a time ──
  let smsQueued = 0
  let smsDuplicate = 0
  let smsRefused = 0
  let smsBudgetStop: string | null = null
  let segmentsCharged = 0
  for (const p of plan.sms) {
    const segments = segmentsFor(p.contact.first_name)
    let budgetOk = false
    try {
      const budget = await checkSmsBudget(supabase, segments)
      budgetOk = budget.ok
      if (!budget.ok) smsBudgetStop = `monthly marketing-SMS cap reached (${budget.sent}/${budget.cap} segments)`
    } catch (err) {
      // Rule 12: an unreadable budget is not an unlimited one.
      smsBudgetStop = `budget unreadable: ${err instanceof Error ? err.message : String(err)}`
    }
    if (!budgetOk) break

    const res = await enqueueReminders(supabase, [smsRow(p.contact.id, smsAt)])
    const outcome = res.byType.review_ask_sms
    if (outcome === 'inserted') {
      smsQueued++
      segmentsCharged += segments
      await recordSmsSent(supabase, {
        count: segments,
        actor: 'cron',
        entityType: 'review_request',
        entityId: p.contact.id,
        meta: { job: 'review_ask', segments },
      })
    } else if (outcome === 'duplicate') smsDuplicate++
    else smsRefused++
  }

  const summary = {
    perDay,
    textsEnabled,
    emailQueued: emailRes.inserted,
    emailDuplicate: emailRes.duplicate,
    emailRefused: emailRes.refused.length,
    smsQueued,
    smsDuplicate,
    smsRefused,
    segmentsCharged,
    smsBudgetStop,
    emailAt: emailAt.toISOString(),
    smsAt: smsAt.toISOString(),
    counts: plan.counts,
  }

  await writeLedger(supabase, { entityType: 'review_request', action: 'note', actor: 'cron', meta: { job: 'review_ask', ...summary } })

  console.log(
    `cron:review-asks email=${emailRes.inserted} sms=${smsQueued} ` +
      `remaining email=${plan.counts.emailRemaining} sms=${plan.counts.smsRemaining}` +
      (smsBudgetStop ? ` sms stopped: ${smsBudgetStop}` : '')
  )

  // A run where every insert was refused is a broken run, not a quiet one.
  const attempted = plan.email.length + smsQueued + smsDuplicate + smsRefused
  const refused = emailRes.refused.length + smsRefused
  if (attempted > 0 && refused === attempted) {
    return NextResponse.json({ ok: false, ...summary, refusedReasons: emailRes.refused.slice(0, 3) }, { status: 500 })
  }

  return NextResponse.json({ ok: true, ...summary })
}
