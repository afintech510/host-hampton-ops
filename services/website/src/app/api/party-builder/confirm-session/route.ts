import { NextRequest, NextResponse } from 'next/server'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import Stripe from 'stripe'
import { getSupabase } from '@/lib/supabase'
import { readBalanceInputs, computeBalance } from '@/lib/bookingBalance'
import { isUniqueViolation } from '@/lib/planPayment'

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
  const limited = guardRate(req, plannerRule('party-builder/confirm-session'))
  if (limited) return limited

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
    const { data: existing, error: existingErr } = await existingPaymentQuery.maybeSingle()
    if (existingErr) console.error('confirm-session: idempotency read failed —', existingErr.message)
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
    if (payErr && !isUniqueViolation(payErr)) {
      // Not a redelivery: this money is NOT in `booking_payments`, so the balance
      // below would be computed without it and understate what has been paid.
      // The webhook is the authoritative writer; say what happened instead of
      // storing a figure already known to be wrong.
      console.error('confirm-session payment insert error:', payErr.message)
      return NextResponse.json(
        { ok: true, paid: true, bookingRef, recorded: false, note: 'Payment received; your plan will update shortly.' },
      )
    }
    if (payErr) console.log('confirm-session: payment already recorded (duplicate), reconciling balance')

    // Recalculate balance from all payments — ONE definition of "what does this
    // booking owe", shared with the webhook and the admin panel.
    //
    // This was four lines with both reads discarded and `(bk?.total_cents || 0)`,
    // so a Supabase blip — or a plan nobody has priced, which is every lead —
    // made `max(0, 0 - paid)` zero and wrote `status = 'paid_in_full'` plus
    // `paid_in_full_at` on a party that had just paid a deposit. Rules 12 and 19,
    // on the main kids-party money path. `computeBalance` will not call an
    // unpriced booking settled.
    const inputs = await readBalanceInputs(supabase, bookingId, 'total_cents, party_tags')
    if (!inputs.ok) {
      console.error('confirm-session: balance inputs unreadable —', inputs.message)
      return NextResponse.json(
        { ok: true, paid: true, bookingRef, paymentType, amountCents, balanceUnknown: true, note: 'Payment recorded; balance will update shortly.' },
      )
    }
    const { balanceCents: newBalance, paidInFull } = computeBalance(
      inputs.row.total_cents as number | null,
      inputs.paidSum,
    )
    const updateFields: Record<string, unknown> = { balance_due_cents: newBalance }

    if (paymentType === 'deposit') {
      updateFields.status = 'pending_review'
      const existingTags = (inputs.row.party_tags as Record<string, unknown> | null) || {}
      updateFields.party_tags = { ...existingTags, date_locked: true }
    }
    if (paidInFull) {
      updateFields.paid_in_full_at = new Date().toISOString()
      updateFields.status = 'paid_in_full'
    }
    const { error: updErr } = await supabase.from('bookings').update(updateFields).eq('id', bookingId)
    if (updErr) {
      // The UI is about to show a balance this write did not store.
      console.error('confirm-session booking update error:', updErr.message)
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }

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
