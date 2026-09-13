import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { getSupabase } from '@/lib/supabase'
import { orIlikeFilter } from '@/lib/postgrestFilter'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

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
    query = query.or(
      orIlikeFilter(
        ['code', 'purchaser_name', 'purchaser_email', 'recipient_name', 'recipient_email'],
        search,
      ),
    )
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
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

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
