/**
 * WHEN is each evite email due, and WHO is it for: the PURE half of `evite-sends` (spec §9.1, §9.3).
 *
 * Nothing here reads a database, sends anything or looks at the clock: a function gets the loaded
 * `SendContext`, the RSVPs, the evite's send ledger and an explicit `now`, and answers with the ledger
 * keys that should be claimed. `cronTick.ts` does the reading and the claiming; `sendOne.ts` does the
 * building and the sending and re-checks everything that can change between the two.
 *
 * THE DIVISION OF LABOUR, because it is easy to get wrong in either direction:
 *   - THIS file knows the DUE time ("week_before is due at 10:00 ET seven days out") and the skip rules that
 *     are about the SELECTION (a guest who RSVPed after the due time never gets that reminder; a `No` gets
 *     nothing; `details_changed` only for a guest who was on the list before the date moved).
 *   - `sendOne.ts` knows the SENDABLE-UNTIL time, the state, the calendar version the message was keyed
 *     under, the opt-out and the suppression list, and enforces them at send time. This file asks the same
 *     question (`sendableUntil` is imported, not restated) so it never CLAIMS a message the sender would
 *     only skip: a skip is terminal, and a claim that is skipped for a reason that would have passed a
 *     minute later is a message lost.
 *
 * Every time here goes through `etToUtc` / `shiftEtDate`. The box is UTC; a local-time Date setter would schedule in UTC.
 */

import { etToUtc, shiftEtDate } from '@/lib/partyTime'
import { isPlausibleEmailAddress } from '@/lib/contactLookup'
import { etHourMinute } from '@/lib/quietHours'
import { HOUR_MS, MINUTE_MS } from '@/lib/rateLimit'
import { validPartyDate } from '@/lib/evites/partyWindow'
import { LEAD_PREVIEW_WINDOW_MS, sendableUntil } from '@/lib/evites/sendOne'
import { MAX_SEND_ATTEMPTS, type SendKey } from '@/lib/evites/sends'
import type { SendContext, SendRsvpRow } from '@/lib/evites/sendContext'
import type { EviteSendType } from '@/lib/evites/types'

/* ── the clock rules, in one place ────────────────────────────── */

/** `lead_preview`: the booking must be at least this old (the customer has had a moment) ... */
export const LEAD_PREVIEW_MIN_AGE_MS = 10 * MINUTE_MS
/** ... and the evite must have been made within this long of the booking (intake, not backfill). */
export const LEAD_PREVIEW_MAX_EVITE_LAG_MS = 1 * HOUR_MS
/** `lead_preview` goes out from 09:00 until before 20:00 Eastern. */
export const LEAD_PREVIEW_OPEN_HOUR = 9
export const LEAD_PREVIEW_CLOSE_HOUR = 20
/** `party_cancelled`: wait this long after the booking was cancelled before telling the guests (a mis-click gets undone). */
export const CANCEL_GRACE_MS = 30 * MINUTE_MS
/** The orphan sweep looks at RSVPs touched within this long ... */
export const ORPHAN_LOOKBACK_MS = 48 * HOUR_MS
/** ... and leaves alone anything younger than this (the inline hook is probably still running). */
export const ORPHAN_MIN_AGE_MS = 5 * MINUTE_MS

/* ── due times (spec §9.1) ────────────────────────────────────── */

function atEt(date: string, offsetDays: number, hour: number, minute: number): Date | null {
  const shifted = shiftEtDate(date, offsetDays)
  if (!shifted) return null
  const t = etToUtc(shifted, hour, minute)
  return Number.isFinite(t.getTime()) ? t : null
}

/** `week_before`: 10:00 ET, seven days before the party. */
export const weekBeforeDue = (partyDate: string): Date | null => atEt(partyDate, -7, 10, 0)
/** `day_before`: 16:00 ET the day before. */
export const dayBeforeDue = (partyDate: string): Date | null => atEt(partyDate, -1, 16, 0)
/** `final_headcount`: 16:30 ET the day before. */
export const finalHeadcountDue = (partyDate: string): Date | null => atEt(partyDate, -1, 16, 30)

/** Does the ET date `today` fall on or after `partyDate + days`? */
export function dayOnOrAfter(today: string, partyDate: string, days: number): boolean {
  const due = shiftEtDate(partyDate, days)
  return due !== '' && today >= due
}

