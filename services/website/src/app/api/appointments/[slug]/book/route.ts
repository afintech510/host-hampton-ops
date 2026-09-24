/**
 * Public availability and booking for one appointment event.
 *
 * `GET  /api/appointments/<slug>/book` → which start times are free
 * `POST /api/appointments/<slug>/book` → book one
 *
 * Follows `api/christmas-market/vendor/route.ts` as the public-POST template:
 * rate limit first, a body that may not be JSON, a registry lookup that can
 * fail, every field screened server-side, and a read failure that REFUSES
 * rather than guesses.
 *
 * ── THE DOUBLE BOOKING, AND HOW IT IS GONE ──
 *
 * The route this replaces did check-then-act. It read every confirmed row into
 * a Set of occupied slot indices, checked its own indices against that Set, and
 * then inserted unconditionally. There was no unique constraint and no index on
 * `time_slot`, so two requests arriving inside the same moment both read an
 * empty set and both succeeded: **20 simultaneous POSTs for one start time
 * produced 20 bookings.**
 *
 * The fix is in the schema, not here. `appointment_slot_holds` has
 * `PRIMARY KEY (event_slug, slot_index)`, and this route claims every slot a
 * booking needs in ONE multi-row INSERT. A multi-row insert is atomic, so
 * either the whole booking is claimed or none of it is, and the loser of a race
 * gets 23505 — matched BY CODE (`isUniqueViolation`), never by reading
 * `error.message` for the words 'duplicate key', which is a guard that stops
 * working the day a driver rewords its errors.
 *
 * There is deliberately no `new Set` of occupied indices anywhere in POST. A
 * pre-check would be a *second*, weaker answer to the question the primary key
 * already answers, and the first thing somebody would trust when the two
 * disagreed.
 */

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { Resend } from 'resend'
import { guardRate, intakeRule } from '@/lib/rateLimit'
import { publicOrigin } from '@/lib/publicOrigin'
import { getSupabase } from '@/lib/supabase'
import { sendSMSVia, normalizePhone } from '@/lib/sms'
import { notifyOwnerSms } from '@/lib/ownerNotify'
import { upsertContactResult } from '@/lib/contacts'
import { isUniqueViolation } from '@/lib/planPayment'
import { clean, looksLikeEmail, looksLikePhone, MAX_FIELD } from '@/lib/intakeFields'
import {
  appointmentConfirmationHtml,
  appointmentAdminNotifyHtml,
} from '@/lib/email-templates/appointments'
import {
  resolveAppointmentEvent,
  isEventClosed,
  slotTimes,
  calcSlotsNeeded,
  occupiedSlotIndices,
  estimateCents,
  durationRange,
  formatAppointmentMoney,
  paymentNote,
  isValidServiceId,
  type AppointmentEventConfig,
} from '@/lib/appointmentEvents'

export const dynamic = 'force-dynamic'

/**
 * How long an unpaid checkout may hold its slots.
 *
 * A customer who opens Stripe and closes the tab would otherwise block a slot
 * for the rest of the day, silently — the abandoned-checkout hole. Fifteen
 * minutes is long enough to find a card and short enough that the slot is back
 * on the page while the day is still bookable.
 */
const PENDING_HOLD_MINUTES = 15

/** Service ids the browser sent, screened down to ones this event actually has. */
function readServiceIds(cfg: AppointmentEventConfig, raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const ids: string[] = []
  for (const v of raw) {
    if (!isValidServiceId(cfg, v)) return null
    if (!ids.includes(v as string)) ids.push(v as string)
  }
  return ids
}

