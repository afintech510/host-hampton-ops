import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

export async function POST(req: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })

  try {
    const body = await req.json()
    const {
      packageName,
      partyDate,
      partyTime,
      eventType,
      contactName,
      contactEmail,
      contactPhone,
      childName,
      childAge,
      guestCount,
      notes,
      partyTags,
    } = body

    if (!partyDate || !partyTime || !contactName || !contactEmail) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Host Hampton — ${packageName || 'Party'} Deposit`,
              description: `Party date: ${partyDate} at ${partyTime}. Deposit locks your date — applied toward total balance.`,
            },
            unit_amount: 25000, // $250 in cents
          },
          quantity: 1,
        },
      ],
      customer_email: contactEmail,
      metadata: {
        packageName: packageName || '',
        partyDate,
        partyTime,
        eventType: eventType || 'kid-party',
        contactName,
        contactEmail,
        contactPhone: contactPhone || '',
        childName: childName || '',
        childAge: childAge || '',
        guestCount: guestCount || '',
        notes: notes || '',
        partyTags: JSON.stringify(partyTags || {}),
      },
      // Use forwarded host from nginx (req.nextUrl.origin is the internal Docker hostname)
      success_url: `https://${req.headers.get('x-forwarded-host') || req.headers.get('host')}/book/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://${req.headers.get('x-forwarded-host') || req.headers.get('host')}/book?cancelled=true`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Checkout failed'
    console.error('Stripe checkout error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
