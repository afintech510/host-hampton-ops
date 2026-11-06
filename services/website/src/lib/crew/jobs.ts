/**
 * What `/api/cron/crew` does each tick (spec §7, prompt 05 §4). Server code only.
 *
 *   1. the booking reconcile          (the route runs it, flag or no flag)
 *   2. confirmations: request (120 h), reminder (96 h), the overdue alert to
 *      Allie (72 h), the day-before reminder (24 h)
 *   3. cover requests: escalate (the standby window passed, or nobody could be
 *      asked), the 48-hour warning, expire at the start
 *   4. the attendance-not-marked alert
 *   5. the no-Lead alert, 7 days out — never for a studio rental: a rental's
 *      spots are helper spots and it has no Lead (Adam, 2026-10-27)
 *   6. the availability reminder (from the 10th, until the 15th)
 *   7. the queue: deferred texts and the reconcile's `partyCancelled` notices
 *   8. equitable scheduling: a party the manager picks, where everyone who asked fits the open
 *      spots, is approved without waiting once the crew have answered or 48 hours have passed
 *
 * IDEMPOTENT BY CONSTRUCTION. Every message has a dedupe key and goes through
 * `notifyMember` / `notifyAdmin`, whose INSERT is the claim; every state change
 * is a conditional UPDATE read back. Running the tick twice sends nothing twice.
 *
 * NOTHING IS SENT LATE AS IF IT WERE ON TIME. Each message has a window, not
 * just a start: the request goes until the party starts, the reminder only
 * before the deadline, "tomorrow" only within six hours of the day-before
 * mark. A tick that resumes after an outage does not send a day's backlog of
 * statements that are no longer true (rule from lib/scheduleFreshness.ts).
 *
 * Times are instants compared with instants. The box is UTC; nothing here sets
 * a wall-clock field.
 *
 * `scope: 'test'` (the cron's `?scope=test`, allowed only while CREW_ENABLED is
 * off and CREW_TEST_LOGIN is on) restricts every job to TEST parties and test
 * members, which is how this is proven in production before launch.
 */

import { createHash } from 'crypto'
import type { getSupabase } from '@/lib/supabase'
import {
  attendanceAlertAt, confirmationSchedule, formatCents, localParts, nudgeMarks, partyRateCents, payLabelFor,
  standbyEscalateAt, staffingShortfall, understaffedAlertAt, unclaimedWarningAt, type CrewSettings,
} from '@/lib/crew/rules'
import {
  listMembers, listPartiesInRange, slotsForParties, type CrewMemberRow, type CrewPartyRow, type CrewSlotRow, type CrewSwapRow, type PartyWithSlots, type Read,
} from '@/lib/crew/db'
import { adminTemplates, templates, type Rendered } from '@/lib/crew/templates'
import {
  crewLink, drainCrewQueue, isTestParty, markCoveredByDigest, messageClock, messageDayLabel, notifyAdmin, notifyMember, partyRefFor,
  type DrainSummary, type NotifyCtx,
} from '@/lib/crew/notify'
import {
  askedCount, AUTOPILOT_ACTOR, autoOfferToEveryone, eligibleFor, escalateSwap, LIVE_SWAP_STATUSES, startCoverRequest, tenure,
} from '@/lib/crew/cover'
import { ALERT_DAYS_BACK } from '@/lib/crew/admin'
import { publishParty } from '@/lib/crew/adminActions'
import { approvePicks, listPickParties, loadPickPanel, notifyPickRound, partyResponses, PICK_RESPONSE_HOURS, type ApproveResult } from '@/lib/crew/pick'
import { etToUtc } from '@/lib/partyTime'

type Supa = ReturnType<typeof getSupabase>

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
/** "Tomorrow" stays true for this long after the day-before mark. */
export const DAY_BEFORE_WINDOW_MS = 6 * HOUR_MS
/** A reminder and an overdue alert wait this long after the request actually went. */
export const AFTER_REQUEST_MS = 12 * HOUR_MS
/** The availability reminder goes after this Eastern hour, never at midnight. */
export const AVAILABILITY_FROM_HOUR = 9

export type JobScope = 'all' | 'test'

export interface JobsCtx extends NotifyCtx {
  settings: CrewSettings
  scope: JobScope
}

