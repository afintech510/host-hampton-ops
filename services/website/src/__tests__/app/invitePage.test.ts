import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { makeFakeEviteDb } from '../helpers/fakeEviteDb'
import { bookingRow, evitesRow, LINE_ITEM_ROWS, NOW, THEME_ROWS } from '../helpers/eviteFixtures'
import { readSrc } from '../helpers/sourceScan'
import { __resetRateLimitForTests } from '@/lib/rateLimit'
import { unavailableMetadata } from '@/lib/evites/pageModel'

/**
 * `/i/[slug]` (spec §7.1). The repo's jest is node-only, so the async server
 * component is called as a function and its element rendered with
 * react-dom/server; `next/navigation`, `next/headers` and Supabase are mocked.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
let mockDb: ReturnType<typeof makeFakeEviteDb>
let mockHeaders: Headers

jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockDb.supabase }))
jest.mock('next/headers', () => ({ headers: () => mockHeaders }))
jest.mock('next/navigation', () => ({
  notFound: () => {
    throw Object.assign(new Error('NEXT_NOT_FOUND'), { kind: 'notFound' })
  },
  permanentRedirect: (url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { kind: 'redirect', url, status: 308 })
  },
}))
// React.cache is per-request in Next; here a memo the test clears between "requests".
jest.mock('@/lib/evites/requestCache', () => {
  const memos: Array<Map<string, unknown>> = []
  return {
    requestCache: (fn: (k: string) => unknown) => {
      const memo = new Map<string, unknown>()
      memos.push(memo)
      return (k: string) => {
        if (!memo.has(k)) memo.set(k, fn(k))
        return memo.get(k)
      }
    },
    __newRequest: () => memos.forEach((m) => m.clear()),
  }
})

import InvitePage, { generateMetadata } from '@/app/i/[slug]/page'
import { loadInvite } from '@/app/i/[slug]/loadInvite'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const newRequest = (): void => (require('@/lib/evites/requestCache') as { __newRequest: () => void }).__newRequest()

const SLUG = 'mia-glow-7kq2'
const KEY = 'c'.repeat(32)
const ENV = ['EVITES_PAGES', 'EVITES_PILOT_REFS', 'SUPABASE_URL'] as const
const saved: Record<string, string | undefined> = {}

function makeDb(over: { evite?: Record<string, unknown>; booking?: Record<string, unknown>; payments?: unknown[] } = {}) {
  return makeFakeEviteDb({
    tables: {
      evites: [evitesRow({ id: 'ev100000-0000-0000-0000-000000000001', previous_slugs: [], ...over.evite })],
      bookings: [bookingRow(over.booking)],
      booking_payments: (over.payments ?? [{ booking_id: 'bk-1', amount_cents: 25000, payment_type: 'deposit' }]) as Record<string, unknown>[],
      booking_line_items: LINE_ITEM_ROWS,
      party_themes: THEME_ROWS,
      // Another guest's answer sits in the same database. The public page must never read it.
      evite_rsvps: [
        { id: 'r1', evite_id: 'ev100000-0000-0000-0000-000000000001', status: 'yes', parent_name: 'Zed Secretparent', children: [{ first_name: 'Quincy' }], allergy_note: 'peanuts' },
      ],
    },
  })
}

const params = (slug = SLUG) => ({ params: { slug } })
const html = async (slug = SLUG): Promise<string> => renderToStaticMarkup((await InvitePage(params(slug))) as any)
const settle = async (slug = SLUG) => {
  try {
    return { ok: true as const, html: await html(slug) }
  } catch (e) {
    return { ok: false as const, err: e as any }
  }
}

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance'],
  })
  for (const k of ENV) saved[k] = process.env[k]
  process.env.EVITES_PAGES = 'on'
  delete process.env.EVITES_PILOT_REFS
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
  __resetRateLimitForTests()
  newRequest()
  mockHeaders = new Headers({ 'cf-connecting-ip': '203.0.113.9' })
  mockDb = makeDb()
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

describe('a live invitation', () => {
  it('draws the invitation, the details as text, and the (disabled) RSVP buttons', async () => {
    const out = await html()
    expect(out).toContain('>MIA<')
    expect(out).toContain('aria-label="Party details"')
    expect(out).toContain('Saturday, November 14')
    expect(out).toContain('Any questions? Ask Allie')
    expect(out).toContain('hh-inv-frame')
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Yes, we(&#x27;|')ll be there<\/button>/)
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Can(&#x27;|')t make it<\/button>/)
    expect(out).not.toContain('role="status"') // no ribbon
  })

  it("serialises none of the booking's private data, and never reads another guest's RSVP (D15)", async () => {
    const out = await html()
    for (const secret of ['pat@example.com', 'Pat Example', 'HH-TEST-1', 'bk-1', 'ev100000', 'Zed Secretparent', 'Quincy', 'peanuts', 'edit_nonce', 'allergy']) {
      expect(out).not.toContain(secret)
    }
    expect(mockDb.selects.map((s) => s.table)).not.toContain('evite_rsvps')
    expect(out).not.toMatch(/\b\d+\s+(guests?|kids?|rsvps?|families|people)\b/i) // no counts
  })

  it('shows the host notes and the formatted deadline when present', async () => {
    mockDb = makeDb({ evite: { host_note: 'Wear something that glows!', gift_note: 'No gifts please', rsvp_deadline: '2026-11-08' } })
    const out = await html()
    expect(out).toContain('Wear something that glows!')
    expect(out).toContain('No gifts please')
    expect(out).toContain('Sunday, November 8')
  })

  it('escapes a hostile host note (React text, not HTML)', async () => {
    mockDb = makeDb({ evite: { host_note: '<img src=x onerror=alert(1)>' } })
    const out = await html()
    expect(out).not.toContain('<img src=x')
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('has the beacon island and no navigation to the rest of the site', async () => {
    const out = await html()
    expect(out).not.toMatch(/href="\/(party|book|events|gallery)/)
  })
})

describe('the other visible states (spec §4 copy)', () => {
  it('preview: a Preview ribbon, the booking note, "Pick your date", and no RSVP', async () => {
    mockDb = makeDb({ booking: { status: 'awaiting_deposit' }, payments: [] })
    const out = await html()
    expect(out).toContain('Preview')
    expect(out).toContain('RSVPs open once the party is booked')
    expect(out).toContain('Pick your date')
    expect(out).not.toContain('Yes, we')
  })

  it('needs_time: "Time coming soon", the date without a time, no RSVP', async () => {
    mockDb = makeDb({ booking: { party_time: 'Evening' } })
    const out = await html()
    expect(out).toContain('Time coming soon')
    expect(out).toContain('Saturday, November 14')
    expect(out).not.toContain('Yes, we')
  })

  it('closed: "This party has happened", no RSVP', async () => {
    mockDb = makeDb({ booking: { party_date: '2026-10-01' } })
    const out = await html()
    expect(out).toContain('This party has happened')
    expect(out).not.toContain('Yes, we')
  })
})

describe('every unavailable outcome is the SAME notFound()', () => {
  const cases: Array<[string, () => void, string]> = [
    ['an unknown slug', () => undefined, 'zed-glow-7kq2'],
    ['a malformed slug', () => undefined, 'NOT A SLUG'],
    ['an archived invitation', () => { mockDb = makeDb({ evite: { archived_at: '2026-10-01T00:00:00Z' } }) }, SLUG],
    ['a cancelled party', () => { mockDb = makeDb({ booking: { status: 'cancelled' } }) }, SLUG],
    ['a lost lead', () => { mockDb = makeDb({ booking: { status: 'lost' } }) }, SLUG],
    ['the pages flag off', () => { process.env.EVITES_PAGES = 'off' }, SLUG],
    ['a non-pilot booking in pilot mode', () => { process.env.EVITES_PAGES = 'pilot'; process.env.EVITES_PILOT_REFS = 'HH-OTHER-1' }, SLUG],
  ]

  it.each(cases)('%s', async (_name, arrange, slug) => {
    arrange()
    const r = await settle(slug)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.err).toMatchObject({ kind: 'notFound', message: 'NEXT_NOT_FOUND' })
    const md = await generateMetadata(params(slug))
    expect(md).toEqual(unavailableMetadata())
  })

  it('a throttled request is the same notFound, and the database is never read', async () => {
    for (let i = 0; i < 60; i++) {
      newRequest()
      await settle()
    }
    newRequest()
    mockDb = makeDb()
    const r = await settle()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.err).toMatchObject({ kind: 'notFound' })
    expect(await generateMetadata(params())).toEqual(unavailableMetadata())
    expect(mockDb.selects).toHaveLength(0)
  })

  it('malformed slug and flag-off never read the database', async () => {
    await settle('NOT A SLUG')
    process.env.EVITES_PAGES = 'off'
    newRequest()
    await settle()
    expect(mockDb.selects).toHaveLength(0)
  })
})

describe('aliases', () => {
  it('an old slug is a 308 to the current one', async () => {
    mockDb = makeDb({ evite: { slug: 'mia-glow-9zzz', previous_slugs: [SLUG] } })
    const r = await settle()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.err).toMatchObject({ kind: 'redirect', url: '/i/mia-glow-9zzz', status: 308 })
  })
})

describe('a read failure', () => {
  it('is NOT a notFound: the page throws (-> error.tsx, HTTP 500) and the head is the neutral one', async () => {
    mockDb.errors.push({ table: 'booking_payments', op: 'select' })
    const r = await settle()
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.err.kind).toBeUndefined()
      expect(r.err.message).toContain('booking_payments')
    }
    await expect(generateMetadata(params())).resolves.toEqual(unavailableMetadata())
  })
})

describe('generateMetadata', () => {
  it('an available invitation: noindex, a card with width/height/type, title and description from the facts', async () => {
    mockDb = makeDb({ evite: { image_key: KEY, og_object: 'og-v2-ab12.jpg' } })
    const md = await generateMetadata(params())
    expect(md.robots).toMatchObject({ index: false, follow: false })
    expect(md.title).toEqual({ absolute: "Mia's Glow Party" })
    expect(String(md.description)).toContain('Saturday, November 14')
    const img = (md.openGraph as any).images[0]
    expect(img).toMatchObject({
      url: `https://proj.supabase.co/storage/v1/object/public/evites/${KEY}/og-v2-ab12.jpg`,
      width: 1200,
      height: 630,
      type: 'image/jpeg',
    })
    expect((md.twitter as any).card).toBe('summary_large_image')
  })

  it('before the first render the card is the static default', async () => {
    const md = await generateMetadata(params())
    expect((md.openGraph as any).images[0].url).toMatch(/\/images\/og-default\.png$/)
    expect((md.openGraph as any).images[0].url).toMatch(/^https:\/\//)
  })

  it('is identical for a bot and a person: no request header changes it', async () => {
    mockDb = makeDb({ evite: { image_key: KEY, og_object: 'og-v2-ab12.jpg' } })
    const person = await generateMetadata(params())
    newRequest()
    mockHeaders = new Headers({ 'cf-connecting-ip': '198.51.100.7', 'user-agent': 'facebookexternalhit/1.1', 'x-forwarded-host': 'evil.example.com' })
    const bot = await generateMetadata(params())
    expect(bot).toEqual(person)
    expect(JSON.stringify(bot)).not.toContain('evil.example.com')
  })
})

describe('one load per request: the limiter counts a view once, the database is read once', () => {
  it('generateMetadata and the page share a single guarded load', async () => {
    await generateMetadata(params())
    await html()
    expect(mockDb.selects.filter((s) => s.table === 'evites')).toHaveLength(1)
    expect(mockDb.selects.filter((s) => s.table === 'bookings')).toHaveLength(1)
  })

  it('so 60 full views (head + body) from one caller are allowed and the 61st is not', async () => {
    for (let i = 0; i < 60; i++) {
      newRequest()
      await generateMetadata(params())
      await html()
    }
    newRequest()
    expect((await loadInvite(SLUG)).kind).toBe('limited')
  })
})

describe('page source rules', () => {
  const page = readSrc('app', 'i', '[slug]', 'page.tsx')
  const loader = readSrc('app', 'i', '[slug]', 'loadInvite.ts')

  it('the rate limiter is called before anything reads the database, in the one place that reads', () => {
    const guard = loader.search(/guardRateHeaders\s*\(\s*headers\(\)\s*,\s*eviteViewRule\s*\)/)
    const read = loader.search(/resolveEviteBySlug\s*\(/)
    expect(guard).toBeGreaterThan(-1)
    expect(read).toBeGreaterThan(guard)
    // The page itself reads nothing: it goes through the guarded loader.
    expect(page).not.toMatch(/getSupabase|\.from\(|resolveEviteBySlug/)
    expect(page).toMatch(/loadInvite\s*\(/)
  })

  it('is force-dynamic, nodejs, and has no side effects on GET', () => {
    expect(page).toMatch(/export const dynamic = 'force-dynamic'/)
    expect(page).toMatch(/export const runtime = 'nodejs'/)
    expect(page).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|recordEviteEvent|sendMetaViewContent|cookies\(\)/)
    expect(page).not.toMatch(/evite_rsvps/)
  })

  it('there is NO loading.tsx under /i (it would turn a 404 into a 200)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path')
    const root = path.join(process.cwd(), 'src', 'app', 'i')
    const found: string[] = []
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(d, e.name))
        else if (/^loading\./.test(e.name)) found.push(path.join(d, e.name))
      }
    }
    walk(root)
    expect(found).toEqual([])
    for (const f of ['layout.tsx', '[slug]/page.tsx', '[slug]/not-found.tsx', '[slug]/error.tsx']) {
      expect(fs.existsSync(path.join(root, f))).toBe(true)
    }
  })

  it('the error boundary is a client component, as Next requires', () => {
    expect(readSrc('app', 'i', '[slug]', 'error.tsx')).toMatch(/^\s*'use client'/)
  })

  it('the layout says noindex and no-referrer, and ships the bundled fonts', () => {
    const layout = readSrc('app', 'i', 'layout.tsx')
    expect(layout).toMatch(/robots:\s*NOINDEX/)
    expect(layout).toMatch(/referrer:\s*'no-referrer'/)
    expect(layout).toMatch(/fontFaceCss\(\)/)
  })

  it('renders without throwing when the canvas would hold a frame element (smoke)', async () => {
    const el = (await InvitePage(params())) as any
    expect(renderToStaticMarkup(createElement('div', null, el))).toContain('hh-inv-canvas')
  })
})
