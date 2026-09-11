import { ownerEmail } from '@/lib/ownerNotify'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { upsertContact } from '@/lib/contacts'
import { enrollInSequence } from '@/lib/sequences'
import { recordInboundEvent } from '@/lib/agent/events'
import { Resend } from 'resend'

function generateCouponCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous chars (0/O, 1/I)
  let code = 'HH10-'
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

export async function POST(req: NextRequest) {
  try {
    const { firstName, lastName, email, phone } = await req.json()

    if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !phone?.trim()) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    }

    const trimmed = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
    }

    // 1. Upsert contact
    const contactId = await upsertContact({
      name: `${trimmed.firstName} ${trimmed.lastName}`,
      email: trimmed.email,
      phone: trimmed.phone,
      sourceDetail: 'signup_sheet_10pct',
      serviceInterests: ['general'],
      marketingConsent: true,
    })

    // 2. Generate and store coupon
    const supabase = getSupabase()
    const couponCode = generateCouponCode()
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()

    const { error: couponErr } = await supabase.from('coupons').insert({
      code: couponCode,
      contact_id: contactId,
      discount_pct: 10,
      source: 'signup_sheet',
      expires_at: expiresAt,
    })

    if (couponErr) {
      console.error('Coupon insert error:', couponErr)
      // Non-fatal — still send the email with the code
    }

    // Booking agent: recorded as history only. A signup-sheet entry is not an
    // inquiry, so needsAction=false parks it as `ignored` — the agent must
    // never draft a party reply to someone who just wanted the 10% code.
    await recordInboundEvent({
      route: 'signup',
      contactId,
      fromAddress: trimmed.email,
      subject: `Signup sheet — ${trimmed.firstName} ${trimmed.lastName}`,
      needsAction: false,
      classification: 'signup',
      parsed: {
        name: `${trimmed.firstName} ${trimmed.lastName}`,
        email: trimmed.email,
        phone: trimmed.phone,
        sourcePage: 'signup_sheet_10pct',
      },
    })

    // 3. Send welcome email with coupon via Resend
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'Host Hampton <info@hosthampton.com>'

      await Promise.allSettled([
        // Customer email
        resend.emails.send({
          from,
          to: trimmed.email,
          subject: "Welcome to Host Hampton — Here's 10% Off! 🎉",
          html: welcomeEmailHtml(trimmed.firstName, couponCode, expiresAt),
        }),
        // Admin notification
        resend.emails.send({
          from,
          to: ownerEmail(),
          subject: `New Signup: ${trimmed.firstName} ${trimmed.lastName}`,
          replyTo: trimmed.email,
          html: adminNotificationHtml(trimmed, couponCode),
        }),
      ])
    }

    // 4. Enroll in lead follow-up sequence
    if (contactId) {
      await enrollInSequence({
        contactId,
        contactEmail: trimmed.email,
        triggerEvent: 'new_inquiry',
      }).catch(() => {})
    }

    return NextResponse.json({ ok: true, couponCode })
  } catch (err: any) {
    console.error('Signup error:', err)
    return NextResponse.json({ error: 'Failed to process signup' }, { status: 500 })
  }
}

/* ── Email Templates ── */

