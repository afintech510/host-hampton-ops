import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = getSupabase()
  const category = req.nextUrl.searchParams.get('category')
  const eventType = req.nextUrl.searchParams.get('event_type')

  let query = supabase
    .from('pricing_items')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (category) {
    query = query.eq('category', category)
  }

  // Filter by event type: return items where event_types contains the value OR is null (universal)
  if (eventType) {
    query = query.or(`event_types.cs.{${eventType}},event_types.is.null`)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch pricing' }, { status: 500 })
  }

  return NextResponse.json(data || [], {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
  })
}
