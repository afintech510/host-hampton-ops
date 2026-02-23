import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const tags = req.nextUrl.searchParams.get('tags') // comma-separated

  const supabase = getSupabase()
  let query = supabase
    .from('booking_types')
    .select('slug, label, description, allowed_days, slot_duration_min, buffer_min, open_time, close_time, requires_deposit, deposit_cents, min_advance_days, tags, sort_order')
    .eq('is_active', true)
    .order('sort_order')

  if (tags) {
    // Filter: booking type must have at least one of the requested tags
    const tagArr = tags.split(',').map(t => t.trim())
    query = query.overlaps('tags', tagArr)
  }

  const { data, error } = await query
  if (error) {
    console.error('booking-types query error:', error)
    return NextResponse.json({ types: [] })
  }

  return NextResponse.json({ types: data || [] })
}
