/**
 * INTEL's half — reading the result, and REFUSING to invent one.
 *
 * ── The rule this module exists to obey ─────────────────────────────────────
 *
 * Hard-won rule 15: fabricated signal is worse than none, because it becomes a
 * standing rule. Everywhere else in this system that rule protects a prompt;
 * here it protects a decision about how Host Hampton talks to its customers. An
 * A/B result is the most quotable number a marketing pipeline produces, and once
 * "variant B converts better" is said out loud nobody asks again how many
 * people were in arm B.
 *
 * So there are FIVE outcomes and only one of them names a winner:
 *
 *   winner            both arms cleared `min_per_arm` AND the two-proportion
 *                     test cleared `alpha`.
 *   no_difference     enough data, no significant difference. A real result.
 *   not_enough_data   the honest answer today, and it says exactly what is
 *                     missing — which arm, how many it has, how many it needs.
 *   unconfigured      the experiment cannot be analysed at all (no control,
 *                     fewer than two arms). Rule 10: an unconfigured run must
 *                     not look like a run that learned nothing.
 *   unavailable       a read failed. NOT zero. A variant whose count could not
 *                     be read must never be reported as losing (rule 12).
 *
 * ── One metric, chosen up front ─────────────────────────────────────────────
 *
 * `content_experiments.metric` is a column and the analysis reads it. Choosing
 * the metric after seeing the data is how a pipeline manufactures significance:
 * three metrics at α = 0.05 is an effective false-positive rate near 14%.
 *
 * ── The denominator is `sent`, not `assigned` ───────────────────────────────
 *
 * An assignment with no send never put the copy in front of anybody. Counting
 * it would dilute both arms by however many enrollments happen to be paused,
 * and it would make the rate depend on when the analysis ran.
 *
 * ── `converted` is attributed inside a STATED window, and then RECORDED ─────
 *
 * We cause a send and we cause a click, so those are recorded at the moment
 * they happen. We do not cause a booking. Attribution is therefore a window
 * claim, and a time window is not a fact (rule 15, link 10's form) — so the
 * window is named in the output every single time, and the attribution is
 * written to `variant_events` once so the number cannot quietly change between
 * two readings of the same experiment.
 */

import type { getSupabase } from '@/lib/supabase'
import { recordVariantEvent, recordUnattributed } from './assign'
import { CONVERSION_WINDOW_DAYS, type ExperimentMetric, type VariantRow } from './types'
import type { UsableExperiment } from './load'

type Supa = ReturnType<typeof getSupabase>

export interface ArmCounts {
  variantId: string
  label: string
  isControl: boolean
  sent: number
  metricCount: number
  /** metricCount / sent, or null when sent is 0 — never 0/0 rendered as 0%. */
  rate: number | null
}

export type AnalysisResult =
  | {
      kind: 'winner'
      metric: ExperimentMetric
      arms: ArmCounts[]
      winner: ArmCounts
      control: ArmCounts
      pValue: number
      alpha: number
      note: string
      unattributed: number
    }
  | {
      kind: 'no_difference'
      metric: ExperimentMetric
      arms: ArmCounts[]
      control: ArmCounts
      pValue: number
      alpha: number
      note: string
      unattributed: number
    }
  | {
      kind: 'not_enough_data'
      metric: ExperimentMetric
      arms: ArmCounts[]
      minPerArm: number
      note: string
      unattributed: number
    }
  | { kind: 'unconfigured'; note: string }
  | { kind: 'unavailable'; error: string }

/* ── statistics, written out rather than pulled in ─────────────────────────── */

/**
 * Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation
 * (|error| < 1.5e-7). Written here rather than adding a dependency: this is
 * eight lines and a dependency is a supply-chain decision.
 */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

/**
 * Two-sided two-proportion z-test with a POOLED standard error.
 *
 * Returns null when the test cannot be computed — a zero pooled variance, which
 * happens when both arms are all-hits or all-misses. `null` means "no p-value",
 * and the caller treats that as not-enough-data rather than as p = 1 or p = 0.
 * Guessing either way here is the whole of rule 15 in one number.
 */
export function twoProportionPValue(
  hitsA: number,
  nA: number,
  hitsB: number,
  nB: number
): number | null {
  if (nA <= 0 || nB <= 0) return null
  const pA = hitsA / nA
  const pB = hitsB / nB
  const pooled = (hitsA + hitsB) / (nA + nB)
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB))
  if (!Number.isFinite(se) || se === 0) return null
  const z = (pA - pB) / se
  if (!Number.isFinite(z)) return null
  return 2 * (1 - normalCdf(Math.abs(z)))
}

