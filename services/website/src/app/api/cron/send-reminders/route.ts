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
import { asLedgerEntityId, claimReminder, finishReminder, isMarketingReminder, type SendOutcome } from '@/lib/reminderQueue'

export const dynamic = 'force-dynamic'

/**
 * The reminder deliverer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT BOUNDS THIS ROUTE. It is the one thing in the system that sends to a
 * customer with no human in the loop, so the limits are worth stating plainly:
 *
 *   WHO   — only a contact with a row in `scheduled_reminders`, and rows are
 *           only ever written by a confirmed ticket purchase, a confirmed
 *           booking, or the birthday scanner. There is no "send to everyone".
 *   WHAT  — only the sixteen `reminder_type` values in the table's CHECK
 *           constraint, each rendering a fixed template with merge fields. No
 *           model output, no admin free text, ever reaches a send from here.
 *   HOW OFTEN — once. `uniq_scheduled_reminder_once` (migration 044) makes
 *           (contact, type, reference) unique, and the CLAIM below makes a
 *           second concurrent tick lose rather than duplicate.
 *   CONSENT — re-read at SEND time, not at enqueue time. A marketing reminder
 *           enqueued yesterday is not sent to somebody who unsubscribed
 *           overnight.
 *   VOLUME — BATCH_SIZE rows per tick, oldest first.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT USED TO DO. It read pending rows, sent, and then marked them 'sent' —
 * with no claim, so two overlapping ticks both sent. And `status: 'sent'` was
 * written unconditionally after the processor returned, so a reminder was
 * recorded as sent when RESEND_API_KEY was unset, when the provider rejected the
 * message (`sendSMSVia` returns null, it does not throw), when the booking row
 * could not be read, and when the reminder type matched no branch at all. That
 * is the expensive half of hard-won rule 10: a guardrail must not say it did
 * something it did not do. Every path now ends at `finishReminder` with a named
 * outcome.
 */

// Simple auth for cron endpoints — use a shared secret
function isCronAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  return secret === process.env.CRON_SECRET
}

const BATCH_SIZE = 50

/** Reminder types that are addressed to the OWNER, not to the customer. */
const ADMIN_REMINDER_TYPES = new Set(['party_admin_unpaid_dayof'])

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Bounded manual run. `?limit=1` against a throwaway row whose scheduled_for
  // sorts first is how this route can be exercised in production without
  // touching a real customer.
  const limitParam = req.nextUrl.searchParams.get('limit')
  let limit = BATCH_SIZE
  if (limitParam !== null) {
    const n = Number(limitParam)
    if (!Number.isInteger(n) || n < 1 || n > BATCH_SIZE) {
      return NextResponse.json({ error: `limit must be an integer 1..${BATCH_SIZE}` }, { status: 400 })
    }
    limit = n
  }

  const supabase = getSupabase()
  const now = new Date().toISOString()

  // Rule 10: these three runs must not look the same. An unconfigured mailer is
  // reported, not silently treated as a successful no-op.
  const configured = {
    resend: !!process.env.RESEND_API_KEY,
    sms: !!(process.env.TWILIO_ACCOUNT_SID || process.env.QUO_API_KEY),
  }

  const { data: reminders, error } = await supabase
    .from('scheduled_reminders')
    .select('*, contacts(email, phone, first_name, sms_opt_in, email_opt_in, status)')
    .eq('status', 'pending')
    .lte('scheduled_for', now)
    .order('scheduled_for', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('cron:reminders fetch error:', error.message)
    return NextResponse.json({ error: 'Failed to fetch reminders', detail: error.message }, { status: 500 })
  }

  if (!reminders || reminders.length === 0) {
    return NextResponse.json({ ok: true, due: 0, message: 'no reminders due', configured })
  }

  const tally: Record<string, number> = { delivered: 0, skipped: 0, retry: 0, failed: 0, lost: 0, unavailable: 0 }
  const reasons: string[] = []

  for (const reminder of reminders) {
    // CLAIM FIRST. Nothing below this line may send until the row is ours.
    const claim = await claimReminder(supabase, reminder.id)
    if (claim.kind === 'lost') { tally.lost++; continue }
    if (claim.kind === 'unavailable') {
      tally.unavailable++
      reasons.push(`claim_failed: ${claim.error}`)
      continue
    }

    let outcome: SendOutcome
    try {
      outcome = await dispatch(reminder, supabase, configured)
    } catch (err) {
      // An exception is transient until proven otherwise (rule 3).
      console.error('cron:reminder threw:', reminder.id, err)
      outcome = { kind: 'retry', reason: `exception: ${err instanceof Error ? err.message : String(err)}` }
    }

    await finishReminder(supabase, reminder, outcome)
    tally[outcome.kind]++
    if (outcome.kind !== 'delivered') reasons.push(`${reminder.reminder_type}: ${outcome.reason}`)
  }

  console.log(
    `cron:reminders due=${reminders.length} delivered=${tally.delivered} skipped=${tally.skipped} ` +
      `retry=${tally.retry} failed=${tally.failed} lost=${tally.lost} unavailable=${tally.unavailable}`
  )

  return NextResponse.json({ ok: true, due: reminders.length, ...tally, reasons, configured })
}

