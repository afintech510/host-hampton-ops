/**
 * Tests for GET /api/cron/weekly-town-drafts.
 * Covers: cron auth, self-throttling batch selection (skips towns that
 * already have a draft), and stopping the batch early on budget exhaustion.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }),
  },
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))

const mockCreateTownServiceDraft = jest.fn()
jest.mock('@/lib/marketing/townDraft', () => ({
  createTownServiceDraft: (...args: any[]) => mockCreateTownServiceDraft(...args),
}))

import { GET } from '@/app/api/cron/weekly-town-drafts/route'

const CRON_SECRET = 'test-cron-secret'

function makeReq(secret?: string) {
  const headers = new Map<string, string>()
  if (secret) headers.set('x-cron-secret', secret)
  return {
    headers: { get: (k: string) => headers.get(k) ?? null },
    nextUrl: { searchParams: { get: () => null } },
  } as any
}

function makeSupabase(existingSlugs: string[]) {
  const chain: any = {}
  ;['select', 'eq'].forEach(m => (chain[m] = jest.fn(() => chain)))
  chain.in = jest.fn((_col: string, slugs: string[]) =>
    Promise.resolve({ data: slugs.filter(s => existingSlugs.includes(s)).map(slug => ({ slug })), error: null })
  )
  return { from: jest.fn(() => chain) } as any
}

describe('GET /api/cron/weekly-town-drafts', () => {
  const originalEnv = process.env
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, CRON_SECRET }
  })
  afterAll(() => { process.env = originalEnv })

  it('returns 401 without the cron secret', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('drafts the next batch of towns that do not already have content', async () => {
    mockGetSupabase.mockReturnValue(makeSupabase(['permanent-jewelry-southampton']))
    mockCreateTownServiceDraft.mockResolvedValue({ ok: true, status: 200, id: 'row-1', slug: 'x', locale: 'en', contentStatus: 'pending_review', costUsd: 0.01, tokens: 100 })

    const res = await GET(makeReq(CRON_SECRET))
    expect(res.status).toBe(200)
    expect(res.body.attempted).toBe(2)
    expect(res.body.drafted).toBe(2)
    // Southampton already has a draft — skipped. Next two in priority order.
    expect(mockCreateTownServiceDraft).toHaveBeenCalledTimes(2)
    expect(mockCreateTownServiceDraft.mock.calls[0][1]).toMatchObject({ town: 'East Hampton' })
    expect(mockCreateTownServiceDraft.mock.calls[1][1]).toMatchObject({ town: 'Smithtown' })
  })

  it('is a no-op once every town already has a draft', async () => {
    const allSlugs = [
      'permanent-jewelry-southampton', 'permanent-jewelry-east-hampton', 'permanent-jewelry-smithtown',
      'permanent-jewelry-patchogue', 'permanent-jewelry-islip', 'permanent-jewelry-westhampton-beach',
      'permanent-jewelry-montauk', 'permanent-jewelry-sag-harbor', 'permanent-jewelry-bridgehampton',
      'permanent-jewelry-water-mill', 'permanent-jewelry-riverhead',
    ]
    mockGetSupabase.mockReturnValue(makeSupabase(allSlugs))

    const res = await GET(makeReq(CRON_SECRET))
    expect(res.status).toBe(200)
    expect(res.body.drafted).toBe(0)
    expect(mockCreateTownServiceDraft).not.toHaveBeenCalled()
  })

  it('stops the batch early when the LLM budget is exhausted', async () => {
    mockGetSupabase.mockReturnValue(makeSupabase([]))
    mockCreateTownServiceDraft.mockResolvedValueOnce({ ok: false, status: 402, error: 'llm budget exceeded' })

    const res = await GET(makeReq(CRON_SECRET))
    expect(res.status).toBe(200)
    expect(res.body.drafted).toBe(0)
    // Second town in the batch is never attempted once budget is exhausted.
    expect(mockCreateTownServiceDraft).toHaveBeenCalledTimes(1)
  })
})
