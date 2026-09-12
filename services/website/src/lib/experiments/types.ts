/**
 * A/B content testing — the vocabulary, declared ONCE.
 *
 * Migration 045's CHECK constraints and these lists are the same lists. A
 * constant declared in two files is a constant nothing is checking (hard-won
 * rule 11), and its sharpest form — one column carrying two different kinds of
 * key — is what cost the reminder engine five months. So the CHECKs are read
 * out of the migration and re-stated here exactly, and
 * `experimentsSchema.test.ts` asserts the two agree by parsing the .sql file.
 */

/**
 * The `marketing_ledger.entity_type` these tables write under, and the
 * `EntityType` the graph knows. Declared HERE rather than in a route, because a
 * Next.js App Router route file may export only the handler names — exporting a
 * constant from one is a `next build` type error that neither `jest` nor `tsc
 * --noEmit` reports. (Found by running the build, which is the reason the build
 * is part of the checklist and not an afterthought.)
 */
export const EXPERIMENT_ENTITY = 'content_experiment'

/* ── Surfaces ─────────────────────────────────────────────────────────────── */

/**
 * A surface is a SENDER that knows how to read an experiment. A surface the
 * code does not know about is a row nothing will ever act on, so this list is
 * the allowlist and the CHECK in migration 045 is the same list.
 *
 * `sequence_step`     — `/api/cron/process-sequences`. Per-CONTACT assignment,
 *                        which is what makes the arms comparable. `target_key`
 *                        is `"<sequence_id>:<step_number>"`, or NULL for any
 *                        step of any sequence.
 * `campaign_subject`  — `scheduled_campaigns`. A subject-line test on a Brevo
 *                        campaign. NOT wired to a sender in Phase 5, and
 *                        deliberately: a Brevo send goes to 944 real people and
 *                        a campaign is never a test (PLAN.md Phase 3B). The
 *                        surface exists so the analysis can read a campaign
 *                        experiment Adam sets up by hand; nothing here sends.
 */
export const EXPERIMENT_SURFACES = ['sequence_step', 'campaign_subject'] as const
export type ExperimentSurface = (typeof EXPERIMENT_SURFACES)[number]

export function isExperimentSurface(v: unknown): v is ExperimentSurface {
  return typeof v === 'string' && (EXPERIMENT_SURFACES as readonly string[]).includes(v)
}

/** Surfaces a sender in THIS codebase actually reads. See the note above. */
export const WIRED_SURFACES: readonly ExperimentSurface[] = ['sequence_step']

/* ── Statuses ─────────────────────────────────────────────────────────────── */

export const EXPERIMENT_STATUSES = ['draft', 'active', 'paused', 'concluded', 'archived'] as const
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number]

/**
 * The status a new experiment gets, and it is the COLUMN DEFAULT — not a value
 * any writer sets. Plan §23 layer 1's reasoning, unchanged: a future writer
 * that forgets to think about this fails safe, because a `draft` experiment
 * assigns nobody.
 */
export const DEFAULT_EXPERIMENT_STATUS: ExperimentStatus = 'draft'

/** Only these statuses cause a sender to assign or substitute anything. */
export function experimentIsLive(status: string): boolean {
  return status === 'active'
}

/* ── Metrics and events ───────────────────────────────────────────────────── */

/**
 * One metric per experiment. A test that can pick its winner after the fact
 * from three metrics has no significance level at all — each extra metric you
 * are allowed to choose between multiplies the false-positive rate, which is
 * precisely how an A/B programme manufactures standing rules out of noise
 * (rule 15).
 */
export const EXPERIMENT_METRICS = ['clicked', 'converted', 'replied'] as const
export type ExperimentMetric = (typeof EXPERIMENT_METRICS)[number]

export function isExperimentMetric(v: unknown): v is ExperimentMetric {
  return typeof v === 'string' && (EXPERIMENT_METRICS as readonly string[]).includes(v)
}

