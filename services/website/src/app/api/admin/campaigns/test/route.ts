import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { sendSMS } from '@/lib/twilio'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/campaigns/test — send a test email or SMS to specific recipients
 * Body: { type: 'email' | 'sms', subject?, body_html?, body_text?, recipients: string[] }
 */
export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const { type, subject, body_html, body_text, recipients } = await req.json()

  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    return NextResponse.json({ error: 'At least one recipient is required' }, { status: 400 })
  }

  if (recipients.length > 10) {
    return NextResponse.json({ error: 'Maximum 10 test recipients allowed' }, { status: 400 })
  }

  const results: { recipient: string; success: boolean; error?: string }[] = []

  if (type === 'email') {
    if (!subject || !body_html) {
      return NextResponse.json({ error: 'Subject and body_html required for email test' }, { status: 400 })
    }

    // Use Resend for test emails (already working for transactional)
    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)

    for (const email of recipients) {
      try {
        const { error } = await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'Host Hampton <noreply@mail.hosthampton.com>',
          to: email.trim(),
          subject: `[TEST] ${subject}`,
          html: body_html,
        })
        results.push({ recipient: email, success: !error, error: error?.message })
      } catch (err: any) {
        results.push({ recipient: email, success: false, error: err.message })
      }
    }
  } else if (type === 'sms') {
    if (!body_text) {
      return NextResponse.json({ error: 'body_text required for SMS test' }, { status: 400 })
    }

    for (const phone of recipients) {
      const normalized = phone.trim().replace(/[^\d+]/g, '')
      const to = normalized.startsWith('+') ? normalized : `+1${normalized}`
      const sid = await sendSMS(to, `[TEST] ${body_text}`)
      results.push({ recipient: phone, success: !!sid, error: sid ? undefined : 'Send failed' })
    }
  } else {
    return NextResponse.json({ error: 'type must be "email" or "sms"' }, { status: 400 })
  }

  const successCount = results.filter(r => r.success).length
  return NextResponse.json({
    message: `${successCount}/${results.length} test ${type === 'email' ? 'emails' : 'messages'} sent`,
    results,
  })
}
