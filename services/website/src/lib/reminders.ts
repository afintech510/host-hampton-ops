import { getSupabase } from '@/lib/supabase'

/**
 * Enqueue reminders for an event ticket purchase.
 * Creates reminder rows in scheduled_reminders for 3-day, day-of, and SMS reminders.
 */
export async function enqueueEventReminders({
  contactEmail,
  eventId,
  eventDate,
}: {
  contactEmail: string
  eventId: string
  eventDate: string // YYYY-MM-DD
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