export interface JobsReport {
  ok: boolean
  /** Autopilot: drafts published by themselves this tick. */
  autoPublished: number
  /** Autopilot: "new party" and "still need crew" asks sent this tick (digests count once). */
  asks: { newParty: number; nudges: number }
  confirmations: { requests: number; reminders: number; overdue: number; dayBefore: number }
  covers: { reasked: number; escalated: number; autoOffered: number; warned: number; expired: number }
  attendance: number
  /** The manager told a published party is still short of crew (the one routine manager touch). */
  understaffed: number
  availability: number
  /** Equitable scheduling: parties approved by themselves this tick (everyone who asked fit). */
  picksAutoApproved: number
  queue: Omit<DrainSummary, 'unavailable'>
  /** Which jobs could not read what they needed. Names only, never a row. */
  unavailable: string[]
}

const adminUrl = (partyId: string) => crewLink(`/admin/crew/parties/${partyId}`)
const HELD = ['assigned', 'completed', 'no_show']

function inScope(ctx: JobsCtx, party: Pick<CrewPartyRow, 'booking_id' | 'title'>): boolean {
  return ctx.scope === 'all' || isTestParty(party)
}

function memberInScope(ctx: JobsCtx, m: Pick<CrewMemberRow, 'is_test'>): boolean {
  return ctx.scope === 'all' ? true : m.is_test
}

/**
 * When the in-app row for a dedupe key was written, or null if it never was.
 * Read from `scheduled_for`, which `notifyMember` stamps with the tick's own
 * `now` — the clock every other comparison here uses.
 */
async function sentAt(sb: Supa, dedupeKey: string): Promise<Date | null | 'unavailable'> {
  const { data, error } = await sb.from('crew_notifications').select('scheduled_for').eq('dedupe_key', dedupeKey).eq('channel', 'in_app').maybeSingle()
  if (error) return 'unavailable'
  const at = (data as { scheduled_for: string } | null)?.scheduled_for
  return at ? new Date(at) : null
}

/** The deadline in words; once it has passed, a few hours from now (never a time already gone). */
function dueLabelFor(dueAt: Date, startsAt: Date, now: Date): string {
  let due = dueAt
  if (due.getTime() <= now.getTime()) {
    const soon = new Date(now.getTime() + 6 * HOUR_MS)
    due = soon.getTime() < startsAt.getTime() ? soon : startsAt
  }
  return `${messageDayLabel(due)} ${messageClock(due)}`
}

// ── 2. Confirmations ────────────────────────────────────────────────────────

export async function runConfirmations(
  ctx: JobsCtx, parties: PartyWithSlots[], members: Map<string, CrewMemberRow>,
): Promise<JobsReport['confirmations'] & { unavailable: boolean }> {
  const out = { requests: 0, reminders: 0, overdue: 0, dayBefore: 0, unavailable: false }
  const s = ctx.settings
  const now = ctx.now.getTime()
  for (const { party, slots } of parties) {
    if (party.status !== 'published' || !inScope(ctx, party)) continue
    const startsAt = new Date(party.starts_at)
    if (startsAt.getTime() <= now) continue
    const sched = confirmationSchedule(startsAt, s)
    for (const slot of slots) {
      if (slot.status !== 'assigned' || !slot.member_id) continue
      const m = members.get(slot.member_id)
      if (!m || m.is_owner || !memberInScope(ctx, m)) continue
      const assignedAt = slot.assigned_at ? new Date(slot.assigned_at).getTime() : 0
      const key = tenure(slot)
      const ref = partyRefFor(party, s, undefined, slot.role)
      const payload = { party_id: party.id, slot_id: slot.id }

      if (!slot.confirmed_at && now >= sched.requestAt.getTime()) {
        const reqKey = `confirm_request:${key}`
        const r = await notifyMember(ctx, m, 'confirmRequest',
          templates.confirmRequest(ref, dueLabelFor(sched.dueAt, startsAt, ctx.now)), reqKey, { payload })
        if (r.kind === 'done' && r.channels.in_app === 'sent') out.requests++
        const requested = await sentAt(ctx.sb, reqKey)
        if (requested === 'unavailable') { out.unavailable = true; continue }
        const reqMs = requested ? requested.getTime() : null

        if (reqMs !== null && assignedAt < sched.reminderAt.getTime()
          && now >= sched.reminderAt.getTime() && now < sched.dueAt.getTime() && now - reqMs >= AFTER_REQUEST_MS) {
          const rr = await notifyMember(ctx, m, 'confirmReminder',
            templates.confirmReminder(ref, dueLabelFor(sched.dueAt, startsAt, ctx.now)), `confirm_reminder:${key}`, { payload })
          if (rr.kind === 'done' && rr.channels.in_app === 'sent') out.reminders++
        }

        if (reqMs !== null && assignedAt < sched.dueAt.getTime()
          && now >= Math.max(sched.dueAt.getTime(), reqMs + AFTER_REQUEST_MS)) {
          const a = await notifyAdmin(ctx, 'unconfirmed', adminTemplates.unconfirmed(m.first_name, ref, adminUrl(party.id)),
            `unconfirmed:${key}`, { test: isTestParty(party), payload })
          if (a.in_app === 'sent') out.overdue++
        }
      }

      if (assignedAt < sched.dayBeforeAt.getTime()
        && now >= sched.dayBeforeAt.getTime() && now < sched.dayBeforeAt.getTime() + DAY_BEFORE_WINDOW_MS) {
        const r = await notifyMember(ctx, m, 'dayBefore', templates.dayBefore(ref, party.location), `day_before:${key}`, { payload })
        if (r.kind === 'done' && r.channels.in_app === 'sent') out.dayBefore++
      }
    }
  }
  return out
}

