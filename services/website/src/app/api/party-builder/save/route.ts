import { ownerEmail } from '@/lib/ownerNotify'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { upsertContact } from '@/lib/contacts'
import { enrollInSequence } from '@/lib/sequences'
import { computeCutoffDates, generatePartyRef, formatMoney } from '@/lib/partyPricing'
import { buildPlanSnapshot, planTotals, writeLineItems } from '@/lib/plan'
import { generatePortalToken, buildPortalUrl, getPortalBookingRef } from '@/lib/portalAuth'
import { partyQuoteSentHtml, partyAdminNewBookingHtml } from '@/lib/emailTemplates'
import type { BookingLineItem } from '@/types/booking-flow'

function formatDate(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  } catch { return dateStr }
}

function formatTime(timeStr: string): string {
  try {
    const [h, m] = timeStr.split(':').map(Number)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
  } catch { return timeStr }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      lineItems,
      contactName,
      contactEmail,
      contactPhone,
      childName,
      childAge,
      catchyPartyName,
      guestCount,
      partyDate,
      partyTime,
      packageType,
      isMiniParty,
      notes,
      marketingConsent,
      quoteData,
      locationType,
      locationAddress,
      sendEmail = true,
    } = body as {
      lineItems: BookingLineItem[]
      contactName: string
      contactEmail: string
      contactPhone?: string
      childName?: string
      childAge?: number | string
      catchyPartyName?: string
      guestCount: number
      partyDate?: string
      locationType?: 'host_hampton' | 'mobile'
      locationAddress?: string
      partyTime?: string
      packageType?: string
      isMiniParty?: boolean
      notes?: string
      marketingConsent?: boolean
      quoteData?: Record<string, unknown>
      sendEmail?: boolean // admin can save silently without notifying customer
    }

    if (!contactName || !contactEmail) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
    }

    const supabase = getSupabase()
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'www.hosthampton.com'
    const forwardedProto = req.headers.get('x-forwarded-proto')
    const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1')
    const proto = forwardedProto || (isLocal ? 'http' : 'https')
    const origin = `${proto}://${host}`
    const portalSecret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
    // buildPlanSnapshot owns the arithmetic for all three plan writers.
    const planSnapshot = buildPlanSnapshot({ lineItems, guestCount, packageType, extra: quoteData })
    const { total_cents: totalCents, deposit_amount: depositCents, balance_due_cents: balanceDueCents } =
      planTotals(planSnapshot)

    // Check if updating an existing booking via portal cookie
    const cookieHeader = req.headers.get('cookie')
    const existingRef = getPortalBookingRef(cookieHeader, portalSecret)

    let bookingRef: string
    let bookingId: string
    let isNewBooking = false
    // Default = new-quote projection (total − 25%). For an existing, already-paid
    // booking we override this below with total − actual payments, so adding
    // line items raises the balance by the delta only (not a fresh 25% assumption).
    let finalBalanceDueCents = balanceDueCents

    // Kept null when the planner sent no structured selections: the client
    // treats a non-null quote_snapshot as "restore this", and an empty one
    // would wipe a returning customer's form instead of leaving the defaults.
    const snapshotData = quoteData ? planSnapshot : null
    const parsedChildAge = childAge != null && childAge !== ''
      ? (typeof childAge === 'number' ? childAge : parseInt(childAge, 10))
      : null
    const buildPartyTags = (existing: Record<string, unknown> | null | undefined) => ({
      ...(existing || {}),
      ...(locationType ? { location_type: locationType } : {}),
      ...(locationAddress ? { location_address: locationAddress } : {}),
      ...(catchyPartyName ? { catchy_party_name: catchyPartyName } : {}),
    })

    const createNew = async (ref: string): Promise<string> => {
      const cutoffs = partyDate ? computeCutoffDates(partyDate) : null

      const { data: booking, error: dbErr } = await supabase.from('bookings').insert({
        booking_ref: ref,
        status: 'awaiting_deposit',
        event_type: 'kid-party',
        party_date: partyDate || null,
        party_time: partyTime || null,
        package_type: packageType || null,
        guest_count_approx: guestCount || 10,
        child_name: childName || null,
        child_age: parsedChildAge,
        contact_name: contactName,
        contact_email: contactEmail,
        contact_phone: contactPhone || null,
        deposit_amount: depositCents,
        total_cents: totalCents,
        balance_due_cents: balanceDueCents,
        card_fee_rate: 0.03,
        modification_cutoff: cutoffs?.modificationCutoff || null,
        guest_count_cutoff: cutoffs?.guestCountCutoff || null,
        quote_snapshot: snapshotData,
        payment_method_preference: 'card',
        notes: notes || null,
        party_type: 'in_studio_theme',
        source: 'website_form',
        party_tags: buildPartyTags(null),
      }).select('id').single()

      if (dbErr || !booking) {
        console.error('Party builder save error:', dbErr)
        throw new Error('Failed to create booking')
      }

      await writeLineItems(supabase, booking.id, lineItems ?? [])
      return booking.id
    }

    if (existingRef) {
      // Update existing booking
      const { data: existing } = await supabase
        .from('bookings')
        .select('id, status')
        .eq('booking_ref', existingRef)
        .single()

      if (existing) {
        bookingRef = existingRef
        bookingId = existing.id

        const { data: existingFull } = await supabase
          .from('bookings').select('party_tags').eq('id', bookingId).single()

        // Balance must reflect what's actually been paid on this booking, not a
        // fresh 25% deposit. Without this, editing add-ons on a paid booking
        // understates the balance by (25% of total − amount actually paid).
        const { data: payRows } = await supabase
          .from('booking_payments')
          .select('amount_cents, payment_type')
          .eq('booking_id', bookingId)
        let paidCents = 0
        for (const p of payRows || []) {
          if (p.payment_type === 'refund') paidCents -= p.amount_cents
          else paidCents += p.amount_cents
        }
        finalBalanceDueCents = Math.max(0, totalCents - paidCents)

        const updateData: Record<string, unknown> = {
          contact_name: contactName,
          contact_email: contactEmail,
          contact_phone: contactPhone || null,
          child_name: childName || null,
          child_age: parsedChildAge,
          guest_count_approx: guestCount || 10,
          total_cents: totalCents,
          balance_due_cents: finalBalanceDueCents,
          package_type: packageType || null,
          notes: notes || null,
          quote_snapshot: snapshotData,
          party_tags: buildPartyTags(existingFull?.party_tags as Record<string, unknown> | null),
        }

        if (partyDate) {
          updateData.party_date = partyDate
          const cutoffs = computeCutoffDates(partyDate)
          updateData.modification_cutoff = cutoffs.modificationCutoff
          updateData.guest_count_cutoff = cutoffs.guestCountCutoff
        }
        if (partyTime) updateData.party_time = partyTime

        await supabase.from('bookings').update(updateData).eq('id', bookingId)

        // Replace line items
        if (lineItems?.length) {
          await writeLineItems(supabase, bookingId, lineItems, { replace: true })
        }

        // Log modification
        await supabase.from('booking_modifications').insert({
          booking_id: bookingId,
          modified_by: 'customer',
          change_summary: 'Quote updated via party builder',
          new_data: { lineItems, guestCount, partyDate, partyTime, packageType },
        })
      } else {
        bookingRef = generatePartyRef()
        bookingId = await createNew(bookingRef)
        isNewBooking = true
      }
    } else {
      bookingRef = generatePartyRef()
      bookingId = await createNew(bookingRef)
      isNewBooking = true
    }

    // Upsert contact
    const contactId = await upsertContact({
      name: contactName,
      email: contactEmail,
      phone: contactPhone,
      sourceDetail: 'Party Builder — Save Quote',
      serviceInterests: ['kids_party'],
      marketingConsent: !!marketingConsent,
    })

    if (contactId) {
      await enrollInSequence({
        contactId,
        contactEmail,
        triggerEvent: 'new_inquiry',
        serviceType: 'kids_party',
        eventDate: partyDate,
        bookingRef,
      }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
    }

    // Generate portal token
    const { token: rawToken, hash, expiresAt } = generatePortalToken(bookingRef, portalSecret)
    await supabase.from('portal_tokens').insert({
      booking_id: bookingId,
      token_hash: hash,
      expires_at: expiresAt.toISOString(),
    }).then(({ error }) => {
      if (error) console.error('Portal token insert error (non-fatal):', error)
    })

    const builderUrl = buildPortalUrl(bookingRef, rawToken, '/party-planner')

    // Prepare email line items
    const emailLineItems = (lineItems || []).map(item => ({
      name: item.name,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      guest_multiplied: item.guest_multiplied,
      totalCents: item.guest_multiplied
        ? item.unit_price_cents * item.quantity * (guestCount || 10)
        : item.unit_price_cents * item.quantity,
    }))

    // Send emails (unconditional of date — even without date, customer gets a link).
    // Admin can opt out with sendEmail=false for "save without notifying".
    let emailSent = false
    let emailDiagnostic: string | undefined
    if (!sendEmail) {
      emailDiagnostic = 'Skipped — admin saved silently'
    } else if (process.env.RESEND_API_KEY) {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

      const dateDisplay = partyDate ? formatDate(partyDate) : undefined
      const timeDisplay = partyTime ? formatTime(partyTime) : undefined

      // Customer always gets an updated quote on every save.
      // Admin only gets pinged on the FIRST save for this booking — subsequent
      // iterations are quiet so admin inbox doesn't fill up with re-saves.
      // Admin will still get the loud "Deposit paid" email when money lands.
      const emailJobs: Promise<unknown>[] = [
        resend.emails.send({
          from,
          to: contactEmail,
          subject: `Your Host Hampton Party Plan — ${bookingRef}`,
          html: partyQuoteSentHtml({
            customerName: contactName,
            bookingRef,
            partyDate: dateDisplay,
            partyTime: timeDisplay,
            guestCount: guestCount || 10,
            packageType: packageType || 'Kids Party',
            childName,
            totalFormatted: formatMoney(totalCents),
            depositFormatted: formatMoney(depositCents),
            balanceFormatted: formatMoney(finalBalanceDueCents),
            lineItems: emailLineItems,
            builderUrl,
            notes,
          }),
        }),
      ]

      if (isNewBooking) {
        emailJobs.push(
          resend.emails.send({
            from,
            to: ownerEmail(),
            subject: `Quote sent: ${contactName} — ${bookingRef}`,
            html: partyAdminNewBookingHtml({
              bookingRef,
              customerName: contactName,
              customerEmail: contactEmail,
              customerPhone: contactPhone,
              partyDate: dateDisplay || 'TBD',
              partyTime: timeDisplay || 'TBD',
              guestCount: guestCount || 10,
              packageType: packageType || 'Kids Party',
              depositFormatted: formatMoney(depositCents),
              totalFormatted: formatMoney(totalCents),
              paymentMethod: 'pending',
              lineItems: emailLineItems,
              notes,
              adminUrl: `${origin}/admin?tab=parties&ref=${bookingRef}`,
            }),
          }),
        )
      }

      const results = await Promise.allSettled(emailJobs)
      let emailErrors: string[] = []
      results.forEach((r, i) => {
        const which = i === 0 ? 'customer' : 'admin'
        if (r.status === 'rejected') {
          const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
          console.error(`Party builder save: ${which} email failed:`, msg)
          emailErrors.push(`${which}: ${msg}`)
        } else {
          const value = r.value as { error?: unknown } | null
          if (value && value.error) {
            const errObj = value.error
            const msg = errObj instanceof Error ? errObj.message : JSON.stringify(errObj)
            console.error(`Party builder save: ${which} email Resend error:`, msg)
            emailErrors.push(`${which}: ${msg}`)
          }
        }
      })
      emailSent = emailErrors.length === 0
      emailDiagnostic = emailErrors.length ? emailErrors.join('; ') : undefined
    } else {
      console.warn('Party builder save: RESEND_API_KEY not set — skipping email send')
      emailDiagnostic = 'RESEND_API_KEY not configured'
    }

    return NextResponse.json({
      ok: true,
      bookingRef,
      bookingId,
      builderUrl,
      emailSent,
      emailDiagnostic,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Save failed'
    console.error('Party builder save error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
