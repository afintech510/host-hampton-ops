import { ownerEmail } from '@/lib/ownerNotify'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { Resend } from 'resend'
import { getSupabase } from '@/lib/supabase'
import { upsertContact } from '@/lib/contacts'
import { ticketConfirmationHtml, ticketPurchaseNotifyHtml, bookingConfirmationHtml, giftCardHtml, giftCardNotifyHtml, giftCardPurchaseConfirmHtml, partyDepositReceivedHtml, partyAdminNewBookingHtml, partyPaymentReceivedHtml, studioRentalConfirmationHtml } from '@/lib/emailTemplates'
import { calculateCardFee, formatMoney } from '@/lib/partyPricing'
import { generatePortalToken, buildPortalUrl, portalSigningSecret } from '@/lib/portalAuth'
import { createCalendarEvent, addMinutes } from '@/lib/googleCalendar'
import { enqueueEventReminders, enqueueBookingReminders, enqueueReviewRequest, enqueuePartyReminders } from '@/lib/reminders'
import { enrollInSequence } from '@/lib/sequences'
import { matchPlanPayLink, recordPlanPayment, sendPlanPaymentReceipt, isUniqueViolation } from '@/lib/planPayment'
import { isUnclaimableSession, recordUnclaimedStripeSession } from '@/lib/unclaimedPayment'
import { publicOrigin, isLocalRequest } from '@/lib/publicOrigin'
import { escapeHtml } from '@/lib/escapeHtml'
import { mailToHref } from '@/lib/emailSafety'
import {
  sessionSettlement,
  claimBySessionId,
  nextTicketRef,
  decrementInventory,
  redeemGiftCard,
  parseJsonMetadata,
  isHandledSessionType,
  isLegacyBookingSession,
  type FinancialWrite,
} from '@/lib/stripeSettlement'
import { recordLedgerEntry } from '@/lib/financialLedger'
import {
  recordChargeRefunds,
  summarizeDispute,
  disputeWasLost,
  recordLostDispute,
  summarizeFailedPayment,
  shouldAlertOnFailedPayment,
  failedPaymentLogLine,
  alertDisputeOpened,
  alertRefundRecorded,
  alertPaymentFailed,
} from '@/lib/stripeAftermath'
import { resolveMarket } from '@/lib/christmasMarket'
import { marketVendorConfirmationHtml, marketVendorOwnerHtml } from '@/lib/marketVendorEmails'
import { readBalanceInputs, computeBalance } from '@/lib/bookingBalance'

/**
 * Record a Stripe payment in the unified financial_transactions table.
 *
 * A duplicate is success — `idx_fin_txn_source_ref` makes `(source, reference)`
 * unique precisely so a redelivery is a no-op. Anything ELSE is a real failure
 * and used to be swallowed under a `.includes('duplicate')` string test, which
 * is the message-text idiom the money rules forbid: `isUniqueViolation` reads
 * SQLSTATE 23505 first. Five of the six party-planner payments this year have no
 * financial row at all, so a silent failure here is not theoretical.
 */
async function recordFinancialTransaction(supabase: ReturnType<typeof getSupabase>, opts: {
  date: string; description: string; amountCents: number; category: string;
  customerName: string | null; reference: string; notes?: string | null;
}): Promise<FinancialWrite> {
  // The body of this function moved to lib/financialLedger.ts (link 18) so the
  // ADMIN surface can record the cash, Venmo and Zelle money that never goes
  // through Stripe at all. It was private to this route, which is precisely why
  // $2,256 of hand-entered customer payments had no ledger row. The Stripe
  // `source` and the `stripe-` reference prefix stay HERE, because they are what
  // makes this the webhook's own reference space.
  return recordLedgerEntry(supabase, {
    date: opts.date,
    description: opts.description,
    amountCents: opts.amountCents,
    source: 'stripe',
    category: opts.category,
    customerName: opts.customerName,
    reference: `stripe-${opts.reference}`,
    notes: opts.notes || null,
  })
}

/**
 * The booking totals a balance is computed from, or a refusal.
 *
 * Four branches did this inline as `bkRow?.total_cents || 0` over a `.single()`
 * whose error was discarded. A Supabase blip therefore read the booking's total
 * as ZERO, which makes `newBal` zero, which writes `status: 'paid_in_full'` and
 * stamps `paid_in_full_at` over a booking that has been barely paid. The Phase 5
 * review found exactly that shape on the plan path and fixed it there; the
 * non-plan branches kept it. Hard-won rule 12, in its money form.
 */
// Moved to lib/bookingBalance.ts by link 18, unchanged in behaviour, so that
// /api/admin/parties/[id] stops computing a balance its own way — it had the
// pre-link-16 shape (`booking.total_cents || 0` over a discarded read error),
// which marked an UNQUOTED LEAD `paid_in_full` the moment a deposit was
// recorded against it. Hard-won rule 11.
// (No `export {}` here: a Next route file may export only its handler names.)

/**
 * Is this Checkout Session a plan pay-link payment, and if so, deal with it.
 *
 * Returns the response to send, or `null` when the session is not a plan
 * payment and the caller should fall through to its own handlers.
 *
 * Extracted by the Phase 5 review so `checkout.session.completed` and
 * `checkout.session.async_payment_succeeded` cannot drift into only one of them
 * recording a payment — two copies of a money path is the `smsReviewRequest`
 * lesson with a card number attached.
 */
async function handlePlanPaySession(
  req: NextRequest,
  supabase: ReturnType<typeof getSupabase>,
  session: Stripe.Checkout.Session,
): Promise<NextResponse | null> {
  const planMatch = await matchPlanPayLink(session, supabase)
  if (planMatch.outcome === 'error') {
    // Could not tell whether this was a plan payment. A 200 here tells Stripe
    // never to redeliver, which would discard a payment that really happened —
    // so fail and let it come back. (Hard-won rule 12: a lookup that can fail
    // has three outcomes, and "could not tell" is not "no".)
    console.error('Plan pay link match failed:', planMatch.message)
    return NextResponse.json({ error: 'pay link lookup failed' }, { status: 500 })
  }
  if (planMatch.outcome !== 'matched') return null

  const rec = await recordPlanPayment(planMatch.target, session, supabase)
  if (!rec.ok) {
    if (rec.retryable) {
      console.error('Plan payment not recorded, asking Stripe to retry:', rec.message)
      return NextResponse.json({ error: rec.message }, { status: 500 })
    }
    // Not retryable: no such plan, nothing settled, or a payment still pending
    // (the async event above is what brings that one back). Acknowledge so
    // Stripe stops; the error log inside `recordPlanPayment` is the alert.
    console.error('Plan payment could not be recorded and will not be retried:', rec.message)
    return NextResponse.json({ received: true, error: rec.message })
  }

  // Receipts only on a genuine first record — a redelivery must not email the
  // customer a second time.
  if (!rec.duplicate) {
    const { data: bk } = await supabase
      .from('bookings')
      .select('contact_name, contact_email')
      .eq('booking_ref', rec.bookingRef)
      .maybeSingle()
    const origin = publicOrigin(req)
    const isLocal = isLocalRequest(req)
    await sendPlanPaymentReceipt({
      bookingRef: rec.bookingRef,
      customerName: bk?.contact_name ?? null,
      customerEmail: bk?.contact_email ?? null,
      amountCents: rec.amountCents,
      tipCents: Math.max(0, Math.min(planMatch.target.tipCents, session.amount_total ?? 0)),
      feeCents: Math.max(0, Math.min(planMatch.target.feeCents, session.amount_total ?? 0)),
      newBalanceCents: rec.newBalanceCents,
      purpose: planMatch.target.purpose,
      invoiceUrl: `${origin}/my-booking?ref=${encodeURIComponent(rec.bookingRef)}`,
      // Named in Adam's copy only, and only when it is non-zero.
      overpaidCents: rec.overpaidCents,
    })
  }
  return NextResponse.json({ received: true, duplicate: rec.duplicate })
}

