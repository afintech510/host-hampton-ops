import { ownerEmail, notifyOwnerSms, leadSmsLine } from '@/lib/ownerNotify'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { upsertContact } from '@/lib/contacts'
import { enrollInSequence } from '@/lib/sequences'
import { recordInboundEvent } from '@/lib/agent/events'
import { computeCutoffDates, generatePartyRef, formatMoney } from '@/lib/partyPricing'
import { buildPlanSnapshot, planTotals, writeLineItems, linkFirstTouchEvent } from '@/lib/plan'
import { partyRequestReceivedHtml, partyAdminNewBookingHtml } from '@/lib/emailTemplates'
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
    const notes = body.notes as string | undefined
    const marketingConsent = body.marketingConsent as boolean | undefined

    if (!lineItems?.length || !contactName || !contactEmail || !partyDate || !partyTime || !guestCount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = getSupabase()
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3002'
    const forwardedProto = req.headers.get('x-forwarded-proto')
    const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1')
    const proto = forwardedProto || (isLocal ? 'http' : 'https')
    const origin = `${proto}://${host}`
    const bookingRef = generatePartyRef()
    const { modificationCutoff, guestCountCutoff } = computeCutoffDates(partyDate)

    // Merge structured selection data (sent from the planner) so /load can
    // fully restore the form. buildPlanSnapshot recomputes the totals from the
    // line items, so a stale client-side total in quoteData cannot be persisted.
    const quoteSnapshot = buildPlanSnapshot({
      lineItems,
      guestCount,
      packageType,
      extra: (body.quoteData as Record<string, unknown> | undefined) || {},
    })
    const { total_cents: totalCents, deposit_amount: depositCents, balance_due_cents: balanceDueCents } =
      planTotals(quoteSnapshot)

    // Party REQUEST flow: we never lock a date or take payment here. The team
    // reviews availability and approves; the date is only reserved (and a Google
    // Calendar event created) on admin approval. This prevents a customer from
    // paying to lock a slot the venue isn't actually available for.
    const partyTags: Record<string, unknown> = {}
    if (catchyPartyName) partyTags.catchy_party_name = catchyPartyName

    // Insert booking as a pending request — nothing is charged or reserved yet.
    const { data: booking, error: dbError } = await supabase.from('bookings').insert({
      booking_ref: bookingRef,
      status: 'pending_review',
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
      party_type: 'in_studio_theme',
      source: 'website_form',
      quote_snapshot: quoteSnapshot,
      payment_method_preference: null,
      notes: notes || null,
      party_tags: partyTags,
    }).select('id').single()

    if (dbError || !booking) {
      console.error('Party booking insert error:', dbError)
      return NextResponse.json({ error: 'Booking failed' }, { status: 500 })
    }

    await writeLineItems(supabase, booking.id, lineItems)

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

    // Booking agent: this request is also a lead. The booking row is the plan,
    // so the event carries booking_id and the dispatcher's booking sweep will
    // see the same draft (one live draft per booking, never two).
    const firstEventId = await recordInboundEvent({
      route: 'party-checkout',
      contactId,
      bookingId: booking.id,
      fromAddress: contactEmail,
      subject: `Party request ${bookingRef} — ${contactName}`,
      body: notes || null,
      classification: 'lead',
      parsed: {
        name: contactName,
        email: contactEmail,
        phone: contactPhone || null,
        eventType: 'kid-party',
        packageType: packageType || null,
        date: partyDate,
        time: partyTime,
        guests: guestCount,
        childName: childName || null,
        childAge: childAge || null,
        notes: notes || null,
        bookingRef,
      },
    })

    // first_touch_event_id can only be stamped once the event exists; the
    // booking is inserted first on purpose. Fill-once, never fatal.
    await linkFirstTouchEvent(booking.id, firstEventId)

    // Prepare line items for the admin email
    const emailLineItems = lineItems.map(item => ({
      name: item.name,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      guest_multiplied: item.guest_multiplied,
      totalCents: item.guest_multiplied
        ? item.unit_price_cents * item.quantity * guestCount
        : item.unit_price_cents * item.quantity,
    }))

    const partyDateFormatted = new Date(partyDate + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    })

    // Notify the customer (request received — no payment, nothing booked yet) and
    // the team (new request to review for availability). No Stripe, no portal
    // link: the customer can only pay after we approve.
    if (process.env.RESEND_API_KEY) {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

      await Promise.allSettled([
        resend.emails.send({
          from,
          to: contactEmail,
          subject: `We got your party request — ${bookingRef}`,
          html: partyRequestReceivedHtml({
            customerName: contactName,
            bookingRef,
            partyDate: partyDateFormatted,
            partyTime,
            depositFormatted: formatMoney(depositCents),
          }),
        }),
        resend.emails.send({
          from,
          to: ownerEmail(),
          subject: `New party REQUEST: ${contactName} — ${bookingRef}`,
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
            paymentMethod: 'request',
            lineItems: emailLineItems,
            notes,
            adminUrl: `${origin}/admin?tab=parties&ref=${bookingRef}`,
          }),
        }),
      ])
      console.log('Party request emails sent for', bookingRef)
    }
    await notifyOwnerSms(leadSmsLine({
      kind: `party REQUEST ${bookingRef} (${packageType || 'kids party'}, ${formatMoney(totalCents)})`, name: contactName,
      phone: contactPhone, email: contactEmail, date: `${partyDate} ${partyTime}`, guests: guestCount,
    }))

    return NextResponse.json({
      url: `${origin}/kids-party-menu/success?ref=${bookingRef}&method=request&deposit=${depositCents}`,
      method: 'request',
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Checkout failed'
    console.error('Party checkout error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
