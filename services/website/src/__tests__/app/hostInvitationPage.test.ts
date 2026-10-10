import { renderToStaticMarkup } from 'react-dom/server'
import { NOW } from '../helpers/eviteFixtures'
import { PORTAL_SECRET, REF, guest, makeHostDb, portalCookie } from '../helpers/hostInvitationFixtures'
import { readSrc } from '../helpers/sourceScan'

/**
 * `/my-booking/invitation` (P07, spec §7.2). The async server component is called as a
 * function and its element rendered with react-dom/server; `next/headers`,
 * `next/navigation` and Supabase are mocked.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
let mockDb: ReturnType<typeof makeHostDb>
let mockCookie: string | null = null
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockDb.supabase }))
jest.mock('next/headers', () => ({
  cookies: () => ({
    getAll: () =>
      (mockCookie ?? '')
        .split(';')
        .map((c) => c.trim())
        .filter(Boolean)
        .map((c) => ({ name: c.slice(0, c.indexOf('=')), value: c.slice(c.indexOf('=') + 1) })),
  }),
}))
jest.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { kind: 'redirect', url })
  },
  useRouter: () => ({ refresh: () => undefined }),
}))

import HostInvitationPage from '@/app/my-booking/invitation/page'

const ENV = ['EVITES_PAGES', 'EVITES_PILOT_REFS', 'PORTAL_LINK_SIGNING_SECRET', 'SUPABASE_URL'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance'],
  })
  for (const k of ENV) saved[k] = process.env[k]
  process.env.EVITES_PAGES = 'on'
  delete process.env.EVITES_PILOT_REFS
  process.env.PORTAL_LINK_SIGNING_SECRET = PORTAL_SECRET
  process.env.SUPABASE_URL = 'https://p.supabase.co'
  mockDb = makeHostDb()
  mockCookie = portalCookie()
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

const html = async (): Promise<string> => renderToStaticMarkup((await HostInvitationPage()) as any)
const redirected = async (): Promise<string | null> => {
  try {
    await HostInvitationPage()
    return null
  } catch (e) {
    return (e as { kind?: string; url?: string }).kind === 'redirect' ? ((e as { url: string }).url) : String(e)
  }
}

describe('without a portal session', () => {
  it.each([
    ['no cookie', null],
    ['a forged session', `hh_portal=${REF}:${NOW.getTime()}:${'0'.repeat(64)}`],
    ['a session signed with another secret', portalCookie(REF, 'other-secret')],
    ['only unrelated cookies', 'hh_admin=x; _ga=1'],
  ])('%s redirects to sign-in and back here', async (_n, cookie) => {
    mockCookie = cookie
    expect(await redirected()).toBe('/my-booking/login?next=/my-booking/invitation')
    expect(mockDb.selects).toHaveLength(0) // nothing was read for a stranger
  })
})

describe('with a portal session', () => {
  it('draws the invitation, the share panel, the form and the RSVP list for the cookie’s booking', async () => {
    mockDb = makeHostDb({ rsvps: [guest({ parent_name: 'Ann A' })] })
    const out = await html()
    expect(out).toContain('Your invitation')
    expect(out).toContain('hh-hi-canvas')
    expect(out).toContain('Text My Invitation')
    expect(out).toContain('Customize')
    expect(out).toContain('Ann A')
    expect(out).toContain('Mia')
  })

  it('never puts a guest’s private contact data in the page', async () => {
    mockDb = makeHostDb({ rsvps: [guest()] })
    const out = await html()
    for (const v of ['leak-email@example.com', '+16315550199', 'club-leak@example.com', '203.0.113.77', 'NONCEnonce123456']) expect(out).not.toContain(v)
  })

  it('the Share panel is off until the picture is fresh (no render yet)', async () => {
    const out = await html()
    expect(out).toContain('Updating your invitation')
    expect(out).toMatch(/<button[^>]*data-share="text"[^>]*disabled/)
  })

  it('the canvas on the page is the web canvas with the web fonts declared', async () => {
    const out = await html()
    expect(out).toContain('@font-face')
    expect(out).toContain('/evites/fonts/')
  })

  it.each([
    ['no evite yet', () => { mockDb.tables.evites = mockDb.tables.evites.filter((e) => e.id !== 'ev100000-0000-0000-0000-000000000001') }],
    ['the flag off', () => { process.env.EVITES_PAGES = 'off' }],
    ['a cancelled booking', () => { mockDb = makeHostDb({ booking: { status: 'cancelled' } }) }],
    ['an archived evite', () => { mockDb = makeHostDb({ evite: { archived_at: '2026-10-30T00:00:00Z' } }) }],
  ])('%s: "Your invitation isn’t available", with no created row', async (_n, arrange) => {
    arrange()
    const out = await html()
    expect(out).toContain('Your invitation isn&#x27;t available')
    expect(mockDb.inserts).toHaveLength(0)
    expect(out).not.toContain('Text My Invitation')
  })

  it('a failed read says "try again" - not "no invitation", and not a guessed state', async () => {
    mockDb.errors.push({ table: 'booking_payments', op: 'select' })
    const out = await html()
    expect(out).toContain('couldn&#x27;t load your invitation')
    expect(out).not.toContain('isn&#x27;t available')
    expect(out).not.toContain('Preview')
  })
})

describe('the page file', () => {
  const src = readSrc('app', 'my-booking', 'invitation', 'page.tsx')
  it('is dynamic and sends the signed-out to the login with ?next=', () => {
    expect(src).toMatch(/export const dynamic = 'force-dynamic'/)
    expect(src).toContain("redirect('/my-booking/login?next=/my-booking/invitation')")
  })
  it('creates nothing, and reads no booking ref from anywhere but the cookie', () => {
    expect(src).not.toMatch(/ensureEviteForBooking/)
    expect(src).not.toMatch(/searchParams|params\b/)
    expect(src).not.toMatch(/\.insert\(|\.update\(|\.upsert\(/)
  })
})
