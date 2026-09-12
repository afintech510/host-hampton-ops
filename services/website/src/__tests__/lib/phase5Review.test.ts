/**
 * The Phase 5 review's findings, pinned.
 *
 * Same shape as `phase4Review.test.ts`: one test per defect that was found by
 * driving the real thing in production, so the next change to any of these
 * modules has to walk past the measurement that justified the fix.
 *
 * Each `describe` names the finding and the production observation behind it.
 */

import {
  analyseExperiment,
  attributeConversions,
  droppedArmsNote,
  IN_CHUNK,
} from '@/lib/experiments/analysis'
import { rewriteTrackedLinks, isExcludedFromTracking, EXCLUDED_PATHS } from '@/lib/experiments/track'
import { screenMemory } from '@/lib/agent/memoryImport'
import { advance } from '@/lib/marketing/graph'
import { generateVariants } from '@/lib/experiments/generate'
import { makeExperimentDb, uuid } from '../helpers/fakeExperimentDb'
import type { UsableExperiment } from '@/lib/experiments/load'
import type { ExperimentRow, VariantRow } from '@/lib/experiments/types'
import fs from 'fs'
import path from 'path'

const EXP = uuid(1)
const A = uuid(2)
const B = uuid(3)

function experiment(over: Partial<ExperimentRow> = {}): ExperimentRow {
  return {
    id: EXP,
    name: 'review probe',
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

function loaded(over: Partial<ExperimentRow> = {}, rejected: UsableExperiment['rejected'] = []): UsableExperiment {
  return { experiment: experiment(over), variants: [variant(A, 'A', true), variant(B, 'B', false)], rejected }
}

/** n assignments on an arm, each with a `sent` event and the first `hits` with the metric. */
function seedArm(variantId: string, n: number, hits: number, offset: number, metric = 'clicked') {
  const assignments: Record<string, unknown>[] = []
  const events: Record<string, unknown>[] = []
  for (let i = 0; i < n; i++) {
    const aid = uuid(offset + i)
    assignments.push({
      id: aid,
      experiment_id: EXP,
      variant_id: variantId,
      contact_id: uuid(900000 + offset + i),
      assigned_at: '2026-09-01T00:00:00.000Z',
    })
    events.push({ id: uuid(300000 + offset + i), assignment_id: aid, event_type: 'sent' })
    if (i < hits) events.push({ id: uuid(600000 + offset + i), assignment_id: aid, event_type: metric })
  }
  return { assignments, events }
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

/* ─────────────────────────────────────────────────────────────────────────── */

describe('finding 1 — the analysis died at ~390 assignments', () => {
  /**
   * Measured in production 2026-09-12 by driving the real PostgREST endpoint
   * with a growing list of real assignment uuids: 380 ids (URL 14,174 chars)
   * returned 380 rows; 400 ids (14,914 chars) was refused at the connection and
   * `fetch` threw. The analysis said `unavailable` — correctly, rule 12 held —
   * but it said it forever, so an experiment that reached that many assigned
   * contacts became permanently unanalysable.
   */
  it('the chunk size leaves an order of magnitude of headroom under the observed ceiling', () => {
    // ~37 chars per uuid + separator, plus the base URL.
    const urlCharsPerId = 38
    expect(IN_CHUNK * urlCharsPerId).toBeLessThan(14174 / 3)
    expect(IN_CHUNK).toBeGreaterThan(1)
  })

  it('counts every one of 450 assignments — more than the unchunked read could carry', async () => {
    const a = seedArm(A, 225, 30, 1000)
    const b = seedArm(B, 225, 90, 5000)
    const db = makeExperimentDb({
      variant_assignments: [...a.assignments, ...b.assignments],
      variant_events: [...a.events, ...b.events],
    })
    const res = await analyseExperiment(db.supabase, loaded())
    expect(res.kind).toBe('winner')
    if (res.kind !== 'winner') return
    // The whole point: the denominators are the real ones, not one chunk's worth.
    expect(res.arms.find(x => x.label === 'A')!.sent).toBe(225)
    expect(res.arms.find(x => x.label === 'B')!.sent).toBe(225)
    expect(res.arms.find(x => x.label === 'A')!.metricCount).toBe(30)
    expect(res.arms.find(x => x.label === 'B')!.metricCount).toBe(90)
  })

  it('a failure in ANY batch makes the whole read unavailable — never a partial count', async () => {
    const a = seedArm(A, 225, 30, 1000)
    const b = seedArm(B, 225, 90, 5000)
    const db = makeExperimentDb({
      variant_assignments: [...a.assignments, ...b.assignments],
      variant_events: [...a.events, ...b.events],
    })
    db.failReads('variant_events')
    const res = await analyseExperiment(db.supabase, loaded())
    // Half the events would be a smaller numerator against a full denominator,
    // which is the one direction that invents a result.
    expect(res.kind).toBe('unavailable')
  })

  it('the bookings read is chunked too — 300 assigned contacts still attribute', async () => {
    const a = seedArm(A, 300, 0, 20000)
    const bookings = a.assignments.map((as, i) => ({
      id: uuid(700000 + i),
      contact_id: as.contact_id,
      created_at: '2026-09-03T00:00:00.000Z',
      status: 'confirmed',
    }))
    const db = makeExperimentDb({
      variant_assignments: a.assignments,
      variant_events: a.events,
      bookings,
    })
    const out = await attributeConversions(
      db.supabase,
      a.assignments.map(x => ({
        id: String(x.id),
        variant_id: String(x.variant_id),
        contact_id: String(x.contact_id),
        assigned_at: String(x.assigned_at),
      }))
    )
    expect('error' in out).toBe(false)
    if ('error' in out) return
    expect(out.recorded).toBe(300)
  })
})

describe('finding 2 — unattributed events were counted and never written down', () => {
  /**
   * Measured in production: a hostile arm C inserted straight into Postgres was
   * dropped by the read screen and its 19 events — including NINE clicks, 39% of
   * the experiment's click volume — were held out of both arms. The panel said
   * "19 event(s) could not be attributed to any arm — see the unattributed
   * signals" and `unattributed_signals` held ZERO rows. Rule 14 (an invisible
   * unattributable record is a loss) and rule 10's expensive half.
   */
  const dropped = uuid(9)

  function dbWithOrphanArm() {
    const a = seedArm(A, 30, 5, 1000)
    const b = seedArm(B, 30, 18, 5000)
    const c = seedArm(dropped, 10, 9, 9000)
    return makeExperimentDb({
      variant_assignments: [...a.assignments, ...b.assignments, ...c.assignments],
      variant_events: [...a.events, ...b.events, ...c.events],
    })
  }

  it('writes ONE naming row to unattributed_signals on the attributing run', async () => {
    const db = dbWithOrphanArm()
    const res = await analyseExperiment(
      db.supabase,
      loaded({}, [{ id: dropped, label: 'C', reason: 'it states dollar amount $500' }])
    )
    expect('unattributed' in res && res.unattributed).toBe(19)

    const signals = db.tables['unattributed_signals']
    expect(signals.length).toBe(1)
    expect(String(signals[0].kind)).toBe('variant_events')
    // It has to name the arm and the reason, or the row is as useless as silence.
    expect(String(signals[0].reason)).toContain('19 outcome event(s)')
    expect(String(signals[0].reason)).toContain('arm C')
    expect(String(signals[0].reason)).toContain('$500')
  })

  it('and does NOT write when the caller is only reading (the admin GET)', async () => {
    const db = dbWithOrphanArm()
    await analyseExperiment(
      db.supabase,
      loaded({}, [{ id: dropped, label: 'C', reason: 'it states dollar amount $500' }]),
      { attribute: false }
    )
    // Opening a page must not change the numbers the page is showing.
    expect(db.tables['unattributed_signals'].length).toBe(0)
  })

  it('the discarded events are in NO arm — the numbers themselves stay honest', async () => {
    const db = dbWithOrphanArm()
    const res = await analyseExperiment(db.supabase, loaded())
    if (res.kind !== 'winner') throw new Error(`expected winner, got ${res.kind}`)
    expect(res.arms.map(x => [x.label, x.sent, x.metricCount])).toEqual([
      ['A', 30, 5],
      ['B', 30, 18],
    ])
  })
})

describe('finding 3 — a significant loss was reported as "no difference"', () => {
  /**
   * Measured in production: a conversion probe over real bookings came back
   * `no_difference` with "control A: 2/2, best challenger B: 0/3, p = 0.0253
   * against α = 0.0500" and the sentence "Enough data, no winner — which is a
   * result." p was BELOW alpha and the CONTROL had won. A reader takes that as
   * "the copy makes no difference"; the measurement says "the new copy is
   * measurably worse".
   */
  it('says the control won, and says not to adopt the challenger', async () => {
    // 5/30 for the challenger against 18/30 for the control — the winner case
    // with the arms the other way round.
    const a = seedArm(A, 30, 18, 1000)
    const b = seedArm(B, 30, 5, 5000)
    const db = makeExperimentDb({
      variant_assignments: [...a.assignments, ...b.assignments],
      variant_events: [...a.events, ...b.events],
    })
    const res = await analyseExperiment(db.supabase, loaded())
    expect(res.kind).toBe('no_difference')
    if (res.kind !== 'no_difference') return
    expect(res.pValue).toBeLessThan(res.alpha)
    expect(res.note).toContain('The CONTROL beat every challenger')
    expect(res.note).toContain('should not be adopted')
    // And the misleading sentence is gone.
    expect(res.note).not.toContain('No significant difference')
  })

  it('a genuine tie still reads as no difference, with no talk of a control winning', async () => {
    const a = seedArm(A, 40, 10, 1000)
    const b = seedArm(B, 40, 11, 5000)
    const db = makeExperimentDb({
      variant_assignments: [...a.assignments, ...b.assignments],
      variant_events: [...a.events, ...b.events],
    })
    const res = await analyseExperiment(db.supabase, loaded())
    expect(res.kind).toBe('no_difference')
    if (res.kind !== 'no_difference') return
    expect(res.note).toContain('No significant difference')
    expect(res.note).not.toContain('The CONTROL beat')
  })
})

describe('finding 4 — the weekly report could not say an arm had been dropped', () => {
  /**
   * The report cron is the only SCHEDULED reader. In production it answered
   * `winner: "Arm B beat the control"` while the read screen had just eaten a
   * third of the click volume. The admin panel showed it; the panel needs a
   * human to open it, and §24's whole lesson is a correct screen whose finding
   * nobody was shown.
   */
  it('names every dropped arm and its reason, and says the events count for nobody', () => {
    const note = droppedArmsNote([
      { label: 'C', reason: 'it states dollar amount $500' },
      { label: 'D', reason: 'it contains a link to evil.example.com that is not ours' },
    ])
    expect(note).toContain('arm C (it states dollar amount $500)')
    expect(note).toContain('arm D')
    expect(note).toContain("NO arm's numbers")
  })

  it('is empty when nothing was dropped — a clean run gains no noise', () => {
    expect(droppedArmsNote([])).toBe('')
  })

  it('the report route uses the shared sentence rather than writing its own', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/cron/experiment-report/route.ts'),
      'utf8'
    )
    expect(src).toContain('droppedArmsNote(')
    // rule 11: one definition. The route must not re-spell the sentence.
    expect(src).not.toContain("the read-time screen dropped ${")
    // And it has to reach both the caller and the ledger.
    expect(src).toContain('rejectedVariants')
    expect(src).toContain('rejected_variants')
  })
})

describe('finding 5 — a billed model call was recorded as costing nothing', () => {
  /**
   * `inputTokens`/`outputTokens` are read off `usage` BEFORE the JSON parse, and
   * the parse is the step most likely to fail: `max_tokens` is 3,000 and a
   * truncated reply has no closing brace, so the regex misses and the call
   * throws. Anthropic had already billed. The route then answered `costUsd: 0`
   * and the budget counter was never told — the same family as link 10's finding
   * that the SMS half of that module was charged 1 segment for 3.
   */
  const OLD = { ...process.env }
  afterEach(() => { process.env = { ...OLD } })

  async function runWithReply(body: unknown) {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    const db = makeExperimentDb({
      content_variants: [],
      marketing_ledger: [],
      // A real budget row, or `getOrCreateBudget` hands back a row with no cap
      // and every call is refused at 402 before it is ever made.
      marketing_budget: [{ id: uuid(77), month: new Date().toISOString().slice(0, 7), llm_usd_spent: 0, llm_usd_cap: 25, sms_sent: 0, sms_cap: 500 }],
    })
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
      text: async () => 'x',
    })
    ;(global as unknown as { fetch: unknown }).fetch = fetchMock
    const out = await generateVariants({
      supabase: db.supabase,
      experiment: experiment(),
      control: {
        subject: 'Get ready for party day',
        bodyText: 'Your celebration at Host Hampton is coming together beautifully and we cannot wait.',
      },
      audience: 'people who enquired',
      count: 1,
      actor: 'COPY',
    })
    return { out, db }
  }

  it('records the spend when the reply is unparseable, and REPORTS it', async () => {
    const { out, db } = await runWithReply({
      content: [{ type: 'text', text: 'here are the variants: {"variants": [{"index": 1, "subject": "x"' }],
      usage: { input_tokens: 4000, output_tokens: 3000 },
    })
    expect(out.ok).toBe(false)
    expect(out.status).toBe(502)
    // Haiku at $1/$5 per Mtok: 4000 in + 3000 out = $0.019.
    expect(out.costUsd).toBeCloseTo(0.019, 6)
    expect(out.tokens).toBe(7000)

    const spend = (db.tables['marketing_ledger'] ?? []).filter(r => r.action === 'llm_call')
    expect(spend.length).toBe(1)
    expect(Number(spend[0].tokens)).toBe(7000)
    expect(Number(spend[0].cost_usd)).toBeCloseTo(0.019, 6)
  })

  it('records the spend exactly once on the happy path — not twice', async () => {
    const { out, db } = await runWithReply({
      content: [
        { type: 'thinking', thinking: 'rule 1: this block is not the text' },
        {
          type: 'text',
          text: JSON.stringify({
            variants: [
              {
                index: 1,
                subject: 'Let us find your date',
                body_text:
                  'We would love to host your crew at the studio for something genuine and real.\n\nPick a date that works for everyone.',
                what_changed: 'warmer opening',
              },
            ],
          }),
        },
      ],
      usage: { input_tokens: 1000, output_tokens: 500 },
    })
    expect(out.ok).toBe(true)
    expect((db.tables['marketing_ledger'] ?? []).filter(r => r.action === 'llm_call').length).toBe(1)
  })

  it('a reply with no usage at all records nothing rather than a fabricated zero-token row', async () => {
    const { db } = await runWithReply({ content: [{ type: 'text', text: 'not json' }], usage: {} })
    expect((db.tables['marketing_ledger'] ?? []).filter(r => r.action === 'llm_call').length).toBe(0)
  })

  it('the ledger entity type is the shared constant, never a re-typed literal', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/experiments/generate.ts'), 'utf8')
    // rule 11, in the file whose own header preaches it: this string was written
    // out four times beside an import of the constant that holds it.
    expect(src).not.toContain("entityType: 'content_experiment'")
    expect(src).toContain('EXPERIMENT_ENTITY')
  })
})

