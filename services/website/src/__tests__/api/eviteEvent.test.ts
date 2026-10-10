import { NextRequest } from 'next/server'
import { makeFakeEviteDb } from '../helpers/fakeEviteDb'
import { bookingRow, evitesRow, LINE_ITEM_ROWS, NOW, THEME_ROWS } from '../helpers/eviteFixtures'
import { __resetRateLimitForTests, eviteViewRule } from '@/lib/rateLimit'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'

/**
 * POST /api/i/[slug]/event (spec §7.1, §11): the view beacon.
 */

let db: ReturnType<typeof makeFakeEviteDb>
jest.mock('@/lib/supabase', () => ({ getSupabase: () => db.supabase }))

import { POST } from '@/app/api/i/[slug]/event/route'

const g = globalThis as unknown as { fetch?: unknown }
const realFetch = g.fetch
const ENV = ['EVITES_PAGES', 'EVITES_PILOT_REFS', 'META_CAPI_ACCESS_TOKEN', 'NEXT_PUBLIC_META_PIXEL_ID', 'META_GRAPH_VERSION'] as const
const saved: Record<string, string | undefined> = {}

const SLUG = 'mia-glow-7kq2'
const EVITE_ID = 'ev100000-0000-0000-0000-000000000001'

function makeDb(over: { evite?: Record<string, unknown>; booking?: Record<string, unknown> } = {}) {
  return makeFakeEviteDb({
    tables: {
      evites: [evitesRow({ id: EVITE_ID, previous_slugs: [], ...over.evite })],
      bookings: [bookingRow(over.booking)],
      booking_payments: [{ booking_id: 'bk-1', amount_cents: 25000, payment_type: 'deposit' }],
      booking_line_items: LINE_ITEM_ROWS,
      party_themes: THEME_ROWS,
      evite_events: [],
    },
  })
}

