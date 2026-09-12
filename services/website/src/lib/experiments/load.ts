/**
 * Reading an experiment and its variants — with the screen on the READ path.
 *
 * This module is the §24 lesson applied before anyone had to learn it here.
 * `sanitizeVoiceProfile` was correct and ran only on the write path, so the
 * live hand-written profile had never been screened and was feeding prices into
 * a prompt that forbids them. A `content_variants` row can arrive by a route, by
 * `psql`, or from a version of the screen that was looser than today's — so the
 * screen runs HERE, where the copy is about to be put in front of a customer.
 *
 * Every function in this file returns THREE outcomes, never two. A failed read
 * is not "there is no experiment" (hard-won rule 12): sending the control
 * because the table was unreadable is the right thing to DO and the wrong thing
 * to RECORD, because recording a `sent` against an arm we did not use is
 * fabricated signal in the one place it becomes a standing rule.
 */

import type { getSupabase } from '@/lib/supabase'
import { screenVariant, bodyHtmlFromText, extractLinks } from './screen'
import { safeSiteLink } from '@/lib/content/contentSafety'
import { isExcludedFromTracking } from './track'
import {
  isExperimentMetric,
  isExperimentSurface,
  experimentIsLive,
  type ExperimentRow,
  type ExperimentSurface,
  type VariantRow,
  MAX_VARIANTS,
} from './types'

type Supa = ReturnType<typeof getSupabase>

const EXPERIMENT_COLS =
  'id, name, surface, target_key, metric, min_per_arm, alpha, hypothesis, status, outcome, outcome_note, winning_variant, concluded_at, created_by, activated_by, activated_at, created_at'
const VARIANT_COLS = 'id, experiment_id, label, is_control, subject, body_html, body_text, screen_notes, created_by, created_at'

export interface UsableExperiment {
  experiment: ExperimentRow
  /** Variants that passed the read-time screen, sorted by label. */
  variants: VariantRow[]
  /** Variants the read-time screen DROPPED. Never silent (rule 10). */
  rejected: { id: string; label: string; reason: string }[]
}

export type ExperimentLookup =
  | { kind: 'found'; value: UsableExperiment }
  /** No active experiment for this surface/target. A real, common answer. */
  | { kind: 'absent' }
  /** The table could not be read. NOT the same fact as `absent`. */
  | { kind: 'unavailable'; error: string }

/**
 * Does this body contain a link a tracked redirect would actually wrap?
 *
 * Both conditions, because either one alone is wrong: `safeSiteLink` says it is
 * ours, and `isExcludedFromTracking` says it is not the unsubscribe link (which
 * is ours and is deliberately never wrapped). A body whose only link is the
 * opt-out has no trackable link.
 */
export function hasTrackableLink(bodyText: string): boolean {
  return extractLinks(bodyText).some(l => {
    const safe = safeSiteLink(l)
    return !!safe && !isExcludedFromTracking(safe)
  })
}

/** Shape-check a row before believing its columns (rule 13's habit). */
function asExperimentRow(raw: Record<string, unknown>): ExperimentRow | null {
  if (!isExperimentSurface(raw.surface)) return null
  if (!isExperimentMetric(raw.metric)) return null
  const minPerArm = Number(raw.min_per_arm)
  const alpha = Number(raw.alpha)
  if (!Number.isFinite(minPerArm) || minPerArm < 2) return null
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 0.2) return null
  return {
    id: String(raw.id),
    name: String(raw.name ?? ''),
    surface: raw.surface,
    target_key: raw.target_key == null ? null : String(raw.target_key),
    metric: raw.metric,
    min_per_arm: minPerArm,
    alpha,
    hypothesis: raw.hypothesis == null ? null : String(raw.hypothesis),
    status: String(raw.status ?? '') as ExperimentRow['status'],
    outcome: raw.outcome == null ? null : String(raw.outcome),
    outcome_note: raw.outcome_note == null ? null : String(raw.outcome_note),
    winning_variant: raw.winning_variant == null ? null : String(raw.winning_variant),
    concluded_at: raw.concluded_at == null ? null : String(raw.concluded_at),
    created_by: raw.created_by == null ? null : String(raw.created_by),
    activated_by: raw.activated_by == null ? null : String(raw.activated_by),
    activated_at: raw.activated_at == null ? null : String(raw.activated_at),
    created_at: String(raw.created_at ?? ''),
  }
}