// ── 3. Cover requests ───────────────────────────────────────────────────────

export async function runCovers(ctx: JobsCtx, members: Map<string, CrewMemberRow>): Promise<JobsReport['covers'] & { unavailable: boolean }> {
  const out = { reasked: 0, escalated: 0, autoOffered: 0, warned: 0, expired: 0, unavailable: false }
  const s = ctx.settings
  const { data, error } = await ctx.sb.from('crew_swap_requests').select('*').in('status', [...LIVE_SWAP_STATUSES])
  if (error) return { ...out, unavailable: true }
  const swaps = (data ?? []) as CrewSwapRow[]
  if (swaps.length === 0) return out

  const { data: slotRows, error: sErr } = await ctx.sb.from('crew_slots').select('*').in('id', swaps.map(w => w.slot_id))
  if (sErr) return { ...out, unavailable: true }
  const slotById = new Map(((slotRows ?? []) as CrewSlotRow[]).map(sl => [sl.id, sl]))
  const partyIds = Array.from(new Set(Array.from(slotById.values()).map(sl => sl.party_id)))
  const { data: partyRows, error: pErr } = await ctx.sb.from('crew_parties').select('*').in('id', partyIds)
  if (pErr) return { ...out, unavailable: true }
  const partyById = new Map(((partyRows ?? []) as CrewPartyRow[]).map(p => [p.id, p]))
  const allSlots = Array.from(slotById.values())

  for (const swap of swaps) {
    const slot = slotById.get(swap.slot_id)
    const party = slot ? partyById.get(slot.party_id) : undefined
    if (!slot || !party || !inScope(ctx, party)) continue
    const startsAt = new Date(party.starts_at)

    // Expire at the start: no ledger event; attendance decides.
    if (ctx.now.getTime() >= startsAt.getTime()) {
      const { data: done, error: xErr } = await ctx.sb.from('crew_swap_requests')
        .update({ status: 'expired', resolved_at: ctx.now.toISOString() })
        .eq('id', swap.id).in('status', [...LIVE_SWAP_STATUSES]).select('id')
      if (xErr) out.unavailable = true
      else if ((done ?? []).length > 0) out.expired++
      continue
    }

    const requester = members.get(swap.requester_id)

    // The route opened it but never got as far as asking (a crash, a failed read): ask now.
    if (!swap.standbys_notified_at && requester && swap.status === 'open') {
      const pws: PartyWithSlots = { party, slots: allSlots.filter(sl => sl.party_id === party.id) }
      const { data: full, error: fErr } = await ctx.sb.from('crew_slots').select('*').eq('party_id', party.id)
      if (!fErr && full) pws.slots = full as CrewSlotRow[]
      const r = await startCoverRequest(ctx, s, swap, pws, requester)
      if (r.kind !== 'ok') { out.unavailable = true; continue }
      out.reasked++
      if (r.data.escalated) { out.escalated++; continue }
    }

    let escalated = swap.status === 'escalated'
    if (swap.status === 'open') {
      const asked = await askedCount(ctx.sb, swap.id)
      if (asked.kind !== 'ok') { out.unavailable = true; continue }
      if (ctx.now.getTime() >= standbyEscalateAt(new Date(swap.created_at), asked.data, s).getTime()) {
        const e = await escalateSwap(ctx, s, swap, party)
        if (e === 'unavailable') out.unavailable = true
        else if (e === 'escalated') { out.escalated++; escalated = true }
        else if (e === 'not_open') escalated = true
      }
    }

    // AUTOPILOT: the standby window passed with no claim, so offer the spot to
    // everyone free that day instead of leaving it for the manager. Retried every tick
    // until it has gone out once (`offered_to_all_at`); nobody is asked twice.
    let offeredAt = swap.offered_to_all_at ? new Date(swap.offered_to_all_at).getTime() : null
    if (escalated && offeredAt === null) {
      const o = await autoOfferToEveryone(ctx, s, swap, party)
      if (o === 'unavailable') out.unavailable = true
      else if (o === 'offered' || o === 'nobody_free') { out.autoOffered++; offeredAt = ctx.now.getTime() }
      else if (o === 'not_needed') offeredAt = ctx.now.getTime()
    }

    // The manager hears about it only if it is STILL unclaimed at the 48-hour mark, and
    // never before the open offer has had one standby window to be taken.
    const heldUntil = (offeredAt ?? new Date(swap.created_at).getTime()) + s.drops.standbyWindowHours * HOUR_MS
    if (!swap.warned_at && ctx.now.getTime() >= Math.max(unclaimedWarningAt(startsAt, s).getTime(), heldUntil)) {
      const { data: won, error: wErr } = await ctx.sb.from('crew_swap_requests')
        .update({ warned_at: ctx.now.toISOString() })
        .eq('id', swap.id).is('warned_at', null).in('status', [...LIVE_SWAP_STATUSES]).select('id')
      if (wErr) { out.unavailable = true; continue }
      if ((won ?? []).length === 0) continue
      out.warned++
      const payload = { swap_id: swap.id, party_id: party.id }
      if (requester) {
        await notifyMember(ctx, requester, 'unclaimedWarning',
          templates.unclaimedWarning(partyRefFor(party, s, `/crew/parties/${party.id}/cant-make-it`), formatCents(partyRateCents('crew', 0, s)), s.ladderEnabled),
          `cover_warn:${swap.id}`, { payload })
      }
      await notifyAdmin(ctx, 'coverUnclaimed', adminTemplates.coverUnclaimed(requester?.first_name ?? 'A crew member', partyRefFor(party, s), adminUrl(party.id)),
        `cover_unclaimed:${swap.id}`, { test: isTestParty(party), payload })
    }
  }
  return out
}

