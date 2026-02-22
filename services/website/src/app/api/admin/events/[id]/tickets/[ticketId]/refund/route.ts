import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'
import { ticketRefundHtml } from '@/lib/emailTemplates'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; ticketId: string } }
) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const body = await req.json()

  // Fetch ticket
  const { data: ticket, error: ticketErr } = await supabase
    .from('event_tickets')
    .select('*')
    .eq('id', params.ticketId)
    .single()

  if (ticketErr || !ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  if (ticket.status === 'refunded') return NextResponse.json({ error: 'Already refunded' }, { status: 400 })

  // Fetch event title
  const { data: event } = await supabase
    .from('events')
    .select('title')
    .eq('id', params.id)
    .single()

  const refundAmountCents = body.amountCents || ticket.total_cents

  // Process Stripe refund if paid
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

  // Update ticket status
  await supabase
    .from('event_tickets')
    .update({
      status: 'refunded',
      refund_amount_cents: refundAmountCents,
      refund_reason: body.reason || null,
    })
    .eq('id', params.ticketId)

  // Increment available tickets
  if (ticket.session_id) {
    await supabase.rpc('increment_session_tickets', { sid: ticket.session_id, qty: ticket.quantity })
  } else {
    await supabase.rpc('increment_event_tickets', { eid: params.id, qty: ticket.quantity })
  }

  // Send refund email
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
    await resend.emails.send({
      from,
      to: ticket.customer_email,
      subject: `Refund processed — ${event?.title || 'Host Hampton Event'}`,
      html: ticketRefundHtml({
        customerName: ticket.customer_name,
        eventTitle: event?.title || 'Event',
        ticketRef: ticket.ticket_ref,
        refundAmount: `$${(refundAmountCents / 100).toFixed(2)}`,
        reason: body.reason,
      }),
    })
  }

  return NextResponse.json({ refunded: true, amount: refundAmountCents })
}
