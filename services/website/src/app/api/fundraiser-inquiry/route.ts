import { ownerEmail, notifyOwnerSms, leadSmsLine } from '@/lib/ownerNotify'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { upsertContact } from '@/lib/contacts'
import { enrollInSequence } from '@/lib/sequences'
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
    marketingConsent,
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

  // Upsert contact
  const contactId = await upsertContact({
    name: contactName,
    email,
    phone,
    sourceDetail: 'Fundraiser landing page',
    serviceInterests: ['fundraiser'],
    marketingConsent: !!marketingConsent,
  })

  if (contactId) {
    await enrollInSequence({
      contactId,
      contactEmail: email,
      triggerEvent: 'new_inquiry',
      serviceType: 'fundraiser',
    }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
  }

  // Set business fields separately (upsertContact doesn't handle these)
  if (contactId) {
    await supabase
      .from('contacts')
      .update({
        is_business: true,
        business_name: organizationName,
        business_type: organizationType || null,
      })
      .eq('id', contactId)

    const { error: interactionErr } = await supabase
      .from('contact_interactions')
      .insert({
        contact_id: contactId,
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
        to: ownerEmail(),
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
    await notifyOwnerSms(leadSmsLine({ kind: 'fundraiser lead', name: `${contactName} (${organizationName})`, phone, email, extra: estimatedQuantity ? `qty ${estimatedQuantity}` : null }))
  } else {
    console.warn('RESEND_API_KEY not set — skipping fundraiser inquiry emails')
  }

  return NextResponse.json({ success: true })
}
