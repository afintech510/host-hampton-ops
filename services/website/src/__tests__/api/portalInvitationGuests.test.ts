import { NextRequest } from 'next/server'
import { NOW } from '../helpers/eviteFixtures'
import { rsvpRow } from '../helpers/rsvpFixtures'
import { EVITE_ID, OTHER_EVITE_ID, PORTAL_SECRET, REF, makeHostDb, portalCookie } from '../helpers/hostInvitationFixtures'
import { __resetRateLimitForTests } from '@/lib/rateLimit'

/**
 * The host's guest list and manual RSVPs: `/api/portal/invitation/guests` and `/rsvps`. Portal-gated; the
 * evite is found through the cookie's booking only; nothing is sent to anybody.
 */

let db: ReturnType<typeof makeHostDb>
jest.mock('@/lib/supabase', () => ({ getSupabase: () => db.supabase }))
const mockHook = jest.fn()
jest.mock('@/lib/evites/rsvpHooks', () => ({ fireRsvpHook: (...a: unknown[]) => mockHook(...a) }))
const mockSend = jest.fn() // any outbound HTTP (Resend, Brevo, Twilio, Quo) goes through fetch

import { GET as GUESTS_GET, POST as GUESTS_POST, DELETE as GUESTS_DELETE } from '@/app/api/portal/invitation/guests/route'
import { GET as RSVPS_GET, POST as RSVPS_POST, DELETE as RSVPS_DELETE } from '@/app/api/portal/invitation/rsvps/route'

const ENV = ['EVITES_PAGES', 'EVITES_PILOT_REFS', 'PORTAL_LINK_SIGNING_SECRET', 'SUPABASE_URL'] as const
const saved: Record<string, string | undefined> = {}
const GUEST_A = '11111111-1111-4111-8111-111111111111'
const GUEST_B = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance'],
  })
  for (const k of ENV) saved[k] = process.env[k]
  process.env.EVITES_PAGES = 'on'
  delete process.env.EVITES_PILOT_REFS
  process.env.PORTAL_LINK_SIGNING_SECRET = PORTAL_SECRET
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
  __resetRateLimitForTests()
  mockHook.mockClear()
  mockSend.mockClear()
  global.fetch = mockSend as unknown as typeof fetch
  db = makeHostDb({
    rsvps: [
      rsvpRow({ id: 'aaaaaaaa-0000-4000-8000-000000000001', parent_name: 'Ann Lee', children: [{ first_name: 'Ann' }] }),
      rsvpRow({ id: 'aaaaaaaa-0000-4000-8000-000000000002', parent_name: 'Other Family', evite_id: OTHER_EVITE_ID }),
    ],
  })
  db.tables.evite_guests = [
    { id: GUEST_A, evite_id: EVITE_ID, name: 'Ann Lee', phone_e164: '+16315551234', created_at: '2026-10-20T12:00:00Z' },
    { id: GUEST_B, evite_id: OTHER_EVITE_ID, name: 'Not Mine', phone_e164: null, created_at: '2026-10-20T12:00:00Z' },
  ]
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  jest.useRealTimers()
  jest.restoreAllMocks()
})