// ── 4 & 5. Allie's party alerts ─────────────────────────────────────────────

export async function runPartyAlerts(ctx: JobsCtx, parties: PartyWithSlots[]): Promise<{ attendance: number; understaffed: number }> {
  const out = { attendance: 0, understaffed: 0 }
  const s = ctx.settings
  const now = ctx.now.getTime()
  for (const { party, slots } of parties) {
    if (party.status !== 'published' || !inScope(ctx, party)) continue
    const startsAt = new Date(party.starts_at)
    const endsAt = new Date(party.ends_at)
    const held = slots.filter(sl => sl.member_id && HELD.includes(sl.status))
    const opts = { test: isTestParty(party), payload: { party_id: party.id } }

    if (!party.attendance_marked_at && held.length > 0 && now >= attendanceAlertAt(endsAt, s).getTime()
      && now - endsAt.getTime() <= ALERT_DAYS_BACK * DAY_MS) {
      const a = await notifyAdmin(ctx, 'attendanceDue', adminTemplates.attendanceDue(partyRefFor(party, s), adminUrl(party.id)), `attendance_due:${party.id}`, opts)
      if (a.in_app === 'sent') out.attendance++
    }

    // THE routine manager touch: a published party still short of crew (or of a
    // Lead; never for a studio rental, which has none) as the day gets close.
    // `staffingShortfall` and `understaffedAlertAt` are shared with the page's
    // derived alert, so the two cannot disagree. Once per party.
    if (startsAt.getTime() > now) {
      const sf = staffingShortfall(party, slots)
      if ((sf.crewShort > 0 || sf.leadShort) && now >= understaffedAlertAt(startsAt, sf.leadShort, s).getTime()) {
        const daysOut = Math.max(0, Math.ceil((startsAt.getTime() - now) / DAY_MS))
        const a = await notifyAdmin(ctx, 'understaffed',
          adminTemplates.understaffed(partyRefFor(party, s), sf.crewShort, sf.leadShort, daysOut, adminUrl(party.id)), `understaffed:${party.id}`, opts)
        if (a.in_app === 'sent') out.understaffed++
      }
    }
  }
  return out
}

// ── 0. Autopilot: publish ───────────────────────────────────────────────────

/**
 * Publish the reconcile's new booked parties by themselves (setting
 * `autopilot.auto_publish`, default ON in the seed). Narrow on purpose:
 *   - a party built from a booking, never one typed in by hand;
 *   - no sync flag at all (a flag means a human should look first);
 *   - created on or after `auto_publish_from`, so the drafts that already exist
 *     stay drafts until Adam publishes them;
 *   - only in the real scope: TEST parties are published by their seed.
 * `publishParty` is the same conditional write the Publish button makes.
 */
