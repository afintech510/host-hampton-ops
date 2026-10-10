import { NextRequest } from 'next/server'
import { NOW } from '../helpers/eviteFixtures'
import { SLUG, makeRsvpDb } from '../helpers/rsvpFixtures'
import { readSrc } from '../helpers/sourceScan'
import { __resetRateLimitForTests } from '@/lib/rateLimit'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'

/** GET /i/[slug]/cal (spec §7.1, §8). */

let db: ReturnType<typeof makeRsvpDb>
jest.mock('@/lib/supabase', () => ({ getSupabase: () => db.supabase }))

import { GET } from '@/app/i/[slug]/cal/route'

const ENV = ['EVITES_PAGES', 'EVITES_PILOT_REFS'] as const
const saved: Record<string, string | undefined> = {}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'

function get(o: { slug?: string; ua?: string; query?: string; headers?: Record<string, string> } = {}) {
  const slug = o.slug ?? SLUG
  const r = new NextRequest(`http://localhost:3002/i/${slug}/cal${o.query ?? ''}`, {
    headers: { 'cf-connecting-ip': '203.0.113.9', 'user-agent': o.ua ?? ANDROID, ...o.headers },
  })
  return GET(r, { params: { slug } })
}

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance'],
  })
  for (const k of ENV) saved[k] = process.env[k]
  process.env.EVITES_PAGES = 'on'
  delete process.env.EVITES_PILOT_REFS
  __resetRateLimitForTests()
  db = makeRsvpDb({ evite: { cal_version: 3 } })
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

const events = () => db.inserts.filter((i) => i.table === 'evite_events').map((i) => i.row.event)

describe('Apple devices get the .ics', () => {
  it.each([['iPhone', IPHONE], ['iPad', IPAD], ['Mac', MAC]])('%s: text/calendar as an attachment named party.ics', async (_n, ua) => {
    const res = await get({ ua })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="party.ics"')
    const body = await res.text()
    expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(body).toContain('METHOD:PUBLISH\r\n')
    expect(body).toContain('SEQUENCE:3\r\n') // the evite's cal_version
    expect(body).toContain('DTSTART:20261114T190000Z\r\n')
    expect(body).toContain('DTEND:20261114T210000Z\r\n')
    expect(body).toContain("SUMMARY:Mia's Glow Party")
    expect(body).toContain('UID:evite-ev100000-0000-0000-0000-000000000001@hosthampton.com')
    expect(body.replace(/\r\n /g, '')).toContain(`URL:${CANONICAL_ORIGIN}/i/${SLUG}`)
  })
  it('?format=ics gives an Android phone the file too', async () => {
    const res = await get({ ua: ANDROID, query: '?format=ics' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8')
  })
})

describe('everyone else is sent to Google Calendar', () => {
  it('Android: 302 to the prefilled form, with the right UTC dates and an Eastern ctz', async () => {
    const res = await get({ ua: ANDROID })
    expect(res.status).toBe(302)
    const loc = res.headers.get('location') ?? ''
    expect(loc.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE&')).toBe(true)
    expect(loc).toContain('dates=20261114T190000Z/20261114T210000Z')
    expect(loc).toContain('ctz=America/New_York')
    const q = new URL(loc).searchParams
    expect(q.get('text')).toContain("Mia's Glow Party")
    expect(q.get('location')).toContain('295 Montauk Hwy')
    expect(q.get('details')).toContain(`${CANONICAL_ORIGIN}/i/${SLUG}`)
  })
  it('no user agent at all is Google too', async () => {
    const res = await get({ ua: '' })
    expect(res.status).toBe(302)
  })
  it('the invitation URL in either answer is the canonical origin, whatever the caller sends', async () => {
    const res = await get({ ua: IPHONE, headers: { 'x-forwarded-host': 'evil.example.com', host: 'evil.example.com' } })
    expect(await res.text()).not.toContain('evil.example.com')
  })
})

describe('only a live invitation has a calendar entry', () => {
  it('preview, needs a time, closed, cancelled, archived, unknown and switched off are all 404', async () => {
    const codes: number[] = []
    db = makeRsvpDb({ payments: [], booking: { status: 'lead' } })
    codes.push((await get()).status) // preview
    db = makeRsvpDb({ booking: { party_time: 'TBD' } })
    codes.push((await get()).status) // needs_time
    db = makeRsvpDb()
    jest.setSystemTime(new Date('2026-11-14T21:00:01Z'))
    codes.push((await get()).status) // closed
    jest.setSystemTime(NOW)
    db = makeRsvpDb({ booking: { status: 'cancelled' } })
    codes.push((await get()).status)
    db = makeRsvpDb({ evite: { archived_at: '2026-10-01T00:00:00Z' } })
    codes.push((await get()).status)
    db = makeRsvpDb()
    codes.push((await get({ slug: 'zed-glow-0000' })).status)
    process.env.EVITES_PAGES = 'off'
    codes.push((await get()).status)
    expect(codes).toEqual([404, 404, 404, 404, 404, 404, 404])
    expect(events()).toEqual([])
  })
  it('the 404 body does not say which reason', async () => {
    db = makeRsvpDb({ payments: [], booking: { status: 'lead' } })
    const a = await (await get()).text()
    const b = await (await get({ slug: 'zed-glow-0000' })).text()
    expect(a).toBe(b)
  })
})

describe('errors and limits', () => {
  it('a read error is a 500, not a 404', async () => {
    db.errors.push({ table: 'booking_payments', op: 'select' })
    expect((await get()).status).toBe(500)
  })
  it('a cal_version read error is a 500 too', async () => {
    db.errors.push({ table: 'evites', op: 'select', when: ({ filters }) => (filters ?? []).some((f) => f.col === 'id') })
    expect((await get()).status).toBe(500)
  })
  it('the limiter is first and shared with the page (60 per caller)', async () => {
    const codes: number[] = []
    for (let i = 0; i < 61; i++) codes.push((await get({ ua: IPHONE })).status)
    expect(codes.slice(0, 60).every((c) => c === 200)).toBe(true)
    expect(codes[60]).toBe(429)
    const src = readSrc('app', 'i', '[slug]', 'cal', 'route.ts')
    const body = src.slice(src.indexOf('export async function GET'))
    expect(body.search(/guardRate\s*\(\s*req\s*,\s*eviteViewRule\s*\)/)).toBeGreaterThan(-1)
    expect(body.search(/guardRate/)).toBeLessThan(body.search(/getSupabase\s*\(/))
  })
})

describe('calendar_added', () => {
  it('is recorded for the .ics and for the Google redirect', async () => {
    await get({ ua: IPHONE })
    await get({ ua: ANDROID })
    expect(events()).toEqual(['calendar_added', 'calendar_added'])
  })
  it('a failing analytics write never fails or delays the answer', async () => {
    db.errors.push({ table: 'evite_events', op: 'insert' })
    const res = await get({ ua: IPHONE })
    expect(res.status).toBe(200)
    expect(events()).toEqual([])
  })
  it('a hung analytics write is waited for only a moment', async () => {
    const real = db.supabase as unknown as { from: (t: string) => unknown }
    const from = real.from.bind(real)
    real.from = (t: string) => (t === 'evite_events' ? { insert: () => new Promise(() => undefined) } : from(t))
    const started = Date.now()
    const res = await get({ ua: IPHONE })
    expect(res.status).toBe(200)
    expect(Date.now() - started).toBeLessThan(2000)
  })
})
