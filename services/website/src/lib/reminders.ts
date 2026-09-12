import { getSupabase } from '@/lib/supabase'
import { enqueueCheckinReminders } from '@/lib/checkinReminders'
import { findContactsByEmail } from '@/lib/contactLookup'
import { enqueueReminders, type ReminderRow } from '@/lib/reminderQueue'

// Time parsing / timezone conversion lives in lib/partyTime.ts so the check-in
// scheduler can share it without a circular import. Re-exported here because
// this module was its original home.
export { parseTime, etToUtc, PARTY_TZ } from '@/lib/partyTime'

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Two things every function in this file used to get wrong, both fixed 2026-09-12.
 *
 * 1. THE ROWS NEVER LANDED. `scheduled_reminders.reference_id` was `uuid` and
 *    these functions write a booking_ref, so every insert was answered 22P02 and
 *    every insert threw the error away. Five months, zero rows. Migration 044
 *    widened the column; `lib/reminderQueue.ts` now reads the error.
 *
 * 2. THE CONTACT WAS LOOKED UP CASE-SENSITIVELY. `.eq('email', …)` against a
 *    `text` column holding whatever the customer typed. 21 of 1219 contacts have
 *    capitals in their address, and for those people every branch below took the
 *    `if (!contact) return` path — no reminders, silently, forever. Same defect
 *    as the unsubscribe link (`docs/phase-4-campaign-automation.md` §11.1), same
 *    fix: `findContactsByEmail`.
 *
 * And the reason (2) was invisible: `.single()` returns an ERROR when it matches
 * no rows, and the caller destructured only `data`. "Could not read the contacts
 * table" and "there is nobody by that name" produced the same silence. Every
 * lookup here now has three outcomes (hard-won rule 12).
 * ─────────────────────────────────────────────────────────────────────────────
 */

type Supa = ReturnType<typeof getSupabase>

interface ResolvedContact {
  id: string
  sms_opt_in?: boolean | null
}

type ContactResolution =
  | { kind: 'found'; contact: ResolvedContact }
  | { kind: 'absent' }
  | { kind: 'unavailable'; error: string }

/**
 * The one contact lookup these enqueuers share.
 *
 * When an address somehow maps to more than one row (possible: the unique index
 * is on the RAW value, so `Foo@x.com` and `foo@x.com` can both exist) the oldest
 * row wins, deterministically, rather than whichever Postgres happened to return
 * first.
 */
async function resolveContact(supabase: Supa, email: string, label: string): Promise<ContactResolution> {
  const lookup = await findContactsByEmail(supabase, email, 'id, email, sms_opt_in, created_at')
  if (lookup.kind === 'unavailable') {
    console.error(`${label}: contacts lookup FAILED — not enqueuing:`, lookup.error)
    return { kind: 'unavailable', error: lookup.error }
  }
  if (lookup.kind === 'absent') {
    console.warn(`${label}: no contact for that address — skipping`)
    return { kind: 'absent' }
  }
  const rows = [...lookup.contacts] as (ResolvedContact & { created_at?: string })[]
  rows.sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  return { kind: 'found', contact: rows[0] }
}

/** Log what the queue did, so a refused insert is never silent again. */
async function flush(supabase: Supa, rows: ReminderRow[], label: string): Promise<void> {
  if (rows.length === 0) {
    console.log(`${label}: nothing due to enqueue`)
    return
  }
  const res = await enqueueReminders(supabase, rows)
  console.log(
    `${label}: enqueued ${res.inserted}, already queued ${res.duplicate}, refused ${res.refused.length}`
  )
}

/**
 * Enqueue reminders for an event ticket purchase.
 * 3-day + day-of email, and a 1-day SMS for contacts who opted in.
 */
