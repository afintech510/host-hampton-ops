/**
 * Tests for the draft node's plan awareness — Phase 4 item 6.
 *
 * Two behaviours, and the first is a bug fix with a visible symptom. Before
 * this, `draftForInquiry` built the inquiry from `event.parsed` ALONE even when
 * the event carried a `booking_id` — which every website form now sets — so a
 * customer who had already given us their date got asked for it again. The plan
 * held the answer and nothing read it.
 *
 * The second is the loop closing: when a reply arrives in prose, extraction
 * writes it onto the plan and the gate is re-run, so the next draft asks for
 * what is genuinely still missing rather than repeating itself.
 */

const mockNotifyOwnerSms = jest.fn().mockResolvedValue(1)
jest.mock('@/lib/ownerNotify', () => ({
  notifyOwnerSms: (...args: any[]) => mockNotifyOwnerSms(...args),
  reviewerPhones: () => ['+16315550100'],
}))

class BudgetExceededError extends Error {}
jest.mock('@/lib/marketing/budget', () => ({
  BudgetExceededError,
  assertLlmBudget: jest.fn().mockResolvedValue({ ok: true, spent: 0, cap: 25, remaining: 25 }),
  recordLlmSpend: jest.fn().mockResolvedValue(0.02),
}))
jest.mock('@/lib/marketing/graph', () => ({ writeLedger: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/agent/voice', () => ({
  loadVoiceProfile: jest.fn().mockResolvedValue(null),
  voicePromptAddendum: () => '',
  loadLearnings: jest.fn().mockResolvedValue([]),
  learningsPromptAddendum: () => '',
}))

const mockExtractPlanFields = jest.fn()
const mockApplyExtractedFields = jest.fn()
jest.mock('@/lib/agent/extractPlanFields', () => ({
  ...jest.requireActual('@/lib/agent/extractPlanFields'),
  extractPlanFields: (...a: any[]) => mockExtractPlanFields(...a),
  applyExtractedFields: (...a: any[]) => mockApplyExtractedFields(...a),
}))

import { draftForInquiry, mergeInquiry } from '@/lib/agent/draftInquiry'
import { writeLedger } from '@/lib/marketing/graph'

/* ── Doubles ─────────────────────────────────────────────────────────── */

interface SupaOpts {
  /** Successive rows the `bookings` select returns — one per loadPlan call. */
  planRows?: (Record<string, unknown> | null)[]
}

function makeSupabase(opts: SupaOpts = {}) {
  const inserted: Record<string, unknown>[] = []
  const planQueue = [...(opts.planRows ?? [])]
  let lastPlan: Record<string, unknown> | null = null

  function resolve(table: string, ops: [string, ...unknown[]][]) {
    if (table === 'bookings') {
      // Re-reads past the end of the queue keep returning the latest row, which
      // is what a real table does.
      if (planQueue.length) lastPlan = planQueue.shift() ?? null
      return { data: lastPlan, error: null }
    }
    if (table === 'contacts') return { data: { id: 'contact-1' }, error: null }
    if (table === 'inquiry_drafts') {
      if (ops.some(o => o[0] === 'insert')) return { data: { id: 'draft-uuid-1' }, error: null }
      return { data: [], error: null }
    }
    if (table === 'ingested_messages') return { data: [], error: null }
    return { data: null, error: null }
  }

  const from = jest.fn((table: string) => {
    const ops: [string, ...unknown[]][] = []
    const chain: any = { then: (res: any, rej: any) => Promise.resolve(resolve(table, ops)).then(res, rej) }
    for (const m of ['select', 'eq', 'not', 'in', 'order', 'gte', 'limit', 'single', 'maybeSingle', 'update']) {
      chain[m] = jest.fn((...args: unknown[]) => { ops.push([m, ...args]); return chain })
    }
    chain.insert = jest.fn((row: Record<string, unknown>) => {
      ops.push(['insert', row]); inserted.push(row); return chain
    })
    return chain
  })

  return { supabase: { from } as any, inserted }
}

const REPLY = {
  emailSubject: 'Your Host Hampton party',
  emailDraft: 'Hi Jess! Allie here. Sounds great — text me back on this number any time.',
  smsDraft: 'Hi Jess! Allie here. Sounds great — text back any time.',
  summaryForReviewer: 'Mobile party lead.',
}

function claudeOk(body: Record<string, unknown> = REPLY) {
  return {
    ok: true,
    json: async () => ({
      content: [{ type: 'thinking', thinking: '', text: '' }, { type: 'text', text: JSON.stringify(body) }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 2000, output_tokens: 600 },
    }),
  }
}

