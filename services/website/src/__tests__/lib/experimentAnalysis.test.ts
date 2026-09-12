/**
 * INTEL's refusal to invent a result.
 *
 * These are the tests that matter most in Phase 5, because the failure they
 * guard against does not look like a failure: a confident "variant B wins" over
 * eleven sends reads exactly like a confident "variant B wins" over eleven
 * thousand, and only one of them is a fact. Rule 15 — fabricated signal is worse
 * than none, because it becomes a standing rule.
 */

import {
  analyseExperiment,
  twoProportionPValue,
  normalCdf,
  outcomeLabel,
  summarise,
  attributeConversions,
} from '@/lib/experiments/analysis'
import { CONVERSION_WINDOW_DAYS } from '@/lib/experiments/types'
import { makeExperimentDb, uuid } from '../helpers/fakeExperimentDb'
import type { UsableExperiment } from '@/lib/experiments/load'
import type { ExperimentRow, VariantRow } from '@/lib/experiments/types'

const EXP = uuid(1)
const A = uuid(2)
const B = uuid(3)

function experiment(over: Partial<ExperimentRow> = {}): ExperimentRow {
  return {
    id: EXP,
    name: 'subject line test',
    surface: 'sequence_step',
    target_key: null,
    metric: 'clicked',
    min_per_arm: 30,
    alpha: 0.05,
    hypothesis: null,
    status: 'active',
    outcome: null,
    outcome_note: null,
    winning_variant: null,
    concluded_at: null,
    created_by: null,
    activated_by: null,
    activated_at: null,
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  }
}

function variant(id: string, label: string, isControl: boolean): VariantRow {
  return {
    id,
    experiment_id: EXP,
    label,
    is_control: isControl,
    subject: label,
    body_html: '',
    body_text: 'body',
    screen_notes: [],
    created_by: null,
    created_at: '',
  }
}

function loaded(over: Partial<ExperimentRow> = {}, variants?: VariantRow[]): UsableExperiment {
  return {
    experiment: experiment(over),
    variants: variants ?? [variant(A, 'A', true), variant(B, 'B', false)],
    rejected: [],
  }
}

/** Seed n assignments on an arm, with `sent` events and `hits` metric events. */
function seedArm(variantId: string, n: number, hits: number, startIndex: number) {
  const assignments: Record<string, any>[] = []
  const events: Record<string, any>[] = []
  for (let i = 0; i < n; i++) {
    const aid = uuid(startIndex + i)
    assignments.push({
      id: aid,
      experiment_id: EXP,
      variant_id: variantId,
      contact_id: uuid(900000 + startIndex + i),
      assigned_at: '2026-09-01T00:00:00.000Z',
    })
    events.push({ id: uuid(500000 + startIndex + i), assignment_id: aid, event_type: 'sent' })
    if (i < hits) {
      events.push({ id: uuid(600000 + startIndex + i), assignment_id: aid, event_type: 'clicked' })
    }
  }
  return { assignments, events }
}

function dbWith(armA: { n: number; hits: number }, armB: { n: number; hits: number }, extra: Record<string, any[]> = {}) {
  const a = seedArm(A, armA.n, armA.hits, 1000)
  const b = seedArm(B, armB.n, armB.hits, 4000)
  return makeExperimentDb({
    variant_assignments: [...a.assignments, ...b.assignments],
    variant_events: [...a.events, ...b.events],
    ...extra,
  })
}

/* ── the statistics ──────────────────────────────────────────────────────── */

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('the test statistic', () => {
  it('normalCdf matches the textbook values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6)
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3)
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3)
    expect(normalCdf(2.576)).toBeCloseTo(0.995, 3)
  })

  it('a textbook two-proportion comparison gets the textbook p-value', () => {
    // 60/100 vs 40/100 — z = 2.83, two-sided p ≈ 0.0047.
    const p = twoProportionPValue(60, 100, 40, 100) as number
    expect(p).toBeGreaterThan(0.004)
    expect(p).toBeLessThan(0.006)
  })

  it('identical rates give p ≈ 1', () => {
    expect(twoProportionPValue(50, 100, 50, 100) as number).toBeCloseTo(1, 6)
  })

  it('returns NULL rather than a number when the pooled variance is zero', () => {
    // Both arms all-hits or all-misses. This is NOT a tie and NOT a win, and
    // reporting p = 1 or p = 0 would be the module inventing a result.
    expect(twoProportionPValue(0, 40, 0, 40)).toBeNull()
    expect(twoProportionPValue(40, 40, 40, 40)).toBeNull()
    expect(twoProportionPValue(1, 0, 1, 10)).toBeNull()
  })
})

