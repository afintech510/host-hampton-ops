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
        : partyDate
      const packageLine = m.packageName ? `<strong>Package:</strong> ${m.packageName}<br>` : ''
      const childLine = m.childName ? `<strong>Guest of honor:</strong> ${m.childName}${m.childAge ? `, turning ${m.childAge}` : ''}<br>` : ''
      const notesLine = m.notes ? `<strong>Notes:</strong> ${m.notes}<br>` : ''

      const [customerResult, ownerResult] = await Promise.allSettled([
        // Customer confirmation
        resend.emails.send({
          from,
          to: m.contactEmail,
          subject: `You're booked! ${dateFormatted} at Host Hampton 🎉`,
          html: `
            <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #1a2744;">
              <div style="background: #1a2744; padding: 32px 40px; text-align: center;">
                <h1 style="color: #F6F1EB; font-size: 26px; margin: 0;">You're All Set! 🎉</h1>
                <p style="color: #A1B5C8; margin: 8px 0 0;">Host Hampton · Speonk, NY</p>
              </div>
              <div style="padding: 40px; background: #F6F1EB;">
                <p style="font-size: 16px;">Hi ${firstName},</p>
                <p>Your $250 deposit has been received and your date is locked in. We're so excited to celebrate with you!</p>
                <div style="background: white; border-radius: 12px; padding: 24px; margin: 24px 0; border-left: 4px solid #E8C7CB;">
                  <h2 style="font-size: 15px; color: #1a2744; margin-top: 0;">Booking Summary</h2>
                  <strong>Booking ref:</strong> ${bookingRef}<br>
                  <strong>Date:</strong> ${dateFormatted}<br>
                  <strong>Time:</strong> ${m.partyTime}<br>
                  ${packageLine}${childLine}${notesLine}
                  <strong>Deposit paid:</strong> $250 ✓
                </div>
                <h3 style="color: #1a2744;">What happens next:</h3>
                <ol style="color: #555; line-height: 2;">
                  <li>We'll reach out within 24 hours to confirm your booking</li>
                  <li>You'll receive a calendar invite for your party date</li>
                  <li>We'll work with you to finalize all the fun details</li>
                </ol>
                <p>Questions? Call or text us:<br>
                  <strong><a href="tel:6319989325" style="color: #1a2744;">(631) 998-9325</a></strong><br>
                  <span style="color: #888; font-size: 13px;">Mon–Fri 12–7pm · Sat–Sun 10am–8pm</span>
                </p>
              </div>
              <div style="background: #1a2744; padding: 20px 40px; text-align: center;">
                <p style="color: #A1B5C8; font-size: 12px; margin: 0;">295 Montauk Highway, Suite 7 · Speonk, NY 11972</p>
              </div>
            </div>`,
        }),
        // Owner notification
        resend.emails.send({
          from,
          to: 'hosthampton295@gmail.com',
          subject: `New booking: ${m.contactName} — ${partyDate} at ${m.partyTime} (${bookingRef})`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1a2744;">New Deposit Received</h2>
              <table style="border-collapse: collapse; width: 100%; font-size: 14px;">
                <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; width: 140px;"><strong>Booking ref</strong></td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${bookingRef}</td></tr>
                <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee;"><strong>Customer</strong></td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${m.contactName}</td></tr>
                <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee;"><strong>Email</strong></td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${m.contactEmail}</td></tr>
                <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee;"><strong>Phone</strong></td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${m.contactPhone || '—'}</td></tr>
                <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee;"><strong>Date</strong></td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${dateFormatted}</td></tr>
                <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee;"><strong>Time</strong></td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${m.partyTime}</td></tr>
                <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee;"><strong>Event type</strong></td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${m.eventType}</td></tr>
                <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee;"><strong>Package</strong></td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${m.packageName || '—'}</td></tr>
                <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee;"><strong>Child</strong></td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${m.childName || '—'}${m.childAge ? `, age ${m.childAge}` : ''}</td></tr>
                <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee;"><strong>Guests</strong></td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${m.guestCount || '—'}</td></tr>
                <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee;"><strong>Notes</strong></td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${m.notes || '—'}</td></tr>
                <tr><td style="padding: 8px 12px;"><strong>Stripe PI</strong></td><td style="padding: 8px 12px;">${session.payment_intent}</td></tr>
              </table>
            </div>`,
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
