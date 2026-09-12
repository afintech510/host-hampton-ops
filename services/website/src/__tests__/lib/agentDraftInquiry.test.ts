/**
 * Tests for the booking-agent draft node (lib/agent/draftInquiry.ts) with a
 * mocked Claude.
 *
 * The four properties that matter are the four hard rules:
 *   - the model's JSON becomes exactly one inquiry_drafts row in the expected shape;
 *   - Allie introduces herself on the first message of a plan and never again;
 *   - an info-gather draft carries no dollar amount, and a model that insists
 *     gets parked instead of texted out;
 *   - nothing is ever sent to the customer here.
 */

const mockNotifyOwnerSms = jest.fn().mockResolvedValue(1)
jest.mock('@/lib/ownerNotify', () => ({
  notifyOwnerSms: (...args: any[]) => mockNotifyOwnerSms(...args),
  reviewerPhones: () => ['+16315550100'],
}))

class BudgetExceededError extends Error {
  constructor() {
    super('llm budget exceeded for 2026-09: 25 / 25')
    this.name = 'BudgetExceededError'
  }
}
jest.mock('@/lib/marketing/budget', () => ({
  BudgetExceededError,
  assertLlmBudget: jest.fn().mockResolvedValue({ ok: true, spent: 0, cap: 25, remaining: 25 }),
  recordLlmSpend: jest.fn().mockResolvedValue(0.02),
}))

jest.mock('@/lib/marketing/graph', () => ({ writeLedger: jest.fn().mockResolvedValue(undefined) }))

jest.mock('@/lib/agent/voice', () => ({
  loadVoiceProfile: jest.fn().mockResolvedValue({ profile: null, dropped: [], unavailable: null }),
  voicePromptAddendum: () => '',
}))

// The learned-rules layer moved out of voice.ts in Phase 6. Mocked as "no
// learnings", which is what a database without migration 041 gives — the
// screen and the fence have their own suite (agentLearnings.test.ts) where the
// REAL functions are exercised rather than stubbed.
jest.mock('@/lib/agent/learnings', () => ({
  ...jest.requireActual('@/lib/agent/learnings'),
  loadActiveLearnings: jest.fn().mockResolvedValue({ learnings: [], unavailable: null, rejected: [] }),
}))

import { draftForInquiry, containsMoney, applySignatureRule, inquiryFromEvent } from '@/lib/agent/draftInquiry'
import { assertLlmBudget, recordLlmSpend } from '@/lib/marketing/budget'
import { writeLedger } from '@/lib/marketing/graph'

/* ── Supabase double ─────────────────────────────────────────────────── */

interface SupaOpts {
  contactId?: string | null
  /** Rows returned by the "is there a live draft" query. */
  liveDrafts?: unknown[]
  /** Rows returned by the "has anything already been sent" query. */
  sentDrafts?: unknown[]
  /** Rows returned by the "has a human replied on this plan" query. */
  outbound?: unknown[]
  insertError?: { code?: string; message?: string } | null
}

function makeSupabase(opts: SupaOpts = {}) {
  const inserted: Record<string, unknown>[] = []

  function resolve(table: string, ops: [string, ...unknown[]][]) {
    const has = (name: string, ...args: unknown[]) =>
      ops.some(o => o[0] === name && args.every((a, i) => o[i + 1] === a))

    if (table === 'contacts') {
      return { data: opts.contactId ? { id: opts.contactId } : null, error: null }
    }
    if (table === 'inquiry_drafts') {
      const insertOp = ops.find(o => o[0] === 'insert')
      if (insertOp) {
        if (opts.insertError) return { data: null, error: opts.insertError }
        return { data: { id: 'draft-uuid-1' }, error: null }
      }
      if (has('not', 'status', 'in')) return { data: opts.liveDrafts ?? [], error: null }
      if (has('eq', 'status', 'sent')) return { data: opts.sentDrafts ?? [], error: null }
    }
    if (table === 'ingested_messages') return { data: opts.outbound ?? [], error: null }
    return { data: null, error: null }
  }

  const from = jest.fn((table: string) => {
    const ops: [string, ...unknown[]][] = []
    const chain: any = {
      then: (res: any, rej: any) => Promise.resolve(resolve(table, ops)).then(res, rej),
    }
    for (const m of ['select', 'eq', 'not', 'in', 'order', 'gte', 'limit', 'single', 'maybeSingle', 'update']) {
      chain[m] = jest.fn((...args: unknown[]) => {
        ops.push([m, ...args])
        return chain
      })
    }
    chain.insert = jest.fn((row: Record<string, unknown>) => {
      ops.push(['insert', row])
      inserted.push(row)
      return chain
    })
    return chain
  })

  return { supabase: { from } as any, inserted }
}

