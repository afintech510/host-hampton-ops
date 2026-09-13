/**
 * What `/api/cron/process-sequences` does on the FIRST TICK after six months.
 *
 * This is the question `sequenceProcessor.test.ts` does not ask. Every test
 * there drives one or two enrollments a few days apart, which is what a healthy
 * fifteen-minute job looks like. The live table on 2026-09-13 looks nothing like
 * that: the job stopped on 2026-08-16, **45 enrollments are `active`**, the two
 * oldest are from 2026-03-10, and the shape of the pile is what decides what
 * happens when Adam switches the schedule back on.
 *
 * Two things were wrong and neither was visible from a two-row fixture.
 *
 *   1. `?limit=N` capped rows READ. The two oldest enrollments are on
 *      `Post-Booking Prep`, whose `is_active` is false, so they are skipped and
 *      stay `active` at the top of the oldest-first scan forever. `?limit=1` —
 *      documented in PLAN.md and AGENTS.md as "the drain: one real person per
 *      tick" — therefore drained nobody, and could not have.
 *   2. Nothing anywhere asked how LATE a step was. A step that came due in July
 *      was as due as one that came due five minutes ago, so the first tick sent
 *      "Get ready for party day at Host Hampton!" about parties three weeks past.
 *
 * The fixture below is the live pile in miniature, with the same ordering.
 */

import { makeSupabase, SEQUENCE_SEND_UNIQUE } from './fakeSupabase'
import { processSequences, BATCH_SIZE } from '@/lib/sequences/processor'

const NOW = new Date('2026-09-13T12:00:00Z')

function daysBefore(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Three enrollments, in the order the scan returns them:
 *   dead-1   oldest, on an INACTIVE sequence — the row that ate the drain
 *   stale-1  due 30 days ago — inside the pile, past the freshness bound
 *   fresh-1  due 1 day ago — the one a drain should actually reach
 */
function backlogStore(overrides: Record<string, any[]> = {}) {
  const deadSeq = { id: 'seq-dead', name: 'Post-Booking Prep', total_emails: 1, is_active: false }
  const liveSeq = { id: 'seq-live', name: 'Lead Follow-Up', total_emails: 2, is_active: true }
  return {
    contact_sequence_enrollments: [
      {
        id: 'dead-1', contact_id: 'con-1', sequence_id: 'seq-dead', status: 'active', current_step: 0,
        enrolled_at: daysBefore(187), last_sent_at: null, metadata: {}, email_sequences: deadSeq,
      },
      {
        id: 'stale-1', contact_id: 'con-2', sequence_id: 'seq-live', status: 'active', current_step: 0,
        enrolled_at: daysBefore(33), last_sent_at: null, metadata: {}, email_sequences: liveSeq,
      },
      {
        id: 'fresh-1', contact_id: 'con-3', sequence_id: 'seq-live', status: 'active', current_step: 0,
        enrolled_at: daysBefore(4), last_sent_at: null, metadata: {}, email_sequences: liveSeq,
      },
    ],
    email_sequence_steps: [
      { id: 'st-d1', sequence_id: 'seq-dead', step_number: 1, delay_days: 1, delay_reference: 'previous_step', subject: 'Prep', body_html: '<p>x</p>', body_text: null },
      { id: 'st-l1', sequence_id: 'seq-live', step_number: 1, delay_days: 3, delay_reference: 'previous_step', subject: 'Still thinking?', body_html: '<p>one</p>', body_text: null },
      { id: 'st-l2', sequence_id: 'seq-live', step_number: 2, delay_days: 4, delay_reference: 'previous_step', subject: 'Second', body_html: '<p>two</p>', body_text: null },
    ],
    contacts: [
      { id: 'con-1', email: 'one@example.com', first_name: 'One', email_opt_in: true, status: 'lead' },
      { id: 'con-2', email: 'two@example.com', first_name: 'Two', email_opt_in: true, status: 'lead' },
      { id: 'con-3', email: 'three@example.com', first_name: 'Three', email_opt_in: true, status: 'lead' },
    ],
    email_sequence_sends: [],
    contact_interactions: [],
    ...overrides,
  }
}

function sender() {
  const sent: any[] = []
  const fn = jest.fn(async (msg: any) => { sent.push(msg); return { ok: true, id: `msg-${sent.length}` } })
  return { fn, sent }
}

const originalEnv = process.env
beforeEach(() => {
  process.env = {
    ...originalEnv,
    RESEND_API_KEY: 'test-resend',
    PORTAL_LINK_SIGNING_SECRET: 'test-secret',
    NEXT_PUBLIC_SITE_URL: 'https://www.hosthampton.com',
  }
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())
afterAll(() => { process.env = originalEnv })

describe('the drain: ?limit caps SENDS, not rows read', () => {
  it('reaches a real recipient even when the oldest rows can never progress', async () => {
    const store = backlogStore()
    const s = sender()

    const summary = await processSequences({
      supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]) as any,
      sendEmail: s.fn,
      now: NOW,
      sendCap: 1,
    })

    // THE regression. Under the old semantics (batchSize: 1) this was 0.
    expect(summary.sent).toBe(1)
    expect(s.sent).toHaveLength(1)
    expect(s.sent[0].to).toBe('three@example.com') // the only one inside the bound
  })

  it('stops at the cap and leaves the rest untouched for the next tick', async () => {
    const store = backlogStore()
    // Two sendable enrollments, cap of one.
    store.contact_sequence_enrollments.push({
      id: 'fresh-2', contact_id: 'con-4', sequence_id: 'seq-live', status: 'active', current_step: 0,
      enrolled_at: daysBefore(5), last_sent_at: null, metadata: {},
      email_sequences: { id: 'seq-live', name: 'Lead Follow-Up', total_emails: 2, is_active: true },
    })
    store.contacts.push({ id: 'con-4', email: 'four@example.com', first_name: 'Four', email_opt_in: true, status: 'lead' })
    const s = sender()

    const summary = await processSequences({
      supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]) as any,
      sendEmail: s.fn, now: NOW, sendCap: 1,
    })

    expect(summary.sent).toBe(1)
    expect(summary.capped).toBeGreaterThanOrEqual(1)
    expect(summary.notes.some(n => n.includes('send cap of 1 reached'))).toBe(true)
    // Oldest-first, so `fresh-2` (5 days) is reached before `fresh-1` (4 days).
    expect(s.sent[0].to).toBe('four@example.com')
    // The capped row was not touched at all — no claim row, still at step 0.
    const untouched = store.contact_sequence_enrollments.find(e => e.id === 'fresh-1')!
    expect(untouched.status).toBe('active')
    expect(untouched.current_step).toBe(0)
    expect(store.email_sequence_sends.find(r => r.enrollment_id === 'fresh-1')).toBeUndefined()
  })

  it('with no cap, the tick behaves exactly as it did before', async () => {
    const store = backlogStore()
    const s = sender()

    const summary = await processSequences({
      supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]) as any,
      sendEmail: s.fn, now: NOW,
    })

    expect(summary.capped).toBe(0)
    expect(summary.scanned).toBe(3)
  })

  it('names the enrollments that can never progress instead of hiding them in `skipped`', async () => {
    const store = backlogStore()
    const summary = await processSequences({
      supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]) as any,
      sendEmail: sender().fn, now: NOW,
    })

    expect(summary.inactiveSequence).toBe(1)
    expect(summary.notes.some(n => n.includes('is_active is false'))).toBe(true)
  })

  it('BATCH_SIZE is the ceiling on the cap, not on what the drain can reach', () => {
    expect(BATCH_SIZE).toBeGreaterThanOrEqual(50)
  })
})

