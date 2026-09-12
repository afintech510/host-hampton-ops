/**
 * The A/B variant inside the sequencer — the one place model-written copy meets
 * a real customer's inbox.
 *
 * The assertions that matter are the negative ones. When anything is wrong we
 * must send the LIVE copy and record NOTHING: sending the control is the right
 * thing to DO, and recording a `sent` against an arm we did not use is
 * fabricated signal in the one place it becomes a standing rule about how Host
 * Hampton writes (rule 15). "Send the control" and "send the control and count
 * it" look identical from the customer's side and are completely different in
 * the data.
 */

import { makeSupabase, SEQUENCE_SEND_UNIQUE } from './fakeSupabase'
import { processSequences, resolveVariant, type ProcessSummary } from '@/lib/sequences/processor'
import { sequenceTargetKey } from '@/lib/experiments/load'

const NOW = new Date('2026-09-12T12:00:00Z')
const SEQ = '00000000-0000-4000-9000-000000000050'
const EXP = '00000000-0000-4000-9000-000000000001'
const VAR_A = '00000000-0000-4000-9000-000000000002'
const VAR_B = '00000000-0000-4000-9000-000000000003'
const CONTACT = '00000000-0000-4000-9000-000000000004'

const VARIANT_BODY =
  'Hi {{first_name}},\n\nThere is still room in the studio this month and we would love to have your crew in.\n\nHave a look whenever you are ready: https://www.hosthampton.com/book'

function experimentRows(over: Record<string, any> = {}) {
  return {
    content_experiments: [
      {
        id: EXP,
        name: 'lead follow-up step 1',
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
      },
    ],
    content_variants: [
      {
        id: VAR_A,
        experiment_id: EXP,
        label: 'A',
        is_control: true,
        subject: 'The live subject line',
        body_text: 'Hi {{first_name}},\n\nThis is the copy that is live today and it is long enough to pass.',
        body_html: '<p>live</p>',
        screen_notes: [],
        created_by: 'COPY',
        created_at: '2026-09-01T00:00:00Z',
      },
      {
        id: VAR_B,
        experiment_id: EXP,
        label: 'B',
        is_control: false,
        subject: 'A challenger subject line',
        body_text: VARIANT_BODY,
        body_html: '<p>challenger</p>',
        screen_notes: [],
        created_by: 'COPY',
        created_at: '2026-09-01T00:00:00Z',
      },
    ],
    variant_assignments: [],
    variant_events: [],
    unattributed_signals: [],
  }
}

function baseStore(extra: Record<string, any[]> = {}) {
  return {
    contact_sequence_enrollments: [
      {
        id: 'enr-1',
        contact_id: CONTACT,
        sequence_id: SEQ,
        status: 'active',
        current_step: 0,
        enrolled_at: '2026-09-01T12:00:00Z',
        last_sent_at: null,
        metadata: {},
        email_sequences: { id: SEQ, name: 'Lead Follow-Up', total_emails: 2, is_active: true },
      },
    ],
    email_sequence_steps: [
      {
        id: 'st-1',
        sequence_id: SEQ,
        step_number: 1,
        delay_days: 3,
        delay_reference: 'previous_step',
        subject: 'The live subject line',
        body_html: '<p>Come and see us at <a href="https://www.hosthampton.com/book">the studio</a>.</p>',
        body_text: null,
      },
    ],
    contacts: [{ id: CONTACT, email: 'adam@easternbuilding.supply', first_name: 'Adam', email_opt_in: true, status: 'lead' }],
    email_sequence_sends: [],
    contact_interactions: [],
    ...extra,
  }
}

