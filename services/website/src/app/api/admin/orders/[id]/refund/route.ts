import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { Resend } from 'resend'
import { ticketRefundHtml, bookingRefundHtml } from '@/lib/emailTemplates'
import { cappedRefundAmount, refundTicket, describeLedgerOutcome, stripeRefunder } from '@/lib/adminRefund'
import { recordAdminRefund, ledgerCategoryForBooking } from '@/lib/adminMoney'
import { readBalanceInputs } from '@/lib/bookingBalance'
import { adminActorId } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const body = await req.json()
  const { order_type, amountCents, reason } = body

  if (!order_type || !['booking', 'ticket'].includes(order_type)) {
    return NextResponse.json({ error: 'Invalid order_type' }, { status: 400 })
  }

  if (order_type === 'ticket') {
    // Fetch ticket
    const { data: ticket, error: ticketErr } = await supabase
      .from('event_tickets')
      .select('*, events(title)')
      .eq('id', params.id)
      .single()

    if (ticketErr || !ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    if (ticket.status === 'refunded') return NextResponse.json({ error: 'Already refunded' }, { status: 400 })

    const capped = cappedRefundAmount(amountCents, ticket.total_cents)
    if (!capped.ok) return NextResponse.json({ error: capped.error }, { status: 400 })
    const refundAmountCents = capped.cents
    const eventTitle = (ticket as any).events?.title || 'Event'

    const outcome = await refundTicket(supabase, {
      ticket,
      refundAmountCents,
      reason: reason || null,
      // `ticket.event_id` — the ticket's OWN event, never an id from the URL.
      eventId: ticket.event_id,
      eventTitle,
      refundViaStripe: stripeRefunder(),
    })
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status })

    // Send refund email — only now, with the ticket really marked refunded.
    if (process.env.RESEND_API_KEY && ticket.customer_email) {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
      const { error: mailErr } = await resend.emails.send({
        from,
        to: ticket.customer_email,
        subject: `Refund processed — ${eventTitle}`,
        html: ticketRefundHtml({
          customerName: ticket.customer_name,
          eventTitle,
          ticketRef: ticket.ticket_ref,
          refundAmount: `$${(refundAmountCents / 100).toFixed(2)}`,
          reason,
        }),
      })
      if (mailErr) console.error('ticket refund: email failed:', mailErr.message)
    }

    return NextResponse.json({
      refunded: true,
      amount: refundAmountCents,
      ledger: outcome.ledger.kind,
      message: `Refund of $${(refundAmountCents / 100).toFixed(2)} processed. ${describeLedgerOutcome(outcome.ledger)}`,
    })
  }

  // Booking refund
  const { data: booking, error: bookingErr } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', params.id)
    .single()

  if (bookingErr || !booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  if (booking.status === 'cancelled' && booking.refund_amount_cents) {
    return NextResponse.json({ error: 'Already refunded' }, { status: 400 })
  }

  // The ceiling is what this booking has actually been PAID, not
  // `deposit_amount` — which is the amount the deposit was SET to and says
  // nothing about whether it arrived. A failed read is not a ceiling of zero and
  // is not a ceiling of infinity: it is a refusal (rule 12).
  const paid = await readBalanceInputs(supabase, params.id, 'total_cents')
  if (!paid.ok) {
    return NextResponse.json(
      { error: `Could not read what this booking has paid (${paid.message}) — nothing was refunded.` },
      { status: 503 },
    )
  }
  const capped = cappedRefundAmount(amountCents, paid.paidSum || booking.deposit_amount || 0)
  if (!capped.ok) return NextResponse.json({ error: capped.error }, { status: 400 })
  const refundAmountCents = capped.cents

  const eventTypeDisplay = (booking.event_type || 'Party')
    .split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

  // Captured before the claim — see lib/adminRefund.ts for why reading it back
  // afterwards restores the value the claim just wrote.
  const priorBookingStatus = booking.status

  // CLAIM FIRST, conditionally, then spend. See lib/adminRefund.ts for why:
  // this guard used to depend on a write whose failure was discarded, so a
  // second click issued a second real Stripe refund.
  const { data: claimed, error: claimErr } = await supabase
    .from('bookings')
    .update({
      status: 'cancelled',
      refund_amount_cents: refundAmountCents,
      refund_reason: reason || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .is('refund_amount_cents', null)
    .select('id')
  if (claimErr) {
    return NextResponse.json(
      { error: `Could not claim this refund: ${claimErr.message}. Nothing was refunded.` },
      { status: 503 },
    )
  }
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: 'Already refunded' }, { status: 400 })
  }

  if (booking.stripe_payment_intent_id) {
    const refund = stripeRefunder()
    if (refund) {
      try {
        await refund(booking.stripe_payment_intent_id, refundAmountCents)
      } catch (err: any) {
        const { error: relErr } = await supabase
          .from('bookings')
          .update({ status: priorBookingStatus, refund_amount_cents: null, refund_reason: null })
          .eq('id', params.id)
          .select('id')
        if (relErr) {
          console.error(
            `REFUND CLAIM NOT RELEASED for ${booking.booking_ref}: ${relErr.message} — ` +
              'the booking reads as refunded but Stripe declined and no money moved.',
          )
        }
        return NextResponse.json({ error: `Stripe refund failed: ${err.message}` }, { status: 500 })
      }
    }
  }

  // A refund is a payment row too, otherwise the balance still says the customer
  // paid it. `booking_payments` holds ZERO rows of type 'refund' today, against a
  // booking that really was refunded $200.
  const { error: bpErr } = await supabase.from('booking_payments').insert({
    booking_id: params.id,
    payment_type: 'refund',
    payment_method: booking.stripe_payment_intent_id ? 'card' : 'other',
    amount_cents: refundAmountCents,
    card_fee_cents: 0,
    total_charged_cents: refundAmountCents,
    recorded_by: adminActorId(req),
    notes: reason || 'Admin refund',
  })
  if (bpErr) console.error(`refund: booking_payments row NOT written for ${booking.booking_ref}:`, bpErr.message)

  const ledger = await recordAdminRefund(supabase, {
    kind: 'booking',
    objectId: params.id,
    amountCents: refundAmountCents,
    refundedAt: new Date().toISOString(),
    label: `${eventTypeDisplay} (${booking.booking_ref})`,
    customerName: booking.contact_name || null,
    category: ledgerCategoryForBooking(booking.party_type, booking.event_type),
    notes: reason || null,
    viaStripe: Boolean(booking.stripe_payment_intent_id),
  })

  if (process.env.RESEND_API_KEY && booking.contact_email) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
    const { error: mailErr } = await resend.emails.send({
      from,
      to: booking.contact_email,
      subject: `Deposit refund processed — Host Hampton`,
      html: bookingRefundHtml({
        customerName: booking.contact_name,
        eventType: eventTypeDisplay,
        bookingRef: booking.booking_ref,
        refundAmount: `$${(refundAmountCents / 100).toFixed(2)}`,
        reason,
      }),
    })
    if (mailErr) console.error('booking refund: email failed:', mailErr.message)
  }

  return NextResponse.json({
    refunded: true,
    amount: refundAmountCents,
    ledger: ledger.kind,
    message: `Refund of $${(refundAmountCents / 100).toFixed(2)} processed. ${describeLedgerOutcome(ledger)}`,
  })
}
