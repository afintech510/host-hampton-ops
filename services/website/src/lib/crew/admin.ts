/**
 * What the /admin/crew pages are built from (prompt 04 §2–§3). Server code
 * only, for ADMIN callers: unlike lib/crew/view.ts, these shapes carry other
 * members' names, steps, contact details and cancel reasons, because Allie is
 * the one person who sees all of it.
 *
 * Every read keeps lib/crew/db.ts rule 1: a failed read is `unavailable` and
 * the page says "could not read", never an empty schedule. An empty "needs
 * crew" list over an outage reads as "all staffed".
 *
 * The alerts are DERIVED from the tables here, not read from
 * `crew_notifications`: Phase 4's cron is what will write admin alert rows, and
 * until it runs nothing would show. Deriving them means the page is right on
 * day one and stays right if a cron tick is missed.
 */

import type { getSupabase } from '@/lib/supabase'
import {
  attendanceAlertAt, confirmationSchedule, isBlockedByAvailability, localParts, shiftWindow, staffingShortfall, understaffedAlertAt,
  shiftsOverlap, unclaimedWarningAt, type AvailabilityBlock, type CrewSettings, type DateBlock, type PartyWindow, type RecurringBlock, type SlotRole,
} from '@/lib/crew/rules'
import {
  listMembers, responseCounts, slotsForParties, type CrewMemberRow, type CrewPartyRow, type CrewSlotRow, type CrewSwapRow, type PartyWithSlots, type Read,
} from '@/lib/crew/db'
import { reconcileCrewParties, type ReconcileSummary } from '@/lib/crew/sync'
import { ADMIN_ABOUT_COLUMNS, adminAboutFromRow, type AdminPartyAbout } from '@/lib/crew/partyDetails'
import { etDateString, etToUtc, shiftEtDate } from '@/lib/partyTime'

type Supa = ReturnType<typeof getSupabase>

const DAY_MS = 86_400_000
export const SCHEDULE_DAYS_AHEAD = 42
/** How far back the alerts look for things still unresolved (attendance, drops, releases). */
export const ALERT_DAYS_BACK = 30

const LIVE_HELD = ['assigned', 'completed', 'no_show']

// ── Availability ────────────────────────────────────────────────────────────

export interface AvailabilityData {
  blocks: Map<string, AvailabilityBlock[]>
  recurring: Map<string, RecurringBlock[]>
}

export async function loadAvailability(sb: Supa, fromDay: string, toDay: string): Promise<Read<AvailabilityData>> {
  const [b, p, r] = await Promise.all([
    sb.from('crew_unavailability').select('member_id, day, part').gte('day', fromDay).lte('day', toDay),
    sb.from('crew_unavailable_periods').select('member_id, starts_at, ends_at')
      .lt('starts_at', etToUtc(shiftEtDate(toDay, 1), 0).toISOString()).gt('ends_at', etToUtc(fromDay, 0).toISOString()),
    sb.from('crew_recurring_blocks').select('member_id, dow, part, active').eq('active', true),
  ])
  if (b.error) return { kind: 'unavailable', error: b.error.message }
  if (p.error) return { kind: 'unavailable', error: p.error.message }
  if (r.error) return { kind: 'unavailable', error: r.error.message }
  const blocks = new Map<string, AvailabilityBlock[]>()
  for (const row of (b.data ?? []) as (DateBlock & { member_id: string })[]) {
    const l = blocks.get(row.member_id) ?? []
    l.push({ day: row.day, part: row.part })
    blocks.set(row.member_id, l)
  }
  for (const row of (p.data ?? []) as { member_id: string; starts_at: string; ends_at: string }[]) {
    const l = blocks.get(row.member_id) ?? []
    l.push({ startsAt: new Date(row.starts_at), endsAt: new Date(row.ends_at) })
    blocks.set(row.member_id, l)
  }
  const recurring = new Map<string, RecurringBlock[]>()
  for (const row of (r.data ?? []) as (RecurringBlock & { member_id: string })[]) {
    const l = recurring.get(row.member_id) ?? []
    l.push({ dow: row.dow, part: row.part, active: row.active })
    recurring.set(row.member_id, l)
  }
  return { kind: 'ok', data: { blocks, recurring } }
}

