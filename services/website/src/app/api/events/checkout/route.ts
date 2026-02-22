import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabase } from '@/lib/supabase'
import { Resend } from 'resend'
import { ticketConfirmationHtml, ticketPurchaseNotifyHtml } from '@/lib/emailTemplates'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = getSupabase()
  const body = await req.json()
  const { eventId, sessionId, quantity, variantLabel, customerName, customerEmail, customerPhone } = body

  if (!eventId || !customerName || !customerEmail || !quantity) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Fetch event
  const { data: event, error: eventErr } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .single()

  if (eventErr || !event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  }

  // Determine unit price
  let unitPriceCents = event.price_cents
  if (variantLabel && event.has_variants && event.variants) {
    const variant = event.variants.find((v: any) => v.label === variantLabel)
    if (variant) unitPriceCents = variant.priceCents
  }

  // If session, check session availability and optional price override
  let sessionRow = null
  if (sessionId) {
    const { data: sess } = await supabase
      .from('event_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()
    if (!sess) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    if (sess.available_tickets < quantity) {
      return NextResponse.json({ error: 'Not enough tickets available for this session' }, { status: 400 })
    }
    if (sess.price_cents != null) unitPriceCents = sess.price_cents
    sessionRow = sess
  } else {
    // Check event-level availability
    if (event.available_tickets < quantity) {
      return NextResponse.json({ error: 'Not enough tickets available' }, { status: 400 })
    }
  }

  const totalCents = unitPriceCents * quantity
  const isFree = unitPriceCents === 0

  // For FREE events: skip Stripe, create ticket directly
  if (isFree) {
    const { data: seqData } = await supabase.rpc('nextval_event_ticket_seq')
    const seqNum = seqData ?? Date.now().toString().slice(-4)
    const ticketRef = `HH-EVT-${String(seqNum).padStart(4, '0')}`

    const { error: insertErr } = await supabase.from('event_tickets').insert({
      ticket_ref: ticketRef,
      event_id: eventId,
      session_id: sessionId || null,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone || null,
      quantity,
      variant_label: variantLabel || null,
      unit_price_cents: 0,
      total_cents: 0,
      status: 'confirmed',
    })

    if (insertErr) {
      console.error('Free ticket insert error:', insertErr)
      return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 })
    }

    // Decrement available tickets
    if (sessionId) {
      await supabase.rpc('decrement_session_tickets', { sid: sessionId, qty: quantity })
    } else {
      await supabase.rpc('decrement_event_tickets', { eid: eventId, qty: quantity })
    }

    // Send emails
    const dateDisplay = sessionRow?.session_date
      ? new Date(sessionRow.session_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : event.event_date
        ? new Date(event.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        : 'TBD'

    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
      await Promise.allSettled([
        resend.emails.send({
          from, to: customerEmail,
          subject: `You're in! ${event.title} at Host Hampton`,
          html: ticketConfirmationHtml({
            customerName, eventTitle: event.title, eventDate: dateDisplay,
            eventTime: sessionRow?.session_time || event.event_time || '', location: event.location,
            quantity, variantLabel, totalFormatted: 'Free', ticketRef, isFree: true,
          }),
        }),
        resend.emails.send({
          from, to: 'hosthampton295@gmail.com',
          subject: `New RSVP: ${customerName} — ${event.title} (${ticketRef})`,
          html: ticketPurchaseNotifyHtml({
            ticketRef, customerName, customerEmail, customerPhone,
            eventTitle: event.title, eventDate: dateDisplay,
            eventTime: sessionRow?.session_time || event.event_time || '',
            quantity, variantLabel, totalFormatted: 'Free', isFree: true,
          }),
        }),
      ])
      console.log('Free RSVP confirmed:', ticketRef, customerEmail)
    }

    return NextResponse.json({ url: `/events/success?ref=${ticketRef}` })
  }

  // PAID events: create Stripe checkout session
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'staging.hosthampton.com'

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: customerEmail,
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: `${event.title}${variantLabel ? ` (${variantLabel})` : ''}` },
        unit_amount: unitPriceCents,
      },
      quantity,
    }],
    metadata: {
      type: 'event_ticket',
      eventId,
      sessionId: sessionId || '',
      quantity: String(quantity),
      variantLabel: variantLabel || '',
      customerName,
      customerEmail,
      customerPhone: customerPhone || '',
    },
    success_url: `https://${host}/events/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `https://${host}/events/${event.slug}?cancelled=true`,
  })

  return NextResponse.json({ url: session.url })
}
