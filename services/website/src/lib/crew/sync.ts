/**
 * The booking → crew-party reconcile (spec §9). Runs from Allie's "Sync now"
 * and, from Phase 4, every cron tick. There is no "booking confirmed" hook to
 * hang this on — about twelve payment paths can make a party booked — so this
 * reads what IS and makes the crew side agree with it.
 *
 * Two halves on purpose:
 *
 *   - `planReconcile` is PURE. It takes the bookings, their money, their Party
 *     Helper lines and the crew parties that already exist, and says what to
 *     create, update and cancel. The admin overview calls it without writing
 *     anything to list the "needs a time" bookings, and the tests drive it with
 *     no database at all.
 *   - `applyReconcile` writes the plan, and every write is a CLAIM:
 *       * a create collides on `uq_crew_parties_booking` when another tick got
 *         there first, and that is "already there", not an error;
 *       * an update is conditioned on the `updated_at` it read, so two ticks
 *         can never both add the missing spots — the loser changes nothing and
 *         the next tick re-plans from what the winner wrote;
 *       * a cancel is conditioned on the party still being draft/published.
 *
 * What it never does: remove a spot (guest count down is a FLAG, `over_staffed`),
 * touch steps (a cancelled party costs nobody anything), publish anything (a new
 * party is a DRAFT, invisible to crew until Allie publishes it), or SEND. A
 * cancelled published party QUEUES `partyCancelled` rows in
 * `crew_notifications`; delivering them is Phase 4's sender, behind
 * CREW_ENABLED / CREW_SMS_ENABLED.
 *
 * Reads have three outcomes (lib/crew/db.ts rule 1): an unreadable bookings or
 * payments table stops the run with `unavailable` rather than reading as "no
 * bookings", which would look like every party had been cancelled.
 */

import type { getSupabase } from '@/lib/supabase'
import { bookingStage, type BookingStage } from '@/lib/bookingStatus'
import { sumPayments } from '@/lib/bookingBalance'
import { partyWindow, validPartyDate, PARTY_START_EARLIEST_MIN, PARTY_START_LATEST_MIN } from '@/lib/evites/partyWindow'
import { eviteLocationType, mobileAddressOf } from '@/lib/evites/location'
import { STUDIO_ADDRESS_LINE } from '@/lib/studioLocation'
import { etDateString, etToUtc, parseTime } from '@/lib/partyTime'
import { slotsForParty, slotRolesFor, type CrewSettings, type SlotRole } from '@/lib/crew/rules'
import {
  insertNotification, type CrewPartyRow, type CrewSlotRow, type PartyKind, type PartyWithSlots, type Read,
} from '@/lib/crew/db'
import { partyDayLabel, partyTimeLabel } from '@/lib/crew/view'

type Supa = ReturnType<typeof getSupabase>

/** The most spots a party can carry (`crew_parties_slots_override_check` and `max_slots` both stop at 10). */
export const MAX_PARTY_SLOTS = 10

/** `bookings` rows that are not parties, as the Booked and Parties tabs exclude them. */
const NON_PARTY_EVENT_TYPES = ['vendor_registration']

/** Flags the reconcile re-derives every run. */
export const DERIVED_FLAGS = [
  'over_staffed',     // more live spots than the party needs now (guest count went down)
  'needs_time',       // the booking has no usable start/end; the times shown are the last good ones
  'needs_address',    // a mobile party with no real address yet
  'not_booked',       // the booking is no longer booked (money refunded, status moved back)
  'no_helper',        // a studio rental whose Party Helper line has gone
  'per_hour_helper',  // the per-hour Party Helper item: quantity is hours, counted as one helper
  'unclassified',     // the booking's type no longer reads as a crew party type
] as const

/** Flags that stay until Allie clears them: the reconcile sets them, it never takes them away. */
export const STICKY_FLAGS = ['time_changed'] as const

export type CrewSyncFlag = (typeof DERIVED_FLAGS)[number] | (typeof STICKY_FLAGS)[number]

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface ReconcileBooking {
  id: string
  booking_ref: string
  status: string | null
  party_type: string | null
  event_type: string | null
  party_date: string | null
  party_time: string | null
  package_type: string | null
  guest_count_approx: number | null
  party_tags: unknown
  theme_name: string | null
  is_mini: unknown
  mobile_tier: string | null
  qs_tier: string | null
}

