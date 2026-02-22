import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = getSupabase()
  const category = req.nextUrl.searchParams.get('category')

  let query = supabase
    .from('events')
    .select('*')
    .eq('is_active', true)
    .order('event_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (category && category !== 'all') {
    query = query.eq('category', category)
  }

  const { data: events, error } = await query

  if (error) {
    console.error('Events fetch error:', error)
    return NextResponse.json({ events: [] })
  }

  // For events with sessions, fetch upcoming sessions
  const eventsWithSessions = await Promise.all(
    (events || []).map(async (event) => {
      if (!event.has_sessions) return event
      const { data: sessions } = await supabase
        .from('event_sessions')
        .select('*')
        .eq('event_id', event.id)
        .eq('is_active', true)
        .gte('session_date', new Date().toISOString().split('T')[0])
        .order('session_date', { ascending: true })
      return { ...event, sessions: sessions || [] }
    })
  )

  return NextResponse.json({ events: eventsWithSessions })
}
