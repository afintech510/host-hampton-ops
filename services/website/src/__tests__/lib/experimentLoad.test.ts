/**
 * The READ path — §24's lesson, applied where the copy is used.
 *
 * `sanitizeVoiceProfile` was correct and ran only on the write path, so the
 * profile that was actually live had never been screened and had been feeding
 * mobile prices into a prompt that forbids them for months. These tests insert
 * rows STRAIGHT INTO THE STORE, bypassing every write guard, and assert the read
 * path refuses them — because a row being in Postgres is not evidence it ever
 * passed a screen (rule 8).
 */

import { loadVariants, loadActiveExperiment, loadExperiment, sequenceTargetKey, hasTrackableLink } from '@/lib/experiments/load'
import { makeExperimentDb, uuid } from '../helpers/fakeExperimentDb'

const EXP = uuid(1)
const SEQ = uuid(50)

/** No link — used on purpose by the click tests below. */
const CLEAN_BODY =
  'Hi {{first_name}},\n\nThe studio has space this month and we would love to have your crew in for an afternoon.'

/** The default fixture body. A click test needs an arm that can be clicked. */
const CLEAN_BODY_WITH_LINK = `${CLEAN_BODY}\n\nHave a look: https://www.hosthampton.com/book`

function expRow(over: Record<string, any> = {}) {
  return {
    id: EXP,
    name: 'step one subject',
    surface: 'sequence_step',
    target_key: sequenceTargetKey(SEQ, 1),
    metric: 'clicked',
    min_per_arm: 30,
    alpha: 0.05,
    hypothesis: null,
    status: 'active',
    outcome: null,
    outcome_note: null,
    winning_variant: null,
    concluded_at: null,
    created_by: 'admin:test',
    activated_by: 'admin:test',
    activated_at: '2026-09-01T00:00:00Z',
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  }
}

function variantRow(id: string, label: string, over: Record<string, any> = {}) {
  return {
    id,
    experiment_id: EXP,
    label,
    is_control: label === 'A',
    subject: `Subject ${label} for the studio`,
    body_text: CLEAN_BODY_WITH_LINK,
    body_html: '<p>whatever</p>',
    screen_notes: [],
    created_by: 'COPY',
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  }
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('loadVariants — the read-time screen', () => {
  it('returns clean variants', async () => {
    const db = makeExperimentDb({ content_variants: [variantRow(uuid(2), 'A'), variantRow(uuid(3), 'B')] })
    const r = await loadVariants(db.supabase, EXP)
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.variants).toHaveLength(2)
    expect(r.rejected).toHaveLength(0)
  })

  it('DROPS a row written straight into the store that names a price, and says which', async () => {
    const db = makeExperimentDb({
      content_variants: [
        variantRow(uuid(2), 'A'),
        variantRow(uuid(3), 'B', { body_text: `${CLEAN_BODY}\n\nParties start at $500.` }),
      ],
    })
    const r = await loadVariants(db.supabase, EXP)
    if ('error' in r) throw new Error(r.error)
    expect(r.variants.map(v => v.label)).toEqual(['A'])
    expect(r.rejected).toHaveLength(1)
    expect(r.rejected[0].label).toBe('B')
    expect(r.rejected[0].reason).toMatch(/\$500/)
  })

  it('DROPS a row carrying a foreign payment link', async () => {
    const db = makeExperimentDb({
      content_variants: [variantRow(uuid(3), 'B', { body_text: `${CLEAN_BODY}\n\nPay at https://hosthampton-secure.net/x` })],
    })
    const r = await loadVariants(db.supabase, EXP)
    if ('error' in r) throw new Error(r.error)
    expect(r.variants).toHaveLength(0)
    expect(r.rejected[0].reason).toMatch(/hosthampton-secure\.net/)
  })

  it('NEVER returns the stored body_html — it is derived from the screened text', async () => {
    // The hole this closes: `screenVariant` screens `subject` and `body_text`.
    // It cannot screen HTML. A hand-inserted `<script>` in `body_html` would go
    // straight into an inbox past a screen that had just approved the plain
    // text beside it — the same shape as the two unscreened readers link 6
    // found in its own file (rule 11).
    const db = makeExperimentDb({
      content_variants: [variantRow(uuid(2), 'A', { body_html: '<script>alert(1)</script><img src=x onerror=y>' })],
    })
    const r = await loadVariants(db.supabase, EXP)
    if ('error' in r) throw new Error(r.error)
    expect(r.variants[0].body_html).not.toContain('<script>')
    expect(r.variants[0].body_html).not.toContain('onerror')
    expect(r.variants[0].body_html).toContain('{{first_name}}')
  })

  it('returns the SCREENED copy, not the stored copy', async () => {
    const TAG_A = String.fromCodePoint(0xe0041)
    const db = makeExperimentDb({ content_variants: [variantRow(uuid(2), 'A', { body_text: `${CLEAN_BODY}${TAG_A}` })] })
    const r = await loadVariants(db.supabase, EXP)
    if ('error' in r) throw new Error(r.error)
    expect(r.variants[0].body_text).not.toContain(TAG_A)
  })

  it('a read failure is an error, not an empty list', async () => {
    const db = makeExperimentDb()
    db.failReads('content_variants')
    expect('error' in (await loadVariants(db.supabase, EXP))).toBe(true)
  })
})

