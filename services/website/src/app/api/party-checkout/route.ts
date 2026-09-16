import { ownerEmail, notifyOwnerSms, leadSmsLine } from '@/lib/ownerNotify'
import { NextRequest, NextResponse } from 'next/server'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { screenPublicLineItems, screenPublicGuestCount } from '@/lib/publicIntake'
import { getSupabase } from '@/lib/supabase'
import { upsertContact } from '@/lib/contacts'
import { enrollInSequence } from '@/lib/sequences'
import { recordInboundEvent } from '@/lib/agent/events'
import { computeCutoffDates, generatePartyRef, formatMoney } from '@/lib/partyPricing'
import { buildPlanSnapshot, planTotals, writeLineItemsResult, linkFirstTouchEvent } from '@/lib/plan'
import { partyRequestReceivedHtml, partyAdminNewBookingHtml } from '@/lib/emailTemplates'
import type { BookingLineItem } from '@/types/booking-flow'
import { publicOrigin } from '@/lib/publicOrigin'
import { attributionFromBody } from '@/lib/attribution'
import { getPortalBookingRef, portalSigningSecret } from '@/lib/portalAuth'
import { isPayableStatus } from '@/lib/portalWrite'

export async function POST(req: NextRequest) {
  const limited = guardRate(req, plannerRule('party-checkout'))
  if (limited) return limited

  try {
    const body = await req.json()
    // The first touch, screened at entry (lib/attribution.ts). One reader for
    // every intake route, and it accepts the pre-053 `utm` field name too.
    const attribution = attributionFromBody(body)

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

    // The comment below is right that `buildPlanSnapshot` recomputes the totals,
    // and that is exactly why the LINE ITEMS have to be screened: they are what it
    // recomputes from, and `unit_price_cents` arrived from the browser. See
    // `lib/publicIntake.ts`.
    const screened = screenPublicLineItems(lineItems, guestCount)
    if (!screened.ok) {
      console.warn(`party-checkout: refused line items for ${contactEmail} — ${screened.reason}`)
      return NextResponse.json({ error: `We could not accept that request: ${screened.reason}` }, { status: 400 })
    }
    const screenedGuestCount = screenPublicGuestCount(guestCount)
    if (screenedGuestCount === null) {
      return NextResponse.json({ error: 'Please give us a realistic guest count' }, { status: 400 })
    }

    const supabase = getSupabase()
    const origin = publicOrigin(req)
    const { modificationCutoff, guestCountCutoff } = computeCutoffDates(partyDate)

    /*
      ── Do not FORK a plan the customer is already sitting on ────────────────

      This route called `generatePartyRef()` unconditionally, so a customer who
      arrived on a real plan by portal link — built it out and pressed "Request
      This Party" — got a SECOND `pending_review` booking under a new ref, and
      the plan we had emailed them was orphaned with their date still on it.
      `/api/party-builder/save` has passed `bookingRef` for exactly this reason
      since it was written ("Keep re-saves on the plan already open instead of
      forking a new one"); this path simply never did.

      Ownership is proved by the PORTAL COOKIE, not by a ref in the body: a ref
      is guessable and this is an unauthenticated public route. The cookie is
      HMAC-signed by us and names one booking. The email must match as well, so
      a shared browser cannot fold one person's request into another's plan, and
      a cancelled or completed booking is never adopted.
    */
    const normalizedEmail = String(contactEmail).toLowerCase().trim()
    const cookieRef = getPortalBookingRef(req.headers.get('cookie'), portalSigningSecret())
    let adoptedId: string | null = null
    let adoptedTags: Record<string, unknown> = {}
    let adoptedNotes: string | null = null
    let bookingRef = cookieRef || generatePartyRef()
    if (cookieRef) {
      const { data: owned, error: ownErr } = await supabase
        .from('bookings')
        // `party_tags` and `notes` are read so the write below can MERGE them.
        // Overwriting `party_tags` would drop `date_locked` — i.e. silently
        // release a date the customer has already paid to hold — and blanking
        // `notes` would erase whatever Adam typed when he took the enquiry.
        .select('id, contact_email, status, party_tags, notes')
        .eq('booking_ref', cookieRef)
        .maybeSingle()
      // Rule 12: a failed read is not a "no". It falls through to a new booking,
      // which is this route's pre-existing behaviour — but it says so.
      if (ownErr) {
        console.error('party-checkout: ownership read failed for', cookieRef, '—', ownErr.message)
      }
      const emailMatches = !!owned && (owned.contact_email || '').toLowerCase().trim() === normalizedEmail
      if (owned && emailMatches && isPayableStatus(owned.status)) {
        adoptedId = owned.id as string
        adoptedTags = (owned.party_tags as Record<string, unknown> | null) || {}
        adoptedNotes = (owned.notes as string | null) ?? null
      } else {
        if (owned) {
          console.warn(
            `party-checkout: not adopting ${cookieRef} (emailMatches=${emailMatches}, status=${String(owned.status)}) — creating a new booking`,
          )
        }
        bookingRef = generatePartyRef()
      }
    }

    // Merge structured selection data (sent from the planner) so /load can
    // fully restore the form. buildPlanSnapshot recomputes the totals from the
    // line items, so a stale client-side total in quoteData cannot be persisted.
    const quoteSnapshot = buildPlanSnapshot({
      lineItems: screened.lineItems,
      guestCount: screenedGuestCount,
      packageType,
      extra: (body.quoteData as Record<string, unknown> | undefined) || {},
    })
    const { total_cents: totalCents, deposit_amount: depositCents, balance_due_cents: balanceDueCents } =
      planTotals(quoteSnapshot)

    // Party REQUEST flow: we never lock a date or take payment here. The team
    // reviews availability and approves; the date is only reserved (and a Google
    // Calendar event created) on admin approval. This prevents a customer from
    // paying to lock a slot the venue isn't actually available for.
    // Spread FIRST so this request's own fields win, but nothing already on the
    // plan is lost. On a new booking `adoptedTags` is `{}` and this is a no-op.
    const partyTags: Record<string, unknown> = { ...adoptedTags }
    if (catchyPartyName) partyTags.catchy_party_name = catchyPartyName

    // The fields a request writes, whether it lands on a new row or the
    // customer's existing one. `booking_ref`, `source` and `attribution` are
    // deliberately NOT in here: a ref never changes, and first-touch
    // attribution belongs to how they FIRST arrived, not to this later click.
    const requestFields = {
      status: 'pending_review',
      event_type: 'kid-party',
      party_date: partyDate,
      party_time: partyTime,
      package_type: packageType || null,
      guest_count_approx: screenedGuestCount,
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
      quote_snapshot: quoteSnapshot,
      payment_method_preference: null,
      // Never blank an existing note. The customer's planner does not send one,
      // so `notes || null` on an adopted plan would erase what Adam wrote when
      // he took the enquiry.
      notes: notes || adoptedNotes || null,
      party_tags: partyTags,
    }

    // Insert booking as a pending request — nothing is charged or reserved yet.
    const { data: booking, error: dbError } = adoptedId
      ? await supabase
          .from('bookings')
          .update(requestFields)
          .eq('id', adoptedId)
          // `.select()` because an UPDATE that matched nothing reports no error;
          // without it a vanished row would read as a successful request.
          .select('id')
          .single()
      : await supabase
          .from('bookings')
          .insert({ ...requestFields, booking_ref: bookingRef, source: 'website_form', attribution })
          .select('id')
          .single()

    if (dbError || !booking) {
      console.error(`Party booking ${adoptedId ? 'update' : 'insert'} error:`, dbError)
      return NextResponse.json({ error: 'Booking failed' }, { status: 500 })
    }

    // `replace` on an adopted plan: these line items ARE the plan now, and
    // appending would bill the customer twice for everything they had already
    // chosen. A new booking has nothing to replace, so the flag is a no-op.
    const itemWrite = await writeLineItemsResult(supabase, booking.id, screened.lineItems, {
      replace: !!adoptedId,
    })
    // Rule 10: a guardrail that drops something has to say so. `insert-failed`
    // on a REPLACE means the old rows are gone and the new ones were refused —
    // the plan is empty while `total_cents` says otherwise, and only a human can
    // put it back. The booking still stands (non-fatal by contract).
    if (!itemWrite.ok) {
      console.error(
        `party-checkout: line items ${itemWrite.outcome} for ${bookingRef} (adopted=${!!adoptedId}) — ${itemWrite.message}`,
      )
    }

    // Upsert contact (non-fatal)
    const contactId = await upsertContact({
      name: contactName,
      email: contactEmail,
      phone: contactPhone,
      sourceDetail: `Party builder — ${packageType || 'kids party'}`,
      serviceInterests: ['kids_party'],
      marketingConsent: !!marketingConsent,
      attribution,
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
    const emailLineItems = screened.lineItems.map(item => ({
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