/* ── Claude double ───────────────────────────────────────────────────── */

const INFO_GATHER_REPLY = {
  emailSubject: 'A few details and we can get your party on the books',
  emailDraft:
    "Hi Jess! This is Allie from Host Hampton — so glad you reached out about a mobile party for Bella.\n\nTo put real numbers together I just need a few things: the address where we'd be setting up, what time you'd like us to start, and roughly how many kids you're expecting. Once I have those I can get you a full plan.\n\nIf it's easier to talk it through, text me back on this number and we'll find a time for a quick chat.",
  smsDraft:
    "Hi Jess! This is Allie from Host Hampton. To plan Bella's mobile party I just need the address, a start time and a rough guest count — text me back here and I'll take it from there.",
  summaryForReviewer: 'Mobile party lead, Bella — asking for address, time and guest count.',
}

function anthropicReply(body: Record<string, unknown>, tokens = { input_tokens: 2000, output_tokens: 1000 }) {
  return {
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: JSON.stringify(body) }], usage: tokens }),
  }
}

/**
 * What current models ACTUALLY return: adaptive thinking is on by default, so a
 * `thinking` block comes first, and because `display` defaults to 'omitted' its
 * text is empty. Reading content[0] broke every draft in production with
 * "Anthropic response did not contain JSON".
 */
function anthropicReplyWithThinking(
  body: Record<string, unknown>,
  tokens = { input_tokens: 2000, output_tokens: 1000 },
) {
  return {
    ok: true,
    json: async () => ({
      content: [
        { type: 'thinking', thinking: '', text: '' },
        { type: 'text', text: JSON.stringify(body) },
      ],
      stop_reason: 'end_turn',
      usage: tokens,
    }),
  }
}

const EVENT = {
  id: 'event-uuid-1',
  source: 'website_form',
  external_id: 'website_form:mobile-party-inquiry:contact-1:1',
  direction: 'in',
  from_address: 'jess@example.com',
  to_address: null,
  subject: 'Mobile party inquiry — Jess Vaughn',
  body: 'Hair tinsel and slime for my daughter Bella',
  parsed: {
    route: 'mobile-party-inquiry',
    name: 'Jess Vaughn',
    email: 'jess@example.com',
    phone: '+16315550123',
    eventType: 'mobile party',
    date: '2026-11-14',
    details: 'Hair tinsel and slime for my daughter Bella',
  },
  contact_id: 'contact-1',
  booking_id: null,
  status: 'claimed',
  classification: null,
  created_at: new Date().toISOString(),
}