export interface HelperLine {
  booking_id: string
  name: string | null
  category: string | null
  pricing_item_id: string | null
  quantity: number | null
  is_optional: boolean | null
}

export interface HelperItem { id: string; name: string }

export interface ReconcileInputs {
  bookings: ReconcileBooking[]
  /** booking id → net money credited (`sumPayments`: refunds subtract). */
  paidByBooking: ReadonlyMap<string, number>
  helperLines: HelperLine[]
  helperItems: HelperItem[]
  /** Crew parties linked to any of `bookings`. */
  existing: PartyWithSlots[]
  /** Allie's crew row: never notified. */
  ownerId: string | null
}

// ── Pure helpers ────────────────────────────────────────────────────────────

const STUDIO_RENTAL_EVENT_TYPES = ['studio-rental', 'room-rental']

/**
 * The crew kind of a booking, or null when it is not one we staff.
 *
 * A studio rental is read from `party_type` OR the rental `event_type`: live
 * rentals created before `party_type` was written carry it null. Mobile is
 * `eviteLocationType`, which reads the planner's own location toggle before
 * `party_type` — the planner writes `in_studio_theme` even for a mobile plan.
 */
export function crewKindOf(b: Pick<ReconcileBooking, 'party_type' | 'event_type' | 'party_tags'>): Exclude<PartyKind, 'manual'> | null {
  const ev = (b.event_type ?? '').trim().toLowerCase()
  if (b.party_type === 'studio_rental' || STUDIO_RENTAL_EVENT_TYPES.includes(ev)) return 'studio_rental'
  if (b.party_type !== 'in_studio_theme' && b.party_type !== 'mobile_party') return null
  return eviteLocationType(b) === 'mobile' ? 'mobile_party' : 'in_studio_theme'
}

function isPerHourItem(name: string | null | undefined): boolean {
  return /per\s*hour|\/\s*h(?:ou)?r\b|hourly/i.test(name ?? '')
}

/**
 * Spec §9's v1 match rule. A line counts when it is not optional and either
 * references one of the Party Helper catalogue items, or is a hand-typed
 * `service-add-on` whose name starts "Party Helper". Spots = sum of quantity,
 * except the per-hour item, whose quantity is HOURS: one helper per such line
 * (Adam, 2026-10-26).
 */
export function partyHelperCount(lines: ReadonlyArray<HelperLine>, items: ReadonlyArray<HelperItem>): { count: number; perHour: boolean } {
  const itemIds = new Set(items.map(i => i.id))
  const perHourIds = new Set(items.filter(i => isPerHourItem(i.name)).map(i => i.id))
  let count = 0
  let perHour = false
  for (const li of lines) {
    if (li.is_optional) continue
    const byItem = !!li.pricing_item_id && itemIds.has(li.pricing_item_id)
    const byName = (li.category ?? '') === 'service-add-on' && /^party helper/i.test((li.name ?? '').trim())
    if (!byItem && !byName) continue
    const hourly = (li.pricing_item_id ? perHourIds.has(li.pricing_item_id) : false) || (!byItem && isPerHourItem(li.name))
    if (hourly) {
      count += 1
      perHour = true
      continue
    }
    const q = Number(li.quantity)
    count += Number.isFinite(q) && q > 0 ? Math.floor(q) : 1
  }
  return { count, perHour }
}

function tagsOf(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * A studio rental's window, from the rental tags the checkout writes
 * (`rental_start_time` / `rental_end_time` / `rental_hours`), on `party_date`
 * in Eastern time. The start obeys `partyWindow`'s 08:00–21:00 screen (a
 * "2:00" with no AM/PM is 2 AM and is not believed). No end and no hours is
 * "we do not know", never a guessed three hours.
 */
