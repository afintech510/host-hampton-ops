/**
 * One tick of `/api/cron/evite-sends` (spec §9.3). The route is a thin wrapper around `runEviteSendsTick`;
 * everything that matters lives here so a test can drive it with a fake database and an injected clock.
 *
 * THE STEPS, in the spec's order, each bounded:
 *
 *   1  Backfill        `ensureEviteForBooking` for eligible bookings that have no invitation (25 a tick)
 *   2  Live stamp      an invitation seen `live` for the first time: re-slug if the name changed, then
 *                      `went_live_at = now` (conditional on NULL) and the calendar BASELINE hash
 *   3  Calendar change a stamped invitation whose start/end/location/title changed: `cal_version + 1`,
 *                      new hash, `cal_changed_at` (conditional on the old hash). INDEPENDENT of rendering.
 *                      Then up to 2 stale renders.
 *   4  Reclaim         `reclaimFailed` -> `performSend` for each row handed back
 *   5  lead_preview    see cronDue.leadPreviewVerdict; suppression is checked BEFORE the claim
 *   6  invite_ready    live, render fresh, party >= 2 days out
 *   7  party_cancelled, details_changed, week_before, day_before, final_headcount, then the orphan sweep -
 *                      50 claimed sends a tick IN TOTAL
 *   8  Retention       lib/evites/retention.ts
 *   9  Report          COUNTS PER STEP AND OUTCOME ONLY. No name, address, slug or booking ref.
 *
 * FLAGS. `EVITES_PAGES` gates steps 1-3 and retention; `EVITES_SENDS` gates steps 4-7 (and needs pages on:
 * nothing is `live` with pages off). `pilot` restricts every step to the bookings in `EVITES_PILOT_REFS`.
 * `off`/`off` costs nothing: no database read.
 *
 * CLAIM BEFORE SEND, THEN SEND ONCE. Every email goes through `claimAndSend` (or `performSend` for a row
 * `reclaimFailed` handed back). The ledger's unique index is the only thing that makes two overlapping
 * ticks, or a tick and the inline hook, send one message; this file additionally reads the ledger first so
 * a key that already has a row is not even attempted. A skip is TERMINAL, so selection asks the sender's own
 * questions (`sendableUntil`, the state, the opt-out) before claiming and never claims what it knows would be
 * skipped for a reason that would not hold a minute later.
 *
 * CANCELLATION TIME. `bookings` has no `cancelled_at`. `bookings.updated_at` is stamped by a trigger on every
 * UPDATE, and the last write to a cancelled booking is the cancellation itself, so "cancelled >= 30 minutes
 * ago" is `updated_at <= now - 30 min`. A later edit to a cancelled booking restarts the grace (it can only
 * DELAY the notice, never send it early); the admin's `notify_cancelled` button is the immediate path.
 *
 * BOUNDED EVERYWHERE: the scan is capped, `.in()` lists are chunked, a render is 2 a tick, a reclaim is 20, the
 * previews are 10 and 20, the step-7 budget is 50 claims, and repeated "could not claim" answers stop the step.
 */

import type { getSupabase } from '@/lib/supabase'
import { etDateString, shiftEtDate } from '@/lib/partyTime'
import { DAY_MS } from '@/lib/rateLimit'
import { evitePagesMode, eviteSendsMode, isPilotBooking, type EviteMode } from '@/lib/evites/config'
import { ensureEviteForBooking } from '@/lib/evites/ensure'
import { isEviteEligible } from '@/lib/evites/eligibility'
import { childNameOf } from '@/lib/evites/facts'
import { calInputsHash } from '@/lib/evites/hash'
import { validPartyDate } from '@/lib/evites/partyWindow'
import { queueRender, renderEvite } from '@/lib/evites/render'
import { claimAndSend, performSend, type ClaimAndSendResult, type SendResult } from '@/lib/evites/sendOne'
import { reclaimFailed, type SendKey } from '@/lib/evites/sends'
import { sendPartyCancelledNotices } from '@/lib/evites/inlineSends'
import { loadHeadcountRsvps, loadSendContext, type SendContext, type SendContextRead, type SendRsvpRow } from '@/lib/evites/sendContext'
import { emailSuppressed } from '@/lib/evites/suppression'
import { makeSlug, slugNameFor, slugNamePart } from '@/lib/evites/slug'
import { resolveTheme } from '@/lib/evites/themes'
import { readThemeInputs } from '@/lib/evites/themeInputs'
import { EVITE_BOOKING_COLUMNS, EVITE_SEND_RSVP_COLUMNS } from '@/lib/evites/views'
import type { EviteBookingRow, EviteSendType } from '@/lib/evites/types'
import {
  CANCEL_GRACE_MS,
  ORPHAN_LOOKBACK_MS,
  ORPHAN_MIN_AGE_MS,
  hasRow,
  inviteReadyVerdict,
  leadPreviewVerdict,
  needsGuestReminders,
  planDayBefore,
  planDetailsChanged,
  planFinalHeadcount,
  planOrphans,
  planWeekBefore,
  toLedger,
  type Ledger,
  type LedgerRow,
} from '@/lib/evites/cronDue'
import { chunks, IN_CHUNK, runRetention, type RetentionReport } from '@/lib/evites/retention'

