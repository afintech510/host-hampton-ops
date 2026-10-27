/**
 * Host Hampton Crew — the business rules, as pure functions. Spec:
 * docs/specs/crew/CREW_SPEC.md (v1.1) §3.
 *
 * THIS IS THE ONLY IMPLEMENTATION. Migration 077's functions never compute a
 * step: they take the `expected_steps` the app read and the `steps_after`
 * computed here, and apply it as a compare-and-swap. A second copy of this
 * arithmetic in plpgsql would be a second answer to the same question, and the
 * two would drift the first time Allie edited a setting.
 *
 * Every number comes from `CrewSettings` (the `crew_settings` table, read by
 * `settingsFromRows`). `DEFAULT_SETTINGS` mirrors the migration seed and is
 * what a missing FIELD falls back to — never what an unreadable TABLE falls
 * back to; that is `loadCrewSettings`'s `unavailable`, in lib/crew/settings.ts.
 *
 * Crew-facing words: dollars a party, and "a step" at most. Never a level,
 * tier or points (spec §3.3; `crewCopy.test.ts` holds the copy to it).
 */

import { etToUtc, shiftEtDate } from '@/lib/partyTime'

export type SlotRole = 'lead' | 'crew'
export type DayPart = 'all_day' | 'before_noon' | 'after_noon'

/** What happened, in the terms `stepAfter` scores. */
export type StepEvent =
  | 'worked'                 // +steps.worked
  | 'worked_covered'         // +steps.covered, IN PLACE OF worked: the cover party counts double
  | 'early_release'          // +steps.early_release (negative)
  | 'late_cancel_covered'    // no change
  | 'late_cancel_uncovered'  // reset to 0 ("drop anyway")
  | 'no_show'                // reset to 0

export const TIME_ZONE = 'America/New_York'

/** `crew_members_steps_check` is `steps BETWEEN 0 AND 8`; no setting may exceed it. */
export const HARD_MAX_STEPS = 8

const HOUR_MS = 3_600_000

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface CrewSettings {
  pay: { crewStartCents: number; leadStartCents: number; stepCents: number; maxSteps: number; tipFloorCents: number }
  steps: { worked: number; covered: number; earlyRelease: number }
  slotsByGuests: { minSlots: number; kidsPerCrew: number; maxSlots: number }
  shift: { setupMinutes: number; cleanupMinutes: number }
  drops: { lateDropDays: number; standbyWindowHours: number; unclaimedWarningHours: number }
  confirmations: { requestHoursBefore: number; reminderHoursBefore: number; dueHoursBefore: number; dayBeforeHours: number }
  launch: { launchDate: string | null; graceDays: number }
  lead: { alertDaysBefore: number }
  availability: { dueDayOfMonth: number; reminderDayOfMonth: number }
  attendance: { alertHoursAfterEnd: number }
}

export const DEFAULT_SETTINGS: CrewSettings = {
  pay: { crewStartCents: 5100, leadStartCents: 7000, stepCents: 250, maxSteps: 8, tipFloorCents: 2000 },
  steps: { worked: 1, covered: 2, earlyRelease: -1 },
  slotsByGuests: { minSlots: 3, kidsPerCrew: 4, maxSlots: 10 },
  shift: { setupMinutes: 30, cleanupMinutes: 30 },
  drops: { lateDropDays: 7, standbyWindowHours: 2, unclaimedWarningHours: 48 },
  confirmations: { requestHoursBefore: 120, reminderHoursBefore: 96, dueHoursBefore: 72, dayBeforeHours: 24 },
  launch: { launchDate: null, graceDays: 60 },
  lead: { alertDaysBefore: 7 },
  availability: { dueDayOfMonth: 15, reminderDayOfMonth: 10 },
  attendance: { alertHoursAfterEnd: 12 },
}

type Json = Record<string, unknown>

function num(obj: Json | undefined, key: string, fallback: number, min = -Infinity, max = Infinity): number {
  const v = obj?.[key]
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, v))
}

/**
 * `crew_settings` rows (snake_case jsonb) → CrewSettings. A missing or
 * non-numeric field falls back to the default; a number outside what the
 * database or the arithmetic can bear is CLAMPED, not trusted — `max_steps: 12`
 * would otherwise compute a step the steps CHECK refuses, and `kids_per_crew: 0`
 * would divide by zero.
 */
