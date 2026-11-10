/**
 * "View as": an admin previews the crew app as one member, READ-ONLY.
 * The cookie is its own signature (an hh_crew value is not one), it opens the app
 * with every crew switch off, it never admits the owner or a removed member, and
 * requireCrewMember refuses every write while it is on.
 */
import { NextRequest } from 'next/server'

const IDS = {
  real: '22222222-2222-4222-8222-222222222222',
  owner: '33333333-3333-4333-8333-333333333333',
  removed: '55555555-5555-4555-8555-555555555555',
}
const MEMBERS: Record<string, any> = {
  [IDS.real]: { id: IDS.real, first_name: 'Jamie', status: 'active', is_owner: false, is_test: false },
  [IDS.owner]: { id: IDS.owner, first_name: 'Allie', status: 'active', is_owner: true, is_test: false },
  [IDS.removed]: { id: IDS.removed, first_name: 'Gone', status: 'removed', is_owner: false, is_test: false },
}

jest.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }) }))
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => {
      const filters: Record<string, unknown> = {}
      const chain: any = {
        select: () => chain,
        eq: (c: string, v: unknown) => { filters[c] = v; return chain },
        maybeSingle: async () => ({ data: MEMBERS[filters.id as string] ?? filters.member_id ? null : null, error: null }),
      }
      chain.maybeSingle = async () => ({ data: filters.id ? MEMBERS[filters.id as string] ?? null : null, error: null })
      return chain
    },
  }),
}))

import { buildCrewCookieValue, requireCrewMember, setCrewViewCookieHeader, viewMemberIdFromCookieValue, memberIdFromCookieValue } from '@/lib/crew/auth'

const SECRET = 'test-secret-for-crew'
const saved = { e: process.env.CREW_ENABLED, t: process.env.CREW_TEST_LOGIN, o: process.env.CREW_ONBOARDING_ENABLED, s: process.env.PORTAL_LINK_SIGNING_SECRET }
beforeEach(() => {
  delete process.env.CREW_ENABLED; delete process.env.CREW_TEST_LOGIN; delete process.env.CREW_ONBOARDING_ENABLED
  process.env.PORTAL_LINK_SIGNING_SECRET = SECRET
})
afterAll(() => {
  for (const [k, v] of [['CREW_ENABLED', saved.e], ['CREW_TEST_LOGIN', saved.t], ['CREW_ONBOARDING_ENABLED', saved.o], ['PORTAL_LINK_SIGNING_SECRET', saved.s]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v
  }
})

const viewCookie = (id: string) => setCrewViewCookieHeader(id, SECRET).split(';')[0]
const req = (method: string, cookie?: string) => new NextRequest('http://localhost:3002/api/crew/claim', { method, headers: cookie ? { cookie } : {} })

describe('view-as cookie', () => {
  it('round-trips, expires after two hours, and rejects a tampered or future value', () => {
    const v = viewCookie(IDS.real).split('=')[1]
    expect(viewMemberIdFromCookieValue(v, SECRET)).toBe(IDS.real)
    expect(viewMemberIdFromCookieValue(v, SECRET, Date.now() + 2 * 3600_000 + 5000)).toBeNull()
    expect(viewMemberIdFromCookieValue(v, 'other-secret')).toBeNull()
    expect(viewMemberIdFromCookieValue(v.replace(/.$/, c => (c === '0' ? '1' : '0')), SECRET)).toBeNull()
  })
  it('is not interchangeable with an hh_crew value, in either direction', () => {
    const crew = buildCrewCookieValue(IDS.real, SECRET)
    expect(viewMemberIdFromCookieValue(crew, SECRET)).toBeNull()
    expect(memberIdFromCookieValue(viewCookie(IDS.real).split('=')[1], SECRET)).toBeNull()
  })
})

describe('requireCrewMember while viewing', () => {
  it('opens the app with every crew switch off, and lets a GET through', async () => {
    const g = await requireCrewMember(req('GET', viewCookie(IDS.real)))
    expect(g.ok).toBe(true)
    if (g.ok) expect(g.member.id).toBe(IDS.real)
  })
  it('refuses every write, naming the member', async () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const g = await requireCrewMember(req(method, viewCookie(IDS.real)))
      expect(g.ok).toBe(false)
      if (!g.ok) {
        expect(g.response.status).toBe(403)
        expect((await g.response.json()).error).toMatch(/Jamie.*read-only/)
      }
    }
  })
  it('never admits the owner or a removed member', async () => {
    for (const id of [IDS.owner, IDS.removed]) {
      const g = await requireCrewMember(req('GET', viewCookie(id)))
      expect(g.ok).toBe(false)
      if (!g.ok) expect(g.response.status).toBe(401)
    }
  })
  it('without the cookie the app is still closed (404) when no switch is on', async () => {
    const g = await requireCrewMember(req('GET'))
    expect(g.ok).toBe(false)
    if (!g.ok) expect(g.response.status).toBe(404)
  })
})