describe('the freshness bound', () => {
  it('PAUSES a step that came due long ago instead of sending it', async () => {
    const store = backlogStore()
    const s = sender()

    const summary = await processSequences({
      supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]) as any,
      sendEmail: s.fn, now: NOW,
    })

    expect(summary.stale).toBe(1)
    expect(summary.paused).toBe(1)
    const stale = store.contact_sequence_enrollments.find(e => e.id === 'stale-1')!
    expect(stale.status).toBe('paused')
    // Not sent, and no claim row burned on it.
    expect(s.sent.map(m => m.to)).not.toContain('two@example.com')
    expect(store.email_sequence_sends.find(r => r.enrollment_id === 'stale-1')).toBeUndefined()
  })

  it('says why, and says how to undo it', async () => {
    const store = backlogStore()
    const summary = await processSequences({
      supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]) as any,
      sendEmail: sender().fn, now: NOW,
    })

    const note = summary.notes.find(n => n.includes('stale-1'))
    expect(note).toBeDefined()
    expect(note).toMatch(/stale/)
    expect(note).toMatch(/freshness bound/)
    expect(note).toMatch(/PAUSED/)
    // Rule 10: a guardrail that stops something must say so in a form a human
    // can act on. The reversal is one statement and it is in the sentence.
    expect(note).toMatch(/update contact_sequence_enrollments set status='active'/)
  })

  it('does NOT pause a step that is merely a day late', async () => {
    const store = backlogStore()
    const s = sender()

    await processSequences({
      supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]) as any,
      sendEmail: s.fn, now: NOW,
    })

    const fresh = store.contact_sequence_enrollments.find(e => e.id === 'fresh-1')!
    expect(fresh.status).toBe('active')
    expect(fresh.current_step).toBe(1)
    expect(s.sent.map(m => m.to)).toContain('three@example.com')
  })

  it('the bound is configurable, and widening it lets the stale one through', async () => {
    process.env.SEQUENCE_MAX_LATENESS_DAYS = '365'
    const store = backlogStore()
    const s = sender()

    const summary = await processSequences({
      supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]) as any,
      sendEmail: s.fn, now: NOW,
    })

    expect(summary.stale).toBe(0)
    expect(s.sent.map(m => m.to)).toContain('two@example.com')
  })

  it('an unusable bound falls back to the default rather than to "no bound"', async () => {
    process.env.SEQUENCE_MAX_LATENESS_DAYS = 'soon'
    const store = backlogStore()
    const s = sender()

    const summary = await processSequences({
      supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]) as any,
      sendEmail: s.fn, now: NOW,
    })

    expect(summary.stale).toBe(1)
    expect(s.sent.map(m => m.to)).not.toContain('two@example.com')
  })
})
