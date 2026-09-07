import { getSupabase } from '@/lib/supabase'
import { parseTime, etToUtc } from '@/lib/partyTime'

/**
 * Scheduling for the two automatic check-in link texts.
 *
 * These are just rows in the existing `scheduled_reminders` table, delivered by
 * the existing send-reminders cron — there is deliberately no new cron job.
 *
 *   checkin_link_36hr  — 36 hours before the party START time
 *   checkin_link_dayof — 6:00am Eastern on the party date
 *
 * Both are `channel: 'sms'`, `reference_type: 'booking'`, and keyed by
 * `reference_id = booking_ref` (what the cron looks bookings up by).
 */

export const CHECKIN_REMINDER_TYPES = ['checkin_link_36hr', 'checkin_link_dayof'] as const

export type CheckinReminderType = (typeof CHECKIN_REMINDER_TYPES)[number]

export function isCheckinReminderType(type: string): type is CheckinReminderType {
  return (CHECKIN_REMINDER_TYPES as readonly string[]).includes(type)
}

export interface CheckinReminderTimes {
  at36hr: Date | null
  dayOf: Date | null
}

/**
 * Compute both send times from the booking's date/time.
 *
 * party_time is free text ("2:00 PM"). If it can't be parsed we still schedule
 * the 6am day-of send — losing one of the two reminders is much better than
 * losing both because someone typed "afternoon" into the time field.
 */
export function computeCheckinReminderTimes(
  partyDate: string | null | undefined,
  partyTime: string | null | undefined
): CheckinReminderTimes {
  if (!partyDate) return { at36hr: null, dayOf: null }

  const dayOf = etToUtc(partyDate, 6, 0)

  let at36hr: Date | null = null
  const t = partyTime ? parseTime(partyTime) : null
  if (t) {
    const start = etToUtc(partyDate, t.hours, t.minutes)
    if (!Number.isNaN(start.getTime())) {
      at36hr = new Date(start.getTime() - 36 * 60 * 60 * 1000)
    }
  }

  return {
    at36hr,
    dayOf: Number.isNaN(dayOf.getTime()) ? null : dayOf,
  }
}

interface EnqueueInput {
  bookingRef: string
  contactEmail: string
  partyDate: string | null | undefined
  partyTime: string | null | undefined
  /** Injectable for tests. */
  now?: Date
}

/**
 * Create (or move) both check-in reminder rows for a booking.
 *
 * Safe to call repeatedly — it cancels any existing pending check-in rows for
 * the booking first, so this doubles as the reschedule path when a party date
 * changes. Non-fatal throughout: a failure here must never break a booking.
 */
export async function enqueueCheckinReminders({
  bookingRef,
  contactEmail,
  partyDate,
  partyTime,
  now = new Date(),
}: EnqueueInput): Promise<void> {
  try {
    const supabase = getSupabase()

    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('email', contactEmail)
      .single()

    if (!contact) {
      console.warn('checkin:enqueue — no contact for', contactEmail, '— skipping')
      return
    }

    // Clear the old rows before writing new ones. Without this, a date change
    // leaves the original rows in place and the customer gets texted on the
    // old schedule as well as the new one.
    await cancelCheckinReminders(bookingRef)

    const { at36hr, dayOf } = computeCheckinReminderTimes(partyDate, partyTime)

    const rows = [
      { type: 'checkin_link_36hr' as const, when: at36hr },
      { type: 'checkin_link_dayof' as const, when: dayOf },
    ]
      // Never schedule into the past — the cron would fire it immediately.
      .filter((r): r is { type: typeof r.type; when: Date } => !!r.when && r.when > now)
      .map(r => ({
        contact_id: contact.id,
        reminder_type: r.type,
        reference_type: 'booking',
        reference_id: bookingRef,
        scheduled_for: r.when.toISOString(),
        channel: 'sms',
      }))

    if (rows.length === 0) return

    const { error } = await supabase.from('scheduled_reminders').insert(rows)
    if (error) console.error('checkin:enqueue insert error:', error)
  } catch (err) {
    console.error('checkin:enqueue error (non-fatal):', err)
  }
}

/**
 * Suppress both sends. Called when check-in completes, and before rescheduling.
 *
 * Follows the house convention of status='cancelled' rather than DELETE, so the
 * row survives as evidence of what was scheduled. Only touches 'pending' rows —
 * an already-sent text is history and must not be rewritten.
 */
export async function cancelCheckinReminders(bookingRef: string): Promise<void> {
  try {
    const supabase = getSupabase()
    const { error } = await supabase
      .from('scheduled_reminders')
      .update({ status: 'cancelled' })
      .eq('reference_type', 'booking')
      .eq('reference_id', bookingRef)
      .in('reminder_type', [...CHECKIN_REMINDER_TYPES])
      .eq('status', 'pending')
    if (error) console.error('checkin:cancel error:', error)
  } catch (err) {
    console.error('checkin:cancel error (non-fatal):', err)
  }
}