/* ── the five outcomes ───────────────────────────────────────────────────── */

describe('analyseExperiment — it refuses before it guesses', () => {
  it('NOT ENOUGH DATA, naming the arm and both numbers', async () => {
    const db = dbWith({ n: 10, hits: 1 }, { n: 10, hits: 6 })
    const r = await analyseExperiment(db.supabase, loaded())
    expect(r.kind).toBe('not_enough_data')
    if (r.kind !== 'not_enough_data') return
    // A 10% vs 60% difference. A naive implementation calls this a landslide.
    expect(r.note).toContain('arm A has 10 send(s) of the 30 needed')
    expect(r.note).toContain('arm B has 10 send(s) of the 30 needed')
    expect(outcomeLabel(r)).toBe('not_enough_data')
  })

  it('refuses when only ONE arm is short — a full arm does not rescue an empty one', async () => {
    const db = dbWith({ n: 40, hits: 4 }, { n: 5, hits: 4 })
    const r = await analyseExperiment(db.supabase, loaded())
    expect(r.kind).toBe('not_enough_data')
    if (r.kind === 'not_enough_data') {
      expect(r.note).toContain('arm B has 5 send(s)')
      expect(r.note).not.toContain('arm A has')
    }
  })

  it('NO DIFFERENCE when there is enough data and no significant gap', async () => {
    const db = dbWith({ n: 200, hits: 40 }, { n: 200, hits: 44 })
    const r = await analyseExperiment(db.supabase, loaded())
    expect(r.kind).toBe('no_difference')
    if (r.kind === 'no_difference') {
      expect(r.pValue).toBeGreaterThan(0.05)
      expect(r.note).toMatch(/Enough data, no winner/)
    }
  })

  it('WINNER only when the gap clears alpha, and it says nothing was changed', async () => {
    const db = dbWith({ n: 400, hits: 40 }, { n: 400, hits: 90 })
    const r = await analyseExperiment(db.supabase, loaded())
    expect(r.kind).toBe('winner')
    if (r.kind !== 'winner') return
    expect(r.winner.label).toBe('B')
    expect(r.pValue).toBeLessThan(0.05)
    expect(r.note).toContain('This is a PROPOSAL: nothing has been changed.')
  })

  it('a challenger that is significantly WORSE is not a winner', async () => {
    const db = dbWith({ n: 400, hits: 90 }, { n: 400, hits: 40 })
    const r = await analyseExperiment(db.supabase, loaded())
    expect(r.kind).toBe('no_difference')
  })

  it('enough data but a zero pooled variance is not-enough-data, not a tie', async () => {
    const db = dbWith({ n: 40, hits: 0 }, { n: 40, hits: 0 })
    const r = await analyseExperiment(db.supabase, loaded())
    expect(r.kind).toBe('not_enough_data')
    if (r.kind === 'not_enough_data') expect(r.note).toMatch(/pooled variance is zero/)
  })

  it('UNCONFIGURED when there is no control — distinguishable from learning nothing', async () => {
    const db = dbWith({ n: 400, hits: 40 }, { n: 400, hits: 90 })
    const r = await analyseExperiment(db.supabase, loaded({}, [variant(A, 'A', false), variant(B, 'B', false)]))
    expect(r.kind).toBe('unconfigured')
    expect(outcomeLabel(r)).toBeNull()
    expect(summarise(r)).toMatch(/no control variant/)
  })

  it('UNCONFIGURED with one arm, and it names what the read screen dropped', async () => {
    const db = makeExperimentDb()
    const r = await analyseExperiment(db.supabase, {
      experiment: experiment(),
      variants: [variant(A, 'A', true)],
      rejected: [{ id: B, label: 'B', reason: 'it states dollar amount $500' }],
    })
    expect(r.kind).toBe('unconfigured')
    expect(summarise(r)).toContain('B — it states dollar amount $500')
  })

  it('UNAVAILABLE when a read fails — a variant is never reported as losing over a blip', async () => {
    const db = dbWith({ n: 400, hits: 40 }, { n: 400, hits: 90 })
    db.failReads('variant_assignments')
    const r = await analyseExperiment(db.supabase, loaded())
    expect(r.kind).toBe('unavailable')
    expect(outcomeLabel(r)).toBe('unavailable')
  })

  it('UNAVAILABLE when the EVENTS read fails — not "nobody clicked"', async () => {
    const db = dbWith({ n: 400, hits: 40 }, { n: 400, hits: 90 })
    db.failReads('variant_events')
    const r = await analyseExperiment(db.supabase, loaded())
    expect(r.kind).toBe('unavailable')
  })
})

