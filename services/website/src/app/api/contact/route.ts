import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { upsertContact } from '@/lib/contacts'
import { getSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, email, message } = body

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
        metadata: { page: 'contact-us', message },
      })
    } catch (err) {
      console.error('Interaction insert error (non-fatal):', err)
    }
  }

  // Send admin notification
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

    await resend.emails.send({
      from,
      to: 'alark51@gmail.com',
      subject: `Contact form: ${name}`,
      replyTo: email,
      html: `<p><strong>${name}</strong> (${email}) sent a message via the Contact Us page:</p><blockquote style="border-left:3px solid #E8C7CB;padding:12px 16px;margin:16px 0;color:#555;">${message.replace(/\n/g, '<br>')}</blockquote><p><a href="mailto:${email}">Reply to ${name}</a></p>`,
    })
  }

  return NextResponse.json({ success: true })
}
