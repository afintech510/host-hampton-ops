import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const { code } = await req.json()
  if (!code) return NextResponse.json({ error: 'Code is required' }, { status: 400 })

  const supabase = getSupabase()
  const { data: card, error } = await supabase
    .from('gift_cards')
    .select('id, code, amount_cents, balance_cents, status, expires_at')
    .eq('code', code.trim().toUpperCase())
    .single()

  if (error || !card) {
    return NextResponse.json({ error: 'Gift card not found' }, { status: 404 })
  }

  if (card.status !== 'active') {
    return NextResponse.json({ error: `Gift card is ${card.status}` }, { status: 400 })
  }

  if (card.balance_cents <= 0) {
    return NextResponse.json({ error: 'Gift card has no remaining balance' }, { status: 400 })
  }

  if (card.expires_at && new Date(card.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Gift card has expired' }, { status: 400 })
  }

  return NextResponse.json({
    valid: true,
    code: card.code,
    balanceCents: card.balance_cents,
    balanceFormatted: `$${(card.balance_cents / 100).toFixed(2)}`,
  })
}