describe('the denominator is `sent`, not `assigned`', () => {
  it('an assignment with no send does not dilute the arm', async () => {
    const db = dbWith({ n: 40, hits: 10 }, { n: 40, hits: 10 })
    // Add 100 assignments to arm B that were never sent (paused enrollments).
    for (let i = 0; i < 100; i++) {
      db.tables.variant_assignments.push({
        id: uuid(70000 + i),
        experiment_id: EXP,
        variant_id: B,
        contact_id: uuid(80000 + i),
        assigned_at: '2026-09-01T00:00:00.000Z',
      })
    }
    const r = await analyseExperiment(db.supabase, loaded())
    expect(r.kind).toBe('no_difference')
    if (r.kind === 'no_difference') {
      const armB = r.arms.find(a => a.label === 'B')!
      expect(armB.sent).toBe(40)
      expect(armB.rate).toBeCloseTo(0.25, 6)
    }
  })

  it('an arm with zero sends has a NULL rate, never 0%', async () => {
    const db = dbWith({ n: 0, hits: 0 }, { n: 0, hits: 0 })
    const r = await analyseExperiment(db.supabase, loaded())
    expect(r.kind).toBe('not_enough_data')
    if (r.kind === 'not_enough_data') {
      expect(r.arms.every(a => a.rate === null)).toBe(true)
    }
  })
})

describe('rule 14 — an event that cannot be attributed is counted separately', () => {
  it('an event for an assignment that is not in this experiment is `unattributed`', async () => {
    const db = dbWith({ n: 40, hits: 10 }, { n: 40, hits: 10 })
    // An assignment naming a variant this experiment no longer has.
    const orphanAssignment = uuid(77777)
    db.tables.variant_assignments.push({
      id: orphanAssignment,
      experiment_id: EXP,
      variant_id: uuid(99999),
      contact_id: uuid(88888),
      assigned_at: '2026-09-01T00:00:00.000Z',
    })
    db.tables.variant_events.push({ id: uuid(77778), assignment_id: orphanAssignment, event_type: 'clicked' })

    const r = await analyseExperiment(db.supabase, loaded())
    expect('unattributed' in r ? r.unattributed : -1).toBe(1)
    // And it was NOT counted against either arm.
    if ('arms' in r) expect(r.arms.reduce((s, a) => s + a.metricCount, 0)).toBe(20)
  })
})

describe('multiple challengers get a Bonferroni correction', () => {
  /**
   * 59/400 against 40/400 is p ≈ 0.041 — significant at α = 0.05 and NOT at
   * α = 0.025. That is the whole point of the correction, so the pair of tests
   * below runs the SAME numbers through a two-arm and a three-arm experiment
   * and gets two different answers. A correction that is present but never
   * changes a verdict is one nobody would notice removing.
   */
  const CONTROL_HITS = 40
  const CHALLENGER_HITS = 59
  const ARM_N = 400

  it('the same numbers ARE a winner with a single challenger', async () => {
    const db = dbWith({ n: ARM_N, hits: CONTROL_HITS }, { n: ARM_N, hits: CHALLENGER_HITS })
    const r = await analyseExperiment(db.supabase, loaded())
    expect(r.kind).toBe('winner')
    if (r.kind === 'winner') {
      expect(r.alpha).toBeCloseTo(0.05, 6)
      expect(r.pValue).toBeGreaterThan(0.025)
      expect(r.pValue).toBeLessThan(0.05)
    }
  })

  it('and are NOT a winner once there are three arms', async () => {
    const C = uuid(9)
    const a = seedArm(A, ARM_N, CONTROL_HITS, 1000)
    const b = seedArm(B, ARM_N, CHALLENGER_HITS, 4000)
    const c = seedArm(C, ARM_N, 42, 8000)
    const db = makeExperimentDb({
      variant_assignments: [...a.assignments, ...b.assignments, ...c.assignments],
      variant_events: [...a.events, ...b.events, ...c.events],
    })
    const three = [variant(A, 'A', true), variant(B, 'B', false), variant(C, 'C', false)]
    const r = await analyseExperiment(db.supabase, loaded({}, three))
    expect(r.kind).toBe('no_difference')
    if (r.kind === 'no_difference') {
      expect(r.alpha).toBeCloseTo(0.025, 6)
      expect(r.note).toContain('Bonferroni over 2 challenger(s)')
    }
  })
})

