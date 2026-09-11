import { ownerEmail } from '@/lib/ownerNotify'
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { getSupabase } from '@/lib/supabase'
import {
  reminderEvent3DayHtml,
  reminderEventDayOfHtml,
  reminderBooking7DayHtml,
  reminderBooking1DayHtml,
} from '@/lib/email-templates/reminders'
import { partyBalanceReminderHtml, partyAdminUnpaidDayOfHtml, partyThankYouHtml, birthdayRebookHtml } from '@/lib/emailTemplates'
import { formatMoney } from '@/lib/partyPricing'
import { generatePortalToken, buildPortalUrl } from '@/lib/portalAuth'
import {
  smsEventReminder1Day,
  smsEventReminder2Hr,
  smsBookingReminder1Day,
  smsReviewRequest,
  smsBirthdayRebook,
} from '@/lib/sms-templates'
import { sendSMSVia } from '@/lib/sms'
import { buildReviewUrl } from '@/lib/marketing/reviewLink'
import { writeLedger } from '@/lib/marketing/graph'
import { sendCheckinLinkSms, hasExplicitSmsOptOut } from '@/lib/checkinLink'
import { isCheckinReminderType } from '@/lib/checkinReminders'

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
        // The check-in link is TRANSACTIONAL — it is about a party the customer
        // has already booked and paid a deposit on, so it is not gated on the
        // marketing sms_opt_in flag (most customers never tick that box, and
        // gating on it would silently disable the feature for them). A real
        // STOP is still honoured, via hasExplicitSmsOptOut.
        const isTransactionalCheckin = isCheckinReminderType(reminder.reminder_type)

        const blocked = isTransactionalCheckin
          ? !contact.phone || await hasExplicitSmsOptOut(reminder.contact_id)
          : !contact.sms_opt_in || !contact.phone

        if (blocked) {
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

  // Birthday rebooking references the booking by UUID (bookings.id), not by
  // booking_ref like the other booking reminders — handle it up front.
  if (reminder.reminder_type === 'birthday_rebook_email') {
    const { data: booking } = await supabase
      .from('bookings')
      .select('contact_name, child_name, child_age')
      .eq('id', reminder.reference_id)
      .single()
    if (!booking) return

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.hosthampton.com'
    const html = birthdayRebookHtml({
      customerName: booking.contact_name || contact.first_name || 'there',
      childName: booking.child_name,
      nextAge: booking.child_age != null ? booking.child_age + 1 : null,
      bookLink: `${siteUrl}/book`,
    })
    await resend.emails.send({ from, to: contact.email, subject: 'A special birthday is coming up! 🎉', html })
    return
  }

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
      .select('id, booking_ref, party_date, party_time, package_type, balance_due_cents, contact_name, contact_phone, child_name, photo_gallery_url')
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

      // Generate a fresh portal magic link straight into the planner so the
      // customer lands on their plan with the payment section ready to go.
      const portalSecret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
      const { token: rawToken, hash, expiresAt } = generatePortalToken(booking.booking_ref, portalSecret)
      await supabase.from('portal_tokens').insert({
        booking_id: booking.id,
        token_hash: hash,
        expires_at: expiresAt.toISOString(),
      }).then((res: { error: { message: string } | null }) => {
        if (res.error) console.error('Portal token insert (non-fatal):', res.error)
      })
      const payUrl = buildPortalUrl(booking.booking_ref, rawToken, '/party-planner')

      subject = `Balance Reminder — ${booking.booking_ref}`
      html = partyBalanceReminderHtml({
        customerName: contact.first_name || 'there',
        bookingRef: booking.booking_ref,
        partyDate: dateDisplay,
        balanceFormatted: formatMoney(balanceDue),
        payUrl,
      })
    } else if (reminder.reminder_type === 'party_thank_you_t1') {
      // Post-party thank-you, fired T+1 morning. Photo gallery section is
      // conditional on photo_gallery_url being set by an admin.
      subject = `Thank you for celebrating with us! — ${booking.booking_ref}`
      html = partyThankYouHtml({
        customerName: booking.contact_name || contact.first_name || 'there',
        bookingRef: booking.booking_ref,
        partyDate: dateDisplay,
        photoGalleryUrl: booking.photo_gallery_url,
        childName: booking.child_name,
        reviewUrl: buildReviewUrl('email'),
      })
      await writeLedger(supabase, {
        entityType: 'review_request',
        entityId: booking.id,
        action: 'send',
        actor: 'system',
        meta: { channel: 'email', reminder_type: reminder.reminder_type, booking_ref: booking.booking_ref },
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
        await resend.emails.send({ from, to: ownerEmail(), subject, html })
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

  // Pre-arrival check-in link. Mints a FRESH token per send so the customer can
  // use whichever text they still have, and skips entirely if check-in is
  // already done (belt and braces — completion also cancels these rows).
  if (isCheckinReminderType(reminder.reminder_type)) {
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, booking_ref, contact_name, contact_phone, checkin_status, status')
      .eq('booking_ref', reminder.reference_id)
      .single()

    if (!booking) return
    if (booking.checkin_status === 'complete') return
    if (booking.status === 'cancelled') return

    const result = await sendCheckinLinkSms({
      id: booking.id,
      contact_name: booking.contact_name,
      // Prefer the number on the booking; fall back to the contact record.
      contact_phone: booking.contact_phone || contact.phone,
    })
    if (!result.sent) console.warn('cron:checkin link not sent:', booking.booking_ref, result.reason)
    return
  }

  // Birthday rebooking references the booking by UUID (bookings.id).
  if (reminder.reminder_type === 'birthday_rebook_sms') {
    const { data: booking } = await supabase
      .from('bookings')
      .select('child_name, child_age')
      .eq('id', reminder.reference_id)
      .single()
    if (!booking) return
    body = smsBirthdayRebook({
      firstName,
      childName: booking.child_name,
      nextAge: booking.child_age != null ? booking.child_age + 1 : null,
    })
    // Birthday rebooking is MARKETING — stays on Twilio for now (see lib/sms.ts).
    if (body) await sendSMSVia('twilio', contact.phone, body)
    return
  }

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
    body = smsReviewRequest({ firstName, reviewUrl: buildReviewUrl('sms') })
  }

  if (body) {
    // Transactional reminders (event/booking/review) send via Quo.
    await sendSMSVia('quo', contact.phone, body)
    if (reminder.reminder_type === 'review_request_sms') {
      await writeLedger(supabase, {
        entityType: 'review_request',
        entityId: reminder.reference_id,
        action: 'send',
        actor: 'system',
        meta: { channel: 'sms', reference_type: reminder.reference_type },
      })
    }
  }
}
