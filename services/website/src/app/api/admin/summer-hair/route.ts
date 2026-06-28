import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()

  const { data: bookings, error } = await supabase
    .from('summer_hair_bookings')
    .select('*')
    .order('time_slot', { ascending: true })
    .order('created_at', { ascending: false })

  if (error) {
    console.error('admin summer-hair fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 })
  }

  const confirmed = (bookings || []).filter(b => b.status === 'confirmed')
  const cancelled = (bookings || []).filter(b => b.status === 'cancelled')

  return NextResponse.json({
    bookings: bookings || [],
    summary: {
      total: (bookings || []).length,
      confirmed: confirmed.length,
      cancelled: cancelled.length,
      totalPeople: confirmed.reduce((sum: number, b: any) => sum + b.party_size, 0),
      totalSlots: confirmed.reduce((sum: number, b: any) => sum + (b.slots_needed || 1), 0),
    },
  })
}

export async function PATCH(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const body = await req.json()
  const { id, action, slotsNeeded } = body

  if (!id) {
    return NextResponse.json({ error: 'Booking ID is required' }, { status: 400 })
  }

  const supabase = getSupabase()

  if (action === 'cancel') {
    const { error } = await supabase
      .from('summer_hair_bookings')
      .update({ status: 'cancelled' })
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: 'Failed to cancel booking' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  }

  if (action === 'adjust_duration' && typeof slotsNeeded === 'number') {
    if (slotsNeeded < 1 || slotsNeeded > 18) {
      return NextResponse.json({ error: 'Slots must be 1-18' }, { status: 400 })
    }
    const { error } = await supabase
      .from('summer_hair_bookings')
      .update({ slots_needed: slotsNeeded })
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: 'Failed to adjust duration' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  }

  if (action === 'restore') {
    const { error } = await supabase
      .from('summer_hair_bookings')
      .update({ status: 'confirmed' })
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: 'Failed to restore booking' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
