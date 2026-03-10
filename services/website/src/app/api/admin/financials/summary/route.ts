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

  // Fetch all matching rows (override Supabase default 1000 limit)
  // Paginate in chunks of 1000 to handle large datasets
  const allRows: { date: string; amount_cents: number; source: string; category: string }[] = []
  let offset = 0
  const CHUNK = 1000

  while (true) {
    let query = supabase
      .from('financial_transactions')
      .select('date,amount_cents,source,category')
      .range(offset, offset + CHUNK - 1)

    if (startDate) query = query.gte('date', startDate)
    if (endDate) query = query.lte('date', endDate)
    if (source && source !== 'all') query = query.eq('source', source)

    const { data: rows, error } = await query

    if (error) {
      console.error('Summary fetch error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!rows || rows.length === 0) break
    allRows.push(...rows)
    if (rows.length < CHUNK) break
    offset += CHUNK
  }

  // Compute date boundaries
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()

  const thisMonthStart = `${y}-${String(m + 1).padStart(2, '0')}-01`

  const lmDate = new Date(y, m - 1, 1)
  const lastMonthStart = `${lmDate.getFullYear()}-${String(lmDate.getMonth() + 1).padStart(2, '0')}-01`
  const lmEnd = new Date(y, m, 0)
  const lastMonthEndStr = `${lmEnd.getFullYear()}-${String(lmEnd.getMonth() + 1).padStart(2, '0')}-${String(lmEnd.getDate()).padStart(2, '0')}`

  // Same quarter last year
  const qStart = new Date(y, Math.floor(m / 3) * 3, 1)
  const thisQStart = `${qStart.getFullYear()}-${String(qStart.getMonth() + 1).padStart(2, '0')}-01`
  const lastYearQStart = `${qStart.getFullYear() - 1}-${String(qStart.getMonth() + 1).padStart(2, '0')}-01`
  const lastYearQEnd = new Date(qStart.getFullYear() - 1, qStart.getMonth() + 3, 0)
  const lastYearQEndStr = `${lastYearQEnd.getFullYear()}-${String(lastYearQEnd.getMonth() + 1).padStart(2, '0')}-${String(lastYearQEnd.getDate()).padStart(2, '0')}`

  // YTD boundaries
  const ytdStart = `${y}-01-01`
  const lastYearYtdStart = `${y - 1}-01-01`
  // Same day last year
  const lastYearSameDay = `${y - 1}-${String(m + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  let totalRevenue = 0
  let totalCount = 0
  let thisMonth = 0
  let lastMonth = 0
  let thisQuarter = 0
  let sameQuarterLastYear = 0
  let ytd = 0
  let lastYearYtd = 0
  const bySource: Record<string, { revenue: number; count: number }> = {}
  const byCategory: Record<string, number> = {}

  // We need ALL transactions (not just filtered) to compute last-year comparisons
  // If date filters are applied, fetch last-year data separately
  // For now, compute from the filtered set + note: last-year comparisons work
  // best when filter is "all" or "ytd"

  for (const t of allRows) {
    totalRevenue += t.amount_cents
    totalCount++

    if (!bySource[t.source]) bySource[t.source] = { revenue: 0, count: 0 }
    bySource[t.source].revenue += t.amount_cents
    bySource[t.source].count++

    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount_cents

    if (t.date >= thisMonthStart) thisMonth += t.amount_cents
    if (t.date >= lastMonthStart && t.date <= lastMonthEndStr) lastMonth += t.amount_cents
    if (t.date >= thisQStart) thisQuarter += t.amount_cents
    if (t.date >= ytdStart) ytd += t.amount_cents
  }

  // Fetch last-year comparison data separately (always unfiltered by date)
  let lyQuery = supabase
    .from('financial_transactions')
    .select('date,amount_cents')
    .gte('date', `${y - 1}-01-01`)
    .lte('date', lastYearSameDay)

  if (source && source !== 'all') lyQuery = lyQuery.eq('source', source)

  const { data: lyRows } = await lyQuery

  for (const t of lyRows || []) {
    lastYearYtd += t.amount_cents
    if (t.date >= lastYearQStart && t.date <= lastYearQEndStr) {
      sameQuarterLastYear += t.amount_cents
    }
  }

  // Calculate run rates
  const dayOfYear = Math.floor((now.getTime() - new Date(y, 0, 1).getTime()) / 86400000) + 1
  const daysInYear = (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 366 : 365
  const dayOfQuarter = Math.floor((now.getTime() - qStart.getTime()) / 86400000) + 1
  const daysInQuarter = Math.floor((new Date(qStart.getFullYear(), qStart.getMonth() + 3, 0).getTime() - qStart.getTime()) / 86400000) + 1

  const annualRunRate = dayOfYear > 0 ? Math.round((ytd / dayOfYear) * daysInYear) : 0
  const quarterlyRunRate = dayOfQuarter > 0 ? Math.round((thisQuarter / dayOfQuarter) * daysInQuarter) : 0

  return NextResponse.json({
    totalRevenue,
    totalCount,
    thisMonth,
    lastMonth,
    thisQuarter,
    sameQuarterLastYear,
    ytd,
    lastYearYtd,
    annualRunRate,
    quarterlyRunRate,
    bySource,
    byCategory,
  })
}
