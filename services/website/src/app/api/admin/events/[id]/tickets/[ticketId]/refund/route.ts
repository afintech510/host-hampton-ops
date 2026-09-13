import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { Resend } from 'resend'
import { ticketRefundHtml } from '@/lib/emailTemplates'
import {
  cappedRefundAmount,
  refundTicket,
  describeLedgerOutcome,
  stripeRefunder,
  assertTicketBelongsToEvent,
} from '@/lib/adminRefund'

export const dynamic = 'force-dynamic'

/**
 * Refund one ticket, reached from the Events tab.
 *
 * This route and `/api/admin/orders/[id]/refund` were two near-identical copies
 * of the same money path (rule 11). The shared logic now lives in
 * `lib/adminRefund.ts`; what is left here is the URL shape and the email.
 *
 * The defect unique to THIS copy: it incremented inventory for the event named
 * in the URL rather than the ticket's own `event_id`, and never checked the two
 * agreed — so refunding ticket B through event A's URL gave A a free seat and
 * left B oversold. `assertTicketBelongsToEvent` makes that a 404.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; ticketId: string } }
) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const body = await req.json()

  const { data: ticket, error: ticketErr } = await supabase
    .from('event_tickets')
    .select('*')
    .eq('id', params.ticketId)
    .maybeSingle()

  if (ticketErr) {
    return NextResponse.json(
      { error: `Could not load this ticket (${ticketErr.message}) — nothing was refunded.` },
      { status: 503 },
    )
  }
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })

  // A ticket that does not belong to this event is "not found" here, not a
  // silently-misapplied refund.
  if (!assertTicketBelongsToEvent(ticket, params.id)) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }
  if (ticket.status === 'refunded') return NextResponse.json({ error: 'Already refunded' }, { status: 400 })

  const capped = cappedRefundAmount(body.amountCents, ticket.total_cents)
  if (!capped.ok) return NextResponse.json({ error: capped.error }, { status: 400 })
  const refundAmountCents = capped.cents

  const { data: event } = await supabase
    .from('events')
    .select('title')
    .eq('id', params.id)
    .maybeSingle()
  const eventTitle = event?.title || 'Host Hampton Event'

  const outcome = await refundTicket(supabase, {
    ticket,
    refundAmountCents,
    reason: body.reason || null,
    eventId: ticket.event_id,
    eventTitle,
    refundViaStripe: stripeRefunder(),
  })
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status })

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
        reason: body.reason,
      }),
    })
    if (mailErr) console.error('ticket refund: email failed:', mailErr.message)
  }

  return NextResponse.json({
    refunded: true,
    amount: refundAmountCents,
    ledger: outcome.ledger.kind,
    inventoryRestored: outcome.inventoryRestored,
    message: `Refund of $${(refundAmountCents / 100).toFixed(2)} processed. ${describeLedgerOutcome(outcome.ledger)}`,
  })
}
