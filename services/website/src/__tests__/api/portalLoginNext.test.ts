import { NextRequest } from 'next/server'
import { generatePortalToken } from '@/lib/portalAuth'
import { __resetRateLimitForTests } from '@/lib/rateLimit'
import { readSrc } from '../helpers/sourceScan'

/**
 * `/my-booking/login?next=` end to end (P07, spec §7.2): the login page posts `next` to
 * `/api/portal/resend-link`, which puts it on the link it texts or emails, and
 * `/api/portal/auth` then checks it AGAIN. Both ends use `lib/portalRedirect.ts`.
 */

type Result = { data?: unknown; error?: { message: string } | null }

/** A chainable stand-in: any method returns the chain; awaiting it (or .maybeSingle()) yields the result for table+op. */
function chainDb(results: Record<string, { select?: Result; update?: Result; insert?: Result }>) {
  const calls: Array<{ table: string; op: string; arg?: unknown }> = []
  const from = (table: string) => {
    let op = 'select'
    const settle = (): Result => results[table]?.[op as 'select'] ?? { data: null, error: null }
    const proxy: unknown = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') return (res: (v: Result) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(settle()).then(res, rej)
          if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve(settle())
          return (...args: unknown[]) => {
            if (prop === 'select' && op === 'select') op = 'select'
            if (prop === 'update' || prop === 'insert') {
              op = prop
              calls.push({ table, op, arg: args[0] })
            }
            return proxy
          }
        },
      },
    )
    return proxy
  }
  return { client: { from }, calls }
}

let mockDb: ReturnType<typeof chainDb>
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockDb.client }))
const mockSms = jest.fn(async (_provider: string, _to: string, _body: string) => ({ sid: 'x' }))
jest.mock('@/lib/sms', () => ({
  ...jest.requireActual('@/lib/sms'),
  sendSMSVia: (p: string, to: string, body: string) => mockSms(p, to, body),
}))

import { GET as authGET } from '@/app/api/portal/auth/route'
import { POST as resendPOST } from '@/app/api/portal/resend-link/route'

const SECRET = 'test-portal-secret'
const REF = 'HH-TEST-1'
const ENV = ['PORTAL_LINK_SIGNING_SECRET'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  process.env.PORTAL_LINK_SIGNING_SECRET = SECRET
  __resetRateLimitForTests()
  mockSms.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  jest.restoreAllMocks()
})

// ------------------------------------------------------------------------------------------------ /api/portal/auth

async function openLink(redirect: string | null): Promise<{ status: number; location: string | null; cookie: string | null }> {
  const { token, hash, expiresAt } = generatePortalToken(REF, SECRET)
  mockDb = chainDb({
    bookings: { select: { data: { id: 'bk-1' }, error: null } },
    portal_tokens: { select: { data: [{ id: 't1', token_hash: hash, expires_at: expiresAt.toISOString() }], error: null }, update: { error: null } },
  })
  const qs = new URLSearchParams({ ref: REF, token })
  if (redirect !== null) qs.set('redirect', redirect)
  const res = await authGET(new NextRequest(`http://localhost:3002/api/portal/auth?${qs}`, { headers: { host: 'www.hosthampton.com', 'cf-connecting-ip': '203.0.113.5', 'user-agent': 'Mozilla/5.0' } }))
  return { status: res.status, location: res.headers.get('location'), cookie: res.headers.get('set-cookie') }
}

