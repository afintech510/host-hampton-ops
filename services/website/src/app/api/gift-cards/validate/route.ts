import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, costlyRule } from '@/lib/rateLimit'

/**
 * Check a gift card code at the ticket checkout.
 *
 * This one stays PUBLIC — the customer typing their own code into
 * `events/[slug]/TicketForm` needs it, and unlike `/redeem` it changes nothing.
 * Two things were wrong with it anyway:
 *
 *  - **Rule 12.** `if (error || !card)` answered a confident `404 Gift card not
 *    found` when the read had merely failed, telling a customer holding a real
 *    card that it does not exist. `/redeem` beside it already distinguished the
 *    two; this one, on the same table, did not.
 *
 *  - **It is an oracle, and it was unthrottled.** A code is
 *    `HH-XXXX-XXXX` and the route reports back which of "no such card",
 *    "cancelled", "spent" and "expired" applies, plus the exact remaining
 *    balance. The eight random characters are not brute-forceable at HTTP rates,
 *    but there is no reason to offer unlimited guesses, and the four distinct
 *    answers are more than a legitimate customer needs. It is now rate-limited
 *    and a card that cannot be spent answers the same way as one that does not
 *    exist — the rule `/review/[token]` and `/api/portal/auth` already follow.
 */
export async function POST(req: NextRequest) {
  const limited = guardRate(req, costlyRule('gift-cards/validate', 10, 200))
  if (limited) return limited

  const { code } = await req.json()
  if (!code || typeof code !== 'string') {
    return NextResponse.json({ error: 'Code is required' }, { status: 400 })
  }

  const supabase = getSupabase()
  const { data: card, error } = await supabase
    .from('gift_cards')
    .select('id, code, amount_cents, balance_cents, status, expires_at')
    .eq('code', code.trim().toUpperCase())
    .maybeSingle()

  // Three outcomes. "Could not tell" is not "no such card".
  if (error) {
    console.error('gift-cards/validate: read failed —', error.message)
    return NextResponse.json(
      { error: 'Could not check that card right now. Please try again.' },
      { status: 503 },
    )
  }

  // One answer for every card that cannot be spent, so the endpoint does not
  // report which codes exist.
  const unusable = NextResponse.json(
    { error: 'That gift card cannot be used — please check the code, or call us on (631) 998-9325.' },
    { status: 404 },
  )
  if (!card) return unusable
  if (card.status !== 'active') return unusable
  if (card.balance_cents <= 0) return unusable
  if (card.expires_at && new Date(card.expires_at) < new Date()) return unusable

  return NextResponse.json({
    valid: true,
    code: card.code,
    balanceCents: card.balance_cents,
    balanceFormatted: `$${(card.balance_cents / 100).toFixed(2)}`,
  })
}