function welcomeEmailHtml(firstName: string, code: string, expiresAt: string): string {
  const expiryDate = new Date(expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F6F1EB;">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%);padding:36px 40px;text-align:center;">
    <p style="color:#1a2744;opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:#1a2744;font-size:28px;margin:0 0 6px;font-weight:normal;font-family:Georgia,serif;">Welcome to the Party! 🎉</h1>
    <p style="color:#1a2744;opacity:0.7;font-size:15px;margin:0;font-family:Arial,sans-serif;">Here's your exclusive 10% off coupon</p>
  </div>

  <!-- Body -->
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:#1a2744;margin:0 0 20px;font-family:Georgia,serif;">Hi ${firstName},</p>
    <p style="color:#555;line-height:1.7;margin:0 0 28px;font-family:Arial,sans-serif;">
      Thanks for joining the Host Hampton family! We're so excited to have you. As promised, here's your exclusive coupon code for <strong>10% off your first party booking</strong>.
    </p>

    <!-- Coupon Card -->
    <div style="background:linear-gradient(135deg,#A1B5C8 0%,#E8C7CB 100%);padding:3px;border-radius:12px;margin-bottom:28px;">
      <div style="background:white;border-radius:10px;padding:28px;text-align:center;">
        <p style="font-family:Arial,sans-serif;font-size:11px;color:#C9A9A6;text-transform:uppercase;letter-spacing:2px;margin:0 0 8px;">Your Coupon Code</p>
        <p style="font-family:Arial,sans-serif;font-size:36px;font-weight:bold;color:#1a2744;margin:0 0 8px;letter-spacing:3px;">${code}</p>
        <p style="font-family:Arial,sans-serif;font-size:13px;color:#555;margin:0;">
          Use code <strong>${code}</strong> when you book to save 10% on your first party!
        </p>
        <p style="font-family:Arial,sans-serif;font-size:12px;color:#999;margin:8px 0 0;">Valid through ${expiryDate}</p>
      </div>
    </div>

    <!-- CTA -->
    <div style="text-align:center;margin-bottom:28px;">
      <a href="https://www.hosthampton.com/book" style="display:inline-block;background:#1a2744;color:#F6F1EB;font-family:Arial,sans-serif;font-weight:bold;font-size:16px;padding:14px 40px;border-radius:8px;text-decoration:none;">
        Book Your Party &rarr;
      </a>
    </div>

    <p style="color:#555;line-height:1.7;margin:0;font-family:Arial,sans-serif;font-size:14px;">
      From kids' birthday parties to permanent jewelry nights, craft workshops to private room rentals — we've got the perfect celebration for you.
    </p>
  </div>

  <!-- Footer -->
  <div style="background:#BCCDEB;padding:20px 40px;text-align:center;">
    <p style="color:#1a2744;font-size:12px;margin:0 0 4px;">295 Montauk Highway, Suite 7 · Speonk, NY 11972</p>
    <p style="color:#1a2744;font-size:12px;margin:0 0 4px;">
      <a href="tel:6319989325" style="color:#1a2744;text-decoration:none;">(631) 998-9325</a> ·
      <a href="https://www.instagram.com/hosthampton" style="color:#1a2744;text-decoration:none;">@hosthampton</a> ·
      <a href="https://www.hosthampton.com" style="color:#1a2744;text-decoration:none;">hosthampton.com</a>
    </p>
    <p style="color:#1a2744;opacity:0.5;font-size:11px;margin:4px 0 0;">You received this because you signed up at Host Hampton.</p>
  </div>

</div>
</body></html>`
}

function adminNotificationHtml(
  contact: { firstName: string; lastName: string; email: string; phone: string },
  couponCode: string
): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F6F1EB;">
<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%);padding:24px 40px;text-align:center;">
    <h1 style="color:#1a2744;font-size:22px;margin:0;">New Signup Sheet Lead</h1>
  </div>
  <div style="padding:28px 40px;">
    <table style="width:100%;font-size:14px;border-collapse:collapse;">
      <tr><td style="padding:8px 0;color:#999;width:100px;"><strong>Name</strong></td><td style="padding:8px 0;color:#1a2744;">${contact.firstName} ${contact.lastName}</td></tr>
      <tr><td style="padding:8px 0;color:#999;border-top:1px solid #f0ece7;"><strong>Email</strong></td><td style="padding:8px 0;color:#1a2744;border-top:1px solid #f0ece7;"><a href="mailto:${contact.email}" style="color:#1a2744;">${contact.email}</a></td></tr>
      <tr><td style="padding:8px 0;color:#999;border-top:1px solid #f0ece7;"><strong>Phone</strong></td><td style="padding:8px 0;color:#1a2744;border-top:1px solid #f0ece7;"><a href="tel:${contact.phone}" style="color:#1a2744;">${contact.phone}</a></td></tr>
      <tr><td style="padding:8px 0;color:#999;border-top:1px solid #f0ece7;"><strong>Coupon</strong></td><td style="padding:8px 0;color:#1a2744;border-top:1px solid #f0ece7;font-weight:bold;">${couponCode}</td></tr>
    </table>
  </div>
  <div style="background:#BCCDEB;padding:16px 40px;text-align:center;">
    <p style="color:#1a2744;font-size:11px;margin:0;">Automatically saved to Contacts with email/SMS opt-in</p>
  </div>
</div>
</body></html>`
}
