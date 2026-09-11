/**
 * Tests for lib/agent/manualDraft.ts — Phase 4 item 5's "Draft reply with
 * agent" button.
 *
 * This is the one place a human can start a draft for a plan the agent never
 * heard about, so the suite is mostly about the thing that would hurt: a
 * double-click producing two drafts and two texts to Adam's phone. The three
 * guard layers are each asserted separately, because each one covers a
 * different race and a passing test on one says nothing about the others.
 */

const mockAgentEnabled = jest.fn(() => true)
jest.mock('@/lib/agent/config', () => ({
  ...jest.requireActual('@/lib/agent/config'),
  agentEnabled: () => mockAgentEnabled(),
}))

const mockRecordInboundEvent = jest.fn()
const mockClaimInboundEvent = jest.fn()
const mockFinishEvent = jest.fn().mockResolvedValue(undefined)
jest.mock('@/lib/agent/events', () => ({
  recordInboundEvent: (...a: unknown[]) => mockRecordInboundEvent(...a),
  claimInboundEvent: (...a: unknown[]) => mockClaimInboundEvent(...a),
  finishEvent: (...a: unknown[]) => mockFinishEvent(...a),
}))

const mockDraftForInquiry = jest.fn()
jest.mock('@/lib/agent/draftInquiry', () => ({
  draftForInquiry: (...a: unknown[]) => mockDraftForInquiry(...a),
}))

import { draftForBookingByHand } from '@/lib/agent/manualDraft'

const PLAN = {
  id: 'bk-1',
  booking_ref: 'HH-TEST-1',
  status: 'lead',
  party_type: 'mobile_party',
  source: 'phone',
  event_type: 'mobile party',
  contact_name: 'Jess',
  contact_email: 'jess@example.com',
  contact_phone: '+16311234567',
  party_date: null,
  party_time: null,
  guest_count_approx: null,
  notes: 'called about a slime party',
  party_tags: {},
}

interface Opts {
  plan?: Record<string, unknown> | null
  planError?: { message: string } | null
  liveDrafts?: Record<string, unknown>[]
  liveDraftError?: { message: string } | null
}

function makeSupabase(opts: Opts = {}) {
  const from = jest.fn((table: string) => {
    const chain: Record<string, unknown> = {
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        const result =
          table === 'bookings'
            ? { data: opts.plan === undefined ? PLAN : opts.plan, error: opts.planError ?? null }
            : { data: opts.liveDrafts ?? [], error: opts.liveDraftError ?? null }
        return Promise.resolve(result).then(res, rej)
      },
    }
    for (const m of ['select', 'eq', 'in', 'not', 'limit', 'maybeSingle', 'single', 'order']) {
      chain[m] = () => chain
    }
    return chain
  })
  return { from } as never
}

