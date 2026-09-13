import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { arrayContainsOrNullFilter } from '@/lib/postgrestFilter'

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
  //
  // `.or()` takes a RAW PostgREST expression and this route is PUBLIC and
  // unauthenticated, so `?event_type=` used to be able to rewrite its own
  // filter: `}` ends the array literal and `,` starts a new disjunct
  // (AGENTS.md §11). An event type is an identifier, so anything that is not
  // one is dropped — and a value that reduces to nothing matches nothing,
  // rather than quietly returning the unfiltered catalogue.
  if (eventType) {
    const filter = arrayContainsOrNullFilter('event_types', eventType)
    query = filter ? query.or(filter) : query.is('event_types', null)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch pricing' }, { status: 500 })
  }

  return NextResponse.json(data || [], {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
  })
}
