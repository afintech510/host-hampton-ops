import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { leadNotifyHtml, leadConfirmHtml } from '@/lib/emailTemplates'
import { upsertContact } from '@/lib/contacts'
import { enrollInSequence } from '@/lib/sequences'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
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

  if (contactId) {
    await enrollInSequence({
      contactId,
      contactEmail: email,
      triggerEvent: 'new_inquiry',
      serviceType: serviceInterests[0] || 'general',
    }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
  }

  if (contactId) {
    try {
      const { getSupabase } = await import('@/lib/supabase')
      const supabase = getSupabase()
      await supabase.from('contact_interactions').insert({
        contact_id: contactId,
        type: 'form_submission',
        summary: `Lead inquiry: ${eventType} — ${partyTheme || 'no theme'}`,
        metadata: {
          page: sourcePage || 'party-packages',
          eventType,
          fullName,
          childAge: childAge || null,
          guestCount: guestCount || null,
          partyTheme: partyTheme || null,
          preferredDate: preferredDate || null,
          timeOfDay: timeOfDay || null,
          notes: notes || null,
          utm: utm || null,
        },
      })
    } catch (dbErr) {
      console.error('Interaction insert error (non-fatal):', dbErr)
    }
  }

  // Send emails via Resend
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'www.hosthampton.com'
    const protocol = host.includes('localhost') ? 'http' : 'https'

    // Build book link for customer confirmation
    const bookParams = new URLSearchParams({ type: 'room-rental' })
    if (preferredDate) bookParams.set('date', preferredDate)
    const bookLink = `${protocol}://${host}/book?${bookParams.toString()}`

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
        to: 'hosthampton295@gmail.com',
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
      : `${protocol}://${host}/party-packages`

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

    await Promise.allSettled(emails.map(e => resend.emails.send(e)))
  } else {
    console.warn('RESEND_API_KEY not set — skipping lead notification email')
  }

  return NextResponse.json({ success: true })
}