type Supa = ReturnType<typeof getSupabase>

/* ── the bounds ───────────────────────────────────────────────── */

export const BACKFILL_PER_TICK = 25
export const BACKFILL_RECENT_DAYS = 14
/** How many candidate bookings each backfill query reads. */
export const BACKFILL_SCAN = 300
export const SCAN_LIMIT = 150
export const RENDERS_PER_TICK = 2
export const RECLAIM_PER_TICK = 20
export const LEAD_PREVIEW_PER_TICK = 10
export const INVITE_READY_PER_TICK = 20
/** Claimed sends per tick across step 7 (party_cancelled .. final_headcount, and the orphan sweep). */
export const STEP7_SENDS_PER_TICK = 50
export const ORPHAN_SCAN = 200
export const LEDGER_LIMIT = 1000
/** Stop a step after this many "the claim could not be written" answers: the database is not answering. */
export const MAX_UNAVAILABLE_PER_STEP = 5
/** A soft wall-clock ceiling: past it no NEW send is started. */
export const TICK_SOFT_DEADLINE_MS = 100_000

/* ── the report: counts only ──────────────────────────────────── */

export interface Tally {
  sent: number
  skipped: number
  failed: number
  duplicate: number
  unavailable: number
  disabled: number
}
const tally = (): Tally => ({ sent: 0, skipped: 0, failed: 0, duplicate: 0, unavailable: 0, disabled: 0 })

function add(t: Tally, r: ClaimAndSendResult | SendResult): void {
  if (r.kind === 'sent') t.sent += 1
  else if (r.kind === 'skipped') t.skipped += 1
  else if (r.kind === 'failed') t.failed += 1
  else if (r.kind === 'duplicate') t.duplicate += 1
  else if (r.kind === 'unavailable') t.unavailable += 1
  else t.disabled += 1
}

export interface TickReport {
  ok: boolean
  flags: { pages: EviteMode; sends: EviteMode }
  /** True when both flags are off and nothing was read. */
  idle: boolean
  scan: { evites: number; active: number; cancelled: number; past: number; truncated: boolean; unavailable: boolean }
  backfill: { considered: number; created: number; exists: number; ineligible: number; disabled: number; unavailable: number }
  liveStamp: { candidates: number; stamped: number; reslugged: number; deferred: number }
  calChange: { checked: number; bumped: number; baselined: number; raced: number }
  renders: { attempted: number; rendered: number; fresh: number; busy: number; failed: number; skipped: number }
  reclaim: { reclaimed: number; exhausted: number; sweepErrors: number } & Tally
  leadPreview: Tally & { candidates: number; deferred: number; holds: Record<string, number> }
  inviteReady: Tally & { candidates: number; deferred: number; holds: Record<string, number> }
  step7: {
    budget: number
    used: number
    exhausted: boolean
    partyCancelled: Tally & { evites: number; stamped: number }
    detailsChanged: Tally
    weekBefore: Tally
    dayBefore: Tally
    finalHeadcount: Tally & { waiting: number }
    orphans: Tally
  }
  retention: RetentionReport | null
  timedOut: boolean
  errors: number
  failedSteps: string[]
}

function newReport(pages: EviteMode, sends: EviteMode): TickReport {
  return {
    ok: true,
    flags: { pages, sends },
    idle: false,
    scan: { evites: 0, active: 0, cancelled: 0, past: 0, truncated: false, unavailable: false },
    backfill: { considered: 0, created: 0, exists: 0, ineligible: 0, disabled: 0, unavailable: 0 },
    liveStamp: { candidates: 0, stamped: 0, reslugged: 0, deferred: 0 },
    calChange: { checked: 0, bumped: 0, baselined: 0, raced: 0 },
    renders: { attempted: 0, rendered: 0, fresh: 0, busy: 0, failed: 0, skipped: 0 },
    reclaim: { reclaimed: 0, exhausted: 0, sweepErrors: 0, ...tally() },
    leadPreview: { ...tally(), candidates: 0, deferred: 0, holds: {} },
    inviteReady: { ...tally(), candidates: 0, deferred: 0, holds: {} },
    step7: {
      budget: STEP7_SENDS_PER_TICK,
      used: 0,
      exhausted: false,
      partyCancelled: { ...tally(), evites: 0, stamped: 0 },
      detailsChanged: tally(),
      weekBefore: tally(),
      dayBefore: tally(),
      finalHeadcount: { ...tally(), waiting: 0 },
      orphans: tally(),
    },
    retention: null,
    timedOut: false,
    errors: 0,
    failedSteps: [],
  }
}

