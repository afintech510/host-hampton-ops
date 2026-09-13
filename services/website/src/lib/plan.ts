/**
 * Party Plan — the one `bookings` row that carries a lead from first touch to
 * a booked party (Phase 4 of docs/booking-agent-plan.md).
 *
 * Before this module there were three divergent `quote_snapshot` writers
 * (`party-checkout`, `party-builder/save`, `admin/parties/create`) that each
 * built a slightly different JSON shape, and seven intake routes that created a
 * contact but no plan at all — so "what does this customer actually want?" was
 * scattered across `contact_interactions` metadata and a base64 URL.
 *
 * Three things live here:
 *   - `buildPlanSnapshot()` — the canonical `quote_snapshot` shape.
 *   - `writeLineItems()`    — the canonical `booking_line_items` write.
 *   - `ensureLeadPlan()`    — match-or-create the `status='lead'` row.
 *
 * SAFETY NOTE, read before changing `ensureLeadPlan`. `/api/cron/agent-dispatch`
 * sweeps `bookings` in `('pending_review','lead')` from the last 14 days and
 * drafts a customer reply (and texts the reviewer) for any with no draft. Making
 * every lead a plan therefore directly enlarges what that sweep picks up. The
 * only thing standing between that and Adam's phone buzzing twice per lead is
 * `bookingsWithAnyDraft()`, which matches on `inquiry_drafts.booking_id` — so
 * the plan MUST be created before `recordInboundEvent()` and its id passed in as
 * `bookingId`. The draft node reads `event.booking_id` (draftInquiry.ts:522) and
 * stamps it on the draft, which is what makes the sweep skip the row it already
 * handled through the event path. Create the plan after the event and every lead
 * gets drafted twice.
 *
 * That ordering is also why `first_touch_event_id` needs a SECOND write:
 * the event does not exist yet when the plan is inserted. `linkFirstTouchEvent()`
 * closes the loop after `recordInboundEvent()` returns an id. It is deliberately
 * a separate, fill-once, never-fatal call rather than a reordering — see its own
 * note below.
 */

import { getSupabase } from '@/lib/supabase'
import { generatePartyRef, getDepositCents, computeCutoffDates } from '@/lib/partyPricing'
import { billedTotalCents, quoteTimeBalanceCents } from '@/lib/planBalance'
import { classifyPartyType, type PartyType } from '@/lib/inquiryDrafts'
import { findBookingsByContactEmail } from '@/lib/contactLookup'
import type { BookingLineItem } from '@/types/booking-flow'

type Supa = ReturnType<typeof getSupabase>

export type PlanSource = 'website_form' | 'email' | 'sms' | 'admin' | 'phone' | 'walk_in'

/** Statuses that mean "this plan is still open and can absorb a new inquiry". */
export const OPEN_PLAN_STATUSES = ['lead', 'quoted'] as const

/** How far back `ensureLeadPlan` will reuse an open plan for the same contact. */
export const PLAN_REUSE_WINDOW_DAYS = 30

// ───────────────────────────────────────────────────────────────────────────
// Snapshot
// ───────────────────────────────────────────────────────────────────────────

export interface PlanSnapshotInput {
  lineItems?: BookingLineItem[]
  guestCount?: number | null
  packageType?: string | null
  /**
   * Which product this is. Only the stored balance reads it, and only once
   * needs-Adam 41 is ruled on — see `quoteTimeBalanceCents`. The planner does
   * not set it (it builds parties, never studio rentals), so it defaults to the
   * behaviour that has always been live.
   */
  partyType?: string | null
  /** Planner-specific structured selections, merged in so /load can restore the form. */
  extra?: Record<string, unknown>
}

export interface PlanSnapshot extends Record<string, unknown> {
  lineItems: BookingLineItem[]
  guestCount: number
  totalCents: number
  depositCents: number
  balanceDueCents: number
  packageType: string | null
  /** Bumped if the shape ever changes, so `/load` can migrate old rows. */
  version: number
}