export function rentalWindow(b: Pick<ReconcileBooking, 'party_date' | 'party_time' | 'party_tags'>): { startsAt: Date; endsAt: Date } | null {
  const date = validPartyDate(b.party_date)
  if (!date) return null
  const tags = tagsOf(b.party_tags)
  const startRaw = str(tags.rental_start_time) ?? str(b.party_time)
  if (!startRaw) return null
  const st = parseTime(startRaw)
  if (!st || st.minutes > 59) return null
  const startMin = st.hours * 60 + st.minutes
  if (startMin < PARTY_START_EARLIEST_MIN || startMin > PARTY_START_LATEST_MIN) return null

  let endMin: number | null = null
  const endRaw = str(tags.rental_end_time)
  if (endRaw) {
    const en = parseTime(endRaw)
    if (en && en.minutes <= 59) endMin = en.hours * 60 + en.minutes
  } else {
    const hours = Number(tags.rental_hours)
    if (Number.isFinite(hours) && hours > 0 && hours <= 16) endMin = startMin + Math.round(hours * 60)
  }
  if (endMin == null || endMin <= startMin || endMin > 24 * 60) return null

  const startsAt = etToUtc(date, st.hours, st.minutes)
  const endsAt = new Date(startsAt.getTime() + (endMin - startMin) * 60_000)
  if (!Number.isFinite(startsAt.getTime())) return null
  return { startsAt, endsAt }
}

export function crewWindowFor(b: ReconcileBooking, kind: Exclude<PartyKind, 'manual'>): { startsAt: Date; endsAt: Date } | null {
  if (kind === 'studio_rental') return rentalWindow(b)
  const w = partyWindow({
    party_date: b.party_date,
    party_time: b.party_time,
    party_type: b.party_type,
    package_type: b.package_type,
    party_tags: b.party_tags,
    quote_snapshot: { isMiniParty: b.is_mini === true || b.is_mini === 'true', mobileTier: b.mobile_tier, tier: b.qs_tier },
  })
  return w ? { startsAt: w.startUtc, endsAt: w.endUtc } : null
}

/** The theme, in the order the portal reads it (lib/portalPartyDetails.ts). */
export function crewThemeOf(b: ReconcileBooking): string | null {
  const tags = tagsOf(b.party_tags)
  return str(b.theme_name) ?? str(tags.theme) ?? str(tags.party_theme) ?? str(b.package_type)
}

/** Never "Suite 7": the studio line, or the customer's real address. */
export function crewLocationOf(b: ReconcileBooking, kind: Exclude<PartyKind, 'manual'>): { location: string; needsAddress: boolean } {
  if (kind !== 'mobile_party') return { location: STUDIO_ADDRESS_LINE, needsAddress: false }
  const addr = mobileAddressOf(b)
  return addr ? { location: addr, needsAddress: false } : { location: 'Mobile party: address to be confirmed', needsAddress: true }
}

/**
 * What the crew read as the party's name. Never the child's name or the
 * family's: the title is shown to every crew member on the open board, and the
 * family's details belong to the people working it.
 */
export function crewTitleOf(kind: Exclude<PartyKind, 'manual'>, theme: string | null): string {
  if (kind === 'studio_rental') return 'Studio rental: Party Helper'
  if (kind === 'mobile_party') return theme && !/^mobile party$/i.test(theme) ? `Mobile: ${theme}` : 'Mobile party'
  return theme ?? 'Party'
}

/** Spots the party needs now, including the Lead. A rental needs the helpers bought, never the kid formula. */
export function neededSpots(
  kind: PartyKind, guestCount: number | null, slotsOverride: number | null, helpers: number, s: CrewSettings,
): number {
  if (slotsOverride != null && Number.isInteger(slotsOverride) && slotsOverride >= 1 && slotsOverride <= MAX_PARTY_SLOTS) {
    return slotsOverride
  }
  if (kind === 'studio_rental') return Math.min(MAX_PARTY_SLOTS, Math.max(0, helpers))
  return slotsForParty({ guestCount }, s)
}

/** The roles to ADD so `live` spots become `needed`: a Lead first if the party has none. Never a removal. */
export function rolesToAdd(liveSlots: ReadonlyArray<Pick<CrewSlotRow, 'role' | 'status'>>, needed: number): SlotRole[] {
  const live = liveSlots.filter(sl => sl.status !== 'cancelled')
  const missing = Math.max(0, Math.min(MAX_PARTY_SLOTS, needed) - live.length)
  if (missing === 0) return []
  const hasLead = live.some(sl => sl.role === 'lead')
  return hasLead ? Array.from({ length: missing }, () => 'crew' as const) : slotRolesFor(missing)
}

// ── The plan ────────────────────────────────────────────────────────────────

