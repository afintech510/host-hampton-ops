import { ownerEmail } from '@/lib/ownerNotify'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { upsertContact } from '@/lib/contacts'
import { enrollInSequence } from '@/lib/sequences'
import { computeCutoffDates, generatePartyRef, formatMoney } from '@/lib/partyPricing'
import { buildPlanSnapshot, planTotals, writeLineItems, writeLineItemsResult } from '@/lib/plan'
import { getPortalBookingRef, setPortalCookieHeader, portalSigningSecret } from '@/lib/portalAuth'
import { mintPortalLink } from '@/lib/portalLinkMint'
import { partyQuoteSentHtml, partyAdminNewBookingHtml } from '@/lib/emailTemplates'
import type { BookingLineItem } from '@/types/booking-flow'
import { publicOrigin, isLocalRequest } from '@/lib/publicOrigin'
import { findBookingsByContactEmail } from '@/lib/contactLookup'
import { screenPublicLineItems, screenPublicGuestCount, boundedIntakeText, MAX_INTAKE_NAME_CHARS } from '@/lib/publicIntake'
import { readBalanceInputs, computeBalance } from '@/lib/bookingBalance'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { attributionFromBody } from '@/lib/attribution'
import { shouldAdvanceToAwaitingDeposit } from '@/lib/pipelineStages'

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

/**
 * Save (or update) the customer's party plan from the planner.
 *
 * UNAUTHENTICATED. The portal cookie is a signal about WHICH plan this is, not a
 * credential — a first-time visitor has none and must still be able to save. Two
 * things followed from that and both were live:
 *
 *  1. **The prices were the caller's to choose.** `lineItems[].unit_price_cents`
 *     went into `booking_line_items` verbatim and into `bookings.total_cents` /
 *     `deposit_amount` / `balance_due_cents` through `buildPlanSnapshot`. Every
 *     downstream money path — `loadPlanInvoice`, the pay panel, the pay link —
 *     re-derives the figure from those rows, so "computed server-side" was true
 *     of the arithmetic and false of the inputs. `screenPublicLineItems` bounds
 *     them and refuses a negative price outright.
 *
 *  2. **The "never fold into a plan money has landed on" guard was on ONE of the
 *     three paths.** It sat inside the `if (!existingRef)` prior-plan scan, so a
 *     ref taken from the cookie — or from `body.bookingRef`, which only has to
 *     match the booking's own email — skipped it entirely. That path replaces the
 *     line items (`replace: true`) and overwrites `total_cents`. Production holds
 *     7 `deposit_paid`, 2 `paid_in_full` and 5 `modifications_locked` bookings.
 *     The guard is now applied to whichever ref wins, on every path.
 */
