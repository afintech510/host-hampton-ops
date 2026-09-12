/**
 * `agent_memory` — the measurement, and the ONE door into the live loop.
 *
 * ── What was measured, 2026-09-12, before any of this was written ───────────
 *
 * `agent_memory` holds **44 rows**. 43 were written between 2026-02-18 and
 * 2026-02-21 by `scripts/seed_agent_memory.js` and have not been touched since.
 * The 44th, `analytics.last_report`, was overwritten by INTEL 78 times — daily —
 * and **stopped on 2026-04-22**.
 *
 * `services/website` references the table **zero times**. Every reader and
 * writer is in `services/hampton`, `copy`, `intel`, `image`, `list`, `outbound`
 * and `soc` — and `/opt/hosthampton/docker-compose.yml` defines only `nginx`
 * and `website`. There is no orchestrator container on the box,
 * `app.hosthampton.com` answers **520**, and the only `elm_*` agent containers
 * running belong to Eastern Landscape (the branch-per-business model in
 * PLAN.md's "Future" section), not to Host Hampton.
 *
 * So Phase 5's "memory update pipeline: agents write back learnings post-task"
 * cannot mean those agents. They are gone.
 *
 * ── Why this is not a third memory mechanism ────────────────────────────────
 *
 * Phase 6 built the live loop: `draft_feedback` → the distiller →
 * `agent_learnings` → the draft prompt, with `voice_profile` beside it. That
 * loop is screened on the way in, screened again on the way out, and terminates
 * at a human because `is_active` defaults FALSE.
 *
 * Building a second store here would be hard-won rule 11 in its sharpest form —
 * **a concept defined twice is a concept nothing is checking** — and the concept
 * in question is "what the agent has learned", which is the one whose
 * divergence nobody would notice until a draft said something wrong.
 *
 * ── And why the table is not simply dropped ────────────────────────────────
 *
 * Two reasons. The 44 rows are hand-curated brand knowledge — operating
 * policies, target areas, positioning, party themes — that the booking agent
 * does NOT know today, and `agent_memory_history` is 89 rows of their
 * provenance. Both are worth keeping.
 *
 * But they are not safe to wire in. Plan §24's headline defect was a
 * hand-written store that had never been screened feeding mobile prices into a
 * prompt that says "ABSOLUTELY NO PRICING"; `HH-2026-4295` is the parked draft
 * that cost. These rows hold February prices, a `services.packages` tier list
 * and HoneyBook booking links — the same defect at 44× the size. `screenMemory`
 * below exists so that claim is a MEASUREMENT rather than an assertion: it runs
 * the real screen over every row and says which ones it refuses and why.
 *
 * ── The door ────────────────────────────────────────────────────────────────
 *
 * `promoteMemory` takes a rule a HUMAN wrote, having read the row, and puts it
 * through the existing `proposeLearning` — so it arrives INACTIVE, screened on
 * the way in, and is screened again on read by `loadActiveLearnings`. The chain
 * terminates at a human in exactly the place §23's does.
 *
 * It deliberately does NOT derive the rule text from `value`. The values are
 * arbitrary jsonb of eleven different shapes; turning one into a one-line rule
 * automatically would be the pipeline guessing at an input it cannot interpret,
 * which is the one thing rule 15 forbids in a module whose output becomes a
 * standing instruction.
 */

import type { getSupabase } from '@/lib/supabase'
import { containsFabricatedTerms, containsForeignContact, containsMoney, NO_AMOUNTS_ALLOWED } from './draftGuards'
import { stripUnescapedControls } from './extractPlanFields'
import { proposeLearning, screenLearningText, isLearningKind, type LearningKind } from './learnings'

type Supa = ReturnType<typeof getSupabase>

export interface MemoryRow {
  id: string
  namespace: string
  key: string
  description: string | null
  version: number
  updated_by: string | null
  created_at: string
  updated_at: string
  /** The jsonb value, rendered for a human to read. Bounded. */
  valuePreview: string
  valueChars: number
  promoted_learning_id: string | null
}

export interface ScreenedMemoryRow extends MemoryRow {
  /**
   * What the live screens say about this row's CONTENT, as a warning to the
   * person reading it — not a gate, because nothing reads this table into a
   * prompt. Empty means the row carries no figure, no foreign link and no
   * structure that would forge a prompt header.
   */
  warnings: string[]
}

