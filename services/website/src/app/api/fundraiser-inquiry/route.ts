import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { Resend } from 'resend'
import {
  fundraiserInquiryAutoReplyHtml,
  fundraiserInquiryNotifyHtml,
} from '@/lib/emailTemplates'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = getSupabase()
  const body = await req.json()

  const {
    organizationName,
    contactName,
    email,
    phone,
    organizationType,
    estimatedQuantity,
    message,
  } = body

  // Validate required fields
  if (!organizationName || !contactName || !email) {
    return NextResponse.json(
      { error: 'Missing required fields: organizationName, contactName, and email are required' },
      { status: 400 }
    )
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return NextResponse.json(
      { error: 'Invalid email address' },
      { status: 400 }
    )
  }

  // Split name into first/last for contacts table
  const nameParts = contactName.trim().split(/\s+/)
  const firstName = nameParts[0]
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null

  // Upsert contact (service key bypasses RLS)
  const { error: contactErr } = await supabase
    .from('contacts')
    .upsert(
      {
        email,
        first_name: firstName,
        last_name: lastName,
        phone: phone || null,
        status: 'lead',
        source: 'direct',
        source_detail: 'Fundraiser landing page',
        service_interests: ['fundraiser'],
        is_business: true,
        business_name: organizationName,
        business_type: organizationType || null,
      },
      { onConflict: 'email' }
    )

  if (contactErr) {
    console.error('Contact upsert error:', contactErr)
    // Non-fatal — continue to send emails
  }

  // Fetch contact id for interaction record (contact_id is NOT NULL)
  const { data: contact } = await supabase
    .from('contacts')
    .select('id')
    .eq('email', email)
    .single()

  if (contact?.id) {
    const { error: interactionErr } = await supabase
      .from('contact_interactions')
      .insert({
        contact_id: contact.id,
        type: 'form_submission',
        summary: `Fundraiser inquiry from ${organizationName}`,
        metadata: {
          page: 'fundraiser',
          organizationName,
          organizationType: organizationType || null,
          estimatedQuantity: estimatedQuantity || null,
          message: message || null,
        },
      })

    if (interactionErr) {
      console.error('Interaction insert error:', interactionErr)
    }
  }

  // Send emails via Resend
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

    await Promise.allSettled([
      resend.emails.send({
        from,
        to: email,
        subject: 'We got your fundraiser request — mockup coming within 24 hrs!',
        html: fundraiserInquiryAutoReplyHtml({
          contactName,
          organizationName,
          estimatedQuantity,
          organizationType,
        }),
      }),
      resend.emails.send({
        from,
        to: 'alark51@gmail.com',
        subject: `New fundraiser lead: ${organizationName} — ${contactName}`,
        html: fundraiserInquiryNotifyHtml({
          contactName,
          organizationName,
          email,
          phone,
          organizationType: organizationType || 'other',
          estimatedQuantity,
          message,
        }),
      }),
    ])
  } else {
    console.warn('RESEND_API_KEY not set — skipping fundraiser inquiry emails')
  }

  return NextResponse.json({ success: true })
}
