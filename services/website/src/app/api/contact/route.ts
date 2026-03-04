import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { upsertContact } from '@/lib/contacts'
import { getSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, email, message, utm } = body

  if (!name || !email || !message) {
    return NextResponse.json({ error: 'Name, email, and message are required' }, { status: 400 })
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  // Upsert contact
  const contactId = await upsertContact({
    name,
    email,
    sourceDetail: 'Contact Us page',
    serviceInterests: ['general'],
  })

  // Log interaction
  if (contactId) {
    try {
      const supabase = getSupabase()
      await supabase.from('contact_interactions').insert({
        contact_id: contactId,
        type: 'form_submission',
        summary: `Contact Us message: ${message.slice(0, 100)}${message.length > 100 ? '...' : ''}`,
        metadata: { page: 'contact-us', message, utm: utm || null },
      })
    } catch (err) {
      console.error('Interaction insert error (non-fatal):', err)
    }
  }

  // Send admin notification
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

    const firstName = name.trim().split(/\s+/)[0]

    await Promise.allSettled([
      // Admin notification
      resend.emails.send({
        from,
        to: 'alark51@gmail.com',
        subject: `Contact form: ${name}`,
        replyTo: email,
        html: `<p><strong>${name}</strong> (${email}) sent a message via the Contact Us page:</p><blockquote style="border-left:3px solid #E8C7CB;padding:12px 16px;margin:16px 0;color:#555;">${message.replace(/\n/g, '<br>')}</blockquote><p><a href="mailto:${email}">Reply to ${name}</a></p>`,
      }),
      // Customer auto-response
      resend.emails.send({
        from,
        to: email,
        subject: 'Thanks for reaching out — Host Hampton',
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a2744;">
          <h2 style="font-size:20px;margin-bottom:12px;">Hi ${firstName}!</h2>
          <p style="font-size:14px;line-height:1.7;color:#444;">Thanks for contacting Host Hampton. We received your message and will get back to you within 24 hours.</p>
          <p style="font-size:14px;line-height:1.7;color:#444;">In the meantime, feel free to browse our <a href="https://www.hosthampton.com/party-packages" style="color:#1a2744;font-weight:600;">party packages</a> or call us at <a href="tel:6319989325" style="color:#1a2744;font-weight:600;">(631) 998-9325</a>.</p>
          <p style="font-size:13px;color:#888;margin-top:24px;">— The Host Hampton Team</p>
        </div>`,
      }),
    ])
  }

  return NextResponse.json({ success: true })
}