/**
 * Outcome event types.
 *
 * **There is no `opened`, and that is a decision, not an omission.** Apple Mail
 * Privacy Protection pre-fetches every tracking pixel for every recipient on
 * Apple Mail, which is a large majority of a consumer audience on the East End.
 * An open rate measured that way is a number that LOOKS like evidence and is
 * not one, and this pipeline's entire output is "what we learned" — so an input
 * it cannot interpret is dropped, never guessed at. Clicks are an action a
 * person took.
 *
 * **And a bound on `clicked`, stated rather than solved.** Corporate link
 * scanners (Outlook SafeLinks, Barracuda and friends) fetch every URL in a
 * message before a human sees it, so an absolute click RATE measured this way
 * is inflated. That inflation is why the analysis only ever compares one arm
 * against another and never reports a rate as a fact about customers: random
 * assignment spreads the scanners evenly across the arms, so the DIFFERENCE
 * survives and the absolute number does not. The unique index caps each
 * assignment at one click, which bounds the damage to one per person either
 * way. Nothing here pretends to have solved it.
 *
 * `sent` and `clicked` are recorded directly, by us, at the moment they happen.
 * `converted` is ATTRIBUTED by the analysis run inside a stated window (see
 * `CONVERSION_WINDOW_DAYS`), because we do not control the moment a person
 * books and a time window is not a fact (rule 15, link 10's form).
 */
export const VARIANT_EVENT_TYPES = [
  'sent',
  'clicked',
  'replied',
  'converted',
  'unsubscribed',
  'bounced',
] as const
export type VariantEventType = (typeof VARIANT_EVENT_TYPES)[number]

export function isVariantEventType(v: unknown): v is VariantEventType {
  return typeof v === 'string' && (VARIANT_EVENT_TYPES as readonly string[]).includes(v)
}

/**
 * The attribution window for `converted`, stated here and REPEATED IN THE
 * ANALYSIS OUTPUT so the person reading a result knows what was assumed. A
 * booking made 90 days after one sequence email is not evidence about that
 * email; 14 days is the shortest window a party enquiry realistically closes in.
 */
export const CONVERSION_WINDOW_DAYS = 14

/* ── Refusal thresholds ───────────────────────────────────────────────────── */

/**
 * Defaults for the columns that decide "not enough data". They are COLUMNS on
 * `content_experiments`, not constants — the rule that refuses has to be
 * readable by whoever reads the result — and these are only what a new row gets
 * when the caller says nothing.
 */
export const DEFAULT_MIN_PER_ARM = 30
export const DEFAULT_ALPHA = 0.05

/** The most arms one experiment may carry. Two is a test; six is data dredging. */
export const MAX_VARIANTS = 4

/** Variant labels, in order. `label ~ '^[A-Z]$'` in the CHECK. */
export const VARIANT_LABELS = ['A', 'B', 'C', 'D'] as const

/* ── Copy caps ────────────────────────────────────────────────────────────── */

/**
 * Caps on model-written copy, enforced HERE and again in migration 045's
 * CHECKs. Migration 042 learned why the database needs its own: `draft_feedback`
 * had uncapped body columns and one probe row returned 2,000,000 characters to
 * a cron that selects forty.
 */
export const MAX_SUBJECT_CHARS = 150
export const MAX_BODY_CHARS = 12000
/** Absolute DB ceilings from migration 045, for the schema-agreement test. */
export const DB_MAX_SUBJECT_CHARS = 300
export const DB_MAX_BODY_CHARS = 20000

export interface ExperimentRow {
  id: string
  name: string
  surface: ExperimentSurface
  target_key: string | null
  metric: ExperimentMetric
  min_per_arm: number
  alpha: number
  hypothesis: string | null
  status: ExperimentStatus
  outcome: string | null
  outcome_note: string | null
  winning_variant: string | null
  concluded_at: string | null
  created_by: string | null
  activated_by: string | null
  activated_at: string | null
  created_at: string
}

export interface VariantRow {
  id: string
  experiment_id: string
  label: string
  is_control: boolean
  subject: string | null
  body_html: string | null
  body_text: string | null
  screen_notes: string[]
  created_by: string | null
  created_at: string
}
