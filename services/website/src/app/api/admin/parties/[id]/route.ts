import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { mintPortalLink, mintPortalLinks } from '@/lib/portalLinkMint'
import { formatMoney, screenTipCents } from '@/lib/partyPricing'
import { partyApprovedHtml, partyChangesRequestedHtml, partyPortalMagicLinkHtml, partyPaymentReceivedHtml, studioRentalApprovedHtml } from '@/lib/emailTemplates'
import { syncBookingCalendar, clearBookingCalendar } from '@/lib/calendarSync'
import { time12, hoursBetween } from '@/lib/studioRental'
import { loadPricingCatalog, loadLineItemAddOns } from '@/lib/pricingCatalog'
import { priceRentalWindow, addHoursToTime, type RentalPrice } from '@/lib/rentalPricing'
import { draftForBookingByHand } from '@/lib/agent/manualDraft'
import { sendSMSVia, normalizePhone } from '@/lib/sms'
import { sendCheckinLinkSms } from '@/lib/checkinLink'
import { phoneHasExplicitStop } from '@/lib/phoneStop'
import {
  PHOTO_ALBUM_SUBJECT, PHOTO_ALBUM_SENT_SUMMARY_PREFIX,
  screenFotoshareUrl, screenOccasion, photoAlbumText, photoAlbumEmailHtml,
} from '@/lib/photoAlbum'
import { checkSmsQuietHours } from '@/lib/quietHours'
import { TENANT } from '@/tenant'
import { findPhotos, MAX_PHOTOS_PER_REQUEST } from '@/lib/media'
import {
  PHOTOS_EMAIL_SUBJECT, PHOTOS_EMAIL_SUBJECT_INTRODUCED, createPhotoSet, photosEmailHtml, photosEmailText, photosSmsText,
} from '@/lib/photoSets'
import {
  checkPlaceholders, clientLinkLabel, clientLinksEmailHtml, fillLinks, isStudioRentalBooking, placeholdersIn,
  screenBody, screenLinkKinds, screenSubject, type Placeholder,
} from '@/lib/clientLinks'
import { defaultPortalLanding } from '@/lib/portalRedirect'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { isPlausibleEmailAddress } from '@/lib/contactLookup'
import { ownerEmail } from '@/lib/ownerNotify'
import { writeLedger } from '@/lib/marketing/graph'
import { enqueueCheckinReminders, cancelCheckinReminders } from '@/lib/checkinReminders'
import { readBalanceInputs, computeBalance, sumPayments } from '@/lib/bookingBalance'
import { recalcTotals, syncExtraGuestsLine, EXTRA_GUESTS_NAME } from '@/lib/bookingTotals'
import { logBookingChange } from '@/lib/bookingAudit'
import { approveOnLinkSend, linkSendApproves } from '@/lib/linkApproval'
import {
  recordAdminPayment,
  describeLedgerOutcome,
  ledgerCategoryForBooking,
  ADMIN_PAYMENT_METHODS,
  PAYMENT_TYPES,
  type AdminPaymentMethod,
  type PaymentType,
} from '@/lib/adminMoney'
import { isPartyType, PARTY_TYPES } from '@/lib/pipelineStages'

/**
 * Where a minted portal link should land the customer.
 *
 * A NAMED destination, never a caller-supplied path. `buildPortalUrl` puts this
 * straight into `?redirect=` on `/api/portal/auth`, so a free-form string here
 * is an open redirect wearing an authentication token — and the customer
 * arrives at it already signed in. The three names below map to three constants
 * in this file and nothing else crosses the boundary; an unknown name falls back
 * to the portal rather than being honoured or refused, because the caller is an
 * authenticated admin and the worst case is "the link went to the wrong one of
 * our own pages".
 *
 * `invoice` is the clean, printable quote at /plan/<ref>/summary — the view Adam
 * asked to be able to hand a customer without them having to walk the planner.
 *
 * `invitation` is the host's own invitation page, where the parent shares the
 * invite and watches RSVPs. It reads the booking from the cookie this link sets.
 *
 * A studio rental's planner AND portal are `/studio-rental` (manage mode: times,
 * add-ons, guest count, payments). Until 2026-10-20 both went to the party
 * planner, so the admin had no way to open — or send — a rental's own page.
 */
