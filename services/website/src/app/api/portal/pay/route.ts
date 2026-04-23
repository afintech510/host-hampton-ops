import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabase } from '@/lib/supabase'
import { getPortalBookingRef } from '@/lib/portalAuth'
import { calculateCardFee, formatMoney } from '@/lib/partyPricing'

const MIN_PARTIAL_CENTS = 5000

export async function POST(req: NextRequest) {
  const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
  const cookieHeader = req.headers.get('cookie')
  const bookingRef = getPortalBookingRef(cookieHeader, secret)

  if (!bookingRef) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const supabase = getSupabase()
  const body = await req.json()
  const { amountCents, paymentMethod } = body as { amountCents: number; paymentMethod: 'card' | 'cash' | 'venmo' | 'zelle' }

  if (!amountCents || amountCents < MIN_PARTIAL_CENTS) {
    return NextResponse.json({ error: `Minimum payment is ${formatMoney(MIN_PARTIAL_CENTS)}` }, { status: 400 })
  }

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, balance_due_cents, contact_name, contact_email, booking_ref, package_type')
    .eq('booking_ref', bookingRef)
    .single()

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  const effectiveAmount = Math.min(amountCents, booking.balance_due_cents || amountCents)
  const isFinalPayment = effectiveAmount >= (booking.balance_due_cents || 0)

  if (paymentMethod === 'card') {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
    const cardFeeCents = calculateCardFee(effectiveAmount)
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host')

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${booking.booking_ref} — ${isFinalPayment ? 'Final' : 'Partial'} Payment`,
              description: booking.package_type || 'Party Booking',
            },
            unit_amount: effectiveAmount,
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'Card Processing Fee (3%)' },
            unit_amount: cardFeeCents,
          },
          quantity: 1,
        },
      ],
      customer_email: booking.contact_email,
      metadata: {
        type: 'party_builder',
        payment_type: isFinalPayment ? 'final' : 'partial',
        booking_ref: booking.booking_ref,
        booking_id: booking.id,
        amountCents: String(effectiveAmount),
        cardFeeCents: String(cardFeeCents),
        contactName: booking.contact_name,
        contactEmail: booking.contact_email,
      },
      success_url: `https://${host}/my-booking?payment=success`,
      cancel_url: `https://${host}/my-booking/pay?cancelled=true`,
    })

    return NextResponse.json({ url: session.url, method: 'card' })
  }

  // Non-card: just return instructions (admin will record receipt)
  return NextResponse.json({
    method: paymentMethod,
    amount: formatMoney(effectiveAmount),
    instructions: paymentMethod === 'venmo'
      ? `Send ${formatMoney(effectiveAmount)} to ${process.env.VENMO_HANDLE || '@HostHampton'} with note: ${bookingRef}`
      : paymentMethod === 'zelle'
        ? `Send ${formatMoney(effectiveAmount)} to ${process.env.ZELLE_EMAIL || 'hosthampton295@gmail.com'} with memo: ${bookingRef}`
        : `Bring ${formatMoney(effectiveAmount)} cash to Host Hampton`,
  })
}
