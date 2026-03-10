import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

/* GET /api/admin/financials — list transactions with server-side filtering
   Query params: source, start, end, search, limit (default 200), offset (default 0) */
export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const { searchParams } = new URL(req.url)
  const source = searchParams.get('source')
  const startDate = searchParams.get('start')
  const endDate = searchParams.get('end')
  const search = searchParams.get('search')
  const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 1000)
  const offset = parseInt(searchParams.get('offset') || '0')

  let query = supabase
    .from('financial_transactions')
    .select('*', { count: 'exact' })
    .order('date', { ascending: false })

  if (source && source !== 'all') query = query.eq('source', source)
  if (startDate) query = query.gte('date', startDate)
  if (endDate) query = query.lte('date', endDate)
  if (search) query = query.or(`description.ilike.%${search}%,customer_name.ilike.%${search}%,reference.ilike.%${search}%`)

  query = query.range(offset, offset + limit - 1)

  const { data, error, count } = await query

  if (error) {
    console.error('Financials fetch error:', error)
    return NextResponse.json({ transactions: [], total: 0 })
  }

  return NextResponse.json({ transactions: data || [], total: count || 0 })
}

/* POST /api/admin/financials — create a single transaction (cash entry) */
export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const body = await req.json()
  const { date, description, amount_cents, source, category, customer_name, notes, reference } = body

  if (!date || !description || !amount_cents) {
    return NextResponse.json({ error: 'date, description, and amount_cents are required' }, { status: 400 })
  }

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('financial_transactions')
    .insert({
      date,
      description,
      amount_cents: Math.round(amount_cents),
      source: source || 'cash',
      category: category || 'Other',
      customer_name: customer_name || null,
      notes: notes || null,
      reference: reference || null,
    })
    .select()
    .single()

  if (error) {
    console.error('Financials insert error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ transaction: data })
}