/** A Gmail reply: prose, no structured fields, anchored to a plan. */
function gmailReply(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-uuid-9',
    source: 'gmail',
    external_id: 'gmail:abc',
    direction: 'in',
    from_address: 'jess@example.com',
    to_address: null,
    subject: 'Re: your mobile party',
    body: 'March 14th works and we will have about 12 kids!',
    parsed: {},
    contact_id: 'contact-1',
    booking_id: 'bk-1',
    status: 'claimed',
    classification: 'customer_reply',
    classification_meta: null,
    created_at: new Date().toISOString(),
    ...overrides,
  } as any
}

/** A website form: everything already arrived structured in `parsed`. */
function websiteForm(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-uuid-1',
    source: 'website_form',
    external_id: 'website_form:mobile-party-inquiry:contact-1:1',
    direction: 'in',
    from_address: 'jess@example.com',
    subject: 'Mobile party inquiry',
    body: 'Hair tinsel and slime for Bella',
    parsed: {
      route: 'mobile-party-inquiry',
      name: 'Jess Vaughn',
      email: 'jess@example.com',
      phone: '+16315550123',
      eventType: 'mobile party',
    },
    contact_id: 'contact-1',
    booking_id: 'bk-1',
    status: 'claimed',
    classification: null,
    classification_meta: null,
    created_at: new Date().toISOString(),
    ...overrides,
  } as any
}

/** A plan with everything a mobile party needs to be quotable. */
const COMPLETE_MOBILE_PLAN = {
  id: 'bk-1',
  booking_ref: 'HH-2026-0500',
  event_type: 'mobile party',
  package_type: null,
  notes: 'Hair tinsel and slime for Bella',
  party_tags: { location_address: '41 Montauk Hwy, Speonk NY' },
  contact_name: 'Jess Vaughn',
  contact_email: 'jess@example.com',
  contact_phone: '+16315550123',
  party_date: '2026-11-14',
  party_time: '14:00',
  guest_count_approx: 12,
  child_name: 'Bella',
  child_age: 8,
}

/* ── mergeInquiry ────────────────────────────────────────────────────── */

describe('mergeInquiry', () => {
  const plan = {
    event_type: 'mobile party',
    notes: 'first message',
    party_tags: { location_address: '41 Montauk Hwy' },
    contact_name: 'Jess Vaughn',
    contact_email: 'jess@example.com',
    contact_phone: null,
    party_date: '2026-11-14',
    party_time: null,
    guest_count_approx: 12,
    child_name: 'Bella',
    child_age: null,
  }

  it('lets the PLAN win on every field it has', () => {
    const merged = mergeInquiry(plan, {
      contact_name: 'J',
      party_date: '2026-12-01',
      guest_count_approx: 40,
      child_name: 'Someone',
    })

    // The plan's values were either given by the customer or typed by Adam;
    // enrichPlan only ever fills blanks, so they are not guesses.
    expect(merged.contact_name).toBe('Jess Vaughn')
    expect(merged.party_date).toBe('2026-11-14')
    expect(merged.guest_count_approx).toBe(12)
    expect(merged.child_name).toBe('Bella')
  })

  it('lets the EVENT fill every gap the plan still has', () => {
    const merged = mergeInquiry(plan, {
      contact_phone: '+16315550123',
      party_time: '15:00',
      child_age: 8,
    })

    expect(merged.contact_phone).toBe('+16315550123')
    expect(merged.party_time).toBe('15:00')
    expect(merged.child_age).toBe(8)
  })

  it('treats an empty string and a zero guest count as gaps, not values', () => {
    const merged = mergeInquiry(
      { ...plan, contact_name: '   ', guest_count_approx: 0 },
      { contact_name: 'Jess', guest_count_approx: 12 },
    )
    expect(merged.contact_name).toBe('Jess')
    expect(merged.guest_count_approx).toBe(12)
  })

  it('keeps both sets of notes, oldest first', () => {
    const merged = mergeInquiry(plan, { notes: 'second message' })
    expect(merged.notes).toBe('first message\n\n---\nsecond message')
  })

  it('does not show the model the same message twice', () => {
    // enrichPlan appends an event's body to the plan's notes, so by the time we
    // draft, the "new" message is often already in there.
    const merged = mergeInquiry(
      { ...plan, notes: 'first message\n\n---\nsecond message' },
      { notes: 'second message' },
    )
    expect(merged.notes).toBe('first message\n\n---\nsecond message')
  })

  it('merges party_tags with the plan winning per key', () => {
    const merged = mergeInquiry(plan, {
      party_tags: { location_address: 'somewhere else', duration: '3 hours' },
    })
    expect(merged.party_tags).toEqual({ location_address: '41 Montauk Hwy', duration: '3 hours' })
  })
})