export interface CreatePlan {
  bookingId: string
  bookingRef: string
  row: {
    booking_id: string
    party_kind: PartyKind
    title: string
    theme: string | null
    starts_at: string
    ends_at: string
    guest_count: number | null
    location: string
    status: 'draft'
    sync_flags: string[]
    updated_by?: string
  }
  roles: SlotRole[]
}

export interface UpdatePlan {
  partyId: string
  bookingRef: string
  /** The compare-and-swap token: the row is only written if nobody touched it since we read it. */
  expectedUpdatedAt: string
  patch: Partial<Pick<CrewPartyRow, 'party_kind' | 'title' | 'theme' | 'starts_at' | 'ends_at' | 'guest_count' | 'location' | 'sync_flags'>>
  addRoles: SlotRole[]
}

export interface CancelPlan {
  partyId: string
  bookingRef: string
  stage: BookingStage
  wasPublished: boolean
  party: Pick<CrewPartyRow, 'id' | 'title' | 'theme' | 'starts_at' | 'ends_at'>
  /** Members holding a live assigned spot, never the owner. */
  notifyMemberIds: string[]
}

export interface ReconcilePlan {
  creates: CreatePlan[]
  updates: UpdatePlan[]
  cancels: CancelPlan[]
  /** Booked bookings with no usable time: no crew party is made (or the old times stand), and the admin view says so. */
  needsTime: string[]
  /** Booked bookings we do not staff because their type is not a crew party type. Shown, never guessed at. */
  unclassified: string[]
  /** Booked studio rentals with no Party Helper: correctly no crew. Counted so a missing helper line is visible. */
  rentalsWithoutHelper: string[]
  /** A crew party was cancelled but the booking is booked again. Never resurrected automatically. */
  reactivated: string[]
  /** Every linked live party's flags after this plan. */
  flagged: { bookingRef: string; partyId: string | null; flags: string[] }[]
}

function sortedFlags(flags: Iterable<string>): string[] {
  return Array.from(new Set(flags)).sort()
}

function sameFlags(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  const x = sortedFlags(a), y = sortedFlags(b)
  return x.length === y.length && x.every((v, i) => v === y[i])
}

const sameInstant = (a: string, b: Date) => new Date(a).getTime() === b.getTime()

