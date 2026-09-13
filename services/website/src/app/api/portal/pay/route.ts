import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabase } from '@/lib/supabase'
import { getPortalBookingRef, portalSigningSecret } from '@/lib/portalAuth'
import { calculateCardFee, formatMoney } from '@/lib/partyPricing'
import { venmoHandle, zellePhone, PUBLIC_PHONE_DISPLAY } from '@/lib/paymentContacts'

/** A gratuity, not a second invoice. $1,000 is generous and still a ceiling. */
const MAX_TIP_CENTS = 100_000

export async function POST(req: NextRequest) {
  const secret = portalSigningSecret()
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

  const { data: booking, error: readErr } = await supabase
    .from('bookings')
    .select('id, balance_due_cents, total_cents, contact_name, contact_email, booking_ref, package_type, status')
    .eq('booking_ref', bookingRef)
    .maybeSingle()

  // Rule 12 on a money path: an unreadable booking is not a missing one, and
  // the amount owed must never be derived from a failed read.
  if (readErr) {
    console.error('portal pay: booking read failed for', bookingRef, '—', readErr.message)
    return NextResponse.json({ error: 'Could not start that payment — try again.' }, { status: 503 })
  }
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  // ── The ceiling, which had a hole in it ────────────────────────────────
  //
  // `Math.min(amountCents, balance_due_cents || amountCents)` reads as a clamp,
  // and is one — until `balance_due_cents` is 0 or NULL, when `||` falls
  // through to the caller's own figure and the clamp clamps to itself. A plan
  // that owes nothing (or whose balance has not been computed yet) would charge
  // whatever the request body asked for.
  //
  // The money rule is that the amount is derived server-side. This route is the
  // legacy portal pay path and its figure genuinely is customer-chosen — "chip
  // away at the balance however you want" — so the rule here is: a customer may
  // choose any amount UP TO what is owed, and if nothing is owed there is
  // nothing to pay. `/api/plan/[ref]/pay-link` is the derived-amount path.
  const balanceCents = booking.balance_due_cents
  if (typeof balanceCents !== 'number' || !Number.isFinite(balanceCents) || balanceCents <= 0) {
    return NextResponse.json(
      { error: 'There is no balance to pay on this booking right now. Give us a call if that looks wrong.' },
      { status: 409 },
    )
  }
  const effectiveAmount = Math.min(Math.round(amountCents), balanceCents)
  const isFinalPayment = effectiveAmount >= balanceCents
  const resolvedType = paymentType || (isFinalPayment ? 'final' : 'partial')

  // Tip handling — added only on card payments. Tip lifts the Stripe charge
  // but doesn't count toward the booking balance (it's a gratuity for the
  // helpers, not party fees). Bounded, because it is the one figure on this
  // route with no server-side ceiling of its own: an unbounded tip is an
  // unbounded charge, and a fat-fingered one is a refund conversation.
  const rawTip = Number(tipCents)
  const safeTipCents = Math.min(
    Math.max(0, Number.isFinite(rawTip) ? Math.round(rawTip) : 0),
    MAX_TIP_CENTS,
  )

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
    // The number here is the Venmo/Zelle registration number, NOT the public
    // line — see lib/paymentContacts.ts. This used to send the customer to call
    // (631) 998-9325 and ask for a handle we already hold in the environment,
    // and 998-9325 is the number that finds nothing in Venmo.
    instructions: paymentMethod === 'venmo'
      ? `Send ${formatMoney(effectiveAmount)} via Venmo to ${venmoHandle()} (Venmo phone ${zellePhone()}). Note: ${bookingRef}`
      : paymentMethod === 'zelle'
        ? `Send ${formatMoney(effectiveAmount)} via Zelle to ${zellePhone()} (Host Hampton). Memo: ${bookingRef}`
        : `Bring ${formatMoney(effectiveAmount)} cash to Host Hampton. Questions? Call or text ${PUBLIC_PHONE_DISPLAY}.`,
  })
}
