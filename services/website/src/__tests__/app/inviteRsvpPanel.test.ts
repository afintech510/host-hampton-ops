import { renderToStaticMarkup } from 'react-dom/server'
import { NOW } from '../helpers/eviteFixtures'
import { EVITE_ID, OTHER_EVITE_ID, SLUG, cookieFor, makeRsvpDb, rsvpRow, tokenFor } from '../helpers/rsvpFixtures'
import { readSrc } from '../helpers/sourceScan'
import { __resetRateLimitForTests } from '@/lib/rateLimit'
import { cookieName, signEditToken } from '@/lib/evites/rsvpToken'

/**
 * The invitation page with an RSVP in the picture (P06): the caller's OWN answer
 * through their cookie, the current club wording from the database, and the
 * "Reminders stopped" notice. The page must still never show another guest's row.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
let mockDb: ReturnType<typeof makeRsvpDb>
let mockHeaders: Headers
let mockCookies: Record<string, string> = {}

jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockDb.supabase }))
jest.mock('next/headers', () => ({
  headers: () => mockHeaders,
  cookies: () => ({ get: (name: string) => (name in mockCookies ? { name, value: mockCookies[name] } : undefined) }),
}))
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

import InvitePage from '@/app/i/[slug]/page'

const ENV = ['EVITES_PAGES', 'EVITES_PILOT_REFS', 'SUPABASE_URL', 'PORTAL_LINK_SIGNING_SECRET'] as const
const saved: Record<string, string | undefined> = {}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const newRequest = (): void => (require('@/lib/evites/requestCache') as { __newRequest: () => void }).__newRequest()
const render = async (searchParams?: Record<string, string>): Promise<string> => {
  newRequest()
  return renderToStaticMarkup((await InvitePage({ params: { slug: SLUG }, searchParams })) as any)
}
const rsvpReads = () => mockDb.selects.filter((s) => s.table === 'evite_rsvps')

const THEIRS = () => rsvpRow({ parent_name: 'Zed Secretparent', children: [{ first_name: 'Quincy' }], allergy_note: 'shellfish', has_allergy: true, note_to_honoree: 'a private note', reminder_email: 'zed@example.com' })

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance'],
  })
  for (const k of ENV) saved[k] = process.env[k]
  process.env.EVITES_PAGES = 'on'
  delete process.env.EVITES_PILOT_REFS
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
  process.env.PORTAL_LINK_SIGNING_SECRET = 'test-signing-secret-0123456789abcdef'
  __resetRateLimitForTests()
  mockHeaders = new Headers({ 'cf-connecting-ip': '203.0.113.9' })
  mockCookies = {}
  mockDb = makeRsvpDb({ rsvps: [THEIRS()] })
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

describe('a stranger (no cookie)', () => {
  it('gets the first screen, and the page reads no RSVP at all', async () => {
    const out = await render()
    expect(out).toContain('data-screen="1"')
    expect(out).toMatch(/Yes, we&#x27;ll be there/)
    expect(rsvpReads()).toHaveLength(0)
    for (const leak of ['Zed', 'Quincy', 'shellfish', 'a private note', 'zed@example.com']) expect(out).not.toContain(leak)
  })
  it('?edit=1 changes nothing for someone with no answer', async () => {
    const out = await render({ edit: '1' })
    expect(out).toContain('data-screen="1"')
    expect(out).not.toContain('Update your RSVP')
  })
})

describe("a returning guest (valid cookie)", () => {
  const own = () => rsvpRow({ parent_name: 'Pat Parent', children: [{ first_name: 'Ava' }, { first_name: 'Ben' }], adult_count: 2, reminder_email: 'pat@example.com' })

  it('sees their own answer with an Edit option, and nobody else\'s', async () => {
    const mine = own()
    mockDb = makeRsvpDb({ rsvps: [THEIRS(), mine] })
    mockCookies = { [cookieName(EVITE_ID)]: tokenFor(mine) }
    const out = await render()
    expect(out).toContain('data-screen="3"')
    expect(out).toContain('Ava, Ben')
    expect(out).toContain('Change my RSVP')
    expect(out).toContain('pat@example.com') // their own reminder address, prefilled for the club box
    for (const leak of ['Zed', 'Quincy', 'shellfish', 'a private note', 'zed@example.com', 'edit_nonce', String(mine.id), String(mine.edit_nonce)]) expect(out).not.toContain(leak)
  })
  it("the page reads exactly their row: filtered on the token's own id and this evite", async () => {
    const mine = own()
    mockDb = makeRsvpDb({ rsvps: [THEIRS(), mine] })
    mockCookies = { [cookieName(EVITE_ID)]: tokenFor(mine) }
    await render()
    const cols = rsvpReads().map((s) => s.cols)
    expect(cols.length).toBeGreaterThan(0)
    for (const c of cols) expect(c).not.toBe('*')
    expect(cols.some((c) => c.includes('edit_nonce') && !c.includes('evite_id, edit_nonce'))).toBe(false)
  })
  it('?edit=1 opens the first screen in edit mode with their answers filled in', async () => {
    const mine = own()
    mockDb = makeRsvpDb({ rsvps: [mine] })
    mockCookies = { [cookieName(EVITE_ID)]: tokenFor(mine) }
    const out = await render({ edit: '1' })
    expect(out).toContain('data-screen="1"')
    expect(out).toContain('Update your RSVP')
  })
  it('a forged, expired, revoked or other-party cookie is just a stranger', async () => {
    const mine = own()
    const theirs = rsvpRow({ evite_id: OTHER_EVITE_ID })
    mockDb = makeRsvpDb({ rsvps: [mine, theirs] })
    const exp = Math.floor(Date.parse('2026-12-20T00:00:00Z') / 1000)
    const tokens = [
      'garbage',
      `${mine.id}.${exp}.${'A'.repeat(43)}`,
      signEditToken({ id: String(mine.id), edit_nonce: String(mine.edit_nonce) }, Math.floor(NOW.getTime() / 1000) - 5),
      signEditToken({ id: String(mine.id), edit_nonce: 'NotTheRealNonce1' }, exp),
      tokenFor(theirs),
    ]
    for (const t of tokens) {
      mockCookies = { [cookieName(EVITE_ID)]: t }
      const out = await render()
      expect(out).toContain('data-screen="1"')
      expect(out).not.toContain('Ava')
    }
  })
  it('a read error is the error page (500), never the blank form for someone who has answered', async () => {
    const mine = own()
    mockDb = makeRsvpDb({ rsvps: [mine] })
    mockCookies = { [cookieName(EVITE_ID)]: tokenFor(mine) }
    mockDb.errors.push({ table: 'evite_rsvps', op: 'select' })
    await expect(render()).rejects.toThrow()
  })
  it('a saved decline shows the declined screen', async () => {
    const mine = rsvpRow({ status: 'no', children: [], adult_count: 0, has_allergy: null })
    mockDb = makeRsvpDb({ rsvps: [mine] })
    mockCookies = { [cookieName(EVITE_ID)]: cookieFor(EVITE_ID, tokenFor(mine)).split('=')[1] }
    expect(await render()).toContain('Thanks for letting us know')
  })
})

describe('the Birthday Club wording', () => {
  /** The confirmed screen for a guest whose database has the given consent rows (and, optionally, a failing consent read). */
  const confirmedPage = async (consent?: Array<Record<string, unknown>>, failConsent = false) => {
    const mine = rsvpRow()
    mockDb = makeRsvpDb({ rsvps: [mine], ...(consent ? { consent } : {}) })
    if (failConsent) mockDb.errors.push({ table: 'evite_consent_texts', op: 'select' })
    mockCookies = { [cookieName(EVITE_ID)]: tokenFor(mine) }
    return render()
  }
  it('is the database row, character for character', async () => {
    const out = await confirmedPage([{ version: 'club-v1', channel: 'email', wording: 'Send me party & craft ideas from Host Hampton', created_at: '2026-10-10T00:00:00Z' }])
    expect(out).toContain('Send me party &amp; craft ideas from Host Hampton')
    expect(out).toContain('Unsubscribe anytime.')
  })
  it('follows a newer row', async () => {
    const out = await confirmedPage([
      { version: 'club-v1', channel: 'email', wording: 'Old words', created_at: '2026-10-10T00:00:00Z' },
      { version: 'club-v2', channel: 'email', wording: 'New words', created_at: '2026-11-01T00:00:00Z' },
    ])
    expect(out).toContain('New words')
    expect(out).not.toContain('Old words')
  })
  it('an unreadable table, or no row, hides the card rather than showing unofficial wording', async () => {
    const failed = await confirmedPage(undefined, true)
    expect(failed).toContain('data-screen="3"')
    expect(failed).not.toMatch(/Birthday Club|rsvp-club|craft ideas/)
    const none = await confirmedPage([])
    expect(none).not.toMatch(/Birthday Club|rsvp-club|craft ideas/)
  })
  it('is never rendered on the first screens', async () => {
    mockDb = makeRsvpDb()
    const out = await render()
    expect(out).not.toMatch(/Birthday Club|craft ideas|Unsubscribe anytime/)
  })
})