/**
 * Consent, then channel. Returns the outcome; never sends without passing here.
 */
async function dispatch(
  reminder: any,
  supabase: any,
  configured: { resend: boolean; sms: boolean }
): Promise<SendOutcome> {
  const contact = reminder.contacts as any
  const isAdminAlert = ADMIN_REMINDER_TYPES.has(reminder.reminder_type)

  // The admin alert is addressed to the owner and needs no contact row.
  if (!contact && !isAdminAlert) {
    return { kind: 'failed', reason: 'no contact row joined to this reminder' }
  }

  if (reminder.channel === 'email') {
    if (!configured.resend) return { kind: 'retry', reason: 'unconfigured: RESEND_API_KEY not set' }

    // Consent is read HERE, at send time. The birthday nudge is enqueued a day
    // before it goes out, and the old code checked email_opt_in only at enqueue
    // — so somebody who unsubscribed overnight still got a marketing email.
    if (!isAdminAlert && isMarketingReminder(reminder.reminder_type)) {
      if (contact?.email_opt_in !== true) {
        return { kind: 'skipped', reason: 'opted_out: email_opt_in is not true' }
      }
      if (contact?.status === 'unsubscribed') {
        return { kind: 'skipped', reason: 'opted_out: contacts.status = unsubscribed' }
      }
    }
    if (!isAdminAlert && !contact?.email) {
      return { kind: 'skipped', reason: 'no_email: contact has no address on file' }
    }

    return processEmailReminder(reminder, contact, supabase)
  }

  if (reminder.channel === 'sms') {
    if (!configured.sms) return { kind: 'retry', reason: 'unconfigured: no SMS provider credential' }

    // The check-in link is TRANSACTIONAL — it is about a party the customer has
    // already booked and paid a deposit on, so it is not gated on the marketing
    // sms_opt_in flag (most customers never tick that box, and gating on it
    // would silently disable the feature for them). A real STOP is still
    // honoured, via hasExplicitSmsOptOut, which fails CLOSED.
    //
    // Note the phone is NOT required on the contact row here: the check-in text
    // prefers `bookings.contact_phone` and only falls back to the contact. The
    // old code blocked on `!contact.phone`, so a booking that carried a perfectly
    // good number was skipped because the contact record didn't.
    if (isCheckinReminderType(reminder.reminder_type)) {
      if (await hasExplicitSmsOptOut(reminder.contact_id)) {
        return { kind: 'skipped', reason: 'opted_out: explicit STOP on file' }
      }
    } else {
      if (!contact?.sms_opt_in) return { kind: 'skipped', reason: 'opted_out: sms_opt_in is not true' }
      if (!contact?.phone) return { kind: 'skipped', reason: 'no_phone' }
    }

    return processSmsReminder(reminder, contact, supabase)
  }

  return { kind: 'failed', reason: `unknown channel "${reminder.channel}"` }
}