/** How much of a value a panel shows. 44 rows × 3,210 characters is a page nobody reads. */
export const MEMORY_PREVIEW_CHARS = 1200

export type MemoryListing =
  | { kind: 'found'; rows: ScreenedMemoryRow[] }
  /** The table is gone (it predates every migration in this repo's `starting_plan`). */
  | { kind: 'absent' }
  | { kind: 'unavailable'; error: string }

/**
 * What the screens say about one memory value.
 *
 * **These warnings are a HELP, not a gate, and "no warnings" is not "safe".** A
 * detector finds what it was written to find; a row can be clean by these rules
 * and still be eight months out of date about an operating policy. Nothing here
 * decides anything — the gate is that a HUMAN writes the rule text, that
 * `screenLearningText` runs on that text, and that the rule lands inactive.
 *
 * Runs the SAME detectors a learned rule is screened with — imported, never
 * restated (rule 11) — with `NO_AMOUNTS_ALLOWED`, because a rule that reaches
 * the draft prompt may not name a figure at all. A row whose value mentions
 * "$850" is exactly the shape that cost `HH-2026-4295`.
 */
export function screenMemory(value: unknown, description?: string | null): string[] {
  const warnings: string[] = []
  const text = stripUnescapedControls(
    typeof value === 'string' ? value : JSON.stringify(value ?? null)
  )
  const withDescription = `${text}\n${description ?? ''}`

  const money = containsFabricatedTerms(withDescription, { allowedAmounts: NO_AMOUNTS_ALLOWED })
  if (money) warnings.push(`states ${money}`)

  /**
   * And the WIDER money detector as well, which is the one that matters here.
   *
   * The first version of this function used `containsFabricatedTerms` alone.
   * Run over the real 44 rows in production it flagged 13 — and called
   * `services.addons` and `services.rentals` CLEAN, because those store prices
   * as bare JSON numbers:
   *
   *     {"decor": {"barbie_box": 100, "balloon_garland_6ft": 150, …}}
   *     {"weekday_3hr": {"price": 450, "description": "3hr Weekday Party Room Rental"}}
   *
   * `containsFabricatedTerms` is deliberately narrow — it looks for an explicit
   * `$` and for named concessions — because on a QUOTE-path draft it must not
   * park every reply that mentions the deposit. Here the trade is the opposite
   * way round: this is an ADVISORY shown to a human reading a dead table, so a
   * false positive costs a glance and a miss costs a stale February price
   * pasted into a standing rule. `containsMoney` catches the bare figure.
   *
   * Worth knowing: that `"price": 450` is **stale**. The live weekday studio
   * rate is $475 (docs/content-pipeline.md §11 corrected the Spanish page from
   * exactly this number). A row that is wrong AND invisible to the screen is
   * the whole argument for why nothing reads this table into a prompt.
   */
  if (!money && containsMoney(withDescription)) {
    warnings.push('carries a figure that reads as a price (a bare number, not a "$" amount)')
  }

  const foreign = containsForeignContact(withDescription)
  if (foreign) warnings.push(`contains a ${foreign} that is not ours`)

  // The prompt-structure screen, applied to the value rather than to a rule. A
  // row carrying an ALL-CAPS heading is one somebody might paste verbatim.
  const structural = screenLearningText(text.slice(0, 400))
  if (structural && /header|tag|code fence|ignore earlier|redefine|replace the instructions/.test(structural)) {
    warnings.push(structural.replace(/^it /, ''))
  }

  return warnings
}

/**
 * Every `agent_memory` row, with a screen verdict. Three outcomes (rule 12).
 *
 * Reads `value` in full so the screen sees the whole thing, and only the
 * PREVIEW is truncated — screening a truncated value would be a screen that
 * gets weaker the longer the payload is.
 */