function req(method: string, path: string, o: { cookie?: string | null; body?: unknown; ip?: string } = {}): NextRequest {
  const headers: Record<string, string> = { 'cf-connecting-ip': o.ip ?? '203.0.113.9', 'user-agent': 'UA/1.0' }
  const cookie = o.cookie === undefined ? portalCookie() : o.cookie
  if (cookie) headers.cookie = cookie
  if (method !== 'GET') headers['content-type'] = 'application/json'
  return new NextRequest(`http://localhost:3002${path}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(o.body ?? {}) })
}
const json = async (res: Response) => (await res.json()) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const G = '/api/portal/invitation/guests'
const R = '/api/portal/invitation/rsvps'
const guestRows = () => db.tables.evite_guests
const rsvpRows = () => db.tables.evite_rsvps

describe('401 / 404', () => {
  const calls: Array<[string, (c: string | null) => Promise<Response>]> = [
    ['guests GET', (cookie) => GUESTS_GET(req('GET', G, { cookie }))],
    ['guests POST', (cookie) => GUESTS_POST(req('POST', G, { cookie, body: { text: 'Ann' } }))],
    ['guests DELETE', (cookie) => GUESTS_DELETE(req('DELETE', G, { cookie, body: { all: true } }))],
    ['rsvps GET', (cookie) => RSVPS_GET(req('GET', R, { cookie }))],
    ['rsvps POST', (cookie) => RSVPS_POST(req('POST', R, { cookie, body: { status: 'no', parentName: 'X' } }))],
    ['rsvps DELETE', (cookie) => RSVPS_DELETE(req('DELETE', R, { cookie, body: { id: 'aaaaaaaa-0000-4000-8000-000000000001' } }))],
  ]
  it.each(calls)('%s: 401 with no cookie or a forged one, and nothing is read or written', async (_n, run) => {
    for (const cookie of [null, `hh_portal=${REF}:${NOW.getTime()}:${'0'.repeat(64)}`, portalCookie(REF, 'other-secret')]) {
      expect((await run(cookie)).status).toBe(401)
    }
    expect(db.selects).toHaveLength(0)
    expect(db.inserts).toHaveLength(0)
    expect(db.deletes).toHaveLength(0)
  })

  it.each(calls)('%s: 404 no-invitation when the booking has none', async (_n, run) => {
    process.env.EVITES_PAGES = 'off'
    const res = await run(portalCookie())
    expect(res.status).toBe(404)
    expect(await json(res)).toEqual({ error: 'no-invitation' })
    expect(db.inserts).toHaveLength(0)
    expect(db.deletes).toHaveLength(0)
  })
})

describe('guests', () => {
  it('GET lists only this invitation, formatted, with an answer matched by name; no-store', async () => {
    const res = await GUESTS_GET(req('GET', G))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await json(res)
    expect(body.guests).toEqual([{ id: GUEST_A, name: 'Ann Lee', phone: '(631) 555-1234', phoneE164: '+16315551234', answer: 'yes' }])
    expect(JSON.stringify(body)).not.toContain('Not Mine')
  })

  it('POST re-screens the text, adds the new ones, skips ones already on the list', async () => {
    const res = await GUESTS_POST(req('POST', G, { body: { text: 'Name,Phone\nAnn Lee, 631-555-1234\nBob Diaz, 6315550100\nCara, 555-1234\nTom & Jen' } }))
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.added).toBe(3)
    expect(body.total).toBe(4)
    expect(body.skipped).toHaveLength(1)
    const mine = guestRows().filter((g) => g.evite_id === EVITE_ID)
    expect(mine.map((g) => g.name).sort()).toEqual(['Ann Lee', 'Bob Diaz', 'Cara', 'Tom & Jen'])
    expect(mine.find((g) => g.name === 'Bob Diaz')?.phone_e164).toBe('+16315550100')
  })

  it('POST ignores an evite_id / booking_ref in the body and the URL', async () => {
    await GUESTS_POST(req('POST', `${G}?evite_id=${OTHER_EVITE_ID}`, { body: { text: 'Zed Zed', evite_id: OTHER_EVITE_ID, eviteId: OTHER_EVITE_ID, booking_ref: 'HH-TEST-2' } }))
    expect(guestRows().find((g) => g.name === 'Zed Zed')?.evite_id).toBe(EVITE_ID)
  })

  it('POST 400 on no text / nothing parseable, and nothing is written', async () => {
    expect((await GUESTS_POST(req('POST', G, { body: {} }))).status).toBe(400)
    expect((await GUESTS_POST(req('POST', G, { body: { text: '631-555-1234' } }))).status).toBe(400)
    expect(db.inserts).toHaveLength(0)
  })

  it('POST 409 once the party has happened', async () => {
    jest.setSystemTime(new Date('2026-11-20T15:00:00Z'))
    expect((await GUESTS_POST(req('POST', G, { body: { text: 'Late Guest' } }))).status).toBe(409)
    expect(db.inserts).toHaveLength(0)
  })

  it('POST: a failed insert is a 503, never a 200', async () => {
    db.errors.push({ table: 'evite_guests', op: 'insert' })
    expect((await GUESTS_POST(req('POST', G, { body: { text: 'Bob' } }))).status).toBe(503)
  })

  it('DELETE { id } removes one of THIS invitation only; another invitation\'s id removes nothing', async () => {
    const other = await GUESTS_DELETE(req('DELETE', G, { body: { id: GUEST_B } }))
    expect((await json(other)).removed).toBe(0)
    expect(guestRows().some((g) => g.id === GUEST_B)).toBe(true)
    const mine = await GUESTS_DELETE(req('DELETE', G, { body: { id: GUEST_A } }))
    expect((await json(mine)).removed).toBe(1)
    expect(guestRows().map((g) => g.id)).toEqual([GUEST_B])
  })

  it('DELETE { all: true } clears this invitation only', async () => {
    const res = await GUESTS_DELETE(req('DELETE', G, { body: { all: true, evite_id: OTHER_EVITE_ID } }))
    expect((await json(res)).removed).toBe(1)
    expect(guestRows().map((g) => g.id)).toEqual([GUEST_B])
  })

  it('DELETE with neither an id nor all is a 400 and deletes nothing', async () => {
    expect((await GUESTS_DELETE(req('DELETE', G, { body: { id: '%' } }))).status).toBe(400)
    expect((await GUESTS_DELETE(req('DELETE', G, { body: {} }))).status).toBe(400)
    expect(db.deletes).toHaveLength(0)
  })

  it('never logs a name or a phone number', async () => {
    await GUESTS_POST(req('POST', G, { body: { text: 'Secretive Person, 631-555-7777' } }))
    await GUESTS_GET(req('GET', G))
    const logged = JSON.stringify([...(console.log as jest.Mock).mock.calls, ...(console.error as jest.Mock).mock.calls])
    expect(logged).not.toMatch(/Secretive|555-7777|5557777/)
  })
})

describe('rsvps', () => {
  const kids = { status: 'yes', parentName: 'Pat Parent', children: ['Ava', 'Ben'], adultCount: 1, hasAllergy: false }

  it('POST inserts a row with added_by_host, no reminder, a 16-char nonce - and sends nothing', async () => {
    const res = await RSVPS_POST(req('POST', R, { body: { ...kids, reminderContact: 'leak@example.com', guestId: GUEST_A } }))
    expect(res.status).toBe(200)
    const { id } = await json(res)
    const row = rsvpRows().find((r) => r.id === id)!
    expect(row).toMatchObject({ evite_id: EVITE_ID, status: 'yes', parent_name: 'Pat Parent', added_by_host: true, reminder_email: null, reminder_phone_e164: null })
    expect(row.children).toEqual([{ first_name: 'Ava' }, { first_name: 'Ben' }])
    expect(String(row.edit_nonce)).toHaveLength(16)
    expect(mockHook).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
    expect(db.rpcCalls).toEqual([])
  })

  it('POST a decline needs no party', async () => {
    const res = await RSVPS_POST(req('POST', R, { body: { status: 'no', parentName: 'Bob Diaz' } }))
    expect(res.status).toBe(200)
    expect(rsvpRows().find((r) => r.parent_name === 'Bob Diaz')).toMatchObject({ status: 'no', children: [], added_by_host: true })
  })

  it('POST uses the same screens: a bad answer is a 400 naming the field', async () => {
    const res = await RSVPS_POST(req('POST', R, { body: { status: 'maybe', parentName: 'X' } }))
    expect(res.status).toBe(400)
    expect((await json(res)).field).toBe('status')
    expect((await RSVPS_POST(req('POST', R, { body: { ...kids, children: [] } }))).status).toBe(400)
    expect(db.inserts).toHaveLength(0)
  })

  it('POST ignores an evite_id in the body', async () => {
    const res = await RSVPS_POST(req('POST', R, { body: { ...kids, evite_id: OTHER_EVITE_ID, eviteId: OTHER_EVITE_ID } }))
    const { id } = await json(res)
    expect(rsvpRows().find((r) => r.id === id)?.evite_id).toBe(EVITE_ID)
  })

  it('POST 409 once the party has happened', async () => {
    jest.setSystemTime(new Date('2026-11-20T15:00:00Z'))
    expect((await RSVPS_POST(req('POST', R, { body: kids }))).status).toBe(409)
    expect(db.inserts).toHaveLength(0)
  })

  it('POST for an adult event (audience guests) takes names with no adult count', async () => {
    db = makeHostDb({ booking: { party_type: 'outside_event', party_tags: { audience: 'guests', occasion: 'baby_shower' }, quote_snapshot: { outsideEvent: true } } })
    db.tables.evite_guests = []
    const res = await RSVPS_POST(req('POST', R, { body: { status: 'yes', parentName: 'Ann Lee', children: ['Ann', 'Joe'], hasAllergy: false } }))
    expect(res.status).toBe(200)
    expect(db.tables.evite_rsvps.at(-1)).toMatchObject({ adult_count: 0, added_by_host: true })
  })

  it('GET lists this invitation\'s answers with ids and nothing private', async () => {
    const body = await json(await RSVPS_GET(req('GET', R)))
    expect(body.rsvps).toEqual([
      { id: 'aaaaaaaa-0000-4000-8000-000000000001', status: 'yes', name: 'Ann Lee', guests: ['Ann'], hasAllergy: false, allergyNote: null, addedByHost: false },
    ])
    expect(JSON.stringify(body)).not.toMatch(/Other Family|edit_nonce|reminder/)
  })

  it('DELETE removes an RSVP of THIS invitation (host-added or not), audited without names', async () => {
    const res = await RSVPS_DELETE(req('DELETE', R, { body: { id: 'aaaaaaaa-0000-4000-8000-000000000001' } }))
    expect((await json(res)).removed).toBe(1)
    expect(rsvpRows().map((r) => r.parent_name)).toEqual(['Other Family'])
    const logged = JSON.stringify((console.log as jest.Mock).mock.calls)
    expect(logged).toContain('host removed an answer')
    expect(logged).not.toMatch(/Ann Lee/)
  })

  it('DELETE cannot remove another invitation\'s RSVP, whatever the body says', async () => {
    const res = await RSVPS_DELETE(req('DELETE', R, { body: { id: 'aaaaaaaa-0000-4000-8000-000000000002', evite_id: OTHER_EVITE_ID } }))
    expect((await json(res)).removed).toBe(0)
    expect(rsvpRows()).toHaveLength(2)
  })

  it('DELETE with a malformed id is a 400', async () => {
    expect((await RSVPS_DELETE(req('DELETE', R, { body: { id: '%' } }))).status).toBe(400)
    expect(db.deletes).toHaveLength(0)
  })
})
