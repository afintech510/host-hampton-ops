/**
 * Tests for `?ref=` on GET /api/party-builder/load (plan §11.6).
 *
 * The lead workspace's "Open planner" link needs an admin to be able to open
 * ANY plan. That is a read of someone else's booking, so the only property
 * worth testing is the one that keeps it from being an IDOR: `ref` must be
 * honoured for an authenticated admin and for nobody else — and for a
 * portal-authenticated customer it must not merely be rejected, it must not
 * reach the query at all, or a customer could enumerate booking refs.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }),
  },
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))

const mockIsAdmin = jest.fn(() => false)
jest.mock('@/lib/adminAuth', () => ({ isAdminAuthorized: () => mockIsAdmin() }))

const mockPortalRef = jest.fn<string | null, []>(() => null)
jest.mock('@/lib/portalAuth', () => ({ getPortalBookingRef: () => mockPortalRef() }))

import { GET } from '@/app/api/party-builder/load/route'

/** Every `.eq('booking_ref', …)` the route issued — the thing under test. */
let queriedRefs: string[]

function makeSupabase() {
  const from = jest.fn(() => {
    const chain: any = {
      then: (res: any, rej: any) =>
        Promise.resolve({ data: { id: 'bk-1', booking_ref: queriedRefs[0] ?? null }, error: null }).then(res, rej),
    }
    for (const m of ['select', 'order', 'single']) chain[m] = () => chain
    chain.eq = (col: string, val: string) => {
      if (col === 'booking_ref') queriedRefs.push(val)
      return chain
    }
    return chain
  })
  return { from } as never
}

function makeReq(ref: string | null) {
  return {
    headers: { get: () => null },
    nextUrl: { searchParams: { get: (k: string) => (k === 'ref' ? ref : null) } },
  } as any
}

beforeEach(() => {
  jest.clearAllMocks()
  queriedRefs = []
  mockGetSupabase.mockReturnValue(makeSupabase())
})

describe('GET /api/party-builder/load', () => {
  it('loads the requested plan for an admin', async () => {
    mockIsAdmin.mockReturnValue(true)
    await GET(makeReq('HH-2026-0208'))
    expect(queriedRefs).toEqual(['HH-2026-0208'])
  })

  it("ignores ?ref= for a customer and loads their OWN plan from the portal cookie", async () => {
    mockIsAdmin.mockReturnValue(false)
    mockPortalRef.mockReturnValue('HH-2026-MINE')
    await GET(makeReq('HH-2026-SOMEONE-ELSE'))
    // Not "rejected with a 403" — the guessed ref never reaches the query.
    expect(queriedRefs).toEqual(['HH-2026-MINE'])
  })

  it('still 401s a caller who is neither an admin nor a signed-in customer', async () => {
    mockIsAdmin.mockReturnValue(false)
    mockPortalRef.mockReturnValue(null)
    const res = await GET(makeReq('HH-2026-0208'))
    expect(res.status).toBe(401)
    expect(queriedRefs).toEqual([])
  })

  it('is unchanged for a customer with no ?ref= at all', async () => {
    mockIsAdmin.mockReturnValue(false)
    mockPortalRef.mockReturnValue('HH-2026-MINE')
    await GET(makeReq(null))
    expect(queriedRefs).toEqual(['HH-2026-MINE'])
  })
})
