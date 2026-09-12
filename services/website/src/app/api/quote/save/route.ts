import { ownerEmail, notifyOwnerSms, leadSmsLine } from '@/lib/ownerNotify'
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { savedQuoteHtml } from '@/lib/emailTemplates'
import { upsertContact } from '@/lib/contacts'
import { enrollInSequence } from '@/lib/sequences'
import { recordInboundEvent } from '@/lib/agent/events'
import { ensureLeadPlan, linkFirstTouchEvent } from '@/lib/plan'
import { publicOrigin } from '@/lib/publicOrigin'
import { escapeHtml } from '@/lib/escapeHtml'
import { mailHref } from '@/lib/emailSafety'

export const dynamic = 'force-dynamic'

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T12:00:00')
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}

function formatTime(timeStr: string): string {
  try {
    const [h, m] = timeStr.split(':').map(Number)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
  } catch {
    return timeStr
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, email, phone, quoteData, summary, partyDate, partyTime, sourcePage } = body

  if (!name || !email || !quoteData) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Build the quote link with encoded data
  const origin = publicOrigin(req)
  const encoded = Buffer.from(JSON.stringify(quoteData)).toString('base64url')
  const quotePath = '/kids-party-menu'
  const quoteLink = `${origin}${quotePath}?q=${encoded}`

  // Build the book link (with date/time for auto-selection + encoded quote data including summary)
  const bookEncoded = Buffer.from(JSON.stringify({ ...quoteData, summary })).toString('base64url')
  const bookParams = new URLSearchParams({ type: 'kids-party', from: 'quote', q: bookEncoded })
  if (partyDate) bookParams.set('date', partyDate)
  if (partyTime) bookParams.set('time', partyTime)
  const bookLink = `${origin}/book?${bookParams.toString()}`

  // Format date/time for display
  const dateDisplay = partyDate ? formatDate(partyDate) : undefined
  const timeDisplay = partyTime ? formatTime(partyTime) : undefined
  const slotDisplay = dateDisplay && timeDisplay ? `${dateDisplay} at ${timeDisplay}` : undefined

  // Save interaction to DB (non-fatal)
  const contactId = await upsertContact({
    name,
    email,
    phone,
    sourceDetail: 'Quote Builder — Save for Later',
    serviceInterests: ['kids-party'],
  })

  if (contactId) {
    await enrollInSequence({
      contactId,
      contactEmail: email,
      triggerEvent: 'new_inquiry',
      serviceType: 'kids_party',
    }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
  }

  if (contactId) {
    try {
      const { getSupabase } = await import('@/lib/supabase')
      const supabase = getSupabase()
      await supabase.from('contact_interactions').insert({
        contact_id: contactId,
        type: 'form_submission',
        summary: `Saved party quote: ${summary || 'no summary'}${slotDisplay ? ` — ${slotDisplay}` : ''}`,
        metadata: { page: 'kids-party-menu', action: 'save_for_later', quoteData, partyDate, partyTime },
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
    partyDate: partyDate || null,
    partyTime: partyTime || null,
    guestCount: Number(quoteData?.guestCount) || null,
    notes: summary || null,
    eventType: 'kids birthday party',
    source: 'website_form',
    // A saved quote is the one intake form that carries real selections, so it
    // writes booking_line_items instead of only the base64 URL it used to.
    lineItems: Array.isArray(quoteData?.lineItems) ? quoteData.lineItems : [],
    snapshotExtra: quoteData,
    tags: { source_page: sourcePage || 'kids-party-menu' },
  })

  // Booking agent: a saved quote is a warm lead (non-fatal, never blocks).
  const firstEventId = await recordInboundEvent({
    route: 'quote-save',
    bookingId: plan.bookingId,
    contactId,
    fromAddress: email,
    subject: `Saved party quote — ${name}`,
    body: summary || null,
    classification: 'lead',
    parsed: {
      name,
      email,
      phone: phone || null,
      eventType: 'kids birthday party',
      date: partyDate || null,
      time: partyTime || null,
      notes: summary || null,
      sourcePage: sourcePage || 'kids-party-menu',
    },
  })

  // Provenance: the plan is created before the event (the sweep depends on
  // that order), so first_touch_event_id can only be stamped now. Fill-once
  // and never fatal — see linkFirstTouchEvent in lib/plan.ts.
  await linkFirstTouchEvent(plan.bookingId, firstEventId)

  // Send email with saved quote link
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

    const adminDateLine = slotDisplay ? `<p><strong>Selected slot:</strong> ${slotDisplay}</p>` : ''

    await Promise.allSettled([
      resend.emails.send({
        from,
        to: email,
        subject: 'Your Saved Party Quote — Host Hampton',
        html: savedQuoteHtml({
          customerName: name,
          quoteLink,
          summary: summary || '',
          partyDate: dateDisplay,
          partyTime: timeDisplay,
          bookLink,
        }),
      }),
      // Also notify owner
      resend.emails.send({
        from,
        to: ownerEmail(),
        subject: `Saved quote: ${name}${slotDisplay ? ` — ${slotDisplay}` : ''}`,
        html: `<p><strong>${escapeHtml(name)}</strong> (${escapeHtml(email)}, ${escapeHtml(phone || 'no phone')}) saved a party quote.</p>${adminDateLine}<pre>${escapeHtml(summary || 'No summary')}</pre><p><a href="${mailHref(quoteLink)}">View their quote</a></p>`,
      }),
    ])
    await notifyOwnerSms(leadSmsLine({ kind: 'saved party quote', name, phone, email, date: slotDisplay, extra: summary ? String(summary).slice(0, 120) : null }))
  }

  return NextResponse.json({ success: true, quoteLink })
}
