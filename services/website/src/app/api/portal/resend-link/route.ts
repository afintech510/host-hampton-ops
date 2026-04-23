import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { generatePortalToken, buildPortalUrl } from '@/lib/portalAuth'
import { partyPortalMagicLinkHtml } from '@/lib/emailTemplates'

export async function POST(req: NextRequest) {
  const { email } = await req.json()

  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 })
  }

  const supabase = getSupabase()
  const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'

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