export function planReconcile(inputs: ReconcileInputs, s: CrewSettings, now: Date): ReconcilePlan {
  const today = etDateString(now)
  const plan: ReconcilePlan = {
    creates: [], updates: [], cancels: [], needsTime: [], unclassified: [], rentalsWithoutHelper: [], reactivated: [], flagged: [],
  }
  const existingByBooking = new Map<string, PartyWithSlots>()
  for (const p of inputs.existing) if (p.party.booking_id) existingByBooking.set(p.party.booking_id, p)
  const linesByBooking = new Map<string, HelperLine[]>()
  for (const li of inputs.helperLines) {
    const l = linesByBooking.get(li.booking_id)
    if (l) l.push(li)
    else linesByBooking.set(li.booking_id, [li])
  }

  for (const b of inputs.bookings) {
    if (NON_PARTY_EVENT_TYPES.includes((b.event_type ?? '').trim().toLowerCase())) continue
    const date = validPartyDate(b.party_date)
    if (!date || date < today) continue

    const stage = bookingStage({ status: b.status, paidCents: inputs.paidByBooking.get(b.id) ?? 0, partyDate: date, today })
    const existing = existingByBooking.get(b.id) ?? null
    const live = existing && (existing.party.status === 'draft' || existing.party.status === 'published') ? existing : null

    // ── A cancelled or lost booking: cancel its crew party, cost nobody a step.
    if (stage === 'cancelled' || stage === 'lost') {
      if (live) {
        plan.cancels.push({
          partyId: live.party.id,
          bookingRef: b.booking_ref,
          stage,
          wasPublished: live.party.status === 'published',
          party: live.party,
          notifyMemberIds: Array.from(new Set(live.slots
            .filter(sl => sl.status === 'assigned' && sl.member_id && sl.member_id !== inputs.ownerId)
            .map(sl => sl.member_id as string))),
        })
      }
      continue
    }

    const kind = crewKindOf(b)
    const booked = stage === 'booked'
    const helpers = kind === 'studio_rental' ? partyHelperCount(linesByBooking.get(b.id) ?? [], inputs.helperItems) : { count: 0, perHour: false }

    // ── No crew party yet: create one, only for a booked, eligible, timed party.
    if (!existing) {
      if (!booked) continue
      if (!kind) { plan.unclassified.push(b.booking_ref); continue }
      if (kind === 'studio_rental' && helpers.count === 0) { plan.rentalsWithoutHelper.push(b.booking_ref); continue }
      const window = crewWindowFor(b, kind)
      if (!window) { plan.needsTime.push(b.booking_ref); continue }
      if (window.startsAt.getTime() <= now.getTime()) continue
      const theme = crewThemeOf(b)
      const loc = crewLocationOf(b, kind)
      const guestCount = Number.isFinite(b.guest_count_approx) && (b.guest_count_approx as number) > 0 ? b.guest_count_approx : null
      const flags: string[] = []
      if (loc.needsAddress) flags.push('needs_address')
      if (helpers.perHour) flags.push('per_hour_helper')
      const needed = neededSpots(kind, guestCount, null, helpers.count, s)
      plan.creates.push({
        bookingId: b.id,
        bookingRef: b.booking_ref,
        row: {
          booking_id: b.id,
          party_kind: kind,
          title: crewTitleOf(kind, theme),
          theme,
          starts_at: window.startsAt.toISOString(),
          ends_at: window.endsAt.toISOString(),
          guest_count: guestCount,
          location: loc.location,
          status: 'draft',
          sync_flags: sortedFlags(flags),
        },
        roles: slotRolesFor(Math.max(1, needed)),
      })
      plan.flagged.push({ bookingRef: b.booking_ref, partyId: null, flags: sortedFlags(flags) })
      continue
    }

    // ── A cancelled crew party whose booking is booked again: say so, never resurrect.
    if (!live) {
      if (existing.party.status === 'cancelled' && booked) plan.reactivated.push(b.booking_ref)
      continue
    }

    // ── An existing live party: bring its facts up to date, add spots, re-derive flags.
    const p = live.party
    const flags = new Set<string>((p.sync_flags ?? []).filter(f => (STICKY_FLAGS as readonly string[]).includes(f)))
    const patch: UpdatePlan['patch'] = {}
    let addRoles: SlotRole[] = []

    if (!booked) flags.add('not_booked')
    if (!kind) {
      flags.add('unclassified')
    } else {
      if (kind !== p.party_kind) patch.party_kind = kind
      const theme = crewThemeOf(b)
      const title = crewTitleOf(kind, theme)
      if (title !== p.title) patch.title = title
      if ((theme ?? null) !== (p.theme ?? null)) patch.theme = theme
      const loc = crewLocationOf(b, kind)
      if (loc.needsAddress) {
        flags.add('needs_address')
        // Keep a real address we already had rather than overwrite it with the placeholder.
      } else if (loc.location !== p.location) {
        patch.location = loc.location
      }
      const window = crewWindowFor(b, kind)
      if (!window) {
        flags.add('needs_time')
        plan.needsTime.push(b.booking_ref)
      } else if (!sameInstant(p.starts_at, window.startsAt) || !sameInstant(p.ends_at, window.endsAt)) {
        patch.starts_at = window.startsAt.toISOString()
        patch.ends_at = window.endsAt.toISOString()
        if (live.slots.some(sl => sl.status === 'assigned')) flags.add('time_changed')
      }
      if (kind === 'studio_rental') {
        if (helpers.count === 0) flags.add('no_helper')
        if (helpers.perHour) flags.add('per_hour_helper')
      }
    }

    const guestCount = Number.isFinite(b.guest_count_approx) && (b.guest_count_approx as number) > 0 ? b.guest_count_approx : null
    if ((guestCount ?? null) !== (p.guest_count ?? null)) patch.guest_count = guestCount

    const kindNow = (patch.party_kind ?? p.party_kind) as PartyKind
    const needed = neededSpots(kindNow, guestCount, p.slots_override, helpers.count, s)
    const liveSlots = live.slots.filter(sl => sl.status !== 'cancelled')
    // Spots are added only for a booked party we still recognise; never removed.
    if (booked && kind && !(kind === 'studio_rental' && helpers.count === 0)) addRoles = rolesToAdd(liveSlots, needed)
    if (liveSlots.length > needed) flags.add('over_staffed')

    const nextFlags = sortedFlags(flags)
    if (!sameFlags(nextFlags, p.sync_flags ?? [])) patch.sync_flags = nextFlags
    if (Object.keys(patch).length > 0 || addRoles.length > 0) {
      plan.updates.push({ partyId: p.id, bookingRef: b.booking_ref, expectedUpdatedAt: p.updated_at, patch, addRoles })
    }
    plan.flagged.push({ bookingRef: b.booking_ref, partyId: p.id, flags: nextFlags })
  }

  plan.flagged = plan.flagged.filter(f => f.flags.length > 0)
  return plan
}