describe('only a live party takes RSVPs', () => {
  it('a preview reads no RSVP and no consent text and draws no RSVP area', async () => {
    mockDb = makeRsvpDb({ payments: [], booking: { status: 'lead' } })
    mockCookies = { [cookieName(EVITE_ID)]: 'whatever' }
    const out = await render()
    expect(out).not.toContain('data-screen')
    expect(rsvpReads()).toHaveLength(0)
    expect(mockDb.selects.filter((s) => s.table === 'evite_consent_texts')).toHaveLength(0)
  })
})

describe('?stopped=1', () => {
  it('shows "Reminders stopped"', async () => {
    const out = await render({ stopped: '1' })
    expect(out).toContain('Reminders stopped')
    expect(out).toContain('role="status"')
  })
  it('only the exact value 1 does', async () => {
    for (const v of ['0', 'true', '']) expect(await render({ stopped: v })).not.toContain('Reminders stopped')
    expect(await render()).not.toContain('Reminders stopped')
  })
})

describe('page source', () => {
  const page = readSrc('app', 'i', '[slug]', 'page.tsx')
  it('the page itself still reads nothing and never touches cookies', () => {
    expect(page).not.toMatch(/getSupabase|\.from\(|resolveEviteBySlug|cookies\(\)|evite_rsvps/)
    expect(page).toMatch(/loadInvite\s*\(/)
    expect(page).toMatch(/loadRsvpPanel\s*\(/)
  })
  it('loads the panel only after the rate-limited invitation load, and only for a live party', () => {
    expect(page.search(/loadInvite\s*\(/)).toBeLessThan(page.search(/loadRsvpPanel\s*\(/))
    expect(page).toMatch(/if\s*\(\s*model\.showRsvp\s*\)[^\n]*loadRsvpPanel/)
  })
})
