import { ownerEmail } from '@/lib/ownerNotify'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabase } from '@/lib/supabase'
import { upsertContact } from '@/lib/contacts'
import { Resend } from 'resend'
import { ticketConfirmationHtml, ticketPurchaseNotifyHtml } from '@/lib/emailTemplates'
import { enqueueEventReminders } from '@/lib/reminders'
import { enrollInSequence } from '@/lib/sequences'
import { saleAdjustedCents } from '@/lib/sale'
import { publicOrigin } from '@/lib/publicOrigin'

export const dynamic = 'force-dynamic'

const TAX_RATE = 0.0875
const CC_RATE = 0.03

export async function POST(req: NextRequest) {
  const supabase = getSupabase()
  const body = await req.json()
  const { eventId, sessionId, sessionIds, quantity, variantLabel, customerName, customerEmail, customerPhone, marketingConsent, giftCardCode } = body

  if (!eventId || !customerName || !customerEmail || !customerPhone || !quantity) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Fetch event
  const { data: event, error: eventErr } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .single()

  if (eventErr || !event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  }

  // ── Multi-session checkout (series events) ──────────────
  if (sessionIds && Array.isArray(sessionIds) && sessionIds.length > 0) {
    const { data: sessionsData } = await supabase
      .from('event_sessions')
      .select('*')
      .in('id', sessionIds)
      .eq('is_active', true)

    if (!sessionsData || sessionsData.length !== sessionIds.length) {
      return NextResponse.json({ error: 'One or more sessions not found' }, { status: 404 })
    }

    // Check availability for each session
    for (const sess of sessionsData) {
      if (sess.available_tickets < quantity) {
        return NextResponse.json({
          error: `Not enough tickets for session on ${sess.session_date}`,
        }, { status: 400 })
      }
    }

    // Calculate bundle pricing, then take any active flash-sale discount off the per-session rate
    let multiUnitPrice = event.price_cents
    if (event.allow_multi_session && event.bundle_pricing?.length > 0) {
      const sorted = [...event.bundle_pricing].sort((a: any, b: any) => b.minSessions - a.minSessions)
      const tier = sorted.find((t: any) => sessionIds.length >= t.minSessions)
      if (tier) multiUnitPrice = tier.pricePerSessionCents
    }
    multiUnitPrice = saleAdjustedCents(multiUnitPrice, event)

    const multiTotalCents = multiUnitPrice * sessionIds.length * quantity
    const multiIsFree = multiUnitPrice === 0

    if (multiIsFree) {
      // Free multi-session: create tickets directly
      const groupRef = `GRP-${Date.now()}`
      const ticketRefs: string[] = []

      for (const sess of sessionsData) {
        const { data: seqData } = await supabase.rpc('nextval_event_ticket_seq')
        const seqNum = seqData ?? Date.now().toString().slice(-4)
        const ticketRef = `HH-EVT-${String(seqNum).padStart(4, '0')}`
        ticketRefs.push(ticketRef)

        await supabase.from('event_tickets').insert({
          ticket_ref: ticketRef,
          event_id: eventId,
          session_id: sess.id,
          group_ref: groupRef,
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone || null,
          quantity,
          variant_label: variantLabel || null,
          unit_price_cents: 0,
          total_cents: 0,
          status: 'confirmed',
        })
        await supabase.rpc('decrement_session_tickets', { sid: sess.id, qty: quantity })
      }

      // Upsert contact (non-fatal)
      const contactId = await upsertContact({
        name: customerName,
        email: customerEmail,
        phone: customerPhone,
        sourceDetail: `Event RSVP — ${event.title} (series)`,
        serviceInterests: ['event'],
        marketingConsent: !!marketingConsent,
      })

      // Enroll in post-booking sequence (non-fatal)
      if (contactId) {
        await enrollInSequence({
          contactId,
          contactEmail: customerEmail,
          triggerEvent: 'booking_confirmed',
          serviceType: 'event',
        }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
      }

      // Enqueue reminders for each session (non-fatal)
      for (const sess of sessionsData) {
        if (sess.session_date) {
          await enqueueEventReminders({
            contactEmail: customerEmail,
            eventId,
            eventDate: sess.session_date,
          }).catch(err => console.error('Reminder enqueue error:', err))
        }
      }

      // Send confirmation emails
      if (process.env.RESEND_API_KEY) {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
        const sessionDates = sessionsData
          .sort((a: any, b: any) => a.session_date.localeCompare(b.session_date))
          .map((s: any) => {
            const d = new Date(s.session_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
            return `${d} at ${s.session_time}${s.label ? ` — ${s.label}` : ''}`
          }).join(', ')

        await Promise.allSettled([
          resend.emails.send({
            from, to: customerEmail,
            subject: `You're in! ${event.title} at Host Hampton`,
            html: ticketConfirmationHtml({
              customerName, eventTitle: event.title,
              eventDate: `${sessionsData.length} sessions`,
              eventTime: sessionDates,
              location: event.location,
              quantity, totalFormatted: 'Free',
              ticketRef: groupRef, isFree: true,
            }),
          }),
          resend.emails.send({
            from, to: ownerEmail(),
            subject: `New RSVP: ${customerName} — ${event.title} (${sessionsData.length} sessions)`,
            html: ticketPurchaseNotifyHtml({
              ticketRef: groupRef, customerName, customerEmail, customerPhone,
              eventTitle: event.title,
              eventDate: `${sessionsData.length} sessions`,
              eventTime: sessionDates,
              quantity, totalFormatted: 'Free', isFree: true,
            }),
          }),
        ])
      }

      return NextResponse.json({ url: `/events/success?ref=${groupRef}` })
    }

    // Paid multi-session: create Stripe checkout
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
    const origin = publicOrigin(req)

    const multiTaxCents = Math.round(multiTotalCents * TAX_RATE)
    const multiCcFeeCents = Math.round((multiTotalCents + multiTaxCents) * CC_RATE)

    // Build session dates description
    const multiSessionDates = sessionsData
      .sort((a: any, b: any) => a.session_date.localeCompare(b.session_date))
      .map((s: any) => {
        const d = new Date(s.session_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        return `${d} at ${s.session_time}`
      }).join(', ')

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: customerEmail,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${event.title} (${sessionIds.length} sessions)`,
              description: `${multiSessionDates} | ${event.location || 'Host Hampton'}`,
            },
            unit_amount: multiTotalCents,
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'Sales Tax (8.75%)' },
            unit_amount: multiTaxCents,
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'Processing Fee (3%)' },
            unit_amount: multiCcFeeCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        type: 'event_ticket_multi',
        eventId,
        sessionIds: JSON.stringify(sessionIds),
        quantity: String(quantity),
        unitPriceCents: String(multiUnitPrice),
        variantLabel: variantLabel || '',
        customerName,
        customerEmail,
        customerPhone: customerPhone || '',
        eventTitle: event.title,
        eventDates: multiSessionDates,
        eventLocation: event.location || 'Host Hampton',
        marketingConsent: marketingConsent ? 'true' : 'false',
      },
      success_url: `${origin}/events/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/events/${event.slug}?cancelled=true`,
    })

    return NextResponse.json({ url: session.url })
  }

  // ── Single-session / non-session checkout ──────────────
  // Determine unit price (base, variant, or session), then apply any flash-sale discount
  let unitPriceCents = event.price_cents
  if (variantLabel && event.has_variants && event.variants) {
    const variant = event.variants.find((v: any) => v.label === variantLabel)
    if (variant) unitPriceCents = variant.priceCents
  }

  // If session, check session availability and optional price override
  let sessionRow = null
  if (sessionId) {
    const { data: sess } = await supabase
      .from('event_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()
    if (!sess) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    if (sess.available_tickets < quantity) {
      return NextResponse.json({ error: 'Not enough tickets available for this session' }, { status: 400 })
    }
    if (sess.price_cents != null) unitPriceCents = sess.price_cents
    sessionRow = sess
  } else {
    // Check event-level availability
    if (event.available_tickets < quantity) {
      return NextResponse.json({ error: 'Not enough tickets available' }, { status: 400 })
    }
  }

  // Apply any active flash-sale discount to the resolved unit price
  unitPriceCents = saleAdjustedCents(unitPriceCents, event)

  const totalCents = unitPriceCents * quantity
  const isFree = unitPriceCents === 0

  // For FREE events: skip Stripe, create ticket directly
  if (isFree) {
    const { data: seqData } = await supabase.rpc('nextval_event_ticket_seq')
    const seqNum = seqData ?? Date.now().toString().slice(-4)
    const ticketRef = `HH-EVT-${String(seqNum).padStart(4, '0')}`

    const { error: insertErr } = await supabase.from('event_tickets').insert({
      ticket_ref: ticketRef,
      event_id: eventId,
      session_id: sessionId || null,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone || null,
      quantity,
      variant_label: variantLabel || null,
      unit_price_cents: 0,
      total_cents: 0,
      status: 'confirmed',
    })

    if (insertErr) {
      console.error('Free ticket insert error:', insertErr)
      return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 })
    }

    // Decrement available tickets
    if (sessionId) {
      await supabase.rpc('decrement_session_tickets', { sid: sessionId, qty: quantity })
    } else {
      await supabase.rpc('decrement_event_tickets', { eid: eventId, qty: quantity })
    }

    // Upsert contact (non-fatal)
    const contactId = await upsertContact({
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
      sourceDetail: `Event RSVP — ${event.title}`,
      serviceInterests: ['event'],
      marketingConsent: !!marketingConsent,
    })

    // Enroll in post-booking sequence (non-fatal)
    if (contactId) {
      await enrollInSequence({
        contactId,
        contactEmail: customerEmail,
        triggerEvent: 'booking_confirmed',
        serviceType: 'event',
      }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
    }

    // Enqueue reminders (non-fatal)
    const reminderDate = sessionRow?.session_date || event.event_date
    if (reminderDate) {
      await enqueueEventReminders({
        contactEmail: customerEmail,
        eventId,
        eventDate: reminderDate,
      }).catch(err => console.error('Reminder enqueue error:', err))
    }

    // Send emails
    const dateDisplay = sessionRow?.session_date
      ? new Date(sessionRow.session_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : event.event_date
        ? new Date(event.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        : 'TBD'

    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
      await Promise.allSettled([
        resend.emails.send({
          from, to: customerEmail,
          subject: `You're in! ${event.title} at Host Hampton`,
          html: ticketConfirmationHtml({
            customerName, eventTitle: event.title, eventDate: dateDisplay,
            eventTime: sessionRow?.session_time || event.event_time || '', location: event.location,
            quantity, variantLabel, totalFormatted: 'Free', ticketRef, isFree: true,
          }),
        }),
        resend.emails.send({
          from, to: ownerEmail(),
          subject: `New RSVP: ${customerName} — ${event.title} (${ticketRef})`,
          html: ticketPurchaseNotifyHtml({
            ticketRef, customerName, customerEmail, customerPhone,
            eventTitle: event.title, eventDate: dateDisplay,
            eventTime: sessionRow?.session_time || event.event_time || '',
            quantity, variantLabel, totalFormatted: 'Free', isFree: true,
          }),
        }),
      ])
      console.log('Free RSVP confirmed:', ticketRef, customerEmail)
    }

    return NextResponse.json({ url: `/events/success?ref=${ticketRef}` })
  }

  // PAID events: check for gift card coverage
  const origin = publicOrigin(req)

  // Tax + CC fee
  const taxCents = Math.round(totalCents * TAX_RATE)
  const ccFeeCents = Math.round((totalCents + taxCents) * CC_RATE)
  const grandTotalCents = totalCents + taxCents + ccFeeCents

  // Event date/time for description
  const eventDateDisplay = sessionRow?.session_date
    ? new Date(sessionRow.session_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    : event.event_date
      ? new Date(event.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      : 'Date TBD'
  const eventTimeDisplay = sessionRow?.session_time || event.event_time || ''
  const eventLocation = event.location || 'Host Hampton'

  // ── Gift card: validate and check if it covers the full amount ──
  let giftCard: { id: string; code: string; balance_cents: number } | null = null
  if (giftCardCode) {
    const { data: gc } = await supabase
      .from('gift_cards')
      .select('id, code, balance_cents, status')
      .eq('code', giftCardCode.trim().toUpperCase())
      .eq('status', 'active')
      .single()
    if (gc && gc.balance_cents > 0) giftCard = gc
  }

  const giftCardCoversCents = giftCard ? Math.min(giftCard.balance_cents, grandTotalCents) : 0
  const remainingAfterGiftCard = grandTotalCents - giftCardCoversCents

  // If gift card covers full amount, skip Stripe
  if (giftCard && remainingAfterGiftCard <= 0) {
    const { data: seqData } = await supabase.rpc('nextval_event_ticket_seq')
    const seqNum = seqData ?? Date.now().toString().slice(-4)
    const ticketRef = `HH-EVT-${String(seqNum).padStart(4, '0')}`

    const { error: insertErr } = await supabase.from('event_tickets').insert({
      ticket_ref: ticketRef,
      event_id: eventId,
      session_id: sessionId || null,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone || null,
      quantity,
      variant_label: variantLabel || null,
      unit_price_cents: unitPriceCents,
      total_cents: grandTotalCents,
      status: 'confirmed',
    })

    if (insertErr) {
      console.error('Gift card ticket insert error:', insertErr)
      return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 })
    }

    // Decrement tickets
    if (sessionId) {
      await supabase.rpc('decrement_session_tickets', { sid: sessionId, qty: quantity })
    } else {
      await supabase.rpc('decrement_event_tickets', { eid: eventId, qty: quantity })
    }

    // Redeem gift card
    const newBalance = giftCard.balance_cents - grandTotalCents
    await supabase.from('gift_cards').update({
      balance_cents: Math.max(0, newBalance),
      status: newBalance <= 0 ? 'redeemed' : 'active',
      redeemed_at: newBalance <= 0 ? new Date().toISOString() : null,
    }).eq('id', giftCard.id)
    console.log(`Gift card ${giftCard.code} redeemed ${grandTotalCents}c for ticket ${ticketRef}`)

    // Upsert contact (non-fatal)
    const contactId = await upsertContact({
      name: customerName, email: customerEmail, phone: customerPhone,
      sourceDetail: `Event ticket (gift card) — ${event.title}`,
      serviceInterests: ['event'], marketingConsent: !!marketingConsent,
    })
    if (contactId) {
      await enrollInSequence({ contactId, contactEmail: customerEmail, triggerEvent: 'booking_confirmed', serviceType: 'event' })
        .catch(err => console.error('Sequence enrollment error (non-fatal):', err))
    }

    // Enqueue reminders
    const reminderDate = sessionRow?.session_date || event.event_date
    if (reminderDate) {
      await enqueueEventReminders({ contactEmail: customerEmail, eventId, eventDate: reminderDate })
        .catch(err => console.error('Reminder enqueue error:', err))
    }

    // Send confirmation emails
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
      const totalFormatted = `$${(grandTotalCents / 100).toFixed(2)} (Gift Card)`
      await Promise.allSettled([
        resend.emails.send({
          from, to: customerEmail,
          subject: `You're in! ${event.title} at Host Hampton`,
          html: ticketConfirmationHtml({
            customerName, eventTitle: event.title, eventDate: eventDateDisplay,
            eventTime: eventTimeDisplay, location: eventLocation,
            quantity, variantLabel, totalFormatted, ticketRef, isFree: false,
          }),
        }),
        resend.emails.send({
          from, to: ownerEmail(),
          subject: `New ticket (gift card): ${customerName} — ${event.title} (${ticketRef})`,
          html: ticketPurchaseNotifyHtml({
            ticketRef, customerName, customerEmail, customerPhone,
            eventTitle: event.title, eventDate: eventDateDisplay, eventTime: eventTimeDisplay,
            quantity, variantLabel, totalFormatted, isFree: false,
          }),
        }),
      ])
    }

    return NextResponse.json({ url: `/events/success?ref=${ticketRef}` })
  }

  // ── Partial gift card or no gift card: create Stripe session ──
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })

  const lineItems: any[] = [
    {
      price_data: {
        currency: 'usd',
        product_data: {
          name: `${event.title}${variantLabel ? ` (${variantLabel})` : ''}`,
          description: `${eventDateDisplay}${eventTimeDisplay ? ` at ${eventTimeDisplay}` : ''} | ${eventLocation}`,
        },
        unit_amount: unitPriceCents,
      },
      quantity,
    },
    {
      price_data: {
        currency: 'usd',
        product_data: { name: 'Sales Tax (8.75%)' },
        unit_amount: taxCents,
      },
      quantity: 1,
    },
    {
      price_data: {
        currency: 'usd',
        product_data: { name: 'Processing Fee (3%)' },
        unit_amount: ccFeeCents,
      },
      quantity: 1,
    },
  ]

  // If partial gift card, add a discount line item
  if (giftCard && giftCardCoversCents > 0) {
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: { name: `Gift Card (${giftCard.code})` },
        unit_amount: -giftCardCoversCents,
      },
      quantity: 1,
    })
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: customerEmail,
    line_items: lineItems,
    metadata: {
      type: 'event_ticket',
      eventId,
      sessionId: sessionId || '',
      quantity: String(quantity),
      variantLabel: variantLabel || '',
      customerName,
      customerEmail,
      customerPhone: customerPhone || '',
      eventTitle: event.title,
      eventDate: eventDateDisplay,
      eventTime: eventTimeDisplay,
      eventLocation,
      marketingConsent: marketingConsent ? 'true' : 'false',
      giftCardCode: giftCard?.code || '',
      giftCardDeductCents: giftCard ? String(giftCardCoversCents) : '',
    },
    success_url: `${origin}/events/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/events/${event.slug}?cancelled=true`,
  })

  return NextResponse.json({ url: session.url })
}
