import { ownerEmail, notifyOwnerSms } from '@/lib/ownerNotify'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { getPortalBookingRef, portalSigningSecret } from '@/lib/portalAuth'
import { publicOrigin } from '@/lib/publicOrigin'
import { escapeHtml } from '@/lib/escapeHtml'
import { mailToHref, mailHref } from '@/lib/emailSafety'

/**
 * Customer-to-admin message about a specific booking. Auth via portal cookie.
 * Logs the message into booking_modifications for audit, then emails admin.
 */
export async function POST(req: NextRequest) {
  const portalSecret = portalSigningSecret()
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
  const { data: booking, error: readErr } = await supabase
    .from('bookings')
    .select('id, booking_ref, contact_name, contact_email, contact_phone, party_date, party_time, package_type')
    .eq('booking_ref', bookingRef)
    .maybeSingle()

  // Rule 12, flagged by link 13 and left here deliberately: `.single()` with the
  // error discarded reported a Supabase blip as "Booking not found" — to a
  // customer holding a valid session for a booking that is sitting right there.
  if (readErr) {
    console.error('portal send-message: booking read failed for', bookingRef, '—', readErr.message)
    return NextResponse.json({ error: 'We could not send that just now — try again.' }, { status: 503 })
  }
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  // Audit-log it on the booking. Rule 19, the other one link 13 left: this
  // insert's error was discarded, so the record of what a customer asked for
  // could silently never have been written.
  const { error: auditErr } = await supabase.from('booking_modifications').insert({
    booking_id: booking.id,
    modified_by: 'customer',
    change_summary: `Customer message: ${message.slice(0, 200)}${message.length > 200 ? '…' : ''}`,
    new_data: { type: 'customer_message', body: message },
  })
  if (auditErr) {
    console.error('portal send-message: audit log write FAILED for', bookingRef, '—', auditErr.message)
  }

  // Email admin
  let emailed = false
  if (process.env.RESEND_API_KEY) {
    const origin = publicOrigin(req)
    const adminUrl = `${origin}/admin?tab=parties&ref=${bookingRef}`

    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

    // A customer typed this in the portal and it renders in ADAM's inbox, so it
    // crosses a trust boundary. It used to be escaped by a THIRD private copy
    // of the escaper — `&`, `<`, `>` and nothing else, so a `"` survived intact.
    // Nothing here puts it in an attribute today, which is why that never bit;
    // rule 11 says an incomplete second copy of a screen is the bug regardless.
    const escaped = escapeHtml(message).replace(/\n/g, '<br>')

    const html = `<!DOCTYPE html>
<html><body style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#F6F1EB;padding:20px;">
  <div style="background:white;border-radius:12px;padding:32px;">
    <h1 style="color:#1a2744;margin:0 0 16px;font-size:22px;">Message from ${escapeHtml(booking.contact_name || 'a customer')}</h1>
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px;">
      <tr><td style="padding:4px 0;color:#555;width:110px;">Booking</td><td style="padding:4px 0;color:#1a2744;font-weight:bold;">${escapeHtml(booking.booking_ref)}</td></tr>
      <tr><td style="padding:4px 0;color:#555;">Customer</td><td style="padding:4px 0;color:#1a2744;">${escapeHtml(booking.contact_name || '—')}</td></tr>
      <tr><td style="padding:4px 0;color:#555;">Email</td><td style="padding:4px 0;color:#1a2744;"><a href="${mailToHref(booking.contact_email)}" style="color:#1a2744;">${escapeHtml(booking.contact_email)}</a></td></tr>
      <tr><td style="padding:4px 0;color:#555;">Phone</td><td style="padding:4px 0;color:#1a2744;">${escapeHtml(booking.contact_phone || '—')}</td></tr>
      <tr><td style="padding:4px 0;color:#555;">Party</td><td style="padding:4px 0;color:#1a2744;">${escapeHtml(booking.party_date || 'TBD')}${booking.party_time ? ` at ${escapeHtml(booking.party_time)}` : ''} · ${escapeHtml(booking.package_type || 'Party')}</td></tr>
    </table>
    <div style="background:#F6F1EB;border-left:4px solid #1a2744;border-radius:8px;padding:16px 20px;margin:0 0 24px;">
      <p style="color:#1a2744;font-size:15px;line-height:1.7;margin:0;">${escaped}</p>
    </div>
    <div style="text-align:center;margin:0 0 8px;">
      <a href="${mailHref(adminUrl)}" style="display:inline-block;background:#1a2744;color:#F6F1EB;padding:12px 32px;font-size:14px;text-decoration:none;border-radius:6px;">Open Booking in Admin</a>
    </div>
    <p style="color:#888;font-size:12px;line-height:1.6;margin:16px 0 0;text-align:center;">Reply directly to this email to reach the customer.</p>
  </div>
</body></html>`

    const res = await resend.emails
      .send({
        from,
        to: ownerEmail(),
        replyTo: booking.contact_email || undefined,
        subject: `Customer message: ${booking.contact_name || booking.booking_ref} — ${booking.booking_ref}`,
        html,
      })
      .catch(err => ({ error: err }))
    if ((res as { error?: unknown }).error) {
      console.error('portal send-message: email to the owner FAILED for', bookingRef,
        (res as { error?: unknown }).error)
    } else {
      emailed = true
    }
  } else {
    console.error('portal send-message: RESEND_API_KEY unset — owner email NOT sent for', bookingRef)
  }
  const texted = await notifyOwnerSms(
    `Portal message from ${booking.contact_name || 'customer'} (${booking.booking_ref}): ${message.slice(0, 200)}`
  )

  // Rule 10's expensive half. The portal says "Message sent!" on `ok:true`, and
  // this used to be unconditional — over an unset API key, a Resend rejection,
  // or an SMS the provider refused. A customer who believes Adam has their
  // question and then hears nothing is the whole failure.
  //
  // The message IS recorded on the booking either way, so a delivered:false is
  // not a lost message — but it must not be reported as a delivered one.
  if (!emailed && !texted) {
    console.error('portal send-message: NOTHING was delivered for', bookingRef)
    return NextResponse.json({
      error: 'We saved your message but could not get it through just now — please call or text us.',
      recorded: !auditErr,
    }, { status: 502 })
  }

  return NextResponse.json({ ok: true, emailed, texted, recorded: !auditErr })
}