describe('draftForInquiry', () => {
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
    ;(assertLlmBudget as jest.Mock).mockResolvedValue({ ok: true, spent: 0, cap: 25, remaining: 25 })
  })
  afterAll(() => {
    process.env = originalEnv
    global.fetch = originalFetch
  })

  it('turns the model JSON into one sent_for_review draft and texts the reviewers', async () => {
    const { supabase, inserted } = makeSupabase({ contactId: 'contact-1' })
    global.fetch = jest.fn().mockResolvedValue(anthropicReply(INFO_GATHER_REPLY)) as any

    const outcome = await draftForInquiry({ supabase, event: EVENT as any })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.draftStatus).toBe('sent_for_review')
    expect(outcome.path).toBe('info_gather')
    expect(outcome.partyType).toBe('mobile_party')
    expect(outcome.reviewCode).toMatch(/^HH-\d{4}-\d{4}$/)

    // Exactly one draft row, in the expected shape.
    expect(inserted).toHaveLength(1)
    const row = inserted[0]
    expect(row).toMatchObject({
      inbound_event_id: 'event-uuid-1',
      contact_id: 'contact-1',
      booking_id: null,
      party_type: 'mobile_party',
      contact_path: 'info_gather',
      draft_kind: 'info_gather',
      channel: 'both',
      status: 'sent_for_review',
      subject: INFO_GATHER_REPLY.emailSubject,
      error: null,
    })
    expect(row.missing_fields).toEqual(expect.arrayContaining(['party_time', 'guest_count', 'venue_address']))
    // Only the hash is stored; the raw token is never persisted.
    expect(typeof row.preview_token_hash).toBe('string')
    expect(String(row.preview_token_hash)).toHaveLength(64)
    expect(JSON.stringify(row)).not.toContain('https://www.hosthampton.com/review/')

    // Reviewer SMS carries the code and a working preview link.
    expect(mockNotifyOwnerSms).toHaveBeenCalledTimes(1)
    const sms = mockNotifyOwnerSms.mock.calls[0][0] as string
    expect(sms).toContain(outcome.reviewCode)
    expect(sms).toContain('https://www.hosthampton.com/review/')
    expect(sms).toContain('Nothing has gone to the customer.')
    // The reply commands the Phase 2 review loop understands.
    expect(sms).toContain('Reply SEND')
    expect(sms).toContain('CANCEL')
    expect(sms).toContain('TEST')

    // Spend recorded against the real token counts.
    expect(recordLlmSpend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tokens: 3000, entityType: 'inquiry_draft', entityId: 'draft-uuid-1' }),
    )
    expect(writeLedger).toHaveBeenCalled()

    // The ONLY outbound HTTP call is to Anthropic — nothing to a customer.
    const urls = (global.fetch as jest.Mock).mock.calls.map(c => c[0])
    expect(urls).toEqual(['https://api.anthropic.com/v1/messages'])
  })

  it('keeps the Allie introduction on a first message', async () => {
    const { supabase, inserted } = makeSupabase({ contactId: 'contact-1' })
    global.fetch = jest.fn().mockResolvedValue(anthropicReply(INFO_GATHER_REPLY)) as any

    await draftForInquiry({ supabase, event: EVENT as any })

    expect(String(inserted[0].email_draft)).toContain('Allie from Host Hampton')
    expect(String(inserted[0].sms_draft)).toContain('Allie from Host Hampton')
    // The prompt told the model this is the first message.
    const prompt = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).messages[0].content
    expect(prompt).toContain('FIRST message')
  })

  it('strips a re-introduction once something has already been sent on the plan', async () => {
    // A prior `sent` draft for this contact means Allie has already written.
    const { supabase, inserted } = makeSupabase({ contactId: 'contact-1', sentDrafts: [{ id: 'old-draft' }] })
    global.fetch = jest.fn().mockResolvedValue(anthropicReply(INFO_GATHER_REPLY)) as any

    await draftForInquiry({ supabase, event: EVENT as any })

    const email = String(inserted[0].email_draft)
    const sms = String(inserted[0].sms_draft)
    expect(email).not.toContain('Allie from Host Hampton')
    expect(sms).not.toContain('Allie from Host Hampton')
    // She is still identified — the rule drops the intro, not the signature.
    expect(email).toMatch(/allie/i)
    expect(sms).toMatch(/allie/i)

    const prompt = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).messages[0].content
    expect(prompt).toContain('NOT the first message')
  })

  it('retries once when an info-gather draft quotes a price', async () => {
    const { supabase, inserted } = makeSupabase({ contactId: 'contact-1' })
    const priced = { ...INFO_GATHER_REPLY, emailDraft: INFO_GATHER_REPLY.emailDraft + '\n\nParties start at $950.' }
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(anthropicReply(priced))
      .mockResolvedValueOnce(anthropicReply(INFO_GATHER_REPLY)) as any

    const outcome = await draftForInquiry({ supabase, event: EVENT as any })

    expect(global.fetch).toHaveBeenCalledTimes(2)
    const retryPrompt = JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body).messages[0].content
    expect(retryPrompt).toContain('CORRECTION')
    expect(outcome.ok && outcome.draftStatus).toBe('sent_for_review')
    expect(String(inserted[0].email_draft)).not.toContain('$950')
    // Both calls are billed.
    expect((recordLlmSpend as jest.Mock).mock.calls[0][1].tokens).toBe(6000)
  })

  it('parks the draft instead of texting it when pricing survives the retry', async () => {
    const { supabase, inserted } = makeSupabase({ contactId: 'contact-1' })
    const priced = { ...INFO_GATHER_REPLY, smsDraft: 'Weekend rates start at $575 for 3 hrs — Allie' }
    global.fetch = jest.fn().mockResolvedValue(anthropicReply(priced)) as any

    const outcome = await draftForInquiry({ supabase, event: EVENT as any })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.draftStatus).toBe('drafted')
    expect(inserted[0].status).toBe('drafted')
    expect(String(inserted[0].error)).toContain('pricing_in_info_gather')

    // A rule-breaking draft is never presented FOR APPROVAL — but it is no
    // longer silent. Parking used to text nobody, and the 2-hour nudge only
    // watches `sent_for_review`, so a held draft was never mentioned again by
    // anything. That is how a real lead (Eleonore, 2026-09-11) sat unanswered:
    // to Adam, a held draft and no lead at all looked identical.
    const alert = mockNotifyOwnerSms.mock.calls[0][0] as string
    expect(alert).toMatch(/DRAFT HELD/)
    expect(alert).toContain('pricing_in_info_gather')
    // No approve-by-reflex affordance, and the offending text is not quoted.
    expect(alert).not.toMatch(/Reply SEND/)
    expect(alert).not.toContain('$575')
  })

  it('skips when a live draft already exists for the event (no model call)', async () => {
    const { supabase, inserted } = makeSupabase({ liveDrafts: [{ id: 'draft-existing' }] })
    global.fetch = jest.fn() as any

    const outcome = await draftForInquiry({ supabase, event: EVENT as any })

    expect(outcome).toMatchObject({ ok: false, status: 409, skipped: true })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(0)
    expect(mockNotifyOwnerSms).not.toHaveBeenCalled()
  })

  it('refuses when the LLM budget is exhausted — no model call, no row, no SMS', async () => {
    const { supabase, inserted } = makeSupabase({})
    ;(assertLlmBudget as jest.Mock).mockRejectedValueOnce(new BudgetExceededError())
    global.fetch = jest.fn() as any

    const outcome = await draftForInquiry({ supabase, event: EVENT as any })

    expect(outcome).toMatchObject({ ok: false, status: 402 })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(0)
    expect(recordLlmSpend).not.toHaveBeenCalled()
    expect(mockNotifyOwnerSms).not.toHaveBeenCalled()
  })

  it('returns 503 without an Anthropic key, before touching the budget', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { supabase } = makeSupabase({})
    const outcome = await draftForInquiry({ supabase, event: EVENT as any })
    expect(outcome).toMatchObject({ ok: false, status: 503 })
    expect(assertLlmBudget).not.toHaveBeenCalled()
  })

  it('takes the quote path when a booking has everything required', async () => {
    const { supabase, inserted } = makeSupabase({ contactId: 'contact-9' })
    global.fetch = jest.fn().mockResolvedValue(
      anthropicReply({
        ...INFO_GATHER_REPLY,
        emailSubject: 'Your studio rental on Oct 3',
        emailDraft: 'Hi Holly! This is Allie from Host Hampton. The $250 deposit books the date. — Allie',
      }),
    ) as any

    const outcome = await draftForInquiry({
      supabase,
      booking: {
        id: 'booking-1',
        booking_ref: 'HH-2026-8242',
        event_type: 'studio-rental',
        contact_name: 'Holly G',
        contact_email: 'holly@example.com',
        contact_phone: '+16315550111',
        party_date: '2026-10-03',
        party_time: '11:00-2:00',
        guest_count_approx: 30,
      },
    })

    expect(outcome.ok && outcome.path).toBe('quote')
    expect(inserted[0]).toMatchObject({ booking_id: 'booking-1', party_type: 'studio_rental', contact_path: 'quote' })
    // The quote path may state the deposit — the money guardrail is info-gather only.
    expect(String(inserted[0].email_draft)).toContain('$250')
  })
})

