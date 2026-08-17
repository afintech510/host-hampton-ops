import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { checkSmsBudget, recordSmsSent } from '@/lib/marketing/budget'
import { writeLedger } from '@/lib/marketing/graph'

export const dynamic = 'force-dynamic'

/**
 * Birthday rebooking scanner (AUTO_EXECUTE).
 *
 * Finds kid-party bookings whose party_date is 8–10 months in the past and
 * enqueues an owner-pre-approved rebooking nudge (email + SMS) into
 * scheduled_reminders, which the existing send-reminders cron delivers.
 *
 * Semi-automatic policy: this is AUTO_EXECUTE because it uses fixed templates
 * with merge fields only. Compliance:
 *   - email nudge only to email_opt_in=true
 *   - SMS nudge only to sms_opt_in=true (promotional → STOP language in body,
 *     counted against the monthly marketing-SMS cap)
 * Dedup is a CONSTRAINT: the partial unique index on
 * (contact_id, reminder_type, reference_id) means a re-run inserts nothing new
 * — we tolerate 23505 (unique violation) per row rather than querying first.
 *
 * Auth: x-cron-secret / ?secret=  (matches the other cron routes).
 */

function isCronAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  return secret === process.env.CRON_SECRET
}

const MAX_PER_RUN = Number(process.env.BIRTHDAY_REBOOK_MAX_PER_RUN || 100)

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabase()
  const now = new Date()

  // Window: party_date in [now-10mo, now-8mo].
  const from = new Date(now); from.setMonth(from.getMonth() - 10)
  const to = new Date(now); to.setMonth(to.getMonth() - 8)

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, contact_name, contact_email, child_name, child_age, party_date, event_type')
    .gte('party_date', ymd(from))
    .lte('party_date', ymd(to))
    .not('child_name', 'is', null)
    .order('party_date', { ascending: true })
    .limit(MAX_PER_RUN)

  if (error) {
    console.error('cron:birthday-rebooking fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 })
  }

  // Deliver the nudge next morning at 10:00 local-ish (server tz).
  const scheduledFor = new Date(now)
  scheduledFor.setDate(scheduledFor.getDate() + 1)
  scheduledFor.setHours(10, 0, 0, 0)

  let emailQueued = 0
  let smsQueued = 0
  let skipped = 0

  for (const b of bookings || []) {
    // Resolve the contact + opt-in state.
    const { data: contact } = await supabase
      .from('contacts')
      .select('id, email_opt_in, sms_opt_in, phone')
      .eq('email', b.contact_email)
      .maybeSingle()

    if (!contact) { skipped++; continue }

    // Email nudge — promotional, requires email_opt_in.
    if (contact.email_opt_in) {
      const inserted = await tryEnqueue(supabase, {
        contact_id: contact.id,
        reminder_type: 'birthday_rebook_email',
        reference_type: 'booking',
        reference_id: b.id,
        scheduled_for: scheduledFor.toISOString(),
        channel: 'email',
      })
      if (inserted) emailQueued++
    }

    // SMS nudge — promotional, requires sms_opt_in + phone + budget headroom.
    if (contact.sms_opt_in && contact.phone) {
      const budget = await checkSmsBudget(supabase, 1)
      if (!budget.ok) {
        await writeLedger(supabase, {
          entityType: 'reminder',
          entityId: b.id,
          action: 'note',
          actor: 'cron',
          meta: { refused: 'sms_budget', job: 'birthday_rebooking', sent: budget.sent, cap: budget.cap },
        })
      } else {
        const inserted = await tryEnqueue(supabase, {
          contact_id: contact.id,
          reminder_type: 'birthday_rebook_sms',
          reference_type: 'booking',
          reference_id: b.id,
          scheduled_for: scheduledFor.toISOString(),
          channel: 'sms',
        })
        if (inserted) {
          smsQueued++
          await recordSmsSent(supabase, {
            count: 1,
            actor: 'cron',
            entityType: 'reminder',
            entityId: b.id,
            meta: { job: 'birthday_rebooking' },
          })
        }
      }
    }
  }

  await writeLedger(supabase, {
    entityType: 'reminder',
    action: 'note',
    actor: 'cron',
    meta: {
      job: 'birthday_rebooking',
      scanned: bookings?.length || 0,
      emailQueued,
      smsQueued,
      skipped,
      window: { from: ymd(from), to: ymd(to) },
    },
  })

  return NextResponse.json({
    scanned: bookings?.length || 0,
    emailQueued,
    smsQueued,
    skipped,
  })
}

/**
 * Insert one reminder, tolerating the birthday dedup unique-index violation.
 * Returns true if a row was actually inserted, false if it already existed.
 */
async function tryEnqueue(
  supabase: ReturnType<typeof getSupabase>,
  row: {
    contact_id: string
    reminder_type: string
    reference_type: string
    reference_id: string
    scheduled_for: string
    channel: string
  }
): Promise<boolean> {
  const { error } = await supabase.from('scheduled_reminders').insert(row)
  if (!error) return true
  // 23505 = unique_violation → already enqueued (dedup constraint did its job).
  if ((error as { code?: string }).code === '23505') return false
  console.error('cron:birthday-rebooking enqueue error:', error.message)
  return false
}