/**
 * Hand a message to Resend and BELIEVE THE RESULT.
 *
 * `resend.emails.send` resolves with `{ data, error }` — it does not throw on an
 * API error. The old code ignored the return value entirely, so a rejected send
 * was recorded as delivered.
 */
async function sendEmail(
  resend: Resend,
  args: { from: string; to: string; subject: string; html: string }
): Promise<SendOutcome> {
  const { data, error } = await resend.emails.send(args)
  if (error) return { kind: 'retry', reason: `resend rejected: ${error.message}` }
  if (!data?.id) return { kind: 'retry', reason: 'resend returned no message id' }
  return { kind: 'delivered', detail: `resend:${data.id}` }
}

async function processEmailReminder(reminder: any, contact: any, supabase: any): Promise<SendOutcome> {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

  // Birthday rebooking references the booking by booking_ref like every other
  // booking reminder — migration 044 unified the two conventions this column
  // used to carry (rule 11: one meaning per column).
  if (reminder.reminder_type === 'birthday_rebook_email') {
    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select('contact_name, child_name, child_age')
      .eq('booking_ref', reminder.reference_id)
      .maybeSingle()
    if (bErr) return { kind: 'retry', reason: `booking read failed: ${bErr.message}` }
    if (!booking) return { kind: 'failed', reason: `no booking ${reminder.reference_id}` }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.hosthampton.com'
    const html = birthdayRebookHtml({
      customerName: booking.contact_name || contact.first_name || 'there',
      childName: booking.child_name,
      nextAge: booking.child_age != null ? booking.child_age + 1 : null,
      bookLink: `${siteUrl}/book`,
    })
    return sendEmail(resend, { from, to: contact.email, subject: 'A special birthday is coming up! 🎉', html })
  }

  let subject = ''
  let html = ''

  if (reminder.reference_type === 'event') {
    const { data: evt, error: eErr } = await supabase
      .from('events')
      .select('title, event_date, event_time, location')
      .eq('id', reminder.reference_id)
      .maybeSingle()

    // Rule 12: "the events table did not answer" is not "there is no such event".
    if (eErr) return { kind: 'retry', reason: `event read failed: ${eErr.message}` }
    if (!evt) return { kind: 'failed', reason: `no event ${reminder.reference_id}` }

    const dateDisplay = evt.event_date
      ? new Date(evt.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      : 'TBD'

    if (reminder.reminder_type === 'event_email_3day') {
      subject = `Reminder: ${flattenHeader(evt.title)} is coming up!`
      html = reminderEvent3DayHtml({
        customerName: contact.first_name || 'there',
        eventTitle: evt.title,
        eventDate: dateDisplay,
        eventTime: evt.event_time || '',
        location: evt.location || 'Host Hampton, 295 Montauk Hwy, Speonk NY',
      })
    } else if (reminder.reminder_type === 'event_email_dayof') {
      subject = `See you today! ${flattenHeader(evt.title)}`
      html = reminderEventDayOfHtml({
        customerName: contact.first_name || 'there',
        eventTitle: evt.title,
        eventTime: evt.event_time || '',
        location: evt.location || 'Host Hampton, 295 Montauk Hwy, Speonk NY',
      })
    }
  } else if (reminder.reference_type === 'booking') {
    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select('id, booking_ref, party_date, party_time, package_type, balance_due_cents, contact_name, contact_phone, child_name, photo_gallery_url')
      .eq('booking_ref', reminder.reference_id)
      .maybeSingle()

    if (bErr) return { kind: 'retry', reason: `booking read failed: ${bErr.message}` }
    if (!booking) return { kind: 'failed', reason: `no booking ${reminder.reference_id}` }

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
      // Balance is re-read at SEND time: a customer who paid after this row was
      // enqueued is not chased for money they no longer owe.
      const balanceDue = booking.balance_due_cents || 0
      if (balanceDue <= 0) return { kind: 'skipped', reason: 'balance_paid: nothing owed at send time' }

      // Generate a fresh portal magic link straight into the planner so the
      // customer lands on their plan with the payment section ready to go.
      const portalSecret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
      const { token: rawToken, hash, expiresAt } = generatePortalToken(booking.booking_ref, portalSecret)
      const { error: tokErr } = await supabase.from('portal_tokens').insert({
        booking_id: booking.id,
        token_hash: hash,
        expires_at: expiresAt.toISOString(),
      })
      // The email's whole point is the pay link. A token we failed to store is a
      // link that 404s, so this is NOT sent on a best-effort basis.
      if (tokErr) return { kind: 'retry', reason: `portal token insert failed: ${tokErr.message}` }

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

      const sent = await sendEmail(resend, { from, to: contact.email, subject, html })
      // The ledger is APPEND-ONLY, so a 'send' row written before the send is a
      // permanent claim that something happened when it may not have. Write it
      // after, and only on success.
      if (sent.kind === 'delivered') {
        await writeLedger(supabase, {
          entityType: 'review_request',
          entityId: booking.id,
          action: 'send',
          actor: 'system',
          meta: { channel: 'email', reminder_type: reminder.reminder_type, booking_ref: booking.booking_ref },
        })
      }
      return sent
    } else if (reminder.reminder_type === 'party_admin_unpaid_dayof') {
      // Send to admin, not to customer.
      const balanceDue = booking.balance_due_cents || 0
      if (balanceDue <= 0) return { kind: 'skipped', reason: 'balance_paid: nothing owed at send time' }

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.hosthampton.com'
      return sendEmail(resend, {
        from,
        to: ownerEmail(),
        subject: `ALERT: Unpaid balance — ${booking.booking_ref} party today`,
        html: partyAdminUnpaidDayOfHtml({
          bookingRef: booking.booking_ref,
          customerName: booking.contact_name || contact?.first_name || 'Unknown',
          customerPhone: booking.contact_phone || contact?.phone || undefined,
          partyDate: dateDisplay,
          balanceFormatted: formatMoney(balanceDue),
          adminUrl: `${siteUrl}/admin?tab=parties&ref=${booking.booking_ref}`,
        }),
      })
    }
  }

  // No branch matched. Silently marking this 'sent' is how a broken reminder
  // type disappears without anyone noticing.
  if (!subject || !html) {
    return { kind: 'failed', reason: `no email template for type "${reminder.reminder_type}"` }
  }

  return sendEmail(resend, { from, to: contact.email, subject, html })
}

