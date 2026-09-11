/**
 * "Draft reply with agent" — drafting a plan the agent never heard about.
 *
 * Phase 4 item 5. Most leads arrive through a channel the agent watches, but
 * two do not: a phone call Allie takes, and a plan Adam types into the admin
 * New Party form. Both produce a `bookings` row with no `ingested_messages`
 * event, so nothing ever triggers a draft. This is the button that does.
 *
 * ── Why it enqueues an event instead of just calling the draft node ─────────
 *
 * Because the event IS the audit record and the idempotency key. Every other
 * draft in the system is anchored to one, `/review/[token]` and the admin Inbox
 * both read events, and the partial unique index on
 * `inquiry_drafts(inbound_event_id)` is half of what stops a double draft. A
 * hand-made draft with no event would be the one row in the system nobody could
 * explain the provenance of.
 *
 * ── The double-draft problem, and the three things that stop it ─────────────
 *
 * A button is clickable twice, and the cost of a mistake here is Adam's phone
 * buzzing twice about the same customer — the exact failure the SAFETY NOTE at
 * the top of lib/plan.ts is about. Three layers, cheapest first:
 *
 *   1. A live-draft precheck on the booking, so the common double-click is a
 *      409 and does not even leave a junk event row behind.
 *   2. `claimInboundEvent()` — the SAME compare-and-swap the dispatcher uses.
 *      If the cron happens to pick the event up first, this call loses the
 *      race, returns `claimed_elsewhere`, and does not draft.
 *   3. The DB's partial unique indexes on `inquiry_drafts(booking_id)` and
 *      `(inbound_event_id)` for live drafts. `draftForInquiry` already turns a
 *      23505 into `skipped`, so even a true simultaneous double-click ends with
 *      one draft and one text.
 *
 * The event is recorded as `source='system'` and the dispatcher knows how to
 * draft for one (see /api/cron/agent-dispatch). That matters: if this request
 * dies between the insert and the claim, the cron picks the event up two
 * minutes later instead of the lead being silently lost — the standing
 * "a transient failure must not be terminal" rule.
 */

import { getSupabase } from '@/lib/supabase'
import { recordInboundEvent, claimInboundEvent, finishEvent, type InboundEvent } from './events'
import { draftForInquiry, type DraftOutcome } from './draftInquiry'
import { agentEnabled } from './config'
import type { InquiryBooking } from '@/lib/inquiryDrafts'

type Supa = ReturnType<typeof getSupabase>

/** The `bookings` columns a hand-made draft needs. */
export const MANUAL_DRAFT_BOOKING_COLUMNS =
  'id, booking_ref, status, party_type, source, event_type, package_type, notes, party_tags, ' +
  'contact_name, contact_email, contact_phone, party_date, party_time, guest_count_approx, child_name, child_age'

export interface ManualDraftBooking extends InquiryBooking {
  id: string
  booking_ref?: string | null
  status?: string | null
}

export type ManualDraftResult =
  | { ok: true; status: 200; eventId: string; draftId: string; reviewCode: string; draftStatus: string; reviewersTexted: number }
  // `reviewCode` rides along on a `live_draft` refusal so the admin UI can link
  // to the draft it is telling you to handle instead of leaving you to go and
  // find it. The message already named the code; only the UI could not use it.
  | { ok: false; status: number; error: string; eventId?: string; reviewCode?: string | null; reason?: 'live_draft' | 'claimed_elsewhere' | 'disabled' | 'unreachable' }

/**
 * Enqueue an event for this plan and draft a reply for it.
 *
 * @param note Optional free text from the admin — a phone-call summary. It is
 *   the body of the event, so it reaches the draft prompt as the customer's own
 *   words would. Treated as untrusted data by the prompt like any other body.
 */