describe('/api/portal/auth honours the shared allow-list', () => {
  it('accepts /my-booking/invitation and signs the customer in', async () => {
    const r = await openLink('/my-booking/invitation')
    expect(r.status).toBe(307)
    expect(r.location).toBe('https://www.hosthampton.com/my-booking/invitation')
    expect(r.cookie).toMatch(/^hh_portal=/)
  })

  it.each(['/my-booking', '/party-builder', '/party-planner'])('still accepts %s', async (p) => {
    expect((await openLink(p)).location).toBe(`https://www.hosthampton.com${p}`)
  })

  it('still accepts the plan summary for THIS ref only', async () => {
    expect((await openLink(`/plan/${REF}/summary`)).location).toBe(`https://www.hosthampton.com/plan/${REF}/summary`)
    expect((await openLink('/plan/HH-OTHER-9/summary')).location).toBe('https://www.hosthampton.com/party-planner')
  })

  it.each(['//evil.com', 'https://evil.com', '/\\evil.com', '/my-booking/invitation?x=1', '/admin', '/api/portal/booking', 'javascript:alert(1)', ''])(
    'falls back to the default for %j - and still signs in (the link was good)',
    async (bad) => {
      const r = await openLink(bad)
      expect(r.location).toBe('https://www.hosthampton.com/party-planner')
      expect(r.cookie).toMatch(/^hh_portal=/)
    },
  )

  it('no redirect parameter at all keeps the old default', async () => {
    expect((await openLink(null)).location).toBe('https://www.hosthampton.com/party-planner')
  })
})

// ------------------------------------------------------------------------------------------------ /api/portal/resend-link

let phoneSeq = 0
async function requestLink(next: unknown): Promise<string> {
  const phone = `63155510${String(10 + phoneSeq++).padStart(2, '0')}`
  // The candidate list matches on the trailing ten digits, so seed the same number.
  mockDb = chainDb({
    bookings: { select: { data: [{ id: 'bk-1', booking_ref: REF, contact_name: 'Pat Parent', contact_phone: phone }], error: null } },
    portal_tokens: { insert: { error: null } },
  })
  const res = await resendPOST(
    new NextRequest('http://localhost:3002/api/portal/resend-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': `203.0.113.${phoneSeq}` },
      body: JSON.stringify({ phone, ...(next === undefined ? {} : { next }) }),
    }),
  )
  expect(res.status).toBe(200)
  expect(mockSms).toHaveBeenCalledTimes(1)
  return mockSms.mock.calls[0][2]
}

describe('/api/portal/resend-link carries `next` onto the link it sends', () => {
  it('a valid next becomes ?redirect= on the magic link', async () => {
    const body = await requestLink('/my-booking/invitation')
    expect(body).toContain('/api/portal/auth?ref=HH-TEST-1&token=')
    expect(body).toContain('&redirect=%2Fmy-booking%2Finvitation')
  })

  it('no next, no redirect parameter (the old behaviour)', async () => {
    expect(await requestLink(undefined)).not.toContain('redirect=')
  })

  it.each(['//evil.com', 'https://evil.com', '/\\evil.com', '/admin', '/my-booking/invitation?x=1', 'javascript:alert(1)', 5, null, {}, ['/my-booking']])(
    'drops %j - the request still succeeds, the link just has no redirect',
    async (bad) => {
      const body = await requestLink(bad)
      expect(body).not.toContain('redirect=')
      expect(body).not.toContain('evil')
    },
  )

  it('a refused next is never an error (the login stays anti-enumeration)', async () => {
    const body = await requestLink('//evil.com')
    expect(body).toContain('Host Hampton party planner link')
  })
})

describe('both builders of the link pass `next` through the same screen', () => {
  const src = readSrc('app', 'api', 'portal', 'resend-link', 'route.ts')
  it('the phone path and the email path', () => {
    expect(src.match(/buildPortalUrl\(.*,\s*rawToken,\s*next\)/g)).toHaveLength(2)
    expect(src).toMatch(/const next = safePortalRedirect\(body\.next\)/)
  })
})

describe('the login page', () => {
  const src = readSrc('app', 'my-booking', 'login', 'page.tsx')
  it('reads ?next= through the allow-list and posts it only when valid', () => {
    expect(src).toMatch(/const next = safePortalRedirect\(params\.get\('next'\)\)/)
    expect(src).toMatch(/\.\.\.\(next \? \{ next \} : \{\}\)/)
  })
})
