import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { Resend } from 'resend'
import { sendSMSVia } from '@/lib/sms'

const BRAND = {
  headerBg: 'linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%)',
  footerBg: '#BCCDEB',
  bodyBg: '#F6F1EB',
  navy: '#1a2744',
  gray: '#555',
  ctaBg: '#1a2744',
  ctaText: '#F6F1EB',
} as const

function payLinkEmailHtml(opts: {
  firstName: string
  description: string
  amountFormatted: string
  payUrl: string
}): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton &middot; Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:26px;margin:0 0 6px;font-weight:normal;">Payment Request</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${opts.firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">Here&rsquo;s your payment link for:</p>
    <div style="background:#f9f7f4;border-radius:12px;padding:24px;margin-bottom:24px;text-align:center;">
      <p style="font-size:14px;color:${BRAND.gray};margin:0 0 8px;">${opts.description}</p>
      <p style="font-size:32px;font-weight:bold;color:${BRAND.navy};margin:0;">${opts.amountFormatted}</p>
    </div>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${opts.payUrl}" style="display:inline-block;background:${BRAND.ctaBg};color:${BRAND.ctaText};padding:16px 48px;border-radius:50px;text-decoration:none;font-size:15px;font-weight:bold;letter-spacing:0.5px;">Pay Now</a>
    </div>
    <p style="font-size:13px;color:${BRAND.gray};line-height:1.7;margin:0;">Secure payment powered by Stripe. Questions? Call or text <strong>(631) 998-9325</strong>.</p>
  </div>
  <div style="background:${BRAND.footerBg};padding:20px 40px;text-align:center;">
    <p style="color:${BRAND.navy};font-size:12px;margin:0 0 4px;">295 Montauk Highway, Suite 7 &middot; Speonk, NY 11972</p>
    <p style="color:${BRAND.navy};opacity:0.5;font-size:11px;margin:0;">Thank you for choosing Host Hampton!</p>
  </div>
</div>
</body></html>`
}

function payLinkSms(firstName: string, description: string, amountFormatted: string, payUrl: string): string {
  return `Hi ${firstName}! Here's your Host Hampton payment link for ${description} (${amountFormatted}): ${payUrl}`
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (token !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { name, email, phone, channel, amountDollars, description, category, linkType } = await req.json()

  if (!name || !amountDollars || !description) {
    return NextResponse.json({ error: 'Name, amount, and description are required' }, { status: 400 })
  }

  const amountCents = Math.round(parseFloat(amountDollars) * 100)
  if (amountCents < 100) {
    return NextResponse.json({ error: 'Minimum amount is $1.00' }, { status: 400 })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
  const host = 'www.hosthampton.com'

  const metadata = {
    type: 'pay_link',
    customerName: name,
    customerEmail: email || '',
    customerPhone: phone || '',
    description,
    amountCents: String(amountCents),
    category: category || 'Room Rental',
  }

  let payUrl: string

  if (linkType === 'payment_link') {
    // Payment Links don't expire by default — good for links that need to
    // stay valid more than 24h (Checkout Sessions cap out at 24h). Payment
    // Links require a real Price object, so create an ephemeral Product +
    // Price first, then the link that references it.
    const product = await stripe.products.create({ name: description })
    const price = await stripe.prices.create({
      product: product.id,
      currency: 'usd',
      unit_amount: amountCents,
    })
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata,
      after_completion: {
        type: 'redirect',
        redirect: { url: `https://${host}/book/success?ref=paylink` },
      },
    })
    payUrl = paymentLink.url
  } else {
    // Default: Stripe Checkout Session — expires 24h after creation, no way
    // to extend further. Use linkType: 'payment_link' for anything that
    // needs to stay valid longer.
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: email || undefined,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: description },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      metadata,
      success_url: `https://${host}/book/success?ref=paylink`,
      cancel_url: `https://${host}/?cancelled=true`,
    })
    payUrl = session.url!
  }
  const firstName = name.split(' ')[0] || 'there'
  const amountFormatted = `$${(amountCents / 100).toFixed(2)}`
  const results: string[] = []

  // Send via requested channel(s)
  if ((channel === 'email' || channel === 'both') && email) {
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 })
    }
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
    const { error } = await resend.emails.send({
      from,
      to: email,
      subject: `Payment Request — ${amountFormatted} | Host Hampton`,
      html: payLinkEmailHtml({ firstName, description, amountFormatted, payUrl }),
    })
    if (error) {
      console.error('Pay link email error:', error)
      return NextResponse.json({ error: `Email failed: ${error.message}` }, { status: 500 })
    }
    results.push(`Email sent to ${email}`)
  }

  if ((channel === 'sms' || channel === 'both') && phone) {
    const sid = await sendSMSVia('quo', phone, payLinkSms(firstName, description, amountFormatted, payUrl))
    if (!sid) {
      return NextResponse.json({ error: 'SMS failed — check Twilio config' }, { status: 500 })
    }
    results.push(`SMS sent to ${phone}`)
  }

  // If no channel specified or 'link_only', just return the link
  if (!channel || channel === 'link_only') {
    results.push('Link generated')
  }

  return NextResponse.json({ ok: true, payUrl, results })
}