/* ── The draft node reads the plan ───────────────────────────────────── */

describe('draftForInquiry reads the plan, not just the message', () => {
  const originalEnv = process.env
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = {
      ...originalEnv,
      ANTHROPIC_API_KEY: 'sk-test',
      REVIEW_LINK_SIGNING_SECRET: 'review-secret',
      NEXT_PUBLIC_SITE_URL: 'https://www.hosthampton.com',
    }
    global.fetch = jest.fn().mockResolvedValue(claudeOk()) as any
    mockExtractPlanFields.mockResolvedValue({ ok: true, fields: {}, requestedDateText: null, costUsd: 0, tokens: 0, model: 'none' })
    mockApplyExtractedFields.mockResolvedValue({ updated: [] })
  })
  afterAll(() => { process.env = originalEnv; global.fetch = originalFetch })

  it('does not re-ask for details the plan already holds', async () => {
    // The event is a bare reply with no structured fields at all; everything is
    // on the plan. Before item 6 this produced an info-gather draft asking for
    // the date, time, guest count and address the customer had already given.
    const { supabase } = makeSupabase({ planRows: [COMPLETE_MOBILE_PLAN] })

    const outcome = await draftForInquiry({ supabase, event: gmailReply() })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.missing).toEqual([])
    expect(outcome.path).toBe('quote')
    expect(outcome.partyType).toBe('mobile_party')
  })

  it('still asks for what is genuinely missing', async () => {
    const { supabase } = makeSupabase({
      planRows: [{ ...COMPLETE_MOBILE_PLAN, party_time: null, guest_count_approx: null }],
    })

    const outcome = await draftForInquiry({ supabase, event: gmailReply() })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.missing.sort()).toEqual(['guest_count', 'party_time'])
    expect(outcome.path).toBe('info_gather')
  })

  it('puts the plan reference in the prompt when the caller passed no booking', async () => {
    const { supabase } = makeSupabase({ planRows: [COMPLETE_MOBILE_PLAN] })

    await draftForInquiry({ supabase, event: gmailReply() })

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.messages[0].content).toContain('HH-2026-0500')
  })

  it('drafts from the event alone when the plan cannot be read', async () => {
    // Non-fatal by design: drafting from half the picture beats not drafting.
    const { supabase } = makeSupabase({ planRows: [null] })

    const outcome = await draftForInquiry({ supabase, event: gmailReply() })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.missing.length).toBeGreaterThan(0)
  })
})

/* ── Extract and re-evaluate ─────────────────────────────────────────── */