/**
 * Strip anything that could start a new mail header out of a subject line.
 * `events.title` is admin-written free text and goes straight into `subject`.
 */
function flattenHeader(value: string | null | undefined): string {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim()
}

async function processSmsReminder(reminder: any, contact: any, supabase: any): Promise<SendOutcome> {
  const firstName = contact.first_name || 'there'

  let body = ''

  // Pre-arrival check-in link. Mints a FRESH token per send so the customer can
  // use whichever text they still have, and skips entirely if check-in is
  // already done (belt and braces — completion also cancels these rows).
  if (isCheckinReminderType(reminder.reminder_type)) {
    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select('id, booking_ref, contact_name, contact_phone, checkin_status, status')
      .eq('booking_ref', reminder.reference_id)
      .maybeSingle()

    if (bErr) return { kind: 'retry', reason: `booking read failed: ${bErr.message}` }
    if (!booking) return { kind: 'failed', reason: `no booking ${reminder.reference_id}` }
    if (booking.checkin_status === 'complete') return { kind: 'skipped', reason: 'checkin_complete' }
    if (booking.status === 'cancelled') return { kind: 'skipped', reason: 'booking_cancelled' }

    const result = await sendCheckinLinkSms({
      id: booking.id,
      contact_name: booking.contact_name,
      // Prefer the number on the booking; fall back to the contact record.
      contact_phone: booking.contact_phone || contact.phone,
    })
    if (!result.sent) {
      console.warn('cron:checkin link not sent:', booking.booking_ref, result.reason)
      // "No phone number" is terminal; a provider rejection is not.
      return result.reason === 'no phone number on file'
        ? { kind: 'skipped', reason: 'no_phone' }
        : { kind: 'retry', reason: `checkin link: ${result.reason ?? 'not sent'}` }
    }
    return { kind: 'delivered', detail: 'checkin_link' }
  }

  // Birthday rebooking — keyed by booking_ref like everything else since 044.
  if (reminder.reminder_type === 'birthday_rebook_sms') {
    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select('child_name, child_age')
      .eq('booking_ref', reminder.reference_id)
      .maybeSingle()
    if (bErr) return { kind: 'retry', reason: `booking read failed: ${bErr.message}` }
    if (!booking) return { kind: 'failed', reason: `no booking ${reminder.reference_id}` }

    body = smsBirthdayRebook({
      firstName,
      childName: booking.child_name,
      nextAge: booking.child_age != null ? booking.child_age + 1 : null,
    })
    // Birthday rebooking is MARKETING — stays on Twilio for now (see lib/sms.ts).
    const sid = await sendSMSVia('twilio', contact.phone, body)
    return sid
      ? { kind: 'delivered', detail: `twilio:${sid}` }
      : { kind: 'retry', reason: 'sms provider rejected the send' }
  }

  if (reminder.reference_type === 'event') {
    const { data: evt, error: eErr } = await supabase
      .from('events')
      .select('title, event_time')
      .eq('id', reminder.reference_id)
      .maybeSingle()

    if (eErr) return { kind: 'retry', reason: `event read failed: ${eErr.message}` }
    if (!evt) return { kind: 'failed', reason: `no event ${reminder.reference_id}` }

    if (reminder.reminder_type === 'event_sms_1day') {
      body = smsEventReminder1Day({ firstName, eventName: evt.title, time: evt.event_time || '' })
    } else if (reminder.reminder_type === 'event_sms_2hr') {
      body = smsEventReminder2Hr({ firstName, eventName: evt.title })
    }
  } else if (reminder.reference_type === 'booking') {
    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select('party_time')
      .eq('booking_ref', reminder.reference_id)
      .maybeSingle()

    if (bErr) return { kind: 'retry', reason: `booking read failed: ${bErr.message}` }
    if (!booking) return { kind: 'failed', reason: `no booking ${reminder.reference_id}` }

    if (reminder.reminder_type === 'booking_sms_1day') {
      body = smsBookingReminder1Day({ firstName, partyTime: booking.party_time || '' })
    }
  }

  // Review request (works for both events and bookings)
  if (!body && reminder.reminder_type === 'review_request_sms') {
    body = smsReviewRequest({ firstName, reviewUrl: buildReviewUrl('sms') })
  }

  if (!body) {
    return { kind: 'failed', reason: `no SMS template for type "${reminder.reminder_type}"` }
  }

  // Transactional reminders (event/booking/review) send via Quo.
  const sid = await sendSMSVia('quo', contact.phone, body)
  if (!sid) return { kind: 'retry', reason: 'sms provider rejected the send' }

  if (reminder.reminder_type === 'review_request_sms') {
    await writeLedger(supabase, {
      entityType: 'review_request',
      // reference_id is a booking_ref for bookings, which is not a uuid and
      // would be silently rejected by marketing_ledger.entity_id.
      entityId: asLedgerEntityId(reminder.reference_id),
      action: 'send',
      actor: 'system',
      meta: { channel: 'sms', reference_type: reminder.reference_type, reference_id: reminder.reference_id },
    })
  }

  return { kind: 'delivered', detail: `quo:${sid}` }
}