describe('the Anthropic response shape', () => {
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
    ;(assertLlmBudget as jest.Mock).mockResolvedValue({ ok: true, spent: 0, cap: 25, remaining: 25 })
  })
  afterEach(() => { global.fetch = originalFetch })
  afterAll(() => { process.env = originalEnv })

  it('reads the first TEXT block, not content[0] — a leading thinking block is normal', async () => {
    const { supabase } = makeSupabase()
    global.fetch = jest.fn().mockResolvedValue(anthropicReplyWithThinking(INFO_GATHER_REPLY)) as any

    const outcome = await draftForInquiry({ supabase, event: EVENT as any })

    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.draftStatus).toBe('sent_for_review')
  })

  it('asks the API to enforce the JSON shape rather than requesting it politely', async () => {
    const { supabase } = makeSupabase()
    global.fetch = jest.fn().mockResolvedValue(anthropicReply(INFO_GATHER_REPLY)) as any

    await draftForInquiry({ supabase, event: EVENT as any })

    const req = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(req.output_config.format.type).toBe('json_schema')
    expect(req.output_config.format.schema.required).toEqual(
      expect.arrayContaining(['emailSubject', 'emailDraft', 'smsDraft', 'summaryForReviewer']),
    )
    // Room for thinking tokens as well as the answer.
    expect(req.max_tokens).toBeGreaterThanOrEqual(4000)
  })

  it('fails with a diagnosable message when there is no text block at all', async () => {
    const { supabase } = makeSupabase()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'thinking', text: '' }], stop_reason: 'max_tokens', usage: {} }),
    }) as any

    const outcome = await draftForInquiry({ supabase, event: EVENT as any })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.status).toBe(502)
  })
})

