import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

export async function POST(req: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Signature verification failed'
    console.error('Webhook signature error:', message)
    return NextResponse.json({ error: message }, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const m = session.metadata || {}

    const partyDate = m.partyDate
    const optionsLockedBy = partyDate
      ? new Date(new Date(partyDate).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      : null

    let partyTags = {}
    try {
      partyTags = m.partyTags ? JSON.parse(m.partyTags) : {}
    } catch { /* ignore */ }

    const bookingRef = `HH-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`

    const { error: dbError } = await supabase.from('bookings').insert({
      status: 'deposit_paid',
      event_type: m.eventType || 'kid-party',
      party_date: partyDate,
      party_time: m.partyTime,
      package_type: m.packageName || null,
      guest_count_approx: m.guestCount ? parseInt(m.guestCount, 10) : null,
      child_name: m.childName || null,
      child_age: m.childAge ? parseInt(m.childAge, 10) : null,
      contact_name: m.contactName,
      contact_email: m.contactEmail,
      contact_phone: m.contactPhone || null,
      deposit_amount: 250,
      stripe_payment_intent_id: session.payment_intent as string,
      stripe_session_id: session.id,
      party_tags: partyTags,
      notes: m.notes || null,
      options_locked_by: optionsLockedBy,
      booking_ref: bookingRef,
    })

    if (dbError) {
      console.error('Supabase insert error:', dbError)
    } else {
      console.log('Booking created:', bookingRef, 'for', m.contactEmail, 'on', partyDate)
    }

    // Send confirmation emails via Resend
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
      const firstName = m.contactName?.split(' ')[0] || 'there'

      const dateFormatted = partyDate
        ? new Date(partyDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        : 'TBD'

      // Balance due date = 48 hours before party
      const balanceDueDate = partyDate
        ? new Date(new Date(partyDate + 'T12:00:00').getTime() - 48 * 60 * 60 * 1000)
            .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
        : 'day of your event'

      const packageLine = m.packageName
        ? `<tr><td style="padding:8px 0;color:#555;"><strong>Package</strong></td><td style="padding:8px 0;color:#555;">${m.packageName}</td></tr>`
        : ''
      const childLine = m.childName
        ? `<tr><td style="padding:8px 0;color:#555;"><strong>Guest of honor</strong></td><td style="padding:8px 0;color:#555;">${m.childName}${m.childAge ? `, turning ${m.childAge}` : ''}</td></tr>`
        : ''
      const guestLine = m.guestCount
        ? `<tr><td style="padding:8px 0;color:#555;"><strong>Guest count</strong></td><td style="padding:8px 0;color:#555;">~${m.guestCount} children</td></tr>`
        : ''
      const notesLine = m.notes
        ? `<div style="background:#fffbeb;padding:12px 16px;border-left:4px solid #f59e0b;border-radius:4px;margin-top:16px;color:#666;font-size:14px;"><strong>Your notes:</strong> ${m.notes}</div>`
        : ''

      const customerHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0ece7;">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#F6F1EB;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#1a2744 0%,#2a3f6f 100%);padding:36px 40px;text-align:center;">
    <p style="color:#A1B5C8;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:#F6F1EB;font-size:28px;margin:0 0 6px;font-weight:normal;">You're All Set! 🎉</h1>
    <p style="color:#E8C7CB;font-size:15px;margin:0;">Your deposit is received &amp; date is locked in</p>
  </div>

  <!-- Body -->
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:#1a2744;margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:#555;line-height:1.7;margin:0 0 28px;">Your <strong>$250 deposit</strong> has been successfully received. We can't wait to celebrate with you at Host Hampton!</p>

    <!-- Booking details card -->
    <div style="background:linear-gradient(135deg,#A1B5C8 0%,#E8C7CB 100%);padding:3px;border-radius:12px;margin-bottom:24px;">
      <div style="background:white;border-radius:10px;padding:24px;">
        <h2 style="font-size:16px;color:#1a2744;margin:0 0 16px;font-weight:bold;">🎈 Booking Summary</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:8px 0;color:#555;width:140px;"><strong>Booking ref</strong></td><td style="padding:8px 0;color:#1a2744;font-weight:bold;">${bookingRef}</td></tr>
          <tr><td style="padding:8px 0;color:#555;border-top:1px solid #f0ece7;"><strong>Date</strong></td><td style="padding:8px 0;color:#555;border-top:1px solid #f0ece7;">${dateFormatted}</td></tr>
          <tr><td style="padding:8px 0;color:#555;border-top:1px solid #f0ece7;"><strong>Time</strong></td><td style="padding:8px 0;color:#555;border-top:1px solid #f0ece7;">${m.partyTime || 'TBD'}</td></tr>
          <tr><td style="padding:8px 0;color:#555;border-top:1px solid #f0ece7;"><strong>Event type</strong></td><td style="padding:8px 0;color:#555;border-top:1px solid #f0ece7;">${m.eventType || 'Party'}</td></tr>
          ${packageLine}${childLine}${guestLine}
        </table>
        ${notesLine}
      </div>
    </div>

    <!-- Payment summary -->
    <div style="background:#e6f0e8;border-radius:10px;padding:20px;margin-bottom:24px;border:1px solid #b8d4bc;">
      <h3 style="font-size:14px;color:#1a5c2a;margin:0 0 12px;">💰 Payment Summary</h3>
      <div style="display:flex;justify-content:space-between;margin:6px 0;font-size:14px;color:#555;">
        <span>Deposit paid today</span><span style="font-weight:bold;color:#059669;">$250.00 ✓</span>
      </div>
      <div style="border-top:1px solid #b8d4bc;margin:10px 0;padding-top:10px;font-size:13px;color:#666;">
        <strong>Balance due:</strong> Remaining balance is collected at your event.<br>
        We'll send you a full quote within 24 hours.
      </div>
    </div>

    <!-- Gratuity tip -->
    <div style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:6px;padding:14px 16px;margin-bottom:24px;">
      <p style="margin:0;font-size:13px;color:#92400e;"><strong>🎁 Party helper tip:</strong> A 10–15% gratuity for your party helpers is greatly appreciated and goes directly to our team!</p>
    </div>

    <!-- What's next -->
    <div style="background:#f0ece7;border-radius:10px;padding:20px;margin-bottom:24px;">
      <h3 style="font-size:14px;color:#1a2744;margin:0 0 14px;">What happens next</h3>
      <ol style="margin:0;padding-left:20px;color:#555;line-height:2;font-size:14px;">
        <li>We'll reach out <strong>within 24 hours</strong> to confirm your booking details</li>
        <li>You'll receive a calendar invite for your party date</li>
        <li>We'll work together to finalize themes, activities &amp; fun details</li>
        <li>Remaining balance is due <strong>${balanceDueDate}</strong></li>
      </ol>
    </div>

    <!-- Contact -->
    <p style="font-size:14px;color:#555;line-height:1.8;margin:0;">
      Questions? We'd love to hear from you:<br>
      <strong><a href="tel:6319989325" style="color:#1a2744;text-decoration:none;">📞 (631) 998-9325</a></strong><br>
      <strong><a href="mailto:hosthampton295@gmail.com" style="color:#1a2744;text-decoration:none;">✉️ hosthampton295@gmail.com</a></strong><br>
      <span style="color:#888;font-size:12px;">Mon–Fri 12–7pm · Sat–Sun 10am–8pm</span>
    </p>
  </div>

  <!-- Footer -->
  <div style="background:#1a2744;padding:20px 40px;text-align:center;">
    <p style="color:#A1B5C8;font-size:12px;margin:0 0 4px;">295 Montauk Highway, Suite 7 · Speonk, NY 11972</p>
    <p style="color:#6b7fa8;font-size:11px;margin:0;">Can't wait to make your celebration magical!</p>
  </div>

</div>
</body>
</html>`

      const ownerHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:20px;background:#f5f5f5;font-family:sans-serif;">
<div style="max-width:600px;margin:0 auto;background:white;border-radius:8px;overflow:hidden;">
  <div style="background:#1a2744;padding:20px 28px;">
    <h2 style="color:#F6F1EB;margin:0;font-size:18px;">💰 New Deposit Received</h2>
    <p style="color:#A1B5C8;margin:4px 0 0;font-size:13px;">${bookingRef}</p>
  </div>
  <div style="padding:24px 28px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;width:130px;">Customer</td><td style="padding:10px 12px;">${m.contactName}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Email</td><td style="padding:10px 12px;"><a href="mailto:${m.contactEmail}">${m.contactEmail}</a></td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Phone</td><td style="padding:10px 12px;">${m.contactPhone || '—'}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Date</td><td style="padding:10px 12px;">${dateFormatted}</td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Time</td><td style="padding:10px 12px;">${m.partyTime || '—'}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Event type</td><td style="padding:10px 12px;">${m.eventType || '—'}</td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Package</td><td style="padding:10px 12px;">${m.packageName || '—'}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Child</td><td style="padding:10px 12px;">${m.childName ? `${m.childName}${m.childAge ? `, age ${m.childAge}` : ''}` : '—'}</td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Guests</td><td style="padding:10px 12px;">${m.guestCount || '—'}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Notes</td><td style="padding:10px 12px;">${m.notes || '—'}</td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Deposit</td><td style="padding:10px 12px;color:#059669;font-weight:bold;">$250.00 ✓</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Stripe PI</td><td style="padding:10px 12px;font-size:12px;color:#888;">${session.payment_intent}</td></tr>
    </table>
  </div>
</div>
</body>
</html>`

      const [customerResult, ownerResult] = await Promise.allSettled([
        resend.emails.send({
          from,
          to: m.contactEmail,
          subject: `You're booked! ${dateFormatted} at Host Hampton 🎉`,
          html: customerHtml,
        }),
        resend.emails.send({
          from,
          to: 'hosthampton295@gmail.com',
          subject: `New booking: ${m.contactName} — ${partyDate} at ${m.partyTime} (${bookingRef})`,
          html: ownerHtml,
        }),
      ])

      if (customerResult.status === 'rejected') console.error('Customer email failed:', customerResult.reason)
      else console.log('Confirmation sent to', m.contactEmail)
      if (ownerResult.status === 'rejected') console.error('Owner email failed:', ownerResult.reason)
    } else {
      console.warn('RESEND_API_KEY not set — skipping emails')
    }
  }

  return NextResponse.json({ received: true })
}
