import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { getSupabase } from '@/lib/supabase'
import {
  reminderEvent3DayHtml,
  reminderEventDayOfHtml,
  reminderBooking7DayHtml,
  reminderBooking1DayHtml,
} from '@/lib/email-templates/reminders'
import { partyBalanceReminderHtml, partyAdminUnpaidDayOfHtml } from '@/lib/emailTemplates'
import { formatMoney } from '@/lib/partyPricing'
import {
  smsEventReminder1Day,
  smsEventReminder2Hr,
  smsBookingReminder1Day,
  smsReviewRequest,
} from '@/lib/sms-templates'
import { sendSMS } from '@/lib/twilio'

export const dynamic = 'force-dynamic'

// Simple auth for cron endpoints — use a shared secret
function isCronAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  return secret === process.env.CRON_SECRET
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabase()
  const now = new Date().toISOString()

  // Fetch pending reminders that are due
  const { data: reminders, error } = await supabase
    .from('scheduled_reminders')
    .select('*, contacts(email, phone, first_name, sms_opt_in)')
    .eq('status', 'pending')
    .lte('scheduled_for', now)
    .order('scheduled_for')
    .limit(50)

  if (error || !reminders) {
    console.error('cron:reminders fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch reminders' }, { status: 500 })
  }

  if (reminders.length === 0) {
    return NextResponse.json({ processed: 0 })
  }

  let sent = 0
  let failed = 0

  for (const reminder of reminders) {
    try {
      const contact = reminder.contacts as any
      if (!contact) {
        await supabase.from('scheduled_reminders').update({ status: 'failed' }).eq('id', reminder.id)
        failed++
        continue
      }

      if (reminder.channel === 'email') {
        await processEmailReminder(reminder, contact, supabase)
      } else if (reminder.channel === 'sms') {
        if (!contact.sms_opt_in || !contact.phone) {
          // Contact opted out or no phone — cancel
          await supabase.from('scheduled_reminders').update({ status: 'cancelled' }).eq('id', reminder.id)
          continue
        }
        await processSmsReminder(reminder, contact, supabase)
      }

      await supabase.from('scheduled_reminders').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
      }).eq('id', reminder.id)
      sent++
    } catch (err) {
      console.error('cron:reminder error:', reminder.id, err)
      await supabase.from('scheduled_reminders').update({ status: 'failed' }).eq('id', reminder.id)
      failed++
    }
  }

  console.log(`cron:reminders processed ${sent} sent, ${failed} failed`)
  return NextResponse.json({ processed: reminders.length, sent, failed })
}

