import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabase } from '@/lib/supabase'
import { saleAdjustedCents } from '@/lib/sale'

export const dynamic = 'force-dynamic'

const TAX_RATE = 0.0875
const CC_RATE = 0.03

interface CartRequestItem {
  eventId: string
  sessionId: string | null
  sessionIds: string[] | null
  quantity: number
  variantLabel: string | null
}

export async function POST(req: NextRequest) {
  const supabase = getSupabase()
  const body = await req.json()
  const { items, customerName, customerEmail, customerPhone } = body as {
    items: CartRequestItem[]
    customerName: string
    customerEmail: string
    customerPhone: string
    marketingConsent?: boolean
  }

  if (!items?.length || !customerName || !customerEmail || !customerPhone) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (items.length > 10) {
    return NextResponse.json({ error: 'Maximum 10 items per cart' }, { status: 400 })
  }

  // Collect unique event IDs
  const eventIds = Array.from(new Set(items.map(i => i.eventId)))
  const { data: events, error: eventsErr } = await supabase
    .from('events')
    .select('*')
    .in('id', eventIds)

  if (eventsErr || !events) {
    return NextResponse.json({ error: 'Failed to load events' }, { status: 500 })
  }

  const eventsMap = new Map(events.map(e => [e.id, e]))

  // Validate each item and build Stripe line items
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = []
  // Compact cart data for webhook metadata
  const cartMeta: {
    eventId: string
    sessionId?: string
    sessionIds?: string[]
    quantity: number
    variantLabel?: string
    unitPriceCents: number
    eventTitle: string
  }[] = []

  let allFree = true
  let overallSubtotalCents = 0

  // Collect all session IDs we need to fetch
  const allSessionIds: string[] = []
  for (const item of items) {
    if (item.sessionIds?.length) {
      allSessionIds.push(...item.sessionIds)
    } else if (item.sessionId) {
      allSessionIds.push(item.sessionId)
    }
  }

  // Bulk-fetch sessions
  let sessionsMap = new Map<string, any>()
  if (allSessionIds.length > 0) {
    const { data: sessionsData } = await supabase
      .from('event_sessions')
      .select('*')
      .in('id', allSessionIds)
      .eq('is_active', true)
    for (const s of sessionsData || []) {
      sessionsMap.set(s.id, s)
    }
  }

  for (const item of items) {
    const event = eventsMap.get(item.eventId)
    if (!event) {
      return NextResponse.json({ error: `Event not found: ${item.eventId}` }, { status: 404 })
    }

    // Determine unit price (base, variant, or session); the flash-sale discount
    // is applied to the resolved price in each branch below.
    let unitPriceCents = event.price_cents
    if (item.variantLabel && event.has_variants && event.variants) {
      const variant = event.variants.find((v: any) => v.label === item.variantLabel)
      if (variant) unitPriceCents = variant.priceCents
    }

    // Multi-session handling
    if (item.sessionIds?.length) {
      // Verify all sessions exist and have availability
      for (const sid of item.sessionIds) {
        const sess = sessionsMap.get(sid)
        if (!sess) {
          return NextResponse.json({ error: `Session not found for ${event.title}` }, { status: 404 })
        }
        if (sess.available_tickets < item.quantity) {
          return NextResponse.json({
            error: `Not enough tickets for ${event.title} on ${sess.session_date}`,
          }, { status: 400 })
        }
      }

      // Bundle pricing
      if (event.allow_multi_session && event.bundle_pricing?.length > 0) {
        const sorted = [...event.bundle_pricing].sort((a: any, b: any) => b.minSessions - a.minSessions)
        const tier = sorted.find((t: any) => item.sessionIds!.length >= t.minSessions)
        if (tier) unitPriceCents = tier.pricePerSessionCents
      }

      unitPriceCents = saleAdjustedCents(unitPriceCents, event)

      const itemTotal = unitPriceCents * item.sessionIds.length * item.quantity
      overallSubtotalCents += itemTotal

      if (unitPriceCents > 0) allFree = false

      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${event.title} (${item.sessionIds.length} sessions)`,
            description: `${item.quantity} ticket${item.quantity > 1 ? 's' : ''}`,
          },
          unit_amount: itemTotal,
        },
        quantity: 1,
      })

      cartMeta.push({
        eventId: item.eventId,
        sessionIds: item.sessionIds,
        quantity: item.quantity,
        variantLabel: item.variantLabel || undefined,
        unitPriceCents,
        eventTitle: event.title,
      })
    } else {
      // Single session or no session
      if (item.sessionId) {
        const sess = sessionsMap.get(item.sessionId)
        if (!sess) {
          return NextResponse.json({ error: `Session not found for ${event.title}` }, { status: 404 })
        }
        if (sess.available_tickets < item.quantity) {
          return NextResponse.json({
            error: `Not enough tickets for ${event.title} on ${sess.session_date}`,
          }, { status: 400 })
        }
        if (sess.price_cents != null) unitPriceCents = sess.price_cents
      } else {
        if (event.available_tickets < item.quantity) {
          return NextResponse.json({ error: `Not enough tickets for ${event.title}` }, { status: 400 })
        }
      }

      unitPriceCents = saleAdjustedCents(unitPriceCents, event)

      const itemTotal = unitPriceCents * item.quantity
      overallSubtotalCents += itemTotal

      if (unitPriceCents > 0) allFree = false

      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${event.title}${item.variantLabel ? ` (${item.variantLabel})` : ''}`,
            description: `${item.quantity} ticket${item.quantity > 1 ? 's' : ''}`,
          },
          unit_amount: unitPriceCents,
        },
        quantity: item.quantity,
      })

      cartMeta.push({
        eventId: item.eventId,
        sessionId: item.sessionId || undefined,
        quantity: item.quantity,
        variantLabel: item.variantLabel || undefined,
        unitPriceCents,
        eventTitle: event.title,
      })
    }
  }

  // Handle all-free cart (no Stripe needed)
  if (allFree) {
    const cartRef = `CART-${Date.now()}`
    const ticketRefs: string[] = []

    for (const meta of cartMeta) {
      if (meta.sessionIds?.length) {
        for (const sid of meta.sessionIds) {
          const { data: seqData } = await supabase.rpc('nextval_event_ticket_seq')
          const seqNum = seqData ?? Date.now().toString().slice(-4)
          const ticketRef = `HH-EVT-${String(seqNum).padStart(4, '0')}`
          ticketRefs.push(ticketRef)

          await supabase.from('event_tickets').insert({
            ticket_ref: ticketRef,
            event_id: meta.eventId,
            session_id: sid,
            group_ref: cartRef,
            customer_name: customerName,
            customer_email: customerEmail,
            customer_phone: customerPhone,
            quantity: meta.quantity,
            variant_label: meta.variantLabel || null,
            unit_price_cents: 0,
            total_cents: 0,
            status: 'confirmed',
          })
          await supabase.rpc('decrement_session_tickets', { sid, qty: meta.quantity })
        }
      } else {
        const { data: seqData } = await supabase.rpc('nextval_event_ticket_seq')
        const seqNum = seqData ?? Date.now().toString().slice(-4)
        const ticketRef = `HH-EVT-${String(seqNum).padStart(4, '0')}`
        ticketRefs.push(ticketRef)

        await supabase.from('event_tickets').insert({
          ticket_ref: ticketRef,
          event_id: meta.eventId,
          session_id: meta.sessionId || null,
          group_ref: cartRef,
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone,
          quantity: meta.quantity,
          variant_label: meta.variantLabel || null,
          unit_price_cents: 0,
          total_cents: 0,
          status: 'confirmed',
        })
        if (meta.sessionId) {
          await supabase.rpc('decrement_session_tickets', { sid: meta.sessionId, qty: meta.quantity })
        } else {
          await supabase.rpc('decrement_event_tickets', { eid: meta.eventId, qty: meta.quantity })
        }
      }
    }

    return NextResponse.json({ url: `/events/success?ref=${cartRef}` })
  }

  // Paid cart: create Stripe checkout session
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'www.hosthampton.com'

  // Add tax + CC fee as line items
  const taxCents = Math.round(overallSubtotalCents * TAX_RATE)
  const ccFeeCents = Math.round((overallSubtotalCents + taxCents) * CC_RATE)

  lineItems.push(
    {
      price_data: {
        currency: 'usd',
        product_data: { name: 'Sales Tax (8.75%)' },
        unit_amount: taxCents,
      },
      quantity: 1,
    },
    {
      price_data: {
        currency: 'usd',
        product_data: { name: 'Processing Fee (3%)' },
        unit_amount: ccFeeCents,
      },
      quantity: 1,
    },
  )

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: customerEmail,
    line_items: lineItems,
    metadata: {
      type: 'cart_checkout',
      cartItems: JSON.stringify(cartMeta),
      customerName,
      customerEmail,
      customerPhone,
      marketingConsent: body.marketingConsent ? 'true' : 'false',
    },
    success_url: `https://${host}/events/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `https://${host}/events?cancelled=true`,
  })

  return NextResponse.json({ url: session.url })
}
