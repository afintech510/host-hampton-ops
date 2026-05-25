import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabase } from '@/lib/supabase'
import { getPortalBookingRef } from '@/lib/portalAuth'
import { calculateCardFee, formatMoney } from '@/lib/partyPricing'

export async function POST(req: NextRequest) {
  const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
  const cookieHeader = req.headers.get('cookie')
  const bookingRef = getPortalBookingRef(cookieHeader, secret)

  if (!bookingRef) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const supabase = getSupabase()
  const body = await req.json()
  // Accept both camelCase and legacy snake_case. The frontend historically
  // POSTed `amount_cents` but the route expected `amountCents` — they never
  // matched, which surfaced as the "Minimum payment is $50" error on every
  // amount. Accepting both keeps any in-flight clients working.
  const amountCents = (body.amountCents ?? body.amount_cents) as number | undefined
  const tipCents = (body.tipCents ?? body.tip_cents) as number | undefined
  const { paymentMethod, embedded, paymentType } = body as {
    paymentMethod: 'card' | 'cash' | 'venmo' | 'zelle'
    embedded?: boolean
    paymentType?: 'deposit' | 'partial' | 'final'
  }

  // Any positive amount is allowed. Customers can chip away at the balance
  // however they want — admin used to gate this at $50/$99, but per UX
  // request 2026-05-24 we lift the floor entirely.
  if (!amountCents || amountCents <= 0) {
    return NextResponse.json({ error: 'Enter a valid amount' }, { status: 400 })
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

  // Tip handling — added only on card payments. Tip lifts the Stripe charge
  // but doesn't count toward the booking balance (it's a gratuity for the
  // helpers, not party fees).
  const safeTipCents = Math.max(0, Math.round(tipCents || 0))

  if (paymentMethod === 'card') {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
    const subtotalCents = effectiveAmount + safeTipCents
    const cardFeeCents = calculateCardFee(subtotalCents)
    const totalChargeCents = subtotalCents + cardFeeCents
    void embedded

    const intent = await stripe.paymentIntents.create({
      amount: totalChargeCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      receipt_email: booking.contact_email,
      description: `${booking.booking_ref} — ${resolvedType === 'deposit' ? 'Deposit' : isFinalPayment ? 'Final' : 'Partial'} Payment${safeTipCents > 0 ? ' + Tip' : ''}`,
      statement_descriptor_suffix: 'PARTY PAYMENT',
      metadata: {
        type: 'party_builder',
        payment_type: resolvedType,
        booking_ref: booking.booking_ref,
        booking_id: booking.id,
        amountCents: String(effectiveAmount),
        tipCents: String(safeTipCents),
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