/* ── per-tick state ───────────────────────────────────────────── */

interface ScanItem {
  eviteId: string
  bookingId: string
  wentLive: boolean
  cancelledNoticeAt: string | null
  ref: string | null
  status: string | null
  partyDate: string | null
  bookingUpdatedAt: string | null
  pagesOk: boolean
  sendsOk: boolean
}

interface Run {
  supabase: Supa
  now: Date
  today: string
  rep: TickReport
  pages: EviteMode
  sends: EviteMode
  sendsActive: boolean
  startedAt: number
  /** evite id -> its context, read at most once per tick (dropped when a step changes the evite). */
  ctxCache: Map<string, SendContextRead>
  /** evite id -> its send ledger, kept current as this tick claims. */
  ledgers: Map<string, Ledger>
  active: ScanItem[]
  cancelled: ScanItem[]
}

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function noteError(run: Run, step: string): void {
  run.rep.errors += 1
  if (!run.rep.failedSteps.includes(step)) run.rep.failedSteps.push(step)
}

function pastDeadline(run: Run): boolean {
  if (Date.now() - run.startedAt > TICK_SOFT_DEADLINE_MS) {
    run.rep.timedOut = true
    return true
  }
  return false
}

async function ctxOf(run: Run, eviteId: string): Promise<SendContextRead> {
  const hit = run.ctxCache.get(eviteId)
  if (hit) return hit
  const read = await loadSendContext(run.supabase, eviteId, null, run.now)
  run.ctxCache.set(eviteId, read)
  return read
}

/** The context, or null when it could not be read (counted as an error) or the evite is gone. */
async function readyCtx(run: Run, eviteId: string, step: string): Promise<SendContext | null> {
  const read = await ctxOf(run, eviteId)
  if (read.kind === 'unavailable') {
    noteError(run, step)
    return null
  }
  return read.kind === 'ok' ? read.ctx : null
}

async function ledgerOf(run: Run, eviteId: string): Promise<Ledger | null> {
  const hit = run.ledgers.get(eviteId)
  if (hit) return hit
  const r = await run.supabase
    .from('evite_sends')
    .select('rsvp_id, send_type, ref_version, status, attempts')
    .eq('evite_id', eviteId)
    .eq('channel', 'email')
    .limit(LEDGER_LIMIT + 1)
  const rows = (r.data ?? []) as unknown as LedgerRow[]
  // A truncated ledger cannot prove a key is absent.
  if (r.error || rows.length > LEDGER_LIMIT) return null
  const ledger = toLedger(rows)
  run.ledgers.set(eviteId, ledger)
  return ledger
}

/** Remember what a claim did, so the same tick never attempts the same key twice. */
function remember(ledger: Ledger, key: SendKey, r: ClaimAndSendResult): void {
  if (r.kind === 'unavailable' || r.kind === 'disabled') return
  const status: LedgerRow['status'] = r.kind === 'sent' ? 'sent' : r.kind === 'skipped' ? 'skipped' : r.kind === 'failed' ? 'failed' : 'sending'
  ledger.set(`${key.rsvp_id ?? '-'}|${key.send_type}|${key.ref_version}`, {
    rsvp_id: key.rsvp_id,
    send_type: key.send_type,
    ref_version: key.ref_version,
    status,
    attempts: 1,
  })
}

/* ── the scan ─────────────────────────────────────────────────── */

