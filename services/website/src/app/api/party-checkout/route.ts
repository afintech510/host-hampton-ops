import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabase } from '@/lib/supabase'
import { upsertContact } from '@/lib/contacts'
import { enrollInSequence } from '@/lib/sequences'
import { calculateCardFee, calculateLineItemTotal, computeCutoffDates, generatePartyRef, formatMoney, getDepositCents } from '@/lib/partyPricing'
import { generatePortalToken, buildPortalUrl } from '@/lib/portalAuth'
import { partyPaymentInstructionsHtml, partyAdminNewBookingHtml } from '@/lib/emailTemplates'
import type { BookingLineItem } from '@/types/booking-flow'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Support both flat fields (contactName) and nested contact object ({ contact: { fullName } })
    const contactObj = body.contact as { fullName?: string; email?: string; phone?: string; childName?: string } | undefined
    const lineItems = body.lineItems as BookingLineItem[]
    const contactName = body.contactName || contactObj?.fullName || ''
    const contactEmail = body.contactEmail || contactObj?.email || ''
    const contactPhone = body.contactPhone || contactObj?.phone || ''
    const childName = body.childName || contactObj?.childName || ''
    const childAge = body.childAge || ''
    const guestCount = body.guestCount as number
    const partyDate = body.partyDate as string
    const partyTime = body.partyTime as string
    const packageType = body.packageType as string
    const paymentMethod = (body.paymentMethod || 'card') as 'card' | 'cash' | 'venmo' | 'zelle'
    const notes = body.notes as string | undefined
    const marketingConsent = body.marketingConsent as boolean | undefined
    const embedded = body.embedded as boolean | undefined

    if (!lineItems?.length || !contactName || !contactEmail || !partyDate || !partyTime || !guestCount || !paymentMethod) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = getSupabase()
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
    const bookingRef = generatePartyRef()
    const depositCents = getDepositCents()
    const totalCents = calculateLineItemTotal(lineItems, guestCount)
    const balanceDueCents = Math.max(0, totalCents - depositCents)
    const { modificationCutoff, guestCountCutoff } = computeCutoffDates(partyDate)

    const quoteSnapshot = {
      lineItems,
      guestCount,
      totalCents,
      depositCents,
      packageType,
      paymentMethod,
    }

    // Insert booking
    const { data: booking, error: dbError } = await supabase.from('bookings').insert({
      booking_ref: bookingRef,
      status: paymentMethod === 'card' ? 'awaiting_deposit' : 'pending_review',
      event_type: 'kid-party',
      party_date: partyDate,
      party_time: partyTime,
      package_type: packageType || null,
      guest_count_approx: guestCount,
      child_name: childName || null,
      child_age: childAge ? parseInt(childAge, 10) : null,
      contact_name: contactName,
      contact_email: contactEmail,
      contact_phone: contactPhone || null,
      deposit_amount: depositCents,
      total_cents: totalCents,
      balance_due_cents: balanceDueCents,
      card_fee_rate: 0.03,
      modification_cutoff: modificationCutoff,
      guest_count_cutoff: guestCountCutoff,
      quote_snapshot: quoteSnapshot,
      payment_method_preference: paymentMethod,
      notes: notes || null,
      party_tags: {},
    }).select('id').single()

    if (dbError || !booking) {
      console.error('Party booking insert error:', dbError)
      return NextResponse.json({ error: 'Booking failed' }, { status: 500 })
    }

    // Insert line items
    const lineItemRows = lineItems.map((item, idx) => ({
      booking_id: booking.id,
      pricing_item_id: item.pricing_item_id || null,
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      price_type: item.price_type,
      guest_multiplied: item.guest_multiplied,
      sort_order: idx,
    }))

    const { error: liError } = await supabase.from('booking_line_items').insert(lineItemRows)
    if (liError) console.error('Line items insert error (non-fatal):', liError)

    // Upsert contact (non-fatal)
    const contactId = await upsertContact({
      name: contactName,
      email: contactEmail,
      phone: contactPhone,
      sourceDetail: `Party builder — ${packageType || 'kids party'}`,
      serviceInterests: ['kids_party'],
      marketingConsent: !!marketingConsent,
    })

    if (contactId) {
      await enrollInSequence({
        contactId,
        contactEmail,
        triggerEvent: 'booking_confirmed',
        serviceType: 'kids_party',
        eventDate: partyDate,
        bookingRef,
      }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
    }

    // Card payment → Stripe checkout
    if (paymentMethod === 'card') {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
      const cardFeeCents = calculateCardFee(depositCents)

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        payment_method_types: ['card'],
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: childName
                  ? `${childName}'s ${packageType || 'Birthday'} Party — Deposit`
                  : `Host Hampton — ${packageType || 'Party'} Deposit`,
                description: `Booking ${bookingRef} | ${partyDate} at ${partyTime} | ${guestCount} guests`,
              },
              unit_amount: depositCents,
            },
            quantity: 1,
          },
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: 'Card Processing Fee (3%)',
              },
              unit_amount: cardFeeCents,
            },
            quantity: 1,
          },
        ],
        customer_email: contactEmail,
        metadata: {
          type: 'party_builder',
          payment_type: 'deposit',
          booking_ref: bookingRef,
          booking_id: booking.id,
          depositCents: String(depositCents),
          cardFeeCents: String(cardFeeCents),
          contactName,
          contactEmail,
          contactPhone: contactPhone || '',
          packageType: packageType || '',
          partyDate,
          partyTime,
          guestCount: String(guestCount),
          childName: childName || '',
          childAge: childAge || '',
        },
      }

      if (embedded) {
        sessionParams.ui_mode = 'embedded'
        sessionParams.return_url = `https://${host}/party-builder?session_id={CHECKOUT_SESSION_ID}&status=complete`
      } else {
        sessionParams.success_url = `https://${host}/party-builder?ref=${bookingRef}&session_id={CHECKOUT_SESSION_ID}&status=complete`
        sessionParams.cancel_url = `https://${host}/party-builder?cancelled=true`
      }

      const session = await stripe.checkout.sessions.create(sessionParams)

      if (embedded) {
        return NextResponse.json({ clientSecret: session.client_secret, method: 'card' })
      }
      return NextResponse.json({ url: session.url, method: 'card' })
    }

    // Non-card payment → skip Stripe, send instructions
    const portalSecret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
    const { token: rawToken, hash, expiresAt } = generatePortalToken(bookingRef, portalSecret)

    // Store portal token
    await supabase.from('portal_tokens').insert({
      booking_id: booking.id,
      token_hash: hash,
      expires_at: expiresAt.toISOString(),
    }).then(({ error }) => {
      if (error) console.error('Portal token insert error (non-fatal):', error)
    })

    const portalUrl = buildPortalUrl(bookingRef, rawToken)

    // Prepare line items for email
    const emailLineItems = lineItems.map(item => ({
      name: item.name,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      guest_multiplied: item.guest_multiplied,
      totalCents: item.guest_multiplied
        ? item.unit_price_cents * item.quantity * guestCount
        : item.unit_price_cents * item.quantity,
    }))

    // Send emails
    if (process.env.RESEND_API_KEY) {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

      await Promise.allSettled([
        resend.emails.send({
          from,
          to: contactEmail,
          subject: `Payment Instructions — ${bookingRef}`,
          html: partyPaymentInstructionsHtml({
            customerName: contactName,
            bookingRef,
            depositFormatted: formatMoney(depositCents),
            paymentMethod,
            venmoHandle: process.env.VENMO_HANDLE,
            zelleEmail: process.env.ZELLE_EMAIL,
            portalUrl,
          }),
        }),
        resend.emails.send({
          from,
          to: 'hosthampton295@gmail.com',
          subject: `New party booking: ${contactName} — ${bookingRef} (${paymentMethod})`,
          html: partyAdminNewBookingHtml({
            bookingRef,
            customerName: contactName,
            customerEmail: contactEmail,
            customerPhone: contactPhone,
            partyDate,
            partyTime,
            guestCount,
            packageType: packageType || 'Kids Party',
            depositFormatted: formatMoney(depositCents),
            totalFormatted: formatMoney(totalCents),
            paymentMethod,
            lineItems: emailLineItems,
            notes,
            adminUrl: `https://${host}/admin?tab=parties&ref=${bookingRef}`,
          }),
        }),
      ])
      console.log('Party booking emails sent for', bookingRef)
    }

    return NextResponse.json({
      url: `https://${host}/kids-party-menu/success?ref=${bookingRef}&method=${paymentMethod}`,
      method: paymentMethod,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Checkout failed'
    console.error('Party checkout error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