describe('guardrail helpers', () => {
  it('containsMoney catches the shapes a draft actually uses', () => {
    expect(containsMoney('starts at $575')).toBe(true)
    expect(containsMoney('$1,250 total')).toBe(true)
    expect(containsMoney('250 dollars')).toBe(true)
    expect(containsMoney('about 30 guests on the 14th')).toBe(false)
    expect(containsMoney('no pricing here at all')).toBe(false)
  })

  it('containsMoney catches prices with no dollar sign', () => {
    // These all slipped through the first implementation.
    expect(containsMoney('575 for three hours')).toBe(true)
    expect(containsMoney('the rate is 575')).toBe(true)
    expect(containsMoney('5 hundred to hold the date')).toBe(true)
    expect(containsMoney('five hundred to hold the date')).toBe(true)
    expect(containsMoney('the deposit is 250')).toBe(true)
    expect(containsMoney('1,200 total')).toBe(true)
    expect(containsMoney('it runs about 45 per guest')).toBe(true)
  })

  it('containsMoney leaves ordinary info-gather language alone', () => {
    expect(containsMoney('Could you let me know how many guests? We had 18 last time.')).toBe(false)
    expect(containsMoney('Does 2pm on October 3 work, for about 12 kids ages 7-9?')).toBe(false)
    expect(containsMoney('We are at 31 Mill Road, Speonk NY 11972')).toBe(false)
    expect(containsMoney('Text me back on 631-998-9325 any time')).toBe(false)
    expect(containsMoney('We have been doing this since 2019')).toBe(false)
    expect(containsMoney('a 3 hour window works best')).toBe(false)
  })

  it('applySignatureRule always leaves Allie named', () => {
    expect(applySignatureRule('Thanks so much!', { isFirstTouch: true, channel: 'email' })).toContain('Allie')
    expect(applySignatureRule('Thanks so much!', { isFirstTouch: false, channel: 'sms' })).toContain('Allie')
  })

  it('applySignatureRule only strips the intro on later messages', () => {
    const withIntro = "Hi Jess! I'm Allie from Host Hampton. Your date is open."
    expect(applySignatureRule(withIntro, { isFirstTouch: true, channel: 'sms' })).toBe(withIntro)
    const later = applySignatureRule(withIntro, { isFirstTouch: false, channel: 'sms' })
    expect(later).not.toContain('Allie from Host Hampton')
    expect(later).toContain('Allie')
  })

  it('applySignatureRule does not leave a mangled sentence behind', () => {
    // The intro is a clause, not a whole sentence: stripping the phrase alone
    // used to yield "and I'd love to help with your slime party."
    const out = applySignatureRule("I'm Allie from Host Hampton and I'd love to help with your slime party.", {
      isFirstTouch: false,
      channel: 'email',
    })
    expect(out).not.toMatch(/^\s*(?:and|but|so)\b/i)
    expect(out).not.toMatch(/^\s*[,;:—-]/)
    expect(out).toMatch(/^I'd love to help/)
    expect(out).toContain('Allie')
  })
})

describe('inquiryFromEvent', () => {
  it('maps a website-form payload onto the bookings-shaped view', () => {
    const inquiry = inquiryFromEvent(EVENT as any)
    expect(inquiry).toMatchObject({
      contact_name: 'Jess Vaughn',
      contact_email: 'jess@example.com',
      contact_phone: '+16315550123',
      party_date: '2026-11-14',
      event_type: 'mobile party',
    })
    expect(inquiry.guest_count_approx).toBeNull()
    expect(inquiry.notes).toContain('Hair tinsel')
  })
})