async function scan(run: Run): Promise<void> {
  const { supabase, rep } = run
  const list = await supabase
    .from('evites')
    .select('id, booking_id, went_live_at, cancelled_notice_at')
    .is('archived_at', null)
    .order('updated_at', { ascending: true })
    .limit(SCAN_LIMIT + 1)
  if (list.error) {
    rep.scan.unavailable = true
    noteError(run, 'scan')
    console.error(`evites/cron: scan read failed: ${list.error.message}`)
    return
  }
  let evites = (list.data ?? []) as unknown as Array<{ id: string; booking_id: string; went_live_at: string | null; cancelled_notice_at: string | null }>
  if (evites.length > SCAN_LIMIT) {
    rep.scan.truncated = true
    evites = evites.slice(0, SCAN_LIMIT)
  }
  rep.scan.evites = evites.length

  const bookings = new Map<string, { booking_ref: string | null; status: string | null; party_date: string | null; updated_at: string | null }>()
  for (const part of chunks(Array.from(new Set(evites.map((e) => e.booking_id))), IN_CHUNK)) {
    const r = await supabase.from('bookings').select('id, booking_ref, status, party_date, updated_at').in('id', part)
    if (r.error) {
      // An unread booking would make its evite look "past" or "gone": stop, do not guess.
      rep.scan.unavailable = true
      noteError(run, 'scan')
      console.error(`evites/cron: scan bookings read failed: ${r.error.message}`)
      return
    }
    for (const b of (r.data ?? []) as unknown as Array<{ id: string; booking_ref: string | null; status: string | null; party_date: string | null; updated_at: string | null }>) {
      bookings.set(b.id, b)
    }
  }

  const yesterday = shiftEtDate(run.today, -1)
  for (const ev of evites) {
    const b = bookings.get(ev.booking_id)
    if (!b) continue
    const pagesOk = run.pages === 'on' || (run.pages === 'pilot' && isPilotBooking(b.booking_ref))
    const sendsOk = run.sendsActive && (run.sends === 'on' || isPilotBooking(b.booking_ref))
    if (!pagesOk && !sendsOk) continue
    const item: ScanItem = {
      eviteId: ev.id,
      bookingId: ev.booking_id,
      wentLive: !!ev.went_live_at,
      cancelledNoticeAt: ev.cancelled_notice_at,
      ref: b.booking_ref,
      status: b.status,
      partyDate: validPartyDate(b.party_date),
      bookingUpdatedAt: b.updated_at,
      pagesOk,
      sendsOk,
    }
    if (b.status === 'cancelled' || b.status === 'lost') {
      run.cancelled.push(item)
      continue
    }
    // A party that finished before yesterday has nothing left to schedule (retention handles its data).
    if (item.partyDate !== null && yesterday !== '' && item.partyDate < yesterday) {
      rep.scan.past += 1
      continue
    }
    run.active.push(item)
  }
  rep.scan.active = run.active.length
  rep.scan.cancelled = run.cancelled.length
}

/* ── step 1: backfill ─────────────────────────────────────────── */

async function stepBackfill(run: Run): Promise<void> {
  const { supabase, rep, now, today } = run
  const cols = EVITE_BOOKING_COLUMNS.join(', ')
  const cutoff = new Date(now.getTime() - BACKFILL_RECENT_DAYS * DAY_MS).toISOString()
  const upcoming = await supabase.from('bookings').select(cols).gte('party_date', today).order('party_date', { ascending: true }).limit(BACKFILL_SCAN)
  const recent = await supabase.from('bookings').select(cols).gte('created_at', cutoff).order('created_at', { ascending: false }).limit(BACKFILL_SCAN)
  for (const r of [upcoming, recent]) {
    if (r.error) {
      noteError(run, 'backfill')
      console.error(`evites/cron: backfill read failed: ${r.error.message}`)
    }
  }
  const byId = new Map<string, EviteBookingRow>()
  for (const r of [upcoming, recent]) {
    if (r.error) continue
    for (const b of (r.data ?? []) as unknown as EviteBookingRow[]) byId.set(b.id, b)
  }
  const eligible = Array.from(byId.values()).filter((b) => isEviteEligible(b) && (run.pages === 'on' || isPilotBooking(b.booking_ref)))
  if (eligible.length === 0) return

  // "No evite" includes an ARCHIVED one: it still exists, so it is never re-created.
  const have = new Set<string>()
  for (const part of chunks(eligible.map((b) => b.id), IN_CHUNK)) {
    const r = await supabase.from('evites').select('booking_id').in('booking_id', part)
    if (r.error) {
      noteError(run, 'backfill')
      console.error(`evites/cron: backfill existing read failed: ${r.error.message}`)
      return
    }
    for (const row of (r.data ?? []) as unknown as Array<{ booking_id: string }>) have.add(row.booking_id)
  }
  const missing = eligible.filter((b) => !have.has(b.id))
  rep.backfill.considered = missing.length

  for (const b of missing.slice(0, BACKFILL_PER_TICK)) {
    const out = await ensureEviteForBooking(supabase, b.id)
    if (out.kind === 'created') {
      rep.backfill.created += 1
      queueRender(out.eviteId)
    } else if (out.kind === 'exists') rep.backfill.exists += 1
    else if (out.kind === 'ineligible') rep.backfill.ineligible += 1
    else if (out.kind === 'disabled') rep.backfill.disabled += 1
    else {
      rep.backfill.unavailable += 1
      noteError(run, 'backfill')
    }
  }
}

