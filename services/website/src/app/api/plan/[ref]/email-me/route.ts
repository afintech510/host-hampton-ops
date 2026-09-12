/**
 * `POST /api/plan/[ref]/email-me` — the customer mails themselves their plan.
 *
 * Self-serve half of Phase 5 item 4. Authorized by the portal cookie for THIS
 * ref, and it sends only to the address stored on the booking — see the header of
 * lib/planShare.ts for why an address is never taken from the request.
 *
 * Rate-limited to one send a minute per plan. The blast radius is already small
 * (the only possible recipient is the plan's own contact), so this is about not
 * letting a double-click, or an impatient customer, put five identical emails in
 * their inbox and five rows in the ledger.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { planAccess } from '@/lib/planAccess'
import { isAdminAuthorized } from '@/lib/adminAuth'
import { loadPlanInvoice } from '@/lib/planInvoice'
import { writeLedger } from '@/lib/marketing/graph'
import { buildPlanSummaryLink, sendPlanSummaryEmail } from '@/lib/planShare'

/** One send a minute per plan. */
const COOLDOWN_MS = 60_000

/** The ledger job name the cooldown counts. Not `send` — see `claimSendSlot`. */
const CLAIM_JOB = 'plan_summary_email_claim'

type ClaimOutcome = 'ok' | 'too-soon' | 'error'

/**
 * Take the one send slot in this window, or report that somebody else has it.
 *
 * Insert-then-verify: write the claim, then read every claim in the window and
 * win only if ours is the oldest. Ties on `created_at` (the realistic case, since
 * concurrent requests land in the same millisecond) break on `id`, which is
 * arbitrary but TOTAL — all racers order the same way, so exactly one wins.
 */
async function claimSendSlot(
  supabase: ReturnType<typeof getSupabase>,
  bookingId: string,
  ref: string,
  since: string,
): Promise<ClaimOutcome> {
  const { data: mine, error: insErr } = await supabase
    .from('marketing_ledger')
    .insert({
      entity_type: 'booking',
      entity_id: bookingId,
      action: 'note',
      actor: `portal:${ref}`,
      meta: { job: CLAIM_JOB, via: 'email_me', channel: 'email' },
    })
    .select('id, created_at')
    .maybeSingle()
  if (insErr || !mine) {
    console.error('plan email-me: could not claim the send slot:', insErr?.message ?? 'no row returned')
    return 'error'
  }

  const { data: claims, error: readErr } = await supabase
    .from('marketing_ledger')
    .select('id, created_at')
    .eq('entity_type', 'booking')
    .eq('entity_id', bookingId)
    .eq('action', 'note')
    .eq('meta->>job', CLAIM_JOB)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1)
  if (readErr) {
    console.error('plan email-me: cooldown check failed:', readErr.message)
    return 'error'
  }

  const winner = (claims ?? [])[0] as { id: string } | undefined
  // No winner at all would mean our own row is not visible to us, which is not a
  // state this database produces — but "cannot tell" still declines.
  if (!winner) return 'error'
  return winner.id === (mine as { id: string }).id ? 'ok' : 'too-soon'
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref: rawRef } = await params
  const ref = decodeURIComponent(rawRef || '')
  if (!ref) return NextResponse.json({ error: 'Missing plan reference' }, { status: 400 })

  const access = planAccess(req.headers.get('cookie'), ref)
  if (!access.ok && !isAdminAuthorized(req)) {
    return NextResponse.json({ error: 'Not authorized for this plan' }, { status: 403 })
  }

  const supabase = getSupabase()

  const loaded = await loadPlanInvoice(ref, supabase)
  if (!loaded.ok) {
    if (!loaded.notFound) {
      console.error('plan email-me: invoice load failed:', loaded.error)
      return NextResponse.json({ error: 'Could not read this plan — try again.' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  }
  const invoice = loaded.invoice
  const to = invoice.booking.contact_email
  if (!to) {
    return NextResponse.json(
      { error: 'We don’t have an email address on this plan yet — please call or text us.' },
      { status: 409 },
    )
  }

  // ── The cooldown, claimed rather than merely checked ─────────────────────
  //
  // It used to READ the ledger, then send, then write — and a check that
  // straddles the thing it is limiting is check-then-act. Measured in
  // production: five concurrent calls, THREE emails sent, three portal tokens
  // minted. A rate limit that is not claimed atomically is a rate limit that
  // only holds for users who wait their turn.
  //
  // So: insert a CLAIM row, then read the claims back and proceed only if mine
  // is the oldest in the window. Every racer writes, every racer then sees every
  // other racer's row, and exactly one of them can be first. `marketing_ledger`
  // is append-only, which is what makes that verification trustworthy.
  //
  // The claim is a `note`, not a `send`: the cooldown ledger and the record of
  // what was actually sent must not be the same rows, or a failed send shows up
  // in the audit trail as a send that happened.
  const since = new Date(Date.now() - COOLDOWN_MS).toISOString()
  const claim = await claimSendSlot(supabase, invoice.booking.id, ref, since)
  if (claim === 'error') {
    // A read failure is NOT "no recent send" — that would make a blip the way
    // around the limit. Cannot-tell declines.
    return NextResponse.json({ error: 'Could not send just now — try again.' }, { status: 503 })
  }
  if (claim === 'too-soon') {
    return NextResponse.json(
      { error: 'We just sent that — check your inbox, and try again in a minute.' },
      { status: 429 },
    )
  }

  const link = await buildPlanSummaryLink(invoice.booking.id, ref, supabase)
  const sent = link.ok ? await sendPlanSummaryEmail({ to, invoice, url: link.url, note: null }) : null

  if (!link.ok || !sent || !sent.ok) {
    const reason = !link.ok ? link.reason : sent && !sent.ok ? sent.reason : 'send failed'
    // Rule 10: a claimed cooldown that produced no email must say so, or the
    // ledger asserts a send that never happened.
    await writeLedger(supabase, {
      entityType: 'booking',
      entityId: invoice.booking.id,
      action: 'note',
      actor: `portal:${ref}`,
      meta: { job: 'plan_summary_email_failed', via: 'email_me', channel: 'email', reason },
    })
    const status = !link.ok ? (link.retryable ? 503 : 500) : 502
    return NextResponse.json({ error: reason }, { status })
  }

  // The record of what actually went out, separate from the claim above.
  await writeLedger(supabase, {
    entityType: 'booking',
    entityId: invoice.booking.id,
    action: 'send',
    actor: `portal:${ref}`,
    meta: { job: 'plan_summary_email', via: 'email_me', channel: 'email', to },
  })

  return NextResponse.json({ ok: true, sentTo: to })
}