/* ───────────────────────────────────────────────────────────────────────────
 * GET — availability
 * ─────────────────────────────────────────────────────────────────────────── */

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const cfg = resolveAppointmentEvent(params.slug)
  if (!cfg) {
    return NextResponse.json({ error: 'Unknown event' }, { status: 400 })
  }

  const url = new URL(req.url)
  const requested = url.searchParams.getAll('service').filter(s => isValidServiceId(cfg, s))
  const partySize = parseInt(url.searchParams.get('partySize') || '1', 10)
  const slotsNeeded = requested.length > 0 ? calcSlotsNeeded(cfg, requested, partySize) : 1

  const times = slotTimes(cfg)

  // A closed event still answers, so the page can render "booking has closed"
  // rather than an empty grid the customer will keep pressing.
  if (isEventClosed(cfg)) {
    return NextResponse.json({
      closed: true,
      slotsNeeded,
      slots: times.map((time, index) => ({ time, index, available: false })),
    })
  }

  const supabase = getSupabase()

  const { data: holds, error } = await supabase
    .from('appointment_slot_holds')
    .select('slot_index, expires_at')
    .eq('event_slug', cfg.slug)

  if (error) {
    // Rule 12: an unreadable holds table is not an empty one. Showing every slot
    // as free here is how a customer is invited to book something already taken.
    console.error(`appointments ${cfg.slug}: cannot read slot holds —`, error.message)
    return NextResponse.json(
      { error: 'We could not load the available times. Please try again.' },
      { status: 503 },
    )
  }

  // A hold whose `expires_at` has passed belongs to an abandoned checkout and
  // does not block anybody. It is DELETED in POST, which is already a writer;
  // this read stays a read.
  const now = Date.now()
  const blocked = new Array<boolean>(times.length).fill(false)
  for (const h of holds ?? []) {
    if (h.expires_at && new Date(h.expires_at).getTime() <= now) continue
    if (h.slot_index >= 0 && h.slot_index < blocked.length) blocked[h.slot_index] = true
  }

  const slots = times.map((time, index) => {
    const endIdx = index + slotsNeeded - 1
    if (endIdx >= times.length) return { time, index, available: false }
    const available = occupiedSlotIndices(index, slotsNeeded).every(i => !blocked[i])
    return { time, index, available }
  })

  return NextResponse.json({ closed: false, slots, slotsNeeded })
}

