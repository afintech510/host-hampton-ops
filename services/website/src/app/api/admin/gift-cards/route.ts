import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (token !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabase()
  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const search = url.searchParams.get('search')

  let query = supabase
    .from('gift_cards')
    .select('*')
    .order('purchased_at', { ascending: false })

  if (status && status !== 'all') {
    query = query.eq('status', status)
  }

  if (search) {
    query = query.or(`code.ilike.%${search}%,purchaser_name.ilike.%${search}%,purchaser_email.ilike.%${search}%,recipient_name.ilike.%${search}%,recipient_email.ilike.%${search}%`)
  }

  const { data, error } = await query.limit(200)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Summary stats
  const all = data || []
  const totalSold = all.reduce((sum, c) => sum + c.amount_cents, 0)
  const totalRedeemed = all.reduce((sum, c) => sum + (c.amount_cents - c.balance_cents), 0)
  const totalOutstanding = all.reduce((sum, c) => sum + c.balance_cents, 0)
  const activeCount = all.filter(c => c.status === 'active').length
  const redeemedCount = all.filter(c => c.status === 'redeemed').length

  return NextResponse.json({
    cards: all,
    summary: {
      totalSold,
      totalRedeemed,
      totalOutstanding,
      activeCount,
      redeemedCount,
      totalCount: all.length,
    },
  })
}

export async function PATCH(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (token !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id, status } = await req.json()
  if (!id || !status) {
    return NextResponse.json({ error: 'id and status are required' }, { status: 400 })
  }

  if (!['active', 'cancelled', 'expired'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const supabase = getSupabase()
  const { error } = await supabase
    .from('gift_cards')
    .update({ status })
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
