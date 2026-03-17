import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { Resend } from 'resend'
import { getSupabase } from '@/lib/supabase'
import { upsertContact } from '@/lib/contacts'
import { ticketConfirmationHtml, ticketPurchaseNotifyHtml, bookingConfirmationHtml, giftCardHtml, giftCardNotifyHtml, giftCardPurchaseConfirmHtml } from '@/lib/emailTemplates'
import { createCalendarEvent, addMinutes } from '@/lib/googleCalendar'
import { enqueueEventReminders, enqueueBookingReminders, enqueueReviewRequest } from '@/lib/reminders'
import { enrollInSequence } from '@/lib/sequences'

/* Record a Stripe payment in the unified financial_transactions table (non-fatal) */
async function recordFinancialTransaction(supabase: ReturnType<typeof getSupabase>, opts: {
  date: string; description: string; amountCents: number; category: string;
  customerName: string | null; reference: string; notes?: string | null;
}) {
  await supabase.from('financial_transactions').insert({
    date: opts.date,
    description: opts.description,
    amount_cents: opts.amountCents,
    source: 'stripe',
    category: opts.category,
    customer_name: opts.customerName,
    reference: `stripe-${opts.reference}`,
    notes: opts.notes || null,
  }).then(({ error }) => {
    if (error && !error.message.includes('duplicate')) {
      console.error('Financial txn insert error (non-fatal):', error.message)
    }
  })
}

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

        // Redeem partial gift card if used (non-fatal)
        if (m.giftCardCode && m.giftCardDeductCents) {
          const gcDeduct = parseInt(m.giftCardDeductCents, 10)
          if (gcDeduct > 0) {
            const { data: gc } = await supabase
              .from('gift_cards')
              .select('id, balance_cents')
              .eq('code', m.giftCardCode)
              .eq('status', 'active')
              .single()
            if (gc) {
              const newBal = Math.max(0, gc.balance_cents - gcDeduct)
              await supabase.from('gift_cards').update({
                balance_cents: newBal,
                status: newBal === 0 ? 'redeemed' : 'active',
                redeemed_at: newBal === 0 ? new Date().toISOString() : null,
              }).eq('id', gc.id)
              console.log(`Gift card ${m.giftCardCode} redeemed ${gcDeduct}c via webhook. New balance: ${newBal}c`)
            }
          }
        }

        // Record in financials (non-fatal)
        await recordFinancialTransaction(supabase, {
          date: new Date().toISOString().split('T')[0],
          description: evt?.title || 'Event Ticket',
          amountCents: totalCents,
          category: 'Event Ticket',
          customerName: m.customerName,
          reference: `tk-${ticketRef}`,
          notes: m.customerEmail,
        })

        // Upsert contact (non-fatal)
        const contactId = await upsertContact({
          name: m.customerName,
          email: m.customerEmail,
          phone: m.customerPhone,
          sourceDetail: `Event ticket — ${evt?.title || 'event'}`,
          serviceInterests: ['event'],
          marketingConsent: m.marketingConsent === 'true',
        })

        // Enroll in post-booking sequence (non-fatal)
        if (contactId) {
          await enrollInSequence({
            contactId,
            contactEmail: m.customerEmail,
            triggerEvent: 'booking_confirmed',
            serviceType: 'event',
          }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
        }

        // Enqueue reminders (non-fatal)
        if (evt?.event_date) {
          await enqueueEventReminders({
            contactEmail: m.customerEmail,
            eventId: m.eventId,
            eventDate: evt.event_date,
            eventTime: evt.event_time || undefined,
          }).catch(err => console.error('Reminder enqueue error:', err))

          await enqueueReviewRequest({
            contactEmail: m.customerEmail,
            referenceType: 'event',
            referenceId: m.eventId,
            eventDate: evt.event_date,
          }).catch(err => console.error('Review request enqueue error:', err))
        }
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
            from, to: 'hosthampton295@gmail.com',
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

      // Record in financials (non-fatal)
      const multiTotalCents = session.amount_total || 0
      await recordFinancialTransaction(supabase, {
        date: new Date().toISOString().split('T')[0],
        description: `${evt?.title || 'Event'} (${sessionIds.length} sessions)`,
        amountCents: multiTotalCents,
        category: 'Event Ticket',
        customerName: m.customerName,
        reference: `tk-${groupRef}`,
        notes: m.customerEmail,
      })

      // Upsert contact (non-fatal)
      const contactId = await upsertContact({
        name: m.customerName,
        email: m.customerEmail,
        phone: m.customerPhone,
        sourceDetail: `Event ticket — ${evt?.title || 'event'} (series)`,
        serviceInterests: ['event'],
        marketingConsent: m.marketingConsent === 'true',
      })

      // Enroll in post-booking sequence (non-fatal)
      if (contactId) {
        await enrollInSequence({
          contactId,
          contactEmail: m.customerEmail,
          triggerEvent: 'booking_confirmed',
          serviceType: 'event',
        }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
      }

      // Enqueue reminders for each session date (non-fatal)
      for (const sess of (sessionsData || [])) {
        if (sess.session_date) {
          await enqueueEventReminders({
            contactEmail: m.customerEmail,
            eventId: m.eventId,
            eventDate: sess.session_date,
            eventTime: sess.session_time || undefined,
          }).catch(err => console.error('Reminder enqueue error:', err))
        }
      }

      // Review request after last session (non-fatal)
      const lastSession = sessionsData?.[sessionsData.length - 1]
      if (lastSession?.session_date) {
        await enqueueReviewRequest({
          contactEmail: m.customerEmail,
          referenceType: 'event',
          referenceId: m.eventId,
          eventDate: lastSession.session_date,
        }).catch(err => console.error('Review request enqueue error:', err))
      }

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
            from, to: 'hosthampton295@gmail.com',
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

    // ── Cart checkout (multiple events in one purchase) ────────
    if (m.type === 'cart_checkout') {
      const cartItems = JSON.parse(m.cartItems || '[]') as {
        eventId: string
        sessionId?: string
        sessionIds?: string[]
        quantity: number
        variantLabel?: string
        unitPriceCents: number
        eventTitle: string
      }[]
      const cartRef = `CART-${Date.now()}`
      const ticketRefs: string[] = []
      const eventTitles: string[] = []

      for (const ci of cartItems) {
        const qty = ci.quantity

        if (ci.sessionIds?.length) {
          // Multi-session item
          for (const sid of ci.sessionIds) {
            const ticketRef = `HH-EVT-${Date.now().toString().slice(-4)}-${sid.slice(0, 4)}`
            ticketRefs.push(ticketRef)

            const { error: ticketErr } = await supabase.from('event_tickets').insert({
              ticket_ref: ticketRef,
              event_id: ci.eventId,
              session_id: sid,
              group_ref: cartRef,
              customer_name: m.customerName,
              customer_email: m.customerEmail,
              customer_phone: m.customerPhone || null,
              quantity: qty,
              variant_label: ci.variantLabel || null,
              unit_price_cents: ci.unitPriceCents,
              total_cents: ci.unitPriceCents * qty,
              stripe_payment_intent_id: session.payment_intent as string,
              stripe_session_id: session.id,
              status: 'confirmed',
            })

            if (ticketErr) {
              console.error('Cart ticket insert error:', ticketErr)
            } else {
              await supabase.rpc('decrement_session_tickets', { sid, qty })
            }
          }
        } else {
          // Single session or no session
          const ticketRef = `HH-EVT-${Date.now().toString().slice(-4)}-${ci.eventId.slice(0, 4)}`
          ticketRefs.push(ticketRef)

          const { error: ticketErr } = await supabase.from('event_tickets').insert({
            ticket_ref: ticketRef,
            event_id: ci.eventId,
            session_id: ci.sessionId || null,
            group_ref: cartRef,
            customer_name: m.customerName,
            customer_email: m.customerEmail,
            customer_phone: m.customerPhone || null,
            quantity: qty,
            variant_label: ci.variantLabel || null,
            unit_price_cents: ci.unitPriceCents,
            total_cents: ci.unitPriceCents * qty,
            stripe_payment_intent_id: session.payment_intent as string,
            stripe_session_id: session.id,
            status: 'confirmed',
          })

          if (ticketErr) {
            console.error('Cart ticket insert error:', ticketErr)
          } else {
            if (ci.sessionId) {
              await supabase.rpc('decrement_session_tickets', { sid: ci.sessionId, qty })
            } else {
              await supabase.rpc('decrement_event_tickets', { eid: ci.eventId, qty })
            }
          }
        }
        if (!eventTitles.includes(ci.eventTitle)) eventTitles.push(ci.eventTitle)
      }

      console.log('Cart checkout processed:', cartRef, ticketRefs.length, 'tickets for', m.customerEmail)

      // Record in financials (non-fatal)
      const cartTotalCents = session.amount_total || 0
      await recordFinancialTransaction(supabase, {
        date: new Date().toISOString().split('T')[0],
        description: eventTitles.join(' + '),
        amountCents: cartTotalCents,
        category: 'Event Ticket',
        customerName: m.customerName,
        reference: `tk-${cartRef}`,
        notes: m.customerEmail,
      })

      // Upsert contact
      const contactId = await upsertContact({
        name: m.customerName,
        email: m.customerEmail,
        phone: m.customerPhone,
        sourceDetail: `Cart checkout — ${eventTitles.join(', ')}`,
        serviceInterests: ['event'],
        marketingConsent: m.marketingConsent === 'true',
      })

      // Enroll in post-booking sequence (non-fatal)
      if (contactId) {
        await enrollInSequence({
          contactId,
          contactEmail: m.customerEmail,
          triggerEvent: 'booking_confirmed',
          serviceType: 'event',
        }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
      }

      // Enqueue reminders per event (non-fatal)
      for (const ci of cartItems) {
        // Fetch event_date for each cart item
        const { data: ciEvt } = await supabase
          .from('events')
          .select('event_date, event_time')
          .eq('id', ci.eventId)
          .single()

        if (ciEvt?.event_date) {
          await enqueueEventReminders({
            contactEmail: m.customerEmail,
            eventId: ci.eventId,
            eventDate: ciEvt.event_date,
            eventTime: ciEvt.event_time || undefined,
          }).catch(err => console.error('Cart reminder enqueue error:', err))

          await enqueueReviewRequest({
            contactEmail: m.customerEmail,
            referenceType: 'event',
            referenceId: ci.eventId,
            eventDate: ciEvt.event_date,
          }).catch(err => console.error('Cart review request error:', err))
        }
      }

      // Send confirmation emails
      if (process.env.RESEND_API_KEY) {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
        const totalCents = session.amount_total || 0
        const totalFormatted = `$${(totalCents / 100).toFixed(2)}`

        const itemsSummary = cartItems.map(ci =>
          `${ci.eventTitle}${ci.sessionIds?.length ? ` (${ci.sessionIds.length} sessions)` : ''} x${ci.quantity}`
        ).join(', ')

        await Promise.allSettled([
          resend.emails.send({
            from, to: m.customerEmail,
            subject: `You're in! ${eventTitles.length} event${eventTitles.length > 1 ? 's' : ''} at Host Hampton`,
            html: ticketConfirmationHtml({
              customerName: m.customerName,
              eventTitle: eventTitles.join(' + '),
              eventDate: `${ticketRefs.length} ticket${ticketRefs.length > 1 ? 's' : ''}`,
              eventTime: itemsSummary,
              location: 'Host Hampton',
              quantity: ticketRefs.length,
              totalFormatted,
              ticketRef: cartRef,
              isFree: false,
            }),
          }),
          resend.emails.send({
            from, to: 'hosthampton295@gmail.com',
            subject: `New cart order: ${m.customerName} — ${eventTitles.join(', ')} (${cartRef})`,
            html: ticketPurchaseNotifyHtml({
              ticketRef: cartRef,
              customerName: m.customerName,
              customerEmail: m.customerEmail,
              customerPhone: m.customerPhone || undefined,
              eventTitle: eventTitles.join(' + '),
              eventDate: `${ticketRefs.length} ticket${ticketRefs.length > 1 ? 's' : ''}`,
              eventTime: itemsSummary,
              quantity: ticketRefs.length,
              totalFormatted,
              isFree: false,
              stripePI: session.payment_intent as string,
            }),
          }),
        ])
        console.log('Cart confirmation sent to', m.customerEmail)
      }

      return NextResponse.json({ received: true })
    }

    // ── Vendor event registration ──────────────────────────────
    if (m.type === 'vendor_registration') {
      const vendorRef = `HH-VND-${Date.now().toString().slice(-4)}`
      const today = new Date().toISOString().split('T')[0]

      const { error: dbError } = await supabase.from('bookings').insert({
        booking_ref: vendorRef,
        status: 'confirmed',
        event_type: 'vendor_registration',
        party_date: today,
        party_time: 'TBD',
        package_type: 'Spring Market Vendor',
        contact_name: m.contactName,
        contact_email: m.contactEmail,
        contact_phone: m.contactPhone || null,
        deposit_amount: 4635,
        stripe_payment_intent_id: session.payment_intent as string,
        stripe_session_id: session.id,
        party_tags: {},
        notes: JSON.stringify({ businessName: m.businessName, igHandle: m.igHandle }),
      })

      if (dbError) {
        console.error('Vendor registration insert error:', dbError)
      } else {
        console.log('Vendor registration created:', vendorRef, m.businessName, m.contactEmail)

        // Record in financials (non-fatal)
        await recordFinancialTransaction(supabase, {
          date: new Date().toISOString().split('T')[0],
          description: `Vendor Registration — ${m.businessName}`,
          amountCents: 4635,
          category: 'Vendor Fee',
          customerName: m.contactName,
          reference: `bk-${vendorRef}`,
          notes: m.contactEmail,
        })
      }

      // Upsert contact
      const contactId = await upsertContact({
        name: m.contactName,
        email: m.contactEmail,
        phone: m.contactPhone,
        sourceDetail: `Vendor registration — Spring Market (${m.businessName})`,
        serviceInterests: ['general'],
        marketingConsent: true,
      })

      // Enroll in post-booking sequence (non-fatal)
      if (contactId) {
        await enrollInSequence({
          contactId,
          contactEmail: m.contactEmail,
          triggerEvent: 'booking_confirmed',
          serviceType: 'general',
        }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
      }

      // Confirmation emails
      if (process.env.RESEND_API_KEY) {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

        const customerHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F6F1EB;font-family:sans-serif;">
<div style="max-width:560px;margin:0 auto;background:white;">
  <div style="background:linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%);padding:36px 40px;text-align:center;">
    <p style="color:#1a2744;opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 10px;">Host Hampton &middot; Speonk, NY</p>
    <h1 style="color:#1a2744;font-size:26px;margin:0;font-weight:normal;font-family:Georgia,serif;">You&rsquo;re registered!</h1>
  </div>
  <div style="padding:32px 40px;">
    <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 24px;">
      Hi ${m.contactName?.split(' ')[0] || 'there'}! We&rsquo;ve got your spot at the Host Hampton Spring Market. We&rsquo;ll be in touch with event details soon.
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:28px;">
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;color:#1a2744;width:140px;">Business</td><td style="padding:10px 12px;color:#555;">${m.businessName}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;color:#1a2744;">Instagram</td><td style="padding:10px 12px;color:#555;">${m.igHandle}</td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;color:#1a2744;">Registration</td><td style="padding:10px 12px;color:#059669;font-weight:bold;">$46.35 paid ✓</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;color:#1a2744;">Ref #</td><td style="padding:10px 12px;color:#888;font-size:12px;">${vendorRef}</td></tr>
    </table>
    <p style="color:#888;font-size:13px;line-height:1.6;margin:0;">Questions? Text or call <strong style="color:#1a2744;">(631) 998-9325</strong> or DM <strong style="color:#1a2744;">@hosthampton</strong> on Instagram.</p>
  </div>
  <div style="background:#BCCDEB;padding:20px 40px;text-align:center;">
    <p style="color:#1a2744;font-size:12px;margin:0;">Host Hampton &middot; 295 Montauk Highway, Suite 7, Speonk, NY 11972</p>
  </div>
</div>
</body></html>`

        const ownerHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:20px;background:#F6F1EB;font-family:sans-serif;">
<div style="max-width:560px;margin:0 auto;background:white;border-radius:8px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%);padding:20px 28px;">
    <h2 style="color:#1a2744;margin:0;font-size:18px;">New Vendor Registration</h2>
    <p style="color:#1a2744;opacity:0.7;margin:4px 0 0;font-size:13px;">${vendorRef}</p>
  </div>
  <div style="padding:24px 28px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;width:130px;">Name</td><td style="padding:10px 12px;">${m.contactName}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Business</td><td style="padding:10px 12px;">${m.businessName}</td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Instagram</td><td style="padding:10px 12px;">${m.igHandle}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Email</td><td style="padding:10px 12px;"><a href="mailto:${m.contactEmail}">${m.contactEmail}</a></td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Phone</td><td style="padding:10px 12px;">${m.contactPhone || '—'}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Paid</td><td style="padding:10px 12px;color:#059669;font-weight:bold;">$46.35 ✓</td></tr>
    </table>
  </div>
</div>
</body></html>`

        await Promise.allSettled([
          resend.emails.send({
            from,
            to: m.contactEmail,
            subject: `You're registered! Host Hampton Spring Market`,
            html: customerHtml,
          }),
          resend.emails.send({
            from,
            to: 'hosthampton295@gmail.com',
            subject: `New vendor: ${m.businessName} (${m.contactName}) — ${vendorRef}`,
            html: ownerHtml,
          }),
        ])
        console.log('Vendor confirmation sent to', m.contactEmail)
      }

      return NextResponse.json({ received: true })
    }

    // ── Gift card purchase ────────────────────────────────────
    if (m.type === 'gift_card') {
      const amountCents = parseInt(m.amountCents || '0', 10)
      const amountFormatted = `$${(amountCents / 100).toFixed(0)}`

      // Generate unique 12-char code: HH-XXXX-XXXX
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no O/0/I/1
      let codeBody = ''
      for (let i = 0; i < 8; i++) codeBody += chars[Math.floor(Math.random() * chars.length)]
      const code = `HH-${codeBody.slice(0, 4)}-${codeBody.slice(4)}`

      const { error: gcErr } = await supabase.from('gift_cards').insert({
        code,
        amount_cents: amountCents,
        balance_cents: amountCents,
        purchaser_name: m.purchaserName,
        purchaser_email: m.purchaserEmail,
        recipient_name: m.recipientName,
        recipient_email: m.recipientEmail,
        personal_message: m.personalMessage || null,
        stripe_session_id: session.id,
        status: 'active',
      })

      if (gcErr) {
        console.error('Gift card insert error:', gcErr)
      } else {
        console.log('Gift card created:', code, amountFormatted, 'for', m.recipientEmail)

        // Record in financials (non-fatal)
        await recordFinancialTransaction(supabase, {
          date: new Date().toISOString().split('T')[0],
          description: `Gift Card — ${code}`,
          amountCents,
          category: 'Gift Card',
          customerName: m.purchaserName,
          reference: `gc-${code}`,
          notes: `Purchaser: ${m.purchaserEmail} | Recipient: ${m.recipientEmail}`,
        })

        // Upsert purchaser contact (non-fatal)
        await upsertContact({
          name: m.purchaserName,
          email: m.purchaserEmail,
          sourceDetail: `Gift card purchase — ${code}`,
          serviceInterests: ['general'],
          marketingConsent: false,
        }).catch(err => console.error('Gift card contact upsert error (non-fatal):', err))
      }

      // Send emails
      if (process.env.RESEND_API_KEY) {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

        await Promise.allSettled([
          // Recipient gets the gift card
          resend.emails.send({
            from, to: m.recipientEmail,
            subject: `You've received a ${amountFormatted} Host Hampton Gift Card!`,
            html: giftCardHtml({
              recipientName: m.recipientName,
              senderName: m.purchaserName,
              amountFormatted,
              code,
              personalMessage: m.personalMessage || undefined,
            }),
          }),
          // Purchaser gets confirmation
          resend.emails.send({
            from, to: m.purchaserEmail,
            subject: `Gift Card Sent! ${amountFormatted} for ${m.recipientName}`,
            html: giftCardPurchaseConfirmHtml({
              purchaserName: m.purchaserName,
              recipientName: m.recipientName,
              amountFormatted,
              code,
            }),
          }),
          // Owner notification
          resend.emails.send({
            from, to: 'hosthampton295@gmail.com',
            subject: `New gift card: ${m.purchaserName} → ${m.recipientName} (${amountFormatted})`,
            html: giftCardNotifyHtml({
              code,
              amountFormatted,
              purchaserName: m.purchaserName,
              purchaserEmail: m.purchaserEmail,
              recipientName: m.recipientName,
              recipientEmail: m.recipientEmail,
              personalMessage: m.personalMessage || undefined,
              stripePI: session.payment_intent as string,
            }),
          }),
        ])
        console.log('Gift card emails sent:', code)
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
      deposit_amount: m.depositCents ? parseInt(m.depositCents, 10) : 25000,
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

      // Redeem partial gift card if used (non-fatal)
      if (m.giftCardCode && m.giftCardDeductCents) {
        const gcDeduct = parseInt(m.giftCardDeductCents, 10)
        if (gcDeduct > 0) {
          const { data: gc } = await supabase
            .from('gift_cards')
            .select('id, balance_cents')
            .eq('code', m.giftCardCode)
            .eq('status', 'active')
            .single()
          if (gc) {
            const newBal = Math.max(0, gc.balance_cents - gcDeduct)
            await supabase.from('gift_cards').update({
              balance_cents: newBal,
              status: newBal === 0 ? 'redeemed' : 'active',
              redeemed_at: newBal === 0 ? new Date().toISOString() : null,
            }).eq('id', gc.id)
            console.log(`Gift card ${m.giftCardCode} redeemed ${gcDeduct}c for booking ${bookingRef}. New balance: ${newBal}c`)
          }
        }
      }

      // Record in financials (non-fatal)
      const bookingAmountCents = session.amount_total || (m.depositCents ? parseInt(m.depositCents, 10) : 25000)
      await recordFinancialTransaction(supabase, {
        date: new Date().toISOString().split('T')[0],
        description: `${(m.eventType || 'Party').split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} Deposit${m.packageName ? ` — ${m.packageName}` : ''}`,
        amountCents: bookingAmountCents,
        category: m.eventType?.includes('room') ? 'Room Rental' : 'Party Booking',
        customerName: m.contactName,
        reference: `bk-${bookingRef}`,
        notes: m.contactEmail,
      })

      // Upsert contact (non-fatal)
      const contactId = await upsertContact({
        name: m.contactName,
        email: m.contactEmail,
        phone: m.contactPhone,
        sourceDetail: `Booking deposit — ${m.eventType || 'party'}`,
        serviceInterests: [m.bookingTypeSlug || m.eventType || 'general'],
        marketingConsent: m.marketingConsent === 'true',
      })

      // Enroll in post-booking sequence (non-fatal)
      if (contactId) {
        await enrollInSequence({
          contactId,
          contactEmail: m.contactEmail,
          triggerEvent: 'booking_confirmed',
          serviceType: m.bookingTypeSlug || m.eventType || 'general',
          eventDate: partyDate,
          bookingRef,
        }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
      }

      // Enqueue booking reminders (non-fatal)
      if (partyDate) {
        await enqueueBookingReminders({
          contactEmail: m.contactEmail,
          bookingRef,
          partyDate,
        }).catch(err => console.error('Booking reminder enqueue error:', err))

        await enqueueReviewRequest({
          contactEmail: m.contactEmail,
          referenceType: 'booking',
          referenceId: bookingRef,
          eventDate: partyDate,
        }).catch(err => console.error('Review request enqueue error:', err))
      }

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

      const customerHtml = bookingConfirmationHtml({
        customerName: m.contactName,
        bookingRef,
        dateFormatted,
        partyTime: m.partyTime || 'TBD',
        eventTypeDisplay,
        depositFormatted,
        packageName: m.packageName,
        childName: m.childName,
        childAge: m.childAge,
        guestCount: m.guestCount,
        notes: m.notes,
        isRoomRental,
        balanceDueDate,
      })

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