describe('draftForBookingByHand', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAgentEnabled.mockReturnValue(true)
    mockRecordInboundEvent.mockResolvedValue('ev-1')
    mockClaimInboundEvent.mockImplementation((_s: unknown, id: string) =>
      Promise.resolve({ id, source: 'system', booking_id: 'bk-1', body: null, parsed: {} }),
    )
    mockDraftForInquiry.mockResolvedValue({
      ok: true,
      status: 200,
      draftId: 'draft-1',
      reviewCode: 'HH-2026-0042',
      draftStatus: 'sent_for_review',
      reviewersTexted: 1,
    })
  })

  it('enqueues an event, claims it, drafts, and closes the event out', async () => {
    const res = await draftForBookingByHand({ supabase: makeSupabase(), bookingId: 'bk-1', note: 'wants March' })

    expect(res).toMatchObject({ ok: true, eventId: 'ev-1', draftId: 'draft-1', reviewCode: 'HH-2026-0042' })

    // The event carries the plan and the admin's note, so the draft node sees
    // the same shape a website form would have produced.
    const recorded = mockRecordInboundEvent.mock.calls[0][0]
    expect(recorded).toMatchObject({ source: 'system', bookingId: 'bk-1', body: 'wants March' })
    expect(recorded.parsed).toMatchObject({ email: 'jess@example.com', requested_by: 'ADMIN' })

    expect(mockClaimInboundEvent).toHaveBeenCalledWith(expect.anything(), 'ev-1')
    expect(mockFinishEvent).toHaveBeenCalledWith(expect.anything(), 'ev-1', 'handled', {
      draftId: 'draft-1',
      classification: 'admin_manual',
    })
  })

  it('passes BOTH the plan and the event to the draft node', async () => {
    await draftForBookingByHand({ supabase: makeSupabase(), bookingId: 'bk-1' })

    const arg = mockDraftForInquiry.mock.calls[0][0]
    expect(arg.booking).toMatchObject({ id: 'bk-1', contact_name: 'Jess' })
    expect(arg.event).toMatchObject({ id: 'ev-1' })
    expect(arg.actor).toBe('ADMIN')
  })

  describe('layer 1 — the live-draft precheck', () => {
    it('refuses when a draft is already open, WITHOUT creating an event', async () => {
      const supabase = makeSupabase({
        liveDrafts: [{ id: 'd0', review_code: 'HH-2026-0001', status: 'sent_for_review' }],
      })

      const res = await draftForBookingByHand({ supabase, bookingId: 'bk-1' })

      expect(res).toMatchObject({ ok: false, status: 409, reason: 'live_draft' })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toContain('HH-2026-0001')
      // The point of this layer: no junk event row for an ordinary double-click.
      expect(mockRecordInboundEvent).not.toHaveBeenCalled()
      expect(mockDraftForInquiry).not.toHaveBeenCalled()
    })

    it('refuses when it CANNOT TELL whether a draft exists', async () => {
      const supabase = makeSupabase({ liveDraftError: { message: 'timeout' } })

      const res = await draftForBookingByHand({ supabase, bookingId: 'bk-1' })

      // "I could not check" is not "there is none". Drafting on an unknown is
      // how a customer gets two quotes.
      expect(res).toMatchObject({ ok: false, status: 503 })
      expect(mockRecordInboundEvent).not.toHaveBeenCalled()
    })
  })

  describe('layer 2 — the shared claim', () => {
    it('does not draft when the cron already claimed the event', async () => {
      mockClaimInboundEvent.mockResolvedValue(null)

      const res = await draftForBookingByHand({ supabase: makeSupabase(), bookingId: 'bk-1' })

      expect(res).toMatchObject({ ok: false, status: 409, reason: 'claimed_elsewhere', eventId: 'ev-1' })
      expect(mockDraftForInquiry).not.toHaveBeenCalled()
      // Deliberately NOT finished: the dispatcher owns it now.
      expect(mockFinishEvent).not.toHaveBeenCalled()
    })
  })

  describe('layer 3 — the DB unique index, surfaced by the draft node', () => {
    it('reports a racing draft as a conflict and files the event as handled', async () => {
      mockDraftForInquiry.mockResolvedValue({
        ok: false,
        status: 409,
        error: 'A live draft already exists for this booking',
        skipped: true,
      })

      const res = await draftForBookingByHand({ supabase: makeSupabase(), bookingId: 'bk-1' })

      expect(res).toMatchObject({ ok: false, status: 409, reason: 'live_draft' })
      // 'handled', not 'error': nothing went wrong, the work was already done.
      expect(mockFinishEvent).toHaveBeenCalledWith(expect.anything(), 'ev-1', 'handled', {
        error: 'A live draft already exists for this booking',
      })
    })
  })

  describe('refusals', () => {
    it('is a no-op when AGENT_ENABLED is off', async () => {
      mockAgentEnabled.mockReturnValue(false)

      const res = await draftForBookingByHand({ supabase: makeSupabase(), bookingId: 'bk-1' })

      expect(res).toMatchObject({ ok: false, status: 409, reason: 'disabled' })
      expect(mockRecordInboundEvent).not.toHaveBeenCalled()
    })

    it('404s on a plan that is not there', async () => {
      const res = await draftForBookingByHand({ supabase: makeSupabase({ plan: null }), bookingId: 'nope' })
      expect(res).toMatchObject({ ok: false, status: 404 })
    })

    it('refuses a plan with no email and no phone', async () => {
      const supabase = makeSupabase({ plan: { ...PLAN, contact_email: null, contact_phone: null } })

      const res = await draftForBookingByHand({ supabase, bookingId: 'bk-1' })

      // A draft addressed to nobody is not a draft.
      expect(res).toMatchObject({ ok: false, status: 422, reason: 'unreachable' })
      expect(mockRecordInboundEvent).not.toHaveBeenCalled()
    })

    it('marks the event as an error when drafting genuinely fails', async () => {
      mockDraftForInquiry.mockResolvedValue({ ok: false, status: 502, error: 'Draft generation failed' })

      const res = await draftForBookingByHand({ supabase: makeSupabase(), bookingId: 'bk-1' })

      expect(res).toMatchObject({ ok: false, status: 502 })
      expect(mockFinishEvent).toHaveBeenCalledWith(expect.anything(), 'ev-1', 'error', {
        error: 'Draft generation failed',
      })
    })

    it('reports a failure to record the event rather than drafting anyway', async () => {
      mockRecordInboundEvent.mockResolvedValue(null)

      const res = await draftForBookingByHand({ supabase: makeSupabase(), bookingId: 'bk-1' })

      expect(res).toMatchObject({ ok: false, status: 500 })
      expect(mockDraftForInquiry).not.toHaveBeenCalled()
    })
  })
})
