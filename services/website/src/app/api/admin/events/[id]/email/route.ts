import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 })
  }

  const supabase = getSupabase()
  const body = await req.json()
  const { subject, htmlBody } = body

  if (!subject || !htmlBody) {
    return NextResponse.json({ error: 'Subject and body are required' }, { status: 400 })
  }

  // Get confirmed ticket holders
  const { data: tickets } = await supabase
    .from('event_tickets')
    .select('customer_email, customer_name')
    .eq('event_id', params.id)
    .eq('status', 'confirmed')

  if (!tickets || tickets.length === 0) {
    return NextResponse.json({ error: 'No confirmed attendees to email' }, { status: 400 })
  }

  // Deduplicate emails
  const emailMap = new Map<string, typeof tickets[number]>()
  for (const t of tickets) emailMap.set(t.customer_email, t)
  const uniqueEmails = Array.from(emailMap.values())

  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

  // Wrap the admin body in branded template
  const wrappedHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0ece7;">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#F6F1EB;">
  <div style="background:linear-gradient(135deg,#1a2744 0%,#2a3f6f 100%);padding:28px 40px;text-align:center;">
    <p style="color:#A1B5C8;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0;">Host Hampton · Speonk, NY</p>
  </div>
  <div style="padding:36px 40px;color:#333;font-size:15px;line-height:1.7;">
    ${htmlBody}
  </div>
  <div style="background:#1a2744;padding:20px 40px;text-align:center;">
    <p style="color:#A1B5C8;font-size:12px;margin:0;">295 Montauk Highway, Suite 7 · Speonk, NY 11972</p>
  </div>
</div>
</body></html>`

  let sent = 0
  let failed = 0

  const results = await Promise.allSettled(
    uniqueEmails.map(t =>
      resend.emails.send({
        from,
        to: t.customer_email,
        subject,
        html: wrappedHtml.replace('{{name}}', t.customer_name.split(' ')[0]),
      })
    )
  )

  for (const r of results) {
    if (r.status === 'fulfilled') sent++
    else failed++
  }

  return NextResponse.json({ sent, failed, total: uniqueEmails.length })
}
