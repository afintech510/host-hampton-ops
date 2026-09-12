/**
 * The assignment CLAIM, against a store that really enforces the unique index.
 *
 * The reminder engine's mock accepted every insert, so it could not see that
 * Postgres had been refusing every row for five months (rule 8's third form).
 * These tests run against `makeExperimentDb`, which models
 * `idx_variant_assignments_once` as a real unique index — so "two ticks cannot
 * assign two variants" is exercised rather than asserted.
 */

import { assignVariant, armFor, recordVariantEvent, recordUnattributed } from '@/lib/experiments/assign'
import { makeExperimentDb, uuid } from '../helpers/fakeExperimentDb'
import type { VariantRow } from '@/lib/experiments/types'

const EXP = uuid(1)
const VAR_A = uuid(2)
const VAR_B = uuid(3)
const CONTACT = uuid(4)
const CONTACT_2 = uuid(5)

function variants(): VariantRow[] {
  return [
    { id: VAR_A, experiment_id: EXP, label: 'A', is_control: true, subject: 'A', body_html: '', body_text: 'a', screen_notes: [], created_by: null, created_at: '' },
    { id: VAR_B, experiment_id: EXP, label: 'B', is_control: false, subject: 'B', body_html: '', body_text: 'b', screen_notes: [], created_by: null, created_at: '' },
  ]
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('armFor — stable, and not keyed on the contact alone', () => {
  it('is deterministic for the same pair', () => {
    const a = armFor(EXP, CONTACT, 2)
    for (let i = 0; i < 50; i++) expect(armFor(EXP, CONTACT, 2)).toBe(a)
  })

  it('is always in range', () => {
    for (let n = 1; n <= 4; n++) {
      for (let i = 0; i < 200; i++) {
        const arm = armFor(uuid(100 + n), uuid(1000 + i), n)
        expect(arm).toBeGreaterThanOrEqual(0)
        expect(arm).toBeLessThan(n)
      }
    }
  })

  it('does not put the same people in the same lettered arm across experiments', () => {
    // If the hash were keyed on contact alone, every experiment would split the
    // population identically and any systematic difference between those two
    // groups would show up in every test as if it were the copy.
    const contacts = Array.from({ length: 200 }, (_, i) => uuid(2000 + i))
    const armsInExp1 = contacts.map(c => armFor(uuid(901), c, 2))
    const armsInExp2 = contacts.map(c => armFor(uuid(902), c, 2))
    const agreements = armsInExp1.filter((a, i) => a === armsInExp2[i]).length
    expect(agreements).toBeGreaterThan(60)
    expect(agreements).toBeLessThan(140)
  })

  it('splits a population roughly evenly', () => {
    const arms = Array.from({ length: 400 }, (_, i) => armFor(EXP, uuid(5000 + i), 2))
    const a = arms.filter(x => x === 0).length
    expect(a).toBeGreaterThan(150)
    expect(a).toBeLessThan(250)
  })
})

describe('assignVariant — the claim', () => {
  it('creates an assignment and reports it as fresh', async () => {
    const db = makeExperimentDb()
    const res = await assignVariant({ supabase: db.supabase, experimentId: EXP, contactId: CONTACT, variants: variants(), actor: 'test' })
    expect(res.kind).toBe('assigned')
    if (res.kind !== 'assigned') return
    expect(res.fresh).toBe(true)
    expect(db.tables.variant_assignments).toHaveLength(1)
  })

  it('is idempotent: the second call reads back the first and says it is NOT fresh', async () => {
    const db = makeExperimentDb()
    const first = await assignVariant({ supabase: db.supabase, experimentId: EXP, contactId: CONTACT, variants: variants(), actor: 'test' })
    const second = await assignVariant({ supabase: db.supabase, experimentId: EXP, contactId: CONTACT, variants: variants(), actor: 'test' })

    expect(first.kind).toBe('assigned')
    expect(second.kind).toBe('assigned')
    if (first.kind !== 'assigned' || second.kind !== 'assigned') return
    expect(second.fresh).toBe(false)
    expect(second.id).toBe(first.id)
    expect(second.variant.id).toBe(first.variant.id)
    // ONE row. The unique index, exercised.
    expect(db.tables.variant_assignments).toHaveLength(1)
    expect(db.refusals.some(r => r.error.code === '23505')).toBe(true)
  })

  it('five concurrent ticks produce exactly one assignment and one arm', async () => {
    const db = makeExperimentDb()
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        assignVariant({ supabase: db.supabase, experimentId: EXP, contactId: CONTACT, variants: variants(), actor: 'test' })
      )
    )
    expect(db.tables.variant_assignments).toHaveLength(1)
    const assigned = results.filter(r => r.kind === 'assigned')
    expect(assigned).toHaveLength(5)
    const arms = new Set(assigned.map(r => (r.kind === 'assigned' ? r.variant.id : '')))
    expect(arms.size).toBe(1)
    // Exactly one call created the row; the other four read it back.
    expect(assigned.filter(r => r.kind === 'assigned' && r.fresh)).toHaveLength(1)
  })

  it('two different contacts can land in different arms', async () => {
    const db = makeExperimentDb()
    await assignVariant({ supabase: db.supabase, experimentId: EXP, contactId: CONTACT, variants: variants(), actor: 'test' })
    await assignVariant({ supabase: db.supabase, experimentId: EXP, contactId: CONTACT_2, variants: variants(), actor: 'test' })
    expect(db.tables.variant_assignments).toHaveLength(2)
  })

  it('the arm does not depend on the order the variants came back in', async () => {
    const db1 = makeExperimentDb()
    const db2 = makeExperimentDb()
    const forward = await assignVariant({ supabase: db1.supabase, experimentId: EXP, contactId: CONTACT, variants: variants(), actor: 't' })
    const reversed = await assignVariant({ supabase: db2.supabase, experimentId: EXP, contactId: CONTACT, variants: variants().reverse(), actor: 't' })
    expect(forward.kind).toBe('assigned')
    if (forward.kind !== 'assigned' || reversed.kind !== 'assigned') return
    expect(reversed.variant.id).toBe(forward.variant.id)
  })

  it('a write blip is `unavailable`, never a silent "no experiment"', async () => {
    const db = makeExperimentDb()
    db.failWrites('variant_assignments')
    const res = await assignVariant({ supabase: db.supabase, experimentId: EXP, contactId: CONTACT, variants: variants(), actor: 't' })
    expect(res.kind).toBe('unavailable')
    expect(db.tables.variant_assignments).toHaveLength(0)
  })

  it('a 23505 followed by an unreadable table is `unavailable`, not a guess', async () => {
    const db = makeExperimentDb()
    await assignVariant({ supabase: db.supabase, experimentId: EXP, contactId: CONTACT, variants: variants(), actor: 't' })
    db.failReads('variant_assignments')
    const res = await assignVariant({ supabase: db.supabase, experimentId: EXP, contactId: CONTACT, variants: variants(), actor: 't' })
    expect(res.kind).toBe('unavailable')
    if (res.kind === 'unavailable') expect(res.error).toMatch(/unreadable/)
  })

  it('an existing assignment naming a variant the screen dropped is `unavailable` — never re-armed', async () => {
    // Moving somebody between arms mid-experiment would attribute their outcome
    // to copy they never saw.
    const db = makeExperimentDb()
    await assignVariant({ supabase: db.supabase, experimentId: EXP, contactId: CONTACT, variants: variants(), actor: 't' })
    const onlyOneArm = [variants()[0]]
    // Force the stored arm to be the one that is now missing.
    db.tables.variant_assignments[0].variant_id = VAR_B
    const res = await assignVariant({ supabase: db.supabase, experimentId: EXP, contactId: CONTACT, variants: onlyOneArm, actor: 't' })
    expect(res.kind).toBe('unavailable')
    if (res.kind === 'unavailable') expect(res.error).toMatch(/not among the usable variants/)
  })

  it('refuses to assign when there are no variants at all', async () => {
    const db = makeExperimentDb()
    const res = await assignVariant({ supabase: db.supabase, experimentId: EXP, contactId: CONTACT, variants: [], actor: 't' })
    expect(res.kind).toBe('unavailable')
  })
})

