import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

/* GET /api/admin/financials/summary — server-side aggregation
   Query params: start, end, source */
export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const { searchParams } = new URL(req.url)
  const startDate = searchParams.get('start')
  const endDate = searchParams.get('end')
  const source = searchParams.get('source')

  // Fetch only the columns needed for aggregation (no limit)
  let query = supabase
    .from('financial_transactions')
    .select('date,amount_cents,source,category')

  if (startDate) query = query.gte('date', startDate)
  if (endDate) query = query.lte('date', endDate)
  if (source && source !== 'all') query = query.eq('source', source)

  const { data: rows, error } = await query

  if (error) {
    console.error('Summary fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const txns = rows || []

  // Compute date boundaries for this-month / last-month
  const now = new Date()
  const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonthStart = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}-01`
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
  const lastMonthEndStr = `${lastMonthEnd.getFullYear()}-${String(lastMonthEnd.getMonth() + 1).padStart(2, '0')}-${String(lastMonthEnd.getDate()).padStart(2, '0')}`

  let totalRevenue = 0
  let totalCount = 0
  let thisMonth = 0
  let lastMonth = 0
  const bySource: Record<string, { revenue: number; count: number }> = {}
  const byCategory: Record<string, number> = {}

  for (const t of txns) {
    totalRevenue += t.amount_cents
    totalCount++

    if (!bySource[t.source]) bySource[t.source] = { revenue: 0, count: 0 }
    bySource[t.source].revenue += t.amount_cents
    bySource[t.source].count++

    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount_cents

    if (t.date >= thisMonthStart) thisMonth += t.amount_cents
    if (t.date >= lastMonthStart && t.date <= lastMonthEndStr) lastMonth += t.amount_cents
  }

  return NextResponse.json({
    totalRevenue,
    totalCount,
    thisMonth,
    lastMonth,
    bySource,
    byCategory,
  })
}