export async function POST(req: NextRequest) {
  try {
    const limited = guardRate(req, plannerRule('party-builder/save'))
    if (limited) return limited

    const body = await req.json()

    // The first touch, screened at entry (lib/attribution.ts). One reader for

    // every intake route, and it accepts the pre-053 `utm` field name too.

    const attribution = attributionFromBody(body)
    const {
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
      bookingRef: clientBookingRef,
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
      bookingRef?: string // the plan the planner already has open, if any
    }

    if (!contactName || !contactEmail) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
    }
    if (String(contactName).length > MAX_INTAKE_NAME_CHARS) {
      return NextResponse.json({ error: 'That name is too long' }, { status: 400 })
    }

    // The screen runs BEFORE buildPlanSnapshot, because the snapshot is where the
    // client's numbers become `bookings.total_cents`.
    const screenedGuestCount = screenPublicGuestCount(guestCount)
    const screened = screenPublicLineItems(body.lineItems, screenedGuestCount)
    if (!screened.ok) {
      console.warn(`party-builder/save: refused line items for ${contactEmail} — ${screened.reason}`)
      return NextResponse.json({ error: `We could not accept that quote: ${screened.reason}` }, { status: 400 })
    }
    const lineItems = screened.lineItems
    // These reach bookings.notes, the customer email and (through the plan) the
    // agent draft prompt. Nothing here needs a megabyte.
    const boundedNotes = boundedIntakeText(notes)

    const supabase = getSupabase()
    const origin = publicOrigin(req)
    const isLocal = isLocalRequest(req)
    const portalSecret = portalSigningSecret()
    // buildPlanSnapshot owns the arithmetic for all three plan writers.
    const planSnapshot = buildPlanSnapshot({ lineItems, guestCount: screenedGuestCount, packageType, extra: quoteData })
    const { total_cents: totalCents, deposit_amount: depositCents, balance_due_cents: balanceDueCents } =
      planTotals(planSnapshot)

    const normalizedEmail = contactEmail.toLowerCase().trim()

    // Which plan is this save editing? A customer should end up with ONE plan
    // they keep refining, not a new one per save. Three signals, in order of
    // trust:
    //   1. the portal cookie (set below on every save, so save #2 in the same
    //      browser lands on the plan save #1 created),
    //   2. the ref the planner already has open — only honored when the plan on
    //      file carries the same email, so a guessed ref can't hijack a booking,
    //   3. an unpaid plan for the same email and date — catches the cross-device
    //      and cleared-cookie cases, which is how one customer ended up with
    //      four copies of the same October party.
    const cookieHeader = req.headers.get('cookie')
    let existingRef = getPortalBookingRef(cookieHeader, portalSecret)

    const refBelongsToCustomer = async (ref: string): Promise<boolean> => {
      const { data, error } = await supabase
        .from('bookings')
        .select('contact_email')
        .eq('booking_ref', ref)
        .maybeSingle()
      // A failed read must not read as "yes" — it already read as "no", which is
      // the safe direction, but an unread error is an error that did not happen.
      if (error) console.error('party-builder/save: ref ownership read failed —', error.message)
      return !!data && (data.contact_email || '').toLowerCase().trim() === normalizedEmail
    }

    /**
     * Has money landed on this plan? THREE outcomes.
     *
     * This was `const { count } = await …` with the error discarded, so an
     * unreadable `booking_payments` made `count` undefined, `count && count > 0`
     * false, and the save folded itself into a plan that may well have been paid
     * — rules 12 and 19 inside the one guard that existed to prevent exactly that.
     */
    const moneyHasLanded = async (bookingId: string): Promise<'yes' | 'no' | 'unknown'> => {
      const { count, error } = await supabase
        .from('booking_payments')
        .select('id', { count: 'exact', head: true })
        .eq('booking_id', bookingId)
      if (error) {
        console.error(`party-builder/save: payment check failed for ${bookingId} —`, error.message)
        return 'unknown'
      }
      return (count ?? 0) > 0 ? 'yes' : 'no'
    }

    if (!existingRef && clientBookingRef && (await refBelongsToCustomer(clientBookingRef))) {
      existingRef = clientBookingRef
    }

    if (!existingRef) {
      // Newest unpaid, uncancelled plan for this email whose date doesn't
      // conflict — a plan with no date yet is still the one being built.
      //
      // This was `.eq('contact_email', normalizedEmail)`, and `normalizedEmail`
      // is lowercased while `bookings.contact_email` is plain `text` holding
      // whatever the customer typed — **9 of 61 rows are not lowercase**. For
      // those customers the lookup returned nothing and a BRAND NEW PLAN was
      // created on every save, which is precisely the bug commit `9fedd91`
      // ("one plan per customer, not one per save") was written to fix.
      //
      // `refBelongsToCustomer`, fifteen lines above, compares the same two
      // addresses case-insensitively and is right. Two answers to "is this the
      // same person" in one file — hard-won rule 11, and link 14 found the
      // identical pair forty lines apart in `/api/portal/my-bookings`.
      const lookup = await findBookingsByContactEmail(
        supabase,
        normalizedEmail,
        'id, booking_ref, party_date, status, event_type, created_at',
        { limit: 100 },
      )
      if (lookup.kind === 'unavailable') {
        // Rule 12. Treating "could not read" as "no prior plan" is how the
        // duplicate gets created — the failure mode this whole block exists to
        // prevent. Refuse the save; the planner retries.
        console.error('party-builder/save: prior-plan lookup failed —', lookup.error)
        return NextResponse.json({ error: 'Could not load your plan. Please try again.' }, { status: 503 })
      }
      const priorPlans = (lookup.kind === 'found' ? lookup.bookings : [])
        .filter(b => b.event_type === 'kid-party')
        .filter(b => !['cancelled', 'completed'].includes(String(b.status)))
        .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
        .slice(0, 10)
        .map(b => ({ id: b.id, booking_ref: b.booking_ref, party_date: (b.party_date as string | null) ?? null }))

      for (const plan of priorPlans) {
        const datesAgree = !plan.party_date || !partyDate || plan.party_date === partyDate
        if (!datesAgree) continue

        // Never fold a new save into a plan money has already landed on —
        // that plan is a real booking, not a draft. "Could not tell" skips too.
        if ((await moneyHasLanded(plan.id)) !== 'no') continue

        existingRef = plan.booking_ref
        break
      }
    }

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
        guest_count_approx: screenedGuestCount ?? 10,
        child_name: childName || null,
        child_age: parsedChildAge,
        contact_name: contactName,
        // Stored normalized so the same-customer lookup above matches reliably.
        contact_email: normalizedEmail,
        contact_phone: contactPhone || null,
        deposit_amount: depositCents,
        total_cents: totalCents,
        balance_due_cents: balanceDueCents,
        card_fee_rate: 0.03,
        modification_cutoff: cutoffs?.modificationCutoff || null,
        guest_count_cutoff: cutoffs?.guestCountCutoff || null,
        quote_snapshot: snapshotData,
        payment_method_preference: 'card',
        notes: boundedNotes,
        party_type: 'in_studio_theme',
        source: 'website_form',
        attribution,
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
      // Update existing booking. One read, with its error read: `existing` being
      // null used to mean BOTH "no such ref" and "the read failed", and the else
      // branch below creates a brand-new plan — so a Supabase blip forked a
      // duplicate for a returning customer, the exact defect the whole
      // plan-matching block exists to prevent (rule 12).
      const { data: existing, error: existingErr } = await supabase
        .from('bookings')
        .select('id, status, total_cents, party_tags')
        .eq('booking_ref', existingRef)
        .maybeSingle()

      if (existingErr) {
        console.error('party-builder/save: existing-plan read failed —', existingErr.message)
        return NextResponse.json({ error: 'Could not load your plan. Please try again.' }, { status: 503 })
      }

      if (existing) {
        bookingRef = existingRef
        bookingId = existing.id

        // ── The guard that was only on one of three paths ──
        //
        // A public caller reaching this branch through the cookie or through
        // `body.bookingRef` used to skip the payment check entirely, and this
        // branch REPLACES the line items and overwrites `total_cents`. Editing a
        // paid party to add a cupcake is the product and stays allowed; editing
        // it DOWNWARD is not, because the money is already in.
        const landed = await moneyHasLanded(bookingId)
        if (landed === 'unknown') {
          return NextResponse.json(
            { error: 'Could not check your payments. Please try again in a moment.' },
            { status: 503 },
          )
        }
        if (landed === 'yes') {
          const priorTotal = typeof existing.total_cents === 'number' ? existing.total_cents : null
          if (priorTotal !== null && totalCents < priorTotal) {
            console.warn(
              `party-builder/save: refused a REDUCTION on paid plan ${bookingRef} ` +
                `(${priorTotal}c → ${totalCents}c) from a public request`,
            )
            return NextResponse.json(
              {
                error:
                  'This party already has a payment on it, so we cannot lower the total from here. ' +
                  'Call us on (631) 998-9325 and we will sort it out.',
              },
              { status: 409 },
            )
          }
          if (['cancelled', 'completed'].includes(String(existing.status))) {
            return NextResponse.json(
              { error: 'This party is closed. Please call us on (631) 998-9325.' },
              { status: 409 },
            )
          }
        }

        // Balance must reflect what's actually been paid on this booking, not a
        // fresh 25% deposit. Without this, editing add-ons on a paid booking
        // understates the balance by (25% of total − amount actually paid).
        // Through the one definition: a discarded `booking_payments` read made
        // `paidCents` 0 and asked a customer who had paid for the whole total.
        const inputs = await readBalanceInputs(supabase, bookingId, 'id')
        if (!inputs.ok) {
          console.error('party-builder/save: balance inputs unreadable —', inputs.message)
          return NextResponse.json({ error: 'Could not read your payments. Please try again.' }, { status: 503 })
        }
        finalBalanceDueCents = computeBalance(totalCents, inputs.paidSum).balanceCents

        const updateData: Record<string, unknown> = {
          contact_name: contactName,
          contact_email: normalizedEmail,
          contact_phone: contactPhone || null,
          child_name: childName || null,
          child_age: parsedChildAge,
          guest_count_approx: screenedGuestCount ?? 10,
          total_cents: totalCents,
          balance_due_cents: finalBalanceDueCents,
          package_type: packageType || null,
          notes: boundedNotes,
          quote_snapshot: snapshotData,
          // Read in the same statement as `status` above, so a failed read can no
          // longer hand `undefined` here and WIPE location_address and the rest.
          party_tags: buildPartyTags(existing.party_tags as Record<string, unknown> | null),
        }

        // A priced plan has to be payable. `createNew` below writes
        // `awaiting_deposit`, but this branch — the one a lead that arrived
        // through the website form takes — never touched `status`, so quoting
        // such a lead left it at `lead` forever. Nothing downstream recognises
        // that stage: the builder's pay block was hidden and the admin panel's
        // Approve button does not apply to it either, so the plan had no way
        // forward from any surface. Measured on HH-PTY-SEJ4P (Lauren Kovar,
        // $750) and HH-PTY-KMXWM ($1,250) on 2026-09-23.
        //
        // Guarded by `shouldAdvanceToAwaitingDeposit` rather than written
        // unconditionally, because this same route saves edits to plans that
        // are already `approved` or `paid_in_full` and must not drag them back.
        if (shouldAdvanceToAwaitingDeposit(existing.status as string | null)) {
          updateData.status = 'awaiting_deposit'
        }

        if (partyDate) {
          updateData.party_date = partyDate
          const cutoffs = computeCutoffDates(partyDate)
          updateData.modification_cutoff = cutoffs.modificationCutoff
          updateData.guest_count_cutoff = cutoffs.guestCountCutoff
        }
        if (partyTime) updateData.party_time = partyTime

        const { data: updatedRows, error: updateErr } = await supabase
          .from('bookings').update(updateData).eq('id', bookingId).select('id')
        if (updateErr || (updatedRows ?? []).length !== 1) {
          // The email below quotes this total. Sending it over a write that did
          // not happen is rule 10's expensive half.
          console.error(
            `party-builder/save: update wrote ${(updatedRows ?? []).length} rows for ${bookingRef} —`,
            updateErr?.message ?? 'no error reported',
          )
          return NextResponse.json({ error: 'Could not save your plan. Please try again.' }, { status: 503 })
        }

        // Replace line items
        if (lineItems?.length) {
          const write = await writeLineItemsResult(supabase, bookingId, lineItems, { replace: true })
          if (!write.ok) {
            console.error(`party-builder/save: ${write.outcome} for ${bookingRef} — ${write.message}`)
            return NextResponse.json(
              {
                error:
                  write.outcome === 'delete-failed'
                    ? 'Could not update your selections. Please try again.'
                    : 'Something went wrong saving your selections. Please call us on (631) 998-9325.',
              },
              { status: 503 },
            )
          }
        }

        // Log modification
        const { error: modErr } = await supabase.from('booking_modifications').insert({
          booking_id: bookingId,
          modified_by: 'customer',
          change_summary: 'Quote updated via party builder',
          new_data: { lineItems, guestCount: screenedGuestCount, partyDate, partyTime, packageType },
        })
        if (modErr) console.error('party-builder/save: modification log insert failed —', modErr.message)
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
      attribution,
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

    // Generate portal token — through the ONE minter. This route was the eighth
    // copy of `generatePortalToken` → raw `portal_tokens` insert → error logged
    // "non-fatal" → email the link anyway. A refused token row means the URL in
    // that email cannot work: non-fatal to the booking, fatal to the email.
    const minted = await mintPortalLink(supabase, bookingId, bookingRef, '/party-planner')
    const builderUrl = minted.ok ? minted.url : null

    // Prepare email line items
    const emailLineItems = (lineItems || []).map(item => ({
      name: item.name,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      guest_multiplied: item.guest_multiplied,
      totalCents: item.guest_multiplied
        ? item.unit_price_cents * item.quantity * (screenedGuestCount ?? 10)
        : item.unit_price_cents * item.quantity,
    }))

    // Send emails (unconditional of date — even without date, customer gets a link).
    // Admin can opt out with sendEmail=false for "save without notifying".
    let emailSent = false
    let emailDiagnostic: string | undefined
    if (!sendEmail) {
      emailDiagnostic = 'Skipped — admin saved silently'
    } else if (!builderUrl) {
      // The whole customer email IS the link ("View & Customize Your Party Plan").
      // A token row that was refused means that button cannot work, so the email
      // is not sent and the plan is still saved — which is the accurate outcome
      // and the one the planner UI can act on.
      emailDiagnostic = 'Plan saved, but the personal link could not be issued — no email sent'
      console.error(`party-builder/save: ${bookingRef} saved without a portal link; customer email suppressed`)
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
            guestCount: screenedGuestCount ?? 10,
            packageType: packageType || 'Kids Party',
            childName,
            totalFormatted: formatMoney(totalCents),
            depositFormatted: formatMoney(depositCents),
            balanceFormatted: formatMoney(finalBalanceDueCents),
            lineItems: emailLineItems,
            builderUrl,
            notes: boundedNotes ?? undefined,
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
              guestCount: screenedGuestCount ?? 10,
              packageType: packageType || 'Kids Party',
              depositFormatted: formatMoney(depositCents),
              totalFormatted: formatMoney(totalCents),
              paymentMethod: 'pending',
              lineItems: emailLineItems,
              notes: boundedNotes ?? undefined,
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

    const response = NextResponse.json({
      ok: true,
      bookingRef,
      bookingId,
      builderUrl,
      emailSent,
      emailDiagnostic,
    })

    // Bind this browser to the plan. Previously only /api/portal/auth set this,
    // so a first-time visitor's second save arrived with no cookie and forked a
    // brand-new plan.
    response.headers.set('Set-Cookie', setPortalCookieHeader(bookingRef, portalSecret, isLocal))

    return response
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Save failed'
    console.error('Party builder save error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
