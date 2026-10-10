import { NextRequest } from 'next/server'
import { NOW } from '../helpers/eviteFixtures'
import { EVITE_ID, OTHER_EVITE_ID, OTHER_SLUG, SLUG, makeRsvpDb, rsvpRow, tokenFor } from '../helpers/rsvpFixtures'
import { readSrc } from '../helpers/sourceScan'
import { __resetRateLimitForTests } from '@/lib/rateLimit'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { cookieName, signEditToken } from '@/lib/evites/rsvpToken'

/**
 * GET /i/[slug]/rsvp/[token] (spec §7.1, §7.5): the emailed "Update your RSVP" and
 * "Stop reminders" links.
 */

let db: ReturnType<typeof makeRsvpDb>
jest.mock('@/lib/supabase', () => ({ getSupabase: () => db.supabase }))

import { GET } from '@/app/i/[slug]/rsvp/[token]/route'

const ENV = ['EVITES_PAGES', 'EVITES_PILOT_REFS', 'PORTAL_LINK_SIGNING_SECRET'] as const
const saved: Record<string, string | undefined> = {}

function get(token: string, o: { slug?: string; query?: string; headers?: Record<string, string> } = {}) {
  const slug = o.slug ?? SLUG
  const r = new NextRequest(`http://localhost:3002/i/${slug}/rsvp/${token}${o.query ?? ''}`, {
    headers: { 'cf-connecting-ip': '203.0.113.9', ...o.headers },
  })
  return GET(r, { params: { slug, token } })
}
const location = (r: Response) => r.headers.get('location')

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance'],
  })
  for (const k of ENV) saved[k] = process.env[k]
  process.env.EVITES_PAGES = 'on'
  delete process.env.EVITES_PILOT_REFS
  process.env.PORTAL_LINK_SIGNING_SECRET = 'test-signing-secret-0123456789abcdef'
  __resetRateLimitForTests()
  db = makeRsvpDb()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('a valid link', () => {
  it('sets the cookie and sends the guest to the edit view with a 303', async () => {
    const row = rsvpRow()
    db = makeRsvpDb({ rsvps: [row] })
    const token = tokenFor(row)
    const res = await get(token)
    expect(res.status).toBe(303)
    expect(location(res)).toBe(`${CANONICAL_ORIGIN}/i/${SLUG}?edit=1`)
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie.startsWith(`${cookieName(EVITE_ID)}=${token}`)).toBe(true)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=lax/i)
    expect(cookie).toMatch(/Path=\//i)
    expect(db.updates).toHaveLength(0) // a plain edit link changes nothing
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('builds the redirect from the allow-listed origin, never from a header the caller wrote', async () => {
    const row = rsvpRow()
    db = makeRsvpDb({ rsvps: [row] })
    const res = await get(tokenFor(row), { headers: { 'x-forwarded-host': 'evil.example.com', host: 'evil.example.com' } })
    expect(location(res)).toBe(`${CANONICAL_ORIGIN}/i/${SLUG}?edit=1`)
    expect(location(res)).not.toContain('evil')
  })
})

describe('?stop=1', () => {
  it('records the opt-out FIRST, then redirects to the "Reminders stopped" view', async () => {
    const row = rsvpRow({ reminder_email: 'pat@example.com' })
    db = makeRsvpDb({ rsvps: [row] })
    const res = await get(tokenFor(row), { query: '?stop=1' })
    expect(res.status).toBe(303)
    expect(location(res)).toBe(`${CANONICAL_ORIGIN}/i/${SLUG}?stopped=1`)
    expect(db.tables.evite_rsvps[0].reminder_opt_out_at).toBe(NOW.toISOString())
    expect(db.tables.evite_rsvps[0].reminder_email).toBe('pat@example.com') // the answer itself is kept
    expect(db.tables.evite_rsvps[0].revision).toBe(1)
  })
  it('a second click keeps the first timestamp', async () => {
    const row = rsvpRow({ reminder_opt_out_at: '2026-10-25T10:00:00.000Z' })
    db = makeRsvpDb({ rsvps: [row] })
    const res = await get(tokenFor(row), { query: '?stop=1' })
    expect(location(res)).toBe(`${CANONICAL_ORIGIN}/i/${SLUG}?stopped=1`)
    expect(db.tables.evite_rsvps[0].reminder_opt_out_at).toBe('2026-10-25T10:00:00.000Z')
  })
  it('a write that FAILS is a 503 that says so: no redirect, no cookie, never "stopped"', async () => {
    const row = rsvpRow()
    db = makeRsvpDb({ rsvps: [row] })
    db.errors.push({ table: 'evite_rsvps', op: 'update' })
    const res = await get(tokenFor(row), { query: '?stop=1' })
    expect(res.status).toBe(503)
    expect(location(res)).toBeNull()
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(await res.text()).toMatch(/couldn.t stop your reminders/)
    expect(db.tables.evite_rsvps[0].reminder_opt_out_at).toBeNull()
  })
  it('only the exact value 1 counts', async () => {
    const row = rsvpRow()
    db = makeRsvpDb({ rsvps: [row] })
    for (const q of ['?stop=0', '?stop=true', '?stop=', '?stops=1']) await get(tokenFor(row), { query: q })
    expect(db.updates).toHaveLength(0)
  })
  it('an invalid token stops nothing', async () => {
    const row = rsvpRow()
    db = makeRsvpDb({ rsvps: [row] })
    const res = await get(`${row.id}.${Math.floor(NOW.getTime() / 1000) + 1000}.${'A'.repeat(43)}`, { query: '?stop=1' })
    expect(location(res)).toBe(`${CANONICAL_ORIGIN}/i/${SLUG}`)
    expect(db.updates).toHaveLength(0)
  })
})

describe('a failed link and an unknown link say the same thing', () => {
  const exp = Math.floor(Date.parse('2026-12-20T00:00:00Z') / 1000)

  it('forged, expired, revoked, malformed, another party\'s and unknown-id tokens are one identical 303 with no cookie', async () => {
    const mine = rsvpRow()
    const theirs = rsvpRow({ evite_id: OTHER_EVITE_ID })
    db = makeRsvpDb({ rsvps: [mine, theirs] })
    const good = tokenFor(mine)
    const [id, e, sig] = good.split('.')
    const tokens = [
      `${id}.${e}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`, // forged
      signEditToken({ id: String(mine.id), edit_nonce: String(mine.edit_nonce) }, Math.floor(NOW.getTime() / 1000) - 5), // expired
      signEditToken({ id: String(mine.id), edit_nonce: 'NotTheRealNonce1' }, exp), // revoked / wrong nonce
      'garbage',
      tokenFor(theirs), // valid, for the OTHER party
      signEditToken({ id: '00000000-0000-4000-8000-0000000000ee', edit_nonce: 'AAAAAAAAAAAAAAAA' }, exp), // no such rsvp
    ]
    const seen = new Set<string>()
    for (const t of tokens) {
      const res = await get(t)
      expect(res.status).toBe(303)
      expect(res.headers.get('set-cookie')).toBeNull()
      seen.add(`${res.status} ${location(res)}`)
    }
    expect(Array.from(seen)).toEqual([`303 ${CANONICAL_ORIGIN}/i/${SLUG}`])
  })

  it('a good token on an unknown or unavailable slug is the same redirect to that slug (the page 404s)', async () => {
    const row = rsvpRow()
    db = makeRsvpDb({ rsvps: [row] })
    const token = tokenFor(row)
    const unknown = await get(token, { slug: 'zed-glow-0000' })
    expect(unknown.status).toBe(303)
    expect(location(unknown)).toBe(`${CANONICAL_ORIGIN}/i/zed-glow-0000`)
    expect(unknown.headers.get('set-cookie')).toBeNull()
    // the token belongs to EVITE_ID: used on the other party's slug it is just a bad link
    const wrong = await get(token, { slug: OTHER_SLUG })
    expect(location(wrong)).toBe(`${CANONICAL_ORIGIN}/i/${OTHER_SLUG}`)
    expect(wrong.headers.get('set-cookie')).toBeNull()
  })

  it('a cancelled party and a switched-off feature never set a cookie', async () => {
    const row = rsvpRow()
    db = makeRsvpDb({ rsvps: [row], booking: { status: 'cancelled' } })
    expect((await get(tokenFor(row))).headers.get('set-cookie')).toBeNull()
    db = makeRsvpDb({ rsvps: [row] })
    process.env.EVITES_PAGES = 'off'
    expect((await get(tokenFor(row))).headers.get('set-cookie')).toBeNull()
  })
})

describe('failures that are not "invalid"', () => {
  it('a read error resolving the invitation is a 500, and one verifying the token is a 503', async () => {
    const row = rsvpRow()
    db = makeRsvpDb({ rsvps: [row] })
    db.errors.push({ table: 'booking_payments', op: 'select' })
    expect((await get(tokenFor(row))).status).toBe(500)
    db = makeRsvpDb({ rsvps: [row] })
    db.errors.push({ table: 'evite_rsvps', op: 'select' })
    expect((await get(tokenFor(row))).status).toBe(503)
  })
})

describe('rate limit', () => {
  it('is first: the 11th request from one caller is 429, shared with the RSVP API', async () => {
    const codes: number[] = []
    for (let i = 0; i < 11; i++) codes.push((await get('garbage')).status)
    expect(codes.slice(0, 10).every((c) => c === 303)).toBe(true)
    expect(codes[10]).toBe(429)
  })
  it('the limiter is the first statement of the handler', () => {
    const src = readSrc('app', 'i', '[slug]', 'rsvp', '[token]', 'route.ts')
    const body = src.slice(src.indexOf('export async function GET'))
    expect(body.search(/guardRate\s*\(\s*req\s*,\s*eviteRsvpRule\s*\)/)).toBeGreaterThan(-1)
    expect(body.search(/guardRate/)).toBeLessThan(body.search(/\bawait\b/))
    expect(body.search(/guardRate/)).toBeLessThan(body.search(/getSupabase\s*\(/))
    expect(src).not.toMatch(/x-forwarded-host|req\.url\b/)
  })
})
