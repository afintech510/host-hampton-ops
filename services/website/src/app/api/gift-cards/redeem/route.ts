import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const { code, amountCents, reference } = await req.json()

  if (!code || !amountCents || !reference) {
    return NextResponse.json({ error: 'code, amountCents, and reference are required' }, { status: 400 })
  }

  const supabase = getSupabase()

  // Fetch and validate in one step
  const { data: card, error } = await supabase
    .from('gift_cards')
    .select('*')
    .eq('code', code.trim().toUpperCase())
    .eq('status', 'active')
    .single()

  if (error || !card) {
    return NextResponse.json({ error: 'Gift card not found or inactive' }, { status: 404 })
  }

  if (card.balance_cents <= 0) {
    return NextResponse.json({ error: 'Gift card has no remaining balance' }, { status: 400 })
  }

  // Deduct the lesser of requested amount or remaining balance
  const deductCents = Math.min(amountCents, card.balance_cents)
  const newBalance = card.balance_cents - deductCents
  const newStatus = newBalance === 0 ? 'redeemed' : 'active'

  const { error: updateErr } = await supabase
    .from('gift_cards')
    .update({
      balance_cents: newBalance,
      status: newStatus,
      redeemed_at: newBalance === 0 ? new Date().toISOString() : card.redeemed_at,
    })
    .eq('id', card.id)

  if (updateErr) {
    console.error('Gift card redeem error:', updateErr)
    return NextResponse.json({ error: 'Failed to redeem gift card' }, { status: 500 })
  }

  console.log(`Gift card ${code} redeemed ${deductCents}c for ${reference}. New balance: ${newBalance}c`)

  return NextResponse.json({
    deductedCents: deductCents,
    remainingBalanceCents: newBalance,
    remainingBalanceFormatted: `$${(newBalance / 100).toFixed(2)}`,
    fullyRedeemed: newBalance === 0,
  })
}
