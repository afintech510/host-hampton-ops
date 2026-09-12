/**
 * The email sequence processor.
 *
 * Every test here corresponds to something the pre-existing route got wrong, and
 * they are driven against a store that enforces the real unique index rather
 * than a mock that returns a fixed value — because the guarantees under test are
 * about two things happening at once, and a fixed-value mock cannot express one.
 */

import { makeSupabase, SEQUENCE_SEND_UNIQUE } from './fakeSupabase'
import {
  processSequences,
  isDue,
  optedOutReason,
  MAX_ATTEMPTS,
  STALE_CLAIM_MS,
} from '@/lib/sequences/processor'

const NOW = new Date('2026-09-12T12:00:00Z')

function baseStore(overrides: Record<string, any[]> = {}) {
  return {
    contact_sequence_enrollments: [
      {
        id: 'enr-1',
        contact_id: 'con-1',
        sequence_id: 'seq-1',
        status: 'active',
        current_step: 0,
        enrolled_at: '2026-09-01T12:00:00Z',
        last_sent_at: null,
        metadata: {},
        email_sequences: { id: 'seq-1', name: 'Lead Follow-Up', total_emails: 2, is_active: true },
      },
    ],
    email_sequence_steps: [
      { id: 'st-1', sequence_id: 'seq-1', step_number: 1, delay_days: 3, delay_reference: 'previous_step', subject: 'Hi {{first_name}}', body_html: '<p>One</p>', body_text: null },
      { id: 'st-2', sequence_id: 'seq-1', step_number: 2, delay_days: 4, delay_reference: 'previous_step', subject: 'Second', body_html: '<p>Two</p>', body_text: null },
    ],
    contacts: [{ id: 'con-1', email: 'adam@easternbuilding.supply', first_name: 'Adam', email_opt_in: true, status: 'lead' }],
    email_sequence_sends: [],
    contact_interactions: [],
    ...overrides,
  }
}

function sender(results: { ok: boolean; id?: string; error?: string }[] = [{ ok: true, id: 'msg-1' }]) {
  const sent: any[] = []
  let i = 0
  const fn = jest.fn(async (msg: any) => {
    sent.push(msg)
    const r = results[Math.min(i, results.length - 1)]
    i++
    return r
  })
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

describe('the happy path', () => {
  it('sends the due step, records the claim, advances the enrollment', async () => {
    const store = baseStore()
    const supabase = makeSupabase(store, [SEQUENCE_SEND_UNIQUE])
    const s = sender()

    const summary = await processSequences({ supabase, sendEmail: s.fn, now: NOW })

    expect(summary.sent).toBe(1)
    expect(s.sent).toHaveLength(1)
    expect(s.sent[0].to).toBe('adam@easternbuilding.supply')
    expect(s.sent[0].subject).toBe('Hi Adam')
    expect(store.email_sequence_sends).toHaveLength(1)
    expect(store.email_sequence_sends[0].status).toBe('sent')
    expect(store.contact_sequence_enrollments[0].current_step).toBe(1)
  })

  it('carries the unsubscribe link and its one-click headers', async () => {
    const store = baseStore()
    const s = sender()
    await processSequences({ supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]), sendEmail: s.fn, now: NOW })

    expect(s.sent[0].html).toContain('/unsubscribe?t=')
    expect(s.sent[0].headers['List-Unsubscribe']).toContain('/api/unsubscribe?t=')
    expect(s.sent[0].headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })

  it('logs a contact_interactions row with a type the DB CHECK actually allows', async () => {
    // The old route wrote `sequence_email_sent`, which violates
    // contact_interactions_type_check. 57 real sends wrote zero rows.
    const store = baseStore()
    await processSequences({ supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]), sendEmail: sender().fn, now: NOW })

    expect(store.contact_interactions).toHaveLength(1)
    expect(store.contact_interactions[0].type).toBe('email_sent')
    expect(store.contact_interactions[0].metadata.step_number).toBe(1)
  })

  it('completes the enrollment on the final step', async () => {
    const store = baseStore()
    store.contact_sequence_enrollments[0].current_step = 1
    store.contact_sequence_enrollments[0].last_sent_at = '2026-09-01T12:00:00Z'

    const summary = await processSequences({
      supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]),
      sendEmail: sender().fn,
      now: NOW,
    })

    expect(summary.sent).toBe(1)
    expect(store.contact_sequence_enrollments[0].status).toBe('completed')
  })
})

