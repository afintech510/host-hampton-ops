import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { savedQuoteHtml } from '@/lib/emailTemplates'
import { upsertContact } from '@/lib/contacts'

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
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'www.hosthampton.com'
  const protocol = host.includes('localhost') ? 'http' : 'https'
  const encoded = Buffer.from(JSON.stringify(quoteData)).toString('base64url')
  const quotePath = '/kids-party-menu'
  const quoteLink = `${protocol}://${host}${quotePath}?q=${encoded}`

  // Build the book link (with date/time for auto-selection + encoded quote data including summary)
  const bookEncoded = Buffer.from(JSON.stringify({ ...quoteData, summary })).toString('base64url')
  const bookParams = new URLSearchParams({ type: 'kids-party', from: 'quote', q: bookEncoded })
  if (partyDate) bookParams.set('date', partyDate)
  if (partyTime) bookParams.set('time', partyTime)
  const bookLink = `${protocol}://${host}/book?${bookParams.toString()}`

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
        to: 'hosthampton295@gmail.com',
        subject: `Saved quote: ${name}${slotDisplay ? ` — ${slotDisplay}` : ''}`,
        html: `<p><strong>${name}</strong> (${email}, ${phone || 'no phone'}) saved a party quote.</p>${adminDateLine}<pre>${summary || 'No summary'}</pre><p><a href="${quoteLink}">View their quote</a></p>`,
      }),
    ])
  }

  return NextResponse.json({ success: true, quoteLink })
}
