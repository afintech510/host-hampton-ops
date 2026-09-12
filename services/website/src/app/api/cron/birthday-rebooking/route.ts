import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { checkSmsBudget, recordSmsSent } from '@/lib/marketing/budget'
import { writeLedger } from '@/lib/marketing/graph'
import { findContactsByEmail } from '@/lib/contactLookup'
import { enqueueReminders, smsCost, type ReminderRow } from '@/lib/reminderQueue'
import { smsBirthdayRebook } from '@/lib/sms-templates'
import { etDateString, etToUtc } from '@/lib/partyTime'

export const dynamic = 'force-dynamic'

/**
 * Birthday rebooking scanner (AUTO_EXECUTE).
 *
 * Finds kid-party bookings whose party_date is 8–10 months in the past and
 * enqueues an owner-pre-approved rebooking nudge (email + SMS) into
 * scheduled_reminders, which the send-reminders cron delivers.
 *
 * Semi-automatic policy: this is AUTO_EXECUTE because it uses fixed templates
 * with merge fields only. Compliance:
 *   - email nudge only to email_opt_in=true
 *   - SMS nudge only to sms_opt_in=true (promotional → STOP language in body,
 *     counted against the monthly marketing-SMS cap)
 *   - BOTH are re-checked at SEND time by /api/cron/send-reminders. Consent read
 *     only at enqueue is consent read up to a day early, and somebody who
 *     unsubscribes overnight must not get tomorrow's marketing email.
 * Dedup is a CONSTRAINT: `uniq_scheduled_reminder_once` (migration 044) means a
 * re-run inserts nothing new — we tolerate 23505 per row rather than querying
 * first, in `lib/reminderQueue.ts`.
 *
 * Auth: x-cron-secret / ?secret=  (matches the other cron routes).
 *
 * Measured 2026-09-12: this route has run exactly ONCE in production
 * (2026-08-17), and scanned zero bookings because nothing was old enough. Its
 * enqueue shape was the only one in the whole reminder engine that the table
 * would actually accept.
 */

function isCronAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  return secret === process.env.CRON_SECRET
}

const MAX_PER_RUN = Number(process.env.BIRTHDAY_REBOOK_MAX_PER_RUN || 100)

/**
 * A party that was cancelled is not a party to celebrate the anniversary of.
 * Without this filter the nudge went to every cancelled booking in the window —
 * including the eight `HH-TEST-PAY*` throwaway rows.
 */
const NOT_REBOOKABLE = ['cancelled', 'lead']

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
    .select('id, booking_ref, contact_name, contact_email, child_name, child_age, party_date, event_type, status')
    .gte('party_date', ymd(from))
    .lte('party_date', ymd(to))
    .not('child_name', 'is', null)
    .not('status', 'in', `(${NOT_REBOOKABLE.join(',')})`)
    .order('party_date', { ascending: true })
    .limit(MAX_PER_RUN)

  if (error) {
    console.error('cron:birthday-rebooking fetch error:', error.message)
    return NextResponse.json({ error: 'Failed to fetch bookings', detail: error.message }, { status: 500 })
  }

  // Deliver the nudge tomorrow at 10:00 EASTERN. The old code called setHours on
  // a UTC box, which is 6am local — and hard-coding -04:00 would be wrong for
  // half the year, so this goes through the DST-safe converter.
  const tomorrowEt = etDateString(new Date(now.getTime() + 24 * 60 * 60 * 1000))
  const scheduledFor = etToUtc(tomorrowEt, 10, 0)

  let emailQueued = 0
  let smsQueued = 0
  let noContact = 0
  let lookupFailed = 0
  let alreadyQueued = 0

  for (const b of bookings || []) {
    // Case-INSENSITIVE, with three outcomes. `.eq('email', …)` missed the 21
    // contacts whose stored address carries capitals, and a failed read was
    // indistinguishable from "no such contact" — see
    // `docs/phase-4-campaign-automation.md` §11.1.
    const lookup = await findContactsByEmail(
      supabase,
      b.contact_email,
      'id, email, email_opt_in, status, sms_opt_in, phone'
    )
    if (lookup.kind === 'unavailable') {
      console.error('cron:birthday-rebooking contact lookup failed:', lookup.error)
      lookupFailed++
      continue
    }
    if (lookup.kind === 'absent') { noContact++; continue }

    const contact = lookup.contacts[0] as {
      id: string
      email_opt_in?: boolean | null
      status?: string | null
      sms_opt_in?: boolean | null
      phone?: string | null
    }

    const rows: ReminderRow[] = []

    // Email nudge — promotional, requires email_opt_in and a status that is not
    // an explicit unsubscribe.
    if (contact.email_opt_in === true && contact.status !== 'unsubscribed') {
      rows.push({
        contact_id: contact.id,
        reminder_type: 'birthday_rebook_email',
        reference_type: 'booking',
        reference_id: b.booking_ref,
        scheduled_for: scheduledFor.toISOString(),
        channel: 'email',
      })
    }

    // SMS nudge — promotional, requires sms_opt_in + phone + budget headroom.
    // The budget is charged in SEGMENTS, not messages: this template contains a
    // 🎉, which forces UCS-2 and drops the per-segment limit from 160 to 67, so
    // the nudge is three texts and the cap used to be told it was one.
    let segments = 0
    if (contact.sms_opt_in === true && contact.phone) {
      segments = smsCost(
        smsBirthdayRebook({
          firstName: (b.contact_name || 'there').split(' ')[0],
          childName: b.child_name,
          nextAge: b.child_age != null ? b.child_age + 1 : null,
        })
      )
      const budget = await checkSmsBudget(supabase, segments)
      if (!budget.ok) {
        await writeLedger(supabase, {
          entityType: 'reminder',
          entityId: b.id,
          action: 'note',
          actor: 'cron',
          meta: {
            refused: 'sms_budget', job: 'birthday_rebooking',
            sent: budget.sent, cap: budget.cap, segments, booking_ref: b.booking_ref,
          },
        })
      } else {
        rows.push({
          contact_id: contact.id,
          reminder_type: 'birthday_rebook_sms',
          reference_type: 'booking',
          reference_id: b.booking_ref,
          scheduled_for: scheduledFor.toISOString(),
          channel: 'sms',
        })
      }
    }

    if (rows.length === 0) continue

    const res = await enqueueReminders(supabase, rows)
    alreadyQueued += res.duplicate

    // Per ROW, from the insert itself. A re-run must not charge the SMS budget
    // again for a nudge that was already queued, and "already queued" is
    // something the unique index reported — not something to infer from a
    // timestamp.
    if (res.byType.birthday_rebook_email === 'inserted') emailQueued++
    if (res.byType.birthday_rebook_sms === 'inserted') {
      smsQueued++
      await recordSmsSent(supabase, {
        count: segments,
        actor: 'cron',
        entityType: 'reminder',
        entityId: b.id,
        meta: { job: 'birthday_rebooking', segments, booking_ref: b.booking_ref },
      })
    }
  }

  await writeLedger(supabase, {
    entityType: 'reminder',
    action: 'note',
    actor: 'cron',
    meta: {
      job: 'birthday_rebooking',
      scanned: bookings?.length || 0,
      emailQueued, smsQueued, alreadyQueued, noContact, lookupFailed,
      window: { from: ymd(from), to: ymd(to) },
    },
  })

  return NextResponse.json({
    ok: true,
    scanned: bookings?.length || 0,
    emailQueued,
    smsQueued,
    alreadyQueued,
    noContact,
    lookupFailed,
  })
}