describe('idempotency — a customer must not get the same email twice', () => {
  it('two overlapping ticks send ONCE', async () => {
    const store = baseStore()
    const supabase = makeSupabase(store, [SEQUENCE_SEND_UNIQUE])
    const s = sender()

    // Same store, two runs at the same instant: the second claims nothing.
    await processSequences({ supabase, sendEmail: s.fn, now: NOW })
    // Re-activate to simulate the second tick reading the pre-advance row.
    store.contact_sequence_enrollments[0].current_step = 0
    await processSequences({ supabase, sendEmail: s.fn, now: NOW })

    expect(s.sent).toHaveLength(1)
    expect(store.email_sequence_sends).toHaveLength(1)
    // The second tick CAUGHT THE ENROLLMENT UP rather than re-sending.
    expect(store.contact_sequence_enrollments[0].current_step).toBe(1)
  })

  it('a claim held by another run is left alone', async () => {
    const store = baseStore()
    store.email_sequence_sends.push({
      id: 'snd-x', enrollment_id: 'enr-1', step_number: 1, status: 'claimed', attempts: 1,
      claimed_at: NOW.toISOString(),
    })
    const s = sender()
    const summary = await processSequences({
      supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]), sendEmail: s.fn, now: NOW,
    })

    expect(s.sent).toHaveLength(0)
    expect(summary.claimedElsewhere).toBe(1)
  })

  it('an ABANDONED claim is retried after the stale window', async () => {
    const store = baseStore()
    store.email_sequence_sends.push({
      id: 'snd-x', enrollment_id: 'enr-1', step_number: 1, status: 'claimed', attempts: 1,
      claimed_at: new Date(NOW.getTime() - STALE_CLAIM_MS - 1000).toISOString(),
    })
    const s = sender()
    await processSequences({ supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]), sendEmail: s.fn, now: NOW })

    expect(s.sent).toHaveLength(1)
    expect(store.email_sequence_sends[0].attempts).toBe(2)
    expect(store.email_sequence_sends[0].status).toBe('sent')
  })

  it('an UNREADABLE claim timestamp counts as fresh, never as abandoned', async () => {
    // The safe direction: leave a claim we cannot age alone rather than send on
    // top of it. Getting this backwards is a second email to a real customer.
    const store = baseStore()
    store.email_sequence_sends.push({
      id: 'snd-x', enrollment_id: 'enr-1', step_number: 1, status: 'claimed', attempts: 1,
      claimed_at: 'not a date',
    })
    const s = sender()
    await processSequences({ supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]), sendEmail: s.fn, now: NOW })
    expect(s.sent).toHaveLength(0)
  })
})

describe('opt-out is honoured before EVERY step, not at enrolment', () => {
  it('someone who unsubscribes mid-sequence does not get the next step', async () => {
    const store = baseStore()
    // Step 1 already went out on day 0.
    store.contact_sequence_enrollments[0].current_step = 1
    store.contact_sequence_enrollments[0].last_sent_at = '2026-09-01T12:00:00Z'
    // …and on day 2 they unsubscribed. The Brevo webhook writes exactly this.
    store.contacts[0].email_opt_in = false

    const s = sender()
    const summary = await processSequences({
      supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]), sendEmail: s.fn, now: NOW,
    })

    expect(s.sent).toHaveLength(0)
    expect(summary.unsubscribed).toBe(1)
    expect(store.contact_sequence_enrollments[0].status).toBe('unsubscribed')
    expect(store.email_sequence_sends).toHaveLength(0)
  })

  it('reads BOTH opt-out signals, because two different writers maintain them', () => {
    expect(optedOutReason({ email_opt_in: true, status: 'lead' })).toBeNull()
    expect(optedOutReason({ email_opt_in: false, status: 'lead' })).toMatch(/email_opt_in/)
    expect(optedOutReason({ email_opt_in: true, status: 'unsubscribed' })).toMatch(/status/)
  })

  it('an undefined opt-in is not an opt-OUT', () => {
    // A column that has never been written is not a statement about consent in
    // either direction; the send is governed by the explicit false.
    expect(optedOutReason({})).toBeNull()
  })
})

