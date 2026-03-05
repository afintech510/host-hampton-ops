import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'

const BRAND = {
  navy: '#1a2744',
  dustyBlue: '#A1B5C8',
  blush: '#E8C7CB',
  ivory: '#F6F1EB',
  mauve: '#C9A9A6',
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const body = await req.json()
  const { customer_email, subject, htmlBody } = body

  if (!customer_email || !subject || !htmlBody) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email not configured' }, { status: 500 })
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

  // Wrap in branded template
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.ivory};font-family:'Poppins',Helvetica,Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,${BRAND.blush} 0%,${BRAND.dustyBlue} 100%);padding:28px 32px;text-align:center;">
      <h1 style="color:${BRAND.navy};margin:0;font-family:'Libre Baskerville',Georgia,serif;font-size:22px;">Host Hampton</h1>
    </div>
    <div style="padding:32px;font-size:15px;line-height:1.6;color:#333;">
      ${htmlBody}
    </div>
    <div style="padding:20px 32px;background:${BRAND.ivory};text-align:center;font-size:12px;color:#888;">
      <p style="margin:0;">Host Hampton &bull; 36 E Main St, Speonk NY 11972</p>
      <p style="margin:4px 0 0;"><a href="https://www.hosthampton.com" style="color:${BRAND.mauve};">www.hosthampton.com</a></p>
    </div>
  </div>
</div>
</body>
</html>`

  try {
    await resend.emails.send({ from, to: customer_email, subject, html })
    return NextResponse.json({ sent: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