export async function enqueueEventReminders({
  contactEmail,
  eventId,
  eventDate,
  eventTime: _eventTime,
}: {
  contactEmail: string
  eventId: string
  eventDate: string // YYYY-MM-DD
  eventTime?: string // e.g. "7:00 PM"
}): Promise<void> {
  try {
    const supabase = getSupabase()
    const resolved = await resolveContact(supabase, contactEmail, 'reminders:event')
    if (resolved.kind !== 'found') return
    const contact = resolved.contact

    const eventDateObj = new Date(eventDate + 'T12:00:00')
    const now = new Date()
    const rows: ReminderRow[] = []

    const push = (type: string, when: Date, channel: 'email' | 'sms') => {
      if (when <= now) return
      rows.push({
        contact_id: contact.id,
        reminder_type: type,
        reference_type: 'event',
        reference_id: eventId,
        scheduled_for: when.toISOString(),
        channel,
      })
    }

    // 3 days before (email)
    const threeDaysBefore = new Date(eventDateObj)
    threeDaysBefore.setDate(threeDaysBefore.getDate() - 3)
    threeDaysBefore.setHours(10, 0, 0, 0)
    push('event_email_3day', threeDaysBefore, 'email')

    // Day of (email) — morning of event
    const dayOf = new Date(eventDateObj)
    dayOf.setHours(8, 0, 0, 0)
    push('event_email_dayof', dayOf, 'email')

    // 1 day before (SMS) — only if opted in. Re-checked at SEND time too: this
    // row is written up to months before it is delivered.
    if (contact.sms_opt_in) {
      const oneDayBefore = new Date(eventDateObj)
      oneDayBefore.setDate(oneDayBefore.getDate() - 1)
      oneDayBefore.setHours(10, 0, 0, 0)
      push('event_sms_1day', oneDayBefore, 'sms')
    }

    await flush(supabase, rows, `reminders:event ${eventId}`)
  } catch (err) {
    console.error('enqueueEventReminders error (non-fatal):', err)
  }
}

/**
 * Enqueue reminders for a booking (party / room rental).
 */
export async function enqueueBookingReminders({
  contactEmail,
  bookingRef,
  partyDate,
}: {
  contactEmail: string
  bookingRef: string
  partyDate: string // YYYY-MM-DD
}): Promise<void> {
  try {
    const supabase = getSupabase()
    const resolved = await resolveContact(supabase, contactEmail, 'reminders:booking')
    if (resolved.kind !== 'found') return
    const contact = resolved.contact

    const partyDateObj = new Date(partyDate + 'T12:00:00')
    const now = new Date()
    const rows: ReminderRow[] = []

    const push = (type: string, when: Date, channel: 'email' | 'sms') => {
      if (when <= now) return
      rows.push({
        contact_id: contact.id,
        reminder_type: type,
        reference_type: 'booking',
        reference_id: bookingRef,
        scheduled_for: when.toISOString(),
        channel,
      })
    }

    const sevenDaysBefore = new Date(partyDateObj)
    sevenDaysBefore.setDate(sevenDaysBefore.getDate() - 7)
    sevenDaysBefore.setHours(10, 0, 0, 0)
    push('booking_email_7day', sevenDaysBefore, 'email')

    const oneDayBefore = new Date(partyDateObj)
    oneDayBefore.setDate(oneDayBefore.getDate() - 1)
    oneDayBefore.setHours(10, 0, 0, 0)
    push('booking_email_1day', oneDayBefore, 'email')

    if (contact.sms_opt_in) {
      const smsOneDayBefore = new Date(partyDateObj)
      smsOneDayBefore.setDate(smsOneDayBefore.getDate() - 1)
      smsOneDayBefore.setHours(12, 0, 0, 0)
      push('booking_sms_1day', smsOneDayBefore, 'sms')
    }

    await flush(supabase, rows, `reminders:booking ${bookingRef}`)
  } catch (err) {
    console.error('enqueueBookingReminders error (non-fatal):', err)
  }
}

/**
 * Enqueue a post-event/post-booking review request SMS, the day after at 2 PM.
 *
 * Deduplication is the `uniq_scheduled_reminder_once` index (migration 044), not
 * a SELECT — a read-then-insert is not a constraint, it is a race.
 */
