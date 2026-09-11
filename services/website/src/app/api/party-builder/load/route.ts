import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { getPortalBookingRef } from '@/lib/portalAuth'
import { isAdminAuthorized } from '@/lib/adminAuth'

/**
 * Load the plan the planner should render.
 *
 * Two callers, and the order below is the security of the route:
 *
 *  1. A CUSTOMER, identified by the signed portal cookie. They get the one
 *     booking that cookie names and nothing else. This is unchanged.
 *  2. An ADMIN opening `?ref=…` from the lead workspace's "Open planner" link
 *     (plan §11.6). This is the new half, and `ref` is honoured ONLY after
 *     `isAdminAuthorized`. A customer who guesses another booking ref and
 *     appends it gets their OWN plan back, not the one they asked for — the
 *     parameter is not merely ignored for them, it never reaches the query.
 *
 * Written this way round deliberately: an admin check that ran second, as a
 * fallback, would mean a customer's cookie and a `ref` could both be present
 * and the more permissive one would win.
 */
export async function GET(req: NextRequest) {
  const portalSecret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
  const cookieHeader = req.headers.get('cookie')
  const requestedRef = req.nextUrl.searchParams.get('ref')
  const bookingRef =
    requestedRef && isAdminAuthorized(req) ? requestedRef : getPortalBookingRef(cookieHeader, portalSecret)

  if (!bookingRef) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const supabase = getSupabase()

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, booking_ref, status, party_type, event_type, party_date, party_time, package_type, guest_count_approx, child_name, child_age, contact_name, contact_email, contact_phone, deposit_amount, total_cents, balance_due_cents, payment_method_preference, quote_snapshot, party_tags, notes, created_at')
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