/* ── counting ──────────────────────────────────────────────────────────────── */

interface AssignmentRow {
  id: string
  variant_id: string
  contact_id: string
  assigned_at: string
}

/**
 * How many ids go into one `.in(...)` filter.
 *
 * PostgREST takes `.in()` as a query PARAMETER, so the whole id list travels in
 * the URL. Measured against production on 2026-09-12 by driving the real
 * endpoint with a growing list of real assignment uuids:
 *
 *   380 ids → URL 14,174 chars → 200, 380 rows
 *   400 ids → URL 14,914 chars → the request is refused at the connection and
 *             `fetch` throws, which supabase-js hands back as
 *             `{ error: 'TypeError: fetch failed' }`
 *
 * So an unchunked read died at about 390 assignments. The analysis reported
 * `unavailable` rather than a wrong number — rule 12 held — but it reported it
 * FOREVER: an experiment that reached that many assigned contacts became
 * permanently unanalysable, and `min_per_arm` defaults to 30 over two arms
 * against a 1,219-row contacts table, so the ceiling sat inside the range the
 * feature is for. Chunked at 100 the URL is under 4 kB with an order of
 * magnitude of headroom.
 *
 * There is no PostgREST row cap in the way: the same probe confirmed an
 * unlimited `select` returned all 500 rows.
 */
export const IN_CHUNK = 100

function chunk<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Run one `.in()` read in bounded batches and concatenate.
 *
 * A failure in ANY batch is the whole read failing (rule 12): half the events
 * is not a smaller truth, it is a smaller numerator against a full
 * denominator, which is the one direction that invents a result.
 */