/* ── the ledger, as the selection sees it ─────────────────────── */

export interface LedgerRow {
  rsvp_id: string | null
  send_type: EviteSendType
  ref_version: number
  status: 'sending' | 'sent' | 'failed' | 'skipped'
  attempts: number
}
export type Ledger = Map<string, LedgerRow>

export const ledgerKey = (rsvpId: string | null, type: EviteSendType, ref: number): string => `${rsvpId ?? '-'}|${type}|${ref}`

export function toLedger(rows: readonly LedgerRow[]): Ledger {
  const m: Ledger = new Map()
  for (const r of rows) m.set(ledgerKey(r.rsvp_id, r.send_type, r.ref_version), r)
  return m
}

/** Has ANY row (in any state) been written for this message? A key that exists is somebody's: never claim it again. */
export const hasRow = (ledger: Ledger, rsvpId: string | null, type: EviteSendType, ref: number): boolean => ledger.has(ledgerKey(rsvpId, type, ref))

/** Settled = it went, it was deliberately skipped, or it failed out of attempts. Anything else is still in flight or will be retried. */
function settled(row: LedgerRow | undefined): boolean {
  if (!row) return false
  if (row.status === 'sent' || row.status === 'skipped') return true
  return row.status === 'failed' && row.attempts >= MAX_SEND_ATTEMPTS
}

/* ── small predicates ─────────────────────────────────────────── */

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN)

/** The parent's address, when it is one we would mail. */
export function parentHasEmail(ctx: Pick<SendContext, 'booking'>): boolean {
  return isPlausibleEmailAddress((ctx.booking.contact_email ?? '').trim())
}

/** A guest who said yes, has not opted out and left an address we would mail. */
export function guestEligible(r: Pick<SendRsvpRow, 'status' | 'reminder_opt_out_at' | 'reminder_email'>): boolean {
  return r.status === 'yes' && !r.reminder_opt_out_at && isPlausibleEmailAddress((r.reminder_email ?? '').trim())
}

/** The common gate of every scheduled guest/parent reminder: a live party that has gone live, with a window. */
function reminderReady(ctx: SendContext): boolean {
  return ctx.state === 'live' && !!ctx.evite.went_live_at && ctx.facts.window !== null
}

/**
 * Cheap pre-check, so the tick does not read the RSVP list and the ledger of a party that cannot have
 * anything due: a live party that has not started, and either its calendar has changed (a
 * `details_changed` may be owed) or the week-before reminder time has arrived.
 */
export function needsGuestReminders(ctx: SendContext, now: Date): boolean {
  if (!reminderReady(ctx)) return false
  const win = ctx.facts.window
  if (!win || now.getTime() > win.startUtc.getTime()) return false
  if (ctx.evite.cal_version > 0) return true
  const date = validPartyDate(ctx.booking.party_date)
  const week = date ? weekBeforeDue(date) : null
  return week !== null && now.getTime() >= week.getTime()
}

export interface PlanInput {
  ctx: SendContext
  rsvps: readonly SendRsvpRow[]
  ledger: Ledger
  now: Date
}

const keyFor = (ctx: SendContext, rsvpId: string | null, type: EviteSendType, ref: number): SendKey => ({
  evite_id: ctx.evite.id,
  rsvp_id: rsvpId,
  send_type: type,
  ref_version: ref,
})

/** True when `now` is inside `[due, until]` for this type. */
function inWindow(ctx: SendContext, type: EviteSendType, due: Date | null, now: Date): boolean {
  if (!due || now.getTime() < due.getTime()) return false
  const until = sendableUntil(type, ctx)
  return until !== null && now.getTime() <= until.getTime()
}

/* ── guest reminders ──────────────────────────────────────────── */

/**
 * `details_changed`: the party moved after the guest was on the list and the guest has not yet been sent
 * a calendar entry for the new version. Two conditions say "this guest was told the OLD thing":
 *   - `cal_version > rsvp.cal_version_seen`  (the .ics they hold is older), and
 *   - the RSVP was created BEFORE `cal_changed_at` (a guest who RSVPed after the move was never told the old thing).
 */