export async function runAutoPublish(ctx: JobsCtx): Promise<{ published: number; unavailable: boolean }> {
  const out = { published: 0, unavailable: false }
  const s = ctx.settings
  if (ctx.scope !== 'all' || !s.autopilot.autoPublish) return out
  const from = s.autopilot.autoPublishFrom ? etToUtc(s.autopilot.autoPublishFrom, 0, 0) : null
  if (from && !Number.isFinite(from.getTime())) return out
  const drafts = await listPartiesInRange(ctx.sb, ctx.now.toISOString(), new Date(ctx.now.getTime() + 400 * DAY_MS).toISOString(), { statuses: ['draft'] })
  if (drafts.kind !== 'ok') return { ...out, unavailable: true }
  for (const { party } of drafts.data) {
    if (!party.booking_id) continue
    if ((party.sync_flags ?? []).length > 0) continue
    if (from && new Date(party.created_at).getTime() < from.getTime()) continue
    const r = await publishParty(ctx.sb, party.id, AUTOPILOT_ACTOR, ctx.now)
    if (r.ok) out.published++
    else if (r.status >= 500) out.unavailable = true
  }
  return out
}

// ── 0b. Autopilot: ask free crew ────────────────────────────────────────────

/** A published party is "new" for this long after it went up. */
export const NEW_PARTY_WINDOW_MS = 72 * HOUR_MS
/** More than this many asks for one person in one tick become ONE message. */
export const DIGEST_AFTER = 3
/** Asks sent in one tick, whatever the roster: the rest wait for the next tick (dedupe keys make it resume). */
export const ASKS_PER_TICK = 60

interface Ask {
  party: CrewPartyRow
  /** `new_party:{party}:{member}` / `nudge:{party}:{round}:{member}` */
  key: string
  render: () => Rendered
  /** A party the manager picks: the wording asks for an answer, not a claim. */
  pick?: boolean
}

/**
 * Send one person their asks for this tick. Up to DIGEST_AFTER go as themselves;
 * more become a single digest (so publishing twelve parties at once is one
 * message, not twelve). Either way each ask's own key is recorded, so nothing is
 * asked twice. Returns how many messages went.
 */
async function sendAsks(
  ctx: JobsCtx, m: CrewMemberRow, template: 'newParty' | 'openSpots', asks: Ask[], digest: (n: number, pick: boolean) => Rendered, budget: { left: number },
): Promise<number> {
  if (asks.length === 0 || budget.left <= 0) return 0
  const { data, error } = await ctx.sb.from('crew_notifications').select('dedupe_key')
    .eq('channel', 'in_app').in('dedupe_key', asks.map(a => a.key))
  if (error) return 0
  const done = new Set(((data ?? []) as { dedupe_key: string }[]).map(r => r.dedupe_key))
  const pending = asks.filter(a => !done.has(a.key))
  if (pending.length === 0) return 0

  let sent = 0
  if (pending.length <= DIGEST_AFTER) {
    for (const a of pending) {
      if (budget.left <= 0) break
      const r = await notifyMember(ctx, m, template, a.render(), a.key, { payload: { party_id: a.party.id } })
      if (r.kind === 'done' && r.channels.in_app === 'sent') { sent++; budget.left-- }
    }
    return sent
  }
  const id = createHash('sha1').update(pending.map(a => a.key).sort().join('|')).digest('hex').slice(0, 12)
  const r = await notifyMember(ctx, m, `${template}Digest`, digest(pending.length, pending.some(a => a.pick)), `digest:${template}:${m.id}:${id}`, { payload: { parties: pending.length } })
  if (r.kind === 'done' && r.channels.in_app === 'sent') {
    for (const a of pending) await markCoveredByDigest(ctx, m, template, a.key, a.party.id)
    budget.left--
    return 1
  }
  return 0
}

/** The spots this member could take on a party, and the role to test their fit with. */
function openFor(slots: CrewSlotRow[], canLead: boolean): { count: number; crewOpen: number; leadOpen: boolean } {
  const open = slots.filter(sl => sl.status === 'open')
  const crewOpen = open.filter(sl => sl.role === 'crew').length
  const leadOpen = open.some(sl => sl.role === 'lead')
  return { count: crewOpen + (leadOpen && canLead ? 1 : 0), crewOpen, leadOpen }
}