export function settingsFromRows(rows: ReadonlyArray<{ key: string; value: unknown }>): CrewSettings {
  const by = new Map<string, Json>()
  for (const r of rows) if (r.value && typeof r.value === 'object' && !Array.isArray(r.value)) by.set(r.key, r.value as Json)
  const d = DEFAULT_SETTINGS
  const pay = by.get('pay'), steps = by.get('steps'), sg = by.get('slots_by_guests'), shift = by.get('shift')
  const drops = by.get('drops'), conf = by.get('confirmations'), launch = by.get('launch'), lead = by.get('lead')
  const avail = by.get('availability'), att = by.get('attendance')
  const launchDate = launch?.['launch_date']
  const minSlots = num(sg, 'min_slots', d.slotsByGuests.minSlots, 1, 10)

  return {
    pay: {
      crewStartCents: num(pay, 'crew_start_cents', d.pay.crewStartCents, 0),
      leadStartCents: num(pay, 'lead_start_cents', d.pay.leadStartCents, 0),
      stepCents: num(pay, 'step_cents', d.pay.stepCents, 0),
      maxSteps: Math.floor(num(pay, 'max_steps', d.pay.maxSteps, 0, HARD_MAX_STEPS)),
      tipFloorCents: num(pay, 'tip_floor_cents', d.pay.tipFloorCents, 0),
    },
    steps: {
      worked: Math.round(num(steps, 'worked', d.steps.worked, 0, HARD_MAX_STEPS)),
      covered: Math.round(num(steps, 'covered', d.steps.covered, 0, HARD_MAX_STEPS)),
      earlyRelease: Math.round(num(steps, 'early_release', d.steps.earlyRelease, -HARD_MAX_STEPS, 0)),
    },
    slotsByGuests: {
      minSlots,
      kidsPerCrew: num(sg, 'kids_per_crew', d.slotsByGuests.kidsPerCrew, 1),
      maxSlots: Math.max(minSlots, num(sg, 'max_slots', d.slotsByGuests.maxSlots, 1, 10)),
    },
    shift: {
      setupMinutes: num(shift, 'setup_minutes', d.shift.setupMinutes, 0, 240),
      cleanupMinutes: num(shift, 'cleanup_minutes', d.shift.cleanupMinutes, 0, 240),
    },
    drops: {
      lateDropDays: num(drops, 'late_drop_days', d.drops.lateDropDays, 0),
      standbyWindowHours: num(drops, 'standby_window_hours', d.drops.standbyWindowHours, 0),
      unclaimedWarningHours: num(drops, 'unclaimed_warning_hours', d.drops.unclaimedWarningHours, 0),
    },
    confirmations: {
      requestHoursBefore: num(conf, 'request_hours_before', d.confirmations.requestHoursBefore, 0),
      reminderHoursBefore: num(conf, 'reminder_hours_before', d.confirmations.reminderHoursBefore, 0),
      dueHoursBefore: num(conf, 'due_hours_before', d.confirmations.dueHoursBefore, 0),
      dayBeforeHours: num(conf, 'day_before_hours', d.confirmations.dayBeforeHours, 0),
    },
    launch: {
      launchDate: typeof launchDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(launchDate) ? launchDate : null,
      graceDays: num(launch, 'grace_days', d.launch.graceDays, 0),
    },
    lead: { alertDaysBefore: num(lead, 'alert_days_before', d.lead.alertDaysBefore, 0) },
    availability: {
      dueDayOfMonth: num(avail, 'due_day_of_month', d.availability.dueDayOfMonth, 1, 28),
      reminderDayOfMonth: num(avail, 'reminder_day_of_month', d.availability.reminderDayOfMonth, 1, 28),
    },
    attendance: { alertHoursAfterEnd: num(att, 'alert_hours_after_end', d.attendance.alertHoursAfterEnd, 0) },
  }
}

// ---------------------------------------------------------------------------
// Pay — flat per party, never hourly
// ---------------------------------------------------------------------------