export function planDetailsChanged(i: PlanInput): SendKey[] {
  const { ctx, rsvps, ledger, now } = i
  const v = ctx.evite.cal_version
  const changedAt = ms(ctx.evite.cal_changed_at)
  if (!reminderReady(ctx) || v <= 0 || !Number.isFinite(changedAt)) return []
  const until = sendableUntil('details_changed', ctx)
  if (until === null || now.getTime() > until.getTime()) return []

  const out: SendKey[] = []
  for (const r of rsvps) {
    if (!guestEligible(r)) continue
    if (!(v > r.cal_version_seen)) continue
    if (!(ms(r.created_at) < changedAt)) continue
    if (hasRow(ledger, r.id, 'details_changed', v)) continue
    out.push(keyFor(ctx, r.id, 'details_changed', v))
  }
  return out
}

function planReminder(i: PlanInput, type: 'week_before' | 'day_before', due: (date: string) => Date | null): SendKey[] {
  const { ctx, rsvps, ledger, now } = i
  const date = validPartyDate(ctx.booking.party_date)
  if (!reminderReady(ctx) || !date) return []
  const dueAt = due(date)
  if (!inWindow(ctx, type, dueAt, now)) return []
  const v = ctx.evite.cal_version

  const out: SendKey[] = []
  for (const r of rsvps) {
    if (!guestEligible(r)) continue
    // A guest who RSVPed AFTER the reminder was due is not sent that reminder: they were told everything
    // when they RSVPed, and a "see you in a week" three minutes after "you're on the list" is noise.
    if (ms(r.created_at) > (dueAt as Date).getTime()) continue
    // The same rule for a guest the date change has ALREADY told: when this reminder's new due time had passed
    // before the calendar moved, `details_changed` (sent for that very change) carried the new date, and a
    // "see you in a week" in the same tick would be a second email about one fact. A `day_before` is not held
    // back: it is the one reminder owed on the real day, and spec 9.1 re-sends it per calendar version.
    if (type === 'week_before' && v > 0 && (dueAt as Date).getTime() < ms(ctx.evite.cal_changed_at)) continue
    if (hasRow(ledger, r.id, type, v)) continue
    out.push(keyFor(ctx, r.id, type, v))
  }
  return out
}

/** `week_before`: 10:00 ET seven days out, until 48 hours before the party; keyed on the calendar version. */
export const planWeekBefore = (i: PlanInput): SendKey[] => planReminder(i, 'week_before', weekBeforeDue)

/** `day_before`: 16:00 ET the day before, until 23:59 ET that day (so never on the party day); keyed on the calendar version. */
export const planDayBefore = (i: PlanInput): SendKey[] => planReminder(i, 'day_before', dayBeforeDue)

/* ── the parent's final headcount ─────────────────────────────── */

export type FinalHeadcountPlan =
  | { kind: 'send'; key: SendKey }
  /** Due, but a `day_before` for this calendar version is still in flight or being retried. */
  | { kind: 'wait' }
  | { kind: 'none' }

/**
 * `final_headcount`: 16:30 ET the day before, to the PARENT, and only once every eligible guest's
 * `day_before` for this calendar version is settled - the headcount should not go out while a guest's
 * reminder is still being retried and their RSVP could still change on the strength of it.
 */
export function planFinalHeadcount(i: PlanInput): FinalHeadcountPlan {
  const { ctx, rsvps, ledger, now } = i
  const date = validPartyDate(ctx.booking.party_date)
  if (!reminderReady(ctx) || !date || !parentHasEmail(ctx)) return { kind: 'none' }
  const v = ctx.evite.cal_version
  if (hasRow(ledger, null, 'final_headcount', v)) return { kind: 'none' }
  if (!inWindow(ctx, 'final_headcount', finalHeadcountDue(date), now)) return { kind: 'none' }

  const dayDue = dayBeforeDue(date)
  for (const r of rsvps) {
    if (!guestEligible(r)) continue
    // Not owed a day_before (RSVPed after it was due): nothing to wait for.
    if (dayDue && ms(r.created_at) > dayDue.getTime()) continue
    if (!settled(ledger.get(ledgerKey(r.id, 'day_before', v)))) return { kind: 'wait' }
  }
  return { kind: 'send', key: keyFor(ctx, null, 'final_headcount', v) }
}

/* ── the lead preview and the "invitation is ready" email ─────── */

export type CandidateVerdict = { ok: true } | { ok: false; reason: string }
const no = (reason: string): CandidateVerdict => ({ ok: false, reason })