/** Every live party window each member holds, from the parties already loaded. */
function windowsByMember(parties: PartyWithSlots[]): Map<string, { partyId: string; title: string; window: PartyWindow }[]> {
  const out = new Map<string, { partyId: string; title: string; window: PartyWindow }[]>()
  for (const p of parties) {
    if (p.party.status !== 'draft' && p.party.status !== 'published') continue
    for (const sl of p.slots) {
      if (sl.status !== 'assigned' || !sl.member_id) continue
      const l = out.get(sl.member_id) ?? []
      l.push({ partyId: p.party.id, title: p.party.title, window: { startsAt: new Date(p.party.starts_at), endsAt: new Date(p.party.ends_at) } })
      out.set(sl.member_id, l)
    }
  }
  return out
}

export type Conflict = 'on_party' | 'overlap' | 'blocked' | 'not_lead' | 'inactive'

export interface MemberFit {
  conflicts: Conflict[]
  overlapWith: string[]
}

/**
 * Could this member work this party? The same §3.6 judgment a crew claim gets
 * (`claimRefusal`), asked as an admin would: Allie may override a conflict, so
 * every reason is listed rather than the first one returned.
 */
export function memberFit(
  member: Pick<CrewMemberRow, 'id' | 'status' | 'can_lead' | 'is_owner'>,
  party: { id: string; startsAt: Date; endsAt: Date },
  slots: ReadonlyArray<Pick<CrewSlotRow, 'member_id' | 'status'>>,
  others: ReadonlyArray<{ partyId: string; title: string; window: PartyWindow }>,
  avail: AvailabilityData,
  s: CrewSettings,
  role: SlotRole = 'crew',
): MemberFit {
  const conflicts: Conflict[] = []
  if (member.status !== 'active') conflicts.push('inactive')
  if (slots.some(sl => sl.member_id === member.id && LIVE_HELD.includes(sl.status))) conflicts.push('on_party')
  if (role === 'lead' && !member.can_lead && !member.is_owner) conflicts.push('not_lead')
  const window = { startsAt: party.startsAt, endsAt: party.endsAt }
  const overlapWith = others.filter(o => o.partyId !== party.id && shiftsOverlap(window, o.window, s)).map(o => o.title)
  if (overlapWith.length) conflicts.push('overlap')
  // The owner keeps no availability; everyone else's blocks count.
  if (!member.is_owner && isBlockedByAvailability(window, avail.blocks.get(member.id) ?? [], avail.recurring.get(member.id) ?? [])) {
    conflicts.push('blocked')
  }
  return { conflicts, overlapWith }
}

// ── The overview ────────────────────────────────────────────────────────────

export interface AdminAlert {
  kind:
    | 'unconfirmed' | 'released' | 'cover_open' | 'cover_escalated' | 'cover_unclaimed_48h' | 'dropped'
    | 'attendance' | 'understaffed' | 'needs_review' | 'needs_time' | 'sync_flag' | 'unclassified' | 'reactivated'
    | 'picks_waiting'
  severity: 'urgent' | 'warn' | 'info'
  text: string
  partyId?: string
  memberId?: string
  bookingRef?: string
}

