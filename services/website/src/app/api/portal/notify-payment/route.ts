import { ownerEmail, notifyOwnerSms } from '@/lib/ownerNotify'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { getPortalBookingRef, portalSigningSecret } from '@/lib/portalAuth'
import { formatMoney } from '@/lib/partyPricing'
import { publicOrigin } from '@/lib/publicOrigin'
import { escapeHtml } from '@/lib/escapeHtml'
import { mailHref } from '@/lib/emailSafety'
import { guardRate, ownerNotifyRule } from '@/lib/rateLimit'
import { screenPledgeCents, MAX_PLEDGE_CENTS, isPayableStatus } from '@/lib/portalWrite'

export async function POST(req: NextRequest) {
  // Email + billed SMS to Adam on every call, on a cookie alone. Four real
  // requests in the ten-day nginx window; see `ownerNotifyRule` for the sizing.
  const limited = guardRate(req, ownerNotifyRule('portal/notify-payment'))
  if (limited) return limited

  const portalSecret = portalSigningSecret()
  const cookieHeader = req.headers.get('cookie')
  const bookingRef = getPortalBookingRef(cookieHeader, portalSecret)
  if (!bookingRef) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const method = body.method as 'venmo' | 'zelle' | 'cash' | 'check'

  // `body.amount_cents as number` was the whole check, plus `> 0`. That figure
  // goes through `formatMoney()` into an email to Adam and into
  // `booking_modifications.new_data` as the record he reconciles a real bank
  // transfer against: `0.5` printed as `$0.01` and `1e308` printed as a
  // sentence. A pledge is a whole number of cents (lib/portalWrite.ts).
  const amountCents = screenPledgeCents(body.amount_cents)
  if (amountCents === null) {
    return NextResponse.json(
      { error: `Enter an amount between $0.01 and ${(MAX_PLEDGE_CENTS / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}.` },
      { status: 400 },
    )
  }
  if (!['venmo', 'zelle', 'cash', 'check'].includes(method)) return NextResponse.json({ error: 'Invalid method' }, { status: 400 })

  const supabase = getSupabase()
  const { data: booking, error: readErr } = await supabase
    .from('bookings')
    .select('id, booking_ref, status, contact_name, contact_email, contact_phone, balance_due_cents, party_date, party_time')
    .eq('booking_ref', bookingRef)
    .maybeSingle()

  // Rule 12 — and on this route the "not found" branch is worse than usual,
  // because the customer has just told us they are sending money.
  if (readErr) {
    console.error('portal notify-payment: booking read failed for', bookingRef, '—', readErr.message)
    return NextResponse.json({ error: 'We could not record that just now — try again.' }, { status: 503 })
  }
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  // Same rule as `/api/portal/pay`: a cancelled party does not take money, and
  // four real cancelled bookings still carry a positive balance. Telling a
  // customer "we'll expect your Venmo" for a party that is not happening is the
  // worst version of this route's failure.
  if (!isPayableStatus(booking.status)) {
    console.warn(`portal notify-payment: refused a pledge on a ${String(booking.status)} booking — ${bookingRef}`)
    return NextResponse.json(
      { error: 'This booking is no longer taking payments. Please give us a call before sending anything.' },
      { status: 409 },
    )
  }

  // Log the notification as a booking_modification (admin reconciles later).
  // Rule 19: this insert IS the record of a customer's payment pledge. If it
  // fails and nobody reads the error, the money arrives and nothing says why.
  const { error: auditErr } = await supabase.from('booking_modifications').insert({
    booking_id: booking.id,
    modified_by: 'customer',
    change_summary: `Customer pledged ${formatMoney(amountCents)} via ${method} — awaiting admin reconciliation`,
    new_data: { type: 'payment_pledge', amount_cents: amountCents, method },
  })
  if (auditErr) {
    console.error('portal notify-payment: pledge record FAILED for', bookingRef, '—', auditErr.message)
  }

  // Email admin to reconcile
  let emailed = false
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

    const res = await resend.emails.send({
      from,
      to: ownerEmail(),
      subject: `${methodLabel} payment pledged: ${formatMoney(amountCents)} — ${booking.booking_ref}`,
      html,
    }).catch(err => ({ error: err }))
    if ((res as { error?: unknown }).error) {
      console.error('portal notify-payment: owner email FAILED for', bookingRef, (res as { error?: unknown }).error)
    } else {
      emailed = true
    }
  } else {
    console.error('portal notify-payment: RESEND_API_KEY unset — owner email NOT sent for', bookingRef)
  }
  const texted = await notifyOwnerSms(
    `${method} payment pledged: ${formatMoney(amountCents)} from ${booking.contact_name} (${booking.booking_ref}). Record it in admin once received.`
  )

  // Rule 10. "We've let them know" over a notification that never left is how a
  // customer sends $250 by Venmo that nobody is expecting.
  if (!emailed && !texted) {
    console.error('portal notify-payment: NOTHING was delivered for', bookingRef)
    return NextResponse.json({
      error: 'We recorded that but could not reach the team — please text us so the payment is expected.',
      recorded: !auditErr,
    }, { status: 502 })
  }

  return NextResponse.json({ ok: true, emailed, texted, recorded: !auditErr })
}
