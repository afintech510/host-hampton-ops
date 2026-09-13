import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabase } from '@/lib/supabase'
import { readBalanceInputs, computeBalance } from '@/lib/bookingBalance'
import { isUniqueViolation } from '@/lib/planPayment'
import { guardRate, plannerRule } from '@/lib/rateLimit'

/**
 * UI reconciliation after the in-page Studio Rental Payment Element succeeds.
 *
 * Responsibility split (same as the party flow):
 *   - confirm-session (this route): writes the payment row + updates booking
 *     balance/status/date_locked so the success page reflects state immediately.
 *     Idempotent via stripe_payment_intent_id.
 *   - webhook (/api/webhook, studio_rental branch): sole sender of emails +
 *     financials + audit log + GCal block + portal token + reminders.
 *
 * THE BALANCE IS NOT COMPUTED HERE. It used to be, in four lines that were the
 * exact shape `lib/bookingBalance.ts` was extracted to kill:
 *
 *   const { data: payments } = await supabase…               // error discarded
 *   const { data: bk } = await supabase…single()             // error discarded
 *   const newBalance = Math.max(0, (bk?.total_cents || 0) - paid)
 *   status: newBalance === 0 ? 'paid_in_full' : 'pending_review'
 *
 * A Supabase blip on either read therefore wrote `status = 'paid_in_full'` and
 * `paid_in_full_at` on a real studio rental whose customer had just paid a $250
 * deposit — and so did a booking whose `total_cents` is legitimately 0 or null,
 * which is every plan nobody has priced yet. Rules 12 and 19 in their money form.
 * `computeBalance` refuses to call an unpriced booking settled and
 * `readBalanceInputs` has no outcome that means "treat a failure as zero".
 */
export async function POST(req: NextRequest) {
  const limited = guardRate(req, plannerRule('studio-rental/confirm-session'))
  if (limited) return limited

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

    // Idempotency — if the webhook (or this route) already recorded, return success.
    // A FAILED read is not "no prior payment": falling through would attempt a
    // duplicate insert, which the unique index on `stripe_payment_intent_id`
    // refuses (that is the real guard), but the error was discarded either way.
    // Read it, and let 23505 mean "already recorded" by CODE, not message text.
    const { data: existing, error: existingErr } = await supabase
      .from('booking_payments')
      .select('id')
      .eq('stripe_payment_intent_id', pi.id)
      .limit(1)
      .maybeSingle()
    if (existingErr) console.error('studio confirm-session: idempotency read failed —', existingErr.message)
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
    if (payErr && !isUniqueViolation(payErr)) {
      // Not a redelivery — this money is not in `booking_payments`. The balance
      // below would then be computed WITHOUT it, which understates what the
      // customer has paid. Say so rather than writing a figure we know is wrong;
      // the webhook is the authoritative writer and will record it.
      console.error('studio confirm-session payment insert error:', payErr.message)
      return NextResponse.json(
        { ok: true, paid: true, bookingRef, recorded: false, note: 'Payment received; your booking will update shortly.' },
      )
    }
    if (payErr) console.log('studio confirm-session: payment already recorded (duplicate), reconciling balance')

    // Recalculate balance from all payments — one definition, three outcomes.
    const inputs = await readBalanceInputs(supabase, bookingId, 'total_cents, party_tags')
    if (!inputs.ok) {
      // The money is recorded; only the derived balance is unknown. Saying so is
      // the whole point — the alternative wrote `paid_in_full` over a $250
      // deposit. The webhook recomputes this authoritatively.
      console.error('studio confirm-session: balance inputs unreadable —', inputs.message)
      return NextResponse.json(
        { ok: true, paid: true, bookingRef, balanceUnknown: true, note: 'Payment recorded; balance will update shortly.' },
      )
    }
    const { balanceCents: newBalance, paidInFull } = computeBalance(
      inputs.row.total_cents as number | null,
      inputs.paidSum,
    )
    const existingTags = (inputs.row.party_tags as Record<string, unknown> | null) || {}
    const updateFields: Record<string, unknown> = {
      balance_due_cents: newBalance,
      status: paidInFull ? 'paid_in_full' : 'pending_review',
      party_tags: { ...existingTags, date_locked: true },
    }
    if (paidInFull) updateFields.paid_in_full_at = new Date().toISOString()
    const { error: updErr } = await supabase.from('bookings').update(updateFields).eq('id', bookingId)
    if (updErr) {
      console.error('studio confirm-session booking update error:', updErr.message)
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, paid: true, bookingRef, newBalance })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'confirm-session failed'
    console.error('studio confirm-session error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
