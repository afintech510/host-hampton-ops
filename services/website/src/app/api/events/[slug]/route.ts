import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  const supabase = getSupabase()

  const { data: event, error } = await supabase
    .from('events')
    .select('*')
    .eq('slug', params.slug)
    .eq('is_active', true)
    .single()

  if (error || !event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  }

  let sessions = null
  if (event.has_sessions) {
    const { data } = await supabase
      .from('event_sessions')
      .select('*')
      .eq('event_id', event.id)
      .eq('is_active', true)
      .gte('session_date', new Date().toISOString().split('T')[0])
      .order('session_date', { ascending: true })
    sessions = data
  }

  return NextResponse.json({ event, sessions })
}
