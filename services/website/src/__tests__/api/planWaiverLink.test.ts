/**
 * `POST /api/plan/[ref]/waiver-link` — the invoice's route to the room-rental
 * waiver, driven.
 *
 * It mints the EXISTING check-in link (`mintCheckinLink`: a random token, only its
 * HMAC stored) and decides only who may ask and when. Pinned here:
 *
 *   * a customer needs the portal cookie naming THIS ref; another ref's is a 403;
 *   * an admin session may ask for any plan's link (that is how an admin gets one);
 *   * it refuses — in words — a plan that is not a studio rental, is cancelled,
 *     already signed, or whose SignWell template is not configured;
 *   * and it mints nothing on any refusal (no `checkin_tokens` row).
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: async () => body, body }),
  },
}))

const minted: string[] = []
jest.mock('@/lib/checkinLink', () => ({
  ...jest.requireActual('@/lib/checkinLink'),
  mintCheckinLink: jest.fn(async (id: string) => {
    minted.push(id)
    return `https://www.hosthampton.com/checkin/${'a'.repeat(64)}`
  }),
}))

let booking: Record<string, unknown> | null
let readError: { message: string } | null
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: booking, error: readError }) }),
      }),
    }),
  }),
}))

const mockPlanAccess = jest.fn()
jest.mock('@/lib/planAccess', () => ({ planAccess: (...a: unknown[]) => mockPlanAccess(...a) }))
const mockIsAdmin = jest.fn()
jest.mock('@/lib/adminAuth', () => ({ isAdminAuthorized: (...a: unknown[]) => mockIsAdmin(...a) }))

import { POST } from '@/app/api/plan/[ref]/waiver-link/route'
import { __resetRateLimitForTests } from '@/lib/rateLimit'

const STUDIO = {
  id: 'bk-xy',
  booking_ref: 'HH-PTY-XY8VU',
  status: 'deposit_paid',
  event_type: 'studio-rental',
  package_type: 'Studio Rental',
  party_date: '2099-12-06',
  checkin_agreement_signed_at: null,
  agreement_signed_at: null,
}
const call = (ref = 'HH-PTY-XY8VU') =>
  POST({ headers: { get: () => 'hh_portal=x' } } as any, { params: Promise.resolve({ ref }) })

const originalEnv = process.env
beforeEach(() => {
  jest.clearAllMocks()
  minted.length = 0
  __resetRateLimitForTests()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  process.env = { ...originalEnv, SIGNWELL_API_KEY: 'k', SIGNWELL_CHECKIN_TEMPLATE_ID: 't' }
  booking = { ...STUDIO }
  readError = null
  mockPlanAccess.mockReturnValue({ ok: true, isAdmin: false, adminEmail: null })
  mockIsAdmin.mockReturnValue(false)
})
afterEach(() => { process.env = originalEnv; jest.restoreAllMocks() })

describe('who may ask', () => {
  it('the customer with this ref\'s cookie gets the check-in link', async () => {
    const res: any = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toMatch(/^https:\/\/www\.hosthampton\.com\/checkin\/[a-f0-9]{64}$/)
    expect(minted).toEqual(['bk-xy'])
  })

  it('refuses anyone with no access to this plan — and mints nothing', async () => {
    mockPlanAccess.mockReturnValue({ ok: false, reason: 'denied' })
    const res: any = await call()
    expect(res.status).toBe(403)
    expect(minted).toHaveLength(0)
  })

  it('an admin session (or the shared admin password) gets one too', async () => {
    mockPlanAccess.mockReturnValue({ ok: true, isAdmin: true, adminEmail: 'a@b.c' })
    expect(((await call()) as any).status).toBe(200)
    mockPlanAccess.mockReturnValue({ ok: false, reason: 'denied' })
    mockIsAdmin.mockReturnValue(true)
    expect(((await call()) as any).status).toBe(200)
    expect(minted).toHaveLength(2)
  })
})

describe('when it refuses, it says why and mints nothing', () => {
  it.each([
    ['not a studio rental', { event_type: 'kid-party', package_type: 'Glow' }],
    ['cancelled', { status: 'cancelled' }],
    ['over', { party_date: '2020-01-01' }],
  ])('%s -> 409', async (_n, over) => {
    booking = { ...STUDIO, ...over }
    const res: any = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/not available/i)
    expect(minted).toHaveLength(0)
  })

  it('already signed (either column) -> 409 that says so', async () => {
    for (const col of ['checkin_agreement_signed_at', 'agreement_signed_at']) {
      booking = { ...STUDIO, [col]: '2026-11-01T12:00:00Z' }
      const res: any = await call()
      expect([col, res.status]).toEqual([col, 409])
      expect((await res.json()).error).toMatch(/already signed/i)
    }
    expect(minted).toHaveLength(0)
  })

  it('SignWell not configured -> 409, not a link that leads to a silent { unavailable }', async () => {
    process.env = { ...originalEnv, SIGNWELL_API_KEY: 'k', SIGNWELL_CHECKIN_TEMPLATE_ID: '' }
    const res: any = await call()
    expect(res.status).toBe(409)
    expect(minted).toHaveLength(0)
  })

  it('an unreadable booking is a 503, not "no such plan"; a missing one is a 404', async () => {
    readError = { message: 'timeout' }
    expect(((await call()) as any).status).toBe(503)
    readError = null
    booking = null
    expect(((await call()) as any).status).toBe(404)
    expect(minted).toHaveLength(0)
  })
})
