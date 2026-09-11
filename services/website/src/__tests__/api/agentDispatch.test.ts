/**
 * Tests for GET /api/cron/agent-dispatch.
 * Covers: cron auth, the AGENT_ENABLED kill switch, claim idempotency (an event
 * another runner already took produces no second draft), the stale-event
 * window, unsupported sources, and the daily spend cap.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }),
  },
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))

const mockDraftForInquiry = jest.fn()
jest.mock('@/lib/agent/draftInquiry', () => ({
  draftForInquiry: (...args: any[]) => mockDraftForInquiry(...args),
  AGENT_ACTOR: 'AGENT',
  DRAFT_ENTITY: 'inquiry_draft',
}))

const mockFinishEvent = jest.fn().mockResolvedValue(undefined)
jest.mock('@/lib/agent/events', () => ({ finishEvent: (...args: any[]) => mockFinishEvent(...args) }))

const mockNotifyOwnerSms = jest.fn().mockResolvedValue(1)
jest.mock('@/lib/ownerNotify', () => ({ notifyOwnerSms: (...args: any[]) => mockNotifyOwnerSms(...args) }))

jest.mock('@/lib/marketing/graph', () => ({ writeLedger: jest.fn().mockResolvedValue(undefined) }))

import { GET } from '@/app/api/cron/agent-dispatch/route'

const CRON_SECRET = 'test-cron-secret'

function makeReq(secret?: string) {
  const headers = new Map<string, string>()
  if (secret) headers.set('x-cron-secret', secret)
  return {
    headers: { get: (k: string) => headers.get(k) ?? null },
    nextUrl: { searchParams: { get: () => null } },
  } as any
}

interface SupaOpts {
  /** Events offered by the "status = new" query. */
  candidates?: { id: string; created_at: string }[]
  /** ids that this runner successfully claims; anything else was taken already. */
  claimable?: string[]
  /** Full rows returned for a claimed event. */
  eventRows?: Record<string, Record<string, unknown>>
  bookings?: Record<string, unknown>[]
  /** Rows for the "agent spend today" ledger query. */
  ledgerCosts?: number[]
  /** Rows for the "did we already warn about the cap" query. */
  capNotices?: unknown[]
}

function makeSupabase(opts: SupaOpts = {}) {
  const claimed: string[] = []

  function resolve(table: string, ops: [string, ...unknown[]][]) {
    const op = (name: string) => ops.find(o => o[0] === name)

    if (table === 'marketing_ledger') {
      if (op('contains')) return { data: opts.capNotices ?? [], error: null }
      return { data: (opts.ledgerCosts ?? []).map(cost_usd => ({ cost_usd })), error: null }
    }

    if (table === 'ingested_messages') {
      if (op('update')) {
        const idOp = ops.find(o => o[0] === 'eq' && o[1] === 'id')
        const id = idOp?.[2] as string
        const canClaim = (opts.claimable ?? []).includes(id)
        if (canClaim) claimed.push(id)
        return { data: canClaim ? [opts.eventRows?.[id] ?? { id }] : [], error: null }
      }
      return { data: opts.candidates ?? [], error: null }
    }

    if (table === 'bookings') return { data: opts.bookings ?? [], error: null }
    return { data: [], error: null }
  }

  const from = jest.fn((table: string) => {
    const ops: [string, ...unknown[]][] = []
    const chain: any = {
      then: (res: any, rej: any) => Promise.resolve(resolve(table, ops)).then(res, rej),
    }
    for (const m of ['select', 'eq', 'in', 'not', 'gte', 'order', 'limit', 'update', 'insert', 'contains', 'single', 'maybeSingle']) {
      chain[m] = jest.fn((...args: unknown[]) => {
        ops.push([m, ...args])
        return chain
      })
    }
    return chain
  })

  return { supabase: { from } as any, claimed }
}