// ── Reading the inputs ──────────────────────────────────────────────────────

const BOOKING_COLUMNS =
  'id, booking_ref, status, party_type, event_type, party_date, party_time, package_type, guest_count_approx, party_tags, ' +
  'theme_name:quote_snapshot->>themeName, is_mini:quote_snapshot->isMiniParty, ' +
  'mobile_tier:quote_snapshot->>mobileTier, qs_tier:quote_snapshot->>tier'

const CHUNK = 150

async function chunked<T>(ids: string[], read: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Read<T[]>> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await read(ids.slice(i, i + CHUNK))
    if (error) return { kind: 'unavailable', error: error.message }
    out.push(...((data ?? []) as T[]))
  }
  return { kind: 'ok', data: out }
}

/** Everything `planReconcile` needs, read in one pass per table. Any failed read fails the whole load. */
export async function loadReconcileInputs(sb: Supa, now: Date): Promise<Read<ReconcileInputs>> {
  const today = etDateString(now)
  const { data: bRows, error: bErr } = await sb.from('bookings').select(BOOKING_COLUMNS)
    .gte('party_date', today).order('party_date', { ascending: true })
  if (bErr) return { kind: 'unavailable', error: `bookings: ${bErr.message}` }
  const bookings = (bRows ?? []) as unknown as ReconcileBooking[]
  const ids = bookings.map(b => b.id)

  const pays = await chunked<{ booking_id: string; amount_cents: number | null; payment_type: string | null }>(
    ids, c => sb.from('booking_payments').select('booking_id, amount_cents, payment_type').in('booking_id', c))
  if (pays.kind !== 'ok') return { kind: 'unavailable', error: `booking_payments: ${pays.error}` }
  const payByBooking = new Map<string, { amount_cents: number | null; payment_type: string | null }[]>()
  for (const p of pays.data) {
    const l = payByBooking.get(p.booking_id)
    if (l) l.push(p)
    else payByBooking.set(p.booking_id, [p])
  }
  const paidByBooking = new Map<string, number>()
  for (const [id, rows] of Array.from(payByBooking.entries())) paidByBooking.set(id, sumPayments(rows))

  const rentalIds = bookings.filter(b => crewKindOf(b) === 'studio_rental').map(b => b.id)
  const lines = await chunked<HelperLine>(rentalIds, c => sb.from('booking_line_items')
    .select('booking_id, name, category, pricing_item_id, quantity, is_optional').in('booking_id', c))
  if (lines.kind !== 'ok') return { kind: 'unavailable', error: `booking_line_items: ${lines.error}` }

  const { data: items, error: iErr } = await sb.from('pricing_items').select('id, name').ilike('name', 'party helper%')
  if (iErr) return { kind: 'unavailable', error: `pricing_items: ${iErr.message}` }

  const parties = await chunked<CrewPartyRow>(ids, c => sb.from('crew_parties').select('*').in('booking_id', c))
  if (parties.kind !== 'ok') return { kind: 'unavailable', error: `crew_parties: ${parties.error}` }
  const slots = await chunked<CrewSlotRow>(parties.data.map(p => p.id), c => sb.from('crew_slots').select('*').in('party_id', c))
  if (slots.kind !== 'ok') return { kind: 'unavailable', error: `crew_slots: ${slots.error}` }

  const { data: owner, error: oErr } = await sb.from('crew_members').select('id').eq('is_owner', true).limit(1)
  if (oErr) return { kind: 'unavailable', error: `crew_members: ${oErr.message}` }

  return {
    kind: 'ok',
    data: {
      bookings,
      paidByBooking,
      helperLines: lines.data,
      helperItems: (items ?? []) as HelperItem[],
      existing: parties.data.map(party => ({ party, slots: slots.data.filter(sl => sl.party_id === party.id) })),
      ownerId: ((owner ?? []) as { id: string }[])[0]?.id ?? null,
    },
  }
}

