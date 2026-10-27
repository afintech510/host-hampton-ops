/**
 * POST /api/crew/auth/test-login — the password-free picker (Adam, 2026-10-26).
 *
 * The site is public, so the promises are all refusals:
 *   - it does not exist unless CREW_TEST_LOGIN is EXACTLY 'true';
 *   - it signs in only an active, is_test, non-owner row, re-read from the DB;
 *   - an unreadable member is a 503, never a session.
 */
import { NextRequest } from 'next/server'

const IDS = {
  test: '11111111-1111-4111-8111-111111111111',
  real: '22222222-2222-4222-8222-222222222222',
  owner: '33333333-3333-4333-8333-333333333333',
  paused: '44444444-4444-4444-8444-444444444444',
  removed: '55555555-5555-4555-8555-555555555555',
  testOwner: '66666666-6666-4666-8666-666666666666',
  missing: '77777777-7777-4777-8777-777777777777',
}

const base = { first_name: 'X', last_name: null, email: 'x@example.com', phone: null, steps: 0, can_lead: false, skills: [], needs_review: false, sms_opt_in: false, sms_opt_in_at: null, email_opt_in: true, admin_notes: null, job_application_id: null, joined_on: '2026-10-26', created_at: '', updated_at: '' }
let MEMBERS: Record<string, any> = {}
let failRead = false

jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {}
      const chain: any = {
        select: () => chain,
        eq: (c: string, v: unknown) => { filters[c] = v; return chain },
        maybeSingle: async () => {
          if (failRead) return { data: null, error: { message: 'boom' } }
          if (table !== 'crew_members') return { data: null, error: null }
          return { data: MEMBERS[filters.id as string] ?? null, error: null }
        },
      }
      return chain
    },
  }),
}))

import { POST } from '@/app/api/crew/auth/test-login/route'
import { __resetRateLimitForTests } from '@/lib/rateLimit'
import { memberIdFromCookieValue } from '@/lib/crew/auth'

const SECRET = 'test-secret-for-crew'

function post(body: unknown) {
  return POST(new NextRequest('http://localhost:3002/api/crew/auth/test-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
    body: JSON.stringify(body),
  }))
}

function cookieMember(res: Response): string | null {
  const set = res.headers.get('set-cookie') ?? ''
  const m = /hh_crew=([^;]+)/.exec(set)
  return m ? memberIdFromCookieValue(m[1], SECRET) : null
}

const saved = { t: process.env.CREW_TEST_LOGIN, e: process.env.CREW_ENABLED, s: process.env.PORTAL_LINK_SIGNING_SECRET }

beforeEach(() => {
  __resetRateLimitForTests()
  failRead = false
  process.env.PORTAL_LINK_SIGNING_SECRET = SECRET
  delete process.env.CREW_ENABLED
  MEMBERS = {
    [IDS.test]: { ...base, id: IDS.test, is_test: true, is_owner: false, status: 'active' },
    [IDS.real]: { ...base, id: IDS.real, is_test: false, is_owner: false, status: 'active' },
    [IDS.owner]: { ...base, id: IDS.owner, email: null, is_test: false, is_owner: true, status: 'active' },
    [IDS.paused]: { ...base, id: IDS.paused, is_test: true, is_owner: false, status: 'paused' },
    [IDS.removed]: { ...base, id: IDS.removed, is_test: true, is_owner: false, status: 'removed' },
    // The DB forbids is_test AND is_owner (migration 079); the route must not depend on that.
    [IDS.testOwner]: { ...base, id: IDS.testOwner, is_test: true, is_owner: true, status: 'active' },
  }
})

afterAll(() => {
  for (const [k, v] of [['CREW_TEST_LOGIN', saved.t], ['CREW_ENABLED', saved.e], ['PORTAL_LINK_SIGNING_SECRET', saved.s]] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('with the flag off it does not exist', () => {
  it.each([undefined, '', 'false', 'TRUE', '1', 'true '])('CREW_TEST_LOGIN=%p → 404, no cookie', async (v) => {
    if (v === undefined) delete process.env.CREW_TEST_LOGIN
    else process.env.CREW_TEST_LOGIN = v
    const res = await post({ memberId: IDS.test })
    expect(res.status).toBe(404)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('CREW_ENABLED alone does not turn it on', async () => {
    delete process.env.CREW_TEST_LOGIN
    process.env.CREW_ENABLED = 'true'
    const res = await post({ memberId: IDS.test })
    expect(res.status).toBe(404)
  })
})

describe('with the flag on', () => {
  beforeEach(() => { process.env.CREW_TEST_LOGIN = 'true' })

  it('signs in an active test member with the real signed hh_crew cookie', async () => {
    const res = await post({ memberId: IDS.test })
    expect(res.status).toBe(200)
    expect(cookieMember(res)).toBe(IDS.test)
    const set = res.headers.get('set-cookie')!
    expect(set).toMatch(/HttpOnly/)
    expect(set).toMatch(/SameSite=Lax/)
    expect(set).toMatch(/Secure/)
  })

  it.each([
    ['a real (non-test) member', IDS.real],
    ['the owner', IDS.owner],
    ['a paused test member', IDS.paused],
    ['a removed test member', IDS.removed],
    ['a test row that is also the owner', IDS.testOwner],
    ['an id that does not exist', IDS.missing],
  ])('refuses %s with 403 and no cookie', async (_label, id) => {
    const res = await post({ memberId: id })
    expect(res.status).toBe(403)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('refuses a malformed id with 400', async () => {
    for (const memberId of [undefined, '', 'x', 123, `${IDS.test}' or 1=1`]) {
      const res = await post({ memberId })
      expect(res.status).toBe(400)
    }
  })

  it('an unreadable member is a 503, never a session', async () => {
    failRead = true
    const res = await post({ memberId: IDS.test })
    expect(res.status).toBe(503)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('is rate-limited', async () => {
    let last = 200
    for (let i = 0; i < 40; i++) last = (await post({ memberId: IDS.test })).status
    expect(last).toBe(429)
  })
})
