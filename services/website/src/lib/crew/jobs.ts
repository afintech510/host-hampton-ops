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

import type { getSupabase } from '@/lib/supabase'
import {
  attendanceAlertAt, confirmationSchedule, formatCents, leadAlertAt, localParts, partyRateCents, standbyEscalateAt,
  unclaimedWarningAt, type CrewSettings,
} from '@/lib/crew/rules'
import { listMembers, listPartiesInRange, type CrewMemberRow, type CrewPartyRow, type CrewSlotRow, type CrewSwapRow, type PartyWithSlots } from '@/lib/crew/db'
import { adminTemplates, templates } from '@/lib/crew/templates'
import {
  crewLink, drainCrewQueue, isTestParty, messageClock, messageDayLabel, notifyAdmin, notifyMember, partyRefFor,
  type DrainSummary, type NotifyCtx,
} from '@/lib/crew/notify'
import { askedCount, escalateSwap, LIVE_SWAP_STATUSES, startCoverRequest, tenure } from '@/lib/crew/cover'
import { ALERT_DAYS_BACK } from '@/lib/crew/admin'

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
  confirmations: { requests: number; reminders: number; overdue: number; dayBefore: number }
  covers: { reasked: number; escalated: number; warned: number; expired: number }
  attendance: number
  noLead: number
  availability: number
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
      const ref = partyRefFor(party, s)
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
  const out = { reasked: 0, escalated: 0, warned: 0, expired: 0, unavailable: false }
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

    if (swap.status === 'open') {
      const asked = await askedCount(ctx.sb, swap.id)
      if (asked.kind !== 'ok') { out.unavailable = true; continue }
      if (ctx.now.getTime() >= standbyEscalateAt(new Date(swap.created_at), asked.data, s).getTime()) {
        const e = await escalateSwap(ctx, s, swap, party)
        if (e === 'unavailable') out.unavailable = true
        else if (e === 'escalated') out.escalated++
      }
    }

    if (!swap.warned_at && ctx.now.getTime() >= unclaimedWarningAt(startsAt, s).getTime()) {
      const { data: won, error: wErr } = await ctx.sb.from('crew_swap_requests')
        .update({ warned_at: ctx.now.toISOString() })
        .eq('id', swap.id).is('warned_at', null).in('status', [...LIVE_SWAP_STATUSES]).select('id')
      if (wErr) { out.unavailable = true; continue }
      if ((won ?? []).length === 0) continue
      out.warned++
      const payload = { swap_id: swap.id, party_id: party.id }
      if (requester) {
        await notifyMember(ctx, requester, 'unclaimedWarning',
          templates.unclaimedWarning(partyRefFor(party, s, `/crew/parties/${party.id}/cant-make-it`), formatCents(partyRateCents('crew', 0, s))),
          `cover_warn:${swap.id}`, { payload })
      }
      await notifyAdmin(ctx, 'coverUnclaimed', adminTemplates.coverUnclaimed(requester?.first_name ?? 'A crew member', partyRefFor(party, s), adminUrl(party.id)),
        `cover_unclaimed:${swap.id}`, { test: isTestParty(party), payload })
    }
  }
  return out
}

// ── 4 & 5. Allie's party alerts ─────────────────────────────────────────────

export async function runPartyAlerts(ctx: JobsCtx, parties: PartyWithSlots[]): Promise<{ attendance: number; noLead: number }> {
  const out = { attendance: 0, noLead: 0 }
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

    // A studio rental has no Lead spot: its spots are the Party Helper's.
    if (party.party_kind !== 'studio_rental' && startsAt.getTime() > now && now >= leadAlertAt(startsAt, s).getTime()
      && !held.some(sl => sl.role === 'lead')) {
      const a = await notifyAdmin(ctx, 'noLead', adminTemplates.noLead(partyRefFor(party, s), adminUrl(party.id)), `no_lead:${party.id}`, opts)
      if (a.in_app === 'sent') out.noLead++
    }
  }
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
    confirmations: { requests: 0, reminders: 0, overdue: 0, dayBefore: 0 },
    covers: { reasked: 0, escalated: 0, warned: 0, expired: 0 },
    attendance: 0, noLead: 0, availability: 0,
    queue: { scanned: 0, sent: 0, deferred: 0, skipped: 0, failed: 0, raced: 0 },
    unavailable: [],
  }
  const down = (job: string) => { report.unavailable.push(job); report.ok = false }

  const aheadMs = Math.max(s.confirmations.requestHoursBefore * HOUR_MS, s.lead.alertDaysBefore * DAY_MS) + DAY_MS
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
    report.covers = { reasked: cv.reasked, escalated: cv.escalated, warned: cv.warned, expired: cv.expired }
    if (cv.unavailable) down('covers')

    const pa = await runPartyAlerts(ctx, parties.data)
    report.attendance = pa.attendance
    report.noLead = pa.noLead

    report.availability = await runAvailabilityReminder(ctx, members.data)
  }

  const q = await drainCrewQueue(ctx, ctx.scope === 'test' ? { memberFilter: m => m.is_test } : {})
  report.queue = { scanned: q.scanned, sent: q.sent, deferred: q.deferred, skipped: q.skipped, failed: q.failed, raced: q.raced }
  if (q.unavailable) down('queue')
  return report
}
