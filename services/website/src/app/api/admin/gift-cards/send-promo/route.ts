import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { sendSMS } from '@/lib/twilio'
import { escapeHtml } from '@/lib/escapeHtml'

const BRAND = {
  headerBg: 'linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%)',
  footerBg: '#BCCDEB',
  bodyBg: '#F6F1EB',
  cardBorder: 'linear-gradient(135deg,#A1B5C8 0%,#E8C7CB 100%)',
  navy: '#1a2744',
  gray: '#555',
  ctaBg: '#1a2744',
  ctaText: '#F6F1EB',
} as const

function giftCardPromoHtml(name: string): string {
  const firstName = name.split(' ')[0] || 'there'
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton &middot; Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0 0 6px;font-weight:normal;">Give the Gift of Celebration</h1>
    <p style="color:${BRAND.navy};opacity:0.7;font-size:15px;margin:0;">Host Hampton Gift Cards</p>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${escapeHtml(firstName)},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">Looking for the perfect gift? A <strong>Host Hampton gift card</strong> lets someone special choose their own celebration &mdash; from birthday parties and events to room rentals and more.</p>
    <div style="background:${BRAND.cardBorder};padding:3px;border-radius:12px;margin-bottom:24px;">
      <div style="background:white;border-radius:10px;padding:28px;text-align:center;">
        <p style="font-size:32px;margin:0 0 8px;">&#127873;</p>
        <h2 style="font-size:18px;color:${BRAND.navy};margin:0 0 10px;font-weight:bold;">Digital Gift Cards</h2>
        <p style="color:${BRAND.gray};font-size:14px;line-height:1.7;margin:0 0 6px;">Available from <strong>$25 &ndash; $500</strong></p>
        <p style="color:${BRAND.gray};font-size:13px;line-height:1.6;margin:0;">Delivered instantly by email &bull; Printable &bull; Never expires</p>
      </div>
    </div>
    <div style="background:#f0ece7;border-radius:10px;padding:20px;margin-bottom:24px;">
      <h3 style="font-size:14px;color:${BRAND.navy};margin:0 0 12px;">Use it for anything at Host Hampton:</h3>
      <table style="width:100%;font-size:14px;color:${BRAND.gray};">
        <tr><td style="padding:4px 0;">&#127880; Kids &amp; teen birthday parties</td></tr>
        <tr><td style="padding:4px 0;">&#127881; Private room rentals</td></tr>
        <tr><td style="padding:4px 0;">&#128142; Permanent jewelry sessions</td></tr>
        <tr><td style="padding:4px 0;">&#127775; Special events &amp; workshops</td></tr>
        <tr><td style="padding:4px 0;">&#128666; Mobile party experiences</td></tr>
      </table>
    </div>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="https://www.hosthampton.com/gift-cards" style="display:inline-block;background:${BRAND.ctaBg};color:${BRAND.ctaText};padding:16px 40px;border-radius:50px;text-decoration:none;font-size:15px;font-weight:bold;letter-spacing:0.5px;">Buy a Gift Card</a>
    </div>
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? Reach out anytime:<br>
      <strong><a href="tel:6319989325" style="color:${BRAND.navy};text-decoration:none;">&#128222; (631) 998-9325</a></strong> &nbsp;&middot;&nbsp;
      <strong><a href="sms:6319989325" style="color:${BRAND.navy};text-decoration:none;">&#128172; Text Us</a></strong><br>
      <strong><a href="mailto:hosthampton295@gmail.com" style="color:${BRAND.navy};text-decoration:none;">&#9993;&#65039; hosthampton295@gmail.com</a></strong>
    </p>
  </div>
  <div style="background:${BRAND.footerBg};padding:20px 40px;text-align:center;">
    <p style="color:${BRAND.navy};font-size:12px;margin:0 0 4px;">295 Montauk Highway, Suite 7 &middot; Speonk, NY 11972</p>
    <p style="color:${BRAND.navy};opacity:0.5;font-size:11px;margin:0;">Celebrate with us!</p>
  </div>
</div>
</body></html>`
}

function giftCardPromoSms(firstName: string): string {
  return `Hi ${firstName}! 🎁 Give the gift of celebration — Host Hampton gift cards are perfect for birthdays, events & more. $25–$500, delivered instantly. Buy here: https://www.hosthampton.com/gift-cards Reply STOP to opt out`
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (token !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { name, email, phone, channel } = await req.json()

  if (!name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const results: string[] = []

  if (channel === 'email' || channel === 'both') {
    if (!email) return NextResponse.json({ error: 'Email is required for email channel' }, { status: 400 })
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 })

    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
    const { error } = await resend.emails.send({
      from,
      to: email,
      subject: '🎁 Give the Gift of Celebration — Host Hampton Gift Cards',
      html: giftCardPromoHtml(name),
    })
    if (error) {
      console.error('Gift card promo email error:', error)
      return NextResponse.json({ error: `Email failed: ${error.message}` }, { status: 500 })
    }
    results.push(`Email sent to ${email}`)
  }

  if (channel === 'sms' || channel === 'both') {
    if (!phone) return NextResponse.json({ error: 'Phone is required for SMS channel' }, { status: 400 })

    const firstName = name.split(' ')[0] || 'there'
    const sid = await sendSMS(phone, giftCardPromoSms(firstName))
    if (!sid) {
      return NextResponse.json({ error: 'SMS failed — check Twilio config' }, { status: 500 })
    }
    results.push(`SMS sent to ${phone}`)
  }

  return NextResponse.json({ ok: true, results })
}