function post(body: unknown, opts: { slug?: string; headers?: Record<string, string>; raw?: string } = {}) {
  const req = new NextRequest(`http://localhost:3002/api/i/${opts.slug ?? SLUG}/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'UA/1.0', ...opts.headers },
    body: opts.raw ?? JSON.stringify(body),
  })
  return POST(req, { params: { slug: opts.slug ?? SLUG } })
}

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance'],
  })
  for (const k of ENV) saved[k] = process.env[k]
  process.env.EVITES_PAGES = 'on'
  delete process.env.EVITES_PILOT_REFS
  delete process.env.META_CAPI_ACCESS_TOKEN
  __resetRateLimitForTests()
  db = makeDb()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  g.fetch = realFetch
  jest.useRealTimers()
  jest.restoreAllMocks()
})

const events = () => db.inserts.filter((i) => i.table === 'evite_events').map((i) => i.row)

describe('the allow-list', () => {
  it.each(['share_clicked', 'rsvp_completed', 'club_opted_in', 'calendar_added', 'birthday_month_saved', '', 'x'])('%j is a 400 and reads nothing', async (event) => {
    const res = await post({ event })
    expect(res.status).toBe(400)
    expect(db.selects).toHaveLength(0)
    expect(events()).toHaveLength(0)
  })

  it('a missing event, a non-object and invalid JSON are 400 too', async () => {
    expect((await post({})).status).toBe(400)
    expect((await post(null)).status).toBe(400)
    expect((await post(undefined, { raw: '{not json' })).status).toBe(400)
    expect(events()).toHaveLength(0)
  })

  it('invite_viewed and rsvp_started are accepted with a 204 and an empty body', async () => {
    const a = await post({ event: 'invite_viewed' })
    const b = await post({ event: 'rsvp_started' })
    expect(a.status).toBe(204)
    expect(b.status).toBe(204)
    expect(await a.text()).toBe('')
    expect(events()).toEqual([
      { evite_id: EVITE_ID, event: 'invite_viewed' },
      { evite_id: EVITE_ID, event: 'rsvp_started' },
    ])
  })
})

describe('an unavailable invitation is 404 for every reason, and records nothing', () => {
  it('unknown, malformed, archived, cancelled, switched off, and an old alias', async () => {
    const results: number[] = []
    results.push((await post({ event: 'invite_viewed' }, { slug: 'zed-glow-7kq2' })).status)
    results.push((await post({ event: 'invite_viewed' }, { slug: 'NOT A SLUG' })).status)

    db = makeDb({ evite: { archived_at: '2026-10-01T00:00:00Z' } })
    results.push((await post({ event: 'invite_viewed' })).status)
    db = makeDb({ booking: { status: 'cancelled' } })
    results.push((await post({ event: 'invite_viewed' })).status)
    db = makeDb({ evite: { slug: 'mia-glow-9zzz', previous_slugs: [SLUG] } })
    results.push((await post({ event: 'invite_viewed' })).status) // the page 308s; the beacon does not follow
    db = makeDb()
    process.env.EVITES_PAGES = 'off'
    results.push((await post({ event: 'invite_viewed' })).status)

    expect(results).toEqual([404, 404, 404, 404, 404, 404])
    expect(events()).toHaveLength(0)
  })

  it('a database read error is a 500, not a 404', async () => {
    db.errors.push({ table: 'bookings', op: 'select' })
    expect((await post({ event: 'invite_viewed' })).status).toBe(500)
    expect(events()).toHaveLength(0)
  })
})

describe('the 24-hour view cookie', () => {
  it('a first view sets hh_iv_<id8>: 24 h, HttpOnly, SameSite=Lax, Path=/; a repeat with the cookie records nothing', async () => {
    const first = await post({ event: 'invite_viewed' })
    expect(first.status).toBe(204)
    const setCookie = first.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('hh_iv_ev100000=1')
    expect(setCookie).toMatch(/Max-Age=86400/i)
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=lax/i)
    expect(setCookie).toMatch(/Path=\//i)
    expect(events()).toHaveLength(1)

    const repeat = await post({ event: 'invite_viewed' }, { headers: { cookie: 'hh_iv_ev100000=1' } })
    expect(repeat.status).toBe(204)
    expect(repeat.headers.get('set-cookie')).toBeNull()
    expect(events()).toHaveLength(1) // nothing recorded
  })

  it('is Secure in production only', async () => {
    const env = process.env as Record<string, string | undefined>
    const was = env.NODE_ENV
    env.NODE_ENV = 'production'
    try {
      const res = await post({ event: 'invite_viewed' })
      expect(res.headers.get('set-cookie')).toMatch(/Secure/i)
    } finally {
      env.NODE_ENV = was
    }
  })

  it('the cookie is per evite: another party\'s cookie does not suppress this view', async () => {
    const res = await post({ event: 'invite_viewed' }, { headers: { cookie: 'hh_iv_99999999=1' } })
    expect(res.headers.get('set-cookie')).toContain('hh_iv_ev100000')
    expect(events()).toHaveLength(1)
  })

  it('rsvp_started is not deduped and sets no cookie', async () => {
    const a = await post({ event: 'rsvp_started' })
    const b = await post({ event: 'rsvp_started' })
    expect(a.headers.get('set-cookie')).toBeNull()
    expect(b.headers.get('set-cookie')).toBeNull()
    expect(events()).toHaveLength(2)
  })

  it('a failed insert is logged and still a 204 (analytics never breaks a guest)', async () => {
    db.errors.push({ table: 'evite_events', op: 'insert' })
    const res = await post({ event: 'invite_viewed' })
    expect(res.status).toBe(204)
    expect(console.error).toHaveBeenCalled()
  })
})

describe('Meta Conversions API', () => {
  const configure = () => {
    process.env.META_CAPI_ACCESS_TOKEN = 'TOKEN123'
    process.env.NEXT_PUBLIC_META_PIXEL_ID = '1543468516699272'
    process.env.META_GRAPH_VERSION = 'v23.0'
  }

  it('a first invite_viewed sends ONE ViewContent whose body carries no slug, name, title, email or phone', async () => {
    const fetchSpy = jest.fn(async () => ({ ok: true, status: 200 }))
    g.fetch = fetchSpy
    configure()
    const res = await post({ event: 'invite_viewed' }, { headers: { cookie: '_fbp=fb.1.1700000000000.123456789' } })
    expect(res.status).toBe(204)
    await Promise.resolve() // let the void-ed send start
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, { body: string }]
    expect(url).toBe('https://graph.facebook.com/v23.0/1543468516699272/events')
    const parsed = JSON.parse(init.body)
    const wire = JSON.stringify(parsed.data)
    for (const forbidden of [SLUG, 'mia', 'glow', 'Mia', 'Pat', 'pat@example.com', 'HH-TEST-1', EVITE_ID, 'ev100000', 'bk-1']) {
      expect(wire).not.toContain(forbidden)
    }
    expect(parsed.data[0].event_name).toBe('ViewContent')
    expect(parsed.data[0].event_source_url).toBe(`${CANONICAL_ORIGIN}/i/invite`)
    expect(parsed.data[0].user_data).toMatchObject({ client_user_agent: 'UA/1.0', client_ip_address: '203.0.113.9', fbp: 'fb.1.1700000000000.123456789' })
  })

  it('a deduped repeat, rsvp_started and a 400 send nothing', async () => {
    const fetchSpy = jest.fn(async () => ({ ok: true, status: 200 }))
    g.fetch = fetchSpy
    configure()
    await post({ event: 'invite_viewed' }, { headers: { cookie: 'hh_iv_ev100000=1' } })
    await post({ event: 'rsvp_started' })
    await post({ event: 'share_clicked' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('without a token nothing is sent', async () => {
    const fetchSpy = jest.fn(async () => ({ ok: true, status: 200 }))
    g.fetch = fetchSpy
    configure()
    delete process.env.META_CAPI_ACCESS_TOKEN
    expect((await post({ event: 'invite_viewed' })).status).toBe(204)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the 204 never waits for Meta, and a Meta failure is invisible to the guest', async () => {
    let release: (v: { ok: boolean; status: number }) => void = () => undefined
    g.fetch = jest.fn(() => new Promise((resolve) => { release = resolve as typeof release }))
    configure()
    const res = await post({ event: 'invite_viewed' }) // resolves although fetch has not
    expect(res.status).toBe(204)
    release({ ok: false, status: 500 })
    await Promise.resolve()

    g.fetch = jest.fn(async () => {
      throw new Error('ECONNRESET')
    })
    __resetRateLimitForTests()
    const second = await post({ event: 'invite_viewed' })
    expect(second.status).toBe(204)
  })
})

describe('the rate limit', () => {
  it('is the page\'s own rule: per caller 60 / per route 1,500 per 10 minutes', () => {
    expect(eviteViewRule).toMatchObject({ route: 'evite-view', perCaller: 60, perRoute: 1500, windowMs: 600_000 })
  })

  it('the 61st request from one caller is a 429 with Retry-After, and it reads nothing', async () => {
    for (let i = 0; i < 60; i++) expect((await post({ event: 'rsvp_started' })).status).toBe(204)
    const selectsBefore = db.selects.length
    const res = await post({ event: 'rsvp_started' })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(db.selects).toHaveLength(selectsBefore) // the guard ran BEFORE any read
    // A different caller is unaffected.
    expect((await post({ event: 'rsvp_started' }, { headers: { 'cf-connecting-ip': '198.51.100.7' } })).status).toBe(204)
  })

  it('a throttled request is refused before its body is even parsed', async () => {
    for (let i = 0; i < 60; i++) await post({ event: 'rsvp_started' })
    const res = await post(undefined, { raw: '{not json' })
    expect(res.status).toBe(429) // not 400
  })
})
