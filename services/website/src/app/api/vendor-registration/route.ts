import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

export const dynamic = 'force-dynamic'

// $45.00 registration + $1.35 service fee (3%) = $46.35 total. No sales tax.
const REGISTRATION_CENTS = 4500
const SERVICE_FEE_CENTS = 135

export async function POST(req: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })

  let body: {
    contactName?: string
    businessName?: string
    igHandle?: string
    email?: string
    phone?: string
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { contactName, businessName, igHandle, email, phone } = body

  if (!contactName || !businessName || !igHandle || !email || !phone) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
  }

  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'www.hosthampton.com'
  const proto = host.startsWith('localhost') ? 'http' : 'https'
  const baseUrl = `${proto}://${host}`

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: REGISTRATION_CENTS,
            product_data: {
              name: 'Spring Market Vendor Registration',
              description: `${businessName} — Host Hampton Spring Market`,
            },
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'usd',
            unit_amount: SERVICE_FEE_CENTS,
            product_data: {
              name: 'Service Fee (3%)',
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        type: 'vendor_registration',
        contactName,
        businessName,
        igHandle,
        contactEmail: email,
        contactPhone: phone,
      },
      success_url: `${baseUrl}/vendor-registration/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/vendor-registration`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Stripe error'
    console.error('vendor-registration stripe error:', msg)
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 })
  }
}
