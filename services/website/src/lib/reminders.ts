import { getSupabase } from '@/lib/supabase'
import { enqueueCheckinReminders } from '@/lib/checkinReminders'

// Time parsing / timezone conversion lives in lib/partyTime.ts so the check-in
// scheduler can share it without a circular import. Re-exported here because
// this module was its original home.
export { parseTime, etToUtc, PARTY_TZ } from '@/lib/partyTime'

/**
 * Enqueue reminders for an event ticket purchase.
 * Creates reminder rows in scheduled_reminders for 3-day, day-of, 1-day SMS, and 2-hr SMS reminders.
 */
export async function enqueueEventReminders({
  contactEmail,
  eventId,
  eventDate,
  eventTime,
}: {
  contactEmail: string
  eventId: string
  eventDate: string // YYYY-MM-DD
  eventTime?: string // e.g. "7:00 PM" — needed for 2hr SMS
}): Promise<void> {
  try {
    const supabase = getSupabase()

    // Find the contact
    const { data: contact } = await supabase
      .from('contacts')
      .select('id, sms_opt_in')
      .eq('email', contactEmail)
      .single()

    if (!contact) return

    const eventDateObj = new Date(eventDate + 'T12:00:00')
    const now = new Date()

    const reminders: {
      contact_id: string
      reminder_type: string
      reference_type: string
      reference_id: string
      scheduled_for: string
      channel: string
    }[] = []

    // 3 days before (email)
    const threeDaysBefore = new Date(eventDateObj)
    threeDaysBefore.setDate(threeDaysBefore.getDate() - 3)
    threeDaysBefore.setHours(10, 0, 0, 0)
    if (threeDaysBefore > now) {
      reminders.push({
        contact_id: contact.id,
        reminder_type: 'event_email_3day',
        reference_type: 'event',
        reference_id: eventId,
        scheduled_for: threeDaysBefore.toISOString(),
        channel: 'email',
      })
    }

    // Day of (email) — morning of event
    const dayOf = new Date(eventDateObj)
    dayOf.setHours(8, 0, 0, 0)
    if (dayOf > now) {
      reminders.push({
        contact_id: contact.id,
        reminder_type: 'event_email_dayof',
        reference_type: 'event',
        reference_id: eventId,
        scheduled_for: dayOf.toISOString(),
        channel: 'email',
      })
    }

    // 1 day before (SMS) — only if opted in
    if (contact.sms_opt_in) {
      const oneDayBefore = new Date(eventDateObj)
      oneDayBefore.setDate(oneDayBefore.getDate() - 1)
      oneDayBefore.setHours(10, 0, 0, 0)
      if (oneDayBefore > now) {
        reminders.push({
          contact_id: contact.id,
          reminder_type: 'event_sms_1day',
          reference_type: 'event',
          reference_id: eventId,
          scheduled_for: oneDayBefore.toISOString(),
          channel: 'sms',
        })
      }

    }

    if (reminders.length > 0) {
      await supabase.from('scheduled_reminders').insert(reminders)
      console.log(`Enqueued ${reminders.length} reminders for event ${eventId}`)
    }
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

    const { data: contact } = await supabase
      .from('contacts')
      .select('id, sms_opt_in')
      .eq('email', contactEmail)
      .single()

    if (!contact) return

    const partyDateObj = new Date(partyDate + 'T12:00:00')
    const now = new Date()

    const reminders: {
      contact_id: string
      reminder_type: string
      reference_type: string
      reference_id: string
      scheduled_for: string
      channel: string
    }[] = []

    // 7 days before (email)
    const sevenDaysBefore = new Date(partyDateObj)
    sevenDaysBefore.setDate(sevenDaysBefore.getDate() - 7)
    sevenDaysBefore.setHours(10, 0, 0, 0)
    if (sevenDaysBefore > now) {
      reminders.push({
        contact_id: contact.id,
        reminder_type: 'booking_email_7day',
        reference_type: 'booking',
        reference_id: bookingRef,
        scheduled_for: sevenDaysBefore.toISOString(),
        channel: 'email',
      })
    }

    // 1 day before (email)
    const oneDayBefore = new Date(partyDateObj)
    oneDayBefore.setDate(oneDayBefore.getDate() - 1)
    oneDayBefore.setHours(10, 0, 0, 0)
    if (oneDayBefore > now) {
      reminders.push({
        contact_id: contact.id,
        reminder_type: 'booking_email_1day',
        reference_type: 'booking',
        reference_id: bookingRef,
        scheduled_for: oneDayBefore.toISOString(),
        channel: 'email',
      })
    }

    // 1 day before (SMS) — only if opted in
    if (contact.sms_opt_in) {
      const smsOneDayBefore = new Date(partyDateObj)
      smsOneDayBefore.setDate(smsOneDayBefore.getDate() - 1)
      smsOneDayBefore.setHours(12, 0, 0, 0)
      if (smsOneDayBefore > now) {
        reminders.push({
          contact_id: contact.id,
          reminder_type: 'booking_sms_1day',
          reference_type: 'booking',
          reference_id: bookingRef,
          scheduled_for: smsOneDayBefore.toISOString(),
          channel: 'sms',
        })
      }
    }

    if (reminders.length > 0) {
      await supabase.from('scheduled_reminders').insert(reminders)
      console.log(`Enqueued ${reminders.length} reminders for booking ${bookingRef}`)
    }
  } catch (err) {
    console.error('enqueueBookingReminders error (non-fatal):', err)
  }
}