// ── Applying it ─────────────────────────────────────────────────────────────

export interface ReconcileSummary {
  created: number
  /** A create that found another tick's party already there. */
  alreadyThere: number
  updated: number
  /** An update another writer beat us to; the next run re-plans it. */
  raced: number
  cancelled: number
  spotsAdded: number
  /** `partyCancelled` rows QUEUED (never sent here). */
  notificationsQueued: number
  needsTime: string[]
  unclassified: string[]
  rentalsWithoutHelper: string[]
  reactivated: string[]
  flagged: { bookingRef: string; partyId: string | null; flags: string[] }[]
  errors: string[]
}

export type ReconcileResult =
  | { kind: 'ok'; summary: ReconcileSummary }
  | { kind: 'unavailable'; error: string }

async function insertSlots(sb: Supa, partyId: string, roles: SlotRole[]): Promise<{ ok: true; n: number } | { ok: false; error: string }> {
  if (roles.length === 0) return { ok: true, n: 0 }
  const { data, error } = await sb.from('crew_slots').insert(roles.map(role => ({ party_id: partyId, role }))).select('id')
  if (error) return { ok: false, error: error.message }
  return { ok: true, n: (data ?? []).length }
}

/** Queue (never send) the cancellation notice for one member, on each channel they could receive. */
async function queueCancelled(
  sb: Supa, c: CancelPlan, member: { id: string; email: string | null; phone: string | null; email_opt_in: boolean; sms_opt_in: boolean },
): Promise<{ queued: number; errors: string[] }> {
  const payload = {
    party_id: c.partyId,
    theme: c.party.theme ?? c.party.title,
    day_label: partyDayLabel(c.party.starts_at),
    time_label: partyTimeLabel(c.party.starts_at, c.party.ends_at),
    reason: c.stage,
  }
  const channels: ('in_app' | 'email' | 'sms')[] = ['in_app']
  if (member.email_opt_in && member.email) channels.push('email')
  if (member.sms_opt_in && member.phone) channels.push('sms')
  let queued = 0
  const errors: string[] = []
  for (const channel of channels) {
    const r = await insertNotification(sb, {
      member_id: member.id, channel, template: 'partyCancelled', status: 'queued',
      dedupe_key: `party_cancelled:${c.partyId}:${member.id}`, payload,
    })
    if (r.kind === 'inserted') queued++
    else if (r.kind === 'failed') errors.push(`${c.bookingRef}: notification ${channel}: ${r.error}`)
  }
  return { queued, errors }
}

/** Who the reconcile writes as when no admin pressed the button (the cron). */
export const SYNC_ACTOR = 'system:crew-sync'