/**
 * Load an experiment's variants and screen them.
 *
 * A variant that fails the screen is not silently skipped and not repaired: it
 * is dropped and named. Repairing it would mean sending copy nobody approved.
 */
export async function loadVariants(
  supabase: Supa,
  experimentId: string,
  opts: { metric?: string } = {}
): Promise<{ variants: VariantRow[]; rejected: { id: string; label: string; reason: string }[] } | { error: string }> {
  const { data, error } = await supabase
    .from('content_variants')
    .select(VARIANT_COLS)
    .eq('experiment_id', experimentId)
    .order('label', { ascending: true })
    .limit(MAX_VARIANTS + 1)

  if (error) return { error: error.message }

  const variants: VariantRow[] = []
  const rejected: { id: string; label: string; reason: string }[] = []

  for (const raw of (data ?? []) as Record<string, unknown>[]) {
    const label = String(raw.label ?? '')
    const id = String(raw.id)
    // THE READ-PATH SCREEN. §24's finding, applied where the copy is used.
    const verdict = screenVariant({ subject: raw.subject, bodyText: raw.body_text })
    if (!verdict.ok) {
      rejected.push({ id, label, reason: verdict.reason })
      continue
    }

    /**
     * The write-path half of this lives in `generate.ts` and refuses a
     * challenger that drops a link the live step carries. This is the read-path
     * half, for the same reason every screen in this file has one: a row can be
     * hand-inserted, or predate the rule.
     *
     * A NON-control arm with no trackable link on a `clicked` experiment cannot
     * score, while the control always can — its copy is the live step, with its
     * real HTML and its real anchor. That is not a weak variant, it is a rigged
     * comparison whose result would read as a finding about the words.
     *
     * The control is exempt, and deliberately: its link lives in
     * `email_sequence_steps.body_html`, which this function cannot see. The
     * variants route refuses to set up a click-metric test on a step that
     * carries no link at all, which is where that half belongs.
     */
    if (opts.metric === 'clicked' && raw.is_control !== true && !hasTrackableLink(verdict.copy.bodyText)) {
      rejected.push({
        id,
        label,
        reason:
          'it carries no Host Hampton link, so on a test measured by clicks it could never score — ' +
          'the control would win by construction',
      })
      continue
    }

    variants.push({
      id,
      experiment_id: String(raw.experiment_id),
      label,
      is_control: raw.is_control === true,
      // The screened copy, not the stored copy. Storing and using different
      // text is how a screen becomes decorative.
      subject: verdict.copy.subject,
      /**
       * **DERIVED, never read.** `screenVariant` screens `subject` and
       * `body_text`; it does not and cannot screen HTML, because the whole
       * design is that no model-written markup exists. So the stored
       * `body_html` column is a cache that nothing reads: returning it here
       * would have put a hand-inserted `<script>` (or an `onerror` image, or a
       * `javascript:` href) straight into a customer's inbox past a screen that
       * had just approved the plain text beside it.
       *
       * That is the shape link 6 found twice in one file — `buildJsonLd` read
       * the RAW `structured.faq` and `openGraph.images` read the raw
       * `featured_image` three lines from where the `<img>` refused it. Screened
       * in one reader and not the other is a screen nobody is applying (rule
       * 11). The fix is not a second screen; it is to have one source of truth.
       */
      body_html: bodyHtmlFromText(verdict.copy.bodyText),
      body_text: verdict.copy.bodyText,
      screen_notes: Array.isArray(raw.screen_notes) ? raw.screen_notes.map(String) : [],
      created_by: raw.created_by == null ? null : String(raw.created_by),
      created_at: String(raw.created_at ?? ''),
    })
  }

  return { variants, rejected }
}

