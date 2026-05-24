import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabase } from '@/lib/supabase'
import { getPortalBookingRef } from '@/lib/portalAuth'
import { calculateCardFee, formatMoney } from '@/lib/partyPricing'

const MIN_PARTIAL_CENTS = 5000
const MIN_DEPOSIT_CENTS = 9900

export async function POST(req: NextRequest) {
  const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
  const cookieHeader = req.headers.get('cookie')
  const bookingRef = getPortalBookingRef(cookieHeader, secret)

  if (!bookingRef) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const supabase = getSupabase()
  const body = await req.json()
  const { amountCents, paymentMethod, embedded, paymentType } = body as {
    amountCents: number
    paymentMethod: 'card' | 'cash' | 'venmo' | 'zelle'
    embedded?: boolean
    paymentType?: 'deposit' | 'partial' | 'final'
  }

  const minAmount = paymentType === 'deposit' ? MIN_DEPOSIT_CENTS : MIN_PARTIAL_CENTS
  if (!amountCents || amountCents < minAmount) {
    return NextResponse.json({ error: `Minimum payment is ${formatMoney(minAmount)}` }, { status: 400 })
  }

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, balance_due_cents, total_cents, contact_name, contact_email, booking_ref, package_type, status')
    .eq('booking_ref', bookingRef)
    .single()

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  const effectiveAmount = Math.min(amountCents, booking.balance_due_cents || amountCents)
  const isFinalPayment = effectiveAmount >= (booking.balance_due_cents || 0)
  const resolvedType = paymentType || (isFinalPayment ? 'final' : 'partial')

  if (paymentMethod === 'card') {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
    const cardFeeCents = calculateCardFee(effectiveAmount)
    const totalChargeCents = effectiveAmount + cardFeeCents
    void embedded

    const intent = await stripe.paymentIntents.create({
      amount: totalChargeCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      receipt_email: booking.contact_email,
      description: `${booking.booking_ref} — ${resolvedType === 'deposit' ? 'Deposit' : isFinalPayment ? 'Final' : 'Partial'} Payment`,
      statement_descriptor_suffix: 'PARTY PAYMENT',
      metadata: {
        type: 'party_builder',
        payment_type: resolvedType,
        booking_ref: booking.booking_ref,
        booking_id: booking.id,
        amountCents: String(effectiveAmount),
        cardFeeCents: String(cardFeeCents),
        contactName: booking.contact_name,
        contactEmail: booking.contact_email,
      },
    })

    return NextResponse.json({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      method: 'card',
    })
  }

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