export async function listMemory(supabase: Supa): Promise<MemoryListing> {
  const { data, error } = await supabase
    .from('agent_memory')
    .select('id, namespace, key, value, description, version, updated_by, created_at, updated_at, promoted_learning_id')
    .order('namespace', { ascending: true })
    .order('key', { ascending: true })
    .limit(200)

  if (error) {
    // 42P01 — the table does not exist. A deployment without the orchestrator
    // schema is a legitimate state and must not read as a failure.
    if ((error as { code?: string }).code === '42P01') return { kind: 'absent' }
    return { kind: 'unavailable', error: error.message }
  }

  const rows: ScreenedMemoryRow[] = ((data ?? []) as Record<string, unknown>[]).map(raw => {
    const serialised = typeof raw.value === 'string' ? raw.value : JSON.stringify(raw.value ?? null)
    const cleaned = stripUnescapedControls(serialised)
    return {
      id: String(raw.id),
      namespace: String(raw.namespace ?? ''),
      key: String(raw.key ?? ''),
      description: raw.description == null ? null : String(raw.description),
      version: Number(raw.version ?? 1),
      updated_by: raw.updated_by == null ? null : String(raw.updated_by),
      created_at: String(raw.created_at ?? ''),
      updated_at: String(raw.updated_at ?? ''),
      valuePreview: Array.from(cleaned).slice(0, MEMORY_PREVIEW_CHARS).join(''),
      valueChars: Array.from(cleaned).length,
      promoted_learning_id: raw.promoted_learning_id == null ? null : String(raw.promoted_learning_id),
      warnings: screenMemory(raw.value, raw.description == null ? null : String(raw.description)),
    }
  })

  return { kind: 'found', rows }
}

export type PromoteResult =
  | { ok: true; learningId: string; duplicate: false }
  | { ok: true; learningId: null; duplicate: true }
  | { ok: false; status: number; error: string }

/**
 * Promote a memory row into the live loop as an INACTIVE learning.
 *
 * `text` is the rule a human wrote after reading the row. The row is the source
 * attribution, not the source of the words — see the note at the top of the
 * file on why this does not derive the text.
 *
 * Promoting is NOT activating. The learning lands `is_active = false` because
 * `proposeLearning` never sets the column and the column defaults false; turning
 * it on is a separate, admin-only `setLearningActive` call which re-screens.
 */
export async function promoteMemory(args: {
  supabase: Supa
  memoryId: string
  kind: string
  text: string
  actor: string
}): Promise<PromoteResult> {
  const { supabase, memoryId, actor } = args

  if (!isLearningKind(args.kind)) {
    return { ok: false, status: 422, error: `kind must be one of style, rule, fact, pricing` }
  }

  // Three outcomes on the lookup (rule 12). "Could not read" must not be
  // reported as "no such memory row", which would send somebody looking for a
  // row that is sitting right there.
  const { data: row, error: readErr } = await supabase
    .from('agent_memory')
    .select('id, namespace, key, promoted_learning_id')
    .eq('id', memoryId)
    .maybeSingle()

  if (readErr) return { ok: false, status: 503, error: `Could not read the memory row: ${readErr.message}` }
  if (!row) return { ok: false, status: 404, error: 'No such agent_memory row' }

  const proposed = await proposeLearning({
    supabase,
    kind: args.kind as LearningKind,
    text: args.text,
    createdBy: actor,
    // The provenance. `source_draft_id`/`source_event_id` are uuid columns for
    // a different lineage, so this goes where it belongs: in the text's own
    // audit trail via `created_by`, and in `agent_memory.promoted_learning_id`
    // below, which is the FK that makes the link readable from either side.
  })

  if (!proposed.ok) {
    return { ok: false, status: proposed.refused ? 422 : 500, error: proposed.error }
  }

  if (proposed.duplicate) {
    // The unique index on normalised text. A human has already judged this
    // sentence — including by retiring it — which is a success for the caller.
    return { ok: true, learningId: null, duplicate: true }
  }

  // Record the link back. A failure here is reported and does NOT undo the
  // learning: the learning is inert either way, and losing the back-reference
  // is a smaller problem than a half-applied promote nobody can see.
  const { error: linkErr } = await supabase
    .from('agent_memory')
    .update({ promoted_learning_id: proposed.id })
    .eq('id', memoryId)
  if (linkErr) {
    console.error(
      `memoryImport: learning ${proposed.id} was created from agent_memory ${memoryId} but the back-reference could not be written: ${linkErr.message}`
    )
  }

  return { ok: true, learningId: proposed.id, duplicate: false }
}
