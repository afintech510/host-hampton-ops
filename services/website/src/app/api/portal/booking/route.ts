import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { getPortalBookingRef } from '@/lib/portalAuth'
import { isModificationAllowed } from '@/lib/partyPricing'

export async function GET(req: NextRequest) {
  const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
  const cookieHeader = req.headers.get('cookie')
  const bookingRef = getPortalBookingRef(cookieHeader, secret)

  if (!bookingRef) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const supabase = getSupabase()

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('booking_ref', bookingRef)
    .single()

  if (error || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  // Fetch related data
  const [lineItemsRes, paymentsRes, modificationsRes] = await Promise.all([
    supabase.from('booking_line_items').select('*').eq('booking_id', booking.id).order('sort_order'),
    supabase.from('booking_payments').select('*').eq('booking_id', booking.id).order('paid_at', { ascending: false }),
    supabase.from('booking_modifications').select('*').eq('booking_id', booking.id).order('created_at', { ascending: false }).limit(20),
  ])

  // Compute modification permissions
  const fullMod = isModificationAllowed(booking.party_date, 'full')
  const guestMod = isModificationAllowed(booking.party_date, 'guest_count')

  return NextResponse.json({
    booking: {
      ...booking,
      line_items: lineItemsRes.data || [],
      payments: paymentsRes.data || [],
      modifications: modificationsRes.data || [],
    },
    permissions: {
      canEditFull: fullMod.allowed,
      canEditGuestCount: guestMod.allowed,
      fullReason: fullMod.reason,
      guestCountReason: guestMod.reason,
    },
  })
}

export async function PATCH(req: NextRequest) {
  const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
  const cookieHeader = req.headers.get('cookie')
  const bookingRef = getPortalBookingRef(cookieHeader, secret)

  if (!bookingRef) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const supabase = getSupabase()
  const body = await req.json()

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, party_date, status')
    .eq('booking_ref', bookingRef)
    .single()

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  // Check if the change type is allowed
  const changeType = body.guest_count_approx !== undefined ? 'guest_count' : 'full'
  const permission = isModificationAllowed(booking.party_date, changeType)

  if (!permission.allowed) {
    return NextResponse.json({ error: permission.reason }, { status: 403 })
  }

  // Only allow certain fields from customer
  const allowed: Record<string, unknown> = {}
  if (body.guest_count_approx !== undefined) allowed.guest_count_approx = body.guest_count_approx
  if (body.notes !== undefined) allowed.notes = body.notes
  if (body.child_name !== undefined) allowed.child_name = body.child_name
  if (body.child_age !== undefined) allowed.child_age = body.child_age

  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: 'No valid changes' }, { status: 400 })
  }

  allowed.updated_at = new Date().toISOString()

  const { error: updateErr } = await supabase
    .from('bookings')
    .update(allowed)
    .eq('id', booking.id)

  if (updateErr) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  // Log modification
  await supabase.from('booking_modifications').insert({
    booking_id: booking.id,
    modified_by: 'customer',
    change_summary: Object.keys(allowed).filter(k => k !== 'updated_at').join(', ') + ' updated',
    old_data: null,
    new_data: allowed,
  })

  return NextResponse.json({ ok: true })
}