/**
 * `lead_preview` (spec §9.1): state `preview`, render fresh, the evite made within an hour of the booking
 * (intake, not a backfill of an old lead), the booking 10 minutes to 14 days old, 09:00-20:00 Eastern,
 * and an address to send to. Suppression is the caller's pre-claim check (it is a read).
 */
export function leadPreviewVerdict(ctx: SendContext, now: Date): CandidateVerdict {
  if (ctx.state !== 'preview') return no('state')
  const booked = ms(ctx.booking.created_at)
  const made = ms(ctx.evite.created_at)
  if (!Number.isFinite(booked) || !Number.isFinite(made)) return no('no-dates')
  if (made - booked > LEAD_PREVIEW_MAX_EVITE_LAG_MS) return no('not-intake')
  const age = now.getTime() - booked
  if (age < LEAD_PREVIEW_MIN_AGE_MS) return no('too-new')
  if (age > LEAD_PREVIEW_WINDOW_MS) return no('too-old')
  if (!parentHasEmail(ctx)) return no('no-email')
  if (!ctx.renderFresh) return no('render-stale')
  const clock = etHourMinute(now)
  if (!clock) return no('unreadable-clock')
  if (clock.hour < LEAD_PREVIEW_OPEN_HOUR || clock.hour >= LEAD_PREVIEW_CLOSE_HOUR) return no('outside-hours')
  return { ok: true }
}

/** `invite_ready`: state live (and gone live), the render fresh for the LIVE facts, the party still >= 2 days out. */
export function inviteReadyVerdict(ctx: SendContext, now: Date): CandidateVerdict {
  if (ctx.state !== 'live') return no('state')
  if (!ctx.evite.went_live_at) return no('not-stamped')
  if (!parentHasEmail(ctx)) return no('no-email')
  const until = sendableUntil('invite_ready', ctx)
  if (until === null) return no('no-deadline')
  if (now.getTime() > until.getTime()) return no('too-late')
  if (!ctx.renderFresh) return no('render-stale')
  return { ok: true }
}

/* ── the orphan sweep ─────────────────────────────────────────── */

/**
 * The inline hooks claim `new_rsvp` / `rsvp_changed` (keyed on the RSVP's revision) and `rsvp_confirmed`
 * right after the write. If the process died between the write and the claim, the RSVP exists and the
 * ledger has no trace of it. For each RSVP (already filtered by the caller to "touched in the last 48
 * hours and older than 5 minutes"), return the keys whose rows are missing. The unique index makes a
 * claim that races the slow inline one harmless.
 *
 * Only the LATEST revision is expected: a guest on revision 3 does not need a `new_rsvp` for revision 1.
 *
 * `rsvp_confirmed` additionally needs `reminder_set_at` inside the lookback AND no `rsvp_confirmed` row: the address
 * was set recently (by the POST, or by a PATCH that went through the same per-address caps) and has not been
 * confirmed. `ms()` of a null/absent timestamp is NaN, which is never "recent".
 */
export function planOrphans(evite: { id: string }, rsvps: readonly SendRsvpRow[], ledger: Ledger, now: Date): SendKey[] {
  const lookbackFrom = now.getTime() - ORPHAN_LOOKBACK_MS
  const out: SendKey[] = []
  for (const r of rsvps) {
    const parentType: EviteSendType = r.revision <= 1 ? 'new_rsvp' : 'rsvp_changed'
    if (!hasRow(ledger, r.id, parentType, r.revision)) {
      out.push({ evite_id: evite.id, rsvp_id: r.id, send_type: parentType, ref_version: r.revision })
    }
    // `rsvp_confirmed` is the ONE mail the sweep can originate for an address, so it is owed only when the address was
    // SET inside the sweep's own lookback (it was passed through the capped path then). An RSVP that merely got
    // touched (a name edit, a note) with an address set long ago is not a trigger to mail that address.
    const setAt = ms(r.reminder_set_at)
    if (guestEligible(r) && Number.isFinite(setAt) && setAt >= lookbackFrom && !hasRow(ledger, r.id, 'rsvp_confirmed', 0)) {
      out.push({ evite_id: evite.id, rsvp_id: r.id, send_type: 'rsvp_confirmed', ref_version: 0 })
    }
  }
  return out
}