export interface AdminPartyRow {
  id: string
  title: string
  theme: string | null
  kind: CrewPartyRow['party_kind']
  /** True when a booking is behind it; false for a party or work made by hand. The reference itself is not shown on the schedule. */
  booked: boolean
  /** From the booking, for the schedule list: FIRST names and the age (Adam, 2026-11-05: no surname, no booking id). Null for work made by hand. */
  childName: string | null
  childAge: number | null
  parentName: string | null
  /** The pizza-or-bagels and cupcake choices, with `(default)` where the planner's starting value was never changed. */
  food: string | null
  cupcake: string | null
  /** Equitable scheduling: how many answered each way. Null on a party that is first come, first served. */
  pick: { work: number; standby: number; unavailable: number } | null
  startsAt: string
  endsAt: string
  guestCount: number | null
  status: CrewPartyRow['status']
  flags: string[]
  /** Live spots, including the Lead. */
  needed: number
  /** Spots held, including the Lead (and Allie, who counts). */
  staffed: number
  leadFilled: boolean
  unconfirmed: number
  /** Active, not blocked that day, no overlapping party, not on it. */
  available: number
  crew: { firstName: string; role: SlotRole; confirmed: boolean; isOwner: boolean }[]
}

export interface AdminOverview {
  now: string
  parties: AdminPartyRow[]
  alerts: AdminAlert[]
  sync: Pick<ReconcileSummary, 'needsTime' | 'unclassified' | 'rentalsWithoutHelper' | 'reactivated'> | null
  syncError: string | null
  counts: { members: number; canLead: number; needsReview: number }
}

/** What the schedule shows about the family behind each booked party: first names, the age, the food. Never a surname or a booking reference. */
async function bookingAbout(sb: Supa, ids: string[]): Promise<Read<Map<string, AdminPartyAbout>>> {
  const map = new Map<string, AdminPartyAbout>()
  const unique = Array.from(new Set(ids))
  for (let i = 0; i < unique.length; i += 150) {
    const { data, error } = await sb.from('bookings').select(ADMIN_ABOUT_COLUMNS).in('id', unique.slice(i, i + 150))
    if (error) return { kind: 'unavailable', error: error.message }
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) map.set(String(r.id), adminAboutFromRow(r))
  }
  return { kind: 'ok', data: map }
}

async function partiesBetween(sb: Supa, fromIso: string, toIso: string): Promise<Read<PartyWithSlots[]>> {
  const { data, error } = await sb.from('crew_parties').select('*').gte('starts_at', fromIso).lt('starts_at', toIso)
    .order('starts_at', { ascending: true })
  if (error) return { kind: 'unavailable', error: error.message }
  const rows = (data ?? []) as CrewPartyRow[]
  if (rows.length === 0) return { kind: 'ok', data: [] }
  const slots = await slotsForParties(sb, rows.map(p => p.id))
  if (slots.kind !== 'ok') return slots
  return { kind: 'ok', data: rows.map(party => ({ party, slots: slots.data.filter(sl => sl.party_id === party.id) })) }
}

const fmtDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' })
const label = (p: CrewPartyRow) => `${p.title}, ${fmtDay.format(new Date(p.starts_at))}`