async function processEmailReminder(reminder: any, contact: any, supabase: any) {
  if (!process.env.RESEND_API_KEY) return

  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

  let subject = ''
  let html = ''

  if (reminder.reference_type === 'event') {
    const { data: evt } = await supabase
      .from('events')
      .select('title, event_date, event_time, location')
      .eq('id', reminder.reference_id)
      .single()

    if (!evt) return

    const dateDisplay = evt.event_date
      ? new Date(evt.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      : 'TBD'

    if (reminder.reminder_type === 'event_email_3day') {
      subject = `Reminder: ${evt.title} is coming up!`
      html = reminderEvent3DayHtml({
        customerName: contact.first_name || 'there',
        eventTitle: evt.title,
        eventDate: dateDisplay,
        eventTime: evt.event_time || '',
        location: evt.location || 'Host Hampton, 295 Montauk Hwy, Speonk NY',
      })
    } else if (reminder.reminder_type === 'event_email_dayof') {
      subject = `See you today! ${evt.title}`
      html = reminderEventDayOfHtml({
        customerName: contact.first_name || 'there',
        eventTitle: evt.title,
        eventTime: evt.event_time || '',
        location: evt.location || 'Host Hampton, 295 Montauk Hwy, Speonk NY',
      })
    }
  } else if (reminder.reference_type === 'booking') {
    const { data: booking } = await supabase
      .from('bookings')
      .select('booking_ref, party_date, party_time, package_type, balance_due_cents, contact_name, contact_phone')
      .eq('booking_ref', reminder.reference_id)
      .single()

    if (!booking) return

    const dateDisplay = booking.party_date
      ? new Date(booking.party_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      : 'TBD'

    if (reminder.reminder_type === 'booking_email_7day') {
      subject = `Your party is in one week!`
      html = reminderBooking7DayHtml({
        customerName: contact.first_name || 'there',
        bookingRef: booking.booking_ref,
        partyDate: dateDisplay,
        partyTime: booking.party_time || '',
        packageName: booking.package_type,
      })
    } else if (reminder.reminder_type === 'booking_email_1day') {
      subject = `Tomorrow's the big day!`
      html = reminderBooking1DayHtml({
        customerName: contact.first_name || 'there',
        partyTime: booking.party_time || '',
        packageName: booking.package_type,
      })
    } else if (reminder.reminder_type === 'party_balance_t2' || reminder.reminder_type === 'party_balance_t1') {
      // Check if balance is still owed
      const balanceDue = booking.balance_due_cents || 0
      if (balanceDue <= 0) return // Already paid, skip reminder

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.hosthampton.com'
      subject = `Balance Reminder — ${booking.booking_ref}`
      html = partyBalanceReminderHtml({
        customerName: contact.first_name || 'there',
        bookingRef: booking.booking_ref,
        partyDate: dateDisplay,
        balanceFormatted: formatMoney(balanceDue),
        payUrl: `${siteUrl}/my-booking/pay`,
      })
    } else if (reminder.reminder_type === 'party_admin_unpaid_dayof') {
      // Send to admin, not to customer
      const balanceDue = booking.balance_due_cents || 0
      if (balanceDue <= 0) return

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.hosthampton.com'
      subject = `ALERT: Unpaid balance — ${booking.booking_ref} party today`
      html = partyAdminUnpaidDayOfHtml({
        bookingRef: booking.booking_ref,
        customerName: booking.contact_name || contact.first_name || 'Unknown',
        customerPhone: booking.contact_phone || contact.phone || undefined,
        partyDate: dateDisplay,
        balanceFormatted: formatMoney(balanceDue),
        adminUrl: `${siteUrl}/admin?tab=parties&ref=${booking.booking_ref}`,
      })

      // Override recipient to admin
      if (subject && html) {
        await resend.emails.send({ from, to: 'hosthampton295@gmail.com', subject, html })
        return // Don't send to customer
      }
    }
  }

  if (subject && html) {
    await resend.emails.send({ from, to: contact.email, subject, html })
  }
}

async function processSmsReminder(reminder: any, contact: any, supabase: any) {
  const firstName = contact.first_name || 'there'

  let body = ''

  if (reminder.reference_type === 'event') {
    const { data: evt } = await supabase
      .from('events')
      .select('title, event_time')
      .eq('id', reminder.reference_id)
      .single()

    if (!evt) return

    if (reminder.reminder_type === 'event_sms_1day') {
      body = smsEventReminder1Day({ firstName, eventName: evt.title, time: evt.event_time || '' })
    } else if (reminder.reminder_type === 'event_sms_2hr') {
      body = smsEventReminder2Hr({ firstName, eventName: evt.title })
    }
  } else if (reminder.reference_type === 'booking') {
    const { data: booking } = await supabase
      .from('bookings')
      .select('party_time')
      .eq('booking_ref', reminder.reference_id)
      .single()

    if (!booking) return

    if (reminder.reminder_type === 'booking_sms_1day') {
      body = smsBookingReminder1Day({ firstName, partyTime: booking.party_time || '' })
    }
  }

  // Review request (works for both events and bookings)
  if (!body && reminder.reminder_type === 'review_request_sms') {
    body = smsReviewRequest({ firstName })
  }

  if (body) {
    await sendSMS(contact.phone, body)
  }
}
