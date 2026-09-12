import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { publicOrigin } from '@/lib/publicOrigin'

export async function POST(req: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })

  try {
    const body = await req.json()
    const {
      amountCents,
      purchaserName,
      purchaserEmail,
      recipientName,
      recipientEmail,
      personalMessage,
    } = body

    if (!amountCents || !purchaserName || !purchaserEmail || !recipientName || !recipientEmail) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (amountCents < 2500 || amountCents > 50000) {
      return NextResponse.json({ error: 'Amount must be between $25 and $500' }, { status: 400 })
    }

    const amountFormatted = `$${(amountCents / 100).toFixed(0)}`
    const origin = publicOrigin(req)

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Host Hampton Gift Card — ${amountFormatted}`,
              description: `Gift card for ${recipientName}. Redeemable toward any party, event, or experience at Host Hampton.`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      customer_email: purchaserEmail,
      metadata: {
        type: 'gift_card',
        amountCents: String(amountCents),
        purchaserName,
        purchaserEmail,
        recipientName,
        recipientEmail,
        personalMessage: personalMessage || '',
      },
      success_url: `${origin}/gift-cards/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/gift-cards?cancelled=true`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Checkout failed'
    console.error('Gift card checkout error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