export async function POST(req: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!
  const supabase = getSupabase()

  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Signature verification failed'
    console.error('Webhook signature error:', message)
    return NextResponse.json({ error: message }, { status: 400 })
  }

  // ── Payment Intent succeeded (in-page Payment Element flow) ──
  // This fires for the planner deposit + additional payment flows that were
  // migrated off Checkout Session. Event tickets, gift cards, vendor regs,
  // and pay-links still use Checkout, so we fall through to the Checkout
  // handler below for those.
  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent
    const m = pi.metadata || {}

    // ── Studio Rental deposit (in-page Payment Element) ──────────
    if (m.type === 'studio_rental') {
      const bookingRef = m.booking_ref
      const bookingId = m.booking_id
      const depositCents = parseInt(m.depositCents || '0', 10)
      const cardFeeCents = parseInt(m.cardFeeCents || '0', 10)
      const totalCharged = pi.amount

      // Record payment (confirm-session may have raced; duplicate PI fails silently)
      const { error: payErr } = await supabase.from('booking_payments').insert({
        booking_id: bookingId,
        payment_type: 'deposit',
        payment_method: 'card',
        amount_cents: depositCents,
        card_fee_cents: cardFeeCents,
        total_charged_cents: totalCharged,
        stripe_payment_intent_id: pi.id,
        stripe_session_id: null,
        recorded_by: 'system',
      })
      const alreadyRecorded = isUniqueViolation(payErr)
      if (payErr && !alreadyRecorded) {
        // A payment we could not record is a payment that is about to be
        // invisible. 500 so Stripe redelivers; the unique index makes the retry
        // safe (rule 19).
        console.error('Studio rental PI payment insert error:', payErr.message, '— asking Stripe to retry')
        return NextResponse.json({ error: payErr.message }, { status: 500 })
      }

      // Recalc balance + status. A FAILED read must not become a balance: reading
      // the total as 0 writes `paid_in_full` over a booking that has paid a
      // deposit. Ask Stripe to come back instead (rule 12).
      const inputs = await readBalanceInputs(
        supabase,
        bookingId,
        'total_cents, party_tags, contact_name, contact_email, contact_phone, party_date, party_time, package_type, guest_count_approx, agreement_pdf_url',
      )
      if (!inputs.ok) {
        console.error('Studio rental PI: cannot recompute balance —', inputs.message, '— asking Stripe to retry')
        return NextResponse.json({ error: inputs.message }, { status: 500 })
      }
      const paidSum = inputs.paidSum
      const bkRow = inputs.row as {
        total_cents: number | null; party_tags: Record<string, unknown> | null
        contact_name: string | null; contact_email: string | null; contact_phone: string | null
        party_date: string | null; party_time: string | null; package_type: string | null
        guest_count_approx: number | null; agreement_pdf_url: string | null
      }
      // Third copy of the shape link 18 extracted `computeBalance` to kill, and
      // the one my own tripwire found while aimed at the other two: a booking
      // with no total yet makes `(null || 0) - anything` clamp to zero, which
      // this branch reads as `paid_in_full` and stamps `paid_in_full_at` on a
      // studio rental nobody has priced. The arithmetic for a PRICED booking is
      // unchanged — see needs-Adam 41, which is about that arithmetic and is
      // deliberately not settled here.
      const bal = computeBalance(bkRow.total_cents, paidSum)
      const newBal = bal.balanceCents
      const existingTags = bkRow.party_tags || {}

      const updateFields: Record<string, unknown> = {
        balance_due_cents: newBal,
        status: bal.paidInFull ? 'paid_in_full' : 'pending_review',
        party_tags: { ...existingTags, date_locked: true },
      }
      if (bal.paidInFull) updateFields.paid_in_full_at = new Date().toISOString()
      const { error: stuUpdErr } = await supabase.from('bookings').update(updateFields).eq('id', bookingId)
      if (stuUpdErr) {
        console.error('Studio rental PI: booking update failed —', stuUpdErr.message, '— asking Stripe to retry')
        return NextResponse.json({ error: stuUpdErr.message }, { status: 500 })
      }

      // Financials FIRST, because its `(source, reference)` unique index is this
      // branch's idempotency marker — see `FinancialWrite`. `alreadyRecorded`
      // cannot serve: `/api/studio-rental/confirm-session` writes the same
      // `booking_payments` row from the browser and does none of the work below.
      // The reference carries the PaymentIntent id so a second, genuinely
      // different deposit is never mistaken for a redelivery of the first.
      const stuFin = await recordFinancialTransaction(supabase, {
        date: new Date().toISOString().split('T')[0],
        description: `Studio Rental Deposit — ${bkRow?.package_type || 'Studio Rental'}`,
        amountCents: totalCharged,
        category: 'Room Rental',
        customerName: bkRow?.contact_name || m.contactName || null,
        reference: `studio-${bookingRef}-${pi.id}`,
        notes: bkRow?.contact_email || m.contactEmail || null,
      })
      if (stuFin === 'failed') {
        return NextResponse.json({ error: 'financial row not written' }, { status: 500 })
      }
      const stuFirstTime = stuFin === 'written'

      // Audit log
      if (stuFirstTime) {
        const { error: modErr } = await supabase.from('booking_modifications').insert({
          booking_id: bookingId,
          modified_by: 'system',
          change_summary: `Studio rental deposit of ${formatMoney(depositCents)} received via card`,
        })
        if (modErr) console.error('Studio modification log error (non-fatal):', modErr.message)
      }

      // Portal magic link. Minted only when the email that carries it is going to
      // be sent — one booking already holds 15 live tokens (link 14, §1) and a
      // redelivery minting another is pure token sprawl.
      const portalSecret = portalSigningSecret()
      const { token: rawToken, hash, expiresAt } = generatePortalToken(bookingRef, portalSecret)
      if (stuFirstTime) {
        const { error: tokErr } = await supabase.from('portal_tokens').insert({
          booking_id: bookingId,
          token_hash: hash,
          expires_at: expiresAt.toISOString(),
        })
        if (tokErr) {
          // The link in the email about to be sent would not work. Better to
          // retry the whole delivery than to mail a dead magic link.
          console.error('Studio portal token insert failed:', tokErr.message, '— asking Stripe to retry')
          return NextResponse.json({ error: tokErr.message }, { status: 500 })
        }
      }
      const portalUrl = buildPortalUrl(bookingRef, rawToken, '/studio-rental?manage=1')

      const tags = existingTags as Record<string, string>
      const startTime = (tags.rental_start_time as string) || bkRow?.party_time || '12:00'
      const endTime = (tags.rental_end_time as string) || addMinutes(startTime, 180)
      const guestCount = bkRow?.guest_count_approx || 0
      const eventDateFmt = bkRow?.party_date
        ? new Date(bkRow.party_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        : 'TBD'
      const balanceDueFmt = tags.balance_due_date
        ? new Date(tags.balance_due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : 'TBD'
      const fmtTime = (t: string) => {
        const [h, mm] = t.split(':').map(Number)
        const period = h >= 12 ? 'PM' : 'AM'
        const h12 = h % 12 === 0 ? 12 : h % 12
        return `${h12}:${String(mm).padStart(2, '0')} ${period}`
      }

      // Emails (only on a genuine first record, not a webhook/confirm race)
      if (stuFirstTime && process.env.RESEND_API_KEY && bkRow?.contact_email) {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
        const { data: liRows } = await supabase
          .from('booking_line_items')
          .select('name, quantity, unit_price_cents, guest_multiplied')
          .eq('booking_id', bookingId)
          .order('sort_order')
        const emailLineItems = (liRows || []).map(li => ({
          name: li.name,
          quantity: li.quantity,
          unit_price_cents: li.unit_price_cents,
          guest_multiplied: li.guest_multiplied,
          totalCents: li.guest_multiplied
            ? li.unit_price_cents * li.quantity * guestCount
            : li.unit_price_cents * li.quantity,
        }))
        const origin = publicOrigin(req)
        const isLocal = isLocalRequest(req)

        await Promise.allSettled([
          resend.emails.send({
            from, to: bkRow.contact_email,
            subject: `Studio Reserved — ${bookingRef} | Host Hampton`,
            html: studioRentalConfirmationHtml({
              customerName: bkRow.contact_name || 'there',
              bookingRef,
              depositFormatted: formatMoney(depositCents),
              eventDate: eventDateFmt,
              startTime: fmtTime(startTime),
              endTime: fmtTime(endTime),
              guestCount,
              lineItems: emailLineItems,
              totalFormatted: formatMoney(bkRow.total_cents || 0),
              balanceFormatted: formatMoney(newBal),
              balanceDueDate: balanceDueFmt,
              portalUrl,
              agreementUrl: bkRow.agreement_pdf_url || null,
            }),
          }),
          resend.emails.send({
            from, to: ownerEmail(),
            subject: `Studio rental booked: ${bkRow.contact_name} — ${bookingRef}`,
            html: partyAdminNewBookingHtml({
              bookingRef,
              customerName: bkRow.contact_name || '',
              customerEmail: bkRow.contact_email,
              customerPhone: bkRow.contact_phone || undefined,
              partyDate: eventDateFmt,
              partyTime: `${fmtTime(startTime)} – ${fmtTime(endTime)}`,
              guestCount,
              packageType: bkRow.package_type || 'Studio Rental',
              depositFormatted: formatMoney(depositCents),
              totalFormatted: formatMoney(bkRow.total_cents || 0),
              paymentMethod: 'card',
              lineItems: emailLineItems,
              adminUrl: `${origin}/admin?tab=parties&ref=${bookingRef}`,
            }),
          }),
        ])
      }

      // Balance reminder + Google Calendar block over the real rental window
      if (stuFirstTime && bkRow?.party_date && bkRow.contact_email) {
        await enqueuePartyReminders({ contactEmail: bkRow.contact_email, bookingRef, partyDate: bkRow.party_date })
          .catch(err => console.error('Studio reminder enqueue error:', err))
      }
      if (stuFirstTime && bkRow?.party_date) {
        const calEventId = await createCalendarEvent({
          summary: `[STUDIO RENTAL] ${bkRow.contact_name || 'Rental'} — ${tags.event_label || 'Event'}`,
          startDate: bkRow.party_date,
          startTime,
          endTime,
          description: `Ref: ${bookingRef}\nContact: ${bkRow.contact_name || ''} (${bkRow.contact_email || ''})\nGuests: ~${guestCount}${tags.seating_needed ? `\nSeating needed: ${tags.seating_needed}` : ''}\nEvent: ${tags.event_label || ''}`,
        }).catch(err => { console.error('Studio GCal error:', err); return null })
        if (calEventId) {
          console.log('Studio rental GCal event created:', calEventId)
          // Store the event id so later time-edits can update (not duplicate) it.
          await supabase.from('bookings').update({ google_calendar_event_id: calEventId }).eq('id', bookingId)
            .then(({ error }) => { if (error) console.error('Studio GCal id store error (non-fatal):', error) })
        }
      }

      console.log('Studio rental PI processed:', bookingRef, formatMoney(depositCents))
      return NextResponse.json({ received: true })
    }

    if (m.type !== 'party_builder') {
      // Not from the planner — no-op (other event types are handled below)
      return NextResponse.json({ received: true, ignored: 'non-planner PI' })
    }

    const bookingRef = m.booking_ref
    const bookingId = m.booking_id
    const paymentType = (m.payment_type || 'deposit') as 'deposit' | 'partial' | 'final'
    const depositCents = parseInt(m.depositCents || '0', 10)
    const cardFeeCents = parseInt(m.cardFeeCents || '0', 10)
    const tipCents = parseInt(m.tipCents || '0', 10)
    /**
     * Rule 11, and it cost a $0 receipt.
     *
     * The credited figure lived under TWO metadata keys and this branch picked
     * one by payment type. `/api/checkout` writes `depositCents`;
     * `/api/portal/pay` writes `amountCents` and — until 2026-09-13 — nothing
     * else, so a `deposit` from the portal credited `parseInt('' || '0')` and
     * the customer paid for nothing. portal/pay now writes both, but a
     * PaymentIntent created before that deploy may still succeed, so this reads
     * whichever key is present rather than trusting the one it used to.
     *
     * If NEITHER is present the branch must not write a $0 row: the unique
     * `stripe_payment_intent_id` would swallow the corrected redelivery and the
     * money would be permanently invisible (rule 14). Failing asks Stripe to
     * come back and puts the problem in the log where somebody looks.
     */
    const namedAmount = paymentType === 'deposit'
      ? (depositCents || parseInt(m.amountCents || '0', 10))
      : (parseInt(m.amountCents || '0', 10) || depositCents)
    if (!(namedAmount > 0)) {
      console.error(
        `Party builder PI ${pi.id} (${bookingRef}) names no credited amount:`,
        `payment_type=${paymentType} depositCents=${m.depositCents ?? '-'} amountCents=${m.amountCents ?? '-'}`,
        '— refusing to record a $0 payment; asking Stripe to retry',
      )
      return NextResponse.json({ error: 'payment metadata names no amount' }, { status: 500 })
    }
    const amountCents = namedAmount
    const totalCharged = pi.amount

    // Insert payment record. confirm-session may have already inserted; the
    // unique stripe_payment_intent_id constraint fails silently in that case.
    const { error: payErr } = await supabase.from('booking_payments').insert({
      booking_id: bookingId,
      payment_type: paymentType,
      payment_method: 'card',
      amount_cents: amountCents,
      // Migration 058 — the portal has charged tips since long before it, and
      // every one of them lived only in this note. Clamped to the column's
      // CHECK so a corrupted metadata value fails the tip, not the payment.
      tip_cents: Math.max(0, Math.min(100000, Number.isFinite(tipCents) ? tipCents : 0)),
      card_fee_cents: cardFeeCents,
      total_charged_cents: totalCharged,
      stripe_payment_intent_id: pi.id,
      stripe_session_id: null,
      recorded_by: 'system',
      notes: tipCents > 0 ? `Includes ${formatMoney(tipCents)} tip for party helpers` : null,
    })
    const alreadyRecorded = isUniqueViolation(payErr)
    if (payErr && !alreadyRecorded) {
      console.error('Party builder PI payment insert error:', payErr.message, '— asking Stripe to retry')
      return NextResponse.json({ error: payErr.message }, { status: 500 })
    }

    // Recalc balance + status from authoritative payment rows. See
    // `readBalanceInputs`: a failed read used to be read as a zero total, which
    // marks the booking paid in full.
    const inputs = await readBalanceInputs(
      supabase,
      bookingId,
      'total_cents, party_tags, contact_name, contact_email, contact_phone, party_date, party_time, package_type, guest_count_approx',
    )
    if (!inputs.ok) {
      console.error('Party builder PI: cannot recompute balance —', inputs.message, '— asking Stripe to retry')
      return NextResponse.json({ error: inputs.message }, { status: 500 })
    }
    const paidSum = inputs.paidSum
    const bkRow = inputs.row as {
      total_cents: number | null; party_tags: Record<string, unknown> | null
      contact_name: string | null; contact_email: string | null; contact_phone: string | null
      party_date: string | null; party_time: string | null; package_type: string | null
      guest_count_approx: number | null
    }
    /**
     * `Math.max(0, (total_cents || 0) - paidSum)` is the shape link 18 extracted
     * `computeBalance` to kill: a booking with no total yet — every lead — makes
     * `(null || 0) - anything` clamp to 0, which this branch then reads as
     * `paid_in_full`. `computeBalance` tells an unpriced plan from a settled one
     * and is the same function the admin panel now uses (rule 11).
     */
    const bal = computeBalance(bkRow.total_cents, paidSum)
    const newBal = bal.balanceCents
    const existingTags = bkRow.party_tags || {}

    const updateFields: Record<string, unknown> = { balance_due_cents: newBal }
    if (paymentType === 'deposit') {
      updateFields.status = bal.paidInFull ? 'paid_in_full' : 'pending_review'
      updateFields.party_tags = { ...existingTags, date_locked: true }
    } else if (bal.paidInFull) {
      updateFields.status = 'paid_in_full'
    }
    if (bal.paidInFull) updateFields.paid_in_full_at = new Date().toISOString()
    const { error: pbUpdErr } = await supabase.from('bookings').update(updateFields).eq('id', bookingId)
    if (pbUpdErr) {
      console.error('Party builder PI: booking update failed —', pbUpdErr.message, '— asking Stripe to retry')
      return NextResponse.json({ error: pbUpdErr.message }, { status: 500 })
    }

    // Financials FIRST — the unique `(source, reference)` row is this branch's
    // idempotency marker, for the reason given on `FinancialWrite`. The old
    // reference was `pb-<ref>-<type>`, which is the SAME string for a customer's
    // second partial payment: that would have read as a redelivery and silently
    // dropped both the financial row and the receipt. The PaymentIntent id makes
    // it one marker per payment.
    const pbFin = await recordFinancialTransaction(supabase, {
      date: new Date().toISOString().split('T')[0],
      description: paymentType === 'deposit'
        ? `Party Deposit — ${bkRow?.package_type || 'Kids Party'}`
        : `Party ${paymentType === 'final' ? 'Final' : 'Partial'} Payment — ${bookingRef}`,
      amountCents: totalCharged,
      category: 'Party Booking',
      customerName: bkRow?.contact_name || m.contactName || null,
      reference: `pb-${bookingRef}-${paymentType}-${pi.id}`,
      notes: bkRow?.contact_email || m.contactEmail || null,
    })
    if (pbFin === 'failed') {
      return NextResponse.json({ error: 'financial row not written' }, { status: 500 })
    }
    const pbFirstTime = pbFin === 'written'

    // Audit log
    if (pbFirstTime) {
      const { error: modErr } = await supabase.from('booking_modifications').insert({
        booking_id: bookingId,
        modified_by: 'system',
        change_summary: paymentType === 'deposit'
          ? `Deposit of ${formatMoney(amountCents)} received via card`
          : `${paymentType === 'final' ? 'Final' : 'Partial'} payment of ${formatMoney(amountCents)} via card. Balance: ${formatMoney(newBal)}`,
      })
      if (modErr) console.error('Modification log error (non-fatal):', modErr.message)
    }

    // Portal magic link for the receipt email — minted only when that email is
    // going to be sent.
    const portalSecret = portalSigningSecret()
    const { token: rawToken, hash, expiresAt } = generatePortalToken(bookingRef, portalSecret)
    if (pbFirstTime) {
      const { error: tokErr } = await supabase.from('portal_tokens').insert({
        booking_id: bookingId,
        token_hash: hash,
        expires_at: expiresAt.toISOString(),
      })
      if (tokErr) {
        console.error('Portal token insert failed:', tokErr.message, '— asking Stripe to retry')
        return NextResponse.json({ error: tokErr.message }, { status: 500 })
      }
    }
    const portalUrl = buildPortalUrl(bookingRef, rawToken, '/party-planner')

    // Emails — only on a genuine first record.
    //
    // The studio branch forty lines above already guarded on `!alreadyRecorded`
    // and this one did not; it merely did `void alreadyRecorded` to silence the
    // unused-variable warning. Two ideas of "have we already dealt with this
    // payment" in one handler is rule 11, and here it decides whether a customer
    // gets a second receipt, a second reminder and a SECOND Google Calendar
    // entry for the same party — which is exactly what would have happened on
    // the day `payment_intent.succeeded` was finally subscribed, to every
    // payment `/api/party-builder/confirm-session` had already recorded.
    if (pbFirstTime && process.env.RESEND_API_KEY && bkRow?.contact_email) {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
      const partyDateFormatted = bkRow.party_date
        ? new Date(bkRow.party_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        : 'TBD'

      if (paymentType === 'deposit') {
        // Build line items array for the receipt email
        const { data: liRows } = await supabase
          .from('booking_line_items')
          .select('name, quantity, unit_price_cents, guest_multiplied')
          .eq('booking_id', bookingId)
          .order('sort_order')
        const guestCount = bkRow.guest_count_approx || 10
        const emailLineItems = (liRows || []).map(li => ({
          name: li.name,
          quantity: li.quantity,
          unit_price_cents: li.unit_price_cents,
          guest_multiplied: li.guest_multiplied,
          totalCents: li.guest_multiplied
            ? li.unit_price_cents * li.quantity * guestCount
            : li.unit_price_cents * li.quantity,
        }))

        const origin = publicOrigin(req)
        const isLocal = isLocalRequest(req)

        await Promise.allSettled([
          resend.emails.send({
            from, to: bkRow.contact_email,
            subject: `Deposit Received — ${bookingRef} | Host Hampton`,
            html: partyDepositReceivedHtml({
              customerName: bkRow.contact_name || 'there',
              bookingRef,
              depositFormatted: formatMoney(amountCents),
              partyDate: partyDateFormatted,
              portalUrl,
              lineItems: emailLineItems,
              totalFormatted: formatMoney(bkRow.total_cents || 0),
            }),
          }),
          resend.emails.send({
            from, to: ownerEmail(),
            subject: `Deposit paid: ${bkRow.contact_name} — ${bookingRef}`,
            html: partyAdminNewBookingHtml({
              bookingRef,
              customerName: bkRow.contact_name || '',
              customerEmail: bkRow.contact_email,
              customerPhone: bkRow.contact_phone || undefined,
              partyDate: partyDateFormatted,
              partyTime: bkRow.party_time || 'TBD',
              guestCount,
              packageType: bkRow.package_type || 'Kids Party',
              depositFormatted: formatMoney(amountCents),
              totalFormatted: formatMoney(bkRow.total_cents || 0),
              paymentMethod: 'card',
              lineItems: emailLineItems,
              adminUrl: `${origin}/admin?tab=parties&ref=${bookingRef}`,
            }),
          }),
        ])
      } else {
        await resend.emails.send({
          from, to: bkRow.contact_email,
          subject: `Payment Received — ${bookingRef}`,
          html: partyPaymentReceivedHtml({
            customerName: bkRow.contact_name || 'there',
            bookingRef,
            amountFormatted: formatMoney(amountCents),
            paymentMethod: 'card',
            newBalanceFormatted: formatMoney(newBal),
            portalUrl,
          }),
        }).catch(err => console.error('Party payment receipt email error:', err))
      }
    }

    // Enqueue party balance reminders on first deposit
    if (pbFirstTime && paymentType === 'deposit' && bkRow?.party_date && bkRow.contact_email) {
      await enqueuePartyReminders({ contactEmail: bkRow.contact_email, bookingRef, partyDate: bkRow.party_date })
        .catch(err => console.error('Party reminder enqueue error:', err))
    }

    // Write the party to Google Calendar on first deposit. All parties block
    // a 2-hour slot regardless of the booking_type's slot_duration_min
    // (which now controls customer-selectable start times at 1-hour intervals,
    // NOT actual party length).
    if (pbFirstTime && paymentType === 'deposit' && bkRow?.party_date && bkRow.party_time) {
      const endTime = addMinutes(bkRow.party_time, 120)
      const calEventId = await createCalendarEvent({
        summary: `[BOOKING] ${bkRow.contact_name || 'Party'} - ${bkRow.package_type || 'Party'}`,
        startDate: bkRow.party_date,
        startTime: bkRow.party_time,
        endTime,
        description: `Ref: ${bookingRef}\nContact: ${bkRow.contact_name || ''} (${bkRow.contact_email || ''})\nGuests: ~${bkRow.guest_count_approx || ''}`,
      }).catch(err => { console.error('GCal error:', err); return null })
      if (calEventId) {
        console.log('Google Calendar event created:', calEventId)
        // Store it so a later time-edit updates rather than duplicates, the way
        // the studio branch already does.
        const { error: calErr } = await supabase.from('bookings')
          .update({ google_calendar_event_id: calEventId }).eq('id', bookingId)
        if (calErr) console.error('Party builder GCal id store error (non-fatal):', calErr.message)
      }
    }

    console.log(
      'Party builder PI processed:', bookingRef, paymentType, formatMoney(amountCents),
      pbFirstTime ? '| first record' : '| already handled — side effects skipped',
    )
    return NextResponse.json({ received: true })
  }

  // ── A delayed payment that failed ─────────────────────────────
  //
  // Say so, out loud, in the log Adam's alerts come from. Nothing below issued
  // anything for this session (the settlement gate refused it when `completed`
  // arrived `unpaid`), so there is nothing to reverse — but a silent 200 here
  // would make "the customer never paid" indistinguishable from "we never heard"
  // (rule 10).
  if (event.type === 'checkout.session.async_payment_failed') {
    const session = event.data.object as Stripe.Checkout.Session
    console.error(
      `DELAYED STRIPE PAYMENT FAILED: session ${session.id}` +
        ` (${session.metadata?.type || 'no type'}, ${session.amount_total ?? 0}c)` +
        ` — nothing was issued for it.`,
    )
    return NextResponse.json({ received: true, failed: true })
  }

  // ── Money going back OUT ──────────────────────────────────────
  //
  // Every branch above this point is a payment arriving. Until link 21 the
  // handler had no others, and the endpoint was subscribed to none of the
  // events below — so a refund, a chargeback and a declined card were each
  // invisible to this business. The Financials tab overstated revenue by every
  // dollar ever sent back ($312.01 of admin refunds when link 18 measured it),
  // and a chargeback — which has a roughly ten-day evidence deadline and is lost
  // by default — arrived nowhere at all.
  //
  // See `lib/stripeAftermath.ts` for why a refund is a NEGATIVE ledger row keyed
  // on the refund id rather than the charge, and why a dispute moves the books
  // when it CLOSES rather than when it opens.

  // A refund was issued — from the dashboard, the admin panel or the API.
  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge

    // The refund list is fetched rather than read off the payload: a webhook
    // does not reliably expand `charge.refunds`, and "this charge has no
    // refunds" must never be a serialisation artefact read as fact. A failed
    // fetch is a 500 so Stripe comes back (rule 12).
    let refunds: Stripe.Refund[]
    try {
      const list = await stripe.refunds.list({ charge: charge.id, limit: 100 })
      refunds = list.data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'refund list failed'
      console.error(`REFUND NOT RECORDED for charge ${charge.id}: could not list refunds:`, message)
      return NextResponse.json({ error: message }, { status: 500 })
    }

    const result = await recordChargeRefunds(supabase, charge, refunds)
    if (!result.ok) {
      // The books are now wrong and the only fix is a redelivery.
      console.error(`REFUND NOT RECORDED: ${result.message}`)
      return NextResponse.json({ error: result.message }, { status: 500 })
    }

    const freshCents = result.records
      .filter(r => r.outcome === 'written')
      .reduce((sum, r) => sum + r.amountCents, 0)

    // Only on a genuine first record. A redelivery is not a second refund, and
    // this is the same discipline the receipt emails above are under.
    if (result.written > 0) {
      console.log(
        `Stripe refund recorded: charge ${charge.id} — ${result.written} new, ${result.duplicates} already in books`,
      )
      await alertRefundRecorded(freshCents, result.records, charge.id, charge.billing_details?.name ?? null)
    } else {
      console.log(`stripe charge ${charge.id} refunds already in books (${result.duplicates}) — no second alert`)
    }

    return NextResponse.json({ received: true, refunded: true, written: result.written, duplicates: result.duplicates })
  }

  // A customer disputed a charge with their bank. The clock starts now.
  if (event.type === 'charge.dispute.created') {
    const dispute = event.data.object as Stripe.Dispute
    // Nothing is written to the books here: Stripe withdraws the funds when a
    // dispute opens but returns them if we win, and booking every chargeback as
    // a loss would understate revenue by every dispute ever contested. The books
    // move once, on `closed/lost` below.
    await alertDisputeOpened(summarizeDispute(dispute))
    return NextResponse.json({ received: true, dispute: 'opened' })
  }

  // The dispute reached a terminal status.
  if (event.type === 'charge.dispute.closed') {
    const dispute = event.data.object as Stripe.Dispute
    if (!disputeWasLost(dispute)) {
      console.log(`stripe dispute ${dispute.id} closed as ${String(dispute.status)} — no money moved, nothing recorded`)
      return NextResponse.json({ received: true, dispute: String(dispute.status) })
    }
    const outcome = await recordLostDispute(supabase, dispute)
    if (outcome === 'failed') {
      return NextResponse.json({ error: `could not record lost dispute ${dispute.id}` }, { status: 500 })
    }
    console.error(
      `STRIPE DISPUTE LOST: ${dispute.amount}c on dispute ${dispute.id} — recorded as money out (${outcome}).`,
    )
    return NextResponse.json({ received: true, dispute: 'lost', recorded: outcome })
  }

  // A card was declined. No money moved, so nothing reaches the books — but a
  // decline against a KNOWN booking is a customer who may believe they have paid.
  if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object as Stripe.PaymentIntent
    const failed = summarizeFailedPayment(pi)
    // Logged either way; the predicate governs only the email, so an anonymous
    // ticket decline does not train Adam to ignore the category.
    console.error(failedPaymentLogLine(failed))
    if (shouldAlertOnFailedPayment(failed)) await alertPaymentFailed(failed)
    return NextResponse.json({ received: true, paymentFailed: true, alerted: shouldAlertOnFailedPayment(failed) })
  }

  // ── A settled Checkout Session ────────────────────────────────
  //
  // `checkout.session.completed` does NOT mean paid: for a delayed-notification
  // method it fires with `payment_status: 'unpaid'` and the payment can still
  // fail. `checkout.session.async_payment_succeeded` is the event that says one
  // succeeded after all.
  //
  // Both events now run the SAME branches, behind one settlement gate. The old
  // code ran the legacy branches only on `completed` — unguarded, so an unpaid
  // session got its tickets immediately — and dumped a late-settling non-plan
  // payment into the unclaimed net, because re-running the branches would have
  // double-issued. Every branch below now takes a claim, so running them twice is
  // safe and running them once on the RIGHT event is finally possible.
  //
  // Measured on the live account: Klarna, Cash App Pay and Amazon Pay are enabled
  // on ~two thirds of the sessions we create, and they are precisely the methods
  // that complete `unpaid`.
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session
    const m = session.metadata || {}

    const settlement = sessionSettlement(session)
    if (!settlement.settled) {
      console.log(
        `stripe session ${session.id} is not settled (${settlement.reason}) —` +
          ` nothing issued; waiting for checkout.session.async_payment_succeeded`,
      )
      return NextResponse.json({ received: true, settled: false, reason: settlement.reason })
    }

    // ── Plan pay link (Phase 5) ─────────────────────────────────
    //
    // FIRST, ahead of every other branch, because a plan link must never fall
    // through into the legacy `pay_link` handler below: that one records a
    // `financial_transactions` row and no `booking_payments` row, which is the
    // untraceable pay link migration 035 exists to replace. See lib/planPayment.ts.
    const planned = await handlePlanPaySession(req, supabase, session)
    if (planned) return planned

    // ── Has this session already been turned into rows? ─────────
    //
    // One claim, ahead of every legacy branch, because the thing that must not
    // happen twice is not only the INSERT (migration 046's unique indexes cover
    // that) but the second confirmation email, the second inventory decrement,
    // the second `upsertContact` — which mirrors into Brevo and Quo and enrols a
    // sequence — and the second financial row under a freshly generated
    // reference the unique index therefore cannot catch.
    //
    // `bookings` is checked too because the vendor branch and the legacy tail
    // both insert one.
    const ISSUING_TYPES = ['event_ticket', 'event_ticket_multi', 'cart_checkout', 'vendor_registration', 'gift_card']
    let alreadyIssued = false
    if (ISSUING_TYPES.includes(m.type || '') || isLegacyBookingSession(m)) {
      for (const table of ['event_tickets', 'gift_cards', 'bookings'] as const) {
        const claim = await claimBySessionId(supabase, table, session.id)
        if (claim.outcome === 'unavailable') {
          // Not "fresh". Proceeding on an unreadable table risks exactly the
          // double-issue this check exists to prevent (rule 12).
          console.error(`stripe session ${session.id}: cannot read ${table} to check for a redelivery —`, claim.message)
          return NextResponse.json({ error: claim.message }, { status: 500 })
        }
        if (claim.outcome === 'already') {
          console.log(`stripe session ${session.id} already has rows in ${table} — redelivery; side effects suppressed`)
          alreadyIssued = true
        }
      }
    }
    // Deliberately advisory rather than an early return. A delivery that failed
    // HALFWAY through a cart leaves some rows behind, and returning here would
    // strand the rest of the customer's tickets forever. The inserts below are
    // individually idempotent against migration 046's unique indexes, so the
    // retry completes the job; `alreadyIssued` only suppresses the things that
    // must not happen twice — the emails, the financial row, the contact
    // upsert (which mirrors into Brevo and Quo), the reminders.

    // ── Event ticket purchase ──────────────────────────────────
    if (m.type === 'event_ticket') {
      const qty = parseInt(m.quantity || '1', 10)
      // `HH-EVT-${Date.now().slice(-4)}` is a ten-second-wide space against a
      // UNIQUE column, and the loser of a collision used to be emailed
      // "You're in!" for a ticket that did not exist. See `nextTicketRef`.
      const refResult = await nextTicketRef(supabase)
      if (!refResult.ok) {
        console.error('Event ticket: could not allocate a ticket ref —', refResult.message, '— asking Stripe to retry')
        return NextResponse.json({ error: refResult.message }, { status: 500 })
      }
      const ticketRef = refResult.ref

      // Fetch event for details
      const { data: evt, error: evtErr } = await supabase
        .from('events')
        .select('title, event_date, event_time, location')
        .eq('id', m.eventId)
        .maybeSingle()
      if (evtErr) {
        console.error('Event ticket: events read failed —', evtErr.message, '— asking Stripe to retry')
        return NextResponse.json({ error: evtErr.message }, { status: 500 })
      }

      // Determine unit price from session amount
      const totalCents = session.amount_total || 0
      const unitPriceCents = Math.round(totalCents / qty)

      const { error: ticketErr } = await supabase.from('event_tickets').insert({
        ticket_ref: ticketRef,
        event_id: m.eventId,
        session_id: m.sessionId || null,
        customer_name: m.customerName,
        customer_email: m.customerEmail,
        customer_phone: m.customerPhone || null,
        quantity: qty,
        variant_label: m.variantLabel || null,
        unit_price_cents: unitPriceCents,
        total_cents: totalCents,
        stripe_payment_intent_id: session.payment_intent as string,
        stripe_session_id: session.id,
        status: 'confirmed',
      })

      if (ticketErr && !isUniqueViolation(ticketErr)) {
        // The customer paid and has no ticket. A 200 here means Stripe never
        // comes back and the only trace is this line — and the old code went on
        // to email them "You're in!" anyway, naming a ref that was never
        // inserted (rule 10's expensive half).
        console.error('Event ticket insert error:', ticketErr.message, '— asking Stripe to retry')
        return NextResponse.json({ error: ticketErr.message }, { status: 500 })
      }
      const ticketWasNew = !ticketErr
      if (ticketWasNew) {
        // Decrement available tickets, and say so when it refused.
        const dec = await decrementInventory(supabase, m.sessionId ? 'session' : 'event', m.sessionId || m.eventId, qty)
        if (dec.outcome === 'oversold') {
          console.error(`OVERSOLD: ${ticketRef} (${qty}) issued for ${m.sessionId ? 'session' : 'event'} ${m.sessionId || m.eventId} — inventory NOT decremented, it did not have ${qty} left.`)
        } else if (dec.outcome === 'unavailable') {
          console.error(`Ticket ${ticketRef}: inventory decrement failed —`, dec.message, '— stock is now wrong by', qty)
        }
        console.log('Ticket created:', ticketRef, 'for', m.customerEmail)

        // Redeem partial gift card if used
        if (m.giftCardCode && m.giftCardDeductCents) {
          const gcDeduct = parseInt(m.giftCardDeductCents, 10)
          if (gcDeduct > 0) {
            const red = await redeemGiftCard(supabase, m.giftCardCode, gcDeduct)
            if (red.outcome === 'redeemed') {
              console.log(`Gift card ${m.giftCardCode} redeemed ${red.redeemedCents}c via webhook. New balance: ${red.newBalanceCents}c (${red.status})`)
            } else if (red.outcome === 'no_active_card') {
              console.error(`GIFT CARD NOT REDEEMED: ${m.giftCardCode} has no ACTIVE row — ${gcDeduct}c of discount was given on ${ticketRef} and not deducted.`)
            } else {
              console.error(`GIFT CARD NOT REDEEMED: ${m.giftCardCode} — ${red.message}. ${gcDeduct}c of discount was given on ${ticketRef} and not deducted.`)
            }
          }
        }

        // Record in financials
        await recordFinancialTransaction(supabase, {
          date: new Date().toISOString().split('T')[0],
          description: evt?.title || 'Event Ticket',
          amountCents: totalCents,
          category: 'Event Ticket',
          customerName: m.customerName,
          reference: `tk-${ticketRef}`,
          notes: m.customerEmail,
        })

        // Upsert contact (non-fatal)
        const contactId = await upsertContact({
          name: m.customerName,
          email: m.customerEmail,
          phone: m.customerPhone,
          sourceDetail: `Event ticket — ${evt?.title || 'event'}`,
          serviceInterests: ['event'],
          marketingConsent: m.marketingConsent === 'true',
        })

        // Enroll in post-booking sequence (non-fatal)
        if (contactId) {
          await enrollInSequence({
            contactId,
            contactEmail: m.customerEmail,
            triggerEvent: 'booking_confirmed',
            serviceType: 'event',
          }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
        }

        // Enqueue reminders (non-fatal)
        if (evt?.event_date) {
          await enqueueEventReminders({
            contactEmail: m.customerEmail,
            eventId: m.eventId,
            eventDate: evt.event_date,
            eventTime: evt.event_time || undefined,
          }).catch(err => console.error('Reminder enqueue error:', err))

          await enqueueReviewRequest({
            contactEmail: m.customerEmail,
            referenceType: 'event',
            referenceId: m.eventId,
            eventDate: evt.event_date,
          }).catch(err => console.error('Review request enqueue error:', err))
        }
      }

      // Send emails — only over a ticket that actually exists.
      //
      // This block used to sit OUTSIDE the insert's `else`, so a refused insert
      // (a `ticket_ref` collision, then; a redelivery, now) still told the
      // customer "You're in!" and quoted them a reference that was never written.
      if (ticketWasNew && !alreadyIssued && process.env.RESEND_API_KEY && evt) {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
        const totalFormatted = `$${(totalCents / 100).toFixed(2)}`

        // If this ticket is for a specific session, use the session date/time
        let dateDisplay = evt.event_date
          ? new Date(evt.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
          : 'TBD'
        let timeDisplay = evt.event_time || ''

        if (m.sessionId) {
          const { data: sess } = await supabase
            .from('event_sessions')
            .select('session_date, session_time, label')
            .eq('id', m.sessionId)
            .single()
          if (sess?.session_date) {
            dateDisplay = new Date(sess.session_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
            if (sess.label) dateDisplay += ` — ${sess.label}`
          }
          if (sess?.session_time) timeDisplay = sess.session_time
        }

        await Promise.allSettled([
          resend.emails.send({
            from, to: m.customerEmail,
            subject: `You're in! ${evt.title} at Host Hampton 🎉`,
            html: ticketConfirmationHtml({
              customerName: m.customerName, eventTitle: evt.title, eventDate: dateDisplay,
              eventTime: timeDisplay, location: evt.location, quantity: qty,
              variantLabel: m.variantLabel || undefined, totalFormatted, ticketRef, isFree: false,
            }),
          }),
          resend.emails.send({
            from, to: ownerEmail(),
            subject: `New ticket: ${m.customerName} — ${evt.title} (${ticketRef})`,
            html: ticketPurchaseNotifyHtml({
              ticketRef, customerName: m.customerName, customerEmail: m.customerEmail,
              customerPhone: m.customerPhone || undefined, eventTitle: evt.title,
              eventDate: dateDisplay, eventTime: timeDisplay, quantity: qty,
              variantLabel: m.variantLabel || undefined, totalFormatted, isFree: false,
              stripePI: session.payment_intent as string,
            }),
          }),
        ])
        console.log('Ticket confirmation sent to', m.customerEmail)
      }

      // Say which it was. `{received: true}` for both a fresh issue and a
      // suppressed redelivery is the shape rule 10 warns about: the caller
      // cannot tell "I did the work" from "I deliberately did nothing".
      if (!ticketWasNew || alreadyIssued) {
        console.log('Event ticket for session', session.id, 'already issued — nothing repeated')
        return NextResponse.json({ received: true, duplicate: true })
      }
      return NextResponse.json({ received: true, ticketRef })
    }

    // ── Multi-session event ticket purchase ──────────────────
    if (m.type === 'event_ticket_multi') {
      // A bare `JSON.parse` on attacker-shaped metadata throws out of the
      // handler, which Stripe reads as a 500 and retries until it gives up —
      // the failure mode that lost $927.
      const parsedIds = parseJsonMetadata<string[]>(m.sessionIds, 'sessionIds')
      if (!parsedIds.ok) {
        console.error('Multi-session ticket:', parsedIds.message, '— cannot issue; recording as unclaimed')
        const un = await recordUnclaimedStripeSession(session, supabase)
        return NextResponse.json({ received: true, unclaimed: true, recorded: un.recorded, reason: parsedIds.message })
      }
      const sessionIds = parsedIds.value
      const qty = parseInt(m.quantity || '1', 10)
      const unitPriceCents = parseInt(m.unitPriceCents || '0', 10)
      const groupRef = `GRP-${Date.now()}`

      const { data: evt, error: evtErr } = await supabase
        .from('events')
        .select('title, event_time, location')
        .eq('id', m.eventId)
        .maybeSingle()
      if (evtErr) {
        console.error('Multi-session ticket: events read failed —', evtErr.message, '— asking Stripe to retry')
        return NextResponse.json({ error: evtErr.message }, { status: 500 })
      }

      const { data: sessionsData, error: sessErr } = await supabase
        .from('event_sessions')
        .select('id, session_date, session_time, label')
        .in('id', sessionIds)
        .order('session_date', { ascending: true })
      // A failed read here used to leave the loop with nothing to iterate, so
      // ZERO tickets were inserted while the financial row, the contact upsert
      // and both confirmation emails all went ahead — the customer paid for a
      // bundle and received a receipt for tickets that do not exist.
      if (sessErr) {
        console.error('Multi-session ticket: event_sessions read failed —', sessErr.message, '— asking Stripe to retry')
        return NextResponse.json({ error: sessErr.message }, { status: 500 })
      }
      if (!sessionsData || sessionsData.length === 0) {
        console.error(`Multi-session ticket: none of the ${sessionIds.length} session id(s) in metadata exist — recording as unclaimed rather than emailing a receipt for nothing`)
        const un = await recordUnclaimedStripeSession(session, supabase)
        return NextResponse.json({ received: true, unclaimed: true, recorded: un.recorded, reason: 'no matching event_sessions' })
      }

      const ticketRefs: string[] = []
      for (const sess of sessionsData) {
        const ref = await nextTicketRef(supabase, sess.id)
        if (!ref.ok) {
          console.error('Multi-session ticket: could not allocate a ref —', ref.message, '— asking Stripe to retry')
          return NextResponse.json({ error: ref.message }, { status: 500 })
        }
        const ticketRef = ref.ref
        ticketRefs.push(ticketRef)

        const { error: ticketErr } = await supabase.from('event_tickets').insert({
          ticket_ref: ticketRef,
          event_id: m.eventId,
          session_id: sess.id,
          group_ref: groupRef,
          customer_name: m.customerName,
          customer_email: m.customerEmail,
          customer_phone: m.customerPhone || null,
          quantity: qty,
          variant_label: m.variantLabel || null,
          unit_price_cents: unitPriceCents,
          total_cents: unitPriceCents * qty,
          stripe_payment_intent_id: session.payment_intent as string,
          stripe_session_id: session.id,
          status: 'confirmed',
        })

        if (ticketErr && !isUniqueViolation(ticketErr)) {
          console.error('Multi-session ticket insert error:', ticketErr.message, '— asking Stripe to retry')
          return NextResponse.json({ error: ticketErr.message }, { status: 500 })
        }
        if (ticketErr) continue   // this line of the bundle already exists
        const dec = await decrementInventory(supabase, 'session', sess.id, qty)
        if (dec.outcome === 'oversold') {
          console.error(`OVERSOLD: ${ticketRef} (${qty}) issued for session ${sess.id} — inventory NOT decremented.`)
        } else if (dec.outcome === 'unavailable') {
          console.error(`Ticket ${ticketRef}: inventory decrement failed —`, dec.message)
        }
      }

      console.log('Multi-session tickets created:', groupRef, ticketRefs.length, 'sessions for', m.customerEmail)

      if (alreadyIssued) {
        console.log('Multi-session bundle was a redelivery — no financial row, contact upsert, reminders or emails repeated')
        return NextResponse.json({ received: true, duplicate: true })
      }

      // Record in financials (non-fatal)
      const multiTotalCents = session.amount_total || 0
      await recordFinancialTransaction(supabase, {
        date: new Date().toISOString().split('T')[0],
        description: `${evt?.title || 'Event'} (${sessionIds.length} sessions)`,
        amountCents: multiTotalCents,
        category: 'Event Ticket',
        customerName: m.customerName,
        reference: `tk-${groupRef}`,
        notes: m.customerEmail,
      })

      // Upsert contact (non-fatal)
      const contactId = await upsertContact({
        name: m.customerName,
        email: m.customerEmail,
        phone: m.customerPhone,
        sourceDetail: `Event ticket — ${evt?.title || 'event'} (series)`,
        serviceInterests: ['event'],
        marketingConsent: m.marketingConsent === 'true',
      })

      // Enroll in post-booking sequence (non-fatal)
      if (contactId) {
        await enrollInSequence({
          contactId,
          contactEmail: m.customerEmail,
          triggerEvent: 'booking_confirmed',
          serviceType: 'event',
        }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
      }

      // Enqueue reminders for each session date (non-fatal)
      for (const sess of (sessionsData || [])) {
        if (sess.session_date) {
          await enqueueEventReminders({
            contactEmail: m.customerEmail,
            eventId: m.eventId,
            eventDate: sess.session_date,
            eventTime: sess.session_time || undefined,
          }).catch(err => console.error('Reminder enqueue error:', err))
        }
      }

      // Review request after last session (non-fatal)
      const lastSession = sessionsData?.[sessionsData.length - 1]
      if (lastSession?.session_date) {
        await enqueueReviewRequest({
          contactEmail: m.customerEmail,
          referenceType: 'event',
          referenceId: m.eventId,
          eventDate: lastSession.session_date,
        }).catch(err => console.error('Review request enqueue error:', err))
      }

      // Send emails
      if (process.env.RESEND_API_KEY && evt) {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
        const totalCents = session.amount_total || 0
        const totalFormatted = `$${(totalCents / 100).toFixed(2)}`

        // Build structured sessions array for email templates
        const emailSessions = (sessionsData || []).map(s => ({
          date: new Date(s.session_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
          time: s.session_time || '',
          label: s.label || undefined,
        }))

        await Promise.allSettled([
          resend.emails.send({
            from, to: m.customerEmail,
            subject: `You're in! ${evt.title} at Host Hampton`,
            html: ticketConfirmationHtml({
              customerName: m.customerName, eventTitle: evt.title,
              eventDate: `${sessionIds.length} sessions`,
              eventTime: '',
              location: evt.location, quantity: qty,
              variantLabel: m.variantLabel || undefined,
              totalFormatted, ticketRef: groupRef, isFree: false,
              sessions: emailSessions,
            }),
          }),
          resend.emails.send({
            from, to: ownerEmail(),
            subject: `New ticket: ${m.customerName} — ${evt.title} (${sessionIds.length} sessions, ${groupRef})`,
            html: ticketPurchaseNotifyHtml({
              ticketRef: groupRef, customerName: m.customerName,
              customerEmail: m.customerEmail,
              customerPhone: m.customerPhone || undefined,
              eventTitle: evt.title,
              eventDate: `${sessionIds.length} sessions`,
              eventTime: '', quantity: qty,
              variantLabel: m.variantLabel || undefined,
              totalFormatted, isFree: false,
              stripePI: session.payment_intent as string,
              sessions: emailSessions,
            }),
          }),
        ])
        console.log('Multi-session confirmation sent to', m.customerEmail)
      }

      return NextResponse.json({ received: true })
    }

    // ── Cart checkout (multiple events in one purchase) ────────
    if (m.type === 'cart_checkout') {
      type CartLine = {
        eventId: string
        sessionId?: string
        sessionIds?: string[]
        quantity: number
        variantLabel?: string
        unitPriceCents: number
        eventTitle: string
      }
      // `/api/cart-checkout` now writes a COMPACT form (one-letter keys) so that
      // ten items fit inside Stripe's 500-character metadata limit. Sessions
      // created before that deploy carry the long form and are still payable, so
      // both are read here.
      type CompactLine = { e: string; s?: string; S?: string[]; q: number; v?: string; p: number; t: string }
      const widen = (raw: (CartLine | CompactLine)[]): CartLine[] =>
        raw.map(r => ('e' in r
          ? { eventId: r.e, sessionId: r.s, sessionIds: r.S, quantity: r.q, variantLabel: r.v, unitPriceCents: r.p, eventTitle: r.t }
          : r))
      const parsedCart = parseJsonMetadata<(CartLine | CompactLine)[]>(m.cartItems, 'cartItems')
      if (!parsedCart.ok) {
        // Stripe caps a metadata VALUE at 500 characters (measured: 500 accepted,
        // 600 refused). A truncated or malformed cart used to throw straight out
        // of the handler as a 500.
        console.error('Cart checkout:', parsedCart.message, '— cannot issue; recording as unclaimed')
        const un = await recordUnclaimedStripeSession(session, supabase)
        return NextResponse.json({ received: true, unclaimed: true, recorded: un.recorded, reason: parsedCart.message })
      }
      const cartItems = widen(parsedCart.value)
      if (!cartItems.length) {
        console.error('Cart checkout: metadata.cartItems is empty — recording as unclaimed rather than emailing a receipt for nothing')
        const un = await recordUnclaimedStripeSession(session, supabase)
        return NextResponse.json({ received: true, unclaimed: true, recorded: un.recorded, reason: 'empty cart metadata' })
      }
      const cartRef = `CART-${Date.now()}`
      const ticketRefs: string[] = []
      const eventTitles: string[] = []

      for (const ci of cartItems) {
        const qty = ci.quantity

        if (ci.sessionIds?.length) {
          // Multi-session item
          for (const sid of ci.sessionIds) {
            const ref = await nextTicketRef(supabase, sid)
            if (!ref.ok) {
              console.error('Cart ticket: could not allocate a ref —', ref.message, '— asking Stripe to retry')
              return NextResponse.json({ error: ref.message }, { status: 500 })
            }
            const ticketRef = ref.ref
            ticketRefs.push(ticketRef)

            const { error: ticketErr } = await supabase.from('event_tickets').insert({
              ticket_ref: ticketRef,
              event_id: ci.eventId,
              session_id: sid,
              group_ref: cartRef,
              customer_name: m.customerName,
              customer_email: m.customerEmail,
              customer_phone: m.customerPhone || null,
              quantity: qty,
              variant_label: ci.variantLabel || null,
              unit_price_cents: ci.unitPriceCents,
              total_cents: ci.unitPriceCents * qty,
              stripe_payment_intent_id: session.payment_intent as string,
              stripe_session_id: session.id,
              status: 'confirmed',
            })

            if (ticketErr && !isUniqueViolation(ticketErr)) {
              console.error('Cart ticket insert error:', ticketErr.message, '— asking Stripe to retry')
              return NextResponse.json({ error: ticketErr.message }, { status: 500 })
            }
            if (ticketErr) continue
            const dec = await decrementInventory(supabase, 'session', sid, qty)
            if (dec.outcome === 'oversold') console.error(`OVERSOLD: ${ticketRef} (${qty}) issued for session ${sid} — inventory NOT decremented.`)
            else if (dec.outcome === 'unavailable') console.error(`Ticket ${ticketRef}: inventory decrement failed —`, dec.message)
          }
        } else {
          // Single session or no session.
          //
          // The old ref was `HH-EVT-${Date.now().slice(-4)}-${eventId.slice(0,4)}`,
          // computed inside a tight loop: two cart lines for the SAME event in one
          // request land on the same millisecond and produce the SAME ref against
          // a UNIQUE column, so the second line was silently refused.
          const ref = await nextTicketRef(supabase, ci.eventId)
          if (!ref.ok) {
            console.error('Cart ticket: could not allocate a ref —', ref.message, '— asking Stripe to retry')
            return NextResponse.json({ error: ref.message }, { status: 500 })
          }
          const ticketRef = ref.ref
          ticketRefs.push(ticketRef)

          const { error: ticketErr } = await supabase.from('event_tickets').insert({
            ticket_ref: ticketRef,
            event_id: ci.eventId,
            session_id: ci.sessionId || null,
            group_ref: cartRef,
            customer_name: m.customerName,
            customer_email: m.customerEmail,
            customer_phone: m.customerPhone || null,
            quantity: qty,
            variant_label: ci.variantLabel || null,
            unit_price_cents: ci.unitPriceCents,
            total_cents: ci.unitPriceCents * qty,
            stripe_payment_intent_id: session.payment_intent as string,
            stripe_session_id: session.id,
            status: 'confirmed',
          })

          if (ticketErr && !isUniqueViolation(ticketErr)) {
            console.error('Cart ticket insert error:', ticketErr.message, '— asking Stripe to retry')
            return NextResponse.json({ error: ticketErr.message }, { status: 500 })
          }
          if (!ticketErr) {
            const dec = await decrementInventory(supabase, ci.sessionId ? 'session' : 'event', ci.sessionId || ci.eventId, qty)
            if (dec.outcome === 'oversold') console.error(`OVERSOLD: ${ticketRef} (${qty}) issued for ${ci.sessionId ? 'session' : 'event'} ${ci.sessionId || ci.eventId} — inventory NOT decremented.`)
            else if (dec.outcome === 'unavailable') console.error(`Ticket ${ticketRef}: inventory decrement failed —`, dec.message)
          }
        }
        if (!eventTitles.includes(ci.eventTitle)) eventTitles.push(ci.eventTitle)
      }

      console.log('Cart checkout processed:', cartRef, ticketRefs.length, 'tickets for', m.customerEmail)

      if (alreadyIssued) {
        console.log('Cart was a redelivery — no financial row, contact upsert, reminders or emails repeated')
        return NextResponse.json({ received: true, duplicate: true })
      }

      // Record in financials (non-fatal)
      const cartTotalCents = session.amount_total || 0
      await recordFinancialTransaction(supabase, {
        date: new Date().toISOString().split('T')[0],
        description: eventTitles.join(' + '),
        amountCents: cartTotalCents,
        category: 'Event Ticket',
        customerName: m.customerName,
        reference: `tk-${cartRef}`,
        notes: m.customerEmail,
      })

      // Upsert contact
      const contactId = await upsertContact({
        name: m.customerName,
        email: m.customerEmail,
        phone: m.customerPhone,
        sourceDetail: `Cart checkout — ${eventTitles.join(', ')}`,
        serviceInterests: ['event'],
        marketingConsent: m.marketingConsent === 'true',
      })

      // Enroll in post-booking sequence (non-fatal)
      if (contactId) {
        await enrollInSequence({
          contactId,
          contactEmail: m.customerEmail,
          triggerEvent: 'booking_confirmed',
          serviceType: 'event',
        }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
      }

      // Enqueue reminders per event (non-fatal)
      for (const ci of cartItems) {
        // Fetch event_date for each cart item
        const { data: ciEvt } = await supabase
          .from('events')
          .select('event_date, event_time')
          .eq('id', ci.eventId)
          .single()

        if (ciEvt?.event_date) {
          await enqueueEventReminders({
            contactEmail: m.customerEmail,
            eventId: ci.eventId,
            eventDate: ciEvt.event_date,
            eventTime: ciEvt.event_time || undefined,
          }).catch(err => console.error('Cart reminder enqueue error:', err))

          await enqueueReviewRequest({
            contactEmail: m.customerEmail,
            referenceType: 'event',
            referenceId: ci.eventId,
            eventDate: ciEvt.event_date,
          }).catch(err => console.error('Cart review request error:', err))
        }
      }

      // Send confirmation emails
      if (process.env.RESEND_API_KEY) {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
        const totalCents = session.amount_total || 0
        const totalFormatted = `$${(totalCents / 100).toFixed(2)}`

        // Calculate actual total ticket quantity (sum of qty per cart item)
        const totalQty = cartItems.reduce((sum, ci) => sum + ci.quantity, 0)

        // Build structured sessions for each cart item (fetch session dates)
        const emailSessions: { date: string; time: string; label?: string }[] = []
        let cartEventDate = ''

        for (const ci of cartItems) {
          if (ci.sessionIds?.length) {
            const { data: sessData } = await supabase
              .from('event_sessions')
              .select('session_date, session_time, label')
              .in('id', ci.sessionIds)
              .order('session_date', { ascending: true })
            for (const s of (sessData || [])) {
              emailSessions.push({
                date: new Date(s.session_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
                time: s.session_time || '',
                label: s.label || undefined,
              })
            }
          } else if (ci.sessionId) {
            const { data: sess } = await supabase
              .from('event_sessions')
              .select('session_date, session_time, label')
              .eq('id', ci.sessionId)
              .single()
            if (sess) {
              emailSessions.push({
                date: new Date(sess.session_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
                time: sess.session_time || '',
                label: sess.label || undefined,
              })
            }
          } else {
            // No session — use event date
            const { data: ciEvt } = await supabase
              .from('events')
              .select('event_date, event_time')
              .eq('id', ci.eventId)
              .single()
            if (ciEvt?.event_date) {
              cartEventDate = new Date(ciEvt.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
            }
          }
        }

        // Determine date display
        const hasMultipleSessions = emailSessions.length > 1
        const dateDisplay = hasMultipleSessions
          ? `${emailSessions.length} sessions`
          : emailSessions.length === 1
            ? emailSessions[0].date
            : cartEventDate || 'TBD'
        const timeDisplay = emailSessions.length === 1 ? emailSessions[0].time : ''

        await Promise.allSettled([
          resend.emails.send({
            from, to: m.customerEmail,
            subject: `You're in! ${eventTitles.length} event${eventTitles.length > 1 ? 's' : ''} at Host Hampton`,
            html: ticketConfirmationHtml({
              customerName: m.customerName,
              eventTitle: eventTitles.join(' + '),
              eventDate: dateDisplay,
              eventTime: timeDisplay,
              location: 'Host Hampton',
              quantity: totalQty,
              totalFormatted,
              ticketRef: cartRef,
              isFree: false,
              sessions: hasMultipleSessions ? emailSessions : undefined,
            }),
          }),
          resend.emails.send({
            from, to: ownerEmail(),
            subject: `New cart order: ${m.customerName} — ${eventTitles.join(', ')} (${cartRef})`,
            html: ticketPurchaseNotifyHtml({
              ticketRef: cartRef,
              customerName: m.customerName,
              customerEmail: m.customerEmail,
              customerPhone: m.customerPhone || undefined,
              eventTitle: eventTitles.join(' + '),
              eventDate: dateDisplay,
              eventTime: timeDisplay,
              quantity: totalQty,
              totalFormatted,
              isFree: false,
              stripePI: session.payment_intent as string,
              sessions: hasMultipleSessions ? emailSessions : undefined,
            }),
          }),
        ])
        console.log('Cart confirmation sent to', m.customerEmail)
      }

      return NextResponse.json({ received: true })
    }

    // ── Market vendor booth ────────────────────────────────────
    //
    // Unlike every other branch in this file, this one does NOT insert. The row
    // was written by /api/christmas-market/vendor before the vendor ever
    // reached Stripe, precisely so that an abandoned checkout still leaves the
    // vendor's details behind. All that happens here is settlement: pending →
    // paid.
    //
    // The idempotency signal is therefore `paid_at`, not `claimBySessionId` —
    // the row exists on the first delivery as well as the second, so "does a
    // row exist" cannot distinguish them. Migration 059's CHECK keeps `paid_at`
    // and `status` honest about each other.
    if (m.type === 'market_vendor') {
      const market = resolveMarket(m.marketSlug)
      if (!market) {
        // A session naming a market we have no registry entry for. Rule 14 —
        // this belongs in front of a human, not silently dropped.
        console.error(`market vendor: session ${session.id} names unknown market "${m.marketSlug}"`)
        return NextResponse.json({ error: 'unknown market' }, { status: 500 })
      }

      // Two ways home: the row id from metadata, and the session id the route
      // wrote back. The second exists because attaching the session is the one
      // step in the route that is allowed to fail non-fatally.
      const lookup = supabase.from('market_vendors').select('id, vendor_ref, business_name, contact_name, email, phone, ig_handle, product_category, total_cents, status, paid_at')
      const { data: vendorRows, error: vendorErr } = m.vendorId
        ? await lookup.eq('id', m.vendorId).limit(1)
        : await lookup.eq('stripe_session_id', session.id).limit(1)

      if (vendorErr) {
        console.error('market vendor: cannot read the registration —', vendorErr.message, '— asking Stripe to retry')
        return NextResponse.json({ error: vendorErr.message }, { status: 500 })
      }

      const vendor = vendorRows?.[0]
      if (!vendor) {
        // Money arrived for a registration that is not in the table. Do not
        // invent one — that is how a $250 payment ended up in no table at all
        // (link 22). Let it fall into the unclaimed net where a human sees it.
        console.error(`market vendor: paid session ${session.id} matches no market_vendors row`)
        return NextResponse.json({ error: 'no matching vendor registration' }, { status: 500 })
      }

      if (vendor.paid_at) {
        console.log(`market vendor ${vendor.vendor_ref} is already paid — redelivery of ${session.id}, nothing re-issued`)
        return NextResponse.json({ received: true, duplicate: true })
      }

      const { error: payErr } = await supabase
        .from('market_vendors')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          stripe_session_id: session.id,
          stripe_payment_intent_id: (session.payment_intent as string) || null,
        })
        .eq('id', vendor.id)
        // Only settle a row that has not been settled. Two concurrent
        // redeliveries cannot both win this.
        .is('paid_at', null)

      if (payErr) {
        console.error(`market vendor ${vendor.vendor_ref}: could not mark paid —`, payErr.message, '— asking Stripe to retry')
        return NextResponse.json({ error: payErr.message }, { status: 500 })
      }

      console.log('Market vendor paid:', vendor.vendor_ref, vendor.business_name)

      await recordFinancialTransaction(supabase, {
        date: new Date().toISOString().split('T')[0],
        description: `${market.shortName} vendor booth — ${vendor.business_name}`,
        amountCents: vendor.total_cents,
        category: 'Vendor Fee',
        customerName: vendor.contact_name,
        reference: `mv-${vendor.vendor_ref}`,
        notes: vendor.email,
      })

      // A vendor is a local business owner who just paid us — a real contact,
      // and a genuinely good audience for next year's market. `sourceDetail`
      // names the market so this stays legible when there are three of them.
      await upsertContact({
        name: vendor.contact_name,
        email: vendor.email,
        phone: vendor.phone || undefined,
        sourceDetail: `Vendor — ${market.name} (${vendor.business_name})`,
        serviceInterests: ['general'],
        marketingConsent: true,
      }).catch(err => console.error('market vendor contact upsert (non-fatal):', err))

      if (process.env.RESEND_API_KEY) {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
        const money = `$${(vendor.total_cents / 100).toFixed(2)}`

        await Promise.allSettled([
          resend.emails.send({
            from,
            to: vendor.email,
            subject: `You're in — ${market.shortName}, ${market.dateLabel}`,
            html: marketVendorConfirmationHtml({
              firstName: vendor.contact_name?.split(' ')[0] || 'there',
              businessName: vendor.business_name,
              vendorRef: vendor.vendor_ref,
              money,
              marketName: market.name,
              dateLabel: market.dateLabel,
              timeLabel: market.timeLabel,
              locationLine: market.locationLine,
            }),
          }),
          resend.emails.send({
            from,
            to: ownerEmail(),
            subject: `New ${market.shortName} vendor — ${vendor.business_name} (${money})`,
            html: marketVendorOwnerHtml({
              vendorRef: vendor.vendor_ref,
              contactName: vendor.contact_name,
              businessName: vendor.business_name,
              igHandle: vendor.ig_handle,
              email: vendor.email,
              phone: vendor.phone,
              productCategory: vendor.product_category,
              money,
              marketName: market.name,
            }),
          }),
        ])
      }

      return NextResponse.json({ received: true })
    }

    // ── Vendor event registration ──────────────────────────────
    if (m.type === 'vendor_registration') {
      const vendorRef = `HH-VND-${Date.now().toString().slice(-4)}`
      const today = new Date().toISOString().split('T')[0]

      const { error: dbError } = await supabase.from('bookings').insert({
        booking_ref: vendorRef,
        status: 'confirmed',
        event_type: 'vendor_registration',
        party_date: today,
        party_time: 'TBD',
        package_type: 'Spring Market Vendor',
        contact_name: m.contactName,
        contact_email: m.contactEmail,
        contact_phone: m.contactPhone || null,
        deposit_amount: 4635,
        stripe_payment_intent_id: session.payment_intent as string,
        stripe_session_id: session.id,
        party_tags: {},
        notes: JSON.stringify({ businessName: m.businessName, igHandle: m.igHandle }),
      })

      if (dbError && !isUniqueViolation(dbError)) {
        // Same shape as the tickets: the old code logged this and carried on to
        // email "You're registered!" over a row that does not exist.
        console.error('Vendor registration insert error:', dbError.message, '— asking Stripe to retry')
        return NextResponse.json({ error: dbError.message }, { status: 500 })
      }
      if (dbError || alreadyIssued) {
        console.log('Vendor registration was a redelivery — nothing re-issued for', session.id)
        return NextResponse.json({ received: true, duplicate: true })
      }
      console.log('Vendor registration created:', vendorRef, m.businessName, m.contactEmail)

      // Record in financials (non-fatal)
      await recordFinancialTransaction(supabase, {
        date: new Date().toISOString().split('T')[0],
        description: `Vendor Registration — ${m.businessName}`,
        amountCents: 4635,
        category: 'Vendor Fee',
        customerName: m.contactName,
        reference: `bk-${vendorRef}`,
        notes: m.contactEmail,
      })

      // Upsert contact
      const contactId = await upsertContact({
        name: m.contactName,
        email: m.contactEmail,
        phone: m.contactPhone,
        sourceDetail: `Vendor registration — Spring Market (${m.businessName})`,
        serviceInterests: ['general'],
        marketingConsent: true,
      })

      // Enroll in post-booking sequence (non-fatal)
      if (contactId) {
        await enrollInSequence({
          contactId,
          contactEmail: m.contactEmail,
          triggerEvent: 'booking_confirmed',
          serviceType: 'general',
        }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
      }

      // Confirmation emails
      if (process.env.RESEND_API_KEY) {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

        const customerHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F6F1EB;font-family:sans-serif;">
<div style="max-width:560px;margin:0 auto;background:white;">
  <div style="background:linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%);padding:36px 40px;text-align:center;">
    <p style="color:#1a2744;opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 10px;">Host Hampton &middot; Speonk, NY</p>
    <h1 style="color:#1a2744;font-size:26px;margin:0;font-weight:normal;font-family:Georgia,serif;">You&rsquo;re registered!</h1>
  </div>
  <div style="padding:32px 40px;">
    <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 24px;">
      Hi ${escapeHtml(m.contactName?.split(' ')[0] || 'there')}! We&rsquo;ve got your spot at the Host Hampton Spring Market. We&rsquo;ll be in touch with event details soon.
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:28px;">
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;color:#1a2744;width:140px;">Business</td><td style="padding:10px 12px;color:#555;">${escapeHtml(m.businessName)}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;color:#1a2744;">Instagram</td><td style="padding:10px 12px;color:#555;">${escapeHtml(m.igHandle)}</td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;color:#1a2744;">Registration</td><td style="padding:10px 12px;color:#059669;font-weight:bold;">$46.35 paid ✓</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;color:#1a2744;">Ref #</td><td style="padding:10px 12px;color:#888;font-size:12px;">${vendorRef}</td></tr>
    </table>
    <p style="color:#888;font-size:13px;line-height:1.6;margin:0;">Questions? Text or call <strong style="color:#1a2744;">(631) 998-9325</strong> or DM <strong style="color:#1a2744;">@hosthampton</strong> on Instagram.</p>
  </div>
  <div style="background:#BCCDEB;padding:20px 40px;text-align:center;">
    <p style="color:#1a2744;font-size:12px;margin:0;">Host Hampton &middot; 295 Montauk Highway, Suite 7, Speonk, NY 11972</p>
  </div>
</div>
</body></html>`

        const ownerHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:20px;background:#F6F1EB;font-family:sans-serif;">
<div style="max-width:560px;margin:0 auto;background:white;border-radius:8px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%);padding:20px 28px;">
    <h2 style="color:#1a2744;margin:0;font-size:18px;">New Vendor Registration</h2>
    <p style="color:#1a2744;opacity:0.7;margin:4px 0 0;font-size:13px;">${vendorRef}</p>
  </div>
  <div style="padding:24px 28px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;width:130px;">Name</td><td style="padding:10px 12px;">${escapeHtml(m.contactName)}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Business</td><td style="padding:10px 12px;">${escapeHtml(m.businessName)}</td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Instagram</td><td style="padding:10px 12px;">${escapeHtml(m.igHandle)}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Email</td><td style="padding:10px 12px;"><a href="${mailToHref(m.contactEmail)}">${escapeHtml(m.contactEmail)}</a></td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Phone</td><td style="padding:10px 12px;">${escapeHtml(m.contactPhone || '—')}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Paid</td><td style="padding:10px 12px;color:#059669;font-weight:bold;">$46.35 ✓</td></tr>
    </table>
  </div>
</div>
</body></html>`

        await Promise.allSettled([
          resend.emails.send({
            from,
            to: m.contactEmail,
            subject: `You're registered! Host Hampton Spring Market`,
            html: customerHtml,
          }),
          resend.emails.send({
            from,
            to: ownerEmail(),
            subject: `New vendor: ${m.businessName} (${m.contactName}) — ${vendorRef}`,
            html: ownerHtml,
          }),
        ])
        console.log('Vendor confirmation sent to', m.contactEmail)
      }

      return NextResponse.json({ received: true })
    }

    // ── Party builder deposit / payment ─────────────────────
    if (m.type === 'party_builder') {
      const bookingRef = m.booking_ref
      const bookingId = m.booking_id
      const paymentType = m.payment_type || 'deposit'
      const depositCents = parseInt(m.depositCents || '0', 10)
      const cardFeeCents = parseInt(m.cardFeeCents || '0', 10)
      const totalCharged = session.amount_total || 0

      if (paymentType === 'deposit') {
        // Insert payment record first. If confirm-session already inserted (UI
        // returned from Stripe before the webhook fired), the unique
        // stripe_session_id constraint fails — that's fine, we still send the
        // confirmation email below since confirm-session no longer does.
        const { error: payErr } = await supabase.from('booking_payments').insert({
          booking_id: bookingId,
          payment_type: 'deposit',
          payment_method: 'card',
          amount_cents: depositCents,
          card_fee_cents: cardFeeCents,
          total_charged_cents: totalCharged,
          stripe_payment_intent_id: session.payment_intent as string,
          stripe_session_id: session.id,
          recorded_by: 'system',
        })
        const alreadyRecorded = isUniqueViolation(payErr)
        if (payErr && !alreadyRecorded) {
          console.error('Party builder payment insert error:', payErr.message, '— asking Stripe to retry')
          return NextResponse.json({ error: payErr.message }, { status: 500 })
        }

        // Recalculate balance from all payments + lock the date.
        // Idempotent: if confirm-session already set these to the same values,
        // this is a no-op write. A FAILED read is not: it used to read the total
        // as zero and write `paid_in_full`.
        const inputs = await readBalanceInputs(supabase, bookingId, 'total_cents, party_tags')
        if (!inputs.ok) {
          console.error('Party builder deposit: cannot recompute balance —', inputs.message, '— asking Stripe to retry')
          return NextResponse.json({ error: inputs.message }, { status: 500 })
        }
        const paidSum = inputs.paidSum
        const bkRow = inputs.row as { total_cents: number | null; party_tags: Record<string, unknown> | null }
        // See the note on the PaymentIntent branch: `(total_cents || 0)` marks an
        // unpriced lead paid in full. `computeBalance` is the one definition.
        const bal = computeBalance(bkRow.total_cents, paidSum)
        const newBal = bal.balanceCents
        const existingTags = bkRow.party_tags || {}
        const { error: updateErr } = await supabase
          .from('bookings')
          .update({
            status: bal.paidInFull ? 'paid_in_full' : 'pending_review',
            balance_due_cents: newBal,
            party_tags: { ...existingTags, date_locked: true },
            ...(bal.paidInFull ? { paid_in_full_at: new Date().toISOString() } : {}),
          })
          .eq('id', bookingId)
        if (updateErr) {
          console.error('Party builder booking update error:', updateErr.message, '— asking Stripe to retry')
          return NextResponse.json({ error: updateErr.message }, { status: 500 })
        }

        // The side effects are keyed on the financial row, not on
        // `alreadyRecorded`, for the reason on `FinancialWrite`: confirm-session
        // writes the same `booking_payments` row from the browser and does none
        // of this, so "my insert was a duplicate" cannot mean "already done".
        // The reference now carries the Stripe session so a genuine second
        // payment is not mistaken for a redelivery of the first.
        const pbcFin = await recordFinancialTransaction(supabase, {
          date: new Date().toISOString().split('T')[0],
          description: `Party Deposit — ${m.packageType || 'Kids Party'}`,
          amountCents: totalCharged,
          category: 'Party Booking',
          customerName: m.contactName,
          reference: `pb-${bookingRef}-${session.id}`,
          notes: m.contactEmail,
        })
        if (pbcFin === 'failed') return NextResponse.json({ error: 'financial row not written' }, { status: 500 })
        const pbcFirstTime = pbcFin === 'written'
        if (!pbcFirstTime) {
          console.log('Party builder deposit: already handled for session', session.id, '— no second email')
          return NextResponse.json({ received: true, duplicate: true })
        }

        // Insert audit log
        const { error: pbcModErr } = await supabase.from('booking_modifications').insert({
          booking_id: bookingId,
          modified_by: 'system',
          change_summary: `Deposit of ${formatMoney(depositCents)} received via card`,
        })
        if (pbcModErr) console.error('Modification log error (non-fatal):', pbcModErr.message)

        // Generate portal link
        const portalSecret = portalSigningSecret()
        const { token: rawToken, hash, expiresAt } = generatePortalToken(bookingRef, portalSecret)
        const { error: pbcTokErr } = await supabase.from('portal_tokens').insert({
          booking_id: bookingId,
          token_hash: hash,
          expires_at: expiresAt.toISOString(),
        })
        if (pbcTokErr) {
          console.error('Portal token insert failed:', pbcTokErr.message, '— asking Stripe to retry')
          return NextResponse.json({ error: pbcTokErr.message }, { status: 500 })
        }

        const portalUrl = buildPortalUrl(bookingRef, rawToken)
        const origin = publicOrigin(req)

        // Fetch line items for email
        const { data: liRows } = await supabase
          .from('booking_line_items')
          .select('name, quantity, unit_price_cents, guest_multiplied')
          .eq('booking_id', bookingId)
          .order('sort_order')

        const guestCount = parseInt(m.guestCount || '10', 10)
        const emailLineItems = (liRows || []).map(li => ({
          name: li.name,
          quantity: li.quantity,
          unit_price_cents: li.unit_price_cents,
          guest_multiplied: li.guest_multiplied,
          totalCents: li.guest_multiplied
            ? li.unit_price_cents * li.quantity * guestCount
            : li.unit_price_cents * li.quantity,
        }))

        // Fetch booking total
        const { data: bk } = await supabase
          .from('bookings')
          .select('total_cents')
          .eq('id', bookingId)
          .single()

        // Send emails
        if (process.env.RESEND_API_KEY) {
          const resend = new Resend(process.env.RESEND_API_KEY)
          const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

          const partyDateFormatted = m.partyDate
            ? new Date(m.partyDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
            : 'TBD'

          await Promise.allSettled([
            resend.emails.send({
              from,
              to: m.contactEmail,
              subject: `Deposit Received — ${bookingRef}`,
              html: partyDepositReceivedHtml({
                customerName: m.contactName,
                bookingRef,
                depositFormatted: formatMoney(depositCents),
                partyDate: partyDateFormatted,
                portalUrl,
                lineItems: emailLineItems,
                totalFormatted: formatMoney(bk?.total_cents || 0),
              }),
            }),
            resend.emails.send({
              from,
              to: ownerEmail(),
              subject: `New party booking: ${m.contactName} — ${bookingRef}`,
              html: partyAdminNewBookingHtml({
                bookingRef,
                customerName: m.contactName,
                customerEmail: m.contactEmail,
                customerPhone: m.contactPhone || undefined,
                partyDate: partyDateFormatted,
                partyTime: m.partyTime || 'TBD',
                guestCount,
                packageType: m.packageType || 'Kids Party',
                depositFormatted: formatMoney(depositCents),
                totalFormatted: formatMoney(bk?.total_cents || 0),
                paymentMethod: 'card',
                lineItems: emailLineItems,
                adminUrl: `${origin}/admin?tab=parties&ref=${bookingRef}`,
              }),
            }),
          ])
          console.log('Party deposit emails sent for', bookingRef)
        }

        // Enqueue party balance reminders (non-fatal)
        if (m.partyDate) {
          await enqueuePartyReminders({ contactEmail: m.contactEmail, bookingRef, partyDate: m.partyDate })
            .catch(err => console.error('Party reminder enqueue error:', err))
        }

        console.log('Party builder deposit processed:', bookingRef, formatMoney(depositCents))
      } else {
        // Subsequent payment (partial or final)
        const amountCents = parseInt(m.amountCents || '0', 10)
        const pCardFee = parseInt(m.cardFeeCents || '0', 10)

        const { error: pbpErr } = await supabase.from('booking_payments').insert({
          booking_id: bookingId,
          payment_type: paymentType,
          payment_method: 'card',
          amount_cents: amountCents,
          card_fee_cents: pCardFee,
          total_charged_cents: totalCharged,
          stripe_payment_intent_id: session.payment_intent as string,
          stripe_session_id: session.id,
          recorded_by: 'system',
        })
        if (pbpErr && !isUniqueViolation(pbpErr)) {
          console.error('Party payment insert error:', pbpErr.message, '— asking Stripe to retry')
          return NextResponse.json({ error: pbpErr.message }, { status: 500 })
        }

        // Recalculate balance. This branch had NO duplicate handling at all: a
        // redelivery logged the 23505, recomputed, and then sent the customer a
        // second "Payment Received" email.
        const pInputs = await readBalanceInputs(supabase, bookingId, 'total_cents')
        if (!pInputs.ok) {
          console.error('Party builder payment: cannot recompute balance —', pInputs.message, '— asking Stripe to retry')
          return NextResponse.json({ error: pInputs.message }, { status: 500 })
        }
        // `computeBalance`, not a third hand-rolled copy of it. Link 18
        // extracted this exact arithmetic; link 21 found this branch still
        // spelling it out, and it carried the defect the extraction exists to
        // stop: `(total_cents || 0) - paid` clamps an UNPRICED lead — most of
        // the pipeline since Phase 4 — to a balance of 0 and stamps it
        // `paid_in_full`. `computeBalance` reports `paidInFull: false` when
        // there is no total to be paid in full against.
        const pBal = computeBalance((pInputs.row as { total_cents: number | null }).total_cents, pInputs.paidSum)
        const newBalance = pBal.balanceCents

        const updateFields: Record<string, unknown> = { balance_due_cents: newBalance }
        if (pBal.paidInFull) {
          updateFields.paid_in_full_at = new Date().toISOString()
          updateFields.status = 'paid_in_full'
        }

        const { error: pbpUpdErr } = await supabase.from('bookings').update(updateFields).eq('id', bookingId)
        if (pbpUpdErr) {
          console.error('Party builder payment: booking update failed —', pbpUpdErr.message, '— asking Stripe to retry')
          return NextResponse.json({ error: pbpUpdErr.message }, { status: 500 })
        }

        const pbpFin = await recordFinancialTransaction(supabase, {
          date: new Date().toISOString().split('T')[0],
          description: `Party ${paymentType === 'final' ? 'Final' : 'Partial'} Payment — ${bookingRef}`,
          amountCents: totalCharged,
          category: 'Party Booking',
          customerName: m.contactName || null,
          reference: `pb-${bookingRef}-${paymentType}-${session.id}`,
          notes: m.contactEmail || null,
        })
        if (pbpFin === 'failed') return NextResponse.json({ error: 'financial row not written' }, { status: 500 })
        if (pbpFin === 'duplicate') {
          console.log('Party builder payment: already handled for session', session.id, '— no second receipt')
          return NextResponse.json({ received: true, duplicate: true })
        }

        const { error: pbpModErr } = await supabase.from('booking_modifications').insert({
          booking_id: bookingId,
          modified_by: 'system',
          change_summary: `Payment of ${formatMoney(amountCents)} received via card. Balance: ${formatMoney(newBalance)}`,
        })
        if (pbpModErr) console.error('Modification log error (non-fatal):', pbpModErr.message)

        // Send payment receipt to customer (confirm-session no longer sends emails)
        if (process.env.RESEND_API_KEY && m.contactEmail) {
          const portalSecret = portalSigningSecret()
          const { token: rawToken, hash, expiresAt } = generatePortalToken(bookingRef, portalSecret)
          const { error: pbpTokErr } = await supabase.from('portal_tokens').insert({
            booking_id: bookingId,
            token_hash: hash,
            expires_at: expiresAt.toISOString(),
          })
          if (pbpTokErr) {
            console.error('Portal token insert failed:', pbpTokErr.message, '— asking Stripe to retry rather than mailing a dead link')
            return NextResponse.json({ error: pbpTokErr.message }, { status: 500 })
          }
          const portalUrl = buildPortalUrl(bookingRef, rawToken, '/party-planner')

          const resend = new Resend(process.env.RESEND_API_KEY)
          const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
          await resend.emails.send({
            from,
            to: m.contactEmail,
            subject: `Payment Received — ${bookingRef}`,
            html: partyPaymentReceivedHtml({
              customerName: m.contactName || 'there',
              bookingRef,
              amountFormatted: formatMoney(amountCents),
              paymentMethod: 'card',
              newBalanceFormatted: formatMoney(newBalance),
              portalUrl,
            }),
          }).catch(err => console.error('Party payment receipt email error:', err))
        }

        console.log('Party builder payment processed:', bookingRef, paymentType, formatMoney(amountCents), 'balance:', formatMoney(newBalance))
      }

      return NextResponse.json({ received: true })
    }

    // ── Pay link (admin-generated) ──────────────────────────
    if (m.type === 'pay_link') {
      const amountCents = parseInt(m.amountCents || '0', 10)

      // Record in financials
      await recordFinancialTransaction(supabase, {
        date: new Date().toISOString().split('T')[0],
        description: m.description || 'Pay Link Payment',
        amountCents,
        category: m.category || 'Room Rental',
        customerName: m.customerName || null,
        reference: `pl-${session.payment_intent}`,
        notes: m.customerEmail || null,
      })

      // Upsert contact (non-fatal)
      if (m.customerEmail) {
        await upsertContact({
          name: m.customerName || 'Unknown',
          email: m.customerEmail,
          phone: m.customerPhone || undefined,
          sourceDetail: `Pay link — ${m.description || 'payment'}`,
          serviceInterests: ['general'],
          marketingConsent: false,
        }).catch(err => console.error('Pay link contact upsert error (non-fatal):', err))
      }

      console.log('Pay link completed:', m.customerName, `$${(amountCents / 100).toFixed(2)}`, m.description)
      return NextResponse.json({ received: true })
    }

    // ── Gift card purchase ────────────────────────────────────
    if (m.type === 'gift_card') {
      const amountCents = parseInt(m.amountCents || '0', 10)
      const amountFormatted = `$${(amountCents / 100).toFixed(0)}`

      // Generate unique 12-char code: HH-XXXX-XXXX
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no O/0/I/1
      let codeBody = ''
      for (let i = 0; i < 8; i++) codeBody += chars[Math.floor(Math.random() * chars.length)]
      const code = `HH-${codeBody.slice(0, 4)}-${codeBody.slice(4)}`

      const { error: gcErr } = await supabase.from('gift_cards').insert({
        code,
        amount_cents: amountCents,
        balance_cents: amountCents,
        purchaser_name: m.purchaserName,
        purchaser_email: m.purchaserEmail,
        recipient_name: m.recipientName,
        recipient_email: m.recipientEmail,
        personal_message: m.personalMessage || null,
        stripe_session_id: session.id,
        status: 'active',
      })

      if (gcErr && !isUniqueViolation(gcErr)) {
        console.error('Gift card insert error:', gcErr.message, '— asking Stripe to retry')
        return NextResponse.json({ error: gcErr.message }, { status: 500 })
      }
      if (gcErr || alreadyIssued) {
        // `gift_cards_stripe_session_id_key` has always been unique, so a
        // redelivery ALWAYS failed this insert — and the old code then emailed
        // the recipient the freshly generated `code`, which was never written to
        // the table. A second gift-card email quoting a code that redeems
        // nothing, for a card the customer already holds under a different code.
        console.log('Gift card already issued for session', session.id, '— nothing re-issued, no second email')
        return NextResponse.json({ received: true, duplicate: true })
      }
      console.log('Gift card created:', code, amountFormatted, 'for', m.recipientEmail)

      // Record in financials (non-fatal)
      await recordFinancialTransaction(supabase, {
        date: new Date().toISOString().split('T')[0],
        description: `Gift Card — ${code}`,
        amountCents,
        category: 'Gift Card',
        customerName: m.purchaserName,
        reference: `gc-${code}`,
        notes: `Purchaser: ${m.purchaserEmail} | Recipient: ${m.recipientEmail}`,
      })

      // Upsert purchaser contact (non-fatal)
      await upsertContact({
        name: m.purchaserName,
        email: m.purchaserEmail,
        sourceDetail: `Gift card purchase — ${code}`,
        serviceInterests: ['general'],
        marketingConsent: false,
      }).catch(err => console.error('Gift card contact upsert error (non-fatal):', err))

      // Send emails
      if (process.env.RESEND_API_KEY) {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

        await Promise.allSettled([
          // Recipient gets the gift card
          resend.emails.send({
            from, to: m.recipientEmail,
            subject: `You've received a ${amountFormatted} Host Hampton Gift Card!`,
            html: giftCardHtml({
              recipientName: m.recipientName,
              senderName: m.purchaserName,
              amountFormatted,
              code,
              personalMessage: m.personalMessage || undefined,
            }),
          }),
          // Purchaser gets confirmation
          resend.emails.send({
            from, to: m.purchaserEmail,
            subject: `Gift Card Sent! ${amountFormatted} for ${m.recipientName}`,
            html: giftCardPurchaseConfirmHtml({
              purchaserName: m.purchaserName,
              recipientName: m.recipientName,
              amountFormatted,
              code,
            }),
          }),
          // Owner notification
          resend.emails.send({
            from, to: ownerEmail(),
            subject: `New gift card: ${m.purchaserName} → ${m.recipientName} (${amountFormatted})`,
            html: giftCardNotifyHtml({
              code,
              amountFormatted,
              purchaserName: m.purchaserName,
              purchaserEmail: m.purchaserEmail,
              recipientName: m.recipientName,
              recipientEmail: m.recipientEmail,
              personalMessage: m.personalMessage || undefined,
              stripePI: session.payment_intent as string,
            }),
          }),
        ])
        console.log('Gift card emails sent:', code)
      }

      return NextResponse.json({ received: true })
    }

    // ── A settled payment that nothing above claimed ───────────
    //
    // Everything above keys on `m.type`. A Payment Link created BY HAND in the
    // Stripe dashboard carries no metadata at all, so it reached the legacy
    // party-booking tail below, which insists on inserting a `bookings` row —
    // and that insert is refused by `bookings_contact_reachable_check` when
    // there is no contact to put on it, after which this handler used to THROW
    // formatting a confirmation email for a customer it did not have. A 500.
    //
    // That is how a real $927 customer payment was recorded nowhere: Stripe
    // retried, gave up, and the only trace was a stack trace in a log. See
    // lib/unclaimedPayment.ts.
    //
    // ── Why there is a second test here now ───────────────────────────────
    //
    // `isUnclaimableSession` asks "does the legacy tail have what it needs",
    // which is NOT the same question as "did any branch claim this". A session
    // naming a type nobody handles but carrying a `contactEmail` passed it, fell
    // into the legacy tail, and silently became a phantom `deposit_paid`
    // kids-party booking — with a "You're booked! 🎉" email sent to whoever paid.
    //
    // And this is measured, not imagined. Stripe's own records hold a settled
    // LIVE session from 2026-07-22 for **$250.00** whose metadata is
    // `{customerName, type: "invoice_deposit"}` — a type this codebase has never
    // written, from a hand-made dashboard link. It is in no table: no booking, no
    // booking_payment, no financial row. A second lost payment on this surface,
    // two months BEFORE the $927 one that got a net built for it, and the net as
    // built would still have missed it if the link had carried an email address.
    if (!isHandledSessionType(m.type) && !isLegacyBookingSession(m)) {
      console.error(
        `UNHANDLED STRIPE SESSION TYPE "${m.type}" on ${session.id} —` +
          ` no branch claims it; recording as unclaimed rather than guessing it is a party booking.`,
      )
      const un = await recordUnclaimedStripeSession(session, supabase)
      return NextResponse.json({ received: true, unclaimed: true, unknownType: m.type, recorded: un.recorded })
    }

    if (isUnclaimableSession(session.metadata)) {
      const un = await recordUnclaimedStripeSession(session, supabase)
      // Acknowledged either way. Retrying an unclaimable session produces the
      // same nothing; the alert is the log line and the email, not a 500.
      return NextResponse.json({ received: true, unclaimed: true, recorded: un.recorded })
    }

    // ── Party booking deposit (existing flow) ──────────────────
    const partyDate = m.partyDate
    const optionsLockedBy = partyDate
      ? new Date(new Date(partyDate).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      : null

    const parsedTags = parseJsonMetadata<Record<string, unknown>>(m.partyTags, 'partyTags')
    if (!parsedTags.ok) console.error('Legacy booking:', parsedTags.message, '— continuing with empty party_tags')
    const partyTags = parsedTags.ok && !Array.isArray(parsedTags.value) ? parsedTags.value : {}

    const bookingRef = `HH-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`

    const { error: dbError } = await supabase.from('bookings').insert({
      status: 'deposit_paid',
      event_type: m.eventType || 'kid-party',
      party_date: partyDate,
      party_time: m.partyTime,
      package_type: m.packageName || null,
      guest_count_approx: m.guestCount ? parseInt(m.guestCount, 10) : null,
      child_name: m.childName || null,
      child_age: m.childAge ? parseInt(m.childAge, 10) : null,
      contact_name: m.contactName,
      contact_email: m.contactEmail,
      contact_phone: m.contactPhone || null,
      deposit_amount: m.depositCents ? parseInt(m.depositCents, 10) : 25000,
      stripe_payment_intent_id: session.payment_intent as string,
      stripe_session_id: session.id,
      party_tags: partyTags,
      notes: m.notes || null,
      options_locked_by: optionsLockedBy,
      booking_ref: bookingRef,
    })

    if (dbError && !isUniqueViolation(dbError)) {
      // The booking was refused — most likely by `bookings_contact_reachable_check`,
      // which is exactly what happened to the $927 payment. Do NOT carry on into
      // the confirmation email: there is no booking to confirm. Record the money
      // where a human looks and acknowledge, because retrying an unclaimable
      // session produces the same nothing three days running.
      console.error('Supabase insert error:', dbError.message, '— recording this payment as unclaimed instead')
      const un = await recordUnclaimedStripeSession(session, supabase)
      return NextResponse.json({ received: true, unclaimed: true, recorded: un.recorded, reason: dbError.message })
    }
    if (dbError || alreadyIssued) {
      console.log('Legacy booking already created for session', session.id, '— nothing re-issued, no second email')
      return NextResponse.json({ received: true, duplicate: true })
    }
    {
      console.log('Booking created:', bookingRef, 'for', m.contactEmail, 'on', partyDate)

      // Redeem partial gift card if used
      if (m.giftCardCode && m.giftCardDeductCents) {
        const gcDeduct = parseInt(m.giftCardDeductCents, 10)
        if (gcDeduct > 0) {
          const red = await redeemGiftCard(supabase, m.giftCardCode, gcDeduct)
          if (red.outcome === 'redeemed') {
            console.log(`Gift card ${m.giftCardCode} redeemed ${red.redeemedCents}c for booking ${bookingRef}. New balance: ${red.newBalanceCents}c (${red.status})`)
          } else if (red.outcome === 'no_active_card') {
            console.error(`GIFT CARD NOT REDEEMED: ${m.giftCardCode} has no ACTIVE row — ${gcDeduct}c of discount was given on ${bookingRef} and not deducted.`)
          } else {
            console.error(`GIFT CARD NOT REDEEMED: ${m.giftCardCode} — ${red.message}. ${gcDeduct}c of discount was given on ${bookingRef} and not deducted.`)
          }
        }
      }

      // Record in financials (non-fatal)
      const bookingAmountCents = session.amount_total || (m.depositCents ? parseInt(m.depositCents, 10) : 25000)
      await recordFinancialTransaction(supabase, {
        date: new Date().toISOString().split('T')[0],
        description: `${(m.eventType || 'Party').split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} Deposit${m.packageName ? ` — ${m.packageName}` : ''}`,
        amountCents: bookingAmountCents,
        category: m.eventType?.includes('room') ? 'Room Rental' : 'Party Booking',
        customerName: m.contactName,
        reference: `bk-${bookingRef}`,
        notes: m.contactEmail,
      })

      // Upsert contact (non-fatal)
      const contactId = await upsertContact({
        name: m.contactName,
        email: m.contactEmail,
        phone: m.contactPhone,
        sourceDetail: `Booking deposit — ${m.eventType || 'party'}`,
        serviceInterests: [m.bookingTypeSlug || m.eventType || 'general'],
        marketingConsent: m.marketingConsent === 'true',
      })

      // Enroll in post-booking sequence (non-fatal)
      if (contactId) {
        await enrollInSequence({
          contactId,
          contactEmail: m.contactEmail,
          triggerEvent: 'booking_confirmed',
          serviceType: m.bookingTypeSlug || m.eventType || 'general',
          eventDate: partyDate,
          bookingRef,
        }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
      }

      // Enqueue booking reminders (non-fatal)
      if (partyDate) {
        await enqueueBookingReminders({
          contactEmail: m.contactEmail,
          bookingRef,
          partyDate,
        }).catch(err => console.error('Booking reminder enqueue error:', err))

        await enqueueReviewRequest({
          contactEmail: m.contactEmail,
          referenceType: 'booking',
          referenceId: bookingRef,
          eventDate: partyDate,
        }).catch(err => console.error('Review request enqueue error:', err))
      }

      // Write back to Google Calendar.
      // All parties block 2 hours regardless of booking_type.slot_duration_min
      // (slot_duration_min now controls customer-selectable start time interval
      // only, not actual party length).
      if (partyDate && m.partyTime) {
        const endTime = addMinutes(m.partyTime, 120)
        const calEventId = await createCalendarEvent({
          summary: `[BOOKING] ${m.contactName} - ${m.eventType || 'Party'}`,
          startDate: partyDate,
          startTime: m.partyTime,
          endTime,
          description: `Ref: ${bookingRef}\nContact: ${m.contactName} (${m.contactEmail})\nType: ${m.eventType || 'Party'}${m.packageName ? `\nPackage: ${m.packageName}` : ''}${m.guestCount ? `\nGuests: ~${m.guestCount}` : ''}${m.notes ? `\nNotes: ${m.notes}` : ''}`,
        })
        if (calEventId) {
          console.log('Google Calendar event created:', calEventId)
        }
      }
    }

    // Send confirmation emails via Resend
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
      const firstName = m.contactName?.split(' ')[0] || 'there'

      const dateFormatted = partyDate
        ? new Date(partyDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        : 'TBD'

      // Balance due date = 48 hours before party
      const balanceDueDate = partyDate
        ? new Date(new Date(partyDate + 'T12:00:00').getTime() - 48 * 60 * 60 * 1000)
            .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
        : 'day of your event'

      const depositAmount = m.depositCents ? parseInt(m.depositCents, 10) / 100 : 250
      const depositFormatted = `$${depositAmount.toFixed(2)}`
      const isRoomRental = (m.eventType || '').includes('room-rental')

      // Format event type slug to display name
      const eventTypeDisplay = (m.eventType || 'Party')
        .split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

      const customerHtml = bookingConfirmationHtml({
        customerName: m.contactName,
        bookingRef,
        dateFormatted,
        partyTime: m.partyTime || 'TBD',
        eventTypeDisplay,
        depositFormatted,
        packageName: m.packageName,
        childName: m.childName,
        childAge: m.childAge,
        guestCount: m.guestCount,
        notes: m.notes,
        isRoomRental,
        balanceDueDate,
      })

      const ownerHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:20px;background:#F6F1EB;font-family:sans-serif;">
<div style="max-width:600px;margin:0 auto;background:white;border-radius:8px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%);padding:20px 28px;">
    <h2 style="color:#1a2744;margin:0;font-size:18px;">💰 New Deposit Received</h2>
    <p style="color:#1a2744;opacity:0.7;margin:4px 0 0;font-size:13px;">${bookingRef}</p>
  </div>
  <div style="padding:24px 28px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;width:130px;">Customer</td><td style="padding:10px 12px;">${escapeHtml(m.contactName)}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Email</td><td style="padding:10px 12px;"><a href="${mailToHref(m.contactEmail)}">${escapeHtml(m.contactEmail)}</a></td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Phone</td><td style="padding:10px 12px;">${escapeHtml(m.contactPhone || '—')}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Date</td><td style="padding:10px 12px;">${escapeHtml(dateFormatted)}</td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Time</td><td style="padding:10px 12px;">${escapeHtml(m.partyTime || '—')}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Event type</td><td style="padding:10px 12px;">${escapeHtml(m.eventType || '—')}</td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Package</td><td style="padding:10px 12px;">${escapeHtml(m.packageName || '—')}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Child</td><td style="padding:10px 12px;">${m.childName ? `${escapeHtml(m.childName)}${m.childAge ? `, age ${escapeHtml(String(m.childAge))}` : ''}` : '—'}</td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Guests</td><td style="padding:10px 12px;">${escapeHtml(m.guestCount || '—')}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Notes</td><td style="padding:10px 12px;">${escapeHtml(m.notes || '—')}</td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Deposit</td><td style="padding:10px 12px;color:#059669;font-weight:bold;">${depositFormatted} ✓</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Stripe PI</td><td style="padding:10px 12px;font-size:12px;color:#888;">${escapeHtml(typeof session.payment_intent === 'string' ? session.payment_intent : null)}</td></tr>
    </table>
  </div>
</div>
</body>
</html>`

      const [customerResult, ownerResult] = await Promise.allSettled([
        resend.emails.send({
          from,
          to: m.contactEmail,
          subject: `You're booked! ${dateFormatted} at Host Hampton 🎉`,
          html: customerHtml,
        }),
        resend.emails.send({
          from,
          to: ownerEmail(),
          subject: `New booking: ${m.contactName} — ${partyDate} at ${m.partyTime} (${bookingRef})`,
          html: ownerHtml,
        }),
      ])

      if (customerResult.status === 'rejected') console.error('Customer email failed:', customerResult.reason)
      else console.log('Confirmation sent to', m.contactEmail)
      if (ownerResult.status === 'rejected') console.error('Owner email failed:', ownerResult.reason)
    } else {
      console.warn('RESEND_API_KEY not set — skipping emails')
    }
  }

  return NextResponse.json({ received: true })
}
