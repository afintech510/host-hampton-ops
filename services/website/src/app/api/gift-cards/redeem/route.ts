import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { redeemGiftCard } from '@/lib/stripeSettlement'

/**
 * Spend against a gift card.
 *
 * This used to read the balance, subtract in JavaScript and write the result
 * back. Two requests racing both read the same balance and both "succeeded",
 * which spends a card twice — and it was the FOURTH copy of that same
 * read-modify-write in this codebase (the webhook had two, `events/checkout` a
 * third). `redeem_gift_card` (migration 046) is now the one implementation:
 * `SELECT … FOR UPDATE`, the deduction clamped to the balance, and `redeemed_at`
 * preserved rather than recomputed.
 */
export async function POST(req: NextRequest) {
  const { code, amountCents, reference } = await req.json()

  if (!code || !amountCents || !reference) {
    return NextResponse.json({ error: 'code, amountCents, and reference are required' }, { status: 400 })
  }

  const supabase = getSupabase()
  const result = await redeemGiftCard(supabase, String(code).trim().toUpperCase(), Number(amountCents))

  // Three outcomes, not two: "the database was unreachable" is not "no such
  // card", and answering 404 to it tells the caller a false thing about a
  // customer's money (rule 12).
  if (result.outcome === 'unavailable') {
    console.error('Gift card redeem failed:', result.message)
    return NextResponse.json({ error: 'Could not reach the gift card store. Please try again.' }, { status: 503 })
  }
  if (result.outcome === 'no_active_card') {
    return NextResponse.json({ error: 'Gift card not found or inactive' }, { status: 404 })
  }
  if (result.redeemedCents === 0) {
    return NextResponse.json({ error: 'Gift card has no remaining balance' }, { status: 400 })
  }

  console.log(`Gift card ${code} redeemed ${result.redeemedCents}c for ${reference}. New balance: ${result.newBalanceCents}c`)

  return NextResponse.json({
    deductedCents: result.redeemedCents,
    remainingBalanceCents: result.newBalanceCents,
    remainingBalanceFormatted: `$${(result.newBalanceCents / 100).toFixed(2)}`,
    fullyRedeemed: result.newBalanceCents === 0,
  })
}
