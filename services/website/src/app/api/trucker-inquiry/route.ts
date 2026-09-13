import { ownerEmail, notifyOwnerSms, leadSmsLine } from '@/lib/ownerNotify'
import { NextRequest, NextResponse } from 'next/server'
import { upsertContact } from '@/lib/contacts'
import { enrollInSequence } from '@/lib/sequences'
import { getSupabase } from '@/lib/supabase'
import { recordInboundEvent } from '@/lib/agent/events'
import { ensureLeadPlan, linkFirstTouchEvent } from '@/lib/plan'
import { Resend } from 'resend'
import { escapeHtml } from '@/lib/escapeHtml'
import { mailToHref, telHref } from '@/lib/emailSafety'
import { guardRate, intakeRule } from '@/lib/rateLimit'
import { logInteraction } from '@/lib/contactInteractions'
import {
  emptyIntakeRecord,
  landedSomewhere,
  missingFrom,
  settledOk,
} from '@/lib/publicIntake'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const limited = guardRate(req, intakeRule('trucker-inquiry'))
  if (limited) return limited

  const recorded = emptyIntakeRecord()
  const body = await req.json()
  const { name, email, phone, company, eventType, date, guests, vision, marketingConsent } = body

  if (!name || !email) {
    return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  const contactId = await upsertContact({
    name,
    email,
    phone: phone || null,
    sourceDetail: 'Inquiry form — trucker-hat-bar',
    serviceInterests: ['trucker-hat-bar'],
    marketingConsent: !!marketingConsent,
  })
  recorded.contact = !!contactId

  if (contactId) {
    await enrollInSequence({
      contactId,
      contactEmail: email,
      triggerEvent: 'new_inquiry',
      serviceType: 'trucker_hat_bar',
    }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
  }

  if (contactId) {
    const supabase = getSupabase()
    if (company) {
      // Unchecked, this silently failed to record that a lead is a business —
      // and note WHAT it writes: `business_name` on a contact row resolved from
      // an unverified email address, from a public form (rule 19).
      const { error: bizErr } = await supabase.from('contacts').update({
        is_business: true,
        business_name: company,
      }).eq('id', contactId)
      if (bizErr) console.error('trucker-inquiry: business fields not stored —', bizErr.message)
    }
    // Through `logInteraction` (rules 11 and 19) — this was a raw insert inside a
    // try/catch that threw the SQLSTATE away.
    recorded.interaction = await logInteraction(supabase, {
      contactId,
      type: 'form_submission',
      summary: `Atelier Brim inquiry from ${name}${company ? ` (${company})` : ''}`,
      metadata: {
        page: 'trucker-hat-bar',
        company: company || null,
        eventType: eventType || null,
        date: date || null,
        guests: guests || null,
        vision: vision || null,
      },
    })
  }

  // Booking agent: every lead is a Party Plan. The plan is created BEFORE the
  // event so its id rides along on the event — see the safety note in lib/plan.ts,
  // without it the dispatcher's booking sweep drafts this lead a second time.
  const plan = await ensureLeadPlan({
    contactName: name,
    contactEmail: email,
    contactPhone: phone || null,
    partyDate: date || null,
    guestCount: Number(guests) || null,
    notes: [company ? `Company: ${company}` : null, vision].filter(Boolean).join('\n') || null,
    eventType: eventType || 'trucker hat bar',
    source: 'website_form',
    tags: { source_page: 'trucker-hat-bar', ...(company ? { company } : {}) },
  })
  recorded.plan = !!plan.bookingId && plan.enriched !== false

  // Booking agent: one inbound event per inquiry (non-fatal, never blocks).
  const firstEventId = await recordInboundEvent({
    route: 'trucker-inquiry',
    bookingId: plan.bookingId,
    contactId,
    fromAddress: email,
    subject: `Trucker hat bar inquiry — ${company || name}`,
    body: vision || null,
    classification: 'lead',
    parsed: {
      name,
      email,
      phone: phone || null,
      eventType: eventType || 'trucker hat bar',
      date: date || null,
      guests: guests || null,
      notes: [company ? `Company: ${company}` : null, vision].filter(Boolean).join('\n') || null,
      sourcePage: 'trucker-hat-bar',
    },
  })
  recorded.event = !!firstEventId

  // Provenance: the plan is created before the event (the sweep depends on
  // that order), so first_touch_event_id can only be stamped now. Fill-once
  // and never fatal — see linkFirstTouchEvent in lib/plan.ts.
  await linkFirstTouchEvent(plan.bookingId, firstEventId)

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
    const firstName = name.trim().split(/\s+/)[0]

    const results = await Promise.allSettled([
      resend.emails.send({
        from,
        to: ownerEmail(),
        subject: `Atelier Brim Inquiry — ${company || name}`,
        replyTo: email,
        html: `<div style="font-family:sans-serif;max-width:520px;color:#1a2744;">
          <h2 style="font-size:18px;margin-bottom:16px;">New Trucker Hat Bar Inquiry</h2>
          <table style="border-collapse:collapse;width:100%;">
            <tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Name</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(name)}</td></tr>
            <tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Email</td><td style="padding:8px 12px;border-bottom:1px solid #eee;"><a href="${mailToHref(email)}">${escapeHtml(email)}</a></td></tr>
            ${phone ? `<tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Phone</td><td style="padding:8px 12px;border-bottom:1px solid #eee;"><a href="${telHref(phone)}">${escapeHtml(phone)}</a></td></tr>` : ''}
            ${company ? `<tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Company</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(company)}</td></tr>` : ''}
            ${eventType ? `<tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Event Type</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(eventType)}</td></tr>` : ''}
            ${date ? `<tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Date</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(date)}</td></tr>` : ''}
            ${guests ? `<tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Guests</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(guests)}</td></tr>` : ''}
          </table>
          ${vision ? `<div style="margin-top:16px;"><strong>The Vision:</strong><blockquote style="border-left:3px solid #C9A5A5;padding:12px 16px;margin:8px 0;color:#555;">${escapeHtml(vision).replace(/\n/g, '<br>')}</blockquote></div>` : ''}
        </div>`,
      }),
      resend.emails.send({
        from,
        to: email,
        subject: 'Thanks for your inquiry — Atelier Brim by Host Hampton',
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#3C2A21;">
          <h2 style="font-size:20px;margin-bottom:12px;">Hi ${escapeHtml(firstName)}!</h2>
          <p style="font-size:14px;line-height:1.7;color:#555;">Thanks for reaching out about our Trucker Hat Bar experience. We've received your inquiry and our team will be in touch within 24 hours to discuss your vision.</p>
          <p style="font-size:14px;line-height:1.7;color:#555;">In the meantime, feel free to call or text us at <a href="tel:6319989325" style="color:#3C2A21;font-weight:600;">(631) 998-9325</a>.</p>
          <p style="font-size:13px;color:#888;margin-top:24px;">— The Host Hampton Team</p>
        </div>`,
      }),
    ])
    // The OWNER notification is the one that makes a lead recoverable by hand.

    recorded.ownerNotified = settledOk(results[0])

    if (!recorded.ownerNotified) console.error('trucker-inquiry: owner notification did NOT send —', JSON.stringify(results[0]).slice(0, 300))

    await notifyOwnerSms(leadSmsLine({ kind: 'Trucker Hat Bar inquiry', name: company ? `${name} (${company})` : name, phone, email, date, guests }))
  }

  const missing = missingFrom(recorded)

  if (!landedSomewhere(recorded)) {

    console.error(`trucker-inquiry: NOTHING recorded for a lead from ${email} — missing ${missing.join(', ')}`)

    return NextResponse.json(

      { error: 'We could not save your enquiry just now. Please try again, or call us on (631) 998-9325.' },

      { status: 503 },

    )

  }

  if (missing.length) console.warn(`trucker-inquiry: lead from ${email} recorded with gaps — missing ${missing.join(', ')}`)


  return NextResponse.json({ success: true, recorded })
}