export async function loadAdminOverview(sb: Supa, now: Date, s: CrewSettings): Promise<Read<AdminOverview>> {
  const from = new Date(now.getTime() - ALERT_DAYS_BACK * DAY_MS).toISOString()
  const to = new Date(now.getTime() + SCHEDULE_DAYS_AHEAD * DAY_MS).toISOString()
  const today = etDateString(now)

  const [parties, members, avail] = await Promise.all([
    partiesBetween(sb, from, to),
    listMembers(sb),
    loadAvailability(sb, shiftEtDate(today, -1), shiftEtDate(today, SCHEDULE_DAYS_AHEAD + 1)),
  ])
  if (parties.kind !== 'ok') return parties
  if (members.kind !== 'ok') return members
  if (avail.kind !== 'ok') return avail

  const slotIds = parties.data.flatMap(p => p.slots.map(sl => sl.id))
  const swaps: CrewSwapRow[] = []
  for (let i = 0; i < slotIds.length; i += 150) {
    const { data, error } = await sb.from('crew_swap_requests').select('*').in('slot_id', slotIds.slice(i, i + 150))
      .in('status', ['open', 'escalated', 'dropped_uncovered'])
    if (error) return { kind: 'unavailable', error: error.message }
    swaps.push(...((data ?? []) as CrewSwapRow[]))
  }
  const { data: releases, error: relErr } = await sb.from('crew_events').select('member_id, party_id, occurred_at')
    .eq('type', 'early_release').gte('occurred_at', new Date(now.getTime() - 14 * DAY_MS).toISOString())
  if (relErr) return { kind: 'unavailable', error: relErr.message }

  const refs = await bookingAbout(sb, parties.data.map(p => p.party.booking_id).filter((x): x is string => !!x))
  if (refs.kind !== 'ok') return refs
  const counts = await responseCounts(sb, parties.data.filter(p => p.party.selection_mode === 'pick').map(p => p.party.id))
  if (counts.kind !== 'ok') return counts

  const memberById = new Map(members.data.map(m => [m.id, m]))
  const nameOf = (id: string | null) => (id ? memberById.get(id)?.first_name ?? 'Someone' : 'Someone')
  const windows = windowsByMember(parties.data)
  const partyById = new Map(parties.data.map(p => [p.party.id, p]))
  const slotById = new Map(parties.data.flatMap(p => p.slots.map(sl => [sl.id, sl] as const)))

  const alerts: AdminAlert[] = []
  const rows: AdminPartyRow[] = []
  const nowMs = now.getTime()

  for (const pws of parties.data) {
    const p = pws.party
    const startsAt = new Date(p.starts_at)
    const endsAt = new Date(p.ends_at)
    const live = pws.slots.filter(sl => sl.status !== 'cancelled')
    const held = live.filter(sl => sl.member_id && LIVE_HELD.includes(sl.status))
    const leadFilled = held.some(sl => sl.role === 'lead')
    const upcoming = startsAt.getTime() > nowMs
    const isLive = p.status === 'published' || p.status === 'draft'

    // Alerts that belong to this party.
    if (p.status === 'published' && upcoming) {
      // Equitable scheduling: people have asked and a spot is open, so it is waiting on the manager.
      const asked = p.selection_mode === 'pick' ? counts.data.get(p.id)?.work ?? 0 : 0
      const openSpots = live.filter(sl => sl.status === 'open').length
      if (asked > 0 && openSpots > 0) {
        const days = (startsAt.getTime() - nowMs) / DAY_MS
        alerts.push({ kind: 'picks_waiting', severity: days <= 7 ? 'urgent' : 'warn', text: `${label(p)}: ${asked} ${asked === 1 ? 'person wants' : 'people want'} to work it, ${openSpots} ${openSpots === 1 ? 'spot' : 'spots'} open. Pick who is on.`, partyId: p.id })
      }
      const due = confirmationSchedule(startsAt, s).dueAt.getTime()
      for (const sl of held) {
        const m = sl.member_id ? memberById.get(sl.member_id) : undefined
        if (sl.status === 'assigned' && !sl.confirmed_at && !m?.is_owner && nowMs >= due) {
          alerts.push({ kind: 'unconfirmed', severity: 'warn', text: `${nameOf(sl.member_id)} has not confirmed ${label(p)}.`, partyId: p.id, memberId: sl.member_id ?? undefined })
        }
      }
      // The same question the emailed alert asks (`staffingShortfall` +
      // `understaffedAlertAt`): short of crew, or of a Lead — never for a studio
      // rental, which has no Lead spot. One definition, so the page and the inbox agree.
      const sf = staffingShortfall(p, pws.slots)
      if ((sf.crewShort > 0 || sf.leadShort) && nowMs >= understaffedAlertAt(startsAt, sf.leadShort, s).getTime()) {
        const need = [sf.leadShort ? 'a Party Lead' : null, sf.crewShort > 0 ? `${sf.crewShort} crew ${sf.crewShort === 1 ? 'spot' : 'spots'}` : null].filter(Boolean).join(' and ')
        alerts.push({ kind: 'understaffed', severity: 'urgent', text: `Short on crew: ${label(p)} still needs ${need}.`, partyId: p.id })
      }
    }
    if (p.status === 'published' && !p.attendance_marked_at && nowMs >= attendanceAlertAt(endsAt, s).getTime()) {
      alerts.push({ kind: 'attendance', severity: 'warn', text: `Attendance not marked: ${label(p)}.`, partyId: p.id })
    }
    if (isLive && upcoming && p.sync_flags?.length) {
      alerts.push({ kind: 'sync_flag', severity: 'info', text: `${label(p)}: ${p.sync_flags.map(flagText).join('; ')}.`, partyId: p.id })
    }

    // The schedule: upcoming only, plus anything happening today.
    if (endsAt.getTime() < nowMs - 12 * 3_600_000 || startsAt.getTime() >= nowMs + SCHEDULE_DAYS_AHEAD * DAY_MS) continue
    const party = { id: p.id, startsAt, endsAt }
    let available = 0
    if (isLive && upcoming) {
      for (const m of members.data) {
        if (m.is_owner || m.status !== 'active') continue
        // Invented test members count only toward invented parties.
        if (m.is_test && p.booking_id) continue
        if (memberFit(m, party, live, windows.get(m.id) ?? [], avail.data, s).conflicts.length === 0) available++
      }
    }
    rows.push({
      id: p.id,
      title: p.title,
      theme: p.theme,
      kind: p.party_kind,
      booked: !!p.booking_id,
      childName: p.booking_id ? refs.data.get(p.booking_id)?.child ?? null : null,
      childAge: p.booking_id ? refs.data.get(p.booking_id)?.childAge ?? null : null,
      parentName: p.booking_id ? refs.data.get(p.booking_id)?.parent ?? null : null,
      food: p.booking_id ? refs.data.get(p.booking_id)?.food ?? null : null,
      cupcake: p.booking_id ? refs.data.get(p.booking_id)?.cupcake ?? null : null,
      pick: p.selection_mode === 'pick' ? counts.data.get(p.id) ?? { work: 0, standby: 0, unavailable: 0 } : null,
      startsAt: p.starts_at,
      endsAt: p.ends_at,
      guestCount: p.guest_count,
      status: p.status,
      flags: p.sync_flags ?? [],
      needed: live.length,
      staffed: held.length,
      leadFilled,
      unconfirmed: held.filter(sl => sl.status === 'assigned' && !sl.confirmed_at && !memberById.get(sl.member_id as string)?.is_owner).length,
      available,
      crew: held
        .sort((a, b) => (a.role === b.role ? 0 : a.role === 'lead' ? -1 : 1))
        .map(sl => ({ firstName: nameOf(sl.member_id), role: sl.role, confirmed: !!sl.confirmed_at, isOwner: !!memberById.get(sl.member_id as string)?.is_owner })),
    })
  }

  for (const sw of swaps) {
    const sl = slotById.get(sw.slot_id)
    const pws = sl ? partyById.get(sl.party_id) : undefined
    if (!pws) continue
    const p = pws.party
    const who = nameOf(sw.requester_id)
    if (sw.status === 'dropped_uncovered') {
      if (sw.resolved_at && new Date(sw.resolved_at).getTime() >= nowMs - 14 * DAY_MS && new Date(p.starts_at).getTime() > nowMs) {
        alerts.push({ kind: 'dropped', severity: 'urgent', text: `${who} dropped ${label(p)} with nobody covering.`, partyId: p.id, memberId: sw.requester_id })
      }
      continue
    }
    if (new Date(p.starts_at).getTime() <= nowMs) continue
    if (nowMs >= unclaimedWarningAt(new Date(p.starts_at), s).getTime()) {
      alerts.push({ kind: 'cover_unclaimed_48h', severity: 'urgent', text: `Still uncovered: ${who} on ${label(p)} (${sw.reason}).`, partyId: p.id, memberId: sw.requester_id })
    } else if (sw.status === 'escalated') {
      // Autopilot offers an escalated cancel to everyone free; it only becomes urgent (above) at the 48-hour mark.
      alerts.push({
        kind: 'cover_escalated', severity: sw.offered_to_all_at ? 'warn' : 'urgent',
        text: `No standby took ${who}'s spot on ${label(p)} (${sw.reason}).${sw.offered_to_all_at ? ' It has been offered to everyone free that day.' : ' It is being offered to everyone free that day.'}`,
        partyId: p.id, memberId: sw.requester_id,
      })
    } else {
      alerts.push({ kind: 'cover_open', severity: 'warn', text: `${who} can't make ${label(p)} (${sw.reason}); the standbys have been asked.`, partyId: p.id, memberId: sw.requester_id })
    }
  }

  for (const r of (releases ?? []) as { member_id: string; party_id: string | null; occurred_at: string }[]) {
    const pws = r.party_id ? partyById.get(r.party_id) : undefined
    if (!pws || new Date(pws.party.starts_at).getTime() <= nowMs) continue
    alerts.push({ kind: 'released', severity: 'info', text: `${nameOf(r.member_id)} released a spot on ${label(pws.party)}.`, partyId: pws.party.id, memberId: r.member_id })
  }

  for (const m of members.data) {
    if (m.needs_review) alerts.push({ kind: 'needs_review', severity: 'warn', text: `${m.first_name} is flagged for a talk (a no-show).`, memberId: m.id })
  }

  // "Needs a time" and the other things only the booking side can say: a dry
  // run of the reconcile, which writes nothing. Its failure is shown, not hidden.
  let sync: AdminOverview['sync'] = null
  let syncError: string | null = null
  const plan = await reconcileCrewParties({ now, supabase: sb, settings: s, dryRun: true })
  if (plan.kind === 'ok') {
    sync = {
      needsTime: plan.summary.needsTime,
      unclassified: plan.summary.unclassified,
      rentalsWithoutHelper: plan.summary.rentalsWithoutHelper,
      reactivated: plan.summary.reactivated,
    }
    for (const ref of plan.summary.needsTime) alerts.push({ kind: 'needs_time', severity: 'warn', text: `${ref} is booked but has no usable party time, so it has no crew party yet.`, bookingRef: ref })
    for (const ref of plan.summary.unclassified) alerts.push({ kind: 'unclassified', severity: 'info', text: `${ref} is booked but its party type is not one crew staff.`, bookingRef: ref })
    for (const ref of plan.summary.reactivated) alerts.push({ kind: 'reactivated', severity: 'warn', text: `${ref} is booked again, but its crew party was cancelled.`, bookingRef: ref })
  } else {
    syncError = plan.error
  }

  const order = { urgent: 0, warn: 1, info: 2 } as const
  alerts.sort((a, b) => order[a.severity] - order[b.severity])
  const active = members.data.filter(m => !m.is_owner && m.status === 'active')
  return {
    kind: 'ok',
    data: {
      now: now.toISOString(),
      parties: rows,
      alerts,
      sync,
      syncError,
      counts: { members: active.length, canLead: active.filter(m => m.can_lead).length, needsReview: members.data.filter(m => m.needs_review).length },
    },
  }
}

