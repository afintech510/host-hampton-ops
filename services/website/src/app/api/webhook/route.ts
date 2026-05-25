import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { Resend } from 'resend'
import { getSupabase } from '@/lib/supabase'
import { upsertContact } from '@/lib/contacts'
import { ticketConfirmationHtml, ticketPurchaseNotifyHtml, bookingConfirmationHtml, giftCardHtml, giftCardNotifyHtml, giftCardPurchaseConfirmHtml, partyDepositReceivedHtml, partyAdminNewBookingHtml, partyPaymentReceivedHtml } from '@/lib/emailTemplates'
import { calculateCardFee, formatMoney } from '@/lib/partyPricing'
import { generatePortalToken, buildPortalUrl } from '@/lib/portalAuth'
import { createCalendarEvent, addMinutes } from '@/lib/googleCalendar'
import { enqueueEventReminders, enqueueBookingReminders, enqueueReviewRequest, enqueuePartyReminders } from '@/lib/reminders'
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

  // ── Payment Intent succeeded (in-page Payment Element flow) ──
  // This fires for the planner deposit + additional payment flows that were
  // migrated off Checkout Session. Event tickets, gift cards, vendor regs,
  // and pay-links still use Checkout, so we fall through to the Checkout
  // handler below for those.
  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent
    const m = pi.metadata || {}

    if (m.type !== 'party_builder') {
      // Not from the planner — no-op (other event types are handled below)
      return NextResponse.json({ received: true, ignored: 'non-planner PI' })
    }

    const bookingRef = m.booking_ref
    const bookingId = m.booking_id
    const paymentType = (m.payment_type || 'deposit') as 'deposit' | 'partial' | 'final'
    const depositCents = parseInt(m.depositCents || '0', 10)
    const cardFeeCents = parseInt(m.cardFeeCents || '0', 10)
    const tipCents = parseInt(m.tipCents || '0', 10)
    const amountCents = paymentType === 'deposit'
      ? depositCents
      : parseInt(m.amountCents || '0', 10)
    const totalCharged = pi.amount

    // Insert payment record. confirm-session may have already inserted; the
    // unique stripe_payment_intent_id constraint fails silently in that case.
    const { error: payErr } = await supabase.from('booking_payments').insert({
      booking_id: bookingId,
      payment_type: paymentType,
      payment_method: 'card',
      amount_cents: amountCents,
      card_fee_cents: cardFeeCents,
      total_charged_cents: totalCharged,
      stripe_payment_intent_id: pi.id,
      stripe_session_id: null,
      recorded_by: 'system',
      notes: tipCents > 0 ? `Includes ${formatMoney(tipCents)} tip for party helpers` : null,
    })
    const alreadyRecorded = !!payErr && (payErr.message || '').toLowerCase().includes('duplicate')
    if (payErr && !alreadyRecorded) console.error('Party builder PI payment insert error:', payErr)

    // Recalc balance + status from authoritative payment rows
    const { data: payRows } = await supabase
      .from('booking_payments')
      .select('amount_cents, payment_type')
      .eq('booking_id', bookingId)
    let paidSum = 0
    for (const p of payRows || []) {
      if (p.payment_type === 'refund') paidSum -= p.amount_cents
      else paidSum += p.amount_cents
    }
    const { data: bkRow } = await supabase
      .from('bookings')
      .select('total_cents, party_tags, contact_name, contact_email, contact_phone, party_date, party_time, package_type, guest_count_approx')
      .eq('id', bookingId)
      .single()
    const newBal = Math.max(0, (bkRow?.total_cents || 0) - paidSum)
    const existingTags = (bkRow?.party_tags as Record<string, unknown> | null) || {}

    const updateFields: Record<string, unknown> = { balance_due_cents: newBal }
    if (paymentType === 'deposit') {
      updateFields.status = newBal === 0 ? 'paid_in_full' : 'pending_review'
      updateFields.party_tags = { ...existingTags, date_locked: true }
    } else if (newBal === 0) {
      updateFields.status = 'paid_in_full'
    }
    if (newBal === 0) updateFields.paid_in_full_at = new Date().toISOString()
    await supabase.from('bookings').update(updateFields).eq('id', bookingId)

    // Audit log
    await supabase.from('booking_modifications').insert({
      booking_id: bookingId,
      modified_by: 'system',
      change_summary: paymentType === 'deposit'
        ? `Deposit of ${formatMoney(amountCents)} received via card`
        : `${paymentType === 'final' ? 'Final' : 'Partial'} payment of ${formatMoney(amountCents)} via card. Balance: ${formatMoney(newBal)}`,
    }).then((res: { error: { message: string } | null }) => {
      if (res.error) console.error('Modification log error (non-fatal):', res.error)
    })

    // Financials
    await recordFinancialTransaction(supabase, {
      date: new Date().toISOString().split('T')[0],
      description: paymentType === 'deposit'
        ? `Party Deposit — ${bkRow?.package_type || 'Kids Party'}`
        : `Party ${paymentType === 'final' ? 'Final' : 'Partial'} Payment — ${bookingRef}`,
      amountCents: totalCharged,
      category: 'Party Booking',
      customerName: bkRow?.contact_name || m.contactName || null,
      reference: `pb-${bookingRef}-${paymentType}`,
      notes: bkRow?.contact_email || m.contactEmail || null,
    })

    // Portal magic link for the receipt email
    const portalSecret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
    const { token: rawToken, hash, expiresAt } = generatePortalToken(bookingRef, portalSecret)
    await supabase.from('portal_tokens').insert({
      booking_id: bookingId,
      token_hash: hash,
      expires_at: expiresAt.toISOString(),
    }).then((res: { error: { message: string } | null }) => {
      if (res.error) console.error('Portal token insert (non-fatal):', res.error)
    })
    const portalUrl = buildPortalUrl(bookingRef, rawToken, '/party-planner')

    // Emails
    if (process.env.RESEND_API_KEY && bkRow?.contact_email) {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
      const partyDateFormatted = bkRow.party_date
        ? new Date(bkRow.party_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        : 'TBD'

      if (paymentType === 'deposit') {
        // Build line items array for the receipt email
        const { data: liRows } = await supabase
          .from('booking_line_items')
          .select('name, quantity, unit_price_cents, guest_multiplied')
          .eq('booking_id', bookingId)
          .order('sort_order')
        const guestCount = bkRow.guest_count_approx || 10
        const emailLineItems = (liRows || []).map(li => ({
          name: li.name,
          quantity: li.quantity,
          unit_price_cents: li.unit_price_cents,
          guest_multiplied: li.guest_multiplied,
          totalCents: li.guest_multiplied
            ? li.unit_price_cents * li.quantity * guestCount
            : li.unit_price_cents * li.quantity,
        }))

        const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
        const isLocal = (host || '').startsWith('localhost')
        const proto = req.headers.get('x-forwarded-proto') || (isLocal ? 'http' : 'https')
        const origin = host ? `${proto}://${host}` : 'https://www.hosthampton.com'

        await Promise.allSettled([
          resend.emails.send({
            from, to: bkRow.contact_email,
            subject: `Deposit Received — ${bookingRef} | Host Hampton`,
            html: partyDepositReceivedHtml({
              customerName: bkRow.contact_name || 'there',
              bookingRef,
              depositFormatted: formatMoney(amountCents),
              partyDate: partyDateFormatted,
              portalUrl,
              lineItems: emailLineItems,
              totalFormatted: formatMoney(bkRow.total_cents || 0),
            }),
          }),
          resend.emails.send({
            from, to: 'hosthampton295@gmail.com',
            subject: `Deposit paid: ${bkRow.contact_name} — ${bookingRef}`,
            html: partyAdminNewBookingHtml({
              bookingRef,
              customerName: bkRow.contact_name || '',
              customerEmail: bkRow.contact_email,
              customerPhone: bkRow.contact_phone || undefined,
              partyDate: partyDateFormatted,
              partyTime: bkRow.party_time || 'TBD',
              guestCount,
              packageType: bkRow.package_type || 'Kids Party',
              depositFormatted: formatMoney(amountCents),
              totalFormatted: formatMoney(bkRow.total_cents || 0),
              paymentMethod: 'card',
              lineItems: emailLineItems,
              adminUrl: `${origin}/admin?tab=parties&ref=${bookingRef}`,
            }),
          }),
        ])
      } else {
        await resend.emails.send({
          from, to: bkRow.contact_email,
          subject: `Payment Received — ${bookingRef}`,
          html: partyPaymentReceivedHtml({
            customerName: bkRow.contact_name || 'there',
            bookingRef,
            amountFormatted: formatMoney(amountCents),
            paymentMethod: 'card',
            newBalanceFormatted: formatMoney(newBal),
            portalUrl,
          }),
        }).catch(err => console.error('Party payment receipt email error:', err))
      }
    }

    // Enqueue party balance reminders on first deposit
    if (paymentType === 'deposit' && bkRow?.party_date && bkRow.contact_email) {
      await enqueuePartyReminders({ contactEmail: bkRow.contact_email, bookingRef, partyDate: bkRow.party_date })
        .catch(err => console.error('Party reminder enqueue error:', err))
    }

    void alreadyRecorded
    console.log('Party builder PI processed:', bookingRef, paymentType, formatMoney(amountCents))
    return NextResponse.json({ received: true })
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
        const totalFormatted = `$${(totalCents / 100).toFixed(2)}`

        // If this ticket is for a specific session, use the session date/time
        let dateDisplay = evt.event_date
          ? new Date(evt.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
          : 'TBD'
        let timeDisplay = evt.event_time || ''

        if (m.sessionId) {
          const { data: sess } = await supabase
            .from('event_sessions')
            .select('session_date, session_time, label')
            .eq('id', m.sessionId)
            .single()
          if (sess?.session_date) {
            dateDisplay = new Date(sess.session_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
            if (sess.label) dateDisplay += ` — ${sess.label}`
          }
          if (sess?.session_time) timeDisplay = sess.session_time
        }

        await Promise.allSettled([
          resend.emails.send({
            from, to: m.customerEmail,
            subject: `You're in! ${evt.title} at Host Hampton 🎉`,
            html: ticketConfirmationHtml({
              customerName: m.customerName, eventTitle: evt.title, eventDate: dateDisplay,
              eventTime: timeDisplay, location: evt.location, quantity: qty,
              variantLabel: m.variantLabel || undefined, totalFormatted, ticketRef, isFree: false,
            }),
          }),
          resend.emails.send({
            from, to: 'hosthampton295@gmail.com',
            subject: `New ticket: ${m.customerName} — ${evt.title} (${ticketRef})`,
            html: ticketPurchaseNotifyHtml({
              ticketRef, customerName: m.customerName, customerEmail: m.customerEmail,
              customerPhone: m.customerPhone || undefined, eventTitle: evt.title,
              eventDate: dateDisplay, eventTime: timeDisplay, quantity: qty,
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

        // Build structured sessions array for email templates
        const emailSessions = (sessionsData || []).map(s => ({
          date: new Date(s.session_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
          time: s.session_time || '',
          label: s.label || undefined,
        }))

        await Promise.allSettled([
          resend.emails.send({
            from, to: m.customerEmail,
            subject: `You're in! ${evt.title} at Host Hampton`,
            html: ticketConfirmationHtml({
              customerName: m.customerName, eventTitle: evt.title,
              eventDate: `${sessionIds.length} sessions`,
              eventTime: '',
              location: evt.location, quantity: qty,
              variantLabel: m.variantLabel || undefined,
              totalFormatted, ticketRef: groupRef, isFree: false,
              sessions: emailSessions,
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
              eventTime: '', quantity: qty,
              variantLabel: m.variantLabel || undefined,
              totalFormatted, isFree: false,
              stripePI: session.payment_intent as string,
              sessions: emailSessions,
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

        // Calculate actual total ticket quantity (sum of qty per cart item)
        const totalQty = cartItems.reduce((sum, ci) => sum + ci.quantity, 0)

        // Build structured sessions for each cart item (fetch session dates)
        const emailSessions: { date: string; time: string; label?: string }[] = []
        let cartEventDate = ''

        for (const ci of cartItems) {
          if (ci.sessionIds?.length) {
            const { data: sessData } = await supabase
              .from('event_sessions')
              .select('session_date, session_time, label')
              .in('id', ci.sessionIds)
              .order('session_date', { ascending: true })
            for (const s of (sessData || [])) {
              emailSessions.push({
                date: new Date(s.session_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
                time: s.session_time || '',
                label: s.label || undefined,
              })
            }
          } else if (ci.sessionId) {
            const { data: sess } = await supabase
              .from('event_sessions')
              .select('session_date, session_time, label')
              .eq('id', ci.sessionId)
              .single()
            if (sess) {
              emailSessions.push({
                date: new Date(sess.session_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
                time: sess.session_time || '',
                label: sess.label || undefined,
              })
            }
          } else {
            // No session — use event date
            const { data: ciEvt } = await supabase
              .from('events')
              .select('event_date, event_time')
              .eq('id', ci.eventId)
              .single()
            if (ciEvt?.event_date) {
              cartEventDate = new Date(ciEvt.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
            }
          }
        }

        // Determine date display
        const hasMultipleSessions = emailSessions.length > 1
        const dateDisplay = hasMultipleSessions
          ? `${emailSessions.length} sessions`
          : emailSessions.length === 1
            ? emailSessions[0].date
            : cartEventDate || 'TBD'
        const timeDisplay = emailSessions.length === 1 ? emailSessions[0].time : ''

        await Promise.allSettled([
          resend.emails.send({
            from, to: m.customerEmail,
            subject: `You're in! ${eventTitles.length} event${eventTitles.length > 1 ? 's' : ''} at Host Hampton`,
            html: ticketConfirmationHtml({
              customerName: m.customerName,
              eventTitle: eventTitles.join(' + '),
              eventDate: dateDisplay,
              eventTime: timeDisplay,
              location: 'Host Hampton',
              quantity: totalQty,
              totalFormatted,
              ticketRef: cartRef,
              isFree: false,
              sessions: hasMultipleSessions ? emailSessions : undefined,
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
              eventDate: dateDisplay,
              eventTime: timeDisplay,
              quantity: totalQty,
              totalFormatted,
              isFree: false,
              stripePI: session.payment_intent as string,
              sessions: hasMultipleSessions ? emailSessions : undefined,
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

    // ── Party builder deposit / payment ─────────────────────
    if (m.type === 'party_builder') {
      const bookingRef = m.booking_ref
      const bookingId = m.booking_id
      const paymentType = m.payment_type || 'deposit'
      const depositCents = parseInt(m.depositCents || '0', 10)
      const cardFeeCents = parseInt(m.cardFeeCents || '0', 10)
      const totalCharged = session.amount_total || 0

      if (paymentType === 'deposit') {
        // Insert payment record first. If confirm-session already inserted (UI
        // returned from Stripe before the webhook fired), the unique
        // stripe_session_id constraint fails — that's fine, we still send the
        // confirmation email below since confirm-session no longer does.
        const { error: payErr } = await supabase.from('booking_payments').insert({
          booking_id: bookingId,
          payment_type: 'deposit',
          payment_method: 'card',
          amount_cents: depositCents,
          card_fee_cents: cardFeeCents,
          total_charged_cents: totalCharged,
          stripe_payment_intent_id: session.payment_intent as string,
          stripe_session_id: session.id,
          recorded_by: 'system',
        })
        const alreadyRecorded = !!payErr && (payErr.message || '').toLowerCase().includes('duplicate')
        if (payErr && !alreadyRecorded) console.error('Party builder payment insert error:', payErr)

        // Recalculate balance from all payments + lock the date.
        // Idempotent: if confirm-session already set these to the same values,
        // this is a no-op write.
        const { data: payRows } = await supabase
          .from('booking_payments')
          .select('amount_cents, payment_type')
          .eq('booking_id', bookingId)
        let paidSum = 0
        for (const p of payRows || []) {
          if (p.payment_type === 'refund') paidSum -= p.amount_cents
          else paidSum += p.amount_cents
        }
        const { data: bkRow } = await supabase
          .from('bookings')
          .select('total_cents, party_tags')
          .eq('id', bookingId)
          .single()
        const newBal = Math.max(0, (bkRow?.total_cents || 0) - paidSum)
        const existingTags = (bkRow?.party_tags as Record<string, unknown> | null) || {}
        const { error: updateErr } = await supabase
          .from('bookings')
          .update({
            status: newBal === 0 ? 'paid_in_full' : 'pending_review',
            balance_due_cents: newBal,
            party_tags: { ...existingTags, date_locked: true },
            ...(newBal === 0 ? { paid_in_full_at: new Date().toISOString() } : {}),
          })
          .eq('id', bookingId)
        if (updateErr) console.error('Party builder booking update error:', updateErr)

        // If the payment was already recorded (confirm-session won the race),
        // the audit log + financials + reminders were skipped previously and
        // need to fire now (this is where webhook does its side-effects work).
        // The duplicate-suppression below relies on each side-effect being
        // either idempotent or naturally deduplicated.
        if (alreadyRecorded) {
          console.log('Party builder deposit: confirm-session won race for', bookingRef, '— webhook sending side-effects + email')
        }

        // Insert audit log
        await supabase.from('booking_modifications').insert({
          booking_id: bookingId,
          modified_by: 'system',
          change_summary: `Deposit of ${formatMoney(depositCents)} received via card`,
        }).then(({ error }) => {
          if (error) console.error('Modification log error (non-fatal):', error)
        })

        // Record in financials
        await recordFinancialTransaction(supabase, {
          date: new Date().toISOString().split('T')[0],
          description: `Party Deposit — ${m.packageType || 'Kids Party'}`,
          amountCents: totalCharged,
          category: 'Party Booking',
          customerName: m.contactName,
          reference: `pb-${bookingRef}`,
          notes: m.contactEmail,
        })

        // Generate portal link
        const portalSecret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
        const { token: rawToken, hash, expiresAt } = generatePortalToken(bookingRef, portalSecret)
        await supabase.from('portal_tokens').insert({
          booking_id: bookingId,
          token_hash: hash,
          expires_at: expiresAt.toISOString(),
        }).then(({ error }) => {
          if (error) console.error('Portal token insert error (non-fatal):', error)
        })

        const portalUrl = buildPortalUrl(bookingRef, rawToken)
        const host = req.headers.get('x-forwarded-host') || req.headers.get('host')

        // Fetch line items for email
        const { data: liRows } = await supabase
          .from('booking_line_items')
          .select('name, quantity, unit_price_cents, guest_multiplied')
          .eq('booking_id', bookingId)
          .order('sort_order')

        const guestCount = parseInt(m.guestCount || '10', 10)
        const emailLineItems = (liRows || []).map(li => ({
          name: li.name,
          quantity: li.quantity,
          unit_price_cents: li.unit_price_cents,
          guest_multiplied: li.guest_multiplied,
          totalCents: li.guest_multiplied
            ? li.unit_price_cents * li.quantity * guestCount
            : li.unit_price_cents * li.quantity,
        }))

        // Fetch booking total
        const { data: bk } = await supabase
          .from('bookings')
          .select('total_cents')
          .eq('id', bookingId)
          .single()

        // Send emails
        if (process.env.RESEND_API_KEY) {
          const resend = new Resend(process.env.RESEND_API_KEY)
          const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

          const partyDateFormatted = m.partyDate
            ? new Date(m.partyDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
            : 'TBD'

          await Promise.allSettled([
            resend.emails.send({
              from,
              to: m.contactEmail,
              subject: `Deposit Received — ${bookingRef}`,
              html: partyDepositReceivedHtml({
                customerName: m.contactName,
                bookingRef,
                depositFormatted: formatMoney(depositCents),
                partyDate: partyDateFormatted,
                portalUrl,
                lineItems: emailLineItems,
                totalFormatted: formatMoney(bk?.total_cents || 0),
              }),
            }),
            resend.emails.send({
              from,
              to: 'hosthampton295@gmail.com',
              subject: `New party booking: ${m.contactName} — ${bookingRef}`,
              html: partyAdminNewBookingHtml({
                bookingRef,
                customerName: m.contactName,
                customerEmail: m.contactEmail,
                customerPhone: m.contactPhone || undefined,
                partyDate: partyDateFormatted,
                partyTime: m.partyTime || 'TBD',
                guestCount,
                packageType: m.packageType || 'Kids Party',
                depositFormatted: formatMoney(depositCents),
                totalFormatted: formatMoney(bk?.total_cents || 0),
                paymentMethod: 'card',
                lineItems: emailLineItems,
                adminUrl: `https://${host}/admin?tab=parties&ref=${bookingRef}`,
              }),
            }),
          ])
          console.log('Party deposit emails sent for', bookingRef)
        }

        // Enqueue party balance reminders (non-fatal)
        if (m.partyDate) {
          await enqueuePartyReminders({ contactEmail: m.contactEmail, bookingRef, partyDate: m.partyDate })
            .catch(err => console.error('Party reminder enqueue error:', err))
        }

        console.log('Party builder deposit processed:', bookingRef, formatMoney(depositCents))
      } else {
        // Subsequent payment (partial or final)
        const amountCents = parseInt(m.amountCents || '0', 10)
        const pCardFee = parseInt(m.cardFeeCents || '0', 10)

        await supabase.from('booking_payments').insert({
          booking_id: bookingId,
          payment_type: paymentType,
          payment_method: 'card',
          amount_cents: amountCents,
          card_fee_cents: pCardFee,
          total_charged_cents: totalCharged,
          stripe_payment_intent_id: session.payment_intent as string,
          stripe_session_id: session.id,
          recorded_by: 'system',
        }).then(({ error }) => {
          if (error) console.error('Party payment insert error:', error)
        })

        // Recalculate balance
        const { data: payments } = await supabase
          .from('booking_payments')
          .select('amount_cents, payment_type')
          .eq('booking_id', bookingId)

        const { data: bk } = await supabase
          .from('bookings')
          .select('total_cents')
          .eq('id', bookingId)
          .single()

        let paid = 0
        for (const p of (payments || [])) {
          if (p.payment_type === 'refund') paid -= p.amount_cents
          else paid += p.amount_cents
        }
        const newBalance = Math.max(0, (bk?.total_cents || 0) - paid)

        const updateFields: Record<string, unknown> = { balance_due_cents: newBalance }
        if (newBalance === 0) {
          updateFields.paid_in_full_at = new Date().toISOString()
          updateFields.status = 'paid_in_full'
        }

        await supabase.from('bookings').update(updateFields).eq('id', bookingId)

        await supabase.from('booking_modifications').insert({
          booking_id: bookingId,
          modified_by: 'system',
          change_summary: `Payment of ${formatMoney(amountCents)} received via card. Balance: ${formatMoney(newBalance)}`,
        }).then(({ error }) => {
          if (error) console.error('Modification log error (non-fatal):', error)
        })

        await recordFinancialTransaction(supabase, {
          date: new Date().toISOString().split('T')[0],
          description: `Party ${paymentType === 'final' ? 'Final' : 'Partial'} Payment — ${bookingRef}`,
          amountCents: totalCharged,
          category: 'Party Booking',
          customerName: m.contactName || null,
          reference: `pb-${bookingRef}-${paymentType}`,
          notes: m.contactEmail || null,
        })

        // Send payment receipt to customer (confirm-session no longer sends emails)
        if (process.env.RESEND_API_KEY && m.contactEmail) {
          const portalSecret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
          const { token: rawToken, hash, expiresAt } = generatePortalToken(bookingRef, portalSecret)
          await supabase.from('portal_tokens').insert({
            booking_id: bookingId,
            token_hash: hash,
            expires_at: expiresAt.toISOString(),
          }).then(({ error }) => {
            if (error) console.error('Portal token insert (non-fatal):', error)
          })
          const portalUrl = buildPortalUrl(bookingRef, rawToken, '/party-planner')

          const resend = new Resend(process.env.RESEND_API_KEY)
          const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
          await resend.emails.send({
            from,
            to: m.contactEmail,
            subject: `Payment Received — ${bookingRef}`,
            html: partyPaymentReceivedHtml({
              customerName: m.contactName || 'there',
              bookingRef,
              amountFormatted: formatMoney(amountCents),
              paymentMethod: 'card',
              newBalanceFormatted: formatMoney(newBalance),
              portalUrl,
            }),
          }).catch(err => console.error('Party payment receipt email error:', err))
        }

        console.log('Party builder payment processed:', bookingRef, paymentType, formatMoney(amountCents), 'balance:', formatMoney(newBalance))
      }

      return NextResponse.json({ received: true })
    }

    // ── Pay link (admin-generated) ──────────────────────────
    if (m.type === 'pay_link') {
      const amountCents = parseInt(m.amountCents || '0', 10)

      // Record in financials
      await recordFinancialTransaction(supabase, {
        date: new Date().toISOString().split('T')[0],
        description: m.description || 'Pay Link Payment',
        amountCents,
        category: m.category || 'Room Rental',
        customerName: m.customerName || null,
        reference: `pl-${session.payment_intent}`,
        notes: m.customerEmail || null,
      })

      // Upsert contact (non-fatal)
      if (m.customerEmail) {
        await upsertContact({
          name: m.customerName || 'Unknown',
          email: m.customerEmail,
          phone: m.customerPhone || undefined,
          sourceDetail: `Pay link — ${m.description || 'payment'}`,
          serviceInterests: ['general'],
          marketingConsent: false,
        }).catch(err => console.error('Pay link contact upsert error (non-fatal):', err))
      }

      console.log('Pay link completed:', m.customerName, `$${(amountCents / 100).toFixed(2)}`, m.description)
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