export function clampSteps(steps: number, s: CrewSettings = DEFAULT_SETTINGS): number {
  if (!Number.isFinite(steps)) return 0
  return Math.min(s.pay.maxSteps, Math.max(0, Math.floor(steps)))
}

/** The rate for one party in this spot at this step. Clean-up running long changes nothing. */
export function partyRateCents(role: SlotRole, steps: number, s: CrewSettings = DEFAULT_SETTINGS): number {
  const start = role === 'lead' ? s.pay.leadStartCents : s.pay.crewStartCents
  return start + clampSteps(steps, s) * s.pay.stepCents
}

/** Everything one person is paid for one worked party, before tips. */
export function partyPayCents(
  role: SlotRole, steps: number, extraFlatCents: number | null | undefined, s: CrewSettings = DEFAULT_SETTINGS,
): number {
  const extra = Number.isFinite(extraFlatCents) && (extraFlatCents as number) > 0 ? Math.round(extraFlatCents as number) : 0
  return partyRateCents(role, steps, s) + extra
}

/** Host Hampton tops every person's tip up to the floor. The top-up is our cost, recorded apart from the tip. */
export function tipTopupCents(tipCents: number | null | undefined, s: CrewSettings = DEFAULT_SETTINGS): number {
  const tip = Number.isFinite(tipCents) && (tipCents as number) > 0 ? Math.round(tipCents as number) : 0
  return Math.max(0, s.pay.tipFloorCents - tip)
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/**
 * Inside the launch grace period? Step LOSSES are recorded but not applied
 * while this is true (gains always apply).
 *
 * The launch date is an Eastern calendar date and the grace runs to Eastern
 * midnight `graceDays` later — through `etToUtc`, because the box is UTC and
 * `new Date('YYYY-MM-DDT00:00:00Z')` (what v1 did) ends the grace at 7 or 8pm
 * the evening before.
 *
 * Not launched yet (no date), or a date that cannot be read, is grace: the
 * direction that never costs a member a step they should have kept.
 */
export function isInGracePeriod(now: Date, s: CrewSettings = DEFAULT_SETTINGS): boolean {
  const date = s.launch.launchDate
  if (!date) return true
  const endDate = shiftEtDate(date, Math.floor(s.launch.graceDays))
  if (!endDate) return true
  const end = etToUtc(endDate, 0, 0)
  if (!Number.isFinite(end.getTime())) return true
  return now.getTime() < end.getTime()
}

export interface StepOutcome {
  /** The value to write. Equals `stepsBefore` when the change was waived. */
  stepsAfter: number
  stepsBefore: number
  delta: number
  /** A loss that the grace period stopped. */
  waivedGrace: boolean
  /** What `stepsAfter` would have been without the grace period. */
  wouldBe: number
}

export function stepAfter(
  event: StepEvent, steps: number, s: CrewSettings = DEFAULT_SETTINGS, inGrace = false,
): StepOutcome {
  const before = clampSteps(steps, s)
  let target: number
  switch (event) {
    case 'worked': target = before + s.steps.worked; break
    case 'worked_covered': target = before + s.steps.covered; break
    case 'early_release': target = before + s.steps.earlyRelease; break
    case 'late_cancel_covered': target = before; break
    case 'late_cancel_uncovered':
    case 'no_show': target = 0; break
    default: {
      const never: never = event
      throw new Error(`unknown step event ${String(never)}`)
    }
  }
  const wouldBe = clampSteps(target, s)
  const waivedGrace = inGrace && wouldBe < before
  const after = waivedGrace ? before : wouldBe
  return { stepsAfter: after, stepsBefore: before, delta: after - before, waivedGrace, wouldBe }
}

/**
 * Correcting attendance: the member's steps with the earlier outcome's change
 * taken back. The ledger row for that outcome carries `step_before` /
 * `step_after`, so the change is known exactly — including a reset, whose
 * delta is whatever the member had, and a waived loss, whose delta is 0.
 */
export function revertedSteps(currentSteps: number, priorDelta: number, s: CrewSettings = DEFAULT_SETTINGS): number {
  return clampSteps(currentSteps - (Number.isFinite(priorDelta) ? priorDelta : 0), s)
}

export interface Rates { crewCents: number; leadCents: number; atMax: boolean }

export function ratesFor(steps: number, s: CrewSettings = DEFAULT_SETTINGS): Rates {
  const st = clampSteps(steps, s)
  return { crewCents: partyRateCents('crew', st, s), leadCents: partyRateCents('lead', st, s), atMax: st >= s.pay.maxSteps }
}

export function formatCents(cents: number): string {
  const neg = cents < 0
  const abs = Math.abs(Math.round(cents))
  return `${neg ? '-' : ''}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/**
 * The plain-words line on a crew member's home screen. Dollars, never a level.
 *   "You're at $58.50 a party ($77.50 leading). One more party makes it $61.00."
 *   "You're at the top rate: $70.00 a party."
 */
export function nextStepLabel(steps: number, canLead: boolean, s: CrewSettings = DEFAULT_SETTINGS): string {
  const r = ratesFor(steps, s)
  const lead = canLead ? ` (${formatCents(r.leadCents)} leading)` : ''
  if (r.atMax) return `You're at the top rate: ${formatCents(r.crewCents)} a party${lead}.`
  const next = ratesFor(clampSteps(steps, s) + 1, s)
  return `You're at ${formatCents(r.crewCents)} a party${lead}. One more party makes it ${formatCents(next.crewCents)}.`
}

// ---------------------------------------------------------------------------
// Staffing
// ---------------------------------------------------------------------------

/** Crew needed, INCLUDING the Lead: max(min, ceil(kids / kids_per_crew)), capped. Unknown kids = min. */
export function requiredSlots(guestCount: number | null | undefined, s: CrewSettings = DEFAULT_SETTINGS): number {
  const { minSlots, kidsPerCrew, maxSlots } = s.slotsByGuests
  if (guestCount == null || !Number.isFinite(guestCount) || guestCount <= 0) return minSlots
  return Math.min(maxSlots, Math.max(minSlots, Math.ceil(guestCount / kidsPerCrew)))
}

export function slotsForParty(
  party: { guestCount: number | null | undefined; slotsOverride?: number | null },
  s: CrewSettings = DEFAULT_SETTINGS,
): number {
  const o = party.slotsOverride
  if (o != null && Number.isInteger(o) && o >= 1 && o <= 10) return o
  return requiredSlots(party.guestCount, s)
}

/** The spots a new crew party gets: exactly one Lead, the rest crew. */
export function slotRolesFor(count: number): SlotRole[] {
  const n = Math.max(1, Math.floor(count))
  return ['lead', ...Array.from({ length: n - 1 }, () => 'crew' as const)]
}

// ---------------------------------------------------------------------------
// Cancelling, cover, confirmations
// ---------------------------------------------------------------------------

export type DropKind = 'early_release' | 'late_cancel' | 'started'

export function classifyDrop(
  startsAt: Date, now: Date, s: CrewSettings = DEFAULT_SETTINGS,
): { kind: DropKind; noticeHours: number } {
  const noticeHours = (startsAt.getTime() - now.getTime()) / HOUR_MS
  if (noticeHours <= 0) return { kind: 'started', noticeHours }
  if (noticeHours >= s.drops.lateDropDays * 24) return { kind: 'early_release', noticeHours }
  return { kind: 'late_cancel', noticeHours }
}

/** When an unclaimed cover request goes to Allie. Zero standbys = straight away. */
export function standbyEscalateAt(requestedAt: Date, standbyCount: number, s: CrewSettings = DEFAULT_SETTINGS): Date {
  if (standbyCount <= 0) return new Date(requestedAt.getTime())
  return new Date(requestedAt.getTime() + s.drops.standbyWindowHours * HOUR_MS)
}

export function unclaimedWarningAt(startsAt: Date, s: CrewSettings = DEFAULT_SETTINGS): Date {
  return new Date(startsAt.getTime() - s.drops.unclaimedWarningHours * HOUR_MS)
}

export function leadAlertAt(startsAt: Date, s: CrewSettings = DEFAULT_SETTINGS): Date {
  return new Date(startsAt.getTime() - s.lead.alertDaysBefore * 24 * HOUR_MS)
}

export function attendanceAlertAt(endsAt: Date, s: CrewSettings = DEFAULT_SETTINGS): Date {
  return new Date(endsAt.getTime() + s.attendance.alertHoursAfterEnd * HOUR_MS)
}

export function confirmationSchedule(startsAt: Date, s: CrewSettings = DEFAULT_SETTINGS) {
  const at = (hoursBefore: number) => new Date(startsAt.getTime() - hoursBefore * HOUR_MS)
  return {
    requestAt: at(s.confirmations.requestHoursBefore),
    reminderAt: at(s.confirmations.reminderHoursBefore),
    dueAt: at(s.confirmations.dueHoursBefore),
    dayBeforeAt: at(s.confirmations.dayBeforeHours),
  }
}

/** A claim can be undone, as if it never happened, until the confirmation request goes out. */
export function canUndoClaim(startsAt: Date, now: Date, s: CrewSettings = DEFAULT_SETTINGS): boolean {
  return now.getTime() < confirmationSchedule(startsAt, s).requestAt.getTime()
}

// ---------------------------------------------------------------------------
// Local time, availability, overlap, hours on record
// ---------------------------------------------------------------------------

const localFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
})
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** Eastern calendar parts for an instant. */
export function localParts(d: Date): { dateKey: string; dow: number; minutes: number } {
  const parts: Record<string, string> = {}
  for (const p of localFormatter.formatToParts(d)) parts[p.type] = p.value
  const hour = Number(parts.hour) % 24
  return { dateKey: `${parts.year}-${parts.month}-${parts.day}`, dow: WEEKDAY_INDEX[parts.weekday] ?? 0, minutes: hour * 60 + Number(parts.minute) }
}