export function flagText(f: string): string {
  switch (f) {
    case 'over_staffed': return 'more spots than the guest count needs now'
    case 'needs_time': return 'the booking has no usable time'
    case 'needs_address': return 'no address yet'
    case 'not_booked': return 'the booking is no longer booked'
    case 'no_helper': return 'the Party Helper add-on is gone'
    case 'per_hour_helper': return 'per-hour Party Helper (counted as one helper)'
    case 'unclassified': return 'not a crew party type any more'
    case 'time_changed': return 'the time changed after crew signed up'
    default: return f
  }
}

// ── One party ───────────────────────────────────────────────────────────────

export interface AdminSlotView {
  id: string
  role: SlotRole
  status: CrewSlotRow['status']
  memberId: string | null
  memberName: string | null
  isOwner: boolean
  confirmed: boolean
  assignedVia: CrewSlotRow['assigned_via']
  assignedBy: string | null
  activeCover: { id: string; status: string; reason: string; note: string | null; offeredToAllAt: string | null } | null
}

export interface AdminMemberChoice {
  id: string
  name: string
  canLead: boolean
  isOwner: boolean
  isTest: boolean
  fitCrew: MemberFit
  fitLead: MemberFit
}

export interface AdminPartyDetail {
  party: CrewPartyRow & { updated_by?: string | null }
  /** The booking behind it, for the link only: the reference is not shown. */
  booking: { id: string; ref: string; status: string | null } | null
  /** First names, the child's age and the food choices, from the booking. Null for work made by hand. */
  about: AdminPartyAbout | null
  slots: AdminSlotView[]
  standbys: { memberId: string; name: string; since: string }[]
  members: AdminMemberChoice[]
  needed: number
  staffed: number
}

