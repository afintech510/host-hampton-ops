/**
 * The tripwire: `lib/experiments/types.ts` and migration 045 must agree.
 *
 * Hard-won rule 11, and its sharpest form — a CONCEPT defined twice is a
 * concept nothing is checking. The surfaces, statuses, metrics, event types and
 * character caps exist in two places by necessity (one is a CHECK constraint in
 * Postgres, one is a TypeScript union), so this reads the .sql off disk and
 * asserts they say the same thing.
 *
 * It also pins the two decisions that are easiest to undo by accident:
 * `status` DEFAULTing to 'draft', and there being no `opened` event type.
 */

import fs from 'fs'
import path from 'path'
import {
  EXPERIMENT_SURFACES,
  EXPERIMENT_STATUSES,
  EXPERIMENT_METRICS,
  VARIANT_EVENT_TYPES,
  DEFAULT_MIN_PER_ARM,
  DEFAULT_ALPHA,
  DB_MAX_SUBJECT_CHARS,
  DB_MAX_BODY_CHARS,
  MAX_SUBJECT_CHARS,
  MAX_BODY_CHARS,
  DEFAULT_EXPERIMENT_STATUS,
} from '@/lib/experiments/types'

const SQL = fs.readFileSync(
  path.join(process.cwd(), '..', '..', 'starting_plan', 'migration_045_content_experiments.sql'),
  'utf8'
)

/** The literals inside `CHECK (<col> IN ('a', 'b'))`, in order. */
function checkList(column: string): string[] {
  const re = new RegExp(`${column}\\s+(?:text\\s+)?(?:NOT NULL\\s+)?(?:DEFAULT\\s+'[^']*'\\s+)?\\n?\\s*CHECK \\(${column} IN \\(([^)]*)\\)\\)`, 'm')
  const m = SQL.match(re)
  if (!m) throw new Error(`no CHECK found for column "${column}" in migration 045`)
  return Array.from(m[1].matchAll(/'([^']+)'/g)).map(x => x[1])
}

describe('migration 045 and lib/experiments/types.ts say the same thing', () => {
  it('the migration file is the one we think it is', () => {
    expect(SQL).toContain('CREATE TABLE IF NOT EXISTS content_experiments')
    expect(SQL).toContain('CREATE TABLE IF NOT EXISTS variant_assignments')
  })

  it('surfaces agree', () => {
    expect(checkList('surface').sort()).toEqual([...EXPERIMENT_SURFACES].sort())
  })

  it('statuses agree', () => {
    expect(checkList('status').sort()).toEqual([...EXPERIMENT_STATUSES].sort())
  })

  it('metrics agree', () => {
    expect(checkList('metric').sort()).toEqual([...EXPERIMENT_METRICS].sort())
  })

  it('event types agree', () => {
    expect(checkList('event_type').sort()).toEqual([...VARIANT_EVENT_TYPES].sort())
  })
})

describe('the decisions that are easiest to undo by accident', () => {
  it('status DEFAULTS to draft in the DATABASE, not in a writer', () => {
    // The safety property. A writer that forgets to set a status must fail safe,
    // which only holds if the column default is the safe value.
    expect(SQL).toMatch(/status\s+text NOT NULL DEFAULT 'draft'/)
    expect(DEFAULT_EXPERIMENT_STATUS).toBe('draft')
  })

  it('there is NO `opened` event type, here or in the migration', () => {
    // Apple Mail Privacy Protection pre-fetches every tracking pixel, so an
    // open count is a number that looks like evidence and is not one. If this
    // test ever fails, somebody added open tracking — read
    // lib/experiments/types.ts before deciding that was right.
    expect(VARIANT_EVENT_TYPES).not.toContain('opened')
    expect(checkList('event_type')).not.toContain('opened')
  })

  it('the unique indexes that make an assignment a claim really exist in the SQL', () => {
    expect(SQL).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_variant_assignments_once\s*\n?\s*ON variant_assignments \(experiment_id, contact_id\)/)
    expect(SQL).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_variant_events_once\s*\n?\s*ON variant_events \(assignment_id, event_type\)/)
    expect(SQL).toContain('idx_content_variants_one_control')
  })

  it('min_per_arm cannot be set below 2, in the database', () => {
    expect(SQL).toMatch(/min_per_arm\s+integer NOT NULL DEFAULT 30 CHECK \(min_per_arm >= 2\)/)
    expect(DEFAULT_MIN_PER_ARM).toBe(30)
  })

  it('alpha is bounded in the database as well as in the route', () => {
    expect(SQL).toMatch(/CHECK \(alpha > 0 AND alpha <= 0\.2\)/)
    expect(DEFAULT_ALPHA).toBe(0.05)
  })

  it('the app caps are tighter than the database caps, so the DB is a backstop', () => {
    // Migration 042's lesson: `draft_feedback`'s uncapped body columns returned
    // 2,000,000 characters from one probe row to a cron that selects forty. The
    // application cap is the intent; the column cap is what holds when a writer
    // does not run.
    expect(MAX_SUBJECT_CHARS).toBeLessThanOrEqual(DB_MAX_SUBJECT_CHARS)
    expect(MAX_BODY_CHARS).toBeLessThanOrEqual(DB_MAX_BODY_CHARS)
    expect(SQL).toContain(`length(subject) <= ${DB_MAX_SUBJECT_CHARS}`)
    expect(SQL).toContain(`length(body_text) <= ${DB_MAX_BODY_CHARS}`)
  })

  it('agent_memory is retired by a COMMENT, never by an UPDATE', () => {
    // `agent_memory` carries an unconditional `handle_updated_at` trigger, so a
    // 44-row note UPDATE would stamp today's date on `updated_at` — the one
    // column that proves 43 of those rows have not been touched since February.
    // A migration that makes dead rows look freshly maintained destroys the
    // measurement that justifies calling them dead.
    expect(SQL).toContain('COMMENT ON TABLE agent_memory')
    expect(SQL).not.toMatch(/UPDATE agent_memory/)
  })
})

describe('the marketing graph knows about the experiment entity', () => {
  it('`active` is a GATED edge and nothing else is', () => {
    // Read off the module rather than remembered, because this is the human
    // gate: activating is the moment model-written copy starts reaching
    // customers. Asserted through the public predicates, so a refactor of the
    // private Set cannot quietly widen it.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { isGatedTransition, isLegalTransition } = require('@/lib/marketing/graph')
    expect(isGatedTransition('content_experiment', 'active')).toBe(true)
    for (const s of ['paused', 'concluded', 'archived', 'draft']) {
      expect(isGatedTransition('content_experiment', s)).toBe(false)
    }
    expect(isLegalTransition('content_experiment', 'draft', 'active')).toBe(true)
    // There is no way back from `concluded` except to archive.
    expect(isLegalTransition('content_experiment', 'concluded', 'active')).toBe(false)
  })
})
