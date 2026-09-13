import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabase } from '@/lib/supabase'
import { saleAdjustedCents } from '@/lib/sale'
import { publicOrigin } from '@/lib/publicOrigin'
import { STRIPE_METADATA_VALUE_LIMIT, nextTicketRef } from '@/lib/stripeSettlement'
import { screenPublicCount } from '@/lib/publicIntake'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { MAX_TICKETS_PER_ORDER } from '@/lib/ticketLimits'

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
  const limited = guardRate(req, plannerRule('cart-checkout'))
  if (limited) return limited

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

  /**
   * Every `quantity` is a whole number between 1 and the per-order ceiling before
   * anything else runs.
   *
   * It was multiplied into the price, into `overallSubtotalCents` (which the tax
   * and card-fee lines derive from), into `event_tickets.quantity` and into
   * `decrement_*_tickets(qty)`. A NEGATIVE value passed the inventory check
   * (`available_tickets < -5` is false) and inverts that decrement into an
   * inventory INCREASE; a fractional one reaches Stripe, which refuses it — so the
   * only thing standing between a stranger and a free seat on a free event was
   * which branch they happened to hit. See the same note in `events/checkout`.
   */
  for (let i = 0; i < items.length; i++) {
    const q = screenPublicCount(items[i]?.quantity, MAX_TICKETS_PER_ORDER)
    if (q === null) {
      return NextResponse.json(
        { error: `Cart item ${i + 1}: please choose between 1 and ${MAX_TICKETS_PER_ORDER} tickets.` },
        { status: 400 },
      )
    }
    items[i].quantity = q
    const sessionCount = items[i]?.sessionIds?.length ?? 0
    if (sessionCount > 60) {
      return NextResponse.json({ error: `Cart item ${i + 1}: too many sessions` }, { status: 400 })
    }
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
          const refResult = await nextTicketRef(supabase)
          if (!refResult.ok) {
            // The RPC this used to call HAD NEVER BEEN CREATED and the error was
            // discarded, so every ref here silently came from
            // `Date.now().slice(-4)` — a ten-second-wide space against a UNIQUE
            // column. Migration 046 creates it; this stops pretending it worked.
            console.error('Ticket ref allocation failed:', refResult.message)
            return NextResponse.json({ error: 'Could not issue a ticket. Please try again.' }, { status: 500 })
          }
          const ticketRef = refResult.ref
          ticketRefs.push(ticketRef)

          const { error: freeTicketErr } = await supabase.from('event_tickets').insert({
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
          if (freeTicketErr) {
            // A free ticket is still a promise to a real person: refusing beats a
            // confirmation email naming a row that was never written (rule 10).
            console.error('Free ticket insert failed:', freeTicketErr.message)
            return NextResponse.json({ error: 'Could not issue a ticket. Please try again.' }, { status: 500 })
          }
          await supabase.rpc('decrement_session_tickets', { sid, qty: meta.quantity })
        }
      } else {
        const refResult = await nextTicketRef(supabase)
        if (!refResult.ok) {
          // The RPC this used to call HAD NEVER BEEN CREATED and the error was
          // discarded, so every ref here silently came from
          // `Date.now().slice(-4)` — a ten-second-wide space against a UNIQUE
          // column. Migration 046 creates it; this stops pretending it worked.
          console.error('Ticket ref allocation failed:', refResult.message)
          return NextResponse.json({ error: 'Could not issue a ticket. Please try again.' }, { status: 500 })
        }
        const ticketRef = refResult.ref
        ticketRefs.push(ticketRef)

        const { error: freeTicketErr } = await supabase.from('event_tickets').insert({
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
        if (freeTicketErr) {
          // A free ticket is still a promise to a real person: refusing beats a
          // confirmation email naming a row that was never written (rule 10).
          console.error('Free ticket insert failed:', freeTicketErr.message)
          return NextResponse.json({ error: 'Could not issue a ticket. Please try again.' }, { status: 500 })
        }
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
  const origin = publicOrigin(req)

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

  // Stripe caps a single metadata VALUE at 500 characters. Measured against the
  // live API rather than taken from the docs: 500 is accepted, 600 is refused
  // with "Metadata values can have up to 500 characters".
  //
  // The webhook rebuilds every ticket from `cartItems`, and real carts have
  // already reached 303 characters at THREE items — so this route's advertised
  // 10-item cart could not fit, and `sessions.create` would have thrown with no
  // try/catch around it: an unhandled 500 on the checkout button. Nobody had hit
  // it yet because the largest real cart was three items.
  //
  // The keys are shortened so ten items do fit; the webhook reads both this
  // compact form and the long one, because sessions created before this deploy
  // are still out there.
  const compactCart = cartMeta.map(c => ({
    e: c.eventId,
    ...(c.sessionId ? { s: c.sessionId } : {}),
    ...(c.sessionIds ? { S: c.sessionIds } : {}),
    q: c.quantity,
    ...(c.variantLabel ? { v: c.variantLabel } : {}),
    p: c.unitPriceCents,
    t: c.eventTitle,
  }))
  const cartJson = JSON.stringify(compactCart)
  if (cartJson.length > STRIPE_METADATA_VALUE_LIMIT) {
    // Refusing with a reason the customer can act on beats a 500 they cannot.
    return NextResponse.json({
      error: `This cart has too many different events to check out in one go (${items.length}). Please split it into two orders.`,
    }, { status: 400 })
  }

  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: customerEmail,
      line_items: lineItems,
      metadata: {
        type: 'cart_checkout',
        cartItems: cartJson,
        customerName,
        customerEmail,
        customerPhone,
        marketingConsent: body.marketingConsent ? 'true' : 'false',
      },
      success_url: `${origin}/events/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/events?cancelled=true`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stripe checkout failed'
    console.error('Cart checkout: Stripe session create failed:', message)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }

  return NextResponse.json({ url: session.url })
}