export async function loadAdminParty(sb: Supa, partyId: string, s: CrewSettings): Promise<Read<AdminPartyDetail | null>> {
  const { data: pRow, error } = await sb.from('crew_parties').select('*').eq('id', partyId).maybeSingle()
  if (error) return { kind: 'unavailable', error: error.message }
  if (!pRow) return { kind: 'ok', data: null }
  const party = pRow as CrewPartyRow
  const startsAt = new Date(party.starts_at)
  const endsAt = new Date(party.ends_at)

  // Everything within a day either side, for overlap.
  const near = await partiesBetween(sb, new Date(startsAt.getTime() - DAY_MS).toISOString(), new Date(endsAt.getTime() + DAY_MS).toISOString())
  if (near.kind !== 'ok') return near
  const self = near.data.find(p => p.party.id === partyId)
  let slots = self?.slots
  if (!slots) {
    const r = await slotsForParties(sb, [partyId])
    if (r.kind !== 'ok') return r
    slots = r.data
  }

  const day = localParts(startsAt).dateKey
  const [members, avail, standbysRes, swapsRes] = await Promise.all([
    listMembers(sb),
    loadAvailability(sb, day, day),
    sb.from('crew_standbys').select('member_id, created_at').eq('party_id', partyId).is('withdrawn_at', null),
    slots.length
      ? sb.from('crew_swap_requests').select('*').in('slot_id', slots.map(sl => sl.id)).in('status', ['open', 'escalated'])
      : Promise.resolve({ data: [], error: null }),
  ])
  if (members.kind !== 'ok') return members
  if (avail.kind !== 'ok') return avail
  if (standbysRes.error) return { kind: 'unavailable', error: standbysRes.error.message }
  if (swapsRes.error) return { kind: 'unavailable', error: (swapsRes.error as { message: string }).message }

  let booking: AdminPartyDetail['booking'] = null
  let about: AdminPartyAbout | null = null
  if (party.booking_id) {
    const { data: b, error: bErr } = await sb.from('bookings').select(ADMIN_ABOUT_COLUMNS).eq('id', party.booking_id).maybeSingle()
    if (bErr) return { kind: 'unavailable', error: bErr.message }
    if (b) {
      const row = b as unknown as Record<string, unknown>
      booking = { id: String(row.id), ref: String(row.booking_ref), status: typeof row.status === 'string' ? row.status : null }
      about = adminAboutFromRow(row)
    }
  }

  const memberById = new Map(members.data.map(m => [m.id, m]))
  const fullName = (m: CrewMemberRow) => [m.first_name, m.last_name].filter(Boolean).join(' ')
  const swaps = (swapsRes.data ?? []) as CrewSwapRow[]
  const windows = windowsByMember(near.data)
  const live = slots.filter(sl => sl.status !== 'cancelled')

  const slotViews: AdminSlotView[] = slots
    .slice()
    .sort((a, b) => (a.role === b.role ? a.created_at.localeCompare(b.created_at) : a.role === 'lead' ? -1 : 1))
    .map(sl => {
      const m = sl.member_id ? memberById.get(sl.member_id) : undefined
      const cover = swaps.find(w => w.slot_id === sl.id)
      return {
        id: sl.id,
        role: sl.role,
        status: sl.status,
        memberId: sl.member_id,
        memberName: m ? fullName(m) : sl.member_id ? 'Removed member' : null,
        isOwner: !!m?.is_owner,
        confirmed: !!sl.confirmed_at,
        assignedVia: sl.assigned_via,
        assignedBy: sl.assigned_by,
        activeCover: cover
          ? { id: cover.id, status: cover.status, reason: cover.reason, note: cover.reason_note, offeredToAllAt: cover.offered_to_all_at }
          : null,
      }
    })

  const choices: AdminMemberChoice[] = members.data
    .filter(m => m.status === 'active')
    .map(m => {
      const others = windows.get(m.id) ?? []
      // No step and no rate here: pay is private, set per person per hour, and never in a dropdown.
      return {
        id: m.id,
        name: fullName(m),
        canLead: m.can_lead,
        isOwner: m.is_owner,
        isTest: m.is_test,
        fitCrew: memberFit(m, { id: partyId, startsAt, endsAt }, live, others, avail.data, s, 'crew'),
        fitLead: memberFit(m, { id: partyId, startsAt, endsAt }, live, others, avail.data, s, 'lead'),
      }
    })
    .sort((a, b) => (a.isOwner === b.isOwner ? a.name.localeCompare(b.name) : a.isOwner ? -1 : 1))

  return {
    kind: 'ok',
    data: {
      party,
      booking,
      about,
      slots: slotViews,
      standbys: ((standbysRes.data ?? []) as { member_id: string; created_at: string }[]).map(r => ({
        memberId: r.member_id,
        name: memberById.get(r.member_id) ? fullName(memberById.get(r.member_id) as CrewMemberRow) : 'Removed member',
        since: r.created_at,
      })),
      members: choices,
      needed: live.length,
      staffed: live.filter(sl => sl.member_id && LIVE_HELD.includes(sl.status)).length,
    },
  }
}

