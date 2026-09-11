import { ownerEmail, notifyOwnerSms } from '@/lib/ownerNotify'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { getPortalBookingRef } from '@/lib/portalAuth'

/**
 * Customer-to-admin message about a specific booking. Auth via portal cookie.
 * Logs the message into booking_modifications for audit, then emails admin.
 */
export async function POST(req: NextRequest) {
  const portalSecret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
  const cookieHeader = req.headers.get('cookie')
  const bookingRef = getPortalBookingRef(cookieHeader, portalSecret)
  if (!bookingRef) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const message = (body.message as string | undefined)?.trim()
  if (!message || message.length < 3) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  }
  if (message.length > 5000) {
    return NextResponse.json({ error: 'Message is too long' }, { status: 400 })
  }

  const supabase = getSupabase()
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, booking_ref, contact_name, contact_email, contact_phone, party_date, party_time, package_type')
    .eq('booking_ref', bookingRef)
    .single()

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  // Audit-log it on the booking
  await supabase.from('booking_modifications').insert({
    booking_id: booking.id,
    modified_by: 'customer',
    change_summary: `Customer message: ${message.slice(0, 200)}${message.length > 200 ? '…' : ''}`,
    new_data: { type: 'customer_message', body: message },
  })

  // Email admin
  if (process.env.RESEND_API_KEY) {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'www.hosthampton.com'
    const isLocal = host.startsWith('localhost')
    const proto = req.headers.get('x-forwarded-proto') || (isLocal ? 'http' : 'https')
    const adminUrl = `${proto}://${host}/admin?tab=parties&ref=${bookingRef}`

    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

    // Escape the message body so HTML special chars render correctly
    const escaped = message
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')

    const html = `<!DOCTYPE html>
<html><body style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#F6F1EB;padding:20px;">
  <div style="background:white;border-radius:12px;padding:32px;">
    <h1 style="color:#1a2744;margin:0 0 16px;font-size:22px;">Message from ${booking.contact_name || 'a customer'}</h1>
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px;">
      <tr><td style="padding:4px 0;color:#555;width:110px;">Booking</td><td style="padding:4px 0;color:#1a2744;font-weight:bold;">${booking.booking_ref}</td></tr>
      <tr><td style="padding:4px 0;color:#555;">Customer</td><td style="padding:4px 0;color:#1a2744;">${booking.contact_name || '—'}</td></tr>
      <tr><td style="padding:4px 0;color:#555;">Email</td><td style="padding:4px 0;color:#1a2744;"><a href="mailto:${booking.contact_email}" style="color:#1a2744;">${booking.contact_email}</a></td></tr>
      <tr><td style="padding:4px 0;color:#555;">Phone</td><td style="padding:4px 0;color:#1a2744;">${booking.contact_phone || '—'}</td></tr>
      <tr><td style="padding:4px 0;color:#555;">Party</td><td style="padding:4px 0;color:#1a2744;">${booking.party_date || 'TBD'}${booking.party_time ? ` at ${booking.party_time}` : ''} · ${booking.package_type || 'Party'}</td></tr>
    </table>
    <div style="background:#F6F1EB;border-left:4px solid #1a2744;border-radius:8px;padding:16px 20px;margin:0 0 24px;">
      <p style="color:#1a2744;font-size:15px;line-height:1.7;margin:0;">${escaped}</p>
    </div>
    <div style="text-align:center;margin:0 0 8px;">
      <a href="${adminUrl}" style="display:inline-block;background:#1a2744;color:#F6F1EB;padding:12px 32px;font-size:14px;text-decoration:none;border-radius:6px;">Open Booking in Admin</a>
    </div>
    <p style="color:#888;font-size:12px;line-height:1.6;margin:16px 0 0;text-align:center;">Reply directly to this email to reach the customer.</p>
  </div>
</body></html>`

    await resend.emails.send({
      from,
      to: ownerEmail(),
      replyTo: booking.contact_email || undefined,
      subject: `Customer message: ${booking.contact_name || booking.booking_ref} — ${booking.booking_ref}`,
      html,
    }).catch(err => console.error('send-message email error (non-fatal):', err))
  }
  await notifyOwnerSms(`Portal message from ${booking.contact_name || 'customer'} (${booking.booking_ref}): ${message.slice(0, 200)}`)

  return NextResponse.json({ ok: true })
}
