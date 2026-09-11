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
import { generatePartyRef, calculateLineItemTotal, getDepositCents, computeCutoffDates } from '@/lib/partyPricing'
import { classifyPartyType, type PartyType } from '@/lib/inquiryDrafts'
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
  const totalCents = lineItems.length ? calculateLineItemTotal(lineItems, guestCount) : 0
  const depositCents = getDepositCents(totalCents)

  return {
    ...(input.extra ?? {}),
    lineItems,
    guestCount,
    totalCents,
    depositCents,
    balanceDueCents: Math.max(0, totalCents - depositCents),
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
 * Write `booking_line_items` for a plan. Non-fatal by contract: a failed line
 * item write must never lose the booking itself, which is how all three
 * previous call sites already behaved. Returns the number of rows written.
 */
export async function writeLineItems(
  supabase: Supa,
  bookingId: string,
  lineItems: BookingLineItem[],
  options: WriteLineItemsOptions = {},
): Promise<number> {
  try {
    if (options.replace) {
      const { error } = await supabase.from('booking_line_items').delete().eq('booking_id', bookingId)
      // Bail rather than insert on top of rows we failed to clear — doubling a
      // customer's invoice is far worse than leaving the old plan in place.
      if (error) {
        console.error('writeLineItems delete error (non-fatal):', error.message)
        return 0
      }
    }

    if (!lineItems.length) return 0

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
      console.error('writeLineItems insert error (non-fatal):', error.message)
      return 0
    }
    return rows.length
  } catch (err) {
    console.error('writeLineItems error (non-fatal):', err)
    return 0
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
      await enrichPlan(supabase, plan, input, { partyType, partyDate, tags })
      return { bookingId: plan.id, bookingRef: plan.booking_ref, partyType, reused: true }
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
  'id, booking_ref, party_type, party_date, party_time, guest_count_approx, contact_name, contact_email, contact_phone, notes, party_tags'

/** Discriminates "no open plan" from "the lookup did not work". */
type PlanLookup = { ok: true; plan: OpenPlanRow | null } | { ok: false }

/**
 * Quote a value for a PostgREST `or()` expression.
 *
 * The values here are typed by a stranger into a web form, and `or()` is a
 * STRUCTURED expression whose separator is a comma — so an unquoted value is an
 * injection point, not merely an escaping nicety. Confirmed against the live
 * PostgREST on 2026-09-11: a `contact_email` of
 *
 *     x@y.com,contact_phone.eq.6314008080
 *
 * turned `or=(contact_email.eq.<value>)` into a second, attacker-chosen
 * disjunct and returned two real production bookings that the intended filter
 * does not match. `findOpenPlan` would have handed one of them back as "this
 * person's open plan", and `enrichPlan` writes the new inquiry's name, notes and
 * tags onto whatever it is given — i.e. onto a stranger's booking, which then
 * feeds that stranger's next draft.
 *
 * Double quotes are PostgREST's own quoting; `"` and `\` inside the value are
 * backslash-escaped. Verified that the payload above returns no rows once
 * quoted.
 */
function orValue(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

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

async function findOpenPlan(
  supabase: Supa,
  q: { email: string | null; phone: string | null; partyDate: string | null },
): Promise<PlanLookup> {
  // "Same contact" is an OR over the two handles rather than an AND: a lead who
  // first texted (phone only) and then filled in the web form (email + phone)
  // is one person and must land on one plan.
  const handles: string[] = []
  if (q.email) handles.push(`contact_email.eq.${orValue(q.email)}`)
  for (const v of phoneMatchVariants(q.phone)) handles.push(`contact_phone.eq.${orValue(v)}`)
  if (!handles.length) return { ok: true, plan: null }

  const since = new Date(Date.now() - PLAN_REUSE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // Rule (a): same contact + same date. Checked first and without the 30-day
  // window — a party booked 8 months out is still obviously the same party.
  if (q.partyDate) {
    const { data, error } = await supabase
      .from('bookings')
      .select(OPEN_PLAN_COLUMNS)
      .in('status', OPEN_PLAN_STATUSES as unknown as string[])
      .eq('party_date', q.partyDate)
      .or(handles.join(','))
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) {
      console.error('findOpenPlan date-match error (non-fatal):', error.message)
      return { ok: false }
    }
    if (data?.length) return { ok: true, plan: data[0] as OpenPlanRow }
  }

  // Rule (b): same contact, any open plan in the last 30 days.
  const { data, error } = await supabase
    .from('bookings')
    .select(OPEN_PLAN_COLUMNS)
    .in('status', OPEN_PLAN_STATUSES as unknown as string[])
    .gte('created_at', since)
    .or(handles.join(','))
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) {
    console.error('findOpenPlan recent-match error (non-fatal):', error.message)
    return { ok: false }
  }
  return { ok: true, plan: (data?.[0] as OpenPlanRow) ?? null }
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
): Promise<void> {
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

  if (!Object.keys(patch).length) return

  const { error } = await supabase.from('bookings').update(patch).eq('id', plan.id)
  if (error) console.error('enrichPlan update error (non-fatal):', error.message)
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