/* ── step 2: the live stamp (and the re-slug) ─────────────────── */

type ReslugResult = 'done' | 'raced' | 'error'

/** §7.4: before go-live, a slug whose name part is stale is re-minted; the old slug becomes a 308 alias. */
async function reslug(run: Run, ctx: SendContext): Promise<ReslugResult> {
  const { supabase } = run
  const inputs = await readThemeInputs(supabase, ctx.booking.id)
  if (inputs.kind === 'unavailable') return 'error'
  const prev = await supabase.from('evites').select('previous_slugs').eq('id', ctx.evite.id).maybeSingle<{ previous_slugs: string[] | null }>()
  if (prev.error || !prev.data) return 'error'

  const oldSlug = ctx.evite.slug
  const previous = Array.from(new Set([...(prev.data.previous_slugs ?? []), oldSlug]))
  const theme = resolveTheme(ctx.booking, inputs.lineItems, inputs.partyThemes).short
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = makeSlug(childNameOf(ctx.booking), theme)
    const w = await supabase
      .from('evites')
      .update({ slug, previous_slugs: previous })
      .eq('id', ctx.evite.id)
      .eq('slug', oldSlug)
      .is('went_live_at', null)
      .select('id')
    if (w.error) {
      // The only unique index this write can hit is the slug's: mint again.
      if ((w.error as { code?: string }).code === '23505') continue
      console.error(`evites/cron: re-slug failed: ${w.error.message}`)
      return 'error'
    }
    return ((w.data ?? []) as unknown[]).length > 0 ? 'done' : 'raced'
  }
  return 'error'
}

async function stepLiveStamp(run: Run): Promise<void> {
  const { supabase, rep } = run
  for (const item of run.active) {
    if (!item.pagesOk) continue
    const ctx = await readyCtx(run, item.eviteId, 'liveStamp')
    if (!ctx || ctx.evite.went_live_at || ctx.state !== 'live') continue
    rep.liveStamp.candidates += 1

    const wantName = slugNameFor(childNameOf(ctx.booking))
    if (slugNamePart(ctx.evite.slug) !== wantName) {
      const result = await reslug(run, ctx)
      run.ctxCache.delete(item.eviteId)
      if (result === 'done') rep.liveStamp.reslugged += 1
      else {
        // Not stamped: stamping is what freezes the slug, so a re-slug that did not happen is retried next tick.
        rep.liveStamp.deferred += 1
        if (result === 'error') noteError(run, 'liveStamp')
        continue
      }
    }

    const w = await supabase
      .from('evites')
      .update({ went_live_at: run.now.toISOString(), cal_inputs_hash: calInputsHash(ctx.facts) })
      .eq('id', item.eviteId)
      .is('went_live_at', null)
      .select('id')
    if (w.error) {
      noteError(run, 'liveStamp')
      console.error(`evites/cron: went_live_at not recorded: ${w.error.message}`)
      continue
    }
    if (((w.data ?? []) as unknown[]).length > 0) rep.liveStamp.stamped += 1
    run.ctxCache.delete(item.eviteId)
  }
}

/* ── step 3: calendar change, then stale renders ──────────────── */

async function stepCalendar(run: Run): Promise<void> {
  const { supabase, rep } = run
  for (const item of run.active) {
    if (!item.pagesOk) continue
    const ctx = await readyCtx(run, item.eviteId, 'calChange')
    if (!ctx || !ctx.evite.went_live_at) continue
    if (ctx.state !== 'live' && ctx.state !== 'needs_time' && ctx.state !== 'preview') continue
    rep.calChange.checked += 1

    const hash = calInputsHash(ctx.facts)
    const stored = ctx.evite.cal_inputs_hash
    if (stored === hash) continue

    if (stored === null || stored === undefined) {
      // A stamped invitation with no baseline (should not happen): adopt the current hash WITHOUT bumping the version.
      const b = await supabase.from('evites').update({ cal_inputs_hash: hash }).eq('id', item.eviteId).is('cal_inputs_hash', null).select('id')
      if (b.error) noteError(run, 'calChange')
      else rep.calChange.baselined += ((b.data ?? []) as unknown[]).length
      run.ctxCache.delete(item.eviteId)
      continue
    }

    const w = await supabase
      .from('evites')
      .update({ cal_version: ctx.evite.cal_version + 1, cal_inputs_hash: hash, cal_changed_at: run.now.toISOString() })
      .eq('id', item.eviteId)
      .eq('cal_version', ctx.evite.cal_version)
      .eq('cal_inputs_hash', stored)
      .select('id')
    if (w.error) {
      noteError(run, 'calChange')
      console.error(`evites/cron: cal_version not bumped: ${w.error.message}`)
      continue
    }
    if (((w.data ?? []) as unknown[]).length > 0) rep.calChange.bumped += 1
    else rep.calChange.raced += 1
    run.ctxCache.delete(item.eviteId)
  }
}