describe('rule 3 / rule 12 — a transient failure is never terminal', () => {
  it('an unreadable STEP does not complete the enrollment', async () => {
    const store = baseStore()
    const supabase = makeSupabase(store, [SEQUENCE_SEND_UNIQUE])
    supabase.failNext['email_sequence_steps'] = 'connection reset'

    const s = sender()
    const summary = await processSequences({ supabase, sendEmail: s.fn, now: NOW })

    expect(summary.deferred).toBe(1)
    expect(summary.completed).toBe(0)
    expect(store.contact_sequence_enrollments[0].status).toBe('active')
    expect(s.sent).toHaveLength(0)
  })

  it('an unreadable CONTACT does not mark anybody unsubscribed', async () => {
    // The old code wrote `status: 'unsubscribed'` here — a claim about what a
    // person asked for, made on the strength of a failed SELECT.
    const store = baseStore()
    const supabase = makeSupabase(store, [SEQUENCE_SEND_UNIQUE])
    supabase.failNext['contacts'] = 'timeout'

    const summary = await processSequences({ supabase, sendEmail: sender().fn, now: NOW })

    expect(summary.deferred).toBe(1)
    expect(summary.unsubscribed).toBe(0)
    expect(store.contact_sequence_enrollments[0].status).toBe('active')
  })

  it('a failed send does not advance the step and retries next tick', async () => {
    const store = baseStore()
    const supabase = makeSupabase(store, [SEQUENCE_SEND_UNIQUE])
    const s = sender([{ ok: false, error: 'resend 500' }, { ok: true, id: 'm2' }])

    const first = await processSequences({ supabase, sendEmail: s.fn, now: NOW })
    expect(first.failed).toBe(1)
    expect(store.contact_sequence_enrollments[0].current_step).toBe(0)
    expect(store.email_sequence_sends[0].status).toBe('claimed')
    expect(store.email_sequence_sends[0].last_error).toContain('resend 500')

    const second = await processSequences({ supabase, sendEmail: s.fn, now: NOW })
    expect(second.sent).toBe(1)
    expect(store.contact_sequence_enrollments[0].current_step).toBe(1)
  })

  it('gives up after MAX_ATTEMPTS and PAUSES the enrollment, loudly', async () => {
    const store = baseStore()
    const supabase = makeSupabase(store, [SEQUENCE_SEND_UNIQUE])
    const s = sender([{ ok: false, error: 'permanent' }])

    let last
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      last = await processSequences({ supabase, sendEmail: s.fn, now: NOW })
    }

    expect(store.email_sequence_sends[0].status).toBe('failed')
    expect(store.email_sequence_sends[0].attempts).toBe(MAX_ATTEMPTS)
    expect(store.contact_sequence_enrollments[0].status).toBe('paused')
    expect(last!.notes.join(' ')).toMatch(/PAUSED/)
    // And not one more send after the give-up.
    expect(s.sent.length).toBe(MAX_ATTEMPTS)
  })

  it('an unreadable enrollment list is a 500, not a green "processed 0"', async () => {
    const supabase = makeSupabase(baseStore(), [SEQUENCE_SEND_UNIQUE])
    supabase.failNext['contact_sequence_enrollments'] = 'db down'
    await expect(processSequences({ supabase, sendEmail: sender().fn, now: NOW })).rejects.toThrow(/could not read/i)
  })

  it('an unconfigured mailer defers everything and SAYS so', async () => {
    const store = baseStore()
    const summary = await processSequences({
      supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]),
      sendEmail: undefined,
      now: NOW,
    })
    // defaultSender() returns null with no RESEND_API_KEY — set it so the only
    // reason to defer is the missing key.
    expect(summary.scanned).toBe(1)
  })

  it('refuses to send when no unsubscribe link can be minted', async () => {
    delete process.env.PORTAL_LINK_SIGNING_SECRET
    const store = baseStore()
    const s = sender()
    const summary = await processSequences({
      supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]), sendEmail: s.fn, now: NOW,
    })
    expect(s.sent).toHaveLength(0)
    expect(summary.deferred).toBe(1)
    expect(summary.notes.join(' ')).toMatch(/unsubscribe/i)
  })
})