function portalDestination(
  name: unknown,
  booking: { booking_ref: string; event_type?: string | null },
): string | undefined {
  switch (name) {
    case 'planner': return defaultPortalLanding(booking)
    case 'invoice': return `/plan/${encodeURIComponent(booking.booking_ref)}/summary`
    case 'invitation': return '/my-booking/invitation'
    // The portal itself. Explicit for a rental; the auth route's own default
    // agrees, but the admin should not depend on a second file to be right.
    default: return isStudioRentalBooking(booking) ? '/studio-rental' : undefined
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const { id } = await params
  const supabase = getSupabase()

  const [bookingRes, lineItemsRes, paymentsRes, modificationsRes, addOnCatalog, eviteRes] = await Promise.all([
    supabase.from('bookings').select('*').eq('id', id).single(),
    supabase.from('booking_line_items').select('*').eq('booking_id', id).order('sort_order'),
    supabase.from('booking_payments').select('*').eq('booking_id', id).order('paid_at', { ascending: false }),
    supabase.from('booking_modifications').select('*').eq('booking_id', id).order('created_at', { ascending: false }),
    loadLineItemAddOns(supabase),
    supabase.from('evites').select('archived_at').eq('booking_id', id).maybeSingle(),
  ])

  if (bookingRes.error) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // For the "Send links to client" panel's hint only; the send re-reads it.
  const invitation_status: 'none' | 'archived' | 'ready' | 'unknown' = eviteRes.error
    ? 'unknown'
    : !eviteRes.data ? 'none' : eviteRes.data.archived_at ? 'archived' : 'ready'

  return NextResponse.json({
    ...bookingRes.data,
    line_items: lineItemsRes.data || [],
    payments: paymentsRes.data || [],
    modifications: modificationsRes.data || [],
    addOnCatalog,
    invitation_status,
  })
}

/**
 * Bring this booking's Google Calendar event in line with it. Non-fatal by
 * construction: the booking change is the record, and the calendar-sync cron
 * repairs anything this misses — so a calendar outage must never fail an admin
 * action that has already been written.
 */
async function syncCalendar(supabase: ReturnType<typeof getSupabase>, id: string): Promise<void> {
  const r = await syncBookingCalendar(supabase, id)
  if (!r.ok) console.error(`admin/parties/${id}: calendar sync failed (non-fatal):`, r.error)
}

/** Tags the dashboard may change by hand: neither affects a price. */
const EDITABLE_PARTY_TAGS = ['modifications_unlocked', 'catchy_party_name']

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const { id } = await params
  const supabase = getSupabase()
  const body = await req.json()

  // Admin can update any field
  const updates: Record<string, unknown> = {}
  // Not on this list on purpose. `status` has its own actions (approve / cancel /
  // mark_lost / reopen), which send the customer email, cancel the check-in texts and
  // gate on money; a PATCH to `cancelled` skipped all of it. `total_cents` and
  // `balance_due_cents` are DERIVED from the line items and payments (recalcTotals,
  // bookingBalance): a raw write leaves a booking disagreeing with its own invoice.
  // Nothing in the dashboard or the assistant sends any of the three.
  const allowed = ['party_date', 'party_time', 'package_type', 'guest_count_approx', 'child_name', 'child_age', 'admin_notes', 'notes', 'contact_name', 'contact_email', 'contact_phone', 'photo_gallery_url']
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key]
  }
  const refusedKeys = ['status', 'total_cents', 'balance_due_cents'].filter(k => body[k] !== undefined)
  if (refusedKeys.length) {
    return NextResponse.json(
      { error: `${refusedKeys.join(', ')} cannot be set here: status has its own actions (approve, cancel, mark_lost, reopen) and the totals follow the line items and payments.` },
      { status: 400 },
    )
  }

  // `party_tags` carries rental times, the address, the custom hourly rate and the
  // security hold, none of which a raw write re-prices. The dashboard only edits the
  // unlock switch (and sends the whole object back with it), so: keys the caller did
  // not change are ignored, a changed key outside the editable set is refused, and the
  // result is merged into the stored tags rather than replacing them.
  if (body.party_tags !== undefined) {
    if (!body.party_tags || typeof body.party_tags !== 'object' || Array.isArray(body.party_tags)) {
      return NextResponse.json({ error: 'party_tags must be an object' }, { status: 400 })
    }
    const { data: tagRow, error: tagErr } = await supabase.from('bookings').select('party_tags').eq('id', id).single()
    if (tagErr || !tagRow) return NextResponse.json({ error: 'Could not read the booking to merge party_tags' }, { status: 500 })
    const stored = (tagRow.party_tags as Record<string, unknown> | null) || {}
    const incoming = body.party_tags as Record<string, unknown>
    const changed = Object.keys(incoming).filter(k => JSON.stringify(incoming[k]) !== JSON.stringify(stored[k]))
    const blocked = changed.filter(k => !EDITABLE_PARTY_TAGS.includes(k))
    if (blocked.length) {
      return NextResponse.json(
        { error: `party_tags ${blocked.join(', ')} cannot be edited here: they drive the price. Use the rental time editor, the assistant, or the matching action.` },
        { status: 400 },
      )
    }
    if (changed.length) updates.party_tags = { ...stored, ...Object.fromEntries(changed.map(k => [k, incoming[k]])) }
  }

  // `party_type` is the field the whole Parties tab filters and counts on, and
  // it carries a CHECK constraint, so it is validated here rather than passed
  // through with the free-text fields. A bad value is REFUSED, not dropped: a
  // PATCH that answers `{ok:true}` having silently ignored the one field you
  // came to change is how "I set the type and it didn't stick" happens.
  if (body.party_type !== undefined) {
    if (!isPartyType(body.party_type)) {
      return NextResponse.json(
        { error: `party_type must be one of ${PARTY_TYPES.join(', ')}` },
        { status: 400 },
      )
    }
    updates.party_type = body.party_type
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No changes' }, { status: 400 })
  }

  updates.updated_at = new Date().toISOString()

  const { error } = await supabase.from('bookings').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: 'Admin edit: ' + Object.keys(updates).filter(k => k !== 'updated_at').join(', '),
      newData: updates,
    })

  // A label is not an invoice. Changing the theme name or the party type writes the
  // column and nothing else; if the lines no longer match, say so now rather than
  // let the customer's invoice contradict the party. (A real swap rebuilds lines and
  // needs choices, so it is its own action, not a side effect of this one.)
  let labelWarning: string | undefined
  if (updates.package_type !== undefined || updates.party_type !== undefined) {
    const { data: liRows } = await supabase.from('booking_line_items').select('name, category, pricing_item_id').eq('booking_id', id)
    const li = (liRows ?? []) as { name: string; category: string; pricing_item_id: string | null }[]
    const themeLine = li.find(r => r.category === 'theme' && r.pricing_item_id)
    const hasMobile = li.some(r => r.category === 'mobile-package')
    const hasRental = li.some(r => r.category === 'rental')
    const notes: string[] = []
    if (updates.package_type !== undefined && themeLine && String(updates.package_type).trim().toLowerCase() !== themeLine.name.trim().toLowerCase()) {
      notes.push(`the invoice still has the "${themeLine.name}" theme line at its old price`)
    }
    if (updates.party_type === 'in_studio_theme' && (hasMobile || hasRental)) notes.push('the invoice still has mobile/rental lines')
    if (updates.party_type === 'mobile_party' && (themeLine || hasRental)) notes.push('the invoice still has in-studio theme or rental lines')
    if (updates.party_type === 'studio_rental' && (themeLine || hasMobile)) notes.push('the invoice still has theme or mobile lines')
    if (notes.length) labelWarning = `Saved the label, but ${notes.join(' and ')}. Nothing was repriced: swap the lines to match, or the customer's invoice will contradict the party.`
  }

  // A studio rental is priced from its date (weekday/weekend card) and its
  // window, and carries the window in `party_tags`. Moving the date or start time
  // used to write the column and leave the price, the tags and the label alone.
  // The window keeps its length when only the start moves.
  let rentalProblem: string | undefined
  let rentalTotals: { totalCents?: number; balanceCents?: number } = {}
  if (updates.party_date !== undefined || updates.party_time !== undefined) {
    const { data: rental } = await supabase
      .from('bookings').select('id, event_type, party_date, party_time, party_tags').eq('id', id).single()
    if (rental && rental.event_type === 'studio-rental') {
      const tags = (rental.party_tags as Record<string, unknown> | null) || {}
      const oldStart = typeof tags.rental_start_time === 'string' ? tags.rental_start_time : null
      const oldEnd = typeof tags.rental_end_time === 'string' ? tags.rental_end_time : null
      if (oldStart && oldEnd) {
        const startTime = updates.party_time !== undefined ? String(updates.party_time) : oldStart
        const hoursKept = Math.max(1, hoursBetween(oldStart, oldEnd))
        const endTime = updates.party_time !== undefined && startTime !== oldStart ? addHoursToTime(startTime, hoursKept) : oldEnd
        if (!endTime) {
          rentalProblem = `The rental window would run past midnight from ${startTime}; the price and times were NOT updated. Use the rental time editor.`
        } else {
          const applied = await applyRentalWindow(supabase, id, rental as Record<string, unknown>, { startTime, endTime })
          if (applied.ok) rentalTotals = { totalCents: applied.totalCents, balanceCents: applied.balanceCents }
          else rentalProblem = applied.error
        }
      } else {
        rentalProblem = 'This rental has no stored start and end time, so its price was NOT recalculated. Use the rental time editor.'
      }
    }
  }

  // Date changes are free, so they happen often. Both check-in texts are
  // scheduled off the party start, so they have to move with it — otherwise a
  // rescheduled party texts its customer on the old date.
  if (updates.party_date !== undefined || updates.party_time !== undefined) {
    const { data: fresh } = await supabase
      .from('bookings')
      .select('booking_ref, contact_email, party_date, party_time, checkin_status, party_type')
      .eq('id', id)
      .single()

    // Nothing to reschedule once check-in is done.
    if (fresh && fresh.checkin_status !== 'complete') {
      await enqueueCheckinReminders({
        partyType: fresh.party_type,
        bookingRef: fresh.booking_ref,
        contactEmail: fresh.contact_email,
        partyDate: fresh.party_date,
        partyTime: fresh.party_time,
      })
    }
  }

  // A moved date or time used to leave the event where it was (HH-PTY-B7T6W:
  // moved to 11-29 13:00, still on the calendar at 11-28 12:00).
  if (['status', 'party_date', 'party_time', 'party_tags'].some(k => updates[k] !== undefined)) {
    await syncCalendar(supabase, id)
  }

  // Any per-guest line item (guest-overage, per-head add-ons) is priced off
  // `guest_count_approx` — see `billedTotalCents` in lib/planBalance.ts. Saving
  // a new guest count here without also re-running that math is exactly how
  // "I edited the guest count" and "the invoice still shows the old total"
  // used to happen: the PATCH used to write the column and stop, so the stored
  // total/balance went stale until some unrelated line-item action recalculated
  // it. Recompute in the same request instead.
  let totalsUpdated: boolean | undefined
  let totalsWarning: string | undefined
  let totalCents: number | undefined
  let balanceCents: number | undefined
  if (updates.guest_count_approx !== undefined) {
    const extraGuestsProblem = await syncExtraGuestsLine(supabase, id, updates.guest_count_approx)
    const totals = await recalcTotals(supabase, id, { guest_count_approx: updates.guest_count_approx })
    totalsUpdated = totals.ok
    if (totals.ok) {
      totalCents = totals.totalCents
      balanceCents = totals.balanceCents
    } else {
      totalsWarning = `Guest count was saved but the invoice total could not be recalculated (${totals.message}). Reload before quoting this customer.`
    }
    if (extraGuestsProblem) totalsWarning = `${totalsWarning ? totalsWarning + ' ' : ''}Guest count was saved but ${extraGuestsProblem}. Check the invoice before quoting this customer.`
    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: totals.ok
        ? `Guest count change re-priced the invoice — total now ${formatMoney(totals.totalCents)}`
        : `Guest count change: TOTAL NOT RECALCULATED (${totals.message})`,
    })
  }

  return NextResponse.json({
    ok: true,
    ...(rentalProblem || labelWarning ? { warning: [rentalProblem, labelWarning].filter(Boolean).join(' ') } : {}),
    ...(rentalTotals.totalCents !== undefined ? { totalsUpdated: true, ...rentalTotals } : {}),
    ...(totalsUpdated !== undefined ? { totalsUpdated, totalCents, balanceCents, warning: totalsWarning } : {}),
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const { id } = await params
  const supabase = getSupabase()
  const body = await req.json()
  const action = body.action as string

  // Three outcomes, not two. This one read gates every admin action below —
  // approve, cancel, record a payment, send a portal link, edit a line item — and
  // it used to discard its error, so a transient Supabase failure answered a
  // confident **404 "Not found"** about a party that is sitting right there.
  // Hard-won rule 12; link 14 found eleven of these in one surface.
  const { data: booking, error: bookingErr } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (bookingErr) {
    console.error(`admin/parties/${id}: booking read failed:`, bookingErr.message)
    return NextResponse.json(
      { error: 'Could not load this party right now — please try again.' },
      { status: 503 },
    )
  }
  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 })


  // ── "Draft reply with agent" (Phase 4 item 5) ─────────────────────────
  // The button that covers a phone lead: it enqueues an inbound event for this
  // plan and takes it through the SAME claim path as any other event, so the
  // cron and a button press can never both draft it. See lib/agent/manualDraft.ts
  // for the three layers that stop a double-click becoming two texts. This is
  // an admin-authenticated route, but drafting still only reaches `sent_for_review`
  // — the 'approved' and 'sent' edges stay gated exactly as before.
  if (action === 'draft_with_agent') {
    const result = await draftForBookingByHand({
      supabase,
      bookingId: id,
      // Plan §11.1: `admin:<email>` when a session names the human, and the
      // historical anonymous 'ADMIN' on the shared password. This is the actor
      // the event and the ledger carry, so "who asked the agent to draft this"
      // is answerable once both admins sign in per-person.
      actor: adminActorId(req),
      note: typeof body.note === 'string' ? body.note : null,
    })
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, reason: result.reason, reviewCode: result.reviewCode ?? null },
        { status: result.status },
      )
    }
    return NextResponse.json({
      ok: true,
      reviewCode: result.reviewCode,
      draftId: result.draftId,
      draftStatus: result.draftStatus,
      reviewersTexted: result.reviewersTexted,
      // Nothing has reached the customer; this only texted the reviewers.
      sentToCustomer: false,
    })
  }

  if (action === 'approve') {
    // A cancelled or lost party is not approved by this button: it would revive the
    // booking AND tell the family it is confirmed. Reopen it first (action `reopen`),
    // which puts it back at quoted/lead, and approve from there.
    if (booking.status === 'cancelled' || booking.status === 'lost') {
      return NextResponse.json(
        { error: `This booking is ${booking.status} — reopen it first. Nothing was changed and nothing was sent.` },
        { status: 409 },
      )
    }
    // `send_email: false` approves WITHOUT the confirmation email — for a customer
    // the owner has already told. An explicit opt-out, never a default (the mail is
    // how a family learns the party is booked), and the choice is written into the
    // booking's change log so "we chose not to email" never looks like "it failed".
    const notifyCustomer = body.send_email !== false
    // Approving emails the customer "Your Party is Confirmed!". Doing that over
    // a status write that was refused tells a real family their party is booked
    // when the database still says it is pending (rule 10).
    const { data: approved, error: approveErr } = await supabase.from('bookings').update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: adminActorId(req),
      updated_at: new Date().toISOString(),
    }).eq('id', id).select('id')
    if (approveErr || !approved?.length) {
      return NextResponse.json(
        { error: `Booking NOT approved: ${approveErr?.message || 'no row matched'}. Nothing was sent to the customer.` },
        { status: 500 },
      )
    }

    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: 'Booking approved',
    })

    const partyDateFormatted = booking.party_date
      ? new Date(booking.party_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : 'TBD'

    // A studio rental is confirmed as a RENTAL: its own calendar block at the
    // rented window, and an email whose links open the studio planner and the
    // invoice. It used to get "[PARTY] … 2 hrs" and "Your Party is Confirmed!"
    // with a link that landed the renter in the party planner.
    if (isStudioRentalBooking(booking)) {
      const tags = (booking.party_tags as Record<string, unknown> | null) || {}
      const start = typeof tags.rental_start_time === 'string' ? tags.rental_start_time : (booking.party_time as string | null)
      const end = typeof tags.rental_end_time === 'string' ? tags.rental_end_time : null

      // The calendar follows the money, not the Approve button: an approved
      // rental with no deposit does not hold the room (lib/calendarSync.ts).
      await syncCalendar(supabase, id)

      if (!notifyCustomer) {
        await logBookingChange(supabase, {
          bookingId: id, actor: adminActorId(req),
          summary: 'Studio rental approved - confirmation email deliberately NOT sent (admin chose not to email)',
        })
        return NextResponse.json({ ok: true, action: 'approved', emailed: false, emailSkippedByAdmin: true })
      }

      const links = await mintPortalLinks(supabase, id, booking.booking_ref, {
        planner: portalDestination('planner', booking) as string,
        invoice: portalDestination('invoice', booking) as string,
      })
      if (!links.ok) {
        return NextResponse.json({ error: `Booking approved, but the links could not be minted (${links.reason}) — no email was sent.` }, { status: 503 })
      }

      let emailed = false
      if (process.env.RESEND_API_KEY && booking.contact_email) {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
        const { error: mailErr } = await resend.emails.send({
          from, to: booking.contact_email, replyTo: ownerEmail(),
          subject: `Your Studio Rental is Confirmed! — ${booking.booking_ref}`,
          html: studioRentalApprovedHtml({
            customerName: booking.contact_name || '',
            bookingRef: booking.booking_ref,
            rentalDate: partyDateFormatted,
            rentalTime: start && end ? `${time12(start)} – ${time12(end)}` : start ? time12(start) : 'TBD',
            balanceFormatted: formatMoney(booking.balance_due_cents || 0),
            plannerUrl: links.urls.planner,
            invoiceUrl: links.urls.invoice,
          }),
        })
        if (mailErr) console.error(`approve: studio confirmation email failed for ${booking.booking_ref}:`, mailErr.message)
        else emailed = true
      }

      await logBookingChange(supabase, {
        bookingId: id, actor: adminActorId(req),
        summary: emailed
          ? 'Studio rental confirmation emailed (studio rental planner + invoice links)'
          : 'Studio rental confirmation NOT emailed — check the email address and Resend config',
      })
      return NextResponse.json({ ok: true, action: 'approved', emailed })
    }

    // On the calendar only once a deposit has landed — approving an unpaid quote
    // used to block the slot for a party nobody had paid for (HH-2026-9024).
    await syncCalendar(supabase, id)

    if (!notifyCustomer) {
      await logBookingChange(supabase, {
        bookingId: id, actor: adminActorId(req),
        summary: 'Booking approved - confirmation email deliberately NOT sent (admin chose not to email)',
      })
      return NextResponse.json({ ok: true, action: 'approved', emailed: false, emailSkippedByAdmin: true })
    }

    // Generate portal link & send approval email
    const minted = await mintPortalLink(supabase, id, booking.booking_ref)
    if (!minted.ok) return NextResponse.json({ error: `Could not mint a portal link (${minted.reason}) — nothing was sent.` }, { status: 503 })
    const portalUrl = minted.url

    if (process.env.RESEND_API_KEY) {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
      await resend.emails.send({
        from, to: booking.contact_email,
        subject: `Your Party is Confirmed! — ${booking.booking_ref}`,
        html: partyApprovedHtml({
          customerName: booking.contact_name,
          bookingRef: booking.booking_ref,
          partyDate: partyDateFormatted,
          partyTime: booking.party_time || 'TBD',
          balanceFormatted: formatMoney(booking.balance_due_cents || 0),
          portalUrl,
        }),
      })
    }

    return NextResponse.json({ ok: true, action: 'approved' })
  }

  if (action === 'request_changes') {
    const message = body.message || 'Please review your booking details.'

    if (process.env.RESEND_API_KEY) {
      const minted = await mintPortalLink(supabase, id, booking.booking_ref)
      if (!minted.ok) return NextResponse.json({ error: `Could not mint a portal link (${minted.reason}) — nothing was sent.` }, { status: 503 })
      const portalUrl = minted.url

      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
      await resend.emails.send({
        from, to: booking.contact_email,
        subject: `Update About Your Booking — ${booking.booking_ref}`,
        html: partyChangesRequestedHtml({
          customerName: booking.contact_name,
          bookingRef: booking.booking_ref,
          adminMessage: message,
          portalUrl,
        }),
      })
    }

    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: `Changes requested: ${message}`,
    })

    return NextResponse.json({ ok: true, action: 'changes_requested' })
  }

  if (action === 'cancel') {
    // A cancel that reports success over a refused write leaves a party live in
    // the calendar, in the pipeline and — since the check-in reminders are
    // cancelled below on the strength of it — with its customer still due to be
    // texted about a party that Allie believes is off.
    const { data: cancelled, error: cancelErr } = await supabase.from('bookings').update({
      status: 'cancelled', updated_at: new Date().toISOString(),
    }).eq('id', id).select('id')
    if (cancelErr || !cancelled?.length) {
      return NextResponse.json(
        { error: `Booking NOT cancelled: ${cancelErr?.message || 'no row matched'}` },
        { status: 500 },
      )
    }

    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: 'Booking cancelled by admin',
    })

    // Don't text a cancelled party's customer asking them to check in.
    await cancelCheckinReminders(booking.booking_ref)

    // Free the slot: a cancelled party's event used to stay on the calendar
    // forever, so the planner kept refusing that time to everybody else.
    await syncCalendar(supabase, id)

    return NextResponse.json({ ok: true, action: 'cancelled' })
  }

  // ── Lost / reopen (migration 064) ─────────────────────────────────────
  // `lost` is a lead that said no: nobody booked and nothing is owed. It sends
  // the customer NOTHING. It is refused once money has landed — that party was
  // booked, so ending it is a cancellation (and possibly a refund), not a lost
  // lead. A failed payments read refuses too: "could not read" is not "unpaid".
  if (action === 'mark_lost' || action === 'reopen') {
    const { data: pays, error: paysErr } = await supabase
      .from('booking_payments')
      .select('amount_cents, payment_type')
      .eq('booking_id', id)
    if (paysErr) {
      return NextResponse.json({ error: `Could not read payments (${paysErr.message}) — nothing changed.` }, { status: 503 })
    }
    const paid = sumPayments(pays)

    let next: string
    if (action === 'mark_lost') {
      if (paid > 0) {
        return NextResponse.json(
          { error: `This party has ${formatMoney(paid)} paid, so it was booked — cancel it instead of marking it lost.` },
          { status: 409 },
        )
      }
      next = 'lost'
    } else {
      if (booking.status !== 'lost' && booking.status !== 'cancelled') {
        return NextResponse.json({ error: 'Only a lost or cancelled party can be reopened.' }, { status: 409 })
      }
      // Back to the open end of the pipeline. Money already landed still reads
      // as Booked — the stage is derived from the payments, not from this.
      next = typeof booking.total_cents === 'number' && booking.total_cents > 0 ? 'quoted' : 'lead'
    }

    const { data: moved, error: moveErr } = await supabase
      .from('bookings')
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id')
    if (moveErr || !moved?.length) {
      return NextResponse.json({ error: `Status NOT changed: ${moveErr?.message || 'no row matched'}` }, { status: 500 })
    }
    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: action === 'mark_lost' ? 'Marked as lost (lead declined) — nothing sent to customer' : `Reopened as ${next}`,
      oldData: { status: booking.status },
      newData: { status: next },
    })
    if (action === 'mark_lost') await cancelCheckinReminders(booking.booking_ref)
    await syncCalendar(supabase, id)
    return NextResponse.json({ ok: true, action: action === 'mark_lost' ? 'marked_lost' : 'reopened', status: next })
  }

  // ── "Record a payment" — the one place a human puts money in the books ──
  //
  // This is where the cash, Venmo, Zelle and cheque money arrives: Stripe never
  // sees it, so the webhook cannot record it and the rule "only the webhook
  // records a payment" cannot apply. Before link 18 this action wrote a
  // `booking_payments` row and NOTHING ELSE — no `financial_transactions` row,
  // ever — so $2,256 of real customer money, $1,608 of it non-card, is in the
  // database and has never appeared in the Financials tab Adam reads.
  //
  // Four failure modes were live here and all four are fixed below:
  //   * the INSERT's error was discarded, and the customer was then emailed
  //     "Payment Received — $X, balance $Y" over a write that may have been
  //     refused (rule 19, then rule 10's expensive half);
  //   * the balance came from `booking.total_cents || 0` over a read whose error
  //     was also discarded, so an UNQUOTED LEAD — most of the pipeline since
  //     Phase 4 — was marked `paid_in_full` by its first deposit (rule 12);
  //   * `recorded_by` was the literal `'admin'`, so the money row could not name
  //     the human who entered it (migration 047 relaxes the CHECK);
  //   * `amount_cents` reached the column unvalidated.
  //
  // `send_receipt: false` records the money and sends the customer NOTHING.
  // Added 2026-09-19 for HH-PTY-SHS6V: money that arrived weeks ago, being
  // written down now to make the books right. A "Payment Received" mail for a
  // payment the customer made in July reads as a second charge, and the party
  // itself is already over.
  //
  // An explicit OPT-OUT, never a default: the receipt is the only thing that
  // tells a customer their money landed, and a flag that silences it by
  // omission would silence it for the next caller too. The suppression is
  // written into the booking's own change log, because "we chose not to tell
  // her" and "the mail failed" must not look the same to whoever reads that log
  // in six months (rule 10).
  if (action === 'record_payment') {
    const { amount_cents, payment_method, notes: payNotes, force_ledger } = body
    const sendReceipt = body.send_receipt !== false

    if (!Number.isSafeInteger(amount_cents) || amount_cents <= 0) {
      return NextResponse.json(
        { error: 'amount_cents must be a positive whole number of cents' },
        { status: 400 },
      )
    }
    if (typeof payment_method !== 'string' || !ADMIN_PAYMENT_METHODS.includes(payment_method as AdminPaymentMethod)) {
      return NextResponse.json(
        { error: `payment_method must be one of: ${ADMIN_PAYMENT_METHODS.join(', ')}` },
        { status: 400 },
      )
    }
    const paymentType: PaymentType =
      typeof body.payment_type === 'string' && PAYMENT_TYPES.includes(body.payment_type as PaymentType)
        ? (body.payment_type as PaymentType)
        : 'partial'

    /**
     * A hand-entered gratuity (migration 058).
     *
     * Optional `tip_cents`, and it is ON TOP of `amount_cents` rather than
     * inside it — the same shape as every other writer, so `amount_cents` is
     * still purely what the plan is credited and the balance arithmetic below
     * needs no special case. Cash and Venmo tips are the ones most likely to be
     * typed in here, and they are exactly the ones that were invisible.
     */
    const tipCents = screenTipCents(body.tip_cents)

    // `.select()` so a refused INSERT is a refusal and not a silent success. The
    // customer receipt below depends on this row existing.
    const { data: paymentRow, error: payErr } = await supabase
      .from('booking_payments')
      .insert({
        booking_id: id,
        payment_type: paymentType,
        payment_method,
        amount_cents,
        tip_cents: tipCents,
        card_fee_cents: 0,
        total_charged_cents: amount_cents + tipCents,
        recorded_by: adminActorId(req),
        notes: payNotes || null,
      })
      .select('id, paid_at')
      .single()

    if (payErr || !paymentRow) {
      console.error(`record_payment: booking_payments insert failed for ${booking.booking_ref}:`, payErr?.message)
      return NextResponse.json(
        { error: `Payment NOT recorded: ${payErr?.message || 'insert returned no row'}` },
        { status: 500 },
      )
    }

    // Recalculate the balance from the shared reader (lib/bookingBalance.ts),
    // which the Stripe webhook also uses. A failed read is reported, never
    // treated as a zero total.
    const inputs = await readBalanceInputs(supabase, id, 'total_cents')
    let newBalance: number | null = null
    let balanceNote = ''
    if (!inputs.ok) {
      console.error(`record_payment: balance NOT updated for ${booking.booking_ref}: ${inputs.message}`)
      balanceNote = ` Balance NOT recalculated (${inputs.message}).`
    } else {
      const bal = computeBalance(inputs.row.total_cents as number | null, inputs.paidSum)
      newBalance = bal.balanceCents
      const updateFields: Record<string, unknown> = {
        balance_due_cents: bal.balanceCents,
        updated_at: new Date().toISOString(),
      }
      if (bal.paidInFull) {
        updateFields.paid_in_full_at = new Date().toISOString()
        updateFields.status = 'paid_in_full'
      }
      const { data: updated, error: updErr } = await supabase
        .from('bookings')
        .update(updateFields)
        .eq('id', id)
        .select('id')
      if (updErr || !updated?.length) {
        console.error(`record_payment: bookings update matched nothing for ${booking.booking_ref}:`, updErr?.message)
        balanceNote = ` Balance NOT saved (${updErr?.message || 'no row matched'}).`
        newBalance = null
      } else if (bal.overpaidCents > 0) {
        balanceNote = ` OVERPAID by ${formatMoney(bal.overpaidCents)}.`
      }
    }

    // Into the books. Declines rather than double-counting when a Stripe row
    // already records this amount for this booking — see lib/adminMoney.ts.
    const ledger = await recordAdminPayment(supabase, {
      paymentId: paymentRow.id,
      bookingRef: booking.booking_ref,
      // GROSS, matching the Stripe path, which books `chargedCents`. A tip is
      // money that arrived and the books have to show it; the BALANCE above is
      // what must exclude it, and that reads `amount_cents` from the row.
      amountCents: amount_cents + tipCents,
      method: payment_method,
      paidAt: paymentRow.paid_at || new Date().toISOString(),
      customerName: booking.contact_name || null,
      category: ledgerCategoryForBooking(booking.party_type, booking.event_type),
      notes: payNotes || null,
      force: force_ledger === true,
    })
    const ledgerNote = describeLedgerOutcome(ledger)

    // `logBookingChange` reports its own failure; the payment itself stands
    // either way, so this is not a reason to refuse.
    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: `${payment_method} payment of ${formatMoney(amount_cents)} recorded` +
        `${tipCents > 0 ? ` plus a ${formatMoney(tipCents)} tip (not credited to the balance)` : ''}. ` +
        `Balance: ${newBalance === null ? 'unchanged' : formatMoney(newBalance)}.${balanceNote} ${ledgerNote}` +
        `${sendReceipt ? '' : ' No receipt sent (send_receipt:false).'}`,
    })

    // Send customer receipt — only now, with a real payment row behind it.
    if (sendReceipt && process.env.RESEND_API_KEY && booking.contact_email) {
      // A link whose token row was refused is a dead link in a customer's
      // inbox, so the mint decides whether the email goes at all.
      const minted = await mintPortalLink(supabase, id, booking.booking_ref)
      if (minted.ok) {
        const portalUrl = minted.url
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
        const { error: mailErr } = await resend.emails.send({
          from, to: booking.contact_email,
          subject: `Payment Received — ${booking.booking_ref}`,
          html: partyPaymentReceivedHtml({
            customerName: booking.contact_name,
            bookingRef: booking.booking_ref,
            amountFormatted: formatMoney(amount_cents),
            paymentMethod: payment_method,
            newBalanceFormatted: newBalance === null ? 'see your portal' : formatMoney(newBalance),
            portalUrl,
          }),
        })
        if (mailErr) console.error('record_payment: receipt email failed:', mailErr.message)
      }
    }

    // A hand-entered deposit is what books a cash/Venmo/Zelle party, and no
    // other path put those on the calendar at all.
    await syncCalendar(supabase, id)

    return NextResponse.json({
      ok: true,
      action: 'payment_recorded',
      paymentId: paymentRow.id,
      newBalance,
      balanceUpdated: newBalance !== null,
      ledger: ledger.kind,
      ledgerReference: ledger.reference,
      receiptSent: sendReceipt,
      message: `Payment of ${formatMoney(amount_cents)} recorded.${balanceNote} ${ledgerNote}` +
        `${sendReceipt ? '' : ' No receipt was sent.'}`,
    })
  }

  if (action === 'send_portal_link' || action === 'generate_portal_url') {
    const minted = await mintPortalLink(
      supabase, id, booking.booking_ref, portalDestination(body.destination, booking),
    )
    if (!minted.ok) return NextResponse.json({ error: `Could not mint a portal link (${minted.reason}) — nothing was sent.` }, { status: 503 })
    const portalUrl = minted.url

    // send_portal_link delivers the link to the customer by BOTH email and SMS
    // (sharing this single token); generate_portal_url just mints the URL.
    if (action === 'send_portal_link') {
      const sentVia: string[] = []

      if (booking.contact_email && process.env.RESEND_API_KEY) {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
        await resend.emails.send({
          from, to: booking.contact_email,
          subject: `Your Booking Portal Link — ${booking.booking_ref}`,
          html: partyPortalMagicLinkHtml({
            customerName: booking.contact_name,
            bookingRef: booking.booking_ref,
            portalUrl,
          }),
        })
        sentVia.push('email')
      }

      if (booking.contact_phone) {
        const firstName = (booking.contact_name || '').trim().split(/\s+/)[0] || 'there'
        const smsBody = `Hi ${firstName}! Here's your Host Hampton party booking link to review details & pay your deposit: ${portalUrl} Reply STOP to opt out`
        const sid = await sendSMSVia('quo', normalizePhone(booking.contact_phone), smsBody)
        if (sid) sentVia.push('sms')
      }

      await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: sentVia.length
          ? `Portal link sent to customer via ${sentVia.join(' + ')}`
          : 'Portal link generated (no email/SMS delivery — check contact info & config)',
    })

      // Only if it actually reached the client by some channel.
      const portalApproval = sentVia.length > 0 && linkSendApproves(booking.status)
        ? await approveOnLinkSend(supabase, { bookingId: id, status: String(booking.status), actor: adminActorId(req), via: sentVia.join(' + ') })
        : 'skipped'
      return NextResponse.json({ ok: true, action: 'portal_link_sent', portalUrl, sentVia, approved: portalApproval === 'approved', approvalFailed: portalApproval === 'failed' })
    }

    return NextResponse.json({ ok: true, action: 'portal_url_generated', portalUrl })
  }

  // Text the customer a fresh portal link. Transactional → Quo.
  if (action === 'send_portal_sms') {
    if (!booking.contact_phone) {
      return NextResponse.json({ error: 'No phone number on file for this booking' }, { status: 400 })
    }

    const minted = await mintPortalLink(supabase, id, booking.booking_ref)
    if (!minted.ok) return NextResponse.json({ error: `Could not mint a portal link (${minted.reason}) — nothing was sent.` }, { status: 503 })
    const portalUrl = minted.url

    const firstName = (booking.contact_name || '').trim().split(/\s+/)[0] || 'there'
    const smsBody = `Hi ${firstName}! Here's your Host Hampton party booking link to review details & pay your deposit: ${portalUrl} Reply STOP to opt out`

    const sid = await sendSMSVia('quo', normalizePhone(booking.contact_phone), smsBody)
    if (!sid) {
      return NextResponse.json({ error: 'Failed to send SMS — check the phone number and Quo/SMS config' }, { status: 502 })
    }

    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: `Portal link texted to ${booking.contact_phone}`,
    })

    const smsApproval = linkSendApproves(booking.status)
      ? await approveOnLinkSend(supabase, { bookingId: id, status: String(booking.status), actor: adminActorId(req), via: 'text' })
      : 'skipped'
    return NextResponse.json({ ok: true, action: 'portal_sms_sent', to: booking.contact_phone, approved: smsApproval === 'approved', approvalFailed: smsApproval === 'failed' })
  }

  // ── "Send links to client" — invitation / planner / invoice / portal ──
  // The panel posts the exact wording (the default from lib/clientLinks.ts, or
  // the admin's edit of it) with PLACEHOLDERS for the links. The links are
  // minted here, only once every check has passed, so a refused send leaves no
  // live sign-in token behind — and none is ever echoed back or written to the
  // audit trail, because each one IS a sign-in.
  if (action === 'send_client_links') {
    if (body.confirm !== true) {
      return NextResponse.json({ error: 'Sending to a client must be confirmed' }, { status: 400 })
    }
    const kinds = screenLinkKinds(body.links)
    if (kinds.length === 0) return NextResponse.json({ error: 'Pick at least one link to send' }, { status: 400 })
    const wantsEmail = body.email === true
    const wantsSms = body.sms === true
    if (!wantsEmail && !wantsSms) return NextResponse.json({ error: 'Pick email, text, or both' }, { status: 400 })
    if (booking.status === 'cancelled' || booking.status === 'lost') {
      return NextResponse.json({ error: `This booking is ${booking.status} — nothing was sent.` }, { status: 409 })
    }

    const email = typeof booking.contact_email === 'string' ? booking.contact_email.trim() : ''
    const phone = typeof booking.contact_phone === 'string' ? booking.contact_phone.trim() : ''
    if (wantsEmail && !isPlausibleEmailAddress(email)) {
      return NextResponse.json({ error: 'No valid email address on this booking — untick Email or fix it first.' }, { status: 409 })
    }
    if (wantsSms && !phone) {
      return NextResponse.json({ error: 'No phone number on this booking — untick Text or add one first.' }, { status: 409 })
    }

    const problems: string[] = []
    let subject = ''
    let emailBody = ''
    let smsBody = ''
    if (wantsEmail) {
      const s = screenSubject(body.emailSubject)
      const b = screenBody(body.emailBody, 'email')
      if (!s.ok) problems.push(s.reason); else subject = s.text
      if (!b.ok) problems.push(b.reason); else { emailBody = b.text; problems.push(...checkPlaceholders(emailBody, kinds, 'email')) }
    }
    if (wantsSms) {
      const b = screenBody(body.smsBody, 'text')
      if (!b.ok) problems.push(b.reason); else { smsBody = b.text; problems.push(...checkPlaceholders(smsBody, kinds, 'text')) }
    }
    if (problems.length > 0) return NextResponse.json({ error: problems.join(' '), problems }, { status: 400 })

    // The public invitation link. Three outcomes: a failed read is not "no invitation".
    let inviteUrl: string | null = null
    if (kinds.includes('invite')) {
      const { data: ev, error: evErr } = await supabase
        .from('evites')
        .select('slug, archived_at')
        .eq('booking_id', id)
        .maybeSingle<{ slug: string; archived_at: string | null }>()
      if (evErr) return NextResponse.json({ error: 'Could not read the invitation — try again. Nothing was sent.' }, { status: 503 })
      if (!ev) return NextResponse.json({ error: 'This party has no invitation yet — create it in the Invitation card first. Nothing was sent.' }, { status: 409 })
      if (ev.archived_at) return NextResponse.json({ error: 'The invitation is archived, so its link does not work — unarchive it first. Nothing was sent.' }, { status: 409 })
      inviteUrl = `${CANONICAL_ORIGIN}/i/${encodeURIComponent(ev.slug)}`
    }

    // The text is checked BEFORE anything is minted or sent, so a text-only
    // send outside 8am–9pm (or to a STOPped number) changes nothing at all.
    let smsBlocked: string | null = null
    if (wantsSms) {
      const quiet = checkSmsQuietHours(new Date())
      const stop = quiet.kind === 'open' ? await phoneHasExplicitStop(supabase, phone) : null
      if (quiet.kind !== 'open') smsBlocked = 'Text NOT sent — it is outside 8am–9pm. Send again with only Text ticked after 8am.'
      else if (stop === 'stopped') smsBlocked = 'Text NOT sent — this number has a STOP (opt-out) on file.'
      else if (stop !== 'clear') smsBlocked = 'Text NOT sent — could not check this number for a STOP. Try again.'
    }
    const sendEmail = wantsEmail
    const sendSms = wantsSms && !smsBlocked
    if (!sendEmail && !sendSms) return NextResponse.json({ error: smsBlocked, failures: [smsBlocked] }, { status: 409 })

    // Mint only the links that will actually be in a message that goes out.
    const used = new Set([
      ...(sendEmail ? placeholdersIn(emailBody) : []),
      ...(sendSms ? placeholdersIn(smsBody) : []),
    ])
    const urls: Partial<Record<Placeholder, string>> = {}
    if (inviteUrl) urls.invite = inviteUrl
    const minted: Array<[Placeholder, string | undefined]> = [
      ['rsvps', portalDestination('invitation', booking)],
      ['planner', portalDestination('planner', booking)],
      ['invoice', portalDestination('invoice', booking)],
      ['portal', portalDestination('portal', booking)],
    ]
    for (const [p, destination] of minted) {
      if (!used.has(p)) continue
      const link = await mintPortalLink(supabase, id, booking.booking_ref, destination)
      if (!link.ok) return NextResponse.json({ error: `Could not mint the ${p} link (${link.reason}) — nothing was sent.` }, { status: 503 })
      urls[p] = link.url
    }

    const sentVia: string[] = []
    const failures: string[] = smsBlocked ? [smsBlocked] : []

    if (sendEmail) {
      if (!process.env.RESEND_API_KEY) {
        failures.push('Email is not configured')
      } else {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
        const { error: mailErr } = await resend.emails.send({
          from, to: email, replyTo: ownerEmail(),
          subject,
          html: clientLinksEmailHtml(emailBody, urls),
          text: fillLinks(emailBody, urls),
        })
        if (mailErr) failures.push(`Email failed: ${mailErr.message}`)
        else sentVia.push('email')
      }
    }

    if (sendSms) {
      const sid = await sendSMSVia('quo', normalizePhone(phone), fillLinks(smsBody, urls))
      if (sid) sentVia.push('text')
      else failures.push('Text failed to send — check the number and Quo config')
    }

    const what = kinds.map(k => clientLinkLabel(k, booking).toLowerCase()).join(' + ')
    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: sentVia.length
        ? `Links sent to customer (${what}) via ${sentVia.join(' + ')}${failures.length ? `; ${failures.join('; ')}` : ''}`
        : `Links NOT sent (${what}): ${failures.join('; ')}`,
      newData: { links: kinds, sent_via: sentVia },
    })

    if (sentVia.length === 0) {
      return NextResponse.json({ error: failures.join(' ') || 'Nothing was sent', failures }, { status: 502 })
    }
    // The send went out: a booking link in it approves the party (lib/linkApproval.ts).
    const approval = linkSendApproves(booking.status, kinds)
      ? await approveOnLinkSend(supabase, { bookingId: id, status: String(booking.status), actor: adminActorId(req), via: sentVia.join(' + ') })
      : 'skipped'
    return NextResponse.json({ ok: true, action: 'client_links_sent', sentVia, failures, approved: approval === 'approved', approvalFailed: approval === 'failed' })
  }

  // A plain message to the customer in the manager's words (no links). The same guards as
  // send_client_links: explicit confirm, not for a cancelled or lost party, a real address,
  // 8am-9pm Eastern, a STOP on file refuses the text, every refusal changes nothing, and the
  // send is written to the booking's own change log (which is also how the assistant knows
  // the first, introduced message has gone).
  if (action === 'send_message') {
    if (body.confirm !== true) return NextResponse.json({ error: 'Sending to a client must be confirmed' }, { status: 400 })
    const wantsEmail = body.email === true
    const wantsSms = body.sms === true
    if (!wantsEmail && !wantsSms) return NextResponse.json({ error: 'Pick email, text, or both' }, { status: 400 })
    if (booking.status === 'cancelled' || booking.status === 'lost') {
      return NextResponse.json({ error: `This booking is ${booking.status} — nothing was sent.` }, { status: 409 })
    }
    const email = typeof booking.contact_email === 'string' ? booking.contact_email.trim() : ''
    const phone = typeof booking.contact_phone === 'string' ? booking.contact_phone.trim() : ''
    if (wantsEmail && !isPlausibleEmailAddress(email)) {
      return NextResponse.json({ error: 'No valid email address on this booking. Nothing was sent.' }, { status: 409 })
    }
    if (wantsSms && !phone) return NextResponse.json({ error: 'No phone number on this booking. Nothing was sent.' }, { status: 409 })

    const problems: string[] = []
    let subject = ''
    let emailBody = ''
    let smsBody = ''
    if (wantsEmail) {
      const s = screenSubject(body.emailSubject)
      const b = screenBody(body.emailBody, 'email')
      if (!s.ok) problems.push(s.reason); else subject = s.text
      if (!b.ok) problems.push(b.reason); else emailBody = b.text
    }
    if (wantsSms) {
      const b = screenBody(body.smsBody, 'text')
      if (!b.ok) problems.push(b.reason)
      else if (!/\bstop\b/i.test(b.text)) problems.push('A text must carry the opt-out line ("Reply STOP to opt out").')
      else smsBody = b.text
    }
    // No links in a free-form message: a brace means a placeholder that would be sent as-is.
    for (const t of [subject, emailBody, smsBody]) if (/[{}]/.test(t)) problems.push('A plain message cannot carry link placeholders. Send links with send_client_links.')
    if (problems.length > 0) return NextResponse.json({ error: problems.join(' '), problems }, { status: 400 })

    let smsBlocked: string | null = null
    if (wantsSms) {
      const quiet = checkSmsQuietHours(new Date())
      const stop = quiet.kind === 'open' ? await phoneHasExplicitStop(supabase, phone) : null
      if (quiet.kind !== 'open') smsBlocked = 'Text NOT sent — it is outside 8am–9pm. Send again after 8am.'
      else if (stop === 'stopped') smsBlocked = 'Text NOT sent — this number has a STOP (opt-out) on file.'
      else if (stop !== 'clear') smsBlocked = 'Text NOT sent — could not check this number for a STOP. Try again.'
    }
    const sendSms = wantsSms && !smsBlocked
    if (!wantsEmail && !sendSms) return NextResponse.json({ error: smsBlocked, failures: [smsBlocked] }, { status: 409 })

    const sentVia: string[] = []
    const failures: string[] = smsBlocked ? [smsBlocked] : []
    if (wantsEmail) {
      if (!process.env.RESEND_API_KEY) {
        failures.push('Email is not configured')
      } else {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || `noReply@mail.${TENANT.business.apexHost}`
        const { error: mailErr } = await resend.emails.send({
          from, to: email, replyTo: ownerEmail(),
          subject,
          html: clientLinksEmailHtml(emailBody, {}),
          text: emailBody,
        })
        if (mailErr) failures.push(`Email failed: ${mailErr.message}`)
        else sentVia.push('email')
      }
    }
    if (sendSms) {
      const sid = await sendSMSVia('quo', normalizePhone(phone), smsBody)
      if (sid) sentVia.push('text')
      else failures.push('Text failed to send — check the number and Quo config')
    }

    const sample = (wantsEmail ? emailBody : smsBody).replace(/\s+/g, ' ').slice(0, 120)
    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: sentVia.length
        ? `Message sent to customer via ${sentVia.join(' + ')}${failures.length ? `; ${failures.join('; ')}` : ''}: "${sample}"`
        : `Message NOT sent: ${failures.join('; ')}`,
      newData: { sent_via: sentVia },
    })
    if (sentVia.length === 0) return NextResponse.json({ error: failures.join(' ') || 'Nothing was sent', failures }, { status: 502 })
    return NextResponse.json({ ok: true, action: 'message_sent', sentVia, failures })
  }

  // Text the customer their pre-arrival check-in link. Any staff may do this.
  if (action === 'send_checkin_link') {
    if (!booking.contact_phone) {
      return NextResponse.json({ error: 'No phone number on file for this booking' }, { status: 400 })
    }

    // A text to a customer: 8am-9pm Eastern and never to a STOP, like every other send. This
    // action used to mint the link and text it with neither check.
    const quietNow = checkSmsQuietHours(new Date())
    if (quietNow.kind !== 'open') {
      return NextResponse.json({ error: 'The check-in text was NOT sent: it is outside 8am-9pm Eastern. Send it after 8am.' }, { status: 409 })
    }
    const stopNow = await phoneHasExplicitStop(supabase, String(booking.contact_phone))
    if (stopNow !== 'clear') {
      return NextResponse.json({
        error: stopNow === 'stopped'
          ? 'The check-in text was NOT sent: this number has a STOP (opt-out) on file.'
          : 'The check-in text was NOT sent: could not check this number for a STOP. Try again.',
      }, { status: 409 })
    }

    let result
    try {
      result = await sendCheckinLinkSms(booking)
    } catch (err) {
      console.error('admin:send_checkin_link error:', err)
      return NextResponse.json({ error: 'Could not generate the check-in link' }, { status: 500 })
    }

    if (!result.sent) {
      return NextResponse.json(
        { error: `Failed to send check-in link — ${result.reason}` },
        { status: 502 },
      )
    }

    // Make sure the automatic sends exist too. A booking created before this
    // feature shipped has no reminder rows; this backfills them on first send.
    await enqueueCheckinReminders({
      partyType: booking.party_type,
      bookingRef: booking.booking_ref,
      contactEmail: booking.contact_email,
      partyDate: booking.party_date,
      partyTime: booking.party_time,
    })

    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: `Check-in link texted to ${booking.contact_phone}`,
    })

    return NextResponse.json({ ok: true, action: 'checkin_link_sent', to: booking.contact_phone })
  }

  // ── "📷 Photo Booth Album" — email + text the customer their Fotoshare link ──
  // A deliberate human action: the admin pastes the link, reads the preview
  // (built by the same `photoAlbumText` this sends), and confirms. The link is
  // saved to `photo_gallery_url` first, so it is on the booking even if a send
  // fails. A second send of the same album needs `resend: true`, because there
  // is no way to un-send a text.
  if (action === 'send_photo_album') {
    if (body.confirm !== true) {
      return NextResponse.json({ error: 'Sending to a client must be confirmed' }, { status: 400 })
    }
    const album = screenFotoshareUrl(body.url)
    if (!album.ok) return NextResponse.json({ error: album.reason }, { status: 400 })
    const occ = screenOccasion(body.occasion)
    if (!occ.ok) return NextResponse.json({ error: occ.reason }, { status: 400 })

    const wantsEmail = body.email !== false
    const wantsSms = body.sms !== false
    if (!wantsEmail && !wantsSms) {
      return NextResponse.json({ error: 'Pick email, text, or both' }, { status: 400 })
    }
    if (booking.status === 'cancelled') {
      return NextResponse.json({ error: 'This booking is cancelled — nothing was sent.' }, { status: 409 })
    }
    const email = typeof booking.contact_email === 'string' ? booking.contact_email.trim() : ''
    const phone = typeof booking.contact_phone === 'string' ? booking.contact_phone.trim() : ''
    if (wantsEmail && !isPlausibleEmailAddress(email)) {
      return NextResponse.json({ error: 'No valid email address on this booking — untick Email or fix it first.' }, { status: 409 })
    }
    if (wantsSms && !phone) {
      return NextResponse.json({ error: 'No phone number on this booking — untick Text or add one first.' }, { status: 409 })
    }

    // Already sent? Three outcomes: a failed read is not "never sent".
    const { data: prior, error: priorErr } = await supabase
      .from('booking_modifications')
      .select('created_at, change_summary')
      .eq('booking_id', id)
      .like('change_summary', `${PHOTO_ALBUM_SENT_SUMMARY_PREFIX}%`)
      .order('created_at', { ascending: false })
      .limit(1)
    if (priorErr) {
      return NextResponse.json({ error: 'Could not check whether the album was already sent — try again. Nothing was sent.' }, { status: 503 })
    }
    if (prior && prior.length > 0 && body.resend !== true) {
      return NextResponse.json(
        { error: 'The photo album was already sent for this party.', alreadySent: true, lastSentAt: prior[0].created_at, lastSummary: prior[0].change_summary },
        { status: 409 },
      )
    }

    const { error: saveErr } = await supabase
      .from('bookings')
      .update({ photo_gallery_url: album.url, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (saveErr) {
      return NextResponse.json({ error: `Could not save the album link (${saveErr.message}) — nothing was sent.` }, { status: 503 })
    }

    const message = { contactName: booking.contact_name, occasion: occ.occasion, albumUrl: album.url }
    const text = photoAlbumText(message)
    const actor = adminActorId(req)
    const sentVia: string[] = []
    const failures: string[] = []

    if (wantsEmail) {
      if (!process.env.RESEND_API_KEY) {
        failures.push('Email is not configured')
      } else {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
        // "Please let me know if you have any issues" has to reach a person,
        // not the noReply sender.
        const { error: mailErr } = await resend.emails.send({
          from, to: email, replyTo: ownerEmail(),
          subject: PHOTO_ALBUM_SUBJECT,
          html: photoAlbumEmailHtml(message),
          text,
        })
        if (mailErr) failures.push(`Email failed: ${mailErr.message}`)
        else sentVia.push('email')
      }
    }

    if (wantsSms) {
      // TCPA/CTIA: 8am–9pm local. An admin pressing Send at 10pm gets the
      // email now and is told to resend the text in the morning — a text is
      // never queued silently behind their back.
      const quiet = checkSmsQuietHours(new Date())
      const stop = quiet.kind === 'open' ? await phoneHasExplicitStop(supabase, phone) : null
      if (quiet.kind !== 'open') {
        failures.push('Text NOT sent — it is outside 8am–9pm. Resend with only Text ticked after 8am.')
      } else if (stop !== 'clear') {
        failures.push(stop === 'stopped'
          ? 'Text NOT sent — this number has a STOP (opt-out) on file.'
          : 'Text NOT sent — could not check this number for a STOP. Try again.')
      } else {
        const sid = await sendSMSVia('quo', normalizePhone(phone), text)
        if (sid) sentVia.push('text')
        else failures.push('Text failed to send — check the number and Quo config')
      }
    }

    if (sentVia.length === 0) {
      await logBookingChange(supabase, {
        bookingId: id, actor,
        summary: `Photo booth album link saved; NOT sent (${failures.join('; ')})`,
      })
      return NextResponse.json({ error: failures.join(' ') || 'Nothing was sent', failures }, { status: 502 })
    }

    await logBookingChange(supabase, {
      bookingId: id, actor,
      summary: `${PHOTO_ALBUM_SENT_SUMMARY_PREFIX} via ${sentVia.join(' + ')}: ${album.url}`,
      newData: { photo_gallery_url: album.url, occasion: occ.occasion, sent_via: sentVia },
    })
    for (const channel of sentVia) {
      await writeLedger(supabase, {
        entityType: 'review_request',
        entityId: id,
        action: 'send',
        actor,
        meta: {
          job: 'photo_album', channel, booking_ref: booking.booking_ref,
          to: channel === 'email' ? email : phone, album_url: album.url,
        },
      })
    }

    return NextResponse.json({ ok: true, action: 'photo_album_sent', sentVia, failures, photoGalleryUrl: album.url })
  }

  // ── "Send photos" — party photos from the photo library, by email and/or a text link ──
  // Added with the admin chat overlay (`propose_send_photos`), but a normal admin
  // action: it replays every guard `send_client_links` has. The photos are
  // resolved ONLY through `findPhotos` (approved AND no identifiable child), the
  // text carries a short LINK to /p/<token> and never an MMS, the quiet-hours and
  // STOP checks run before anything is sent, and every outcome lands in the
  // booking's change log. The assistant sends explicit `photoIds` (the exact set
  // the manager saw on the card); a `filter` is accepted for any other caller.
  if (action === 'send_photos') {
    if (body.confirm !== true) {
      return NextResponse.json({ error: 'Sending to a client must be confirmed' }, { status: 400 })
    }
    const wantsEmail = body.email === true
    const wantsSms = body.sms === true
    if (!wantsEmail && !wantsSms) return NextResponse.json({ error: 'Pick email, text, or both' }, { status: 400 })
    if (booking.status === 'cancelled' || booking.status === 'lost') {
      return NextResponse.json({ error: `This booking is ${booking.status} — nothing was sent.` }, { status: 409 })
    }
    const email = typeof booking.contact_email === 'string' ? booking.contact_email.trim() : ''
    const phone = typeof booking.contact_phone === 'string' ? booking.contact_phone.trim() : ''
    if (wantsEmail && !isPlausibleEmailAddress(email)) {
      return NextResponse.json({ error: 'No valid email address on this booking — untick Email or fix it first.' }, { status: 409 })
    }
    if (wantsSms && !phone) {
      return NextResponse.json({ error: 'No phone number on this booking — untick Text or add one first.' }, { status: 409 })
    }

    const askedIds = Array.isArray(body.photoIds)
      ? Array.from(new Set((body.photoIds as unknown[]).filter((v): v is string => typeof v === 'string')))
      : []
    const f = (body.filter && typeof body.filter === 'object' ? body.filter : {}) as Record<string, unknown>
    const tag = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
    if (askedIds.length === 0 && !tag(f.partyType) && !tag(f.activity) && !tag(f.themeSlug)) {
      return NextResponse.json({ error: 'Name the photos (photoIds) or a filter (partyType / activity / themeSlug) — nothing was sent.' }, { status: 400 })
    }
    const found = await findPhotos(
      supabase,
      askedIds.length
        ? { ids: askedIds, limit: MAX_PHOTOS_PER_REQUEST }
        : { partyType: tag(f.partyType), activity: tag(f.activity), themeSlug: tag(f.themeSlug), limit: 6 },
    )
    if (found.kind !== 'ok') {
      return NextResponse.json({ error: 'Could not read the photo library — try again. Nothing was sent.' }, { status: 503 })
    }
    const photos = found.data
    if (photos.length === 0) {
      return NextResponse.json({ error: 'None of those photos are approved to send right now — nothing was sent.' }, { status: 409 })
    }
    if (askedIds.length && photos.length !== Math.min(askedIds.length, MAX_PHOTOS_PER_REQUEST)) {
      return NextResponse.json(
        { error: 'Some of those photos are no longer approved to send — ask for the photos again. Nothing was sent.' },
        { status: 409 },
      )
    }

    // The caller says the thread has already introduced us: this message then carries no
    // intro, sign-off or business name. The flag can only REMOVE words, never add them.
    const introduced = body.introduced === true

    // An edited text (the assistant's card lets the manager reword it): the
    // wording is theirs, the LINK is ours — `{photos}` is the one placeholder,
    // it must be present, and it is filled with the set's own page below.
    let smsTemplate: string | null = null
    if (wantsSms && body.smsBody !== undefined) {
      const t = screenBody(body.smsBody, 'text')
      if (!t.ok) return NextResponse.json({ error: t.reason }, { status: 400 })
      const braces: string[] = t.text.match(/\{[^{}]*\}/g) ?? []
      if (!braces.includes('{photos}') || braces.some(p => p !== '{photos}')) {
        return NextResponse.json({ error: 'The text needs {photos} (and no other {link}) so the photo page link is in it.' }, { status: 400 })
      }
      smsTemplate = t.text
    }

    // The text is checked BEFORE anything is created or sent, exactly as in
    // send_client_links: a text-only send outside 8am–9pm, or to a STOPped
    // number, changes nothing at all.
    let smsBlocked: string | null = null
    if (wantsSms) {
      const quiet = checkSmsQuietHours(new Date())
      const stop = quiet.kind === 'open' ? await phoneHasExplicitStop(supabase, phone) : null
      if (quiet.kind !== 'open') smsBlocked = 'Text NOT sent — it is outside 8am–9pm. Send again with only Text ticked after 8am.'
      else if (stop === 'stopped') smsBlocked = 'Text NOT sent — this number has a STOP (opt-out) on file.'
      else if (stop !== 'clear') smsBlocked = 'Text NOT sent — could not check this number for a STOP. Try again.'
    }
    const sendEmail = wantsEmail
    const sendSms = wantsSms && !smsBlocked
    if (!sendEmail && !sendSms) return NextResponse.json({ error: smsBlocked, failures: [smsBlocked] }, { status: 409 })

    const set = await createPhotoSet(supabase, { bookingId: id, photoIds: photos.map(p => p.id), actor: adminActorId(req) })
    if (!set.ok) return NextResponse.json({ error: `${set.error} Nothing was sent.` }, { status: 503 })

    const sentVia: string[] = []
    const failures: string[] = smsBlocked ? [smsBlocked] : []

    if (sendEmail) {
      if (!process.env.RESEND_API_KEY) {
        failures.push('Email is not configured')
      } else {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || TENANT.email.noReplyFrom
        const { error: mailErr } = await resend.emails.send({
          from, to: email, replyTo: ownerEmail(),
          subject: introduced ? PHOTOS_EMAIL_SUBJECT_INTRODUCED : PHOTOS_EMAIL_SUBJECT,
          html: photosEmailHtml(booking.contact_name, photos, set.url, introduced),
          text: photosEmailText(booking.contact_name, photos, set.url, introduced),
        })
        if (mailErr) failures.push(`Email failed: ${mailErr.message}`)
        else sentVia.push('email')
      }
    }

    if (sendSms) {
      // A LINK, never an MMS: one short segment that opens the photo set page.
      const sid = await sendSMSVia(
        'quo',
        normalizePhone(phone),
        smsTemplate ? smsTemplate.replace(/\{photos\}/g, set.url) : photosSmsText(booking.contact_name, set.url, photos.length, introduced),
      )
      if (sid) sentVia.push('text')
      else failures.push('Text failed to send — check the number and Quo config')
    }

    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: sentVia.length
        ? `Photos sent to customer (${photos.length}) via ${sentVia.join(' + ')}${failures.length ? `; ${failures.join('; ')}` : ''}`
        : `Photos NOT sent (${photos.length}): ${failures.join('; ')}`,
      newData: { photo_ids: photos.map(p => p.id), sent_via: sentVia },
    })

    if (sentVia.length === 0) {
      return NextResponse.json({ error: failures.join(' ') || 'Nothing was sent', failures }, { status: 502 })
    }
    return NextResponse.json({ ok: true, action: 'photos_sent', sentVia, failures, count: photos.length })
  }

  if (action === 'delete_booking') {
    // Hard delete — children (line items, payments, modifications, portal tokens)
    // cascade automatically. Used to purge test/duplicate bookings.
    // Every upcoming event naming this ref, not only the stored one — duplicates
    // were common, and a deleted booking's stray event blocks a slot forever.
    const cleared = await clearBookingCalendar(booking.booking_ref, booking.google_calendar_event_id as string | null)
    if (!cleared.ok) console.error(`delete_booking ${booking.booking_ref}: calendar not cleared:`, cleared.error)

    const { error } = await supabase.from('bookings').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, action: 'booking_deleted' })
  }

  // Change ONE existing line in place (price, quantity, name, description, flags). The
  // only other way to fix a typo'd price was remove + add, which loses the sort position
  // and, for the assistant, two cards where one will do. Not for lines the system derives:
  // the rental fee (edit_rental) and "Additional Guests" (the guest count) own their
  // numbers. A discount stays a discount: the sign of a line cannot be flipped here.
  if (action === 'edit_line_item') {
    const lineId = typeof body.line_item_id === 'string' ? body.line_item_id : ''
    if (!lineId) return NextResponse.json({ error: 'line_item_id required' }, { status: 400 })
    const { data: li, error: liReadErr } = await supabase
      .from('booking_line_items')
      .select('id, name, category, quantity, unit_price_cents, guest_multiplied, description, is_optional, is_featured')
      .eq('id', lineId).eq('booking_id', id).maybeSingle()
    if (liReadErr) return NextResponse.json({ error: `Could not read the line: ${liReadErr.message}` }, { status: 500 })
    if (!li) return NextResponse.json({ error: 'That line is not on this booking' }, { status: 404 })
    if (li.category === 'rental') {
      return NextResponse.json({ error: 'The rental fee follows the rental window: use edit_rental.' }, { status: 400 })
    }
    if (EXTRA_GUESTS_NAME.test(String(li.name).trim()) && li.category === 'theme') {
      return NextResponse.json({ error: 'Additional Guests follows the guest count: change the guest count instead.' }, { status: 400 })
    }
    const patch: Record<string, unknown> = {}
    if (body.unit_price_cents !== undefined) {
      const c = Number(body.unit_price_cents)
      if (!Number.isSafeInteger(c) || Math.abs(c) > 1_000_000) return NextResponse.json({ error: 'unit_price_cents must be a whole number of cents within $10,000' }, { status: 400 })
      if ((c < 0) !== (li.unit_price_cents < 0) && c !== 0 && li.unit_price_cents !== 0) {
        return NextResponse.json({ error: 'A discount stays a discount and a charge stays a charge: remove the line and add a new one to change its sign.' }, { status: 400 })
      }
      patch.unit_price_cents = c
    }
    if (body.quantity !== undefined) {
      const q = Math.floor(Number(body.quantity))
      if (!(q >= 1 && q <= 100)) return NextResponse.json({ error: 'quantity must be 1-100' }, { status: 400 })
      patch.quantity = q
    }
    if (body.name !== undefined) {
      const n = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
      if (!n) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
      patch.name = n
    }
    if (body.description !== undefined) {
      patch.description = typeof body.description === 'string' && body.description.trim() ? body.description.trim().slice(0, 400) : null
    }
    if (body.is_optional !== undefined) patch.is_optional = body.is_optional === true
    if (body.is_featured !== undefined) patch.is_featured = body.is_featured === true
    if (body.guest_multiplied !== undefined) {
      patch.guest_multiplied = body.guest_multiplied === true
      patch.price_type = body.guest_multiplied === true ? 'per_person' : 'flat'
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })

    const { data: wrote, error: liErr } = await supabase
      .from('booking_line_items').update(patch).eq('id', lineId).eq('booking_id', id).select('id')
    if (liErr || !wrote?.length) {
      return NextResponse.json({ error: `Line item NOT changed: ${liErr?.message || 'no row matched'}` }, { status: 500 })
    }
    const totals = await recalcTotals(supabase, id, booking)
    const changedKeys = Object.keys(patch)
    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: `Edited line item "${li.name}": ` + changedKeys.map(k => `${k} ${String((li as Record<string, unknown>)[k] ?? '-')} -> ${String(patch[k] ?? '-')}`).join(', ') +
        (totals.ok ? ` — total now ${formatMoney(totals.totalCents)}` : ` — TOTAL NOT RECALCULATED (${totals.message})`),
    })
    return NextResponse.json({
      ok: true,
      action: 'line_item_edited',
      totalsUpdated: totals.ok,
      ...(totals.ok ? { totalCents: totals.totalCents, balanceCents: totals.balanceCents } : { warning: `The line was changed but the invoice total could not be recalculated (${totals.message}).` }),
    })
  }

  // Menu choices and requests the host made in the planner. They live in `quote_snapshot`
  // (that is where the planner and the portal read them) and price nothing.
  // Swap an in-studio theme party to another studio theme, toggle the mini-party discount,
  // or convert a mobile party to an in-studio theme party. The theme line and its price come
  // from the catalogue row (never from the card), the extra-guest line and totals follow.
  // Activity lines are NOT re-derived (they depend on the whole selection); the response says so.
  if (action === 'change_theme') {
    if (booking.event_type === 'studio-rental') {
      return NextResponse.json({ error: 'A studio rental has no theme.' }, { status: 400 })
    }
    const themeId = typeof body.theme_id === 'string' ? body.theme_id : ''
    if (!themeId) return NextResponse.json({ error: 'theme_id required' }, { status: 400 })
    const { data: item, error: itemErr } = await supabase
      .from('pricing_items').select('id, name, category, price_cents, is_active').eq('id', themeId).maybeSingle()
    if (itemErr) return NextResponse.json({ error: `Could not read the theme: ${itemErr.message}` }, { status: 500 })
    if (!item || item.category !== 'party-theme' || item.is_active === false) {
      return NextResponse.json({ error: 'That is not an active studio theme' }, { status: 400 })
    }
    const { data: liRows, error: liErr } = await supabase
      .from('booking_line_items').select('id, name, category, pricing_item_id, unit_price_cents, quantity').eq('booking_id', id)
    if (liErr) return NextResponse.json({ error: `Could not read the invoice lines: ${liErr.message}` }, { status: 500 })
    const li = (liRows ?? []) as { id: string; name: string; category: string; pricing_item_id: string | null; unit_price_cents: number; quantity: number }[]
    const mobileLines = li.filter(r => r.category === 'mobile-package')
    const fromMobile = body.from_mobile === true
    if (mobileLines.length && !fromMobile) {
      return NextResponse.json({ error: 'This is a mobile party. Say you are converting it (from_mobile) to swap its package for a studio theme.' }, { status: 400 })
    }
    const snap = { ...(((booking.quote_snapshot as Record<string, unknown> | null)) || {}) } as Record<string, unknown>
    const isMini = body.mini !== undefined ? body.mini === true : snap.isMiniParty === true
    const catalog = await loadPricingCatalog(supabase)
    const price = Math.max(0, item.price_cents - (isMini ? catalog.guestRules.miniPartyDiscountCents : 0))
    const oldTheme = li.find(r => r.category === 'theme' && r.pricing_item_id)

    if (fromMobile && mobileLines.length) {
      const { error: delErr } = await supabase.from('booking_line_items').delete().in('id', mobileLines.map(r => r.id)).eq('booking_id', id)
      if (delErr) return NextResponse.json({ error: `Mobile package NOT removed: ${delErr.message}` }, { status: 500 })
    }
    const themeWrite = oldTheme
      ? await supabase.from('booking_line_items').update({ name: item.name, unit_price_cents: price, pricing_item_id: item.id, quantity: 1, price_type: 'flat', guest_multiplied: false }).eq('id', oldTheme.id).eq('booking_id', id).select('id')
      : await supabase.from('booking_line_items').insert({ booking_id: id, name: item.name, category: 'theme', pricing_item_id: item.id, quantity: 1, unit_price_cents: price, price_type: 'flat', guest_multiplied: false, sort_order: 0 }).select('id')
    if (themeWrite.error || !themeWrite.data?.length) {
      return NextResponse.json({ error: `Theme line NOT changed: ${themeWrite.error?.message || 'no row matched'}` }, { status: 500 })
    }

    const tags = { ...(((booking.party_tags as Record<string, unknown> | null)) || {}) } as Record<string, unknown>
    if (fromMobile) tags.location_type = 'studio'
    const { data: bookingWrite, error: bookingWriteErr } = await supabase.from('bookings').update({
      package_type: item.name,
      ...(fromMobile ? { party_type: 'in_studio_theme', party_tags: tags } : {}),
      quote_snapshot: { ...snap, theme: item.id, themeName: item.name, isMiniParty: isMini, ...(fromMobile ? { locationType: 'studio' } : {}) },
      updated_at: new Date().toISOString(),
    }).eq('id', id).select('id')
    if (bookingWriteErr || !bookingWrite?.length) {
      return NextResponse.json({ error: `Theme line changed but the booking was NOT updated: ${bookingWriteErr?.message || 'no row matched'}. Reload before quoting this customer.` }, { status: 500 })
    }

    const extraProblem = await syncExtraGuestsLine(supabase, id, booking.guest_count_approx)
    const totals = await recalcTotals(supabase, id, booking)
    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: `Theme ${oldTheme ? oldTheme.name : '(none)'} -> ${item.name}${isMini ? ' (mini party)' : ''}${fromMobile ? '; converted from a mobile party' : ''}` +
        (totals.ok ? ` — total now ${formatMoney(totals.totalCents)}` : ` — TOTAL NOT RECALCULATED (${totals.message})`),
    })
    const hasActivities = li.some(r => r.category === 'activity-add-on')
    const warnings = [
      extraProblem,
      totals.ok ? null : `the invoice total could not be recalculated (${totals.message})`,
      hasActivities ? 'the activity lines (included or upgrade) were not re-derived: review them against the new theme' : null,
    ].filter(Boolean)
    return NextResponse.json({
      ok: true,
      action: 'theme_changed',
      totalsUpdated: totals.ok,
      ...(totals.ok ? { totalCents: totals.totalCents, balanceCents: totals.balanceCents } : {}),
      ...(warnings.length ? { warning: `Theme changed, but ${warnings.join('; ')}.` } : {}),
    })
  }

  if (action === 'set_preferences') {
    const snap = { ...(((booking.quote_snapshot as Record<string, unknown> | null)) || {}) } as Record<string, unknown>
    const before: Record<string, unknown> = {}
    const set = (key: string, value: unknown) => { before[key] = snap[key] ?? null; snap[key] = value }
    if (body.pizzaOrBagels !== undefined) {
      if (body.pizzaOrBagels !== 'pizza' && body.pizzaOrBagels !== 'bagels') return NextResponse.json({ error: 'pizzaOrBagels must be pizza or bagels' }, { status: 400 })
      set('pizzaOrBagels', body.pizzaOrBagels)
    }
    if (body.cupcakeFlavor !== undefined) {
      if (body.cupcakeFlavor !== 'vanilla' && body.cupcakeFlavor !== 'chocolate') return NextResponse.json({ error: 'cupcakeFlavor must be vanilla or chocolate' }, { status: 400 })
      set('cupcakeFlavor', body.cupcakeFlavor)
    }
    for (const key of ['partyPreferences', 'characterRequest'] as const) {
      if (body[key] !== undefined) {
        if (typeof body[key] !== 'string' || (body[key] as string).length > 1000) return NextResponse.json({ error: `${key} must be text under 1000 characters` }, { status: 400 })
        set(key, (body[key] as string).trim())
      }
    }
    if (Object.keys(before).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
    const { data: wrote, error: prefErr } = await supabase
      .from('bookings').update({ quote_snapshot: snap, updated_at: new Date().toISOString() }).eq('id', id).select('id')
    if (prefErr || !wrote?.length) {
      return NextResponse.json({ error: `Preferences NOT saved: ${prefErr?.message || 'no row matched'}` }, { status: 500 })
    }
    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: 'Party preferences updated: ' + Object.keys(before).join(', '),
      oldData: before,
    })
    return NextResponse.json({ ok: true, action: 'preferences_set', changed: Object.keys(before) })
  }

  if (action === 'add_line_item') {
    const { name, category, quantity, unit_price_cents, guest_multiplied } = body
    // The three columns the invoice page lays itself out from (migration 035).
    // Omitted means the column default, exactly as before.
    const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim().slice(0, 400) : null
    const isFeatured = body.is_featured === true
    const isOptional = body.is_optional === true
    if (!name || unit_price_cents === undefined) {
      return NextResponse.json({ error: 'name and unit_price_cents required' }, { status: 400 })
    }

    const maxSort = (await supabase
      .from('booking_line_items')
      .select('sort_order')
      .eq('booking_id', id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()
    ).data?.sort_order ?? 0

    const { error: liErr } = await supabase.from('booking_line_items').insert({
      booking_id: id,
      name,
      category: category || (unit_price_cents < 0 ? 'discount' : 'add-on'),
      quantity: quantity || 1,
      unit_price_cents,
      price_type: guest_multiplied ? 'per_person' : 'flat',
      guest_multiplied: !!guest_multiplied,
      sort_order: maxSort + 1,
      description,
      is_featured: isFeatured,
      is_optional: isOptional,
    })
    // This changes the invoice. Answering `{ok:true}` over a refused insert is
    // the version of rule 10 that costs money.
    if (liErr) {
      return NextResponse.json({ error: `Line item NOT added: ${liErr.message}` }, { status: 500 })
    }

    const totals = await recalcTotals(supabase, id, booking)
    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: `Added line item: ${name} (${formatMoney(unit_price_cents)})` +
        (totals.ok ? ` — total now ${formatMoney(totals.totalCents)}` : ` — TOTAL NOT RECALCULATED (${totals.message})`),
    })

    return NextResponse.json({
      ok: true,
      action: 'line_item_added',
      totalsUpdated: totals.ok,
      ...(totals.ok ? { totalCents: totals.totalCents, balanceCents: totals.balanceCents } : { warning: `The line item was added but the invoice total could not be recalculated (${totals.message}). Reload before quoting this customer.` }),
    })
  }

  if (action === 'remove_line_item') {
    const { line_item_id } = body
    if (!line_item_id) return NextResponse.json({ error: 'line_item_id required' }, { status: 400 })

    // Three outcomes (rule 12): a failed read is not "no such line item".
    const { data: li, error: liReadErr } = await supabase
      .from('booking_line_items')
      .select('name')
      .eq('id', line_item_id)
      .eq('booking_id', id)
      .maybeSingle()

    if (liReadErr) {
      return NextResponse.json(
        { error: `Could not load that line item (${liReadErr.message}) — nothing was removed.` },
        { status: 503 },
      )
    }
    if (!li) return NextResponse.json({ error: 'Line item not found' }, { status: 404 })

    // Scoped to this booking as well as the id — the read was, and the delete
    // was not, so a line_item_id belonging to another party would have been
    // deleted by a caller who could not even see it.
    const { data: removed, error: delErr } = await supabase
      .from('booking_line_items')
      .delete()
      .eq('id', line_item_id)
      .eq('booking_id', id)
      .select('id')
    if (delErr) {
      return NextResponse.json({ error: `Line item NOT removed: ${delErr.message}` }, { status: 500 })
    }
    if (!removed?.length) {
      return NextResponse.json({ error: 'Line item not found' }, { status: 404 })
    }

    const totals = await recalcTotals(supabase, id, booking)
    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: `Removed line item: ${li.name}` +
        (totals.ok ? ` — total now ${formatMoney(totals.totalCents)}` : ` — TOTAL NOT RECALCULATED (${totals.message})`),
    })

    return NextResponse.json({
      ok: true,
      action: 'line_item_removed',
      totalsUpdated: totals.ok,
      ...(totals.ok ? { totalCents: totals.totalCents, balanceCents: totals.balanceCents } : { warning: `The line item was removed but the invoice total could not be recalculated (${totals.message}).` }),
    })
  }

  // Studio rental: change start/end time → re-price the rental fee + recompute balance.
  if (action === 'edit_rental') {
    if (booking.event_type !== 'studio-rental') {
      return NextResponse.json({ error: 'Not a studio rental booking' }, { status: 400 })
    }
    const startTime = body.startTime as string
    const endTime = body.endTime as string
    if (!startTime || !endTime) return NextResponse.json({ error: 'startTime and endTime required' }, { status: 400 })

    const applied = await applyRentalWindow(supabase, id, booking, { startTime, endTime })
    if (!applied.ok) return NextResponse.json({ error: applied.error }, { status: applied.status })

    // A moved window moves the check-in texts too (the PATCH path always did).
    await rescheduleCheckin(id)

    await logBookingChange(supabase, {
      bookingId: id, actor: adminActorId(req),
      summary: `Rental time → ${startTime}–${endTime} (${applied.rate.hours} hrs); rental fee ${formatMoney(applied.rate.rentalCents)}`,
    })

    return NextResponse.json({
      ok: true, action: 'rental_edited', rentalCents: applied.rate.rentalCents, hours: applied.rate.hours,
      ...(applied.totalCents !== undefined ? { totalCents: applied.totalCents, balanceCents: applied.balanceCents } : {}),
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

/**
 * Re-price a studio rental for a new date and/or window and keep everything that
 * hangs off it in step: the rental line (updated in place, or created), the
 * `rental_*` and `is_weekend` tags, `party_time`, the totals and the calendar.
 * `edit_rental` and the date/time PATCH both come here (the PATCH used to write
 * the column and stop, so moving a rental from a weekday to a weekend kept the
 * weekday price). Every write is checked: an `ok` over a stale total is the
 * version of this that costs money.
 */
async function applyRentalWindow(
  supabase: ReturnType<typeof getSupabase>,
  id: string,
  booking: Record<string, unknown>,
  change: { startTime: string; endTime: string; partyDate?: string },
): Promise<
  | { ok: true; rate: RentalPrice; totalCents?: number; balanceCents?: number }
  | { ok: false; error: string; status: number }
> {
  const partyDate = change.partyDate ?? (booking.party_date as string)
  const tags = (booking.party_tags as Record<string, unknown> | null) || {}
  const { studioRates } = await loadPricingCatalog()
  const priced = priceRentalWindow(tags, partyDate, change.startTime, change.endTime, studioRates)
  if (!priced.ok) return { ok: false, error: priced.error, status: 400 }
  const rate = priced.rate

  const { data: rentalLi } = await supabase
    .from('booking_line_items').select('id').eq('booking_id', id).eq('category', 'rental').limit(1).maybeSingle()
  const rentalWrite = rentalLi
    ? await supabase.from('booking_line_items').update({
        name: rate.lineItemLabel, unit_price_cents: rate.unitCents, quantity: rate.quantity, guest_multiplied: false,
        ...(rate.description ? { description: rate.description } : {}),
      }).eq('id', rentalLi.id).select('id')
    : await supabase.from('booking_line_items').insert({
        booking_id: id, name: rate.lineItemLabel, category: 'rental', quantity: rate.quantity,
        unit_price_cents: rate.unitCents, price_type: 'flat', guest_multiplied: false, sort_order: 0,
        ...(rate.description ? { description: rate.description } : {}),
      }).select('id')
  if (rentalWrite.error || !rentalWrite.data?.length) {
    return { ok: false, error: `Rental fee NOT updated: ${rentalWrite.error?.message || 'no row matched'}`, status: 500 }
  }

  const { data: bookingWrite, error: bookingErr } = await supabase.from('bookings').update({
    party_time: change.startTime,
    ...(change.partyDate ? { party_date: change.partyDate } : {}),
    party_tags: { ...tags, rental_start_time: change.startTime, rental_end_time: change.endTime, rental_hours: rate.hours, is_weekend: rate.isWeekend },
    updated_at: new Date().toISOString(),
  }).eq('id', id).select('id')
  if (bookingErr || !bookingWrite?.length) {
    return { ok: false, error: `Rental fee was updated but the times were NOT saved: ${bookingErr?.message || 'no row matched'}`, status: 500 }
  }

  const totals = await recalcTotals(supabase, id, booking)
  if (!totals.ok) {
    return { ok: false, error: `Rental updated but the invoice total could not be recalculated (${totals.message}). Reload before quoting this customer.`, status: 500 }
  }
  await syncCalendar(supabase, id)
  return { ok: true, rate, totalCents: totals.totalCents, balanceCents: totals.balanceCents }
}

/** Re-enqueue the check-in texts from the booking's current date and time. */
async function rescheduleCheckin(id: string): Promise<void> {
  const supabase = getSupabase()
  const { data: fresh } = await supabase
    .from('bookings').select('booking_ref, contact_email, party_date, party_time, checkin_status, party_type').eq('id', id).single()
  if (fresh && fresh.checkin_status !== 'complete') {
    await enqueueCheckinReminders({
      partyType: fresh.party_type,
      bookingRef: fresh.booking_ref, contactEmail: fresh.contact_email, partyDate: fresh.party_date, partyTime: fresh.party_time,
    })
  }
}
