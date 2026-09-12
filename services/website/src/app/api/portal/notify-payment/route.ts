import { ownerEmail, notifyOwnerSms } from '@/lib/ownerNotify'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { getPortalBookingRef } from '@/lib/portalAuth'
import { formatMoney } from '@/lib/partyPricing'
import { publicOrigin } from '@/lib/publicOrigin'
import { escapeHtml } from '@/lib/escapeHtml'
import { mailHref } from '@/lib/emailSafety'

export async function POST(req: NextRequest) {
  const portalSecret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
  const cookieHeader = req.headers.get('cookie')
  const bookingRef = getPortalBookingRef(cookieHeader, portalSecret)
  if (!bookingRef) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json()
  const amountCents = body.amount_cents as number
  const method = body.method as 'venmo' | 'zelle' | 'cash' | 'check'

  if (!amountCents || amountCents <= 0) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
  if (!['venmo', 'zelle', 'cash', 'check'].includes(method)) return NextResponse.json({ error: 'Invalid method' }, { status: 400 })

  const supabase = getSupabase()
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, booking_ref, contact_name, contact_email, contact_phone, balance_due_cents, party_date, party_time')
    .eq('booking_ref', bookingRef)
    .single()

  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  // Log the notification as a booking_modification (admin reconciles later)
  await supabase.from('booking_modifications').insert({
    booking_id: booking.id,
    modified_by: 'customer',
    change_summary: `Customer pledged ${formatMoney(amountCents)} via ${method} — awaiting admin reconciliation`,
    new_data: { type: 'payment_pledge', amount_cents: amountCents, method },
  })

  // Email admin to reconcile
  if (process.env.RESEND_API_KEY) {
    const origin = publicOrigin(req)
    const adminUrl = `${origin}/admin?tab=parties&ref=${bookingRef}`

    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

    const methodLabel = method.charAt(0).toUpperCase() + method.slice(1)
    const html = `<!DOCTYPE html>
<html><body style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#F6F1EB;padding:20px;">
  <div style="background:white;border-radius:12px;padding:32px;">
    <h1 style="color:#1a2744;margin:0 0 16px;font-size:22px;">${escapeHtml(methodLabel)} Payment Pledged</h1>
    <p style="color:#555;line-height:1.7;">
      <strong>${escapeHtml(booking.contact_name)}</strong> says they will send <strong>${formatMoney(amountCents)}</strong>
      via <strong>${escapeHtml(methodLabel)}</strong> for booking <strong>${escapeHtml(booking.booking_ref)}</strong>.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
      <tr><td style="padding:6px 0;color:#555;width:120px;">Customer</td><td style="padding:6px 0;color:#1a2744;font-weight:bold;">${escapeHtml(booking.contact_name)}</td></tr>
      <tr><td style="padding:6px 0;color:#555;">Email</td><td style="padding:6px 0;color:#1a2744;">${escapeHtml(booking.contact_email)}</td></tr>
      <tr><td style="padding:6px 0;color:#555;">Phone</td><td style="padding:6px 0;color:#1a2744;">${escapeHtml(booking.contact_phone || '—')}</td></tr>
      <tr><td style="padding:6px 0;color:#555;">Amount</td><td style="padding:6px 0;color:#1a2744;font-weight:bold;">${formatMoney(amountCents)}</td></tr>
      <tr><td style="padding:6px 0;color:#555;">Method</td><td style="padding:6px 0;color:#1a2744;">${escapeHtml(methodLabel)}</td></tr>
      <tr><td style="padding:6px 0;color:#555;">Party Date</td><td style="padding:6px 0;color:#1a2744;">${escapeHtml(booking.party_date || 'TBD')}${escapeHtml(booking.party_time ? ' at ' + booking.party_time : '')}</td></tr>
    </table>
    <p style="color:#555;font-size:13px;line-height:1.7;">
      Once you receive the payment, log in to the admin to record it. This will update the customer's balance and send them a receipt.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${mailHref(adminUrl)}" style="display:inline-block;background:#1a2744;color:#F6F1EB;padding:12px 32px;font-size:14px;text-decoration:none;border-radius:6px;">Open in Admin</a>
    </div>
  </div>
</body></html>`

    await resend.emails.send({
      from,
      to: ownerEmail(),
      subject: `${methodLabel} payment pledged: ${formatMoney(amountCents)} — ${booking.booking_ref}`,
      html,
    }).catch(err => console.error('Notify-payment email error:', err))
  }
  await notifyOwnerSms(`${method} payment pledged: ${formatMoney(amountCents)} from ${booking.contact_name} (${booking.booking_ref}). Record it in admin once received.`)

  return NextResponse.json({ ok: true })
}
