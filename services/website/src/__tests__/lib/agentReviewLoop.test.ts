/**
 * Tests for lib/agent/reviewLoop.ts — the SMS review loop.
 *
 * The test this file exists for is "a customer texting SEND does nothing".
 * Everything else (phrase parsing, draft resolution, the approve/cancel/test/
 * revise branches) is in service of trusting that one.
 */

const mockSendSMSViaQuo = jest.fn().mockResolvedValue('QUO1')
jest.mock('@/lib/quo', () => ({ sendSMSViaQuo: (...a: any[]) => mockSendSMSViaQuo(...a) }))

const mockAdvance = jest.fn().mockResolvedValue({ from: 'sent_for_review', to: 'approved' })
const mockWriteLedger = jest.fn().mockResolvedValue(undefined)
jest.mock('@/lib/marketing/graph', () => ({
  advance: (...a: any[]) => mockAdvance(...a),
  writeLedger: (...a: any[]) => mockWriteLedger(...a),
}))

const mockSendApprovedDraft = jest.fn()
jest.mock('@/lib/agent/sendApproved', () => ({
  sendApprovedDraft: (...a: any[]) => mockSendApprovedDraft(...a),
}))

const mockRedraft = jest.fn()
jest.mock('@/lib/agent/draftInquiry', () => ({
  redraftForReviewer: (...a: any[]) => mockRedraft(...a),
}))

import {
  handleReviewerReply,
  isReviewerPhone,
  parseReviewerReply,
  resolveDraft,
} from '@/lib/agent/reviewLoop'

const REVIEWER = '+16314008080'
const CUSTOMER = '+15165550000'

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-1',
    review_code: 'HH-2026-0042',
    status: 'sent_for_review',
    party_type: 'mobile_party',
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

/**
 * Minimal supabase double. `byCode` answers a review_code lookup; `open`
 * answers the "list open drafts" query.
 */
function makeSupabase(opts: { byCode?: any; open?: any[] } = {}) {
  const from = jest.fn(() => {
    const ops: string[] = []
    const chain: any = {
      then: (res: any, rej: any) => {
        const value = ops.includes('maybeSingle')
          ? { data: opts.byCode ?? null, error: null }
          : { data: opts.open ?? [], error: null }
        return Promise.resolve(value).then(res, rej)
      },
    }
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'update', 'maybeSingle', 'is', 'lt']) {
      chain[m] = jest.fn((...args: unknown[]) => {
        ops.push(m)
        return chain
      })
    }
    return chain
  })
  return { from } as any
}

describe('isReviewerPhone', () => {
  const originalEnv = process.env
  beforeEach(() => { process.env = { ...originalEnv, REVIEWER_PHONES: '+16314008080, 6315551111' } })
  afterAll(() => { process.env = originalEnv })

  it('matches a reviewer regardless of how the number is formatted', () => {
    expect(isReviewerPhone('+16314008080')).toBe(true)
    expect(isReviewerPhone('6314008080')).toBe(true)
    expect(isReviewerPhone('(631) 400-8080')).toBe(true)
    expect(isReviewerPhone('631-555-1111')).toBe(true)
  })

  it('rejects everyone else, including empty and malformed input', () => {
    expect(isReviewerPhone(CUSTOMER)).toBe(false)
    expect(isReviewerPhone('')).toBe(false)
    expect(isReviewerPhone(null)).toBe(false)
    expect(isReviewerPhone(undefined)).toBe(false)
    expect(isReviewerPhone('not a phone')).toBe(false)
    // A near-miss must not match.
    expect(isReviewerPhone('+16314008081')).toBe(false)
  })

  it('matches nobody when REVIEWER_PHONES is unset', () => {
    delete process.env.REVIEWER_PHONES
    expect(isReviewerPhone('+16314008080')).toBe(false)
  })
})

