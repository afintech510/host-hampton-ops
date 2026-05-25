import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabase } from '@/lib/supabase'

/**
 * UI reconciliation after embedded Stripe Checkout returns.
 *
 * Responsibility split:
 *   - confirm-session (this route): writes the payment row + updates booking
 *     balance/status/date_locked so the planner UI reflects the new state
 *     immediately. Idempotent via stripe_session_id.
 *   - webhook (/api/webhook): sole sender of emails + financials + audit log
 *     + portal token regen + reminder enqueue. Runs in prod when Stripe fires
 *     checkout.session.completed.
 *
 * In local dev the webhook may not fire; emails won't be sent unless you run
 * `stripe listen --forward-to localhost:3002/api/webhook`. The DB state will
 * still be correct from this route alone.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { session_id?: string; payment_intent?: string }
    const sessionId = body.session_id
    const paymentIntentId = body.payment_intent
    if (!sessionId && !paymentIntentId) {
      return NextResponse.json({ error: 'session_id or payment_intent required' }, { status: 400 })
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY
    if (!stripeKey) return NextResponse.json({ error: 'stripe not configured' }, { status: 500 })

    const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' })

    // Pull metadata + amount from EITHER a Checkout Session or a PaymentIntent.
    let m: Record<string, string>
    let resolvedPaymentIntentId: string | null
    let resolvedSessionId: string | null
    let amountTotal: number
    let isPaid: boolean

    if (paymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId)
      m = (pi.metadata || {}) as Record<string, string>
      resolvedPaymentIntentId = pi.id
      resolvedSessionId = null
      amountTotal = pi.amount
      isPaid = pi.status === 'succeeded'
    } else {
      const session = await stripe.checkout.sessions.retrieve(sessionId!)
      m = (session.metadata || {}) as Record<string, string>
      resolvedPaymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : null
      resolvedSessionId = session.id
      amountTotal = session.amount_total || 0
      isPaid = session.payment_status === 'paid'
    }

    if (!isPaid) {
      return NextResponse.json({ ok: false, paid: false })
    }

    if (m.type !== 'party_builder') {
      return NextResponse.json({ ok: false, error: 'not a party_builder payment' }, { status: 400 })
    }

    const bookingRef = m.booking_ref
    const bookingId = m.booking_id
    const paymentType = (m.payment_type || 'deposit') as 'deposit' | 'partial' | 'final'
    const depositCents = parseInt(m.depositCents || '0', 10)
    const cardFeeCents = parseInt(m.cardFeeCents || '0', 10)
    const tipCents = parseInt(m.tipCents || '0', 10)
    const amountCents = paymentType === 'deposit' ? depositCents : parseInt(m.amountCents || '0', 10)
    const totalCharged = amountTotal || amountCents + tipCents + cardFeeCents

    const supabase = getSupabase()

    // Idempotency — if webhook (or this route) already recorded, return success
    let existingPaymentQuery = supabase.from('booking_payments').select('id').limit(1)
    if (resolvedPaymentIntentId) {
      existingPaymentQuery = existingPaymentQuery.eq('stripe_payment_intent_id', resolvedPaymentIntentId)
    } else if (resolvedSessionId) {
      existingPaymentQuery = existingPaymentQuery.eq('stripe_session_id', resolvedSessionId)
    }
    const { data: existing } = await existingPaymentQuery.maybeSingle()
    if (existing) {
      return NextResponse.json({ ok: true, alreadyRecorded: true, bookingRef })
    }

    // Insert payment row. Webhook may race; unique-constraint failures are silent.
    const { error: payErr } = await supabase.from('booking_payments').insert({
      booking_id: bookingId,
      payment_type: paymentType,
      payment_method: 'card',
      amount_cents: amountCents,
      card_fee_cents: cardFeeCents,
      total_charged_cents: totalCharged,
      stripe_payment_intent_id: resolvedPaymentIntentId,
      stripe_session_id: resolvedSessionId,
      recorded_by: 'system',
      notes: tipCents > 0 ? `Includes $${(tipCents / 100).toFixed(2)} tip for party helpers` : null,
    })
    if (payErr) console.error('confirm-session payment insert error:', payErr)

    // Recalculate balance from all payments
    const { data: payments } = await supabase
      .from('booking_payments')
      .select('amount_cents, payment_type')
      .eq('booking_id', bookingId)

    let paid = 0
    for (const p of payments || []) {
      if (p.payment_type === 'refund') paid -= p.amount_cents
      else paid += p.amount_cents
    }

    const { data: bk } = await supabase
      .from('bookings')
      .select('total_cents, party_tags')
      .eq('id', bookingId)
      .single()

    const newBalance = Math.max(0, (bk?.total_cents || 0) - paid)
    const updateFields: Record<string, unknown> = { balance_due_cents: newBalance }

    if (paymentType === 'deposit') {
      updateFields.status = 'pending_review'
      const existingTags = (bk?.party_tags as Record<string, unknown> | null) || {}
      updateFields.party_tags = { ...existingTags, date_locked: true }
    }
    if (newBalance === 0) {
      updateFields.paid_in_full_at = new Date().toISOString()
      updateFields.status = 'paid_in_full'
    }
    await supabase.from('bookings').update(updateFields).eq('id', bookingId)

    return NextResponse.json({
      ok: true,
      paid: true,
      bookingRef,
      paymentType,
      amountCents,
      newBalance,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'confirm-session failed'
    console.error('confirm-session error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
