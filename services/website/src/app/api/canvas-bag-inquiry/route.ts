import { NextRequest, NextResponse } from 'next/server'
import { upsertContact } from '@/lib/contacts'
import { getSupabase } from '@/lib/supabase'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, email, phone, product, colorPreference, quantity, patchIdea, occasion, marketingConsent } = body

  if (!name || !email) {
    return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  if (!product) {
    return NextResponse.json({ error: 'Please select a product' }, { status: 400 })
  }

  if (!quantity || Number(quantity) < 1) {
    return NextResponse.json({ error: 'Quantity must be at least 1' }, { status: 400 })
  }

  if (!patchIdea) {
    return NextResponse.json({ error: 'Please describe your patch design idea' }, { status: 400 })
  }

  const contactId = await upsertContact({
    name,
    email,
    phone: phone || null,
    sourceDetail: 'Canvas bags inquiry form',
    serviceInterests: ['canvas-bags'],
    marketingConsent: !!marketingConsent,
  })

  if (contactId) {
    try {
      const supabase = getSupabase()
      await supabase.from('contact_interactions').insert({
        contact_id: contactId,
        type: 'form_submission',
        summary: `Canvas bag inquiry from ${name} — ${product} x${Number(quantity)}`,
        metadata: {
          page: 'canvas-bags',
          product: product || null,
          colorPreference: colorPreference || null,
          quantity: Number(quantity),
          patchIdea: patchIdea || null,
          occasion: occasion || null,
        },
      })
    } catch (err) {
      console.error('Interaction insert error (non-fatal):', err)
    }
  }

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
    const firstName = name.trim().split(/\s+/)[0]

    await Promise.allSettled([
      resend.emails.send({
        from,
        to: 'hosthampton295@gmail.com',
        subject: `Canvas Bag Inquiry — ${name} (${product} x${Number(quantity)})`,
        replyTo: email,
        html: `<div style="font-family:sans-serif;max-width:560px;color:#2F343B;">
          <h2 style="font-size:18px;margin-bottom:16px;">New Canvas Bag Inquiry</h2>
          <table style="border-collapse:collapse;width:100%;">
            <tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;width:140px;">Name</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${name}</td></tr>
            <tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Email</td><td style="padding:8px 12px;border-bottom:1px solid #eee;"><a href="mailto:${email}">${email}</a></td></tr>
            ${phone ? `<tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Phone</td><td style="padding:8px 12px;border-bottom:1px solid #eee;"><a href="tel:${phone.replace(/\D/g, '')}">${phone}</a></td></tr>` : ''}
            <tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Product</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${product}</td></tr>
            <tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Quantity</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${Number(quantity)}</td></tr>
            ${colorPreference ? `<tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Color Pref.</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${colorPreference}</td></tr>` : ''}
            ${occasion ? `<tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Occasion</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${occasion}</td></tr>` : ''}
          </table>
          <div style="margin-top:16px;"><strong>Patch Idea:</strong>
            <blockquote style="border-left:3px solid #C7A36B;padding:12px 16px;margin:8px 0;color:#555;">
              ${patchIdea.replace(/\n/g, '<br>')}
            </blockquote>
          </div>
        </div>`,
      }),
      resend.emails.send({
        from,
        to: email,
        subject: 'Thanks for your canvas bag inquiry — Host Hampton',
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#2F343B;">
          <h2 style="font-size:20px;margin-bottom:12px;">Hi ${firstName}!</h2>
          <p style="font-size:14px;line-height:1.7;color:#555;">
            Thanks for reaching out about our custom canvas bags. We've received your inquiry for
            <strong>${product}</strong> (qty: ${Number(quantity)}) and will be in touch within 24 hours
            to confirm pricing and next steps.
          </p>
          <p style="font-size:14px;line-height:1.7;color:#555;">
            In the meantime, feel free to call or text us at
            <a href="tel:6319989325" style="color:#2F343B;font-weight:600;">(631) 998-9325</a>.
          </p>
          <p style="font-size:13px;color:#888;margin-top:24px;">— The Host Hampton Team</p>
        </div>`,
      }),
    ])
  }

  return NextResponse.json({ success: true })
}