/** Published within the new-party window and not started: found by `published_at`, however far ahead the party is. */
export async function listRecentlyPublished(sb: Supa, now: Date): Promise<Read<PartyWithSlots[]>> {
  const since = new Date(now.getTime() - NEW_PARTY_WINDOW_MS).toISOString()
  const { data, error } = await sb.from('crew_parties').select('*')
    .eq('status', 'published').gte('published_at', since).gt('starts_at', now.toISOString())
  if (error) return { kind: 'unavailable', error: error.message }
  const rows = (data ?? []) as CrewPartyRow[]
  if (rows.length === 0) return { kind: 'ok', data: [] }
  const slots = await slotsForParties(sb, rows.map(p => p.id))
  if (slots.kind !== 'ok') return slots
  return { kind: 'ok', data: rows.map(party => ({ party, slots: slots.data.filter(sl => sl.party_id === party.id) })) }
}

/**
 * "New party" (once, for 72 hours after it is published) and the "still need
 * crew" re-asks at the two nudge marks. Both go to every active member who could
 * actually work it (`eligibleFor`: free that day, no overlap, not already on it,
 * can_lead for a Lead-only spot; invented members only on booking-less parties —
 * and real members never on a TEST party).
 */
export async function runCrewAsks(
  ctx: JobsCtx, parties: PartyWithSlots[],
): Promise<{ newParty: number; nudges: number; unavailable: boolean }> {
  const out = { newParty: 0, nudges: 0, unavailable: false }
  const s = ctx.settings
  const now = ctx.now.getTime()
  const budget = { left: ASKS_PER_TICK }
  // member id → their asks this tick, per template
  const newAsks = new Map<string, { m: CrewMemberRow; asks: Ask[] }>()
  const nudgeAsks = new Map<string, { m: CrewMemberRow; asks: Ask[] }>()
  const push = (bucket: typeof newAsks, m: CrewMemberRow, ask: Ask) => {
    const e = bucket.get(m.id) ?? { m, asks: [] }
    e.asks.push(ask)
    bucket.set(m.id, e)
  }

  for (const pws of parties) {
    const { party, slots } = pws
    if (party.status !== 'published' || !inScope(ctx, party)) continue
    const startsAt = new Date(party.starts_at)
    if (startsAt.getTime() <= now) continue
    const live = slots.filter(sl => sl.status !== 'cancelled')
    if (!live.some(sl => sl.status === 'open')) continue
    const publishedAt = party.published_at ? new Date(party.published_at).getTime() : null
    if (publishedAt === null) continue

    const isNew = now - publishedAt <= NEW_PARTY_WINDOW_MS
    const marks = nudgeMarks(startsAt, s)
    let round: 1 | 2 | null = null
    if (now >= marks.second.getTime()) round = 2
    else if (now >= marks.first.getTime()) round = 1
    // A party published after the mark was asked about by the "new party" notice: that WAS the ask.
    if (round !== null && publishedAt >= (round === 1 ? marks.first : marks.second).getTime()) round = null
    if (!isNew && round === null) continue

    const crewOpen = live.filter(sl => sl.status === 'open' && sl.role === 'crew').length
    const eligible = await eligibleFor(ctx.sb, s, pws, crewOpen > 0 ? 'crew' : 'lead', 'all', [])
    if (eligible.kind !== 'ok') { out.unavailable = true; continue }
    const ref = partyRefFor(party, s)
    let answered = new Set<string>()
    if (party.selection_mode === 'pick') {
      const rs = await partyResponses(ctx.sb, party.id)
      if (rs.kind !== 'ok') { out.unavailable = true; continue }
      answered = new Set(rs.data.map(r => r.member_id))
    }
    for (const m of eligible.data) {
      if (!memberInScope(ctx, m)) continue
      const spots = openFor(slots, !!m.can_lead)
      if (spots.count === 0) continue
      const payRole = spots.crewOpen > 0 ? 'crew' : 'lead'
      const pay = payLabelFor(payRole, m.steps, party.extra_flat_cents, s)
      if (party.selection_mode === 'pick') {
        // Nothing to claim: ask for an answer, and remind only the people who have not given one.
        if (isNew) push(newAsks, m, { party, key: `new_party:${party.id}:${m.id}`, render: () => templates.newPartyPick(ref), pick: true })
        if (round !== null && !answered.has(m.id)) push(nudgeAsks, m, { party, key: `nudge:${party.id}:${round}:${m.id}`, render: () => templates.pickReminder(ref), pick: true })
        continue
      }
      if (isNew) push(newAsks, m, { party, key: `new_party:${party.id}:${m.id}`, render: () => templates.newParty(ref, pay) })
      if (round !== null) push(nudgeAsks, m, { party, key: `nudge:${party.id}:${round}:${m.id}`, render: () => templates.openSpots(ref, spots.count, pay) })
    }
  }

  const digestUrl = crewLink('/crew')
  for (const { m, asks } of Array.from(newAsks.values())) {
    out.newParty += await sendAsks(ctx, m, 'newParty', asks, (n, pick) => pick ? templates.partiesDigestPick(n, digestUrl) : templates.partiesDigest(n, false, digestUrl), budget)
  }
  for (const { m, asks } of Array.from(nudgeAsks.values())) {
    out.nudges += await sendAsks(ctx, m, 'openSpots', asks, (n, pick) => pick ? templates.partiesDigestPick(n, digestUrl) : templates.partiesDigest(n, true, digestUrl), budget)
  }
  return out
}