async function stepRenders(run: Run): Promise<void> {
  const { supabase, rep } = run
  let attempted = 0
  for (const item of run.active) {
    if (attempted >= RENDERS_PER_TICK) break
    if (!item.pagesOk) continue
    const ctx = await readyCtx(run, item.eviteId, 'renders')
    if (!ctx || ctx.renderFresh) continue
    // Only a page somebody can still open needs a picture.
    if (ctx.state !== 'preview' && ctx.state !== 'needs_time' && ctx.state !== 'live') continue
    attempted += 1
    rep.renders.attempted += 1
    const out = await renderEvite(supabase, item.eviteId, { now: run.now })
    if (out.kind === 'rendered') rep.renders.rendered += 1
    else if (out.kind === 'fresh') rep.renders.fresh += 1
    else if (out.kind === 'busy') rep.renders.busy += 1
    else if (out.kind === 'skipped') rep.renders.skipped += 1
    else {
      rep.renders.failed += 1
      noteError(run, 'renders')
    }
    run.ctxCache.delete(item.eviteId)
  }
}

/* ── step 4: reclaim ──────────────────────────────────────────── */

async function stepReclaim(run: Run): Promise<void> {
  const { supabase, rep, now } = run
  const got = await reclaimFailed(supabase, { limit: RECLAIM_PER_TICK, now })
  rep.reclaim.reclaimed = got.reclaimed.length
  rep.reclaim.exhausted = got.exhausted
  rep.reclaim.sweepErrors = got.errors.length
  if (got.errors.length > 0) noteError(run, 'reclaim')
  for (const row of got.reclaimed) {
    if (pastDeadline(run)) return
    add(rep.reclaim, await performSend(supabase, row, { now }))
  }
}

/* ── steps 5 and 6: the parent / lead emails ──────────────────── */

type ParentStep = 'leadPreview' | 'inviteReady'

async function stepParent(run: Run, which: ParentStep): Promise<void> {
  const { supabase, rep, now } = run
  const type: EviteSendType = which === 'leadPreview' ? 'lead_preview' : 'invite_ready'
  const bucket = rep[which]
  const cap = which === 'leadPreview' ? LEAD_PREVIEW_PER_TICK : INVITE_READY_PER_TICK
  const verdictOf = which === 'leadPreview' ? leadPreviewVerdict : inviteReadyVerdict
  let claimed = 0
  let unavailable = 0

  for (const item of run.active) {
    if (claimed >= cap || unavailable >= MAX_UNAVAILABLE_PER_STEP || pastDeadline(run)) break
    if (!item.sendsOk) continue
    const ctx = await readyCtx(run, item.eviteId, which)
    if (!ctx) continue
    const verdict = verdictOf(ctx, now)
    if (!verdict.ok) {
      if (verdict.reason !== 'state') bucket.holds[verdict.reason] = (bucket.holds[verdict.reason] ?? 0) + 1
      continue
    }
    const ledger = await ledgerOf(run, item.eviteId)
    if (!ledger) {
      noteError(run, which)
      continue
    }
    if (hasRow(ledger, null, type, 0)) continue
    bucket.candidates += 1

    // Suppression BEFORE the claim: an unreadable list defers (no claim, no attempt spent); a hit is claimed
    // and recorded as a terminal `suppressed` skip by the sender, which re-checks.
    const sup = await emailSuppressed(supabase, (ctx.booking.contact_email ?? '').trim())
    if (sup === 'unavailable') {
      bucket.deferred += 1
      continue
    }
    const key: SendKey = { evite_id: item.eviteId, rsvp_id: null, send_type: type, ref_version: 0 }
    const r = await claimAndSend(supabase, key, { now })
    add(bucket, r)
    remember(ledger, key, r)
    if (r.kind === 'sent' || r.kind === 'skipped' || r.kind === 'failed') claimed += 1
    if (r.kind === 'unavailable') {
      unavailable += 1
      noteError(run, which)
    }
  }
}

/* ── step 7 ───────────────────────────────────────────────────── */