export async function enqueueReviewRequest({
  contactEmail,
  referenceType,
  referenceId,
  eventDate,
}: {
  contactEmail: string
  referenceType: 'event' | 'booking'
  referenceId: string
  eventDate: string // YYYY-MM-DD
}): Promise<void> {
  try {
    const supabase = getSupabase()
    const resolved = await resolveContact(supabase, contactEmail, 'reminders:review')
    if (resolved.kind !== 'found') return
    const contact = resolved.contact

    if (!contact.sms_opt_in) return

    const reviewDate = new Date(eventDate + 'T14:00:00')
    reviewDate.setDate(reviewDate.getDate() + 1)
    if (reviewDate <= new Date()) return

    await flush(
      supabase,
      [
        {
          contact_id: contact.id,
          reminder_type: 'review_request_sms',
          reference_type: referenceType,
          reference_id: referenceId,
          scheduled_for: reviewDate.toISOString(),
          channel: 'sms',
        },
      ],
      `reminders:review ${referenceId}`
    )
  } catch (err) {
    console.error('enqueueReviewRequest error (non-fatal):', err)
  }
}

export async function enqueuePartyReminders({
  contactEmail,
  bookingRef,
  partyDate,
}: {
  contactEmail: string
  bookingRef: string
  partyDate: string
}): Promise<void> {
  try {
    const supabase = getSupabase()
    const resolved = await resolveContact(supabase, contactEmail, 'reminders:party')
    if (resolved.kind !== 'found') return
    const contact = resolved.contact

    const partyDateObj = new Date(partyDate + 'T12:00:00')
    const now = new Date()
    const rows: ReminderRow[] = []

    const push = (type: string, when: Date) => {
      if (when <= now) return
      rows.push({
        contact_id: contact.id,
        reminder_type: type,
        reference_type: 'booking',
        reference_id: bookingRef,
        scheduled_for: when.toISOString(),
        channel: 'email',
      })
    }

    // T-2 and T-1 balance reminders. Both re-check the balance at SEND time —
    // a customer who pays in between is not chased.
    const twoDaysBefore = new Date(partyDateObj)
    twoDaysBefore.setDate(twoDaysBefore.getDate() - 2)
    twoDaysBefore.setHours(10, 0, 0, 0)
    push('party_balance_t2', twoDaysBefore)

    const oneDayBefore = new Date(partyDateObj)
    oneDayBefore.setDate(oneDayBefore.getDate() - 1)
    oneDayBefore.setHours(10, 0, 0, 0)
    push('party_balance_t1', oneDayBefore)

    // Day-of admin alert — goes to the owner, not the customer.
    const dayOf = new Date(partyDateObj)
    dayOf.setHours(7, 0, 0, 0)
    push('party_admin_unpaid_dayof', dayOf)

    // T+1 thank-you.
    const dayAfter = new Date(partyDateObj)
    dayAfter.setDate(dayAfter.getDate() + 1)
    dayAfter.setHours(10, 0, 0, 0)
    push('party_thank_you_t1', dayAfter)

    await flush(supabase, rows, `reminders:party ${bookingRef}`)

    // Pre-arrival check-in texts (36hr + 6am day-of). Scheduled here because
    // this is the one function every confirmed party booking passes through.
    // Needs party_time, which this function isn't given — read it back.
    const { data: bk, error: bkErr } = await supabase
      .from('bookings')
      .select('party_time')
      .eq('booking_ref', bookingRef)
      .maybeSingle()

    if (bkErr) {
      // Rule 12: a failed read is not "no party time". Schedule the 6am day-of
      // text anyway (it doesn't need the time) rather than dropping both.
      console.error('reminders:party — party_time read failed:', bkErr.message)
    }

    await enqueueCheckinReminders({
      bookingRef,
      contactEmail,
      partyDate,
      partyTime: bk?.party_time ?? null,
    })
  } catch (err) {
    console.error('enqueuePartyReminders error (non-fatal):', err)
  }
}
