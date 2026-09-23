/**
 * Place the refundable $250 damage hold on a studio rental.
 *
 * Mints a Stripe Checkout Session with `capture_method: 'manual'`, so the
 * customer's card is AUTHORIZED and never charged. See lib/securityHold.ts for
 * what this money is and — more importantly — what it is not.
 *
 * ── What this route refuses to take from the caller ────────────────────────
 *
 * The amount. It comes from the pricing catalog (`studio_security_hold`) and
 * the same `securityHoldOffer` the document consulted to decide whether to draw
 * the button. A hold amount posted in a request body is a number the customer
 * chooses, and R6 on this codebase is that no figure that becomes a card
 * operation ever arrives from the client.
 *
 * The window is re-evaluated here too, not trusted from the fact that the page
 * drew a button. A page is a cached render and a button is a URL someone can
 * keep; the server owns whether the link is live.
 */

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabase } from '@/lib/supabase'
import { planAccess } from '@/lib/planAccess'
import { loadPlanInvoice } from '@/lib/planInvoice'
import { publicOrigin } from '@/lib/publicOrigin'
import { securityHoldOffer, HOLD_SESSION_TYPE } from '@/lib/securityHold'
import { guardRate, plannerRule } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ ref: string }> }) {
  // FIRST, before even awaiting the params. Bounded like every other plan route
  // that mints a Stripe object — each call creates a real Checkout Session, and
  // an unbounded one is a way to make us generate them forever. A limiter that
  // runs after the handler has started work is decoration, which is exactly
  // what R1's "the guard runs BEFORE the handler does any work" checks.
  const limited = guardRate(req, plannerRule('plan/security-hold'))
  if (limited) return limited

  const { ref } = await ctx.params

  const access = planAccess(req.headers.get('cookie'), ref)
  if (!access.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('security hold: STRIPE_SECRET_KEY is not set')
    return NextResponse.json({ error: 'Card payments are unavailable right now.' }, { status: 503 })
  }

  const supabase = getSupabase()
  const result = await loadPlanInvoice(ref, supabase)
  if (!result.ok) {
    // A plan we could not READ is a 503, never a 404 — the same rule the pay
    // route and the summary page already keep. Telling a customer mid-payment
    // that their booking has vanished is the one answer that is never right.
    if (result.notFound) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    console.error('security hold: invoice load failed:', result.error)
    return NextResponse.json({ error: 'We could not load this booking. Please try again.' }, { status: 503 })
  }
  const invoice = result.invoice

  const offer = securityHoldOffer({
    partyType: invoice.partyType,
    partyDate: invoice.booking.party_date,
    status: invoice.booking.status,
    securityDepositStatus: invoice.booking.security_deposit_status,
    amountCents: invoice.securityHoldCents,
  })

  if (offer.state === 'done') {
    return NextResponse.json({ error: 'The security hold is already on file for this rental.' }, { status: 409 })
  }
  if (offer.state !== 'offer') {
    // Covers too-early, past, cancelled and not-a-rental in one refusal. The
    // reason is deliberately not itemised back to the caller — the page already
    // explains the window, and this is the guard, not the explanation.
    return NextResponse.json(
      { error: 'The security hold is not open for this rental right now.' },
      { status: 409 },
    )
  }

  const origin = publicOrigin(req)
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: invoice.booking.contact_email || undefined,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Refundable security hold — ${invoice.booking.booking_ref}`,
            description:
              'An authorization on your card, not a charge. It is released after your rental once the space is confirmed in good condition.',
          },
          unit_amount: offer.amountCents,
        },
        quantity: 1,
      }],
      // The whole point: authorize, never capture.
      payment_intent_data: {
        capture_method: 'manual',
        description: `Studio damage hold — ${invoice.booking.booking_ref}`,
        metadata: { type: HOLD_SESSION_TYPE, booking_ref: invoice.booking.booking_ref },
      },
      // Carried on the SESSION as well, because the webhook branch reads
      // `session.metadata` — the PaymentIntent copy above is for the Stripe
      // dashboard, where a human looking at a stray auth needs to see the ref.
      metadata: { type: HOLD_SESSION_TYPE, booking_ref: invoice.booking.booking_ref },
      success_url: `${origin}/plan/${encodeURIComponent(ref)}/summary?hold=1`,
      cancel_url: `${origin}/plan/${encodeURIComponent(ref)}/summary`,
    })

    if (!session.url) {
      console.error(`security hold: Stripe returned no URL for ${invoice.booking.booking_ref}`)
      return NextResponse.json({ error: 'Could not start the hold. Please try again.' }, { status: 502 })
    }
    return NextResponse.json({ url: session.url })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`security hold: Stripe session failed for ${invoice.booking.booking_ref}:`, message)
    return NextResponse.json({ error: 'Could not start the hold. Please try again.' }, { status: 502 })
  }
}
