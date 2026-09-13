import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { redeemGiftCard } from '@/lib/stripeSettlement'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { boundedIntakeText } from '@/lib/publicIntake'

/**
 * Spend against a gift card.
 *
 * ── WHY THIS IS NOW ADMIN-ONLY ──
 *
 * It was public, unauthenticated, and **nothing in the codebase calls it.**
 * Measured: zero references anywhere in `src/`, and zero requests in the whole
 * ten-day nginx window. What it does is deduct money from a customer's gift card,
 * with the amount supplied by the caller and a free-text `reference` that is only
 * written to the log — so a successful call leaves no record tying the spend to an
 * order. Anyone who learned a code (a forwarded gift email, a card handed over at
 * the studio, a screenshot) could zero it from the internet, and
 * `/api/gift-cards/validate` beside it will confirm a code and its balance for
 * free.
 *
 * The real redemption paths are `events/checkout` and the Stripe webhook, which
 * call `redeemGiftCard` themselves against an actual order. This endpoint is kept
 * rather than deleted — it is documented in the original build notes and may be
 * wanted for an in-person sale — but it now requires the admin credential, which
 * is the same standard as every other route that moves money by hand.
 *
 * The deduction itself was already right: `redeem_gift_card` (migration 046) is
 * `SELECT … FOR UPDATE`, the deduction clamped to the balance, and `redeemed_at`
 * preserved rather than recomputed. It replaced the FOURTH copy of a
 * read-modify-write that spent a card twice under a race.
 */
export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const { code, amountCents, reference } = await req.json()

  if (!code || !amountCents || !reference) {
    return NextResponse.json({ error: 'code, amountCents, and reference are required' }, { status: 400 })
  }

  const cents = Number(amountCents)
  if (!Number.isInteger(cents) || cents <= 0 || cents > 5_000_000) {
    return NextResponse.json({ error: 'amountCents must be a whole number of cents' }, { status: 400 })
  }

  const ref = boundedIntakeText(reference, 200)
  if (!ref) return NextResponse.json({ error: 'reference is required' }, { status: 400 })

  const supabase = getSupabase()
  const result = await redeemGiftCard(supabase, String(code).trim().toUpperCase(), cents)

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

  console.log(`Gift card ${code} redeemed ${result.redeemedCents}c for ${ref}. New balance: ${result.newBalanceCents}c`)

  return NextResponse.json({
    deductedCents: result.redeemedCents,
    remainingBalanceCents: result.newBalanceCents,
    remainingBalanceFormatted: `$${(result.newBalanceCents / 100).toFixed(2)}`,
    fullyRedeemed: result.newBalanceCents === 0,
  })
}