/* ── conversion attribution ──────────────────────────────────────────────── */

describe('conversion attribution — a window, stated as a window', () => {
  const CONTACT = uuid(4001)
  const ASSIGNED_AT = '2026-09-01T00:00:00.000Z'
  const assignments = [{ id: uuid(4000), variant_id: A, contact_id: CONTACT, assigned_at: ASSIGNED_AT }]

  function booking(daysAfter: number, status = 'lead') {
    const t = new Date(Date.parse(ASSIGNED_AT) + daysAfter * 24 * 60 * 60 * 1000).toISOString()
    return { id: uuid(4100 + Math.round(daysAfter)), contact_id: CONTACT, created_at: t, status }
  }

  it('counts a booking inside the window', async () => {
    const db = makeExperimentDb({ bookings: [booking(3)] })
    const r = await attributeConversions(db.supabase, assignments)
    expect(r).toEqual({ recorded: 1, duplicates: 0 })
    expect(db.tables.variant_events).toHaveLength(1)
  })

  it('ignores one BEFORE the assignment — the population has already enquired', async () => {
    const db = makeExperimentDb({ bookings: [booking(-5)] })
    expect(await attributeConversions(db.supabase, assignments)).toEqual({ recorded: 0, duplicates: 0 })
  })

  it('ignores one past the window', async () => {
    const db = makeExperimentDb({ bookings: [booking(CONVERSION_WINDOW_DAYS + 1)] })
    expect(await attributeConversions(db.supabase, assignments)).toEqual({ recorded: 0, duplicates: 0 })
  })

  it('ignores a cancelled booking', async () => {
    const db = makeExperimentDb({ bookings: [booking(3, 'cancelled')] })
    expect(await attributeConversions(db.supabase, assignments)).toEqual({ recorded: 0, duplicates: 0 })
  })

  it('is idempotent — a second run does not double-count', async () => {
    const db = makeExperimentDb({ bookings: [booking(3)] })
    await attributeConversions(db.supabase, assignments)
    expect(await attributeConversions(db.supabase, assignments)).toEqual({ recorded: 0, duplicates: 1 })
    expect(db.tables.variant_events).toHaveLength(1)
  })

  it('an unparseable assigned_at is DROPPED and reported, never defaulted to now', async () => {
    // Defaulting to `now` would make every booking count. A time window is not
    // a fact and a missing one is not "today" (rule 15, link 10's form).
    const db = makeExperimentDb({ bookings: [booking(3)] })
    const r = await attributeConversions(db.supabase, [{ ...assignments[0], assigned_at: 'not a date' }])
    expect(r).toEqual({ recorded: 0, duplicates: 0 })
    expect(db.tables.unattributed_signals).toHaveLength(1)
  })

  it('a failed bookings read is an ERROR, not zero conversions', async () => {
    const db = makeExperimentDb({ bookings: [booking(3)] })
    db.failReads('bookings')
    const r = await attributeConversions(db.supabase, assignments)
    expect('error' in r).toBe(true)
  })

  it('the analysis says which window it assumed, every time', async () => {
    const db = dbWith({ n: 5, hits: 1 }, { n: 5, hits: 1 })
    const r = await analyseExperiment(db.supabase, loaded({ metric: 'converted' }))
    expect(summarise(r)).toContain(`within ${CONVERSION_WINDOW_DAYS} days`)
    expect(summarise(r)).toContain('an assumption, not a measurement')
  })

  it('opening the panel (attribute:false) writes nothing', async () => {
    const db = makeExperimentDb({
      bookings: [booking(3)],
      variant_assignments: [{ ...assignments[0], experiment_id: EXP }],
    })
    await analyseExperiment(db.supabase, loaded({ metric: 'converted' }), { attribute: false })
    expect(db.tables.variant_events).toHaveLength(0)
  })
})
