import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { Resend } from 'resend'
import { ticketRefundHtml, bookingRefundHtml } from '@/lib/emailTemplates'

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

    const refundAmountCents = amountCents || ticket.total_cents
    const eventTitle = (ticket as any).events?.title || 'Event'

    // Stripe refund
    if (ticket.stripe_payment_intent_id) {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
      try {
        await stripe.refunds.create({
          payment_intent: ticket.stripe_payment_intent_id,
          amount: refundAmountCents,
        })
      } catch (err: any) {
        return NextResponse.json({ error: `Stripe refund failed: ${err.message}` }, { status: 500 })
      }
    }

    // Update ticket
    await supabase
      .from('event_tickets')
      .update({
        status: 'refunded',
        refund_amount_cents: refundAmountCents,
        refund_reason: reason || null,
      })
      .eq('id', params.id)

    // Increment available tickets
    if (ticket.session_id) {
      await supabase.rpc('increment_session_tickets', { sid: ticket.session_id, qty: ticket.quantity })
    } else {
      await supabase.rpc('increment_event_tickets', { eid: ticket.event_id, qty: ticket.quantity })
    }

    // Send refund email
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
      await resend.emails.send({
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
    }

    return NextResponse.json({ refunded: true, amount: refundAmountCents })
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

  const depositCents = (booking.deposit_amount || 0) * 100
  const refundAmountCents = amountCents || depositCents

  // Stripe refund
  if (booking.stripe_payment_intent_id) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
    try {
      await stripe.refunds.create({
        payment_intent: booking.stripe_payment_intent_id,
        amount: refundAmountCents,
      })
    } catch (err: any) {
      return NextResponse.json({ error: `Stripe refund failed: ${err.message}` }, { status: 500 })
    }
  }

  // Update booking
  const eventTypeDisplay = (booking.event_type || 'Party')
    .split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

  await supabase
    .from('bookings')
    .update({
      status: 'cancelled',
      refund_amount_cents: refundAmountCents,
      refund_reason: reason || null,
    })
    .eq('id', params.id)

  // Send refund email
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
    await resend.emails.send({
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
  }

  return NextResponse.json({ refunded: true, amount: refundAmountCents })
}