describe('a click test needs an arm that can be clicked', () => {
  /**
   * Found by driving this in production. The first real challenger COPY wrote
   * came back as "Take a look at the calendar." with no URL, and the send
   * reported "variant B sent with NO tracked link". The control's copy is the
   * live step, which keeps its real anchor, so the control could score and the
   * challenger could not — the control wins by construction and the result
   * reads as a finding about the words. That is rule 15 with a plausible number
   * attached, which is the worst kind.
   */
  const LINKED = `${CLEAN_BODY}\n\nHave a look: https://www.hosthampton.com/book`

  it('drops a non-control arm with no trackable link when the metric is `clicked`', async () => {
    const db = makeExperimentDb({
      content_variants: [variantRow(uuid(2), 'A'), variantRow(uuid(3), 'B', { body_text: CLEAN_BODY })],
    })
    const r = await loadVariants(db.supabase, EXP, { metric: 'clicked' })
    if ('error' in r) throw new Error(r.error)
    expect(r.variants.map(v => v.label)).toEqual(['A'])
    expect(r.rejected[0].reason).toMatch(/could never score/)
  })

  it('keeps it when the arm does carry a link', async () => {
    const db = makeExperimentDb({
      content_variants: [variantRow(uuid(2), 'A'), variantRow(uuid(3), 'B', { body_text: LINKED })],
    })
    const r = await loadVariants(db.supabase, EXP, { metric: 'clicked' })
    if ('error' in r) throw new Error(r.error)
    expect(r.variants.map(v => v.label)).toEqual(['A', 'B'])
  })

  it('a body whose only link is the UNSUBSCRIBE link does not count', async () => {
    const db = makeExperimentDb({
      content_variants: [
        variantRow(uuid(3), 'B', { body_text: `${CLEAN_BODY}\n\nhttps://www.hosthampton.com/unsubscribe?t=abc` }),
      ],
    })
    const r = await loadVariants(db.supabase, EXP, { metric: 'clicked' })
    if ('error' in r) throw new Error(r.error)
    expect(r.variants).toHaveLength(0)
  })

  it('the CONTROL is exempt — its link lives in the step, which this cannot see', async () => {
    const db = makeExperimentDb({
      content_variants: [variantRow(uuid(2), 'A', { body_text: CLEAN_BODY }), variantRow(uuid(3), 'B', { body_text: LINKED })],
    })
    const r = await loadVariants(db.supabase, EXP, { metric: 'clicked' })
    if ('error' in r) throw new Error(r.error)
    expect(r.variants.map(v => v.label)).toEqual(['A', 'B'])
  })

  it('does not apply on a `converted` test, where a link is not the outcome', async () => {
    const db = makeExperimentDb({
      content_variants: [variantRow(uuid(2), 'A'), variantRow(uuid(3), 'B', { body_text: CLEAN_BODY })],
    })
    const r = await loadVariants(db.supabase, EXP, { metric: 'converted' })
    if ('error' in r) throw new Error(r.error)
    expect(r.variants).toHaveLength(2)
  })

  it('loadActiveExperiment passes the experiment\'s own metric through', async () => {
    // The whole fix is worthless if the metric never reaches the screen.
    const db = makeExperimentDb({
      content_experiments: [expRow({ metric: 'clicked' })],
      content_variants: [variantRow(uuid(2), 'A'), variantRow(uuid(3), 'B', { body_text: CLEAN_BODY })],
    })
    // One usable arm left → not a test → absent.
    expect((await loadActiveExperiment(db.supabase, 'sequence_step', sequenceTargetKey(SEQ, 1))).kind).toBe('absent')
  })

  it('hasTrackableLink, directly', () => {
    expect(hasTrackableLink('come to https://www.hosthampton.com/book')).toBe(true)
    expect(hasTrackableLink('nothing here at all')).toBe(false)
    expect(hasTrackableLink('opt out at https://www.hosthampton.com/unsubscribe?t=x')).toBe(false)
    expect(hasTrackableLink('see https://evil.example.com/x')).toBe(false)
  })
})