interface GuestWork {
  ctx: SendContext
  rsvps: SendRsvpRow[]
  ledger: Ledger
}

function spend(run: Run, r: ClaimAndSendResult): void {
  if (r.kind === 'sent' || r.kind === 'skipped' || r.kind === 'failed') run.rep.step7.used += 1
}
const budgetLeft = (run: Run): number => run.rep.step7.budget - run.rep.step7.used

async function stepCancelled(run: Run): Promise<void> {
  const { supabase, rep, now } = run
  const graceEdge = now.getTime() - CANCEL_GRACE_MS
  for (const item of run.cancelled) {
    if (pastDeadline(run)) return
    if (!item.sendsOk || !item.wentLive || item.cancelledNoticeAt) continue
    // The party must still be ahead: a notice for a party that has happened is only noise.
    if (item.partyDate === null || item.partyDate < run.today) continue
    // Grace: wait 30 minutes after the cancellation (the booking's last write) so a mis-click can be undone.
    const touched = item.bookingUpdatedAt ? Date.parse(item.bookingUpdatedAt) : NaN
    if (!Number.isFinite(touched) || touched > graceEdge) continue

    // A notice is owed. No budget left means it waits for the next tick (and says so).
    if (budgetLeft(run) <= 0) {
      rep.step7.exhausted = true
      return
    }
    rep.step7.partyCancelled.evites += 1
    const r = await sendPartyCancelledNotices(supabase, item.eviteId, now, { budget: budgetLeft(run) })
    rep.step7.partyCancelled.sent += r.sent ?? 0
    rep.step7.partyCancelled.failed += r.failed ?? 0
    rep.step7.partyCancelled.skipped += r.skipped ?? 0
    rep.step7.partyCancelled.duplicate += r.duplicate ?? 0
    if (r.stamped) rep.step7.partyCancelled.stamped += 1
    rep.step7.used += r.claimed ?? 0
    if (!r.ok) noteError(run, 'partyCancelled')
  }
}

async function guestWorkFor(run: Run): Promise<GuestWork[]> {
  const out: GuestWork[] = []
  for (const item of run.active) {
    if (!item.sendsOk) continue
    const ctx = await readyCtx(run, item.eviteId, 'step7')
    if (!ctx || !needsGuestReminders(ctx, run.now)) continue
    const ledger = await ledgerOf(run, item.eviteId)
    const rs = await loadHeadcountRsvps(run.supabase, item.eviteId)
    if (!ledger || rs.kind === 'unavailable') {
      noteError(run, 'step7')
      continue
    }
    out.push({ ctx, rsvps: rs.rsvps, ledger })
  }
  return out
}

type GuestPhase = 'detailsChanged' | 'weekBefore' | 'dayBefore'

async function runKeys(run: Run, keys: SendKey[], ledger: Ledger, into: Tally, counter: { unavailable: number }): Promise<void> {
  for (const key of keys) {
    if (budgetLeft(run) <= 0) {
      run.rep.step7.exhausted = true
      return
    }
    if (counter.unavailable >= MAX_UNAVAILABLE_PER_STEP || pastDeadline(run)) return
    const r = await claimAndSend(run.supabase, key, { now: run.now })
    add(into, r)
    remember(ledger, key, r)
    spend(run, r)
    if (r.kind === 'unavailable') {
      counter.unavailable += 1
      noteError(run, 'step7')
    }
  }
}

async function stepGuests(run: Run): Promise<void> {
  const { rep, now } = run
  const work = await guestWorkFor(run)
  const counter = { unavailable: 0 }
  const phases: Array<[GuestPhase, (w: GuestWork) => SendKey[]]> = [
    ['detailsChanged', (w) => planDetailsChanged({ ctx: w.ctx, rsvps: w.rsvps, ledger: w.ledger, now })],
    ['weekBefore', (w) => planWeekBefore({ ctx: w.ctx, rsvps: w.rsvps, ledger: w.ledger, now })],
    ['dayBefore', (w) => planDayBefore({ ctx: w.ctx, rsvps: w.rsvps, ledger: w.ledger, now })],
  ]
  for (const [phase, plan] of phases) {
    for (const w of work) await runKeys(run, plan(w), w.ledger, rep.step7[phase], counter)
  }

  // final_headcount reads the ledger AFTER the day_before phase above, so a day_before settled this tick counts.
  for (const w of work) {
    const plan = planFinalHeadcount({ ctx: w.ctx, rsvps: w.rsvps, ledger: w.ledger, now })
    if (plan.kind === 'wait') {
      rep.step7.finalHeadcount.waiting += 1
      continue
    }
    if (plan.kind !== 'send') continue
    if (budgetLeft(run) <= 0) {
      rep.step7.exhausted = true
      continue
    }
    const sup = await emailSuppressed(run.supabase, (w.ctx.booking.contact_email ?? '').trim())
    if (sup === 'unavailable') continue
    await runKeys(run, [plan.key], w.ledger, rep.step7.finalHeadcount, counter)
  }
}