/* ───────────────────────────────────────────────────────────────────────────
 * POST — book
 * ─────────────────────────────────────────────────────────────────────────── */

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const limited = guardRate(req, intakeRule('appointments-book'))
  if (limited) return limited

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const cfg = resolveAppointmentEvent(params.slug)
  if (!cfg) {
    return NextResponse.json({ error: 'Unknown event' }, { status: 400 })
  }

  // The stop half of the window `SpecialEventBanner` never had. 410 Gone, not
  // 404: the event was real and is over, which is a different sentence.
  if (isEventClosed(cfg)) {
    return NextResponse.json(
      { error: `Booking for ${cfg.name} has closed.` },
      { status: 410 },
    )
  }

  const name = clean(body.name, 120)
  const email = clean(body.email, 160)
  const phone = clean(body.phone, 40)
  const notes = clean(body.notes, MAX_FIELD)

  const missing: string[] = []
  if (!name) missing.push('your name')
  if (!email) missing.push('email')
  if (!phone) missing.push('phone')
  if (missing.length) {
    return NextResponse.json({ error: `Please fill in: ${missing.join(', ')}.` }, { status: 400 })
  }
  if (!looksLikeEmail(email)) {
    return NextResponse.json({ error: 'That email address does not look right.' }, { status: 400 })
  }
  if (!looksLikePhone(phone)) {
    return NextResponse.json({ error: 'Please enter a phone number we can reach you on.' }, { status: 400 })
  }

  const serviceIds = readServiceIds(cfg, body.services)
  if (!serviceIds || serviceIds.length === 0) {
    return NextResponse.json({ error: 'Please choose at least one service from the list.' }, { status: 400 })
  }

  const partySize = Number(body.partySize)
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > cfg.maxPartySize) {
    return NextResponse.json(
      { error: `Party size must be between 1 and ${cfg.maxPartySize}.` },
      { status: 400 },
    )
  }

  // The start time. `slotIndex` is canonical; a label is accepted only because
  // a form field that reads '10:20 AM' is what a human picked.
  const times = slotTimes(cfg)
  const startIdx = Number.isInteger(Number(body.slotIndex))
    ? Number(body.slotIndex)
    : times.indexOf(clean(body.timeSlot, 20))

  if (!Number.isInteger(startIdx) || startIdx < 0 || startIdx >= cfg.slotCount) {
    return NextResponse.json({ error: 'Please choose a start time.' }, { status: 400 })
  }

  const slotsNeeded = calcSlotsNeeded(cfg, serviceIds, partySize)
  const indices = occupiedSlotIndices(startIdx, slotsNeeded)
  if (indices[indices.length - 1] >= cfg.slotCount) {
    return NextResponse.json(
      { error: 'There is not enough time before we close for a booking that long. Please pick an earlier start.' },
      { status: 400 },
    )
  }

  const supabase = getSupabase()
  const timeSlot = times[startIdx]
  const duration = durationRange(cfg, startIdx, slotsNeeded)
  const estimatedCents = estimateCents(cfg, serviceIds, partySize)

  // ── The customer becomes a contact ────────────────────────────────────────
  //
  // The old route never did this, so sixteen Summer Hair bookers never landed
  // in `contacts` at all and the reminder cron had to hunt for them by phone to
  // check consent.
  //
  // An 'unavailable' result logs loudly and STILL BOOKS. The appointment is the
  // customer's actual intent; losing it to a contacts-table outage is strictly
  // worse than carrying a booking with a null `contact_id`, which the cron
  // already knows how to fall back from (it looks the phone up).
  let contactId: string | null = null
  const contact = await upsertContactResult({
    name,
    email,
    phone,
    sourceDetail: `${cfg.name} appointment`,
    serviceInterests: [cfg.contactServiceInterest],
    attribution: body.attribution,
  })
  if (contact.kind === 'unavailable') {
    console.error(
      `appointments ${cfg.slug}: could not upsert the contact (${contact.error}) — booking anyway, contact_id will be null`,
    )
  } else {
    contactId = contact.contactId
  }

  const paid = cfg.payment.mode !== 'in_person'

  // ── 1. The booking row ────────────────────────────────────────────────────
  //
  // Written BEFORE the slots are claimed, because the hold has an FK to it, and
  // before Stripe, so a customer who abandons the card page still leaves their
  // details behind (migration 059's note 2).
  const { data: booking, error: insertErr } = await supabase
    .from('appointment_bookings')
    .insert({
      event_slug: cfg.slug,
      name,
      email,
      phone,
      phone_e164: normalizePhone(phone),
      contact_id: contactId,
      slot_index: startIdx,
      time_slot: timeSlot,
      slots_needed: slotsNeeded,
      services: serviceIds,
      party_size: partySize,
      notes: notes || null,
      status: paid ? 'pending_payment' : 'confirmed',
      estimated_total_cents: estimatedCents,
    })
    .select('id')
    .single()

  if (insertErr || !booking) {
    console.error(`appointments ${cfg.slug}: booking insert failed —`, insertErr?.message)
    return NextResponse.json({ error: 'We could not save your booking. Please try again.' }, { status: 500 })
  }

  // ── 2. Sweep, then claim ──────────────────────────────────────────────────
  //
  // Holds left behind by abandoned checkouts are cleared first. This is a
  // narrow, self-owned garbage collection — only rows whose own `expires_at`
  // has already passed — and it lives on the POST path because POST is already
  // a writer and the availability GET must stay a read.
  const { error: sweepErr } = await supabase
    .from('appointment_slot_holds')
    .delete()
    .eq('event_slug', cfg.slug)
    .not('expires_at', 'is', null)
    .lt('expires_at', new Date().toISOString())

  if (sweepErr) {
    // Not fatal: the worst case is that an expired hold still blocks a slot and
    // this customer gets a 409 for a slot that was morally free.
    console.error(`appointments ${cfg.slug}: expired-hold sweep failed —`, sweepErr.message)
  }

  const expiresAt = paid
    ? new Date(Date.now() + PENDING_HOLD_MINUTES * 60_000).toISOString()
    : null

  const { error: holdErr } = await supabase
    .from('appointment_slot_holds')
    .insert(
      indices.map(slot_index => ({
        event_slug: cfg.slug,
        slot_index,
        booking_id: booking.id,
        expires_at: expiresAt,
      })),
    )

  if (holdErr) {
    // Undo the booking. It holds nothing, so leaving it would put a row on the
    // admin screen for an appointment that was never made. The rollback's own
    // error is READ: a failed rollback is the phantom row, and "we tried to
    // delete it" is not the same sentence as "it is gone".
    const { error: rollbackErr } = await supabase
      .from('appointment_bookings').delete().eq('id', booking.id)
    if (rollbackErr) {
      console.error(
        `appointments ${cfg.slug}: booking ${booking.id} holds no slots and could NOT be rolled back (${rollbackErr.message}) — it will show on the admin screen as an appointment nobody made`,
      )
    }

    if (isUniqueViolation(holdErr)) {
      return NextResponse.json(
        { error: 'Someone just took one of those times. Please pick another start time.' },
        { status: 409 },
      )
    }
    console.error(`appointments ${cfg.slug}: could not claim slots —`, holdErr.message)
    return NextResponse.json({ error: 'We could not hold that time. Please try again.' }, { status: 500 })
  }

  // ── 3. Payment, if this event takes one ───────────────────────────────────
  if (paid) {
    const amountCents =
      cfg.payment.mode === 'deposit'
        ? (cfg.payment.depositCents ?? 0)
        : estimatedCents

    if (amountCents <= 0) {
      // A misconfigured event: 'deposit' with no `depositCents`. Refuse rather
      // than open a checkout for $0 that Stripe rejects anyway, and say so in
      // the log where somebody will find it.
      console.error(`appointments ${cfg.slug}: payment mode '${cfg.payment.mode}' resolved to ${amountCents} cents`)
      const { error: rollbackErr } = await supabase
        .from('appointment_bookings').delete().eq('id', booking.id)
      if (rollbackErr) {
        console.error(
          `appointments ${cfg.slug}: booking ${booking.id} could NOT be rolled back after a misconfigured payment mode (${rollbackErr.message}) — it is holding slots it will never pay for`,
        )
      }
      return NextResponse.json({ error: 'This event is not accepting bookings right now.' }, { status: 503 })
    }

    // `publicOrigin`, never `X-Forwarded-Host` — nginx does not set that header,
    // so it is whatever the caller typed, and it used to decide where every
    // payment success URL pointed.
    const baseUrl = publicOrigin(req)
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        customer_email: email,
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: amountCents,
            product_data: {
              name: cfg.payment.mode === 'deposit'
                ? `${cfg.name} — appointment deposit`
                : `${cfg.name} — appointment`,
              description: `${cfg.dateLabel} · ${duration}`,
            },
          },
          quantity: 1,
        }],
        metadata: {
          type: 'appointment_booking',
          bookingId: booking.id,
          eventSlug: cfg.slug,
          contactEmail: email,
        },
        success_url: `${baseUrl}/appointments/${cfg.slug}?booked=${booking.id}`,
        cancel_url: `${baseUrl}/appointments/${cfg.slug}?cancelled=1`,
      })

      const { error: linkErr } = await supabase
        .from('appointment_bookings')
        .update({ stripe_session_id: session.id })
        .eq('id', booking.id)

      if (linkErr) {
        // Loud but not fatal — the metadata carries `bookingId` as the second
        // way home, so the webhook can still find this row.
        console.error(
          `appointments ${cfg.slug} booking ${booking.id}: could not attach stripe session ${session.id} —`,
          linkErr.message,
        )
      }

      return NextResponse.json({ url: session.url, bookingId: booking.id, duration })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Stripe error'
      console.error(`appointments ${cfg.slug}: stripe error —`, msg)
      // The row and its holds survive at `pending_payment` on purpose: the
      // customer's details are captured, and the holds expire on their own.
      return NextResponse.json(
        { error: 'We saved your details but could not open the card checkout. Please text us and we will finish it with you.' },
        { status: 502 },
      )
    }
  }

  // ── 4. Confirmed, in person. Tell everybody. ──────────────────────────────
  const estimatedTotal = formatAppointmentMoney(estimatedCents)
  const payNote = paymentNote(cfg)
  const serviceList = serviceIds.join(', ')
  const firstName = name.split(' ')[0]

  const notifyPromises: Promise<unknown>[] = []

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

    notifyPromises.push(
      resend.emails.send({
        from,
        to: cfg.notifyEmail,
        subject: `${cfg.name} Booking: ${name} at ${timeSlot}`,
        replyTo: email,
        html: appointmentAdminNotifyHtml({
          name, email, phone,
          eventName: cfg.name,
          dateLabel: cfg.dateLabel,
          duration,
          services: serviceIds,
          partySize,
          notes: notes || null,
          estimatedTotal,
          paymentNote: payNote,
        }),
      })
    )

    notifyPromises.push(
      resend.emails.send({
        from,
        to: email,
        subject: `You're booked — ${cfg.name} at Host Hampton!`,
        html: appointmentConfirmationHtml({
          name,
          eventName: cfg.name,
          dateLabel: cfg.dateLabel,
          locationLine: cfg.locationLine,
          duration,
          services: serviceIds,
          partySize,
          estimatedTotal,
          paymentNote: payNote,
        }),
      })
    )
  }

  const adminSms = `New ${cfg.name} booking!\n${name} - ${duration}\n${partySize} ${partySize === 1 ? 'person' : 'people'} (${slotsNeeded} slots)\nServices: ${serviceList}\nEst. total: ${estimatedTotal}\nPhone: ${phone}`
  notifyPromises.push(
    notifyOwnerSms(adminSms).catch(err => console.error('SMS to reviewers failed (non-fatal):', err))
  )

  // No emoji, by Adam's call (plan §21.2): a single non-GSM-03.38 character
  // flips the WHOLE message to UCS-2 at 70 characters per segment instead of
  // 160, which cost an extra segment on every confirmation we ever sent.
  const clientSms = `Hi ${firstName}! You're booked for ${cfg.name} at Host Hampton on ${cfg.dateLabel}, ${duration}.\n\nServices: ${serviceList}\nEst. total: ${estimatedTotal} (${payNote.toLowerCase()})\n\nSee you there!`
  notifyPromises.push(
    sendSMSVia('quo', normalizePhone(phone), clientSms).catch(err => console.error('SMS to client failed (non-fatal):', err))
  )

  await Promise.allSettled(notifyPromises)

  return NextResponse.json({ success: true, bookingId: booking.id, duration })
}