/**
 * The canonical `quote_snapshot`. `extra` is spread FIRST so the computed
 * totals always win — a caller cannot accidentally persist a stale
 * `totalCents` it carried in from the client, which is exactly what the
 * planner's `quoteData` passthrough used to do.
 */
export function buildPlanSnapshot(input: PlanSnapshotInput): PlanSnapshot {
  const lineItems = input.lineItems ?? []
  // The planner sends 0 guests while the form is half-filled; 10 is the same
  // default admin/parties/create already used.
  const guestCount = input.guestCount && input.guestCount > 0 ? input.guestCount : 10
  // `billedTotalCents`, not `calculateLineItemTotal`: an optional add-on is
  // quoted and not charged, and this total becomes `bookings.total_cents`, which
  // the invoice recomputes from the same rows and would then disagree with.
  const totalCents = lineItems.length ? billedTotalCents(lineItems, guestCount) : 0
  const depositCents = getDepositCents(totalCents)

  return {
    ...(input.extra ?? {}),
    lineItems,
    guestCount,
    totalCents,
    depositCents,
    // Through the shared function, so needs-Adam 41's ruling reaches this writer
    // by flipping `COLUMN_FOLLOWS_INVOICE` rather than by finding it again.
    balanceDueCents: quoteTimeBalanceCents({ totalCents, depositCents, partyType: input.partyType ?? null }),
    packageType: input.packageType ?? null,
    version: 1,
  }
}