// ── 8. Equitable scheduling: nothing to choose between ──────────────────────

/**
 * A party the manager picks where EVERYONE who asked to work fits the open spots
 * has nothing to be fair about, so it is approved without waiting for her. Not
 * at the first answer, though: the first person to answer would take a spot that
 * somebody better placed might still ask for. So it waits until every active
 * crew member has answered, or PICK_RESPONSE_HOURS after the party went up.
 * Where more people asked than there are spots, or the recommendation cannot
 * cover everyone who asked (a Lead-only spot, someone who cannot lead), it is
 * left for the manager. The decision is the ordinary `approvePicks`, logged, and
 * she is told in-app (never emailed) what was done.
 */
export async function runPickAutoApprove(ctx: JobsCtx): Promise<{ approved: number; unavailable: boolean }> {
  const out = { approved: 0, unavailable: false }
  const parties = await listPickParties(ctx.sb, ctx.now)
  if (parties.kind !== 'ok') return { ...out, unavailable: true }
  const members = await listMembers(ctx.sb)
  if (members.kind !== 'ok') return { ...out, unavailable: true }
  const firstOf = new Map(members.data.map(m => [m.id, m.first_name]))
  const results: ApproveResult[] = []
  for (const { party, slots } of parties.data) {
    if (!inScope(ctx, party) || !slots.some(sl => sl.status === 'open')) continue
    const panel = await loadPickPanel(ctx.sb, party.id, ctx.settings)
    if (panel.kind !== 'ok') { out.unavailable = true; continue }
    const p = panel.data
    if (!p || p.volunteers.length === 0) continue
    if (p.volunteers.length > p.openSpots.length) continue
    if (p.recommendation.length < p.volunteers.length) continue
    const waitedMs = party.published_at ? ctx.now.getTime() - new Date(party.published_at).getTime() : 0
    if (waitedMs < PICK_RESPONSE_HOURS * HOUR_MS && p.noResponse.length > 0) continue
    const r = await approvePicks(ctx.sb, party.id, p.recommendation, { actor: AUTOPILOT_ACTOR, s: ctx.settings, now: ctx.now })
    if (!r.ok) { if (r.status >= 500) out.unavailable = true; continue }
    if (r.result.assigned.length === 0) continue
    results.push(r.result)
    out.approved += r.result.assigned.length
    const names = r.result.assigned.map(a => firstOf.get(a.memberId) ?? 'Someone').join(' and ')
    await notifyAdmin(ctx, 'pickAutoApproved', adminTemplates.pickAutoApproved(names, partyRefFor(party, ctx.settings), adminUrl(party.id)),
      `pick_auto:${party.id}:${r.result.assigned.map(a => a.slotId).sort().join(',')}`, { test: isTestParty(party), info: true, payload: { party_id: party.id } })
  }
  if (results.length > 0) await notifyPickRound(ctx, ctx.settings, results)
  return out
}

// ── 6. Availability ─────────────────────────────────────────────────────────

const monthFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long' })

