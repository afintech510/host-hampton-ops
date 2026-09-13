import { getSupabase } from '@/lib/supabase'
import { enqueueCheckinReminders } from '@/lib/checkinReminders'
import { findContactsByEmail } from '@/lib/contactLookup'
import { enqueueReminders, type ReminderRow } from '@/lib/reminderQueue'
import { etToUtc, shiftEtDate } from '@/lib/partyTime'

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

/**
 * When a reminder `offsetDays` from `dateStr` should fire, at `hourEt` EASTERN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS REPLACED `setHours`. Every enqueuer in this file used to build its
 * times as `new Date(dateStr + 'T12:00:00')` followed by `.setDate()` and
 * `.setHours(10, 0, 0, 0)`. On a UTC box — and the container IS UTC, verified
 * 2026-09-13 with no `TZ` set — `setHours(10)` means 10:00 **UTC**, which is
 * 6am Eastern in summer and 5am in winter. All ten reminder types were
 * scheduled four to five hours before the hour they were written for:
 *
 *   booking_email_1day   "Tomorrow's the big day!"      → 6am ET, not 10am
 *   party_balance_t1/t2  balance chase                  → 6am ET, not 10am
 *   party_thank_you_t1   thank-you + review link        → 6am ET, not 10am
 *   party_admin_unpaid_dayof  owner's unpaid alert      → 3am ET, not 7am
 *   event_email_dayof    "See you today!"               → 4am ET, not 8am
 *   event_sms_1day       an SMS                         → 6am ET (5am in EST)
 *   booking_sms_1day     an SMS                         → 8am EDT, 7am in EST
 *
 * The last two are the reason this is not cosmetic. The TCPA's quiet-hours rule
 * permits marketing calls and texts only between 8am and 9pm in the RECIPIENT'S
 * local time; `event_sms_1day` broke it year-round and `booking_sms_1day` broke
 * it for the half of the year the US is on standard time — a bug that is legal
 * in summer and unlawful in winter, which is precisely what hard-coding an
 * offset instead of converting a timezone buys you.
 *
 * `lib/partyTime.ts` has documented this exact hazard since link 12 ("the
 * `new Date(date + 'T12:00:00')` + `setHours()` pattern used elsewhere silently
 * schedules in UTC"), and `checkinReminders.ts`, `checkinAuth.ts` and
 * `birthday-rebooking` were each fixed to use `etToUtc`. This file — which
 * RE-EXPORTS `etToUtc` on line 10 and is the enqueuer every party, booking and
 * ticket reminder passes through — was the one that never was. Hard-won rule 11
 * in its sharpest form: a concept implemented twice, one right and one wrong,
 * and the wrong one is the one that runs.
 *
 * Returns `null` rather than an Invalid Date when the date cannot be read: the
 * old code pushed `Invalid Date.toISOString()`, which THROWS, and the throw was
 * swallowed by the "non-fatal" try/catch every caller wraps this in — so one
 * malformed `party_date` silently cost a customer their entire reminder set
 * (rule 12: "could not work out when" is not "no reminders needed").
 * ─────────────────────────────────────────────────────────────────────────────
 */
function etAt(dateStr: string, offsetDays: number, hourEt: number, label: string): Date | null {
  const shifted = shiftEtDate(dateStr, offsetDays)
  if (!shifted) {
    console.error(`${label}: unreadable date "${dateStr}" — cannot schedule this reminder`)
    return null
  }
  const at = etToUtc(shifted, hourEt, 0)
  if (!Number.isFinite(at.getTime())) {
    console.error(`${label}: could not convert ${shifted} ${hourEt}:00 ET to an instant`)
    return null
  }
  return at
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

    const now = new Date()
    const rows: ReminderRow[] = []

    const push = (type: string, offsetDays: number, hourEt: number, channel: 'email' | 'sms') => {
      const when = etAt(eventDate, offsetDays, hourEt, `reminders:event ${eventId} ${type}`)
      if (!when || when <= now) return
      rows.push({
        contact_id: contact.id,
        reminder_type: type,
        reference_type: 'event',
        reference_id: eventId,
        scheduled_for: when.toISOString(),
        channel,
      })
    }

    // 3 days before, 10am Eastern (email)
    push('event_email_3day', -3, 10, 'email')

    // Day of, 8am Eastern (email) — morning of event
    push('event_email_dayof', 0, 8, 'email')

    // 1 day before, 10am Eastern (SMS) — only if opted in. Re-checked at SEND
    // time too: this row is written up to months before it is delivered.
    if (contact.sms_opt_in) {
      push('event_sms_1day', -1, 10, 'sms')
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

    const now = new Date()
    const rows: ReminderRow[] = []

    const push = (type: string, offsetDays: number, hourEt: number, channel: 'email' | 'sms') => {
      const when = etAt(partyDate, offsetDays, hourEt, `reminders:booking ${bookingRef} ${type}`)
      if (!when || when <= now) return
      rows.push({
        contact_id: contact.id,
        reminder_type: type,
        reference_type: 'booking',
        reference_id: bookingRef,
        scheduled_for: when.toISOString(),
        channel,
      })
    }

    push('booking_email_7day', -7, 10, 'email')
    push('booking_email_1day', -1, 10, 'email')

    if (contact.sms_opt_in) {
      push('booking_sms_1day', -1, 12, 'sms')
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

    // The day after, 2pm EASTERN. This one was `new Date(eventDate + 'T14:00:00')`,
    // i.e. 2pm UTC — 10am ET — so the review text went out four hours early.
    const reviewDate = etAt(eventDate, 1, 14, `reminders:review ${referenceId}`)
    if (!reviewDate || reviewDate <= new Date()) return

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

    const now = new Date()
    const rows: ReminderRow[] = []

    const push = (type: string, offsetDays: number, hourEt: number) => {
      const when = etAt(partyDate, offsetDays, hourEt, `reminders:party ${bookingRef} ${type}`)
      if (!when || when <= now) return
      rows.push({
        contact_id: contact.id,
        reminder_type: type,
        reference_type: 'booking',
        reference_id: bookingRef,
        scheduled_for: when.toISOString(),
        channel: 'email',
      })
    }

    // T-2 and T-1 balance reminders, 10am Eastern. Both re-check the balance at
    // SEND time — a customer who pays in between is not chased.
    push('party_balance_t2', -2, 10)
    push('party_balance_t1', -1, 10)

    // Day-of admin alert, 7am Eastern — goes to the owner, not the customer.
    // This was firing at 3am local, which is a phone call nobody wants.
    push('party_admin_unpaid_dayof', 0, 7)

    // T+1 thank-you, 10am Eastern.
    push('party_thank_you_t1', 1, 10)

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
