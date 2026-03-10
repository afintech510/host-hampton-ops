import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

/* GET /api/admin/financials — list all transactions */
export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const { searchParams } = new URL(req.url)
  const source = searchParams.get('source')
  const limit = parseInt(searchParams.get('limit') || '500')

  let query = supabase
    .from('financial_transactions')
    .select('*')
    .order('date', { ascending: false })
    .limit(limit)

  if (source) {
    query = query.eq('source', source)
  }

  const { data, error } = await query

  if (error) {
    console.error('Financials fetch error:', error)
    return NextResponse.json({ transactions: [] })
  }

  return NextResponse.json({ transactions: data || [] })
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
