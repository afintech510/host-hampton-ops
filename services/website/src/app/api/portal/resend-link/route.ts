import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { generatePortalToken, buildPortalUrl } from '@/lib/portalAuth'
import { partyPortalMagicLinkHtml } from '@/lib/emailTemplates'
import { sendSMSVia, normalizePhone } from '@/lib/sms'

/**
 * Throttle by identifier so this public endpoint can't be used to text-bomb a
 * number or mail-bomb an address. In-memory is adequate: the website runs as a
 * single container, and the worst case of a restart is a reset counter.
 */
const RESEND_WINDOW_MS = 15 * 60 * 1000
const RESEND_MAX_PER_WINDOW = 3
const resendHits = new Map<string, number[]>()

function isThrottled(identifier: string): boolean {
  const now = Date.now()
  const recent = (resendHits.get(identifier) || []).filter(t => now - t < RESEND_WINDOW_MS)
  if (recent.length >= RESEND_MAX_PER_WINDOW) {
    resendHits.set(identifier, recent)
    return true
  }
  recent.push(now)
  resendHits.set(identifier, recent)
  return false
}

/** Last 10 digits, so "(631) 555-1234" and "+16315551234" compare equal. */
function phoneKey(raw: string): string {
  return raw.replace(/\D/g, '').slice(-10)
}

export async function POST(req: NextRequest) {
  const { email, phone } = await req.json()

  if (!email && !phone) {
    return NextResponse.json({ error: 'Email or phone required' }, { status: 400 })
  }

  const supabase = getSupabase()
  const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'

  // Phone path: contact_phone is stored as the customer typed it, so exact
  // matching is unreliable. Compare on trailing digits instead.
  if (phone && !email) {
    const key = phoneKey(String(phone))
    if (key.length !== 10) {
      // Shape error, not an enumeration signal — safe to say so.
      return NextResponse.json({ error: 'Enter a 10-digit US phone number' }, { status: 400 })
    }
    if (isThrottled(`sms:${key}`)) {
      return NextResponse.json({ ok: true, throttled: true })
    }

    const { data: candidates } = await supabase
      .from('bookings')
      .select('id, booking_ref, contact_name, contact_phone')
      .not('contact_phone', 'is', null)
      .not('status', 'eq', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(2000)

    const match = (candidates || []).find(b => phoneKey(b.contact_phone || '') === key)

    // Always report success — never reveal whether a number is on file.
    if (!match) return NextResponse.json({ ok: true })

    const { token: rawToken, hash, expiresAt } = generatePortalToken(match.booking_ref, secret)
    await supabase.from('portal_tokens').insert({
      booking_id: match.id,
      token_hash: hash,
      expires_at: expiresAt.toISOString(),
    })

    const portalUrl = buildPortalUrl(match.booking_ref, rawToken)
    const firstName = (match.contact_name || '').trim().split(/\s+/)[0] || 'there'
    // Transactional — Quo, per the SMS routing policy in lib/sms.ts.
    await sendSMSVia(
      'quo',
      normalizePhone(match.contact_phone!),
      `Hi ${firstName}! Here's your Host Hampton party planner link: ${portalUrl} Reply STOP to opt out`
    )

    return NextResponse.json({ ok: true })
  }

  if (isThrottled(`email:${String(email).toLowerCase().trim()}`)) {
    return NextResponse.json({ ok: true, throttled: true })
  }

  // Find booking by email
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, booking_ref, contact_name, contact_email')
    .eq('contact_email', email.toLowerCase().trim())
    .not('status', 'eq', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  // Always return success to prevent email enumeration
  if (!booking) {
    // Check for saved quotes in contact_interactions
    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .single()

    if (contact) {
      const { data: interaction } = await supabase
        .from('contact_interactions')
        .select('metadata')
        .eq('contact_id', contact.id)
        .eq('type', 'form_submission')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (interaction?.metadata?.action === 'save_for_later' && interaction.metadata.quoteData) {
        const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'www.hosthampton.com'
        const protocol = host.includes('localhost') ? 'http' : 'https'
        const encoded = Buffer.from(JSON.stringify(interaction.metadata.quoteData)).toString('base64url')
        const quoteLink = `${protocol}://${host}/kids-party-menu?q=${encoded}`

        if (process.env.RESEND_API_KEY) {
          const { Resend } = await import('resend')
          const resend = new Resend(process.env.RESEND_API_KEY)
          const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
          const { savedQuoteHtml } = await import('@/lib/emailTemplates')

          await resend.emails.send({
            from,
            to: email.toLowerCase().trim(),
            subject: 'Your Saved Party Quote — Host Hampton',
            html: savedQuoteHtml({
              customerName: interaction.metadata.quoteData.contactName || 'there',
              quoteLink,
              summary: interaction.metadata.quoteData.summary || '',
            }),
          })
        }
      }
    }

    return NextResponse.json({ ok: true })
  }

  const { token: rawToken, hash, expiresAt } = generatePortalToken(booking.booking_ref, secret)

  await supabase.from('portal_tokens').insert({
    booking_id: booking.id,
    token_hash: hash,
    expires_at: expiresAt.toISOString(),
  })

  const portalUrl = buildPortalUrl(booking.booking_ref, rawToken)

  if (process.env.RESEND_API_KEY) {
    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

    await resend.emails.send({
      from,
      to: booking.contact_email,
      subject: `Your Booking Portal Link — ${booking.booking_ref}`,
      html: partyPortalMagicLinkHtml({
        customerName: booking.contact_name,
        bookingRef: booking.booking_ref,
        portalUrl,
      }),
    })
  }

  return NextResponse.json({ ok: true })
}
