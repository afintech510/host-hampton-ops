import { ownerEmail, notifyOwnerSms, leadSmsLine } from '@/lib/ownerNotify'
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { upsertContact } from '@/lib/contacts'
import { enrollInSequence } from '@/lib/sequences'
import { getSupabase } from '@/lib/supabase'
import { logInteraction } from '@/lib/contactInteractions'
import { recordInboundEvent } from '@/lib/agent/events'
import { ensureLeadPlan, linkFirstTouchEvent } from '@/lib/plan'
import { escapeHtml } from '@/lib/escapeHtml'
import { mailToHref } from '@/lib/emailSafety'
import { guardRate, intakeRule } from '@/lib/rateLimit'
import {
  boundedIntakeText,
  emptyIntakeRecord,
  landedSomewhere,
  missingFrom,
  settledOk,
  MAX_INTAKE_NAME_CHARS,
} from '@/lib/publicIntake'

export const dynamic = 'force-dynamic'

/**
 * The Contact Us form.
 *
 * ── IT USED TO ANSWER `{ success: true }` OVER A LOST LEAD ──
 *
 * `upsertContact` can return null, `ensureLeadPlan` can return `NOT_CREATED`,
 * `recordInboundEvent` can fail, the `contact_interactions` insert sat inside a
 * `try { … } catch { console.error }` that discarded the SQLSTATE, and the two
 * emails went out through `Promise.allSettled` with the results thrown away. Every
 * one of those could fail and the route still ended
 * `return NextResponse.json({ success: true })` — so a visitor was told "we
 * received your message and will get back to you within 24 hours" over a message
 * that existed nowhere. That is hard-won rule 10's expensive half (a guardrail
 * must not say it did something it did not) on the surface where the thing lost is
 * a LEAD, i.e. revenue. It is the same shape that answered 200 with a
 * confirmation page over 21 people's unsubscribes.
 *
 * It now tracks what landed. A lead that reached Adam's inbox but no table is
 * DAMAGED and logged loudly; one that reached nothing at all is LOST and answers
 * 503, so the form retries instead of thanking them.
 */
