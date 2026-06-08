import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabase } from '@/lib/supabase'

/**
 * UI reconciliation after the in-page Studio Rental Payment Element succeeds.
 *
 * Responsibility split (same as the party flow):
 *   - confirm-session (this route): writes the payment row + updates booking
 *     balance/status/date_locked so the success page reflects state immediately.
 *     Idempotent via stripe_payment_intent_id.
 *   - webhook (/api/webhook, studio_rental branch): sole sender of emails +
 *     financials + audit log + GCal block + portal token + reminders.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { payment_intent?: string }
    const paymentIntentId = body.payment_intent
    if (!paymentIntentId) {
      return NextResponse.json({ error: 'payment_intent required' }, { status: 400 })
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY
    if (!stripeKey) return NextResponse.json({ error: 'stripe not configured' }, { status: 500 })
    const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' })

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId)
    const m = (pi.metadata || {}) as Record<string, string>

    if (pi.status !== 'succeeded') {
      return NextResponse.json({ ok: false, paid: false })
    }
    if (m.type !== 'studio_rental') {
      return NextResponse.json({ ok: false, error: 'not a studio_rental payment' }, { status: 400 })
    }

    const bookingRef = m.booking_ref
    const bookingId = m.booking_id
    const depositCents = parseInt(m.depositCents || '0', 10)
    const cardFeeCents = parseInt(m.cardFeeCents || '0', 10)

    const supabase = getSupabase()

    // Idempotency — if the webhook (or this route) already recorded, return success
    const { data: existing } = await supabase
      .from('booking_payments')
      .select('id')
      .eq('stripe_payment_intent_id', pi.id)
      .limit(1)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ ok: true, alreadyRecorded: true, bookingRef })
    }

    const { error: payErr } = await supabase.from('booking_payments').insert({
      booking_id: bookingId,
      payment_type: 'deposit',
      payment_method: 'card',
      amount_cents: depositCents,
      card_fee_cents: cardFeeCents,
      total_charged_cents: pi.amount,
      stripe_payment_intent_id: pi.id,
      stripe_session_id: null,
      recorded_by: 'system',
    })
    if (payErr) console.error('studio confirm-session payment insert error:', payErr)

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
    const existingTags = (bk?.party_tags as Record<string, unknown> | null) || {}
    const updateFields: Record<string, unknown> = {
      balance_due_cents: newBalance,
      status: newBalance === 0 ? 'paid_in_full' : 'pending_review',
      party_tags: { ...existingTags, date_locked: true },
    }
    if (newBalance === 0) updateFields.paid_in_full_at = new Date().toISOString()
    await supabase.from('bookings').update(updateFields).eq('id', bookingId)

    return NextResponse.json({ ok: true, paid: true, bookingRef, newBalance })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'confirm-session failed'
    console.error('studio confirm-session error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
