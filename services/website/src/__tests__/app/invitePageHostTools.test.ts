import { renderToStaticMarkup } from 'react-dom/server'
import { makeFakeEviteDb } from '../helpers/fakeEviteDb'
import { bookingRow, evitesRow, LINE_ITEM_ROWS, NOW, THEME_ROWS } from '../helpers/eviteFixtures'
import { __resetRateLimitForTests } from '@/lib/rateLimit'
import { pageThemeCss } from '@/lib/evites/pageTheme'

/**
 * `/i/[slug]` host tools (migration 097): the page colour / motion style tag, the fx layer, and the
 * registry & message section at the bottom. Same harness as invitePage.test.ts.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
let mockDb: ReturnType<typeof makeFakeEviteDb>
let mockHeaders: Headers

jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockDb.supabase }))
jest.mock('next/headers', () => ({
  headers: () => mockHeaders,
  cookies: () => ({ get: () => undefined }),
}))
jest.mock('next/navigation', () => ({
  notFound: () => {
    throw Object.assign(new Error('NEXT_NOT_FOUND'), { kind: 'notFound' })
  },
  permanentRedirect: (url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { kind: 'redirect', url, status: 308 })
  },
}))
jest.mock('@/lib/evites/requestCache', () => ({ requestCache: (fn: (k: string) => unknown) => (k: string) => fn(k) }))

import InvitePage from '@/app/i/[slug]/page'

const SLUG = 'mia-glow-7kq2'
const ENV = ['EVITES_PAGES', 'EVITES_PILOT_REFS', 'SUPABASE_URL'] as const
const saved: Record<string, string | undefined> = {}

function makeDb(evite: Record<string, unknown> = {}) {
  return makeFakeEviteDb({
    tables: {
      evites: [evitesRow({ id: 'ev100000-0000-0000-0000-000000000001', previous_slugs: [], ...evite })],
      bookings: [bookingRow()],
      booking_payments: [{ booking_id: 'bk-1', amount_cents: 25000, payment_type: 'deposit' }] as Record<string, unknown>[],
      booking_line_items: LINE_ITEM_ROWS,
      party_themes: THEME_ROWS,
      evite_rsvps: [],
    },
  })
}
const html = async (evite: Record<string, unknown> = {}): Promise<string> => {
  mockDb = makeDb(evite)
  return renderToStaticMarkup((await InvitePage({ params: { slug: SLUG } })) as any)
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
  mockHeaders = new Headers({ 'cf-connecting-ip': '203.0.113.9' })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('appearance', () => {
  it('draws the stored colour as a static style tag and no fx layer when still', async () => {
    const out = await html({ page_color: 'navy', page_motion: 'none' })
    expect(out).toContain(pageThemeCss('navy', 'none'))
    expect(out).toContain('#0e1f3d')
    expect(out).not.toContain('hh-inv-fx"')
  })

  it('a motion adds the fx layer, hidden from assistive tech, as a sibling BEFORE the column', async () => {
    const out = await html({ page_color: 'forest', page_motion: 'sparkle' })
    expect(out).toContain(pageThemeCss('forest', 'sparkle'))
    const fx = out.indexOf('<div class="hh-inv-fx" aria-hidden="true"></div>')
    const col = out.indexOf('<div class="hh-inv-col">')
    expect(fx).toBeGreaterThan(-1)
    expect(col).toBeGreaterThan(fx)
    expect(out.slice(fx + 1, col)).not.toContain('<div') // nothing nested between them: both are direct children of the root
  })

  it('an unset or unknown colour and motion read as the default purple and stillness', async () => {
    for (const evite of [{}, { page_color: 'nope', page_motion: 'blink' }]) {
      const out = await html(evite)
      expect(out).toContain(pageThemeCss(null, null))
      expect(out).not.toContain('hh-inv-fx"')
    }
  })

  it('a hostile stored colour cannot reach the stylesheet', async () => {
    const out = await html({ page_color: '}</style><script>alert(1)</script>', page_motion: 'x' })
    expect(out).not.toContain('<script>')
    expect(out).toContain(pageThemeCss(null, null))
  })
})

describe('registry & message', () => {
  it('is absent when neither is set', async () => {
    const out = await html()
    expect(out).not.toContain('Registry &amp; message')
    expect(out).not.toContain('Open the registry')
  })

  it('shows the note and a safe button with the hostname only, below the RSVP form', async () => {
    const out = await html({ registry_url: 'https://www.babylist.com/list/mia?utm=secret', registry_note: 'Thank you for celebrating with us!' })
    expect(out).toContain('Registry &amp; message')
    expect(out).toContain('Thank you for celebrating with us!')
    expect(out).toContain('href="https://www.babylist.com/list/mia?utm=secret"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer nofollow"')
    expect(out).toContain('>Open the registry<')
    expect(out).toContain('>babylist.com<')
    // The RSVP form comes first.
    expect(out.indexOf('Yes, we')).toBeGreaterThan(-1)
    expect(out.indexOf('Registry &amp; message')).toBeGreaterThan(out.indexOf('Yes, we'))
  })

  it('a note alone shows no button', async () => {
    const out = await html({ registry_note: 'Cash gifts are welcome' })
    expect(out).toContain('Cash gifts are welcome')
    expect(out).not.toContain('Open the registry')
  })

  it('a hostile link in the row is refused at render, never put in an href', async () => {
    for (const url of ['javascript:alert(1)', 'http://babylist.com/x', 'https://u:p@babylist.com/x', 'https://babylist.com/"><script>x</script>']) {
      const out = await html({ registry_url: url, registry_note: 'Hello' })
      expect(out).not.toContain('Open the registry')
      expect(out).not.toContain('javascript:')
      expect(out).not.toContain('<script>x')
    }
  })

  it('escapes a hostile note (React text, not HTML)', async () => {
    const out = await html({ registry_note: '<img src=x onerror=alert(1)>' })
    expect(out).not.toContain('<img src=x')
    expect(out).toContain('&lt;img')
  })
})