function websiteFormEvent(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    source: 'website_form',
    external_id: `website_form:lead:${id}`,
    direction: 'in',
    parsed: { route: 'lead', name: 'Jess', email: 'jess@example.com' },
    contact_id: 'contact-1',
    booking_id: null,
    status: 'claimed',
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('GET /api/cron/agent-dispatch', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, CRON_SECRET, AGENT_ENABLED: '1' }
    mockDraftForInquiry.mockResolvedValue({ ok: true, status: 200, draftId: 'draft-1', reviewCode: 'HH-2026-0001' })
  })
  afterAll(() => { process.env = originalEnv })

  it('returns 401 without the cron secret', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
    expect(mockGetSupabase).not.toHaveBeenCalled()
  })

  it('returns 401 when CRON_SECRET is not configured at all', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(makeReq('anything'))
    expect(res.status).toBe(401)
  })

  it('does nothing at all when AGENT_ENABLED is off', async () => {
    process.env.AGENT_ENABLED = 'false'
    const res = await GET(makeReq(CRON_SECRET))
    expect(res.body).toMatchObject({ enabled: false, claimed: 0, drafted: 0 })
    expect(mockGetSupabase).not.toHaveBeenCalled()
    expect(mockDraftForInquiry).not.toHaveBeenCalled()
  })

  it('claims a new event and drafts for it exactly once', async () => {
    const { supabase, claimed } = makeSupabase({
      candidates: [{ id: 'e1', created_at: new Date().toISOString() }],
      claimable: ['e1'],
      eventRows: { e1: websiteFormEvent('e1') },
    })
    mockGetSupabase.mockReturnValue(supabase)

    const res = await GET(makeReq(CRON_SECRET))

    expect(res.status).toBe(200)
    expect(res.body.drafted).toBe(1)
    expect(claimed).toEqual(['e1'])
    expect(mockDraftForInquiry).toHaveBeenCalledTimes(1)
    expect(mockFinishEvent).toHaveBeenCalledWith(expect.anything(), 'e1', 'handled', expect.objectContaining({ draftId: 'draft-1' }))
  })

  it('does not draft twice when another runner already claimed the event', async () => {
    // The compare-and-swap returns zero rows: someone else won the race.
    const { supabase } = makeSupabase({
      candidates: [{ id: 'e1', created_at: new Date().toISOString() }],
      claimable: [],
    })
    mockGetSupabase.mockReturnValue(supabase)

    const res = await GET(makeReq(CRON_SECRET))

    expect(mockDraftForInquiry).not.toHaveBeenCalled()
    expect(mockFinishEvent).not.toHaveBeenCalled()
    expect(res.body.drafted).toBe(0)
    expect(res.body.results[0]).toMatchObject({ id: 'e1', outcome: 'already_claimed' })
  })

  it('marks a skipped draft (one already live) as handled, not as an error', async () => {
    const { supabase } = makeSupabase({
      candidates: [{ id: 'e1', created_at: new Date().toISOString() }],
      claimable: ['e1'],
      eventRows: { e1: websiteFormEvent('e1') },
    })
    mockGetSupabase.mockReturnValue(supabase)
    mockDraftForInquiry.mockResolvedValue({ ok: false, status: 409, error: 'A live draft already exists', skipped: true })

    const res = await GET(makeReq(CRON_SECRET))

    expect(res.body.drafted).toBe(0)
    expect(mockFinishEvent).toHaveBeenCalledWith(expect.anything(), 'e1', 'handled', expect.anything())
  })

  it('ignores an event older than the dispatch window instead of drafting for it', async () => {
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const { supabase } = makeSupabase({
      candidates: [{ id: 'e1', created_at: old }],
      claimable: ['e1'],
      eventRows: { e1: websiteFormEvent('e1', { created_at: old }) },
    })
    mockGetSupabase.mockReturnValue(supabase)

    const res = await GET(makeReq(CRON_SECRET))

    expect(mockDraftForInquiry).not.toHaveBeenCalled()
    expect(mockFinishEvent).toHaveBeenCalledWith(expect.anything(), 'e1', 'ignored', expect.anything())
    expect(res.body.results[0].outcome).toBe('stale')
  })

  it('parks a source Phase 1 cannot answer (Quo/Gmail) without drafting', async () => {
    const { supabase } = makeSupabase({
      candidates: [{ id: 'e1', created_at: new Date().toISOString() }],
      claimable: ['e1'],
      eventRows: { e1: websiteFormEvent('e1', { source: 'quo' }) },
    })
    mockGetSupabase.mockReturnValue(supabase)

    const res = await GET(makeReq(CRON_SECRET))

    expect(mockDraftForInquiry).not.toHaveBeenCalled()
    expect(res.body.results[0].outcome).toBe('unsupported_source')
  })

  it('sweeps a pending_review booking that has no draft yet', async () => {
    const { supabase } = makeSupabase({
      candidates: [],
      bookings: [{ id: 'b1', booking_ref: 'HH-2026-8242', status: 'pending_review' }],
    })
    mockGetSupabase.mockReturnValue(supabase)

    const res = await GET(makeReq(CRON_SECRET))

    expect(mockDraftForInquiry).toHaveBeenCalledWith(expect.objectContaining({ booking: expect.objectContaining({ id: 'b1' }) }))
    expect(res.body.drafted).toBe(1)
  })

  it('stops and texts the reviewers once when the daily cap is hit', async () => {
    const { supabase } = makeSupabase({ ledgerCosts: [3, 2.5], capNotices: [] })
    mockGetSupabase.mockReturnValue(supabase)
    process.env.AGENT_DAILY_USD_CAP = '5'

    const res = await GET(makeReq(CRON_SECRET))

    expect(res.body).toMatchObject({ capped: true, drafted: 0 })
    expect(mockDraftForInquiry).not.toHaveBeenCalled()
    expect(mockNotifyOwnerSms).toHaveBeenCalledTimes(1)
    expect(mockNotifyOwnerSms.mock.calls[0][0]).toContain('daily LLM cap')
  })

  it('does not re-text the cap warning on the next run of the same day', async () => {
    const { supabase } = makeSupabase({ ledgerCosts: [9], capNotices: [{ id: 'already-warned' }] })
    mockGetSupabase.mockReturnValue(supabase)
    process.env.AGENT_DAILY_USD_CAP = '5'

    const res = await GET(makeReq(CRON_SECRET))

    expect(res.body.capped).toBe(true)
    expect(mockNotifyOwnerSms).not.toHaveBeenCalled()
  })
})