export async function applyReconcile(sb: Supa, plan: ReconcilePlan, actor: string = SYNC_ACTOR): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    created: 0, alreadyThere: 0, updated: 0, raced: 0, cancelled: 0, spotsAdded: 0, notificationsQueued: 0,
    needsTime: plan.needsTime, unclassified: plan.unclassified, rentalsWithoutHelper: plan.rentalsWithoutHelper,
    reactivated: plan.reactivated, flagged: plan.flagged, errors: [],
  }

  for (const c of plan.creates) {
    const { data, error } = await sb.from('crew_parties').insert({ ...c.row, updated_by: actor }).select('id').maybeSingle()
    if (error) {
      // uq_crew_parties_booking: another tick made it. That is the idempotency, not a fault.
      if ((error as { code?: string }).code === '23505') { summary.alreadyThere++; continue }
      summary.errors.push(`${c.bookingRef}: create: ${error.message}`)
      continue
    }
    const id = (data as { id: string } | null)?.id
    if (!id) { summary.errors.push(`${c.bookingRef}: create returned no row`); continue }
    summary.created++
    const s = await insertSlots(sb, id, c.roles)
    // A party left without its spots is re-planned next run: rolesToAdd puts the Lead back first.
    if (!s.ok) summary.errors.push(`${c.bookingRef}: spots: ${s.error}`)
    else summary.spotsAdded += s.n
    const flagged = summary.flagged.find(f => f.bookingRef === c.bookingRef && f.partyId === null)
    if (flagged) flagged.partyId = id
  }

  for (const u of plan.updates) {
    // The claim: write only if nobody has touched the row since we read it. The
    // updated_at trigger moves it, so the loser of two concurrent runs matches 0 rows.
    // Spots to add with no field to change still take the claim: the write is
    // then just `updated_by`, and the trigger moves updated_at.
    const write: Record<string, unknown> = { ...u.patch, updated_by: actor }
    const { data, error } = await sb.from('crew_parties')
      .update(write)
      .eq('id', u.partyId).eq('updated_at', u.expectedUpdatedAt).in('status', ['draft', 'published'])
      .select('id')
    if (error) { summary.errors.push(`${u.bookingRef}: update: ${error.message}`); continue }
    if ((data ?? []).length === 0) { summary.raced++; continue }
    summary.updated++
    const s = await insertSlots(sb, u.partyId, u.addRoles)
    if (!s.ok) summary.errors.push(`${u.bookingRef}: spots: ${s.error}`)
    else summary.spotsAdded += s.n
  }

  for (const c of plan.cancels) {
    const now = new Date().toISOString()
    const { data, error } = await sb.from('crew_parties').update({ status: 'cancelled', cancelled_at: now, updated_by: actor })
      .eq('id', c.partyId).in('status', ['draft', 'published']).select('id')
    if (error) { summary.errors.push(`${c.bookingRef}: cancel: ${error.message}`); continue }
    if ((data ?? []).length === 0) { summary.raced++; continue }
    summary.cancelled++

    // Spots go with it; the member stays on the row so the history says who was on it.
    const { data: slotRows, error: sErr } = await sb.from('crew_slots').update({ status: 'cancelled' })
      .eq('party_id', c.partyId).in('status', ['open', 'assigned']).select('id')
    if (sErr) summary.errors.push(`${c.bookingRef}: cancel spots: ${sErr.message}`)
    const slotIds = ((slotRows ?? []) as { id: string }[]).map(r => r.id)
    if (slotIds.length > 0) {
      const { error: wErr } = await sb.from('crew_swap_requests').update({ status: 'cancelled', resolved_at: now })
        .in('slot_id', slotIds).in('status', ['open', 'escalated']).select('id')
      if (wErr) summary.errors.push(`${c.bookingRef}: cancel cover requests: ${wErr.message}`)
    }

    // A draft was never shown to anyone, so nobody is told it went away.
    if (!c.wasPublished || c.notifyMemberIds.length === 0) continue
    const { data: members, error: mErr } = await sb.from('crew_members')
      .select('id, email, phone, email_opt_in, sms_opt_in, is_owner').in('id', c.notifyMemberIds)
    if (mErr) { summary.errors.push(`${c.bookingRef}: notify read: ${mErr.message}`); continue }
    for (const m of (members ?? []) as { id: string; email: string | null; phone: string | null; email_opt_in: boolean; sms_opt_in: boolean; is_owner: boolean }[]) {
      if (m.is_owner) continue
      const q = await queueCancelled(sb, c, m)
      summary.notificationsQueued += q.queued
      summary.errors.push(...q.errors)
    }
  }

  return summary
}

/**
 * Plan and apply. `dryRun` plans only — what the admin overview uses to show
 * "needs a time" without writing a row.
 */
export async function reconcileCrewParties(
  { now, supabase, settings, dryRun = false, actor = SYNC_ACTOR }:
  { now: Date; supabase: Supa; settings: CrewSettings; dryRun?: boolean; actor?: string },
): Promise<ReconcileResult & { plan?: ReconcilePlan }> {
  const inputs = await loadReconcileInputs(supabase, now)
  if (inputs.kind !== 'ok') return inputs
  const plan = planReconcile(inputs.data, settings, now)
  if (dryRun) {
    return {
      kind: 'ok',
      plan,
      summary: {
        created: 0, alreadyThere: 0, updated: 0, raced: 0, cancelled: 0, spotsAdded: 0, notificationsQueued: 0,
        needsTime: plan.needsTime, unclassified: plan.unclassified, rentalsWithoutHelper: plan.rentalsWithoutHelper,
        reactivated: plan.reactivated, flagged: plan.flagged, errors: [],
      },
    }
  }
  return { kind: 'ok', summary: await applyReconcile(supabase, plan, actor), plan }
}