export async function POST(req: NextRequest) {
  const limited = guardRate(req, intakeRule('contact'))
  if (limited) return limited

  const body = await req.json()
  const { name, email, phone, message, utm, marketingConsent } = body

  if (!name || !email || !message) {
    return NextResponse.json({ error: 'Name, email, and message are required' }, { status: 400 })
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }
  if (String(name).length > MAX_INTAKE_NAME_CHARS) {
    return NextResponse.json({ error: 'That name is too long' }, { status: 400 })
  }

  // Bounded before it reaches `bookings.notes`, an email, an SMS billed by the
  // segment, and — through `ingested_messages.body` — the agent's draft prompt.
  const boundedMessage = boundedIntakeText(message)
  if (!boundedMessage) {
    return NextResponse.json({ error: 'Please tell us a little about your event' }, { status: 400 })
  }

  const recorded = emptyIntakeRecord()

  // Upsert contact
  const contactId = await upsertContact({
    name,
    email,
    phone: phone || null,
    sourceDetail: 'Contact Us page',
    serviceInterests: ['general'],
    marketingConsent: !!marketingConsent,
  })
  recorded.contact = !!contactId

  if (contactId) {
    await enrollInSequence({
      contactId,
      contactEmail: email,
      triggerEvent: 'new_inquiry',
      serviceType: 'general',
    }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))

    // Through `logInteraction`, which is typed against
    // `contact_interactions_type_check` and REPORTS a refusal. This was a raw
    // insert inside a try/catch that discarded the SQLSTATE — the shape that hid
    // five months of refused `sequence_email_sent` rows.
    recorded.interaction = await logInteraction(getSupabase(), {
      contactId,
      type: 'form_submission',
      summary: `Contact Us message: ${boundedMessage.slice(0, 100)}${boundedMessage.length > 100 ? '...' : ''}`,
      metadata: { page: 'contact-us', message: boundedMessage, utm: utm || null },
    })
  }

  // Booking agent: every lead is a Party Plan. The plan is created BEFORE the
  // event so its id rides along on the event — see the safety note in lib/plan.ts,
  // without it the dispatcher's booking sweep drafts this lead a second time.
  const plan = await ensureLeadPlan({
    contactName: name,
    contactEmail: email,
    contactPhone: phone || null,
    notes: boundedMessage,
    source: 'website_form',
    tags: { source_page: 'contact-us' },
  })
  // A reused plan whose enrichment write was refused carries none of this
  // message, so it is not a place this inquiry was recorded.
  recorded.plan = !!plan.bookingId && plan.enriched !== false

  // Booking agent: one inbound event per message (non-fatal, never blocks).
  const firstEventId = await recordInboundEvent({
    route: 'contact',
    bookingId: plan.bookingId,
    contactId,
    fromAddress: email,
    subject: `Contact form — ${name}`,
    body: boundedMessage,
    classification: 'lead',
    parsed: { name, email, phone: phone || null, details: boundedMessage, sourcePage: 'contact-us' },
  })
  recorded.event = !!firstEventId

  // Provenance: the plan is created before the event (the sweep depends on
  // that order), so first_touch_event_id can only be stamped now. Fill-once
  // and never fatal — see linkFirstTouchEvent in lib/plan.ts.
  await linkFirstTouchEvent(plan.bookingId, firstEventId)

  // Send admin notification
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

    const firstName = name.trim().split(/\s+/)[0]

    const results = await Promise.allSettled([
      // Admin notification
      resend.emails.send({
        from,
        to: ownerEmail(),
        subject: `Contact form: ${name}`,
        replyTo: email,
        html: `<p><strong>${escapeHtml(name)}</strong> (${escapeHtml(email)}) sent a message via the Contact Us page:</p><blockquote style="border-left:3px solid #E8C7CB;padding:12px 16px;margin:16px 0;color:#555;">${escapeHtml(boundedMessage).replace(/\n/g, '<br>')}</blockquote><p><a href="${mailToHref(email)}">Reply to ${escapeHtml(name)}</a></p>`,
      }),
      // Customer auto-response
      resend.emails.send({
        from,
        to: email,
        subject: 'Thanks for reaching out — Host Hampton',
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a2744;">
          <h2 style="font-size:20px;margin-bottom:12px;">Hi ${escapeHtml(firstName)}!</h2>
          <p style="font-size:14px;line-height:1.7;color:#444;">Thanks for contacting Host Hampton. We received your message and will get back to you within 24 hours.</p>
          <p style="font-size:14px;line-height:1.7;color:#444;">In the meantime, feel free to browse our <a href="https://www.hosthampton.com/party-packages" style="color:#1a2744;font-weight:600;">party packages</a> or call us at <a href="tel:6319989325" style="color:#1a2744;font-weight:600;">(631) 998-9325</a>.</p>
          <p style="font-size:13px;color:#888;margin-top:24px;">— The Host Hampton Team</p>
        </div>`,
      }),
    ])
    // The ADMIN notification is what makes a lead recoverable by hand, so it is
    // the one that counts here. A rejected promise and a resolved one carrying
    // `{ error }` are both failures; the old code could see neither.
    recorded.ownerNotified = settledOk(results[0])
    if (!recorded.ownerNotified) {
      console.error('contact: owner notification did NOT send —', JSON.stringify(results[0]).slice(0, 300))
    }
    await notifyOwnerSms(leadSmsLine({ kind: 'contact form message', name, phone, email, extra: boundedMessage.slice(0, 160) }))
  }

  const missing = missingFrom(recorded)
  if (!landedSomewhere(recorded)) {
    // Nothing stored it and nobody was told. Saying "we got your message" here is
    // the lie; a 503 makes the form offer a retry.
    console.error(`contact: NOTHING recorded for a lead from ${email} — missing ${missing.join(', ')}`)
    return NextResponse.json(
      { error: 'We could not save your message just now. Please try again, or call us on (631) 998-9325.' },
      { status: 503 },
    )
  }
  if (missing.length) {
    console.warn(`contact: lead from ${email} recorded with gaps — missing ${missing.join(', ')}`)
  }

  return NextResponse.json({ success: true, recorded })
}