describe('extract-and-re-evaluate', () => {
  const originalEnv = process.env
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = {
      ...originalEnv,
      ANTHROPIC_API_KEY: 'sk-test',
      REVIEW_LINK_SIGNING_SECRET: 'review-secret',
      NEXT_PUBLIC_SITE_URL: 'https://www.hosthampton.com',
    }
    global.fetch = jest.fn().mockResolvedValue(claudeOk()) as any
    mockExtractPlanFields.mockResolvedValue({ ok: true, fields: {}, requestedDateText: null, costUsd: 0, tokens: 0, model: 'none' })
    mockApplyExtractedFields.mockResolvedValue({ updated: [] })
  })
  afterAll(() => { process.env = originalEnv; global.fetch = originalFetch })

  const HALF_PLAN = { ...COMPLETE_MOBILE_PLAN, party_date: null, guest_count_approx: null }

  it('reads the reply, writes the answers onto the plan, and re-runs the gate', async () => {
    mockExtractPlanFields.mockResolvedValue({
      ok: true,
      fields: { party_date: '2026-03-14', guest_count: 12 },
      requestedDateText: null,
      costUsd: 0.001, tokens: 900, model: 'claude-haiku-4-5-20251001',
    })
    mockApplyExtractedFields.mockResolvedValue({ updated: ['party_date', 'guest_count'] })

    // First read is the half plan; after the write, the row has the answers.
    const { supabase } = makeSupabase({
      planRows: [HALF_PLAN, { ...HALF_PLAN, party_date: '2026-03-14', guest_count_approx: 12 }],
    })

    const outcome = await draftForInquiry({ supabase, event: gmailReply() })

    expect(mockExtractPlanFields).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'March 14th works and we will have about 12 kids!',
        missing: expect.arrayContaining(['party_date', 'guest_count']),
        bookingId: 'bk-1',
      }),
    )
    expect(mockApplyExtractedFields).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 'bk-1', sourceEventId: 'event-uuid-9' }),
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    // The loop closed: the gate no longer reports what the reply answered.
    expect(outcome.missing).toEqual([])
    expect(outcome.path).toBe('quote')
    expect(outcome.extractedFields).toEqual(['party_date', 'guest_count'])
  })

  it('records what the reply filled in, in the ledger', async () => {
    mockExtractPlanFields.mockResolvedValue({
      ok: true, fields: { party_date: '2026-03-14' }, requestedDateText: null,
      costUsd: 0.001, tokens: 900, model: 'haiku',
    })
    mockApplyExtractedFields.mockResolvedValue({ updated: ['party_date'] })
    const { supabase } = makeSupabase({ planRows: [HALF_PLAN, { ...HALF_PLAN, party_date: '2026-03-14' }] })

    await draftForInquiry({ supabase, event: gmailReply() })

    // The plan's history has to explain why the agent stopped asking.
    const note = (writeLedger as jest.Mock).mock.calls.find(c => c[1].meta?.job === 'draft_inquiry')
    expect(note[1].meta.extracted_fields).toEqual(['party_date'])
  })

  it('does NOT spend a call on a website form', async () => {
    // A form's fields arrived structured in `parsed` and ensureLeadPlan already
    // wrote them; extracting from its body would cost a call per lead to learn
    // nothing.
    const { supabase } = makeSupabase({ planRows: [HALF_PLAN] })

    await draftForInquiry({ supabase, event: websiteForm() })

    expect(mockExtractPlanFields).not.toHaveBeenCalled()
  })

  it('does NOT spend a call when nothing extractable is missing', async () => {
    const { supabase } = makeSupabase({ planRows: [COMPLETE_MOBILE_PLAN] })

    await draftForInquiry({ supabase, event: gmailReply() })

    expect(mockExtractPlanFields).not.toHaveBeenCalled()
  })

  it('does NOT spend a call when there is no plan to write to', async () => {
    const { supabase } = makeSupabase({ planRows: [null] })

    await draftForInquiry({ supabase, event: gmailReply({ booking_id: null }) })

    expect(mockExtractPlanFields).not.toHaveBeenCalled()
  })

  it('does NOT spend a call on an empty body', async () => {
    const { supabase } = makeSupabase({ planRows: [HALF_PLAN] })

    await draftForInquiry({ supabase, event: gmailReply({ body: '   ' }) })

    expect(mockExtractPlanFields).not.toHaveBeenCalled()
  })

  it('still drafts when extraction FAILED — a failure is not a verdict', async () => {
    mockExtractPlanFields.mockResolvedValue({ ok: false, status: 502, error: 'Anthropic error 500' })
    const { supabase } = makeSupabase({ planRows: [HALF_PLAN] })

    const outcome = await draftForInquiry({ supabase, event: gmailReply() })

    // The lead is not lost and nothing is written: we ask again with what we
    // have. The same rule that the draft node, triage and findOpenPlan each
    // learned the hard way.
    expect(mockApplyExtractedFields).not.toHaveBeenCalled()
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.extractedFields).toEqual([])
    expect(outcome.missing).toContain('party_date')
  })

  it('does not re-evaluate when the write changed nothing', async () => {
    mockExtractPlanFields.mockResolvedValue({
      ok: true, fields: { party_date: '2026-03-14' }, requestedDateText: null,
      costUsd: 0.001, tokens: 900, model: 'haiku',
    })
    // e.g. Adam typed the date in while the model was thinking.
    mockApplyExtractedFields.mockResolvedValue({ updated: [] })
    const { supabase } = makeSupabase({ planRows: [HALF_PLAN] })

    const outcome = await draftForInquiry({ supabase, event: gmailReply() })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.extractedFields).toEqual([])
  })

  it('tells the draft to narrow down a vague date instead of asking cold', async () => {
    mockExtractPlanFields.mockResolvedValue({
      ok: true, fields: {}, requestedDateText: 'mid-March', costUsd: 0.001, tokens: 900, model: 'haiku',
    })
    mockApplyExtractedFields.mockResolvedValue({ updated: ['requested_date_text'] })
    const { supabase } = makeSupabase({
      planRows: [
        HALF_PLAN,
        { ...HALF_PLAN, party_tags: { ...HALF_PLAN.party_tags, requested_date_text: 'mid-March' } },
      ],
    })

    await draftForInquiry({ supabase, event: gmailReply() })

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.messages[0].content).toContain('mid-March')
  })
})
