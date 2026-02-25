import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { savedQuoteHtml } from '@/lib/emailTemplates'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, email, phone, quoteData, summary } = body

  if (!name || !email || !quoteData) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Build the quote link with encoded data
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'staging.hosthampton.com'
  const protocol = host.includes('localhost') ? 'http' : 'https'
  const encoded = Buffer.from(JSON.stringify(quoteData)).toString('base64url')
  const quoteLink = `${protocol}://${host}/party-quote?q=${encoded}`

  // Save interaction to DB (non-fatal)
  try {
    const { getSupabase } = await import('@/lib/supabase')
    const supabase = getSupabase()

    // Upsert contact
    const nameParts = name.trim().split(/\s+/)
    await supabase.from('contacts').upsert(
      {
        email,
        first_name: nameParts[0],
        last_name: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
        phone: phone || null,
        status: 'lead',
        source: 'direct',
        source_detail: 'Quote Builder — Save for Later',
        service_interests: ['kids-party'],
      },
      { onConflict: 'email' },
    )

    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('email', email)
      .single()

    if (contact?.id) {
      await supabase.from('contact_interactions').insert({
        contact_id: contact.id,
        type: 'form_submission',
        summary: `Saved party quote: ${summary || 'no summary'}`,
        metadata: { page: 'party-quote', action: 'save_for_later', quoteData },
      })
    }
  } catch (err) {
    console.error('DB save error (non-fatal):', err)
  }

  // Send email with saved quote link
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

    await Promise.allSettled([
      resend.emails.send({
        from,
        to: email,
        subject: 'Your Saved Party Quote — Host Hampton',
        html: savedQuoteHtml({ customerName: name, quoteLink, summary: summary || '' }),
      }),
      // Also notify owner
      resend.emails.send({
        from,
        to: 'hosthampton295@gmail.com',
        subject: `Saved quote: ${name}`,
        html: `<p><strong>${name}</strong> (${email}, ${phone || 'no phone'}) saved a party quote.</p><pre>${summary || 'No summary'}</pre><p><a href="${quoteLink}">View their quote</a></p>`,
      }),
    ])
  }

  return NextResponse.json({ success: true, quoteLink })
}
