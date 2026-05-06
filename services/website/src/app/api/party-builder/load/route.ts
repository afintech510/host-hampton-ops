import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { getPortalBookingRef } from '@/lib/portalAuth'

export async function GET(req: NextRequest) {
  const portalSecret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
  const cookieHeader = req.headers.get('cookie')
  const bookingRef = getPortalBookingRef(cookieHeader, portalSecret)

  if (!bookingRef) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const supabase = getSupabase()

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, booking_ref, status, event_type, party_date, party_time, package_type, guest_count_approx, child_name, child_age, contact_name, contact_email, contact_phone, deposit_amount, total_cents, balance_due_cents, payment_method_preference, quote_snapshot, party_tags, notes, created_at')
    .eq('booking_ref', bookingRef)
    .single()

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  const { data: lineItems } = await supabase
    .from('booking_line_items')
    .select('id, pricing_item_id, name, category, quantity, unit_price_cents, price_type, guest_multiplied, sort_order')
    .eq('booking_id', booking.id)
    .order('sort_order', { ascending: true })

  const { data: payments } = await supabase
    .from('booking_payments')
    .select('id, payment_type, payment_method, amount_cents, card_fee_cents, total_charged_cents, recorded_by, notes, paid_at')
    .eq('booking_id', booking.id)
    .order('paid_at', { ascending: true })

  return NextResponse.json({
    booking,
    lineItems: lineItems || [],
    payments: payments || [],
  })
}