describe('loadActiveExperiment — a draft experiment is invisible', () => {
  const variants = [variantRow(uuid(2), 'A'), variantRow(uuid(3), 'B')]

  it('finds an active experiment for its target', async () => {
    const db = makeExperimentDb({ content_experiments: [expRow()], content_variants: variants })
    const r = await loadActiveExperiment(db.supabase, 'sequence_step', sequenceTargetKey(SEQ, 1))
    expect(r.kind).toBe('found')
  })

  it('a DRAFT experiment is absent — the whole gate in one assertion', async () => {
    const db = makeExperimentDb({ content_experiments: [expRow({ status: 'draft' })], content_variants: variants })
    expect((await loadActiveExperiment(db.supabase, 'sequence_step', sequenceTargetKey(SEQ, 1))).kind).toBe('absent')
  })

  it('so are paused, concluded and archived', async () => {
    for (const status of ['paused', 'concluded', 'archived']) {
      const db = makeExperimentDb({ content_experiments: [expRow({ status })], content_variants: variants })
      expect((await loadActiveExperiment(db.supabase, 'sequence_step', sequenceTargetKey(SEQ, 1))).kind).toBe('absent')
    }
  })

  it('issues the status filter as a QUERY, not as a code-side filter', async () => {
    // Asserted on the query for the reason `agentLearningsStructure.test.ts`
    // gives: on a one-row fixture the output looks identical either way, and the
    // safety property IS the filter.
    const calls: [string, any][] = []
    const supabase: any = {
      from: () => {
        const q: any = {
          select: () => q,
          eq: (k: string, v: any) => { calls.push([k, v]); return q },
          order: () => q,
          limit: () => Promise.resolve({ data: [], error: null }),
        }
        return q
      },
    }
    await loadActiveExperiment(supabase, 'sequence_step', 'x')
    expect(calls).toContainEqual(['status', 'active'])
  })

  it('does not match an experiment bound to a different target', async () => {
    const db = makeExperimentDb({ content_experiments: [expRow()], content_variants: variants })
    expect((await loadActiveExperiment(db.supabase, 'sequence_step', sequenceTargetKey(SEQ, 2))).kind).toBe('absent')
  })

  it('a null target_key is a catch-all and DOES match', async () => {
    const db = makeExperimentDb({ content_experiments: [expRow({ target_key: null })], content_variants: variants })
    expect((await loadActiveExperiment(db.supabase, 'sequence_step', sequenceTargetKey(SEQ, 7))).kind).toBe('found')
  })

  it('a one-armed experiment is absent — substituting a lone variant is not a test', async () => {
    const db = makeExperimentDb({ content_experiments: [expRow()], content_variants: [variantRow(uuid(2), 'A')] })
    expect((await loadActiveExperiment(db.supabase, 'sequence_step', sequenceTargetKey(SEQ, 1))).kind).toBe('absent')
  })

  it('an experiment whose second arm the read screen just ate is absent, not one-armed', async () => {
    const db = makeExperimentDb({
      content_experiments: [expRow()],
      content_variants: [variantRow(uuid(2), 'A'), variantRow(uuid(3), 'B', { body_text: 'Book now for $999 flat.' })],
    })
    expect((await loadActiveExperiment(db.supabase, 'sequence_step', sequenceTargetKey(SEQ, 1))).kind).toBe('absent')
  })

  it('a read failure is `unavailable`, never `absent`', async () => {
    const db = makeExperimentDb({ content_experiments: [expRow()], content_variants: variants })
    db.failReads('content_experiments')
    expect((await loadActiveExperiment(db.supabase, 'sequence_step', 'x')).kind).toBe('unavailable')
  })

  it('a row with values this build does not understand is refused rather than coerced', async () => {
    // Rule 15: an input the pipeline cannot interpret is dropped, never guessed
    // at. A `min_per_arm` of 1 would turn the refusal off.
    const db = makeExperimentDb({ content_experiments: [expRow({ min_per_arm: 1 })], content_variants: variants })
    expect((await loadActiveExperiment(db.supabase, 'sequence_step', sequenceTargetKey(SEQ, 1))).kind).toBe('absent')

    const db2 = makeExperimentDb({ content_experiments: [expRow({ alpha: 0.9 })], content_variants: variants })
    expect((await loadActiveExperiment(db2.supabase, 'sequence_step', sequenceTargetKey(SEQ, 1))).kind).toBe('absent')
  })
})

describe('loadExperiment — three outcomes', () => {
  it('found, absent and unavailable are all distinguishable', async () => {
    const db = makeExperimentDb({ content_experiments: [expRow()], content_variants: [variantRow(uuid(2), 'A')] })
    expect((await loadExperiment(db.supabase, EXP)).kind).toBe('found')
    expect((await loadExperiment(db.supabase, uuid(999))).kind).toBe('absent')
    db.failReads('content_experiments')
    expect((await loadExperiment(db.supabase, EXP)).kind).toBe('unavailable')
  })

  it('a malformed row is `unavailable`, and says which fields it did not understand', async () => {
    const db = makeExperimentDb({ content_experiments: [expRow({ min_per_arm: 1 })] })
    const r = await loadExperiment(db.supabase, EXP)
    expect(r.kind).toBe('unavailable')
    if (r.kind === 'unavailable') expect(r.error).toMatch(/min_per_arm/)
  })
})
