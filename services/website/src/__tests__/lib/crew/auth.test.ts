/**
 * lib/crew/auth.ts + crewMemberMayEnter: the session gate on every /api/crew/*
 * route and every /crew page.
 *
 * The rule Adam's test picker added: while CREW_TEST_LOGIN is on WITHOUT
 * CREW_ENABLED, only `is_test` members get in — a real member holding a valid
 * cookie (say, from before a flag was switched back off) is refused.
 */
import { NextRequest } from 'next/server'

const IDS = {
  test: '11111111-1111-4111-8111-111111111111',
  real: '22222222-2222-4222-8222-222222222222',
  owner: '33333333-3333-4333-8333-333333333333',
  paused: '44444444-4444-4444-8444-444444444444',
}
let MEMBERS: Record<string, any> = {}
let failRead = false

jest.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }) }))
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => {
      const filters: Record<string, unknown> = {}
      const chain: any = {
        select: () => chain,
        eq: (c: string, v: unknown) => { filters[c] = v; return chain },
        maybeSingle: async () => failRead
          ? { data: null, error: { message: 'boom' } }
          : { data: MEMBERS[filters.id as string] ?? null, error: null },
      }
      return chain
    },
  }),
}))

import { buildCrewCookieValue, memberIdFromCookieValue, requireCrewMember } from '@/lib/crew/auth'
import { crewAppOpen, crewMemberMayEnter } from '@/lib/crew/settings'

const SECRET = 'test-secret-for-crew'
const saved = { t: process.env.CREW_TEST_LOGIN, e: process.env.CREW_ENABLED, s: process.env.PORTAL_LINK_SIGNING_SECRET }

function setFlags(enabled: string | undefined, testLogin: string | undefined) {
  if (enabled === undefined) delete process.env.CREW_ENABLED
  else process.env.CREW_ENABLED = enabled
  if (testLogin === undefined) delete process.env.CREW_TEST_LOGIN
  else process.env.CREW_TEST_LOGIN = testLogin
}

function req(cookie?: string) {
  return new NextRequest('http://localhost:3002/api/crew/claim', {
    method: 'POST',
    headers: cookie ? { cookie } : {},
  })
}
const as = (id: string, issuedAt?: number) => `hh_crew=${buildCrewCookieValue(id, SECRET, issuedAt)}`

beforeEach(() => {
  failRead = false
  process.env.PORTAL_LINK_SIGNING_SECRET = SECRET
  const m = { first_name: 'X', last_name: null, email: null, phone: null, steps: 0, can_lead: false, skills: [] }
  MEMBERS = {
    [IDS.test]: { ...m, id: IDS.test, is_test: true, is_owner: false, status: 'active' },
    [IDS.real]: { ...m, id: IDS.real, is_test: false, is_owner: false, status: 'active' },
    [IDS.owner]: { ...m, id: IDS.owner, is_test: false, is_owner: true, status: 'active' },
    [IDS.paused]: { ...m, id: IDS.paused, is_test: false, is_owner: false, status: 'paused' },
  }
})

afterAll(() => {
  for (const [k, v] of [['CREW_TEST_LOGIN', saved.t], ['CREW_ENABLED', saved.e], ['PORTAL_LINK_SIGNING_SECRET', saved.s]] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('requireCrewMember', () => {
  it('with both switches off, the surface does not exist (404), cookie or not', async () => {
    setFlags(undefined, undefined)
    for (const c of [undefined, as(IDS.real), as(IDS.test)]) {
      const g = await requireCrewMember(req(c))
      expect(g.ok).toBe(false)
      if (!g.ok) expect(g.response.status).toBe(404)
    }
  })

  describe('test-only mode (CREW_TEST_LOGIN without CREW_ENABLED)', () => {
    beforeEach(() => setFlags(undefined, 'true'))

    it('admits a test member', async () => {
      const g = await requireCrewMember(req(as(IDS.test)))
      expect(g.ok).toBe(true)
      if (g.ok) expect(g.member.id).toBe(IDS.test)
    })

    it('REJECTS a real member holding a perfectly valid cookie', async () => {
      const g = await requireCrewMember(req(as(IDS.real)))
      expect(g.ok).toBe(false)
      if (!g.ok) expect(g.response.status).toBe(401)
    })

    it('rejects the owner and a paused member', async () => {
      for (const id of [IDS.owner, IDS.paused]) {
        const g = await requireCrewMember(req(as(id)))
        expect(g.ok).toBe(false)
      }
    })
  })

  describe('launched (CREW_ENABLED)', () => {
    beforeEach(() => setFlags('true', undefined))

    it('admits a real member, and a test member', async () => {
      expect((await requireCrewMember(req(as(IDS.real)))).ok).toBe(true)
      expect((await requireCrewMember(req(as(IDS.test)))).ok).toBe(true)
    })

    it('still rejects the owner and a paused member', async () => {
      for (const id of [IDS.owner, IDS.paused]) {
        const g = await requireCrewMember(req(as(id)))
        expect(g.ok).toBe(false)
        if (!g.ok) expect(g.response.status).toBe(401)
      }
    })

    it('rejects no cookie, a forged signature, a stale cookie and a future one', async () => {
      const day = 86_400_000
      const forged = `hh_crew=${IDS.real}:${Date.now()}:${'0'.repeat(64)}`
      for (const c of [undefined, forged, as(IDS.real, Date.now() - 31 * day), as(IDS.real, Date.now() + 5 * day)]) {
        const g = await requireCrewMember(req(c))
        expect(g.ok).toBe(false)
        if (!g.ok) expect(g.response.status).toBe(401)
      }
    })

    it('an unreadable member is 503, not a sign-out', async () => {
      failRead = true
      const g = await requireCrewMember(req(as(IDS.real)))
      expect(g.ok).toBe(false)
      if (!g.ok) expect(g.response.status).toBe(503)
    })
  })
})

describe('crewMemberMayEnter / crewAppOpen', () => {
  const m = (o: Partial<{ status: string; is_owner: boolean; is_test: boolean }>) => ({ status: 'active', is_owner: false, is_test: false, ...o })

  it('flags are exactly "true"', () => {
    for (const v of ['TRUE', '1', 'yes', 'true ', '']) {
      setFlags(v, v)
      expect(crewAppOpen()).toBe(false)
      expect(crewMemberMayEnter(m({ is_test: true }))).toBe(false)
    }
  })

  it('test-only mode admits is_test only', () => {
    setFlags(undefined, 'true')
    expect(crewMemberMayEnter(m({ is_test: true }))).toBe(true)
    expect(crewMemberMayEnter(m({ is_test: false }))).toBe(false)
  })

  it('never the owner, never paused or removed', () => {
    setFlags('true', 'true')
    expect(crewMemberMayEnter(m({ is_owner: true }))).toBe(false)
    expect(crewMemberMayEnter(m({ status: 'paused' }))).toBe(false)
    expect(crewMemberMayEnter(m({ status: 'removed', is_test: true }))).toBe(false)
    expect(crewMemberMayEnter(m({}))).toBe(true)
  })
})

describe('the cookie value', () => {
  it('round-trips, and a different secret or id does not verify', () => {
    const v = buildCrewCookieValue(IDS.real, SECRET)
    expect(memberIdFromCookieValue(v, SECRET)).toBe(IDS.real)
    expect(memberIdFromCookieValue(v, 'other')).toBeNull()
    expect(memberIdFromCookieValue(v.replace(IDS.real, IDS.test), SECRET)).toBeNull()
    expect(memberIdFromCookieValue('not-a-uuid:1:abc', SECRET)).toBeNull()
  })
})
