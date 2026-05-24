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
    const catchyPartyName = (body.catchyPartyName as string | undefined) || ''
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
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3002'
    const forwardedProto = req.headers.get('x-forwarded-proto')
    const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1')
    const proto = forwardedProto || (isLocal ? 'http' : 'https')
    const origin = `${proto}://${host}`
    const bookingRef = generatePartyRef()
    const totalCents = calculateLineItemTotal(lineItems, guestCount)
    const depositCents = getDepositCents(totalCents)
    const balanceDueCents = Math.max(0, totalCents - depositCents)
    const { modificationCutoff, guestCountCutoff } = computeCutoffDates(partyDate)

    // Merge structured selection data (sent from the planner) so /load can
    // fully restore the form. Falls back to a minimal snapshot for legacy
    // callers that don't send quoteData.
    const incomingQuoteData = (body.quoteData as Record<string, unknown> | undefined) || {}
    const quoteSnapshot = {
      ...incomingQuoteData,
      lineItems,
      guestCount,
      totalCents,
      depositCents,
      packageType,
      paymentMethod,
    }

    // For non-card pledges (Venmo / Zelle / Cash), we lock the date immediately
    // so the customer's slot can't be double-booked while we wait for payment to
    // land. Card is handled by Stripe — date_locked is set in confirm-session
    // and the webhook once the charge succeeds.
    const partyTags: Record<string, unknown> = {}
    if (catchyPartyName) partyTags.catchy_party_name = catchyPartyName
    if (paymentMethod !== 'card') {
      partyTags.date_locked = true
      partyTags.pledge_method = paymentMethod
      partyTags.pledge_amount_cents = depositCents
      partyTags.pledged_at = new Date().toISOString()
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
      party_tags: partyTags,
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

    // Card payment → in-page Stripe Payment Element (PaymentIntent)
    if (paymentMethod === 'card') {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
      const cardFeeCents = calculateCardFee(depositCents)
      const totalChargeCents = depositCents + cardFeeCents

      // We bundle the deposit + 3% card fee into a single PaymentIntent.
      // The breakdown lives in metadata so the webhook can record both pieces.
      const intent = await stripe.paymentIntents.create({
        amount: totalChargeCents,
        currency: 'usd',
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        receipt_email: contactEmail,
        description: childName
          ? `${childName}'s ${packageType || 'Birthday'} Party — Deposit (${bookingRef})`
          : `Host Hampton — ${packageType || 'Party'} Deposit (${bookingRef})`,
        statement_descriptor_suffix: 'PARTY DEPOSIT',
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
      })

      // `embedded` is kept in the response for caller compatibility but ignored
      // — Payment Element always renders in-page.
      void embedded
      void origin
      return NextResponse.json({
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
        bookingRef,
        bookingId: booking.id,
        method: 'card',
      })
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
            adminUrl: `${origin}/admin?tab=parties&ref=${bookingRef}`,
          }),
        }),
      ])
      console.log('Party booking emails sent for', bookingRef)
    }

    return NextResponse.json({
      url: `${origin}/kids-party-menu/success?ref=${bookingRef}&method=${paymentMethod}&deposit=${depositCents}`,
      method: paymentMethod,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Checkout failed'
    console.error('Party checkout error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