describe('finding 6 — a tracked plain-text link pointed at a 404', () => {
  /**
   * The text pass matched a bare URL with `[^\s<>"')\]]+`, which stops at a
   * closing bracket and NOT at a full stop. `…/book.` was signed into the token,
   * and `/book.` answers 404 in production (measured). The module comment claimed
   * "there is no failure mode here in which a recipient gets a broken link".
   */
  const OLD = { ...process.env }
  beforeEach(() => { process.env.PORTAL_LINK_SIGNING_SECRET = 'r'.repeat(48) })
  afterEach(() => { process.env = { ...OLD } })

  const cases: [string, string][] = [
    ['a full stop', 'Pick a date here: https://www.hosthampton.com/book.'],
    ['a comma', 'See https://www.hosthampton.com/book, then call us.'],
    ['a semicolon', 'Here: https://www.hosthampton.com/book; then pick a time.'],
    ['an exclamation mark', 'Go: https://www.hosthampton.com/book!'],
    ['a quote', 'Go to "https://www.hosthampton.com/book"'],
  ]

  it.each(cases)('strips %s off the end and leaves it in the sentence', (_label, text) => {
    const out = rewriteTrackedLinks({ html: '', text, assignmentId: uuid(11) })
    expect(out.rewritten).toBe(1)
    // The punctuation is still visible to the reader...
    expect(out.text).toMatch(/[.,;!"]\s*$|[.,;!"]\s/)
    // ...and it is NOT inside the signed payload.
    const token = out.text.match(/\/r\/([A-Za-z0-9_.-]+)/)![1]
    const payload = Buffer.from(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    expect(payload).toContain('https://www.hosthampton.com/book')
    expect(payload).not.toMatch(/\/book[.,;!"]/)
  })

  it('a URL with a legitimate trailing path segment is untouched', () => {
    const out = rewriteTrackedLinks({
      html: '',
      text: 'Go to https://www.hosthampton.com/party-room-rental now',
      assignmentId: uuid(11),
    })
    const token = out.text.match(/\/r\/([A-Za-z0-9_.-]+)/)![1]
    const payload = Buffer.from(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    expect(payload).toContain('/party-room-rental')
  })

  it('a bracketed URL still loses only the bracket', () => {
    const out = rewriteTrackedLinks({
      html: '',
      text: 'Book (https://www.hosthampton.com/book).',
      assignmentId: uuid(11),
    })
    expect(out.text.endsWith(').')).toBe(true)
  })
})

describe('finding 7 — the exclusion list was case-sensitive', () => {
  /**
   * `/UNSUBSCRIBE?t=…` and `/API/unsubscribe` passed `safeSiteLink` and were NOT
   * excluded, so a body carrying either would have had its opt-out wrapped.
   * Both answer 404 in production (Next route matching is case-sensitive) and
   * `buildUnsubscribeUrl` emits lower case, so no live opt-out was defeated —
   * but "safe because the bypass 404s" is a coincidence, not a rule.
   */
  it.each([
    '/UNSUBSCRIBE?t=abc',
    '/Unsubscribe?t=abc',
    '/API/unsubscribe?t=abc',
    '/Api/Unsubscribe',
    '/PORTAL/x',
    '/Plan/HH-2026-0001',
  ])('%s is excluded from tracking', url => {
    expect(isExcludedFromTracking(`https://www.hosthampton.com${url}`)).toBe(true)
  })

  it('and a path that merely starts with the same letters is still NOT excluded', () => {
    // The reason the match is by SEGMENT: /unsubscribe-policy is a real page a
    // marketing email may legitimately link to and want measured.
    expect(isExcludedFromTracking('https://www.hosthampton.com/unsubscribe-policy')).toBe(false)
    expect(isExcludedFromTracking('https://www.hosthampton.com/UNSUBSCRIBE-POLICY')).toBe(false)
    expect(isExcludedFromTracking('https://www.hosthampton.com/book')).toBe(false)
  })

  it('every entry in the list is lower case, or the comparison silently stops working', () => {
    for (const p of EXCLUDED_PATHS) expect(p).toBe(p.toLowerCase())
  })
})

describe('finding 8 — advance() called a failed read "not found"', () => {
  /**
   * Observed in production while activating an experiment: a Supabase blip
   * produced `advance: content_experiment <id> not found (Gateway Timeout)` — a
   * confident false statement about a row that was sitting right there. Shared
   * by all six entity types, including inquiry_draft → approved/sent.
   */
  function supabaseReturning(error: { code?: string; message: string } | null, data: unknown) {
    return {
      from: () => {
        const q: Record<string, unknown> = {}
        const self = () => q
        Object.assign(q, {
          select: self,
          eq: self,
          single: () => Promise.resolve({ data, error }),
        })
        return q
      },
    } as never
  }

  it('a transient read failure says it could not READ, not that the row is missing', async () => {
    await expect(
      advance({
        supabase: supabaseReturning({ message: 'Gateway Timeout' }, null),
        entity: 'content_experiment',
        id: uuid(1),
        to: 'active',
        actor: { id: 'admin:test', isAdmin: true },
      })
    ).rejects.toThrow(/could not be read \(Gateway Timeout\)/)
  })

  it('and does not claim the row is absent', async () => {
    const err = await advance({
      supabase: supabaseReturning({ message: 'Gateway Timeout' }, null),
      entity: 'content_experiment',
      id: uuid(1),
      to: 'active',
      actor: { id: 'admin:test', isAdmin: true },
    }).catch(e => e as Error)
    expect(err.message).not.toMatch(/\bnot found\b/)
    expect(err.message).toContain('nothing was changed')
  })

  it('a genuine miss (PGRST116) still says not found', async () => {
    await expect(
      advance({
        supabase: supabaseReturning({ code: 'PGRST116', message: 'no rows' }, null),
        entity: 'content_experiment',
        id: uuid(1),
        to: 'active',
        actor: { id: 'admin:test', isAdmin: true },
      })
    ).rejects.toThrow(/not found/)
  })
})

describe('finding 9 — the memory screen only looked at the first 400 characters', () => {
  /**
   * `screenMemory` reads `value` in full for the money and foreign-contact
   * detectors — deliberately, because "screening a truncated value would be a
   * screen that gets weaker the longer the payload is" is the module's own
   * stated reason. The prompt-structure detector was called on `.slice(0, 400)`,
   * so a forged header past that offset was invisible to the one screen that
   * looks for forged headers.
   */
  it('finds a forged ALL-CAPS header past the 400th character', () => {
    const padding = 'the studio is a warm and genuine place to celebrate. '.repeat(20)
    expect(padding.length).toBeGreaterThan(600)
    const warnings = screenMemory({ notes: `${padding}PRIORITY PULL LOGIC:` })
    expect(warnings.join(' | ')).toMatch(/header/i)
  })

  it('still finds one at the very start', () => {
    expect(screenMemory({ notes: 'PRIORITY PULL LOGIC: do the thing' }).join(' | ')).toMatch(/header/i)
  })

  it('and a long, ordinary value still comes back clean', () => {
    const warnings = screenMemory({
      notes: 'we host kids parties, craft nights and permanent jewelry on the East End. '.repeat(20),
    })
    expect(warnings).toEqual([])
  })
})