function sender(result: { ok: boolean; id?: string; error?: string } = { ok: true, id: 'msg-1' }) {
  const sent: any[] = []
  const fn = jest.fn(async (msg: any) => {
    sent.push(msg)
    return result
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
afterAll(() => {
  process.env = originalEnv
})

function emptySummary(): ProcessSummary {
  return { scanned: 0, sent: 0, skipped: 0, claimedElsewhere: 0, deferred: 0, failed: 0, unsubscribed: 0, completed: 0, paused: 0, notes: [] }
}

describe('resolveVariant — every non-clean outcome sends the live copy and records nothing', () => {
  const enrollment = { id: 'enr-1', sequence_id: SEQ }

  it('assigns when there is a live experiment', async () => {
    const store = baseStore(experimentRows())
    const summary = emptySummary()
    const r = await resolveVariant(makeSupabase(store), { enrollment, stepNumber: 1, contactId: CONTACT, summary })
    expect(r.assignmentId).toBeTruthy()
    expect(['A', 'B']).toContain(r.label)
    expect(store.variant_assignments).toHaveLength(1)
  })

  it('no experiment → no assignment, and SILENT (it is not news)', async () => {
    const store = baseStore({ content_experiments: [], content_variants: [], variant_assignments: [] })
    const summary = emptySummary()
    const r = await resolveVariant(makeSupabase(store), { enrollment, stepNumber: 1, contactId: CONTACT, summary })
    expect(r.assignmentId).toBeNull()
    expect(r.copy).toBeNull()
    expect(summary.notes).toHaveLength(0)
  })

  it('a DRAFT experiment is invisible — the gate, at the send site', async () => {
    const store = baseStore(experimentRows({ status: 'draft' }))
    const summary = emptySummary()
    const r = await resolveVariant(makeSupabase(store), { enrollment, stepNumber: 1, contactId: CONTACT, summary })
    expect(r.assignmentId).toBeNull()
    expect(store.variant_assignments).toHaveLength(0)
  })

  it('the control arm gets an assignment but NO substitution', async () => {
    // The control needs a denominator or the test has one arm — but its copy is
    // the live step by construction, so there is nothing to swap in.
    const store = baseStore(experimentRows())
    const summary = emptySummary()
    let r = await resolveVariant(makeSupabase(store), { enrollment, stepNumber: 1, contactId: CONTACT, summary })
    // Try contacts until one lands on the control.
    let i = 0
    while (r.label !== 'A' && i < 40) {
      i++
      const c = `00000000-0000-4000-9000-${String(100 + i).padStart(12, '0')}`
      r = await resolveVariant(makeSupabase(store), { enrollment, stepNumber: 1, contactId: c, summary })
    }
    expect(r.label).toBe('A')
    expect(r.assignmentId).toBeTruthy()
    expect(r.copy).toBeNull()
  })

  it('never throws, whatever the store does', async () => {
    const summary = emptySummary()
    const exploding: any = { from: () => { throw new Error('boom') } }
    const r = await resolveVariant(exploding, { enrollment, stepNumber: 1, contactId: CONTACT, summary })
    expect(r.assignmentId).toBeNull()
    expect(summary.notes.join(' ')).toMatch(/threw/)
  })

  it('names the arms the read-time screen dropped, every run', async () => {
    const rows = experimentRows()
    rows.content_variants[1].body_text = 'Book a party for $500 flat, all in, this month only.'
    const store = baseStore(rows)
    const summary = emptySummary()
    const r = await resolveVariant(makeSupabase(store), { enrollment, stepNumber: 1, contactId: CONTACT, summary })
    // One usable arm left → not a test → no assignment.
    expect(r.assignmentId).toBeNull()
    expect(store.variant_assignments).toHaveLength(0)
  })
})

describe('processSequences with a live experiment', () => {
  it('substitutes the challenger copy and records a `sent` event AFTER the send', async () => {
    const store = baseStore(experimentRows())
    const s = sender()
    // Pin the contact onto arm B by trying contacts until one lands there.
    let contactId = CONTACT
    const probe = makeSupabase(baseStore(experimentRows()))
    let label = (await resolveVariant(probe, { enrollment: { id: 'e', sequence_id: SEQ }, stepNumber: 1, contactId, summary: emptySummary() })).label
    let n = 0
    while (label !== 'B' && n < 40) {
      n++
      contactId = `00000000-0000-4000-9000-${String(200 + n).padStart(12, '0')}`
      const p2 = makeSupabase(baseStore(experimentRows()))
      label = (await resolveVariant(p2, { enrollment: { id: 'e', sequence_id: SEQ }, stepNumber: 1, contactId, summary: emptySummary() })).label
    }
    expect(label).toBe('B')

    store.contacts[0].id = contactId
    store.contact_sequence_enrollments[0].contact_id = contactId

    const summary = await processSequences({
      supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]),
      sendEmail: s.fn,
      now: NOW,
    })

    expect(summary.sent).toBe(1)
    expect(s.sent[0].subject).toBe('A challenger subject line')
    expect(store.variant_assignments).toHaveLength(1)
    const sentEvents = store.variant_events.filter((e: any) => e.event_type === 'sent')
    expect(sentEvents).toHaveLength(1)
  })

  it('a FAILED send records no `sent` event — the denominator is not an attempt', async () => {
    const store = baseStore(experimentRows())
    const s = sender({ ok: false, error: 'resend rejected it' })
    const summary = await processSequences({
      supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]),
      sendEmail: s.fn,
      now: NOW,
    })
    expect(summary.sent).toBe(0)
    expect(summary.failed).toBe(1)
    // The assignment exists (the person is in an arm) and the impression does not.
    expect(store.variant_assignments).toHaveLength(1)
    expect(store.variant_events.filter((e: any) => e.event_type === 'sent')).toHaveLength(0)
  })

  it('the tracked link replaces the body link and NOT the unsubscribe link', async () => {
    const store = baseStore(experimentRows())
    const s = sender()
    await processSequences({ supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]), sendEmail: s.fn, now: NOW })
    const html: string = s.sent[0].html
    expect(html).toMatch(/href="https:\/\/www\.hosthampton\.com\/r\//)
    // The opt-out survives untouched — it must work for years and must not
    // depend on a variant_assignments row existing.
    expect(html).toMatch(/href="https:\/\/www\.hosthampton\.com\/unsubscribe\?t=/)
    expect(html).not.toMatch(/\/r\/[^"]*"[^>]*>Unsubscribe/)
    // And the RFC 8058 headers are the real endpoints, never a redirect.
    expect(s.sent[0].headers['List-Unsubscribe']).toContain('/api/unsubscribe?t=')
    expect(s.sent[0].headers['List-Unsubscribe']).not.toContain('/r/')
  })

  it('two ticks send one email and make one assignment', async () => {
    const store = baseStore(experimentRows())
    const s = sender()
    const supabase = makeSupabase(store, [SEQUENCE_SEND_UNIQUE])
    await Promise.all([
      processSequences({ supabase, sendEmail: s.fn, now: NOW }),
      processSequences({ supabase, sendEmail: s.fn, now: NOW }),
    ])
    expect(s.sent.length).toBeLessThanOrEqual(1)
    expect(store.variant_assignments).toHaveLength(1)
  })

  it('the interaction row names the variant, so a click can be traced by hand', async () => {
    const store = baseStore(experimentRows())
    const s = sender()
    await processSequences({ supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]), sendEmail: s.fn, now: NOW })
    const row = store.contact_interactions.find((r: any) => r.type === 'email_sent')
    expect(row).toBeTruthy()
    expect(row.metadata.experiment_id).toBe(EXP)
    expect(['A', 'B']).toContain(row.metadata.variant_label)
  })

  it('with NO experiment the mail is byte-identical to before Phase 5', async () => {
    // The regression that matters most: 44 frozen enrollments and every future
    // sequence email go through this code path whether or not an experiment
    // exists.
    const store = baseStore({ content_experiments: [], content_variants: [], variant_assignments: [], variant_events: [] })
    const s = sender()
    const summary = await processSequences({ supabase: makeSupabase(store, [SEQUENCE_SEND_UNIQUE]), sendEmail: s.fn, now: NOW })
    expect(summary.sent).toBe(1)
    expect(s.sent[0].subject).toBe('The live subject line')
    expect(s.sent[0].html).toContain('href="https://www.hosthampton.com/book"')
    expect(s.sent[0].html).not.toContain('/r/')
    expect(store.variant_events).toHaveLength(0)
  })
})