export async function draftForBookingByHand(args: {
  supabase?: Supa
  bookingId: string
  actor?: string
  note?: string | null
}): Promise<ManualDraftResult> {
  const supabase = args.supabase ?? getSupabase()
  const actor = args.actor ?? 'ADMIN'

  if (!agentEnabled()) {
    return { ok: false, status: 409, error: 'AGENT_ENABLED is off — turn it on to draft', reason: 'disabled' }
  }

  const { data: bookingRow, error: readErr } = await supabase
    .from('bookings')
    .select(MANUAL_DRAFT_BOOKING_COLUMNS)
    .eq('id', args.bookingId)
    .maybeSingle()
  if (readErr || !bookingRow) {
    return { ok: false, status: 404, error: 'Booking not found' }
  }
  const booking = bookingRow as unknown as ManualDraftBooking

  // Nothing to reply to, and nowhere to send it. Checked here so the button
  // says so instead of producing a draft addressed to nobody.
  if (!booking.contact_email && !booking.contact_phone) {
    return {
      ok: false,
      status: 422,
      error: 'This plan has no email or phone — add one before drafting a reply',
      reason: 'unreachable',
    }
  }

  // Layer 1: the ordinary double-click. `draftForInquiry` would catch this too,
  // but only after creating an event we would then have to explain.
  const { data: live, error: liveErr } = await supabase
    .from('inquiry_drafts')
    .select('id, review_code, status')
    .eq('booking_id', args.bookingId)
    .not('status', 'in', '(sent,cancelled)')
    .limit(1)
  if (liveErr) {
    // "I could not tell" is not "there is none". Drafting on an unknown is how
    // a customer gets two quotes; refuse and let the admin retry.
    console.error('draftForBookingByHand live-draft lookup error:', liveErr.message)
    return { ok: false, status: 503, error: 'Could not check for an existing draft — try again' }
  }
  if (live && live.length > 0) {
    const row = live[0] as { review_code: string | null; status: string | null }
    return {
      ok: false,
      status: 409,
      error: `${row.review_code ?? 'A draft'} is already open for this plan (${row.status}). Handle that one first.`,
      reviewCode: row.review_code ?? null,
      reason: 'live_draft',
    }
  }

  const eventId = await recordInboundEvent({
    supabase,
    source: 'system',
    route: 'admin-draft-with-agent',
    bookingId: args.bookingId,
    fromAddress: booking.contact_email ?? booking.contact_phone ?? null,
    subject: `Manual draft request for ${booking.booking_ref ?? args.bookingId}`,
    body: args.note?.trim() || booking.notes || null,
    classification: 'admin_manual',
    parsed: {
      requested_by: actor,
      booking_ref: booking.booking_ref ?? null,
      // Mirrors what a website form would have supplied, so the draft node
      // reads the same shape whichever door the lead came in through.
      name: booking.contact_name ?? undefined,
      email: booking.contact_email ?? undefined,
      phone: booking.contact_phone ?? undefined,
      date: booking.party_date ?? undefined,
      time: booking.party_time ?? undefined,
      guests: booking.guest_count_approx ?? undefined,
      eventType: booking.event_type ?? undefined,
      packageType: booking.package_type ?? undefined,
      notes: args.note?.trim() || undefined,
    },
  })
  if (!eventId) {
    return { ok: false, status: 500, error: 'Could not record the event for this draft' }
  }

  // Layer 2: the same claim the cron uses. Losing this race is a success for
  // the system — it means the dispatcher already has the event.
  const claimed = await claimInboundEvent(supabase, eventId)
  if (!claimed) {
    return {
      ok: false,
      status: 409,
      error: 'The agent picked this up already — the draft will appear in a moment',
      eventId,
      reason: 'claimed_elsewhere',
    }
  }

  // The booking is passed too, not just the event: the plan is the fuller
  // picture (it has been enriched by every touch so far) and it is what
  // item 6's missing-field logic reads.
  const outcome: DraftOutcome = await draftForInquiry({
    supabase,
    booking,
    event: claimed as InboundEvent,
    actor,
  })

  if (!outcome.ok) {
    // Layer 3 landed here: a racing click got the draft in first.
    if (outcome.skipped) {
      await finishEvent(supabase, eventId, 'handled', { error: outcome.error })
      return { ok: false, status: 409, error: outcome.error, eventId, reason: 'live_draft' }
    }
    await finishEvent(supabase, eventId, 'error', { error: outcome.error })
    return { ok: false, status: outcome.status, error: outcome.error, eventId }
  }

  await finishEvent(supabase, eventId, 'handled', {
    draftId: outcome.draftId,
    classification: 'admin_manual',
  })

  return {
    ok: true,
    status: 200,
    eventId,
    draftId: outcome.draftId,
    reviewCode: outcome.reviewCode,
    draftStatus: outcome.draftStatus,
    reviewersTexted: outcome.reviewersTexted,
  }
}
