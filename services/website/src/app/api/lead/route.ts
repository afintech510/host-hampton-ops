import { ownerEmail, notifyOwnerSms, leadSmsLine } from '@/lib/ownerNotify'
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { leadNotifyHtml, leadConfirmHtml } from '@/lib/emailTemplates'
import { upsertContact } from '@/lib/contacts'
import { enrollInSequence } from '@/lib/sequences'
import { recordInboundEvent } from '@/lib/agent/events'
import { ensureLeadPlan, linkFirstTouchEvent } from '@/lib/plan'
import { publicOrigin } from '@/lib/publicOrigin'
import { logInteraction } from '@/lib/contactInteractions'
import { guardRate, intakeRule } from '@/lib/rateLimit'
import {
  boundedIntakeText,
  emptyIntakeRecord,
  landedSomewhere,
  missingFrom,
  settledOk,
  screenPublicGuestCount,
  MAX_INTAKE_NAME_CHARS,
} from '@/lib/publicIntake'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const limited = guardRate(req, intakeRule('lead'))
  if (limited) return limited

  const body = await req.json()

  const {
    eventType,
    fullName,
    email,
    phone,
    childAge,
    guestCount,
    partyTheme,
    preferredDate,
    timeOfDay,
    notes,
    sourcePage,
    utm,
    marketingConsent,
  } = body

  // Validate required fields
  if (!fullName || !email || !phone || !eventType) {
    return NextResponse.json(
      { error: 'Missing required fields: fullName, email, phone, and eventType are required' },
      { status: 400 }
    )
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }
  if (String(fullName).length > MAX_INTAKE_NAME_CHARS) {
    return NextResponse.json({ error: 'That name is too long' }, { status: 400 })
  }

  // Bounded before they reach `bookings.notes`, two emails, an SMS billed per
  // segment and the agent's draft prompt.
  const boundedNotes = boundedIntakeText(notes)
  const boundedTheme = boundedIntakeText(partyTheme, 200)
  const screenedGuests = screenPublicGuestCount(guestCount)
  const recorded = emptyIntakeRecord()

  // Split name into first/last for contacts table
  const nameParts = fullName.trim().split(/\s+/)
  const firstName = nameParts[0]
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null

  // Build service interests from event type / source page
  const serviceInterests: string[] = []
  if (sourcePage === 'party-room-rental') serviceInterests.push('room-rental')
  else if (eventType === 'Kids Birthday Party') serviceInterests.push('kids-party')
  else if (eventType === 'Studio Rental') serviceInterests.push('party-room')
  else if (eventType === 'Mobile Services') serviceInterests.push('mobile')
  else if (eventType === 'Permanent Jewelry') serviceInterests.push('permanent-jewelry')
  else if (eventType === 'Retail & Custom Merchandise') serviceInterests.push('retail')
  else serviceInterests.push('general')

  // Save to Supabase (non-fatal if DB unavailable)
  const contactId = await upsertContact({
    name: fullName,
    email,
    phone,
    sourceDetail: `Lead form — ${sourcePage || 'party-packages'}`,
    serviceInterests,
    marketingConsent: !!marketingConsent,
  })
  recorded.contact = !!contactId

  if (contactId) {
    await enrollInSequence({
      contactId,
      contactEmail: email,
      triggerEvent: 'new_inquiry',
      serviceType: serviceInterests[0] || 'general',
    }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
  }

  if (contactId) {
    // Through `logInteraction`: this was a raw insert inside a try/catch that
    // discarded the SQLSTATE, which is how five months of refused rows went
    // unnoticed elsewhere (rule 19).
    const { getSupabase } = await import('@/lib/supabase')
    recorded.interaction = await logInteraction(getSupabase(), {
      contactId,
      type: 'form_submission',
      summary: `Lead inquiry: ${eventType} — ${boundedTheme || 'no theme'}`,
      metadata: {
        page: sourcePage || 'party-packages',
        eventType,
        fullName,
        childAge: childAge || null,
        guestCount: screenedGuests,
        partyTheme: boundedTheme,
        preferredDate: preferredDate || null,
        timeOfDay: timeOfDay || null,
        notes: boundedNotes,
        utm: utm || null,
      },
    })
  }

  // Booking agent: every lead is a Party Plan. The plan is created BEFORE the
  // event so its id rides along on the event — see the safety note in lib/plan.ts,
  // without it the dispatcher's booking sweep drafts this lead a second time.
  const plan = await ensureLeadPlan({
    contactName: fullName,
    contactEmail: email,
    contactPhone: phone || null,
    partyDate: preferredDate || null,
    partyTime: timeOfDay || null,
    guestCount: screenedGuests,
    childAge: Number(childAge) || null,
    notes: [boundedTheme ? `Theme: ${boundedTheme}` : null, boundedNotes].filter(Boolean).join('\n') || null,
    eventType: eventType || null,
    source: 'website_form',
    tags: { source_page: sourcePage || 'party-packages', ...(boundedTheme ? { party_theme: boundedTheme } : {}) },
  })
  recorded.plan = !!plan.bookingId && plan.enriched !== false

  // Booking agent: one inbound event per lead (non-fatal, never blocks).
  const firstEventId = await recordInboundEvent({
    route: 'lead',
    bookingId: plan.bookingId,
    contactId,
    fromAddress: email,
    subject: `Lead: ${eventType} — ${fullName}`,
    body: boundedNotes,
    classification: 'lead',
    parsed: {
      name: fullName,
      email,
      phone,
      eventType,
      date: preferredDate || null,
      time: timeOfDay || null,
      guests: screenedGuests,
      childAge: childAge || null,
      notes: [boundedTheme ? `Theme: ${boundedTheme}` : null, boundedNotes].filter(Boolean).join('\n') || null,
      sourcePage: sourcePage || 'party-packages',
    },
  })
  recorded.event = !!firstEventId

  // Provenance: the plan is created before the event (the sweep depends on
  // that order), so first_touch_event_id can only be stamped now. Fill-once
  // and never fatal — see linkFirstTouchEvent in lib/plan.ts.
  await linkFirstTouchEvent(plan.bookingId, firstEventId)

  // Send emails via Resend
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

    const origin = publicOrigin(req)

    // Build book link for customer confirmation
    const bookParams = new URLSearchParams({ type: 'room-rental' })
    if (preferredDate) bookParams.set('date', preferredDate)
    const bookLink = `${origin}/book?${bookParams.toString()}`

    // Format date for display
    let dateDisplay: string | undefined
    if (preferredDate) {
      try {
        const d = new Date(preferredDate + 'T12:00:00')
        dateDisplay = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      } catch { dateDisplay = preferredDate }
    }

    const emails: Parameters<typeof resend.emails.send>[0][] = [
      // Admin notification
      {
        from,
        to: ownerEmail(),
        subject: `New lead: ${eventType} — ${fullName}`,
        html: leadNotifyHtml({
          fullName,
          email,
          phone,
          eventType,
          childAge,
          guestCount,
          partyTheme,
          preferredDate,
          timeOfDay,
          notes,
        }),
      },
    ]

    // Customer auto-response for all lead types
    const isRoomRental = sourcePage === 'party-room-rental'
    const subject = isRoomRental
      ? 'Your Room Rental Inquiry — Host Hampton'
      : `Your ${eventType || 'Party'} Inquiry — Host Hampton`

    const confirmBookLink = isRoomRental
      ? bookLink
      : `${origin}/party-packages`

    emails.push({
      from,
      to: email,
      subject,
      html: leadConfirmHtml({
        customerName: fullName,
        eventType,
        preferredDate: dateDisplay,
        guestCount,
        bookLink: confirmBookLink,
      }),
    })

    const results = await Promise.allSettled(emails.map(e => resend.emails.send(e)))
    // `emails[0]` is the owner notification — the one that makes a lead
    // recoverable by hand if every table write failed.
    recorded.ownerNotified = settledOk(results[0])
    if (!recorded.ownerNotified) {
      console.error('lead: owner notification did NOT send —', JSON.stringify(results[0]).slice(0, 300))
    }
    await notifyOwnerSms(leadSmsLine({
      kind: `lead (${eventType})`, name: fullName, phone, email,
      date: preferredDate, guests: screenedGuests ?? undefined, extra: boundedTheme,
    }))
  } else {
    console.warn('RESEND_API_KEY not set — skipping lead notification email')
  }

  const missing = missingFrom(recorded)
  if (!landedSomewhere(recorded)) {
    console.error(`lead: NOTHING recorded for a lead from ${email} — missing ${missing.join(', ')}`)
    return NextResponse.json(
      { error: 'We could not save your enquiry just now. Please try again, or call us on (631) 998-9325.' },
      { status: 503 },
    )
  }
  if (missing.length) {
    console.warn(`lead: lead from ${email} recorded with gaps — missing ${missing.join(', ')}`)
  }

  return NextResponse.json({ success: true, recorded })
}