// ── The shift, as the party page edits it ───────────────────────────────────

export interface AdminShift {
  /** "HH:MM" Eastern wall-clock, as the time inputs hold them. */
  crewStart: string
  end: string
  leadStart: string
  /** What each would be with no override, so the page can tell "default" from "set by hand". */
  defaults: { crewStart: string; end: string; leadStart: string }
}

const hhmm = (d: Date) => {
  const { minutes } = localParts(d)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** The shift for a party in Eastern clock times: what applies now, and what the defaults would be. */
export function shiftForAdmin(party: Pick<CrewPartyRow, 'party_kind' | 'starts_at' | 'ends_at' | 'shift_starts_at' | 'shift_ends_at' | 'lead_starts_at'>, s: CrewSettings): AdminShift {
  const base = { party_kind: party.party_kind, starts_at: party.starts_at, ends_at: party.ends_at }
  const crew = shiftWindow(party, 'crew', s)
  const lead = shiftWindow(party, 'lead', s)
  const plainCrew = shiftWindow(base, 'crew', s)
  const plainLead = shiftWindow(base, 'lead', s)
  return {
    crewStart: hhmm(crew.startsAt), end: hhmm(crew.endsAt), leadStart: hhmm(lead.startsAt),
    defaults: { crewStart: hhmm(plainCrew.startsAt), end: hhmm(plainCrew.endsAt), leadStart: hhmm(plainLead.startsAt) },
  }
}