/**
 * Enqueue a post-event/post-booking review request SMS.
 * Scheduled for the day after the event at 2 PM.
 * Deduplicates by contact + reference to avoid repeat asks.
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

    const { data: contact } = await supabase
      .from('contacts')
      .select('id, sms_opt_in')
      .eq('email', contactEmail)
      .single()

    if (!contact?.sms_opt_in) return

    // Schedule for day after event at 2 PM
    const reviewDate = new Date(eventDate + 'T14:00:00')
    reviewDate.setDate(reviewDate.getDate() + 1)

    if (reviewDate <= new Date()) return

    // Avoid duplicate review requests
    const { data: existing } = await supabase
      .from('scheduled_reminders')
      .select('id')
      .eq('contact_id', contact.id)
      .eq('reminder_type', 'review_request_sms')
      .eq('reference_id', referenceId)
      .limit(1)

    if (existing && existing.length > 0) return

    await supabase.from('scheduled_reminders').insert({
      contact_id: contact.id,
      reminder_type: 'review_request_sms',
      reference_type: referenceType,
      reference_id: referenceId,
      scheduled_for: reviewDate.toISOString(),
      channel: 'sms',
    })

    console.log(`Enqueued review request for ${contactEmail} after ${eventDate}`)
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

    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('email', contactEmail)
      .single()

    if (!contact) return

    const partyDateObj = new Date(partyDate + 'T12:00:00')
    const now = new Date()

    const reminders: {
      contact_id: string
      reminder_type: string
      reference_type: string
      reference_id: string
      scheduled_for: string
      channel: string
    }[] = []

    // T-2 balance reminder (email)
    const twoDaysBefore = new Date(partyDateObj)
    twoDaysBefore.setDate(twoDaysBefore.getDate() - 2)
    twoDaysBefore.setHours(10, 0, 0, 0)
    if (twoDaysBefore > now) {
      reminders.push({
        contact_id: contact.id,
        reminder_type: 'party_balance_t2',
        reference_type: 'booking',
        reference_id: bookingRef,
        scheduled_for: twoDaysBefore.toISOString(),
        channel: 'email',
      })
    }

    // T-1 balance reminder (email)
    const oneDayBefore = new Date(partyDateObj)
    oneDayBefore.setDate(oneDayBefore.getDate() - 1)
    oneDayBefore.setHours(10, 0, 0, 0)
    if (oneDayBefore > now) {
      reminders.push({
        contact_id: contact.id,
        reminder_type: 'party_balance_t1',
        reference_type: 'booking',
        reference_id: bookingRef,
        scheduled_for: oneDayBefore.toISOString(),
        channel: 'email',
      })
    }

    // Day-of admin alert
    const dayOf = new Date(partyDateObj)
    dayOf.setHours(7, 0, 0, 0)
    if (dayOf > now) {
      reminders.push({
        contact_id: contact.id,
        reminder_type: 'party_admin_unpaid_dayof',
        reference_type: 'booking',
        reference_id: bookingRef,
        scheduled_for: dayOf.toISOString(),
        channel: 'email',
      })
    }

    // T+1 thank-you (email, morning after the party at 10am)
    const dayAfter = new Date(partyDateObj)
    dayAfter.setDate(dayAfter.getDate() + 1)
    dayAfter.setHours(10, 0, 0, 0)
    if (dayAfter > now) {
      reminders.push({
        contact_id: contact.id,
        reminder_type: 'party_thank_you_t1',
        reference_type: 'booking',
        reference_id: bookingRef,
        scheduled_for: dayAfter.toISOString(),
        channel: 'email',
      })
    }

    if (reminders.length > 0) {
      await supabase.from('scheduled_reminders').insert(reminders)
      console.log(`Enqueued ${reminders.length} party reminders for ${bookingRef}`)
    }

    // Pre-arrival check-in texts (36hr + 6am day-of). Scheduled here because
    // this is the one function every confirmed party booking passes through.
    // Needs party_time, which this function isn't given — read it back.
    const { data: bk } = await supabase
      .from('bookings')
      .select('party_time')
      .eq('booking_ref', bookingRef)
      .single()

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