export interface PartyWindow { startsAt: Date; endsAt: Date }
export interface DateBlock { day: string; part: DayPart }
export interface RecurringBlock { dow: number; part: DayPart; active: boolean }

const NOON = 12 * 60

function partBlocks(part: DayPart, startMin: number, endMin: number, endsNextDay: boolean): boolean {
  if (part === 'all_day') return true
  if (part === 'before_noon') return startMin < NOON
  return endsNextDay || endMin > NOON
}

/** Does this member's availability block the party? Judged on the party's Eastern start date. */
export function isBlockedByAvailability(
  party: PartyWindow, blocks: ReadonlyArray<DateBlock>, recurring: ReadonlyArray<RecurringBlock>,
): boolean {
  const start = localParts(party.startsAt)
  const end = localParts(party.endsAt)
  const endsNextDay = end.dateKey !== start.dateKey
  for (const b of blocks) if (b.day === start.dateKey && partBlocks(b.part, start.minutes, end.minutes, endsNextDay)) return true
  for (const r of recurring) if (r.active && r.dow === start.dow && partBlocks(r.part, start.minutes, end.minutes, endsNextDay)) return true
  return false
}

/** Two parties conflict for one person if their shifts, with setup and clean-up, overlap. */
export function shiftsOverlap(a: PartyWindow, b: PartyWindow, s: CrewSettings = DEFAULT_SETTINGS): boolean {
  const pre = s.shift.setupMinutes * 60_000
  const post = s.shift.cleanupMinutes * 60_000
  return a.startsAt.getTime() - pre < b.endsAt.getTime() + post && b.startsAt.getTime() - pre < a.endsAt.getTime() + post
}

export function setupStartsAt(startsAt: Date, s: CrewSettings = DEFAULT_SETTINGS): Date {
  return new Date(startsAt.getTime() - s.shift.setupMinutes * 60_000)
}

/** The shift on record when Allie does not type one: party ± setup/clean-up. Hours are a record, never pay. */
export function defaultShift(party: PartyWindow, s: CrewSettings = DEFAULT_SETTINGS): { startedAt: Date; endedAt: Date; hours: number } {
  const startedAt = setupStartsAt(party.startsAt, s)
  const endedAt = new Date(party.endsAt.getTime() + s.shift.cleanupMinutes * 60_000)
  return { startedAt, endedAt, hours: hoursBetween(startedAt, endedAt) }
}

export function hoursBetween(a: Date, b: Date): number {
  const h = (b.getTime() - a.getTime()) / HOUR_MS
  return Number.isFinite(h) && h > 0 ? Math.round(h * 100) / 100 : 0
}