describe('recordVariantEvent — a redelivered click is not a second click', () => {
  const ASSIGN = uuid(20)

  it('records once and reports the second as a duplicate', async () => {
    const db = makeExperimentDb()
    const first = await recordVariantEvent({ supabase: db.supabase, assignmentId: ASSIGN, eventType: 'clicked' })
    const second = await recordVariantEvent({ supabase: db.supabase, assignmentId: ASSIGN, eventType: 'clicked' })
    expect(first.kind).toBe('recorded')
    expect(second.kind).toBe('duplicate')
    expect(db.tables.variant_events).toHaveLength(1)
  })

  it('different event types on one assignment are different rows', async () => {
    const db = makeExperimentDb()
    await recordVariantEvent({ supabase: db.supabase, assignmentId: ASSIGN, eventType: 'sent' })
    await recordVariantEvent({ supabase: db.supabase, assignmentId: ASSIGN, eventType: 'clicked' })
    expect(db.tables.variant_events).toHaveLength(2)
  })

  it('the database refuses an event type the CHECK does not allow — including "opened"', async () => {
    // There is no `opened` and that is a decision, not an omission: Apple Mail
    // Privacy Protection pre-fetches every pixel, so an open count is a number
    // that looks like evidence and is not one (rule 15).
    const db = makeExperimentDb()
    const res = await recordVariantEvent({ supabase: db.supabase, assignmentId: ASSIGN, eventType: 'opened' })
    expect(res.kind).toBe('unavailable')
    expect(db.refusals.some(r => r.error.code === '23514')).toBe(true)
    expect(db.tables.variant_events).toHaveLength(0)
  })

  it('a write failure is reported, never swallowed', async () => {
    const db = makeExperimentDb()
    db.failWrites('variant_events')
    const res = await recordVariantEvent({ supabase: db.supabase, assignmentId: ASSIGN, eventType: 'sent' })
    expect(res.kind).toBe('unavailable')
  })
})

describe('recordUnattributed — rule 14, and it never throws', () => {
  it('writes a row a human can find', async () => {
    const db = makeExperimentDb()
    await recordUnattributed(db.supabase, 'tracked_click', 'assignment gone', { assignment_id: uuid(9) })
    expect(db.tables.unattributed_signals).toHaveLength(1)
    expect(db.tables.unattributed_signals[0].kind).toBe('tracked_click')
  })

  it('survives the insert failing — the error path must not be able to fail loudly', async () => {
    const db = makeExperimentDb()
    db.failWrites('unattributed_signals')
    await expect(recordUnattributed(db.supabase, 'tracked_click', 'x')).resolves.toBeUndefined()
  })
})