async function readIn(
  ids: string[],
  run: (batch: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<{ rows: Record<string, unknown>[] } | { error: string }> {
  const rows: Record<string, unknown>[] = []
  for (const batch of chunk(ids)) {
    const { data, error } = await run(batch)
    if (error) return { error: error.message }
    rows.push(...((data ?? []) as Record<string, unknown>[]))
  }
  return { rows }
}

/**
 * Attribute conversions inside the stated window and RECORD them.
 *
 * A booking whose `contact_id` matches an assigned contact and whose
 * `created_at` falls in `[assigned_at, assigned_at + CONVERSION_WINDOW_DAYS]`
 * is a conversion. A booking that predates the assignment is not — and that is
 * worth stating, because the population being mailed is people who have already
 * enquired, so most of them have a booking row of some kind already.
 *
 * Returns the number newly recorded, or an error. A read failure here is NOT a
 * zero: it would understate every arm and could flip a result.
 */
export async function attributeConversions(
  supabase: Supa,
  assignments: AssignmentRow[]
): Promise<{ recorded: number; duplicates: number } | { error: string }> {
  if (assignments.length === 0) return { recorded: 0, duplicates: 0 }

  const contactIds = Array.from(new Set(assignments.map(a => a.contact_id)))
  // Chunked: see IN_CHUNK. A 400-contact experiment made this read throw.
  const read = await readIn(contactIds, batch =>
    supabase.from('bookings').select('id, contact_id, created_at, status').in('contact_id', batch)
  )
  if ('error' in read) return { error: `bookings unreadable: ${read.error}` }
  const data = read.rows

  const windowMs = CONVERSION_WINDOW_DAYS * 24 * 60 * 60 * 1000
  let recorded = 0
  let duplicates = 0

  for (const a of assignments) {
    const assignedMs = Date.parse(a.assigned_at)
    if (!Number.isFinite(assignedMs)) {
      // An unreadable assignment timestamp cannot be windowed. Dropped and
      // named, never defaulted to "now" — which would make every booking count.
      await recordUnattributed(supabase, 'conversion_window', `assignment ${a.id} has an unparseable assigned_at`, {
        assignment_id: a.id,
        assigned_at: a.assigned_at,
      })
      continue
    }
    const hit = (data ?? []).find(b => {
      if (String(b.contact_id) !== a.contact_id) return false
      if (String(b.status) === 'cancelled') return false
      const created = Date.parse(String(b.created_at))
      if (!Number.isFinite(created)) return false
      return created >= assignedMs && created <= assignedMs + windowMs
    })
    if (!hit) continue

    const out = await recordVariantEvent({
      supabase,
      assignmentId: a.id,
      eventType: 'converted',
      detail: `booking ${String(hit.id)}`,
      meta: { booking_id: String(hit.id), window_days: CONVERSION_WINDOW_DAYS, attributed_at: new Date().toISOString() },
    })
    if (out.kind === 'recorded') recorded++
    else if (out.kind === 'duplicate') duplicates++
    else return { error: `could not record a conversion: ${out.error}` }
  }

  return { recorded, duplicates }
}

/**
 * Analyse one experiment.
 *
 * `attribute` defaults to true for the `converted` metric: the analysis run is
 * the only thing that can see a booking, so it does the attributing. Pass false
 * to read without writing (the admin GET does, so opening a panel never mutates
 * the data it is showing).
 */
export async function analyseExperiment(
  supabase: Supa,
  loaded: UsableExperiment,
  opts: { attribute?: boolean } = {}
): Promise<AnalysisResult> {
  const { experiment, variants } = loaded

  if (variants.length < 2) {
    return {
      kind: 'unconfigured',
      note:
        `"${experiment.name}" has ${variants.length} usable variant(s). A test needs at least two.` +
        (loaded.rejected.length
          ? ` The read-time screen dropped: ${loaded.rejected.map(r => `${r.label} — ${r.reason}`).join('; ')}`
          : ''),
    }
  }
  const control = variants.find(v => v.is_control)
  if (!control) {
    return {
      kind: 'unconfigured',
      note: `"${experiment.name}" has no control variant, so there is nothing to compare against. Mark one variant as the control.`,
    }
  }

  const { data: rawAssignments, error: aErr } = await supabase
    .from('variant_assignments')
    .select('id, variant_id, contact_id, assigned_at')
    .eq('experiment_id', experiment.id)
  if (aErr) return { kind: 'unavailable', error: `assignments unreadable: ${aErr.message}` }

  const assignments: AssignmentRow[] = ((rawAssignments ?? []) as Record<string, unknown>[]).map(r => ({
    id: String(r.id),
    variant_id: String(r.variant_id),
    contact_id: String(r.contact_id),
    assigned_at: String(r.assigned_at ?? ''),
  }))

  if (experiment.metric === 'converted' && opts.attribute !== false) {
    const attributed = await attributeConversions(supabase, assignments)
    if ('error' in attributed) return { kind: 'unavailable', error: attributed.error }
  }

  const assignmentIds = assignments.map(a => a.id)
  let events: { assignment_id: string; event_type: string }[] = []
  if (assignmentIds.length > 0) {
    // Chunked: see IN_CHUNK. Unchunked, this is the read that threw at ~390
    // assignments and left the experiment permanently `unavailable`.
    const read = await readIn(assignmentIds, batch =>
      supabase.from('variant_events').select('assignment_id, event_type').in('assignment_id', batch)
    )
    if ('error' in read) return { kind: 'unavailable', error: `events unreadable: ${read.error}` }
    events = read.rows.map(r => ({
      assignment_id: String(r.assignment_id),
      event_type: String(r.event_type),
    }))
  }

  const byAssignment = new Map(assignments.map(a => [a.id, a]))
  const armOf = new Map<string, string>() // assignment id → variant id
  for (const a of assignments) armOf.set(a.id, a.variant_id)

  const sentBy = new Map<string, number>()
  const metricBy = new Map<string, number>()
  let unattributed = 0
  /** Which arms swallowed events, so the row written below can name them. */
  const unattributedArms = new Map<string, number>()

  for (const ev of events) {
    const assignment = byAssignment.get(ev.assignment_id)
    if (!assignment) {
      // Rule 14's final branch. Reachable: an assignment deleted while its
      // events remain would be caught by the FK, but an event arriving for an
      // id that is no longer in the set we just read is not impossible, and
      // silently ignoring it is how a real click becomes an absence.
      unattributed++
      continue
    }
    const variantId = assignment.variant_id
    if (!variants.some(v => v.id === variantId)) {
      // The arm exists in the assignment table but not among the USABLE
      // variants — the read screen dropped it, or it was deleted. Counting this
      // event against any arm would attribute an outcome to copy we cannot see.
      unattributed++
      unattributedArms.set(variantId, (unattributedArms.get(variantId) ?? 0) + 1)
      continue
    }
    if (ev.event_type === 'sent') sentBy.set(variantId, (sentBy.get(variantId) ?? 0) + 1)
    if (ev.event_type === experiment.metric) metricBy.set(variantId, (metricBy.get(variantId) ?? 0) + 1)
  }

  const arms: ArmCounts[] = variants.map(v => {
    const sent = sentBy.get(v.id) ?? 0
    const metricCount = metricBy.get(v.id) ?? 0
    return {
      variantId: v.id,
      label: v.label,
      isControl: v.is_control,
      sent,
      metricCount,
      rate: sent > 0 ? metricCount / sent : null,
    }
  })

  /**
   * Rule 14's final branch, which this function had been counting and not
   * writing.
   *
   * Measured in production on 2026-09-12: a hostile arm C inserted straight
   * into Postgres was correctly dropped by the read screen, and its 19 events
   * — including NINE clicks, 39% of the experiment's click volume — were held
   * out of both arms and counted here. `unattributed_signals` stayed EMPTY, and
   * the admin panel's own message pointed the reader at it:
   *
   *   "19 event(s) could not be attributed to any arm — see the unattributed
   *    signals" … a list with nothing in it.
   *
   * That is rule 14 exactly (an unattributable record is a bookkeeping problem;
   * an INVISIBLE one is a loss) and rule 10's expensive half (it must not say it
   * did something it did not), in the module whose header cites rule 14 as its
   * reason for existing.
   *
   * ONE summary row per analysis run, not one per event: the count and the arms
   * are what a human needs, and a row per event would put nineteen identical
   * lines in front of them. Written only when `attribute` is on — i.e. by the
   * scheduled report, never by the admin GET, because opening a page must not
   * write to the table the page is showing.
   */
  if (unattributed > 0 && opts.attribute !== false) {
    const named = Array.from(unattributedArms.entries())
      .map(([variantId, n]) => {
        const dropped = loaded.rejected.find(r => r.id === variantId)
        return dropped ? `arm ${dropped.label} (${n} event(s)) — ${dropped.reason}` : `variant ${variantId} (${n} event(s)) — not among the usable variants`
      })
      .join('; ')
    await recordUnattributed(
      supabase,
      'variant_events',
      `${unattributed} outcome event(s) in "${experiment.name}" belong to no usable arm and are in no arm's numerator or denominator` +
        (named ? `: ${named}` : ''),
      {
        experiment_id: experiment.id,
        experiment_name: experiment.name,
        events: unattributed,
        arms: Object.fromEntries(unattributedArms),
        rejected: loaded.rejected,
      }
    )
  }

  const controlArm = arms.find(a => a.variantId === control.id) as ArmCounts
  const windowNote =
    experiment.metric === 'converted'
      ? ` Conversions are attributed to a booking created within ${CONVERSION_WINDOW_DAYS} days of the assignment; that window is an assumption, not a measurement.`
      : ''

  // THE REFUSAL. Named, per arm, with both numbers — so the answer is actionable
  // rather than a shrug.
  const short = arms.filter(a => a.sent < experiment.min_per_arm)
  if (short.length > 0) {
    return {
      kind: 'not_enough_data',
      metric: experiment.metric,
      arms,
      minPerArm: experiment.min_per_arm,
      unattributed,
      note:
        `Not enough data to call "${experiment.name}". ` +
        short.map(a => `arm ${a.label} has ${a.sent} send(s) of the ${experiment.min_per_arm} needed`).join('; ') +
        `.${windowNote}`,
    }
  }

  // Best non-control arm by rate. `rate` cannot be null here: every arm cleared
  // min_per_arm, which is at least 2.
  const challengers = arms.filter(a => !a.isControl)
  const best = challengers.reduce((acc, a) => ((a.rate ?? -1) > (acc.rate ?? -1) ? a : acc), challengers[0])

  const p = twoProportionPValue(best.metricCount, best.sent, controlArm.metricCount, controlArm.sent)
  if (p === null) {
    return {
      kind: 'not_enough_data',
      metric: experiment.metric,
      arms,
      minPerArm: experiment.min_per_arm,
      unattributed,
      note:
        `"${experiment.name}" has enough sends but no computable test statistic — both arms are entirely ` +
        `hits or entirely misses, so the pooled variance is zero. That is not a tie and it is not a win.${windowNote}`,
    }
  }

  // Bonferroni over the challengers actually compared. With one challenger this
  // is exactly alpha; with three it is the correction a three-arm test needs and
  // that a naive implementation silently skips.
  const adjustedAlpha = experiment.alpha / Math.max(1, challengers.length)

  if (p < adjustedAlpha && (best.rate ?? 0) > (controlArm.rate ?? 0)) {
    return {
      kind: 'winner',
      metric: experiment.metric,
      arms,
      winner: best,
      control: controlArm,
      pValue: p,
      alpha: adjustedAlpha,
      unattributed,
      note:
        `Arm ${best.label} beat the control (${best.label}: ${best.metricCount}/${best.sent}, ` +
        `control ${controlArm.label}: ${controlArm.metricCount}/${controlArm.sent}, p = ${p.toFixed(4)} ` +
        `against α = ${adjustedAlpha.toFixed(4)}, Bonferroni over ${challengers.length} challenger(s)). ` +
        `This is a PROPOSAL: nothing has been changed.${windowNote}`,
    }
  }

  /**
   * A significant result in the CONTROL's favour is still `no_difference` as far
   * as the `kind` goes — a winner here only ever means a challenger won, and the
   * DB `outcome` CHECK has no fifth label — but the SENTENCE has to say it.
   *
   * Measured in production on 2026-09-12: a conversion probe came back
   * `no_difference` with "control A: 2/2, challenger B: 0/3, p = 0.0253 against
   * α = 0.0500" and the words "Enough data, no winner — which is a result."
   * p was BELOW alpha and the control had won. A reader takes that sentence as
   * "the copy makes no difference" when the measurement says "the new copy is
   * significantly worse" — which is the same class of mistake as reporting a
   * rigged arm as a losing one (rule 15), with the arithmetic pointing the
   * other way.
   */
  const controlWon = p < adjustedAlpha && (controlArm.rate ?? 0) > (best.rate ?? 0)

  return {
    kind: 'no_difference',
    metric: experiment.metric,
    arms,
    control: controlArm,
    pValue: p,
    alpha: adjustedAlpha,
    unattributed,
    note:
      (controlWon
        ? `The CONTROL beat every challenger in "${experiment.name}" on ${experiment.metric}, significantly ` +
          `(control ${controlArm.label}: ${controlArm.metricCount}/${controlArm.sent}, best challenger ${best.label}: ` +
          `${best.metricCount}/${best.sent}, p = ${p.toFixed(4)} against α = ${adjustedAlpha.toFixed(4)}, ` +
          `Bonferroni over ${challengers.length} challenger(s)). No challenger won, so there is no winner to propose — ` +
          `but this is not "no difference": the live copy is measurably ahead and the challengers should not be adopted.`
        : `No significant difference in "${experiment.name}" on ${experiment.metric} ` +
          `(best challenger ${best.label}: ${best.metricCount}/${best.sent}, control ${controlArm.label}: ` +
          `${controlArm.metricCount}/${controlArm.sent}, p = ${p.toFixed(4)} against α = ${adjustedAlpha.toFixed(4)}, ` +
          `Bonferroni over ${challengers.length} challenger(s)). ` +
          `Enough data, no winner — which is a result.`) + windowNote,
  }
}

/** The DB `outcome` label for a result. `unconfigured` has none: it is not an outcome. */
export function outcomeLabel(r: AnalysisResult): 'winner' | 'no_difference' | 'not_enough_data' | 'unavailable' | null {
  switch (r.kind) {
    case 'winner':
      return 'winner'
    case 'no_difference':
      return 'no_difference'
    case 'not_enough_data':
      return 'not_enough_data'
    case 'unavailable':
      return 'unavailable'
    default:
      return null
  }
}

/**
 * The sentence a report must add when the read-time screen ate an arm.
 *
 * Declared once and used by the scheduled report and by anything else that
 * prints a verdict, because a constant — or a SENTENCE — written in two places
 * is one nothing is checking (rule 11). It exists at all because the weekly
 * report could not say this: an arm dropped in production took nine of the
 * experiment's twenty-three clicks out of the numbers and the report said
 * `winner` without a word about it.
 */
export function droppedArmsNote(rejected: { label: string; reason: string }[]): string {
  if (!rejected.length) return ''
  return (
    ` NOTE: the read-time screen dropped ${rejected.map(r => `arm ${r.label} (${r.reason})`).join('; ')} — ` +
    `any sends or clicks on that arm are in NO arm's numbers.`
  )
}

/** A one-line summary safe to put in a ledger row or a cron console. */
export function summarise(r: AnalysisResult): string {
  if (r.kind === 'unavailable') return `unavailable: ${r.error}`
  if (r.kind === 'unconfigured') return `unconfigured: ${r.note}`
  return r.note
}

export type { VariantRow }
