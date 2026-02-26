import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { leadNotifyHtml, leadConfirmHtml } from '@/lib/emailTemplates'

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
  try {
    const { getSupabase } = await import('@/lib/supabase')
    const supabase = getSupabase()

    // Upsert contact
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
          source_detail: `Lead form — ${sourcePage || 'party-packages'}`,
          service_interests: serviceInterests,
        },
        { onConflict: 'email' }
      )

    if (contactErr) {
      console.error('Contact upsert error:', contactErr)
    }

    // Fetch contact id for interaction record
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
          },
        })

      if (interactionErr) {
        console.error('Interaction insert error:', interactionErr)
      }
    }
  } catch (dbErr) {
    console.error('Database save error (non-fatal):', dbErr)
  }

  // Send emails via Resend
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'staging.hosthampton.com'
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
        to: 'alark51@gmail.com',
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

    // Customer confirmation (for room-rental and other leads with email)
    if (sourcePage === 'party-room-rental') {
      emails.push({
        from,
        to: email,
        subject: 'Your Room Rental Inquiry — Host Hampton',
        html: leadConfirmHtml({
          customerName: fullName,
          eventType,
          preferredDate: dateDisplay,
          guestCount,
          bookLink,
        }),
      })
    }

    await Promise.allSettled(emails.map(e => resend.emails.send(e)))
  } else {
    console.warn('RESEND_API_KEY not set — skipping lead notification email')
  }

  return NextResponse.json({ success: true })
}