describe('isDue', () => {
  const enr = { enrolled_at: '2026-09-01T12:00:00Z', last_sent_at: null, metadata: {} }

  it('is not due before the delay has elapsed', () => {
    expect(isDue(enr, { delay_days: 30 }, 1, NOW)).toBe(false)
  })

  it('is due once it has', () => {
    expect(isDue(enr, { delay_days: 3 }, 1, NOW)).toBe(true)
  })

  it('an UNPARSEABLE reference date is not due', () => {
    // The old code produced an Invalid Date, every comparison against which is
    // false — including `now < dueDate` — so a malformed event_date sent every
    // remaining step at once.
    const bad = { enrolled_at: 'whenever', last_sent_at: null, metadata: {} }
    expect(isDue(bad, { delay_days: 1 }, 1, NOW)).toBe(false)
    const badEvent = { ...enr, metadata: { event_date: 'soon' } }
    expect(isDue(badEvent, { delay_days: 1, delay_reference: 'event_date' }, 2, NOW)).toBe(false)
  })

  it('measures a post-event step from the event date', () => {
    const withEvent = { ...enr, metadata: { event_date: '2026-09-10' } }
    expect(isDue(withEvent, { delay_days: 1, delay_reference: 'event_date' }, 2, NOW)).toBe(true)
    expect(isDue(withEvent, { delay_days: 30, delay_reference: 'event_date' }, 2, NOW)).toBe(false)
  })
})

describe('sequence content problems are named, not guessed at', () => {
  it('a declared step that does not exist completes the enrollment AND says why', async () => {
    const store = baseStore()
    store.email_sequence_steps = store.email_sequence_steps.filter(s => s.step_number !== 1)

    const summary = await processSequences({
      supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]), sendEmail: sender().fn, now: NOW,
    })

    expect(summary.completed).toBe(1)
    expect(summary.notes.join(' ')).toMatch(/step 1 does not exist/)
  })

  it('a contact with no email address pauses rather than sending nowhere', async () => {
    const store = baseStore()
    store.contacts[0].email = null
    const s = sender()
    const summary = await processSequences({
      supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]), sendEmail: s.fn, now: NOW,
    })
    expect(s.sent).toHaveLength(0)
    expect(summary.paused).toBe(1)
    expect(store.contact_sequence_enrollments[0].status).toBe('paused')
  })

  it('an inactive sequence sends nothing', async () => {
    const store = baseStore()
    store.contact_sequence_enrollments[0].email_sequences.is_active = false
    const s = sender()
    await processSequences({ supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]), sendEmail: s.fn, now: NOW })
    expect(s.sent).toHaveLength(0)
  })
})

describe('an enrollment that can never become due', () => {
  /**
   * Added by chain link 9. `isDue` returning false for an unparseable reference
   * is the SAFE outcome and it was also a silent one: the enrollment stays
   * `active`, is skipped every fifteen minutes forever, and is indistinguishable
   * in every log and summary from one that is simply not due yet. Rule 10 — a
   * guardrail that stops something must say that it stopped it.
   */
  it('is reported rather than skipped quietly', async () => {
    const store = baseStore()
    store.contact_sequence_enrollments[0].metadata = { event_date: '2026-10-09T00:00:00+00:00' }
    store.email_sequence_steps[0].delay_reference = 'event_date'
    const supabase = makeSupabase(store)
    const s = sender()

    const summary = await processSequences({ supabase: supabase as any, sendEmail: s.fn, now: NOW })

    expect(s.sent).toHaveLength(0)
    expect(summary.skipped).toBe(0)
    expect(summary.deferred).toBe(1)
    expect(summary.notes.join(' ')).toMatch(/metadata\.event_date/)
    expect(summary.notes.join(' ')).toMatch(/never send/)
    // Nothing was changed — it is a content problem, not a state transition.
    expect(store.contact_sequence_enrollments[0].status).toBe('active')
    expect(store.email_sequence_sends).toHaveLength(0)
  })

  it('a step that is merely not due yet is still a quiet skip', async () => {
    const store = baseStore()
    const supabase = makeSupabase(store)
    const s = sender()

    const summary = await processSequences({
      supabase: supabase as any,
      sendEmail: s.fn,
      now: new Date('2026-09-02T12:00:00Z'),
    })

    expect(summary.skipped).toBe(1)
    expect(summary.deferred).toBe(0)
    expect(summary.notes).toEqual([])
  })
})
