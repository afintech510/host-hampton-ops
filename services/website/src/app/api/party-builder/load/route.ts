import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { getPortalBookingRef, portalSigningSecret } from '@/lib/portalAuth'
import { isAdminAuthorized } from '@/lib/adminAuth'
import { getDepositCents, BOOKING_DEPOSIT_CENTS } from '@/lib/partyPricing'
import { isPayableStatus } from '@/lib/portalWrite'
import {
  billedTotalCents,
  depositIsSeparateFor,
  isUnpricedPlan,
  planMoney,
  type BilledItem,
  type PaymentRow,
} from '@/lib/planBalance'

// Reads a cookie, so it must never be prerendered. Without this Next tried to
// statically export it and evaluated the handler at BUILD time.
export const dynamic = 'force-dynamic'

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
  const portalSecret = portalSigningSecret()
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
    // `is_optional` is read because `billedTotalCents` excludes optional items;
    // without it a quoted-not-charged add-on would inflate the total the money
    // block below is derived from.
    .select('id, pricing_item_id, name, category, quantity, unit_price_cents, price_type, guest_multiplied, sort_order, is_optional')
    .eq('booking_id', booking.id)
    .order('sort_order', { ascending: true })

  const { data: payments } = await supabase
    .from('booking_payments')
    .select('id, payment_type, payment_method, amount_cents, card_fee_cents, total_charged_cents, recorded_by, notes, paid_at')
    .eq('booking_id', booking.id)
    .order('paid_at', { ascending: true })

  // What this plan owes, from the same `planMoney` the invoice, the portal and
  // the pay route use. The builder needs `depositOwedCents` specifically: on an
  // unpriced plan it is the only thing payable, and the sticky bar used to
  // print "Deposit to Reserve $0" over a plan that could be reserved for $250.
  // `Array.isArray`, not `|| []`: a non-array from the driver would reach
  // `billedTotalCents`'s `for…of` and throw, taking the whole planner down
  // rather than the money block. `billedTotalCents` stays strict on purpose.
  const billedItems = (Array.isArray(lineItems) ? lineItems : []) as unknown as BilledItem[]
  const billedPayments = (Array.isArray(payments) ? payments : []) as unknown as PaymentRow[]
  const totalCents = billedTotalCents(billedItems, booking.guest_count_approx as number | null)
  const m = planMoney({
    totalCents,
    depositCents: getDepositCents(totalCents),
    depositIsSeparate: depositIsSeparateFor(booking.party_type as string | null),
    payments: billedPayments,
    reservationDepositCents: isPayableStatus(booking.status) ? BOOKING_DEPOSIT_CENTS : 0,
  })

  return NextResponse.json({
    booking,
    lineItems: lineItems || [],
    payments: payments || [],
    money: {
      totalCents: m.totalCents,
      outstandingCents: m.outstandingCents,
      depositOwedCents: m.depositOwedCents,
      unpriced: isUnpricedPlan(totalCents),
    },
  })
}