/**
 * The ACTIVE experiment for a surface, if there is one.
 *
 * `.eq('status', 'active')` is issued in the query rather than filtered in code,
 * and `agentLearningsStructure.test.ts`'s trick is copied for it: the test
 * asserts the QUERY, because on a fixture with one row the output looks
 * identical either way and the whole safety property is that a `draft`
 * experiment is invisible.
 *
 * An experiment with fewer than two usable variants is `absent`, not `found`. A
 * one-armed test is not a test, and substituting a lone variant for the control
 * would be silently changing live copy with no comparison at all.
 */
export async function loadActiveExperiment(
  supabase: Supa,
  surface: ExperimentSurface,
  targetKey?: string | null
): Promise<ExperimentLookup> {
  const query = supabase
    .from('content_experiments')
    .select(EXPERIMENT_COLS)
    .eq('surface', surface)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(8)

  const { data, error } = await query
  if (error) return { kind: 'unavailable', error: error.message }

  const rows = ((data ?? []) as Record<string, unknown>[])
    .map(asExperimentRow)
    .filter((r): r is ExperimentRow => r !== null)
    // `target_key = null` means "any target". A row naming a target only
    // matches that target.
    .filter(r => r.target_key == null || (targetKey != null && r.target_key === targetKey))

  // Most specific first: an experiment naming this exact target beats a
  // catch-all, so a general test does not shadow a deliberate one.
  rows.sort((a, b) => (a.target_key == null ? 1 : 0) - (b.target_key == null ? 1 : 0))

  const experiment = rows[0]
  if (!experiment) return { kind: 'absent' }
  if (!experimentIsLive(experiment.status)) return { kind: 'absent' }

  const loaded = await loadVariants(supabase, experiment.id, { metric: experiment.metric })
  if ('error' in loaded) return { kind: 'unavailable', error: `variants unreadable: ${loaded.error}` }

  if (loaded.variants.length < 2) {
    // Reported, not swallowed. A live experiment whose arms the read screen just
    // ate is exactly the situation somebody needs to hear about.
    console.warn(
      `experiments: active experiment "${experiment.name}" has ${loaded.variants.length} usable variant(s) — not running it.` +
        (loaded.rejected.length ? ` Dropped: ${loaded.rejected.map(r => `${r.label} (${r.reason})`).join('; ')}` : '')
    )
    return { kind: 'absent' }
  }

  return { kind: 'found', value: { experiment, variants: loaded.variants, rejected: loaded.rejected } }
}

/** One experiment by id, for the admin surfaces. Three outcomes. */
export async function loadExperiment(supabase: Supa, id: string): Promise<ExperimentLookup> {
  const { data, error } = await supabase.from('content_experiments').select(EXPERIMENT_COLS).eq('id', id).maybeSingle()
  if (error) return { kind: 'unavailable', error: error.message }
  if (!data) return { kind: 'absent' }
  const experiment = asExperimentRow(data as Record<string, unknown>)
  if (!experiment) {
    return { kind: 'unavailable', error: `experiment ${id} has values this build does not understand (surface, metric, min_per_arm or alpha)` }
  }
  const loaded = await loadVariants(supabase, id, { metric: experiment.metric })
  if ('error' in loaded) return { kind: 'unavailable', error: `variants unreadable: ${loaded.error}` }
  return { kind: 'found', value: { experiment, variants: loaded.variants, rejected: loaded.rejected } }
}

/** The sequence-step target key. One spelling, used by the writer and the reader. */
export function sequenceTargetKey(sequenceId: string, stepNumber: number): string {
  return `${sequenceId}:${stepNumber}`
}