describe('parseReviewerReply', () => {
  it('recognises the approval phrases', () => {
    for (const t of ['SEND', 'send', 'Send it', 'SENDIT', 'approved', 'APPROVE', 'go', 'please send']) {
      expect(parseReviewerReply(t).intent).toBe('approve')
    }
  })

  it('does NOT approve on a sentence that merely contains "send"', () => {
    // This is the distinction the whole parser rests on.
    for (const t of [
      "don't send this yet",
      'send it after you fix the date',
      'can we send tomorrow?',
      'do not send',
      'hold off on sending',
    ]) {
      expect(parseReviewerReply(t).intent).toBe('revise')
    }
  })

  it('recognises cancel and test phrases', () => {
    for (const t of ['CANCEL', 'ignore', 'stop', 'no', 'drop it', 'dismiss']) {
      expect(parseReviewerReply(t).intent).toBe('cancel')
    }
    for (const t of ['TEST', 'test it', 'preview']) {
      expect(parseReviewerReply(t).intent).toBe('test')
    }
  })

  it('pulls out a full review code in any keyboard-friendly shape', () => {
    expect(parseReviewerReply('SEND HH-2026-0042').code).toBe('HH-2026-0042')
    expect(parseReviewerReply('send hh20260042').code).toBe('HH-2026-0042')
    expect(parseReviewerReply('approve HH 2026 0042').code).toBe('HH-2026-0042')
    // …and the intent survives the code being stripped out.
    expect(parseReviewerReply('SEND HH-2026-0042').intent).toBe('approve')
  })

  it('pulls out a short 4-digit code', () => {
    const p = parseReviewerReply('APPROVE 0042')
    expect(p.intent).toBe('approve')
    expect(p.shortCode).toBe('0042')
    expect(p.code).toBeNull()
  })

  it('treats "EDIT: …" and bare free text alike, keeping the instruction', () => {
    expect(parseReviewerReply('EDIT: make it warmer')).toMatchObject({ intent: 'revise', note: 'make it warmer' })
    expect(parseReviewerReply('make it warmer')).toMatchObject({ intent: 'revise', note: 'make it warmer' })
    expect(parseReviewerReply('change: mention the deposit')).toMatchObject({
      intent: 'revise',
      note: 'mention the deposit',
    })
  })
})

describe('resolveDraft', () => {
  it('uses the named code when one is given', async () => {
    const supabase = makeSupabase({ byCode: draftRow() })
    const res = await resolveDraft(supabase, parseReviewerReply('SEND HH-2026-0042'))
    expect(res).toMatchObject({ kind: 'one', draft: { review_code: 'HH-2026-0042' } })
  })

  it('reports an unknown code rather than falling back to a guess', async () => {
    const supabase = makeSupabase({ byCode: null })
    const res = await resolveDraft(supabase, parseReviewerReply('SEND HH-2026-9999'))
    expect(res).toMatchObject({ kind: 'unknown_code' })
  })

  it('uses the single open draft when there is exactly one', async () => {
    const supabase = makeSupabase({ open: [draftRow()] })
    const res = await resolveDraft(supabase, parseReviewerReply('SEND'))
    expect(res).toMatchObject({ kind: 'one', draft: { id: 'draft-1' } })
  })

  it('refuses to guess between two open drafts', async () => {
    const supabase = makeSupabase({ open: [draftRow(), draftRow({ id: 'draft-2', review_code: 'HH-2026-0099' })] })
    const res = await resolveDraft(supabase, parseReviewerReply('SEND'))
    expect(res.kind).toBe('ambiguous')
  })

  it('says so when nothing is open', async () => {
    const supabase = makeSupabase({ open: [] })
    expect((await resolveDraft(supabase, parseReviewerReply('SEND'))).kind).toBe('none')
  })
})

