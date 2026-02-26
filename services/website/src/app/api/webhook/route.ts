import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { Resend } from 'resend'
import { getSupabase } from '@/lib/supabase'
import { upsertContact } from '@/lib/contacts'
import { ticketConfirmationHtml, ticketPurchaseNotifyHtml } from '@/lib/emailTemplates'
import { createCalendarEvent, addMinutes } from '@/lib/googleCalendar'

export async function POST(req: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!
  const supabase = getSupabase()

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

    // ── Event ticket purchase ──────────────────────────────────
    if (m.type === 'event_ticket') {
      const qty = parseInt(m.quantity || '1', 10)
      const ticketRef = `HH-EVT-${Date.now().toString().slice(-4)}`

      // Fetch event for details
      const { data: evt } = await supabase
        .from('events')
        .select('title, event_date, event_time, location')
        .eq('id', m.eventId)
        .single()

      // Determine unit price from session amount
      const totalCents = session.amount_total || 0
      const unitPriceCents = Math.round(totalCents / qty)

      const { error: ticketErr } = await supabase.from('event_tickets').insert({
        ticket_ref: ticketRef,
        event_id: m.eventId,
        session_id: m.sessionId || null,
        customer_name: m.customerName,
        customer_email: m.customerEmail,
        customer_phone: m.customerPhone || null,
        quantity: qty,
        variant_label: m.variantLabel || null,
        unit_price_cents: unitPriceCents,
        total_cents: totalCents,
        stripe_payment_intent_id: session.payment_intent as string,
        stripe_session_id: session.id,
        status: 'confirmed',
      })

      if (ticketErr) {
        console.error('Event ticket insert error:', ticketErr)
      } else {
        // Decrement available tickets
        if (m.sessionId) {
          await supabase.rpc('decrement_session_tickets', { sid: m.sessionId, qty })
        } else {
          await supabase.rpc('decrement_event_tickets', { eid: m.eventId, qty })
        }
        console.log('Ticket created:', ticketRef, 'for', m.customerEmail)

        // Upsert contact (non-fatal)
        await upsertContact({
          name: m.customerName,
          email: m.customerEmail,
          phone: m.customerPhone,
          sourceDetail: `Event ticket — ${evt?.title || 'event'}`,
          serviceInterests: ['event'],
        })
      }

      // Send emails
      if (process.env.RESEND_API_KEY && evt) {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
        const dateDisplay = evt.event_date
          ? new Date(evt.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
          : 'TBD'
        const totalFormatted = `$${(totalCents / 100).toFixed(2)}`

        await Promise.allSettled([
          resend.emails.send({
            from, to: m.customerEmail,
            subject: `You're in! ${evt.title} at Host Hampton 🎉`,
            html: ticketConfirmationHtml({
              customerName: m.customerName, eventTitle: evt.title, eventDate: dateDisplay,
              eventTime: evt.event_time || '', location: evt.location, quantity: qty,
              variantLabel: m.variantLabel || undefined, totalFormatted, ticketRef, isFree: false,
            }),
          }),
          resend.emails.send({
            from, to: 'alark51@gmail.com',
            subject: `New ticket: ${m.customerName} — ${evt.title} (${ticketRef})`,
            html: ticketPurchaseNotifyHtml({
              ticketRef, customerName: m.customerName, customerEmail: m.customerEmail,
              customerPhone: m.customerPhone || undefined, eventTitle: evt.title,
              eventDate: dateDisplay, eventTime: evt.event_time || '', quantity: qty,
              variantLabel: m.variantLabel || undefined, totalFormatted, isFree: false,
              stripePI: session.payment_intent as string,
            }),
          }),
        ])
        console.log('Ticket confirmation sent to', m.customerEmail)
      }

      return NextResponse.json({ received: true })
    }

    // ── Multi-session event ticket purchase ──────────────────
    if (m.type === 'event_ticket_multi') {
      const sessionIds = JSON.parse(m.sessionIds || '[]') as string[]
      const qty = parseInt(m.quantity || '1', 10)
      const unitPriceCents = parseInt(m.unitPriceCents || '0', 10)
      const groupRef = `GRP-${Date.now()}`

      const { data: evt } = await supabase
        .from('events')
        .select('title, event_time, location')
        .eq('id', m.eventId)
        .single()

      const { data: sessionsData } = await supabase
        .from('event_sessions')
        .select('id, session_date, session_time, label')
        .in('id', sessionIds)
        .order('session_date', { ascending: true })

      const ticketRefs: string[] = []
      for (const sess of (sessionsData || [])) {
        const ticketRef = `HH-EVT-${Date.now().toString().slice(-4)}-${sess.id.slice(0, 4)}`
        ticketRefs.push(ticketRef)

        const { error: ticketErr } = await supabase.from('event_tickets').insert({
          ticket_ref: ticketRef,
          event_id: m.eventId,
          session_id: sess.id,
          group_ref: groupRef,
          customer_name: m.customerName,
          customer_email: m.customerEmail,
          customer_phone: m.customerPhone || null,
          quantity: qty,
          variant_label: m.variantLabel || null,
          unit_price_cents: unitPriceCents,
          total_cents: unitPriceCents * qty,
          stripe_payment_intent_id: session.payment_intent as string,
          stripe_session_id: session.id,
          status: 'confirmed',
        })

        if (ticketErr) {
          console.error('Multi-session ticket insert error:', ticketErr)
        } else {
          await supabase.rpc('decrement_session_tickets', { sid: sess.id, qty })
        }
      }

      console.log('Multi-session tickets created:', groupRef, ticketRefs.length, 'sessions for', m.customerEmail)

      // Upsert contact (non-fatal)
      await upsertContact({
        name: m.customerName,
        email: m.customerEmail,
        phone: m.customerPhone,
        sourceDetail: `Event ticket — ${evt?.title || 'event'} (series)`,
        serviceInterests: ['event'],
      })

      // Send emails
      if (process.env.RESEND_API_KEY && evt) {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
        const totalCents = session.amount_total || 0
        const totalFormatted = `$${(totalCents / 100).toFixed(2)}`

        const sessionDates = (sessionsData || []).map(s => {
          const d = new Date(s.session_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
          return `${d} at ${s.session_time}${s.label ? ` — ${s.label}` : ''}`
        }).join(', ')

        await Promise.allSettled([
          resend.emails.send({
            from, to: m.customerEmail,
            subject: `You're in! ${evt.title} at Host Hampton`,
            html: ticketConfirmationHtml({
              customerName: m.customerName, eventTitle: evt.title,
              eventDate: `${sessionIds.length} sessions`,
              eventTime: sessionDates,
              location: evt.location, quantity: qty,
              variantLabel: m.variantLabel || undefined,
              totalFormatted, ticketRef: groupRef, isFree: false,
            }),
          }),
          resend.emails.send({
            from, to: 'alark51@gmail.com',
            subject: `New ticket: ${m.customerName} — ${evt.title} (${sessionIds.length} sessions, ${groupRef})`,
            html: ticketPurchaseNotifyHtml({
              ticketRef: groupRef, customerName: m.customerName,
              customerEmail: m.customerEmail,
              customerPhone: m.customerPhone || undefined,
              eventTitle: evt.title,
              eventDate: `${sessionIds.length} sessions`,
              eventTime: sessionDates, quantity: qty,
              variantLabel: m.variantLabel || undefined,
              totalFormatted, isFree: false,
              stripePI: session.payment_intent as string,
            }),
          }),
        ])
        console.log('Multi-session confirmation sent to', m.customerEmail)
      }

      return NextResponse.json({ received: true })
    }

    // ── Party booking deposit (existing flow) ──────────────────
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
      deposit_amount: m.depositCents ? parseInt(m.depositCents, 10) / 100 : 250,
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

      // Upsert contact (non-fatal)
      await upsertContact({
        name: m.contactName,
        email: m.contactEmail,
        phone: m.contactPhone,
        sourceDetail: `Booking deposit — ${m.eventType || 'party'}`,
        serviceInterests: [m.bookingTypeSlug || m.eventType || 'general'],
      })

      // Write back to Google Calendar
      if (partyDate && m.partyTime) {
        const duration = parseInt(m.slotDurationMin || '120', 10)
        const endTime = addMinutes(m.partyTime, duration)
        const calEventId = await createCalendarEvent({
          summary: `[BOOKING] ${m.contactName} - ${m.eventType || 'Party'}`,
          startDate: partyDate,
          startTime: m.partyTime,
          endTime,
          description: `Ref: ${bookingRef}\nContact: ${m.contactName} (${m.contactEmail})\nType: ${m.eventType || 'Party'}${m.packageName ? `\nPackage: ${m.packageName}` : ''}${m.guestCount ? `\nGuests: ~${m.guestCount}` : ''}${m.notes ? `\nNotes: ${m.notes}` : ''}`,
        })
        if (calEventId) {
          console.log('Google Calendar event created:', calEventId)
        }
      }
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

      const depositAmount = m.depositCents ? parseInt(m.depositCents, 10) / 100 : 250
      const depositFormatted = `$${depositAmount.toFixed(2)}`
      const isRoomRental = (m.eventType || '').includes('room-rental')

      // Format event type slug to display name
      const eventTypeDisplay = (m.eventType || 'Party')
        .split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

      const packageLine = m.packageName
        ? `<tr><td style="padding:8px 0;color:#555;"><strong>Package</strong></td><td style="padding:8px 0;color:#555;">${m.packageName}</td></tr>`
        : ''
      const childLine = m.childName
        ? `<tr><td style="padding:8px 0;color:#555;"><strong>Guest of honor</strong></td><td style="padding:8px 0;color:#555;">${m.childName}${m.childAge ? `, turning ${m.childAge}` : ''}</td></tr>`
        : ''
      const guestLine = m.guestCount
        ? `<tr><td style="padding:8px 0;color:#555;"><strong>Guest count</strong></td><td style="padding:8px 0;color:#555;">~${m.guestCount}${isRoomRental ? ' guests' : ' children'}</td></tr>`
        : ''
      const notesLine = m.notes
        ? `<div style="background:#fffbeb;padding:12px 16px;border-left:4px solid #f59e0b;border-radius:4px;margin-top:16px;color:#666;font-size:14px;"><strong>Your notes:</strong> ${m.notes}</div>`
        : ''

      const customerHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F6F1EB;">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%);padding:36px 40px;text-align:center;">
    <p style="color:#1a2744;opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:#1a2744;font-size:28px;margin:0 0 6px;font-weight:normal;">You're All Set! 🎉</h1>
    <p style="color:#1a2744;opacity:0.7;font-size:15px;margin:0;">Your deposit is received &amp; date is locked in</p>
  </div>

  <!-- Body -->
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:#1a2744;margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:#555;line-height:1.7;margin:0 0 28px;">Your <strong>${depositFormatted} deposit</strong> has been successfully received. We can't wait to celebrate with you at Host Hampton!</p>

    <!-- Booking details card -->
    <div style="background:linear-gradient(135deg,#A1B5C8 0%,#E8C7CB 100%);padding:3px;border-radius:12px;margin-bottom:24px;">
      <div style="background:white;border-radius:10px;padding:24px;">
        <h2 style="font-size:16px;color:#1a2744;margin:0 0 16px;font-weight:bold;">🎈 Booking Summary</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:8px 0;color:#555;width:140px;"><strong>Booking ref</strong></td><td style="padding:8px 0;color:#1a2744;font-weight:bold;">${bookingRef}</td></tr>
          <tr><td style="padding:8px 0;color:#555;border-top:1px solid #f0ece7;"><strong>Date</strong></td><td style="padding:8px 0;color:#555;border-top:1px solid #f0ece7;">${dateFormatted}</td></tr>
          <tr><td style="padding:8px 0;color:#555;border-top:1px solid #f0ece7;"><strong>Time</strong></td><td style="padding:8px 0;color:#555;border-top:1px solid #f0ece7;">${m.partyTime || 'TBD'}</td></tr>
          <tr><td style="padding:8px 0;color:#555;border-top:1px solid #f0ece7;"><strong>Event type</strong></td><td style="padding:8px 0;color:#555;border-top:1px solid #f0ece7;">${eventTypeDisplay}</td></tr>
          ${packageLine}${childLine}${guestLine}
        </table>
        ${notesLine}
      </div>
    </div>

    <!-- Payment summary -->
    <div style="background:#e6f0e8;border-radius:10px;padding:20px;margin-bottom:24px;border:1px solid #b8d4bc;">
      <h3 style="font-size:14px;color:#1a5c2a;margin:0 0 12px;">💰 Payment Summary</h3>
      <div style="display:flex;justify-content:space-between;margin:6px 0;font-size:14px;color:#555;">
        <span>Deposit paid today</span><span style="font-weight:bold;color:#059669;">${depositFormatted} ✓</span>
      </div>
      <div style="border-top:1px solid #b8d4bc;margin:10px 0;padding-top:10px;font-size:13px;color:#666;">
        <strong>Balance due:</strong> Remaining balance is collected at your event.<br>
        We'll send you a full quote within 24 hours.
      </div>
    </div>

    ${isRoomRental ? '' : `<!-- Gratuity tip -->
    <div style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:6px;padding:14px 16px;margin-bottom:24px;">
      <p style="margin:0;font-size:13px;color:#92400e;"><strong>🎁 Party helper tip:</strong> A 10–15% gratuity for your party helpers is greatly appreciated and goes directly to our team!</p>
    </div>`}

    <!-- What's next -->
    <div style="background:#f0ece7;border-radius:10px;padding:20px;margin-bottom:24px;">
      <h3 style="font-size:14px;color:#1a2744;margin:0 0 14px;">What happens next</h3>
      ${isRoomRental ? `<ol style="margin:0;padding-left:20px;color:#555;line-height:2;font-size:14px;">
        <li>We'll reach out <strong>within 24 hours</strong> to confirm your rental details</li>
        <li>We'll go over any setup needs, vendor access, or special requirements</li>
        <li>A $500 refundable security deposit is collected separately before your event</li>
        <li>Remaining balance is due <strong>${balanceDueDate}</strong></li>
      </ol>` : `<ol style="margin:0;padding-left:20px;color:#555;line-height:2;font-size:14px;">
        <li>We'll reach out <strong>within 24 hours</strong> to confirm your booking details</li>
        <li>You'll receive a personalized themed EVITE digital invitation</li>
        <li>We'll work together to finalize themes, activities &amp; fun details</li>
        <li>Remaining balance is due <strong>${balanceDueDate}</strong></li>
      </ol>`}
    </div>

    <!-- Contact -->
    <p style="font-size:14px;color:#555;line-height:1.8;margin:0;">
      Questions? We'd love to hear from you:<br>
      <strong><a href="tel:6319989325" style="color:#1a2744;text-decoration:none;">📞 (631) 998-9325</a></strong> &nbsp;·&nbsp;
      <strong><a href="sms:6319989325" style="color:#1a2744;text-decoration:none;">💬 Text Us</a></strong><br>
      <strong><a href="mailto:hosthampton295@gmail.com" style="color:#1a2744;text-decoration:none;">✉️ hosthampton295@gmail.com</a></strong><br>
      <span style="color:#888;font-size:12px;">Mon–Fri 12–7pm · Sat–Sun 10am–8pm</span>
    </p>
  </div>

  <!-- Footer -->
  <div style="background:#BCCDEB;padding:20px 40px;text-align:center;">
    <p style="color:#1a2744;font-size:12px;margin:0 0 4px;">295 Montauk Highway, Suite 7 · Speonk, NY 11972</p>
    <p style="color:#1a2744;opacity:0.5;font-size:11px;margin:0;">Can't wait to make your celebration magical!</p>
  </div>

</div>
</body>
</html>`

      const ownerHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:20px;background:#F6F1EB;font-family:sans-serif;">
<div style="max-width:600px;margin:0 auto;background:white;border-radius:8px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%);padding:20px 28px;">
    <h2 style="color:#1a2744;margin:0;font-size:18px;">💰 New Deposit Received</h2>
    <p style="color:#1a2744;opacity:0.7;margin:4px 0 0;font-size:13px;">${bookingRef}</p>
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
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Deposit</td><td style="padding:10px 12px;color:#059669;font-weight:bold;">${depositFormatted} ✓</td></tr>
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
          to: 'alark51@gmail.com',
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