export async function runAvailabilityReminder(ctx: JobsCtx, members: CrewMemberRow[]): Promise<number> {
  const s = ctx.settings
  const local = localParts(ctx.now)
  const [y, mo, d] = local.dateKey.split('-').map(Number)
  const { reminderDayOfMonth, dueDayOfMonth } = s.availability
  if (d < reminderDayOfMonth || d > dueDayOfMonth) return 0
  if (local.minutes < AVAILABILITY_FROM_HOUR * 60) return 0
  const next = mo === 12 ? { y: y + 1, m: 1 } : { y, m: mo + 1 }
  const nextKey = `${next.y}-${String(next.m).padStart(2, '0')}`
  const monthLabel = monthFmt.format(new Date(Date.UTC(next.y, next.m - 1, 15)))
  const dueKey = `${y}-${String(mo).padStart(2, '0')}-${String(dueDayOfMonth).padStart(2, '0')}`
  const dueLabel = messageDayLabel(new Date(`${dueKey}T16:00:00Z`))
  let sent = 0
  for (const m of members) {
    if (m.is_owner || m.status !== 'active') continue
    if (ctx.scope === 'test' ? !m.is_test : m.is_test) continue
    const r = await notifyMember(ctx, m, 'availabilityDue', templates.availabilityDue(monthLabel, dueLabel, crewLink('/crew/availability')),
      `availability:${nextKey}:${m.id}`, { payload: { month: nextKey } })
    if (r.kind === 'done' && r.channels.in_app === 'sent') sent++
  }
  return sent
}

// ── The tick ────────────────────────────────────────────────────────────────

/** Everything after the reconcile. The route decides whether this runs at all. */
export async function runCrewJobs(ctx: JobsCtx): Promise<JobsReport> {
  const s = ctx.settings
  const report: JobsReport = {
    ok: true,
    autoPublished: 0,
    asks: { newParty: 0, nudges: 0 },
    confirmations: { requests: 0, reminders: 0, overdue: 0, dayBefore: 0 },
    covers: { reasked: 0, escalated: 0, autoOffered: 0, warned: 0, expired: 0 },
    attendance: 0, understaffed: 0, availability: 0, picksAutoApproved: 0,
    queue: { scanned: 0, sent: 0, deferred: 0, skipped: 0, failed: 0, raced: 0 },
    unavailable: [],
  }
  const down = (job: string) => { report.unavailable.push(job); report.ok = false }

  // Publish first, so a party that just went up is asked about in this same tick.
  const pub = await runAutoPublish(ctx)
  report.autoPublished = pub.published
  if (pub.unavailable) down('autoPublish')

  // Far enough ahead for the earliest thing any job does for a party: the confirmation
  // request, the nudge marks and the understaffed alert (which can be a Lead alert days out).
  const aheadMs = Math.max(
    s.confirmations.requestHoursBefore * HOUR_MS,
    Math.max(s.lead.alertDaysBefore, s.autopilot.understaffedDaysBefore, s.autopilot.nudgeFirstDaysBefore) * DAY_MS,
  ) + DAY_MS
  const [parties, members] = await Promise.all([
    listPartiesInRange(ctx.sb, new Date(ctx.now.getTime() - (ALERT_DAYS_BACK + 1) * DAY_MS).toISOString(),
      new Date(ctx.now.getTime() + aheadMs).toISOString(), { statuses: ['published'] }),
    listMembers(ctx.sb),
  ])

  if (parties.kind !== 'ok' || members.kind !== 'ok') {
    down('parties')
  } else {
    const byId = new Map(members.data.map(m => [m.id, m]))
    const c = await runConfirmations(ctx, parties.data, byId)
    report.confirmations = { requests: c.requests, reminders: c.reminders, overdue: c.overdue, dayBefore: c.dayBefore }
    if (c.unavailable) down('confirmations')

    const cv = await runCovers(ctx, byId)
    report.covers = { reasked: cv.reasked, escalated: cv.escalated, autoOffered: cv.autoOffered, warned: cv.warned, expired: cv.expired }
    if (cv.unavailable) down('covers')

    const pa = await runPartyAlerts(ctx, parties.data)
    report.attendance = pa.attendance
    report.understaffed = pa.understaffed

    const recent = await listRecentlyPublished(ctx.sb, ctx.now)
    if (recent.kind !== 'ok') down('asks')
    const seen = new Set(parties.data.map(p => p.party.id))
    const askParties = [...parties.data, ...(recent.kind === 'ok' ? recent.data.filter(p => !seen.has(p.party.id)) : [])]
    const asks = await runCrewAsks(ctx, askParties)
    report.asks = { newParty: asks.newParty, nudges: asks.nudges }
    if (asks.unavailable) down('asks')

    report.availability = await runAvailabilityReminder(ctx, members.data)

    const pk = await runPickAutoApprove(ctx)
    report.picksAutoApproved = pk.approved
    if (pk.unavailable) down('picks')
  }

  const q = await drainCrewQueue(ctx, ctx.scope === 'test' ? { memberFilter: m => m.is_test } : {})
  report.queue = { scanned: q.scanned, sent: q.sent, deferred: q.deferred, skipped: q.skipped, failed: q.failed, raced: q.raced }
  if (q.unavailable) down('queue')
  return report
}