describe('handleReviewerReply', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, REVIEWER_PHONES: REVIEWER, OWNER_NOTIFY_EMAIL: 'owner@example.com' }
    mockAdvance.mockResolvedValue({ from: 'sent_for_review', to: 'approved' })
    mockSendApprovedDraft.mockResolvedValue({
      ok: true,
      draftId: 'draft-1',
      reviewCode: 'HH-2026-0042',
      emailSent: true,
      smsSent: true,
      closed: true,
      recipient: { email: 'jess@example.com', phone: '+16315550123', name: 'Jess' },
      errors: [],
    })
    mockRedraft.mockResolvedValue({ ok: true, status: 200, reviewCode: 'HH-2026-0042', reviewersTexted: 1 })
  })
  afterAll(() => { process.env = originalEnv })

  /* ── THE guardrail test ─────────────────────────────────────────── */

  it('a CUSTOMER texting SEND does nothing at all', async () => {
    const supabase = makeSupabase({ open: [draftRow()] })

    const res = await handleReviewerReply({ supabase, from: CUSTOMER, text: 'SEND' })

    expect(res).toEqual({ handled: false, outcome: 'not_a_reviewer' })
    // No approval, no send, no reply, and the draft was never even looked up.
    expect(mockAdvance).not.toHaveBeenCalled()
    expect(mockSendApprovedDraft).not.toHaveBeenCalled()
    expect(mockSendSMSViaQuo).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('a customer who somehow knows a valid draft code still does nothing', async () => {
    const supabase = makeSupabase({ byCode: draftRow() })

    const res = await handleReviewerReply({ supabase, from: CUSTOMER, text: 'APPROVE HH-2026-0042' })

    expect(res.handled).toBe(false)
    expect(mockSendApprovedDraft).not.toHaveBeenCalled()
  })

  it('nobody is a reviewer when REVIEWER_PHONES is unset', async () => {
    delete process.env.REVIEWER_PHONES
    const supabase = makeSupabase({ open: [draftRow()] })
    const res = await handleReviewerReply({ supabase, from: REVIEWER, text: 'SEND' })
    expect(res.handled).toBe(false)
    expect(mockSendApprovedDraft).not.toHaveBeenCalled()
  })

  /* ── The happy paths ────────────────────────────────────────────── */

  it('SEND from a reviewer approves through the gate, then sends', async () => {
    const supabase = makeSupabase({ open: [draftRow()] })

    const res = await handleReviewerReply({ supabase, from: REVIEWER, text: 'SEND', eventId: 'evt-1' })

    expect(res.outcome).toBe('approved_and_sent')
    // The GATED transition, with proof-of-human and the verbatim phrase.
    expect(mockAdvance).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'inquiry_draft',
        to: 'approved',
        actor: { id: `REVIEWER:${REVIEWER}`, isAdmin: true },
        patch: expect.objectContaining({ approved_phrase: 'SEND', approved_by: REVIEWER }),
      }),
    )
    expect(mockSendApprovedDraft).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: 'draft-1', actor: { id: `REVIEWER:${REVIEWER}`, isAdmin: true } }),
    )
    expect(mockSendSMSViaQuo).toHaveBeenCalledWith(REVIEWER, expect.stringContaining('Sent HH-2026-0042'))
  })

  it('reports back rather than claiming success when the send fails', async () => {
    mockSendApprovedDraft.mockResolvedValue({
      ok: false, draftId: 'draft-1', reviewCode: 'HH-2026-0042',
      emailSent: false, smsSent: false, closed: false,
      recipient: { email: null, phone: null, name: null },
      errors: ['no email address for this draft'],
    })
    const supabase = makeSupabase({ open: [draftRow()] })

    const res = await handleReviewerReply({ supabase, from: REVIEWER, text: 'send it' })

    expect(res.outcome).toBe('approved_send_failed')
    expect(mockSendSMSViaQuo).toHaveBeenCalledWith(REVIEWER, expect.stringContaining('did not complete'))
  })

  it('CANCEL cancels and sends nothing to the customer', async () => {
    mockAdvance.mockResolvedValue({ from: 'sent_for_review', to: 'cancelled' })
    const supabase = makeSupabase({ open: [draftRow()] })

    const res = await handleReviewerReply({ supabase, from: REVIEWER, text: 'cancel' })

    expect(res.outcome).toBe('cancelled')
    expect(mockAdvance).toHaveBeenCalledWith(expect.objectContaining({ to: 'cancelled' }))
    expect(mockSendApprovedDraft).not.toHaveBeenCalled()
  })

  it('TEST delivers to the reviewer, not the customer, and writes nothing', async () => {
    const supabase = makeSupabase({ open: [draftRow()] })

    const res = await handleReviewerReply({ supabase, from: REVIEWER, text: 'TEST' })

    expect(res.outcome).toBe('tested')
    expect(mockSendApprovedDraft).toHaveBeenCalledWith(
      expect.objectContaining({ testTo: { phone: REVIEWER, email: 'owner@example.com' } }),
    )
    // No approval transition — a test is not an approval.
    expect(mockAdvance).not.toHaveBeenCalled()
  })

  it('free text becomes a revision and re-drafts', async () => {
    mockAdvance.mockResolvedValue({ from: 'sent_for_review', to: 'revision_requested' })
    const supabase = makeSupabase({ open: [draftRow()] })

    const res = await handleReviewerReply({ supabase, from: REVIEWER, text: 'EDIT: mention we have parking' })

    expect(res.outcome).toBe('revised')
    expect(mockAdvance).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'revision_requested', patch: { reviewer_note: 'mention we have parking' } }),
    )
    expect(mockRedraft).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: 'draft-1', note: 'mention we have parking' }),
    )
    expect(mockSendApprovedDraft).not.toHaveBeenCalled()
  })

  it('asks which draft when several are open, and sends nothing', async () => {
    const supabase = makeSupabase({ open: [draftRow(), draftRow({ id: 'd2', review_code: 'HH-2026-0099' })] })

    const res = await handleReviewerReply({ supabase, from: REVIEWER, text: 'SEND' })

    expect(res.outcome).toBe('ambiguous')
    expect(mockSendApprovedDraft).not.toHaveBeenCalled()
    expect(mockSendSMSViaQuo).toHaveBeenCalledWith(REVIEWER, expect.stringContaining('HH-2026-0099'))
  })

  it('says there is nothing to do when no draft is open', async () => {
    const supabase = makeSupabase({ open: [] })
    const res = await handleReviewerReply({ supabase, from: REVIEWER, text: 'SEND' })
    expect(res.outcome).toBe('no_open_draft')
    expect(mockSendApprovedDraft).not.toHaveBeenCalled()
  })

  it('refuses to re-send a draft that already went out', async () => {
    const supabase = makeSupabase({ byCode: draftRow({ status: 'sent' }) })
    const res = await handleReviewerReply({ supabase, from: REVIEWER, text: 'SEND HH-2026-0042' })
    expect(mockSendApprovedDraft).not.toHaveBeenCalled()
    expect(mockSendSMSViaQuo).toHaveBeenCalledWith(REVIEWER, expect.stringContaining('already went out'))
  })

  it('skips the approval transition for a draft that is already approved', async () => {
    const supabase = makeSupabase({ byCode: draftRow({ status: 'approved' }) })
    await handleReviewerReply({ supabase, from: REVIEWER, text: 'SEND HH-2026-0042' })
    expect(mockAdvance).not.toHaveBeenCalled()
    expect(mockSendApprovedDraft).toHaveBeenCalled()
  })

  it('never claims a customer was messaged when the loop throws', async () => {
    mockAdvance.mockRejectedValue(new Error('DB exploded'))
    const supabase = makeSupabase({ open: [draftRow()] })

    const res = await handleReviewerReply({ supabase, from: REVIEWER, text: 'SEND' })

    expect(res.outcome).toBe('error')
    expect(mockSendApprovedDraft).not.toHaveBeenCalled()
    expect(mockSendSMSViaQuo).toHaveBeenCalledWith(REVIEWER, expect.stringContaining('Nothing was sent to the customer'))
  })
})