/** RSVPs whose inline notices never reached the ledger (a crash between the write and the claim). */
async function stepOrphans(run: Run): Promise<void> {
  const { supabase, rep, now } = run
  if (budgetLeft(run) <= 0) {
    rep.step7.exhausted = true
    return
  }
  const from = new Date(now.getTime() - ORPHAN_LOOKBACK_MS).toISOString()
  const to = new Date(now.getTime() - ORPHAN_MIN_AGE_MS).toISOString()
  const r = await supabase
    .from('evite_rsvps')
    .select(EVITE_SEND_RSVP_COLUMNS.join(', '))
    .gte('updated_at', from)
    .lte('updated_at', to)
    .order('updated_at', { ascending: true })
    .limit(ORPHAN_SCAN)
  if (r.error) {
    noteError(run, 'orphans')
    console.error(`evites/cron: orphan read failed: ${r.error.message}`)
    return
  }
  const byEvite = new Map<string, SendRsvpRow[]>()
  for (const row of (r.data ?? []) as unknown as SendRsvpRow[]) {
    const list = byEvite.get(row.evite_id) ?? []
    list.push(row)
    byEvite.set(row.evite_id, list)
  }
  // Only parties still on the active list (not archived, not long past, sends allowed for them).
  const allowed = new Set(run.active.filter((i) => i.sendsOk).map((i) => i.eviteId))
  const counter = { unavailable: 0 }
  for (const [eviteId, rows] of Array.from(byEvite.entries())) {
    if (!allowed.has(eviteId)) continue
    if (budgetLeft(run) <= 0) {
      rep.step7.exhausted = true
      return
    }
    const ledger = await ledgerOf(run, eviteId)
    if (!ledger) {
      noteError(run, 'orphans')
      continue
    }
    await runKeys(run, planOrphans({ id: eviteId }, rows, ledger), ledger, rep.step7.orphans, counter)
  }
}

/* ── the tick ─────────────────────────────────────────────────── */

async function guarded(run: Run, step: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    noteError(run, step)
    console.error(`evites/cron: ${step} threw: ${errorMessage(e)}`)
  }
}

export async function runEviteSendsTick(supabase: Supa, opts: { now?: Date } = {}): Promise<TickReport> {
  const now = opts.now ?? new Date()
  const pages = evitePagesMode()
  const sends = eviteSendsMode()
  const rep = newReport(pages, sends)
  if (pages === 'off' && sends === 'off') {
    rep.idle = true
    return rep
  }

  const run: Run = {
    supabase,
    now,
    today: etDateString(now),
    rep,
    pages,
    sends,
    // Nothing is `live` with pages off, and a switched-off feature must not send a cancellation either.
    sendsActive: sends !== 'off' && pages !== 'off',
    startedAt: Date.now(),
    ctxCache: new Map(),
    ledgers: new Map(),
    active: [],
    cancelled: [],
  }

  if (pages !== 'off') {
    await guarded(run, 'backfill', () => stepBackfill(run))
    await guarded(run, 'scan', () => scan(run))
    // A scan that THREW part-way left `active` half-built: that is "could not read", not "nothing to do".
    if (rep.failedSteps.includes('scan')) rep.scan.unavailable = true
    if (!rep.scan.unavailable) {
      await guarded(run, 'liveStamp', () => stepLiveStamp(run))
      await guarded(run, 'calChange', () => stepCalendar(run))
      await guarded(run, 'renders', () => stepRenders(run))
    }
  }

  if (run.sendsActive) {
    await guarded(run, 'reclaim', () => stepReclaim(run))
    if (!rep.scan.unavailable) {
      await guarded(run, 'leadPreview', () => stepParent(run, 'leadPreview'))
      await guarded(run, 'inviteReady', () => stepParent(run, 'inviteReady'))
      await guarded(run, 'partyCancelled', () => stepCancelled(run))
      await guarded(run, 'step7', () => stepGuests(run))
      await guarded(run, 'orphans', () => stepOrphans(run))
    }
  }

  if (pages !== 'off') {
    await guarded(run, 'retention', async () => {
      rep.retention = await runRetention(supabase, { now })
      if (rep.retention.errors > 0) noteError(run, 'retention')
    })
  }

  rep.ok = rep.errors === 0
  return rep
}
