import { ownerEmail, notifyOwnerSms, leadSmsLine } from '@/lib/ownerNotify'
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { upsertContact } from '@/lib/contacts'
import { enrollInSequence } from '@/lib/sequences'
import { getSupabase } from '@/lib/supabase'
import { recordInboundEvent } from '@/lib/agent/events'
import { ensureLeadPlan, linkFirstTouchEvent } from '@/lib/plan'
import { escapeHtml } from '@/lib/escapeHtml'
import { mailToHref, telHref } from '@/lib/emailSafety'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, email, phone, date, details, marketingConsent, utm } = body

  if (!name || !email || !details) {
    return NextResponse.json({ error: 'Name, email, and details are required' }, { status: 400 })
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  // Upsert contact
  const contactId = await upsertContact({
    name,
    email,
    phone: phone || null,
    sourceDetail: 'mobile-party-inquiry',
    serviceInterests: ['mobile-party'],
    marketingConsent: !!marketingConsent,
  })

  if (contactId) {
    await enrollInSequence({
      contactId,
      contactEmail: email,
      triggerEvent: 'new_inquiry',
      serviceType: 'general',
    }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))

    try {
      const supabase = getSupabase()
      await supabase.from('contact_interactions').insert({
        contact_id: contactId,
        type: 'form_submission',
        summary: `Mobile party inquiry${date ? ` for ${date}` : ''}: ${details.slice(0, 100)}${details.length > 100 ? '...' : ''}`,
        metadata: { page: 'mobile-party', date: date || null, details, utm: utm || null },
      })
    } catch (err) {
      console.error('Interaction insert error (non-fatal):', err)
    }
  }

  // Booking agent: every lead is a Party Plan. The plan is created BEFORE the
  // event so its id rides along on the event — see the safety note in lib/plan.ts,
  // without it the dispatcher's booking sweep drafts this lead a second time.
  const plan = await ensureLeadPlan({
    contactName: name,
    contactEmail: email,
    contactPhone: phone || null,
    partyDate: date || null,
    notes: details || null,
    eventType: 'mobile party',
    source: 'website_form',
    tags: { source_page: 'mobile-party' },
  })

  // Booking agent: one inbound event per lead (non-fatal, never blocks).
  const firstEventId = await recordInboundEvent({
    route: 'mobile-party-inquiry',
    contactId,
    bookingId: plan.bookingId,
    fromAddress: email,
    subject: `Mobile party inquiry — ${name}`,
    body: details || null,
    classification: 'lead',
    parsed: {
      name,
      email,
      phone: phone || null,
      eventType: 'mobile party',
      date: date || null,
      details,
      sourcePage: 'mobile-party',
    },
  })

  // Provenance: the plan is created before the event (the sweep depends on
  // that order), so first_touch_event_id can only be stamped now. Fill-once
  // and never fatal — see linkFirstTouchEvent in lib/plan.ts.
  await linkFirstTouchEvent(plan.bookingId, firstEventId)

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
    const firstName = name.trim().split(/\s+/)[0]

    await Promise.allSettled([
      // Admin notification
      resend.emails.send({
        from,
        to: ownerEmail(),
        subject: `🎉 Mobile Party Inquiry — ${name}`,
        replyTo: email,
        html: `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a2744;">
  <div style="background:#1a2744;padding:24px 32px;border-radius:12px 12px 0 0;">
    <h1 style="color:#fff;font-size:20px;margin:0;">New Mobile Party Inquiry</h1>
    <p style="color:#A1B5C8;font-size:13px;margin:4px 0 0;">From the mobile party page</p>
  </div>
  <div style="background:#fff;border:1px solid #e8d0d4;border-top:none;padding:28px 32px;border-radius:0 0 12px 12px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px 0;color:#888;width:110px;">Name</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(name)}</td></tr>
      <tr><td style="padding:8px 0;color:#888;">Email</td><td style="padding:8px 0;"><a href="${mailToHref(email)}" style="color:#1a2744;font-weight:600;">${escapeHtml(email)}</a></td></tr>
      ${phone ? `<tr><td style="padding:8px 0;color:#888;">Phone</td><td style="padding:8px 0;font-weight:600;"><a href="${telHref(phone)}" style="color:#1a2744;">${escapeHtml(phone)}</a></td></tr>` : ''}
      ${date ? `<tr><td style="padding:8px 0;color:#888;">Event Date</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(date)}</td></tr>` : ''}
    </table>
    <div style="margin-top:16px;background:#fdf4f5;border-left:3px solid #E8C7CB;padding:14px 16px;border-radius:0 8px 8px 0;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#888;">Details</p>
      <p style="margin:0;font-size:14px;line-height:1.7;color:#333;">${escapeHtml(details).replace(/\n/g, '<br>')}</p>
    </div>
    <div style="margin-top:20px;">
      <a href="${mailToHref(email)}" style="background:#1a2744;color:#fff;padding:10px 22px;border-radius:999px;font-size:13px;font-weight:700;text-decoration:none;display:inline-block;">Reply to ${escapeHtml(firstName)}</a>
    </div>
  </div>
</div>`,
      }),

      // Customer confirmation
      resend.emails.send({
        from,
        to: email,
        subject: `We got your mobile party request! 🎉 — Host Hampton`,
        html: `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a2744;">
  <div style="background:linear-gradient(135deg,#E8C7CB,#F6F1EB);padding:32px;text-align:center;border-radius:12px 12px 0 0;">
    <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#1a2744;">Host Hampton</p>
    <h1 style="margin:0;font-size:26px;font-weight:800;color:#1a2744;">We're on it, ${escapeHtml(firstName)}! 🎊</h1>
  </div>
  <div style="background:#fff;border:1px solid #edd5d8;border-top:none;padding:28px 32px;border-radius:0 0 12px 12px;">
    <p style="font-size:15px;line-height:1.8;color:#444;">
      Thanks for reaching out about a mobile party! We received your request and will be in touch within <strong>24 hours</strong> to discuss the details and put together a custom quote for you.
    </p>
    ${date ? `<div style="background:#f9f2f3;border-radius:10px;padding:14px 18px;margin:20px 0;font-size:14px;color:#1a2744;"><strong>📅 Requested Date:</strong> ${escapeHtml(date)}</div>` : ''}
    <p style="font-size:14px;line-height:1.7;color:#666;margin-top:16px;">
      In the meantime, feel free to explore our full menu of activities and station options on our website, or call or text us directly at <a href="tel:6319989325" style="color:#1a2744;font-weight:700;">(631) 998-9325</a>.
    </p>
    <div style="text-align:center;margin-top:24px;">
      <a href="https://www.hosthampton.com/mobile-party" style="background:#1a2744;color:#fff;padding:12px 28px;border-radius:999px;font-size:14px;font-weight:700;text-decoration:none;display:inline-block;">View Mobile Party Menu</a>
    </div>
    <p style="font-size:12px;color:#aaa;text-align:center;margin-top:28px;">— The Host Hampton Team · Speonk, NY</p>
  </div>
</div>`,
      }),
    ])
    await notifyOwnerSms(leadSmsLine({ kind: 'MOBILE party inquiry', name, phone, email, date, extra: String(details).slice(0, 160) }))
  }

  return NextResponse.json({ success: true })
}