/** The money fields a `bookings` row derives from a snapshot. */
export function planTotals(snapshot: PlanSnapshot) {
  return {
    deposit_amount: snapshot.depositCents,
    total_cents: snapshot.totalCents,
    balance_due_cents: snapshot.balanceDueCents,
    card_fee_rate: 0.03,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Line items
// ───────────────────────────────────────────────────────────────────────────

export interface WriteLineItemsOptions {
  /** Delete the booking's existing rows first (an edit, not a create). */
  replace?: boolean
}

/**
 * What a line-item write actually did.
 *
 * Three outcomes, because on a REPLACE the two failure modes are not the same
 * thing and a caller that cannot tell them apart cannot tell a customer the
 * truth (hard-won rule 12):
 *
 *   `delete-failed` — the old rows are still there. The plan is stale but intact.
 *   `insert-failed` — the old rows are GONE and the new ones were refused. The
 *                     invoice is now EMPTY, which `loadPlanInvoice` renders as
 *                     $0. This is the one a human has to know about.
 *
 * `written` stays on every outcome so the old `=== lineItems.length` check keeps
 * working.
 */
export type WriteLineItemsResult =
  | { ok: true; written: number }
  | { ok: false; written: 0; outcome: 'delete-failed' | 'insert-failed'; message: string }

/**
 * Write `booking_line_items` for a plan. Non-fatal by contract: a failed line
 * item write must never lose the booking itself, which is how all three
 * previous call sites already behaved. Returns the number of rows written.
 *
 * Prefer `writeLineItemsResult` on any path a customer is told an outcome.
 */
export async function writeLineItems(
  supabase: Supa,
  bookingId: string,
  lineItems: BookingLineItem[],
  options: WriteLineItemsOptions = {},
): Promise<number> {
  return (await writeLineItemsResult(supabase, bookingId, lineItems, options)).written
}

export async function writeLineItemsResult(
  supabase: Supa,
  bookingId: string,
  lineItems: BookingLineItem[],
  options: WriteLineItemsOptions = {},
): Promise<WriteLineItemsResult> {
  try {
    if (options.replace) {
      const { error } = await supabase.from('booking_line_items').delete().eq('booking_id', bookingId)
      // Bail rather than insert on top of rows we failed to clear — doubling a
      // customer's invoice is far worse than leaving the old plan in place.
      if (error) {
        console.error('writeLineItems delete error (non-fatal):', error.message)
        return { ok: false, written: 0, outcome: 'delete-failed', message: error.message }
      }
    }

    if (!lineItems.length) return { ok: true, written: 0 }

    const rows = lineItems.map((item, idx) => ({
      booking_id: bookingId,
      pricing_item_id: item.pricing_item_id || null,
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      price_type: item.price_type,
      guest_multiplied: item.guest_multiplied,
      sort_order: item.sort_order ?? idx,
      // Migration 035 columns — the invoice page renders these.
      description: (item as { description?: string | null }).description ?? null,
      is_featured: (item as { is_featured?: boolean }).is_featured ?? false,
      is_optional: (item as { is_optional?: boolean }).is_optional ?? false,
    }))

    const { error } = await supabase.from('booking_line_items').insert(rows)
    if (error) {
      // On a REPLACE this is the expensive one: the delete above succeeded, so
      // the booking now has NO line items and `loadPlanInvoice` will render it
      // as $0. Say which booking, loudly, so it can be rebuilt.
      console.error(
        options.replace
          ? `writeLineItems insert error after a successful delete — booking ${bookingId} now has NO line items: ${error.message}`
          : `writeLineItems insert error (non-fatal): ${error.message}`,
      )
      return { ok: false, written: 0, outcome: 'insert-failed', message: error.message }
    }
    return { ok: true, written: rows.length }
  } catch (err) {
    console.error('writeLineItems error (non-fatal):', err)
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, written: 0, outcome: options.replace ? 'insert-failed' : 'delete-failed', message }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Lead plans
// ───────────────────────────────────────────────────────────────────────────

export interface EnsureLeadPlanInput {
  contactName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  /** ISO date (YYYY-MM-DD) if the form asked for one. */
  partyDate?: string | null
  partyTime?: string | null
  guestCount?: number | null
  childName?: string | null
  childAge?: number | null
  /** Free text used both as the booking note and as a classifier signal. */
  notes?: string | null
  /** What the form says this is, e.g. 'mobile party'. Feeds classifyPartyType. */
  eventType?: string | null
  packageType?: string | null
  /** Merged into `party_tags` — location_address, source page, form extras. */
  tags?: Record<string, unknown>
  source?: PlanSource
  firstTouchEventId?: string | null
  lineItems?: BookingLineItem[]
  snapshotExtra?: Record<string, unknown>
  supabase?: Supa
}

export interface EnsureLeadPlanResult {
  bookingId: string | null
  bookingRef: string | null
  partyType: PartyType
  /** True when an existing open plan absorbed this inquiry instead of a new row. */
  reused: boolean
  /**
   * On a REUSE, whether the enrichment write actually landed. A reused plan whose
   * update was refused carries none of this inquiry's detail, and the route must
   * not report that as recorded (rule 10).
   */
  enriched?: boolean
}

const NOT_CREATED: EnsureLeadPlanResult = {
  bookingId: null, bookingRef: null, partyType: 'unknown', reused: false,
}

/**
 * Find the open plan this inquiry belongs to, or create one.
 *
 * Match rule (plan §3.1): same contact AND same `party_date`, OR same contact
 * with an open `lead`/`quoted` plan in the last 30 days. "Same contact" is
 * email when we have one, else phone — an SMS-only lead has no email yet, which
 * is why migration 035 made `contact_email` nullable.
 *
 * NEVER throws and never blocks the route it is called from: the form must
 * succeed even if the agent tables are missing or a constraint rejects the row.
 */
export async function ensureLeadPlan(input: EnsureLeadPlanInput): Promise<EnsureLeadPlanResult> {
  const email = normalizeEmail(input.contactEmail)
  const phone = normalize(input.contactPhone)

  // The 035 CHECK requires one of the two; without either there is no plan to
  // make and no way to reply, so don't try.
  if (!email && !phone) return NOT_CREATED

  // Several of the intake forms take the date as free text ("mid-March",
  // "3/15 or 3/22"). `party_date` is a DATE column, so anything we cannot parse
  // is kept verbatim in party_tags for the draft node to ask about, rather than
  // failing the whole insert and losing the plan.
  const partyDate = coerceIsoDate(input.partyDate)
  const tags: Record<string, unknown> = { ...(input.tags ?? {}) }
  if (input.partyDate && !partyDate) tags.requested_date_text = input.partyDate

  const classification = classifyPartyType({
    event_type: input.eventType ?? null,
    package_type: input.packageType ?? null,
    notes: input.notes ?? null,
    party_tags: tags,
    child_name: input.childName ?? null,
    child_age: input.childAge ?? null,
  })
  const partyType = classification.partyType

  try {
    const supabase = input.supabase ?? getSupabase()

    const lookup = await findOpenPlan(supabase, { email, phone, partyDate })
    // "No open plan" and "I could not tell" are different answers, and only the
    // first justifies creating a row. Treating a failed lookup as "no match"
    // would give this lead a second plan, which earns its own draft and its own
    // text to the reviewer. Better to drop the plan and let the event path —
    // which still has the contact and the body — carry the lead this time.
    if (!lookup.ok) return { ...NOT_CREATED, partyType }
    if (lookup.plan) {
      const plan = lookup.plan
      const enriched = await enrichPlan(supabase, plan, input, { partyType, partyDate, tags })
      return { bookingId: plan.id, bookingRef: plan.booking_ref, partyType, reused: true, enriched }
    }

    const snapshot = buildPlanSnapshot({
      lineItems: input.lineItems,
      guestCount: input.guestCount,
      packageType: input.packageType,
      extra: input.snapshotExtra,
    })
    const cutoffs = partyDate ? computeCutoffDates(partyDate) : null

    const row: Record<string, unknown> = {
      booking_ref: generatePartyRef(),
      status: 'lead',
      party_type: partyType,
      source: input.source ?? 'website_form',
      first_touch_event_id: input.firstTouchEventId ?? null,
      // event_type is still NOT NULL with a 'kid-party' default; keep the form's
      // own words when it had any, they are the best classifier signal later.
      event_type: input.eventType || 'kid-party',
      party_date: partyDate,
      party_time: input.partyTime || null,
      package_type: input.packageType || null,
      guest_count_approx: input.guestCount && input.guestCount > 0 ? input.guestCount : null,
      child_name: input.childName || null,
      child_age: input.childAge ?? null,
      contact_name: input.contactName || null,
      contact_email: email,
      contact_phone: phone,
      notes: input.notes || null,
      party_tags: tags,
      modification_cutoff: cutoffs?.modificationCutoff ?? null,
      guest_count_cutoff: cutoffs?.guestCountCutoff ?? null,
      quote_snapshot: snapshot,
      ...planTotals(snapshot),
    }

    const { data, error } = await supabase.from('bookings').insert(row).select('id, booking_ref').single()
    if (error || !data) {
      console.error('ensureLeadPlan insert error (non-fatal):', error?.message)
      return { ...NOT_CREATED, partyType }
    }

    if (input.lineItems?.length) {
      await writeLineItems(supabase, data.id, input.lineItems)
    }

    return { bookingId: data.id, bookingRef: data.booking_ref, partyType, reused: false }
  } catch (err) {
    console.error('ensureLeadPlan error (non-fatal):', err)
    return { ...NOT_CREATED, partyType }
  }
}

/**
 * Stamp the event that first touched this plan, after the event exists.
 *
 * `bookings.first_touch_event_id` was added by migration 035 and, until now,
 * written by nobody: `ensureLeadPlan()` runs BEFORE `recordInboundEvent()` (it
 * must — see the safety note at the top of this file) so there is no event id
 * to insert. Reordering the two calls would fix the column and reintroduce the
 * double-text, which is a far worse trade.
 *
 * FILL-ONCE. It records the *first* touch, so a returning lead that reuses an
 * open plan must not overwrite it with today's event — hence the
 * `is('first_touch_event_id', null)` guard, which also makes a concurrent
 * second call a no-op rather than a race.
 *
 * NEVER throws: this is provenance, not the lead. A form submission that
 * succeeded must not fail because a bookkeeping column did not get set.
 */
export async function linkFirstTouchEvent(
  bookingId: string | null | undefined,
  eventId: string | null | undefined,
  supabase?: Supa,
): Promise<boolean> {
  if (!bookingId || !eventId) return false
  try {
    const db = supabase ?? getSupabase()
    const { data, error } = await db
      .from('bookings')
      .update({ first_touch_event_id: eventId })
      .eq('id', bookingId)
      .is('first_touch_event_id', null)
      .select('id')
    if (error) {
      console.error('linkFirstTouchEvent error (non-fatal):', error.message)
      return false
    }
    return (data ?? []).length === 1
  } catch (err) {
    console.error('linkFirstTouchEvent error (non-fatal):', err)
    return false
  }
}

interface OpenPlanRow {
  id: string
  booking_ref: string
  status?: string | null
  created_at?: string | null
  party_type: string | null
  party_date: string | null
  party_time: string | null
  guest_count_approx: number | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  notes: string | null
  party_tags: Record<string, unknown> | null
}

const OPEN_PLAN_COLUMNS =
  'id, booking_ref, status, party_type, party_date, party_time, guest_count_approx, contact_name, contact_email, contact_phone, notes, party_tags, created_at'

/** Discriminates "no open plan" from "the lookup did not work". */
type PlanLookup = { ok: true; plan: OpenPlanRow | null } | { ok: false }

/**
 * The stored spellings of a phone number worth matching against.
 *
 * `lib/plan.ts` was the one module that compared phone numbers as raw strings.
 * Everywhere else — `quo.ts`, `sendApproved.ts`, `reviewers.ts`, `ownerNotify.ts`
 * — runs `normalizePhone()` first, so the same person is `+16315551234` when
 * they text us (Phase 2 creates a `lead` plan for an unknown number) and
 * `631-555-1234` when they later type it into a form. Matching on the raw string
 * therefore fails to reuse the open plan, and a second plan is a second draft
 * and a second text to Adam's phone — the exact failure the SAFETY NOTE at the
 * top of this file exists to prevent, arriving through a different door.
 *
 * 41 of the 44 production `bookings` rows hold a non-E.164 phone, so matching
 * has to cover the legacy spellings rather than assume a normalised column.
 */
export function phoneMatchVariants(phone: string | null): string[] {
  if (!phone) return []
  const digits = phone.replace(/\D/g, '')
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  const variants = new Set<string>([phone])
  if (ten.length === 10) {
    variants.add(`+1${ten}`)
    variants.add(`1${ten}`)
    variants.add(ten)
    variants.add(`${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`)
    variants.add(`(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`)
  }
  return Array.from(variants)
}

/**
 * Find the open plan a new inquiry belongs to.
 *
 * ── TWO THINGS WERE WRONG WITH HOW THIS ASKED THE QUESTION ──
 *
 * **1. The email match was case-sensitive, and the tripwire could not see it.**
 * The filter was built as a raw PostgREST string — `contact_email.eq."<value>"`
 * inside an `.or()` — with the value lowercased on the way in. But
 * `bookings.contact_email` is plain `text` holding whatever the customer typed and
 * **9 of 61 live rows are not lowercase**, so an open plan belonging to one of
 * those customers could never be found. The consequence is not cosmetic: a missed
 * match creates a SECOND plan, which earns its own agent draft and its own text to
 * Adam's phone — the exact failure the safety note at the top of this file exists
 * to prevent, arriving through a different door. (Measured 2026-09-13: zero of the
 * nine are currently in `lead`/`quoted`, so nobody has been hit by it yet. An
 * admin typing a mixed-case address onto a lead is all it takes.)
 *
 * `contactIdentitySurface.test.ts` R1 fails the suite if any file outside
 * `lib/contactLookup.ts` filters an email column — and it passed this file for
 * two links, because R1 looks for `.eq('contact_email'`/`.ilike('contact_email'`
 * and the filter here was spelled inside a string handed to `.or()`. A rule that
 * greps for one spelling is satisfied by another. R1 now sees both, and this
 * lookup goes through `findBookingsByContactEmail`, which fetches candidates with
 * `ilike` and re-compares them exactly in JS.
 *
 * **2. `.or()` needed a hand-rolled quoter to be safe at all.** `orValue()` lived
 * here, forty lines above its only caller: a second implementation of what
 * `lib/postgrestFilter.ts` owns (rule 11), guarding against an injection that was
 * real and measured — `x@y.com,contact_phone.eq.6314008080` as a `contact_email`
 * added an attacker-chosen disjunct and returned two unrelated production
 * bookings, which `enrichPlan` would then have written a stranger's name and notes
 * onto. The `.or()` is gone entirely now. Phone variants go through `.in()`, which
 * PostgREST parameter-encodes, so `(631) 400-8080`'s parentheses are data rather
 * than syntax and there is nothing left to quote.
 *
 * Both handles are queried separately and merged, because "same contact" is an OR
 * over email and phone — a lead who first texted (phone only) and later filled in
 * the web form is one person and must land on one plan. If EITHER read fails the
 * whole lookup fails: a partial answer here creates a duplicate.
 */
async function findOpenPlan(
  supabase: Supa,
  q: { email: string | null; phone: string | null; partyDate: string | null },
): Promise<PlanLookup> {
  const phoneVariants = phoneMatchVariants(q.phone)
  if (!q.email && !phoneVariants.length) return { ok: true, plan: null }

  const since = new Date(Date.now() - PLAN_REUSE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const openStatuses = OPEN_PLAN_STATUSES as unknown as string[]
  const candidates: OpenPlanRow[] = []

  if (q.email) {
    // The limit applies to CANDIDATES, which are a superset of the answer, so it
    // is deliberately generous — a tight limit here hides a real row.
    const lookup = await findBookingsByContactEmail(supabase, q.email, OPEN_PLAN_COLUMNS, { limit: 200 })
    if (lookup.kind === 'unavailable') {
      console.error('findOpenPlan email-match error (non-fatal):', lookup.error)
      return { ok: false }
    }
    if (lookup.kind === 'found') {
      candidates.push(...(lookup.bookings as unknown as OpenPlanRow[]))
    }
  }

  if (phoneVariants.length) {
    const { data, error } = await supabase
      .from('bookings')
      .select(OPEN_PLAN_COLUMNS)
      .in('status', openStatuses)
      .in('contact_phone', phoneVariants)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) {
      console.error('findOpenPlan phone-match error (non-fatal):', error.message)
      return { ok: false }
    }
    candidates.push(...((data ?? []) as unknown as OpenPlanRow[]))
  }

  if (!candidates.length) return { ok: true, plan: null }

  // De-duplicate: a lead whose email AND phone both match appears twice.
  const byId = new Map<string, OpenPlanRow>()
  for (const row of candidates) if (!byId.has(row.id)) byId.set(row.id, row)

  // The status filter is applied in code as well as in the phone query, because
  // the email candidates come back unfiltered by status by design.
  const open = Array.from(byId.values())
    .filter(row => openStatuses.includes(String((row as unknown as { status?: string }).status ?? '')))
    .sort((a, b) => {
      const ta = Date.parse(String((a as unknown as { created_at?: string }).created_at ?? ''))
      const tb = Date.parse(String((b as unknown as { created_at?: string }).created_at ?? ''))
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0)
    })

  // Rule (a): same contact + same date, checked first and WITHOUT the 30-day
  // window — a party booked 8 months out is still obviously the same party.
  if (q.partyDate) {
    const sameDate = open.find(row => row.party_date === q.partyDate)
    if (sameDate) return { ok: true, plan: sameDate }
  }

  // Rule (b): same contact, any open plan in the last 30 days.
  const recent = open.find(row => {
    const created = String((row as unknown as { created_at?: string }).created_at ?? '')
    return created >= since
  })
  return { ok: true, plan: recent ?? null }
}

/**
 * A second touch usually carries something the first one didn't (a date, a
 * guest count, an address). Fill blanks only — never overwrite a field the
 * customer or Adam already set, and never clear one.
 */
async function enrichPlan(
  supabase: Supa,
  plan: OpenPlanRow,
  input: EnsureLeadPlanInput,
  incoming: { partyType: PartyType; partyDate: string | null; tags: Record<string, unknown> },
): Promise<boolean> {
  const { partyType, partyDate, tags } = incoming
  const patch: Record<string, unknown> = {}

  if (!plan.party_date && partyDate) patch.party_date = partyDate
  if (!plan.party_time && input.partyTime) patch.party_time = input.partyTime
  if (!plan.contact_name && input.contactName) patch.contact_name = input.contactName
  if (!plan.contact_email && normalizeEmail(input.contactEmail)) patch.contact_email = normalizeEmail(input.contactEmail)
  if (!plan.contact_phone && normalize(input.contactPhone)) patch.contact_phone = normalize(input.contactPhone)
  if (!plan.guest_count_approx && input.guestCount && input.guestCount > 0) {
    patch.guest_count_approx = input.guestCount
  }
  // An 'unknown' plan that a later, more specific form can classify gets
  // upgraded; a confident type is never downgraded to 'unknown'.
  if ((!plan.party_type || plan.party_type === 'unknown') && partyType !== 'unknown') {
    patch.party_type = partyType
  }

  // Tags merge (the new touch wins per key) — this is how a mobile lead's
  // location_address arrives on a plan that started as a bare contact form.
  if (Object.keys(tags).length) {
    patch.party_tags = { ...(plan.party_tags ?? {}), ...tags }
  }

  // Notes append rather than replace: both messages are evidence for the draft.
  if (input.notes && input.notes !== plan.notes) {
    patch.notes = plan.notes ? `${plan.notes}\n\n---\n${input.notes}` : input.notes
  }

  if (partyDate && !plan.party_date) {
    const cutoffs = computeCutoffDates(partyDate)
    patch.modification_cutoff = cutoffs.modificationCutoff
    patch.guest_count_cutoff = cutoffs.guestCountCutoff
  }

  if (!Object.keys(patch).length) return true

  // `.select()` so a write that matched NOTHING cannot pass for a write that
  // worked. `ensureLeadPlan` reports this to its caller as `enriched`, which is
  // what lets an intake route say whether this inquiry actually reached the plan
  // instead of answering `{ success: true }` either way (rules 10 and 19).
  const { data, error } = await supabase.from('bookings').update(patch).eq('id', plan.id).select('id')
  if (error) {
    console.error('enrichPlan update error (non-fatal):', error.message)
    return false
  }
  if ((data ?? []).length !== 1) {
    console.error(`enrichPlan matched ${(data ?? []).length} rows for plan ${plan.booking_ref} — nothing was stored`)
    return false
  }
  return true
}

function normalize(v: string | null | undefined): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s === '' ? null : s
}

/**
 * Accept a date only in the form Postgres will definitely take, and only if it
 * is a real calendar day. Deliberately strict: a wrong-but-parseable date on a
 * plan is worse than no date, because the draft node would stop asking for it.
 */
export function coerceIsoDate(v: string | null | undefined): string | null {
  const s = normalize(v)
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  // Round-trip catches 2026-02-30 and friends, which Date silently rolls over.
  const ok = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
  return ok ? s : null
}

/** Emails are matched with `.eq`, which is case-sensitive, so store them folded. */
function normalizeEmail(v: string | null | undefined): string | null {
  return normalize(v)?.toLowerCase() ?? null
}
