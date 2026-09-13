/**
 * GET /api/cron/process-sequences — the route's own contract.
 *
 * The processor has had tests since Phase 4; the ROUTE has not, and the route
 * is where the two caps are wired. That mattered: `?limit=` reached
 * `batchSize`, which is a cap on rows read, and PLAN.md and AGENTS.md both
 * described it as "one real person per tick" for 45 frozen enrollments.
 *
 * This file also carries the behavioural half of the cron credential check.
 * `cronSurface.test.ts` R2 asserts the SHAPE of `isCronAuthorized`; only
 * driving it can show what an unset `CRON_SECRET` really does, which is the
 * measurement the guard's own comment rests on.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }),
  },
}))

const mockProcessSequences = jest.fn()
jest.mock('@/lib/sequences/processor', () => ({
  BATCH_SIZE: 50,
  processSequences: (...a: any[]) => mockProcessSequences(...a),
}))

import { GET } from '@/app/api/cron/process-sequences/route'

const CRON_SECRET = 'test-cron-secret'

function makeReq(opts: { header?: string; params?: Record<string, string> } = {}) {
  const headers = new Map<string, string>()
  if (opts.header !== undefined) headers.set('x-cron-secret', opts.header)
  const params = opts.params ?? {}
  return {
    headers: { get: (k: string) => headers.get(k) ?? null },
    nextUrl: { searchParams: { get: (k: string) => (k in params ? params[k] : null) } },
  } as any
}

const emptySummary = {
  scanned: 0, sent: 0, skipped: 0, claimedElsewhere: 0, deferred: 0, failed: 0,
  unsubscribed: 0, completed: 0, paused: 0, stale: 0, capped: 0, inactiveSequence: 0, notes: [],
}

const originalEnv = process.env
beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...originalEnv, CRON_SECRET }
  mockProcessSequences.mockResolvedValue({ ...emptySummary })
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())
afterAll(() => { process.env = originalEnv })

describe('authorization', () => {
  it('accepts the header and the query parameter', async () => {
    expect((await GET(makeReq({ header: CRON_SECRET }))).status).toBe(200)
    expect((await GET(makeReq({ params: { secret: CRON_SECRET } }))).status).toBe(200)
  })

  it('401s a wrong secret, an empty secret and no secret at all', async () => {
    expect((await GET(makeReq({ header: 'nope' }))).status).toBe(401)
    expect((await GET(makeReq({ header: '' }))).status).toBe(401)
    expect((await GET(makeReq({ params: { secret: '' } }))).status).toBe(401)
    expect((await GET(makeReq())).status).toBe(401)
    expect(mockProcessSequences).not.toHaveBeenCalled()
  })

  /**
   * The measurement behind the guard, exercised rather than reasoned about
   * (rule 8). Seven of the fourteen per-file copies were
   * `secret === process.env.CRON_SECRET` with no `if (!expected)`. That is NOT
   * bypassable today, because `Headers.get()` and `URLSearchParams.get()` both
   * return `null` and `null === undefined` is false — so this pair asserts the
   * fixed behaviour AND records what the unfixed behaviour actually was.
   */
  it('fails CLOSED when CRON_SECRET is unset, on every transport', async () => {
    delete process.env.CRON_SECRET
    expect((await GET(makeReq())).status).toBe(401)
    expect((await GET(makeReq({ header: '' }))).status).toBe(401)
    expect((await GET(makeReq({ header: 'undefined' }))).status).toBe(401)
    expect((await GET(makeReq({ params: { secret: '' } }))).status).toBe(401)
    expect(mockProcessSequences).not.toHaveBeenCalled()
  })
})

describe('?limit caps SENDS', () => {
  it('passes sendCap, never batchSize', async () => {
    await GET(makeReq({ header: CRON_SECRET, params: { limit: '1' } }))
    expect(mockProcessSequences).toHaveBeenCalledWith({ sendCap: 1 })
  })

  it('clamps to BATCH_SIZE rather than trusting the caller', async () => {
    await GET(makeReq({ header: CRON_SECRET, params: { limit: '9999' } }))
    expect(mockProcessSequences).toHaveBeenCalledWith({ sendCap: 50 })
  })

  it('400s a limit that is not a usable number', async () => {
    for (const limit of ['0', '-3', 'all', '']) {
      const res = await GET(makeReq({ header: CRON_SECRET, params: { limit } }))
      expect(res.status).toBe(400)
    }
    expect(mockProcessSequences).not.toHaveBeenCalled()
  })

  it('with no limit at all, the tick is unbounded as before', async () => {
    await GET(makeReq({ header: CRON_SECRET }))
    expect(mockProcessSequences).toHaveBeenCalledWith({})
  })
})

describe('?scan bounds the rows read, so a production probe can be proved safe', () => {
  it('passes batchSize', async () => {
    await GET(makeReq({ header: CRON_SECRET, params: { scan: '3' } }))
    expect(mockProcessSequences).toHaveBeenCalledWith({ batchSize: 3 })
  })

  it('combines with ?limit', async () => {
    await GET(makeReq({ header: CRON_SECRET, params: { limit: '1', scan: '3' } }))
    expect(mockProcessSequences).toHaveBeenCalledWith({ sendCap: 1, batchSize: 3 })
  })

  it('400s a scan that is not a usable number, or is larger than the batch', async () => {
    // Rule 10: a bound that was silently ignored is a bound the operator — and
    // in this case the probe — believes is protecting real customers.
    for (const scan of ['0', '-1', '51', '2.5', 'lots', '']) {
      const res = await GET(makeReq({ header: CRON_SECRET, params: { scan } }))
      expect(res.status).toBe(400)
      expect(res.json().error).toMatch(/scan must be an integer/)
    }
    expect(mockProcessSequences).not.toHaveBeenCalled()
  })
})

describe('the run summary', () => {
  it('a failed enrollment read is a 500, not a green zero', async () => {
    mockProcessSequences.mockRejectedValue(new Error('statement timeout'))
    const res = await GET(makeReq({ header: CRON_SECRET }))
    expect(res.status).toBe(500)
    expect(res.json().error).toMatch(/statement timeout/)
  })

  it('carries the new counters through to the body a cron console shows', async () => {
    mockProcessSequences.mockResolvedValue({ ...emptySummary, scanned: 3, sent: 1, stale: 1, capped: 1, inactiveSequence: 1 })
    const res = await GET(makeReq({ header: CRON_SECRET }))
    expect(res.json()).toMatchObject({ scanned: 3, sent: 1, stale: 1, capped: 1, inactiveSequence: 1 })
  })
})
