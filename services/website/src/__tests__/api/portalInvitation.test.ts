import { NextRequest } from 'next/server'
import { NOW, bookingRow, evitesRow, LINE_ITEM_ROWS, THEME_ROWS } from '../helpers/eviteFixtures'
import { rsvpRow } from '../helpers/rsvpFixtures'
import {
  EVITE_ID,
  OTHER_EVITE_ID,
  OTHER_REF,
  PORTAL_SECRET,
  PRIVATE_KEYS,
  PRIVATE_VALUES,
  REF,
  guest,
  makeHostDb,
  portalCookie,
} from '../helpers/hostInvitationFixtures'
import { __resetRateLimitForTests } from '@/lib/rateLimit'
import { buildPortalCookieValue } from '@/lib/portalAuth'
import { inviteFacts } from '@/lib/evites/facts'
import { renderInputsHash } from '@/lib/evites/hash'
import { HOST_RSVP_COLUMNS } from '@/lib/evites/views'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'

/**
 * `GET`/`PATCH /api/portal/invitation` and `POST /api/portal/invitation/event` (spec §7.2).
 * Driven end to end against the in-memory Supabase: the portal cookie is the only credential,
 * the response is the host's view and nothing more, and a PATCH writes six columns and queues
 * a render.
 */

let db: ReturnType<typeof makeHostDb>
jest.mock('@/lib/supabase', () => ({ getSupabase: () => db.supabase }))
const mockQueueRender = jest.fn((_id: string) => 'queued' as const)
jest.mock('@/lib/evites/render', () => ({ queueRender: (id: string) => mockQueueRender(id) }))

import { GET, PATCH } from '@/app/api/portal/invitation/route'
import { POST as EVENT } from '@/app/api/portal/invitation/event/route'

const ENV = ['EVITES_PAGES', 'EVITES_PILOT_REFS', 'PORTAL_LINK_SIGNING_SECRET', 'SUPABASE_URL'] as const
const saved: Record<string, string | undefined> = {}
const KEY = 'a'.repeat(32)
const SUPABASE = 'https://proj.supabase.co'

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance'],
  })
  for (const k of ENV) saved[k] = process.env[k]
  process.env.EVITES_PAGES = 'on'
  delete process.env.EVITES_PILOT_REFS
  process.env.PORTAL_LINK_SIGNING_SECRET = PORTAL_SECRET
  process.env.SUPABASE_URL = SUPABASE
  __resetRateLimitForTests()
  mockQueueRender.mockClear()
  db = makeHostDb()
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

interface Opts {
  cookie?: string | null
  body?: unknown
  raw?: string
  ip?: string
}

function request(method: 'GET' | 'PATCH' | 'POST', path: string, o: Opts = {}): NextRequest {
  const headers: Record<string, string> = { 'cf-connecting-ip': o.ip ?? '203.0.113.9', 'user-agent': 'UA/1.0' }
  const cookie = o.cookie === undefined ? portalCookie() : o.cookie
  if (cookie) headers.cookie = cookie
  if (method !== 'GET') headers['content-type'] = 'application/json'
  return new NextRequest(`http://localhost:3002${path}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : (o.raw ?? JSON.stringify(o.body ?? {})),
  })
}

const get = (o: Opts = {}) => GET(request('GET', '/api/portal/invitation', o))
const patch = (body: unknown, o: Opts = {}) => PATCH(request('PATCH', '/api/portal/invitation', { ...o, body }))
const event = (body: unknown, o: Opts = {}) => EVENT(request('POST', '/api/portal/invitation/event', { ...o, body }))
const json = async (res: Response) => (await res.json()) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const eviteUpdates = () => db.updates.filter((u) => u.table === 'evites')
const eviteEvents = () => db.inserts.filter((i) => i.table === 'evite_events').map((i) => i.row)

// ------------------------------------------------------------------------------------------------

describe('401 without a portal session', () => {
  const bad: Array<[string, string | null]> = [
    ['no cookie', null],
    ['a forged signature', `hh_portal=${REF}:${NOW.getTime()}:${'0'.repeat(64)}`],
    ['the wrong secret', portalCookie(REF, 'some-other-secret')],
    ['an expired (31-day-old, correctly signed) cookie', `hh_portal=${buildPortalCookieValue(REF, PORTAL_SECRET, NOW.getTime() - 31 * 864e5)}`],
    ['an admin-looking cookie', 'hh_admin=anything'],
    ['the legacy form with a bad signature', `hh_portal=${REF}:deadbeef`],
  ]

  it.each(bad)('GET: %s', async (_n, cookie) => {
    const res = await get({ cookie })
    expect(res.status).toBe(401)
    expect(db.selects).toHaveLength(0) // not one row was read
  })

  it.each(bad)('PATCH: %s', async (_n, cookie) => {
    const res = await patch({ host_note: 'hi' }, { cookie })
    expect(res.status).toBe(401)
    expect(db.selects).toHaveLength(0)
    expect(eviteUpdates()).toHaveLength(0)
    expect(mockQueueRender).not.toHaveBeenCalled()
  })

  it.each(bad)('event: %s', async (_n, cookie) => {
    const res = await event({ event: 'share_clicked' }, { cookie })
    expect(res.status).toBe(401)
    expect(db.selects).toHaveLength(0)
    expect(eviteEvents()).toHaveLength(0)
  })

  it('401 comes before 404: with the pages flag off, an anonymous caller still gets 401', async () => {
    process.env.EVITES_PAGES = 'off'
    expect((await get({ cookie: null })).status).toBe(401)
  })

  it('a cookie does not let you name another booking: the ref comes from the signature, nothing in the URL or body', async () => {
    const res = await PATCH(request('PATCH', `/api/portal/invitation?ref=${OTHER_REF}&booking_ref=${OTHER_REF}`, { body: { host_note: 'mine' } }))
    expect(res.status).toBe(200)
    const touched = eviteUpdates().map((u) => u.filters.find((f) => f.col === 'id')?.val)
    expect(touched).toEqual([EVITE_ID])
    expect(db.tables.evites.find((e) => e.id === OTHER_EVITE_ID)?.host_note).toBeNull()
  })
})

// ------------------------------------------------------------------------------------------------

describe('GET: the response is exactly the host view (spec §7.2)', () => {
  it('has exactly these top-level keys, and facts / summary / customize / images have exactly theirs', async () => {
    db = makeHostDb({ rsvps: [guest()] })
    const res = await get()
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(Object.keys(body).sort()).toEqual(['customize', 'deadlineRange', 'facts', 'images', 'renderFresh', 'rsvps', 'state', 'summary', 'url'])
    expect(Object.keys(body.facts).sort()).toEqual([
      'dateLine',
      'giftNote',
      'guestCap',
      'honoreeName',
      'hostContactLine',
      'hostNote',
      'placeLine',
      'reshareText',
      'rsvpDeadline',
      'shareText',
      'shortDateLine',
      'title',
    ])
    expect(Object.keys(body.summary).sort()).toEqual(['adultsPlus', 'adultsYes', 'allergies', 'cap', 'kidsYes', 'noCount'])
    expect(Object.keys(body.customize).sort()).toEqual(['gift_note', 'host_contact_name', 'host_contact_phone', 'host_note', 'rsvp_deadline', 'show_host_contact'])
    expect(Object.keys(body.images).sort()).toEqual(['invite', 'og'])
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('every RSVP carries exactly HOST_RSVP_COLUMNS - and none of the private columns or values, even though the database rows hold them', async () => {
    db = makeHostDb({
      rsvps: [guest({ has_allergy: true, allergy_note: 'peanuts', note_to_honoree: 'Happy birthday!' }), guest({ status: 'no', children: [], child_count: 0, adult_count: 0 })],
    })
    // The fixture really does hold the private data...
    expect(JSON.stringify(db.tables.evite_rsvps)).toContain('leak-email@example.com')
    const res = await get()
    const body = await json(res)
    const text = JSON.stringify(body)

    expect(body.rsvps).toHaveLength(2)
    for (const r of body.rsvps) expect(Object.keys(r).sort()).toEqual([...HOST_RSVP_COLUMNS].sort())
    for (const k of PRIVATE_KEYS) expect(text).not.toContain(`"${k}"`)
    for (const v of PRIVATE_VALUES) expect(text).not.toContain(v)
    // ...and the evite's own id, the booking id and the bookkeeping never leave either.
    expect(text).not.toContain(EVITE_ID)
    expect(text).not.toContain('"id"')
    expect(text).not.toContain('bk-1')
    expect(text).not.toContain('contact_email')
    expect(text).not.toContain('pat@example.com')
    expect(text).not.toMatch(/render_(version|inputs_hash|claim|error)|image_key|edit_nonce/)
  })

  it('the RSVP read names HOST_RSVP_COLUMNS and nothing else (never select *)', async () => {
    db = makeHostDb({ rsvps: [guest()] })
    await get()
    const reads = db.selects.filter((s) => s.table === 'evite_rsvps')
    expect(reads).toHaveLength(1)
    expect(reads[0].cols).toBe(HOST_RSVP_COLUMNS.join(', '))
    expect(db.selects.every((s) => s.cols !== '*' && s.cols !== '')).toBe(true)
  })

  it('the public link is absolute on the canonical origin and holds the slug; it never comes from a request header', async () => {
    const res = await GET(request('GET', '/api/portal/invitation'))
    expect((await json(res)).url).toBe(`${CANONICAL_ORIGIN}/i/mia-glow-7kq2`)
    const hostile = new NextRequest('http://localhost:3002/api/portal/invitation', {
      headers: { cookie: portalCookie(), 'x-forwarded-host': 'evil.example.com', host: 'evil.example.com' },
    })
    expect((await json(await GET(hostile))).url).toBe(`${CANONICAL_ORIGIN}/i/mia-glow-7kq2`)
  })

  it('prefills the form from the stored customisations', async () => {
    db = makeHostDb({ evite: { host_note: 'Bring a towel', gift_note: 'No gifts', rsvp_deadline: '2026-11-08', show_host_contact: false, host_contact_name: 'Pat', host_contact_phone: '212-555-0100' } })
    const body = await json(await get())
    expect(body.customize).toEqual({ host_note: 'Bring a towel', gift_note: 'No gifts', rsvp_deadline: '2026-11-08', show_host_contact: false, host_contact_name: 'Pat', host_contact_phone: '212-555-0100' })
    expect(body.deadlineRange).toEqual({ min: '2026-11-01', max: '2026-11-14' })
    expect(body.facts.hostNote).toBe('Bring a towel')
    expect(body.facts.rsvpDeadline).toBe('2026-11-08')
    expect(body.facts.hostContactLine).toBeNull() // hidden
  })

  it('never creates anything: a GET writes no row, anywhere', async () => {
    await get()
    expect(db.inserts).toHaveLength(0)
    expect(db.updates).toHaveLength(0)
    expect(mockQueueRender).not.toHaveBeenCalled()
  })

  it('with no RSVPs the birthday child is not counted as a guest', async () => {
    const body = await json(await get())
    expect(body.summary).toEqual({ kidsYes: 0, adultsYes: 0, adultsPlus: false, noCount: 0, cap: 12, allergies: [] })
    expect(body.rsvps).toEqual([])
  })
})

describe('GET: summary math with siblings', () => {
  it('kids sum child_count over yes answers; adults count "2+" as 2 and say so; no-answers are counted apart; allergies roll up', async () => {
    db = makeHostDb({
      rsvps: [
        guest({ parent_name: 'Ann A', children: [{ first_name: 'Ava' }, { first_name: 'Ben' }], adult_count: 2, has_allergy: true, allergy_note: 'peanuts', created_at: '2026-10-20T10:00:00Z' }),
        guest({ parent_name: 'Bo B', children: [{ first_name: 'Cy' }], adult_count: 1, has_allergy: false, created_at: '2026-10-20T11:00:00Z' }),
        guest({ parent_name: 'Cat C', status: 'no', children: [], adult_count: 0, created_at: '2026-10-20T12:00:00Z' }),
        guest({ parent_name: 'Di D', children: [{ first_name: 'Eli' }, { first_name: 'Fay' }, { first_name: 'Gus' }], adult_count: 0, has_allergy: true, allergy_note: null, created_at: '2026-10-20T13:00:00Z' }),
      ],
    })
    const { summary } = await json(await get())
    expect(summary.kidsYes).toBe(6)
    expect(summary.adultsYes).toBe(3)
    expect(summary.adultsPlus).toBe(true)
    expect(summary.noCount).toBe(1)
    expect(summary.cap).toBe(12)
    expect(summary.allergies).toEqual([
      { parent: 'Ann A', children: ['Ava', 'Ben'], note: 'peanuts' },
      { parent: 'Di D', children: ['Eli', 'Fay', 'Gus'], note: null },
    ])
  })

  it('"2+" is a floor only when somebody said it: adultsPlus stays false with exact counts', async () => {
    db = makeHostDb({ rsvps: [guest({ adult_count: 1 }), guest({ adult_count: 1 })] })
    const { summary } = await json(await get())
    expect(summary.adultsYes).toBe(2)
    expect(summary.adultsPlus).toBe(false)
  })

  it('an over-cap party reads as more kids than the booking holds ("11 of 10")', async () => {
    db = makeHostDb({
      booking: { guest_count_approx: 10 },
      rsvps: [
        guest({ children: Array.from({ length: 6 }, (_, i) => ({ first_name: `K${i}` })) }),
        guest({ children: Array.from({ length: 5 }, (_, i) => ({ first_name: `L${i}` })) }),
      ],
    })
    const { summary } = await json(await get())
    expect(summary.kidsYes).toBe(11)
    expect(summary.cap).toBe(10)
  })

  it('a no-answer with a stale child list (it cannot exist in the table) is never counted as kids', async () => {
    db = makeHostDb({ rsvps: [guest({ status: 'no', children: [{ first_name: 'Ghost' }], adult_count: 2 })] })
    const { summary } = await json(await get())
    expect(summary).toMatchObject({ kidsYes: 0, adultsYes: 0, adultsPlus: false, noCount: 1 })
  })

  it('a booking with no guest count has no cap', async () => {
    db = makeHostDb({ booking: { guest_count_approx: null } })
    expect((await json(await get())).summary.cap).toBeNull()
  })

  it('answers for another family are not in this host’s list', async () => {
    db = makeHostDb({ rsvps: [guest({ parent_name: 'Mine' }), guest({ evite_id: OTHER_EVITE_ID, parent_name: 'Theirs' })] })
    const body = await json(await get())
    expect(body.rsvps.map((r: { parent_name: string }) => r.parent_name)).toEqual(['Mine'])
  })
})

describe('GET: state, images and renderFresh', () => {
  const liveFacts = () => inviteFacts(bookingRow() as never, evitesRow() as never, LINE_ITEM_ROWS as never, THEME_ROWS as never, 'live')
  const rendered = (over: Record<string, unknown> = {}) => ({
    image_key: KEY,
    invite_object: 'invite-v1-9f2c.jpg',
    og_object: 'og-v1-9f2c.jpg',
    render_inputs_hash: renderInputsHash(liveFacts()),
    ...over,
  })

  it('a live party with no render yet: not fresh, no image URLs', async () => {
    const body = await json(await get())
    expect(body.state).toBe('live')
    expect(body.renderFresh).toBe(false)
    expect(body.images).toEqual({ invite: null, og: null })
  })

  it('objects exist AND the hash matches the current facts: fresh, with the storage URLs', async () => {
    db = makeHostDb({ evite: rendered() })
    const body = await json(await get())
    expect(body.renderFresh).toBe(true)
    expect(body.images.invite).toBe(`${SUPABASE}/storage/v1/object/public/evites/${KEY}/invite-v1-9f2c.jpg`)
    expect(body.images.og).toBe(`${SUPABASE}/storage/v1/object/public/evites/${KEY}/og-v1-9f2c.jpg`)
  })

  it('objects exist but the hash is of other facts: not fresh (the picture is stale)', async () => {
    db = makeHostDb({ evite: rendered({ render_inputs_hash: 'f'.repeat(64) }) })
    const body = await json(await get())
    expect(body.renderFresh).toBe(false)
    expect(body.images.invite).not.toBeNull() // there IS a picture; it is just out of date
  })

  it('a matching hash with no objects is not fresh either', async () => {
    db = makeHostDb({ evite: rendered({ invite_object: null, og_object: null }) })
    expect((await json(await get())).renderFresh).toBe(false)
  })

  it('a malformed object name is treated as no image', async () => {
    db = makeHostDb({ evite: rendered({ invite_object: '../../etc/passwd' }) })
    const body = await json(await get())
    expect(body.images.invite).toBeNull()
    expect(body.renderFresh).toBe(false)
  })

  it('the hash was taken on the card as it stood; a host edit makes it stale again', async () => {
    db = makeHostDb({ evite: rendered({ host_contact_name: 'Pat' }) }) // hostContactLine is printed on the picture
    expect((await json(await get())).renderFresh).toBe(false)
  })

  it('preview: not booked yet', async () => {
    db = makeHostDb({ booking: { status: 'awaiting_deposit' }, payments: [] })
    const body = await json(await get())
    expect(body.state).toBe('preview')
    expect(body.facts.dateLine).toBe('Pick your date')
  })

  it('needs_time: booked with no start time', async () => {
    db = makeHostDb({ booking: { party_time: 'TBD' } })
    expect((await json(await get())).state).toBe('needs_time')
  })

  it('closed: the party has happened, and the RSVPs are still shown', async () => {
    db = makeHostDb({ booking: { party_date: '2026-10-20' }, rsvps: [guest()] })
    const body = await json(await get())
    expect(body.state).toBe('closed')
    expect(body.rsvps).toHaveLength(1)
  })
})

describe('GET: no invitation the host may see is a 404 {error:"no-invitation"}', () => {
  const expectNone = async () => {
    const res = await get()
    expect(res.status).toBe(404)
    expect(await json(res)).toEqual({ error: 'no-invitation' })
    expect(db.inserts).toHaveLength(0) // and it did not create one
  }

  it('the booking has no evite yet (flag on, not ensured)', async () => {
    db.tables.evites = db.tables.evites.filter((e) => e.id !== EVITE_ID)
    await expectNone()
  })
  it('the pages flag is off: answered before any read', async () => {
    process.env.EVITES_PAGES = 'off'
    await expectNone()
    expect(db.selects).toHaveLength(0)
  })
  it('unset or a typo reads as off', async () => {
    delete process.env.EVITES_PAGES
    await expectNone()
    process.env.EVITES_PAGES = 'true'
    await expectNone()
  })
  it('pilot mode: not a pilot booking', async () => {
    process.env.EVITES_PAGES = 'pilot'
    process.env.EVITES_PILOT_REFS = 'HH-SOMEONE-ELSE'
    await expectNone()
    expect(db.selects).toHaveLength(0)
  })
  it('pilot mode: a pilot booking is shown', async () => {
    process.env.EVITES_PAGES = 'pilot'
    process.env.EVITES_PILOT_REFS = 'hh-test-1'
    expect((await get()).status).toBe(200)
  })
  it('archived', async () => {
    db = makeHostDb({ evite: { archived_at: '2026-10-30T00:00:00Z' } })
    await expectNone()
  })
  it.each(['cancelled', 'lost'])('a %s booking', async (status) => {
    db = makeHostDb({ booking: { status } })
    await expectNone()
  })
  it('a booking ref that matches nothing', async () => {
    const res = await get({ cookie: portalCookie('HH-NOPE-0') })
    expect(res.status).toBe(404)
  })
})

describe('GET: a failed read is a 503 and never a wrong answer', () => {
  it.each(['bookings', 'evites', 'booking_payments', 'booking_line_items', 'party_themes', 'evite_rsvps'])('%s', async (table) => {
    db.errors.push({ table, op: 'select' })
    const res = await get()
    expect(res.status).toBe(503)
    const body = await json(res)
    expect(body.state).toBeUndefined()
    expect(body.error).toBeDefined()
    expect(body.rsvps).toBeUndefined()
  })
})

// ------------------------------------------------------------------------------------------------

describe('PATCH', () => {
  it('saves exactly the columns sent, on the evite the cookie’s booking owns, then queues one render', async () => {
    const res = await patch({ host_note: ' See you there! ', gift_note: '', rsvp_deadline: '2026-11-08', show_host_contact: true, host_contact_name: 'Pat', host_contact_phone: '212-555-0100' })
    expect(res.status).toBe(200)
    expect(eviteUpdates()).toHaveLength(1)
    const [u] = eviteUpdates()
    expect(u.patch).toEqual({ host_note: 'See you there!', gift_note: null, rsvp_deadline: '2026-11-08', show_host_contact: true, host_contact_name: 'Pat', host_contact_phone: '212-555-0100' })
    expect(u.filters.find((f) => f.col === 'id')?.val).toBe(EVITE_ID)
    expect(u.matched).toBe(1)
    expect(mockQueueRender).toHaveBeenCalledTimes(1)
    expect(mockQueueRender).toHaveBeenCalledWith(EVITE_ID)
  })

  it('answers with the same shape as GET, already showing the new values, and not fresh', async () => {
    db = makeHostDb({ evite: { image_key: KEY, invite_object: 'invite-v1-9f2c.jpg', og_object: 'og-v1-9f2c.jpg', render_inputs_hash: renderInputsHash(inviteFacts(bookingRow() as never, evitesRow() as never, LINE_ITEM_ROWS as never, THEME_ROWS as never, 'live')) } })
    expect((await json(await get())).renderFresh).toBe(true)
    const body = await json(await patch({ host_contact_name: 'Pat' }))
    expect(Object.keys(body).sort()).toEqual(['customize', 'deadlineRange', 'facts', 'images', 'renderFresh', 'rsvps', 'state', 'summary', 'url'])
    expect(body.customize.host_contact_name).toBe('Pat')
    expect(body.facts.hostContactLine).toContain('Pat')
    expect(body.renderFresh).toBe(false)
    expect(JSON.stringify(body)).not.toContain(EVITE_ID)
  })

  it('a note that does not touch the picture leaves it fresh (the hash covers what is printed)', async () => {
    db = makeHostDb({ evite: { image_key: KEY, invite_object: 'invite-v1-9f2c.jpg', og_object: 'og-v1-9f2c.jpg', render_inputs_hash: renderInputsHash(inviteFacts(bookingRow() as never, evitesRow() as never, LINE_ITEM_ROWS as never, THEME_ROWS as never, 'live')) } })
    const body = await json(await patch({ host_note: 'Hello' }))
    expect(body.renderFresh).toBe(true)
    expect(body.facts.hostNote).toBe('Hello')
  })

  it.each(['id', 'evite_id', 'booking_id', 'slug', 'theme_word', 'render_inputs_hash', 'archived_at', 'edit_nonce'])('an unknown field (%s) is a 400 and nothing is written or queued', async (k) => {
    const res = await patch({ host_note: 'hi', [k]: 'x' })
    expect(res.status).toBe(400)
    expect((await json(res)).field).toBe(k)
    expect(eviteUpdates()).toHaveLength(0)
    expect(mockQueueRender).not.toHaveBeenCalled()
  })

  it('an id in the body cannot redirect the write to another evite', async () => {
    const res = await patch({ host_note: 'hi', id: OTHER_EVITE_ID })
    expect(res.status).toBe(400)
    expect(db.tables.evites.find((e) => e.id === OTHER_EVITE_ID)?.host_note).toBeNull()
  })

  it('invalid JSON and an empty body are 400s', async () => {
    expect((await PATCH(request('PATCH', '/api/portal/invitation', { raw: '{nope' }))).status).toBe(400)
    expect((await patch({})).status).toBe(400)
    expect((await patch([])).status).toBe(400)
    expect(eviteUpdates()).toHaveLength(0)
  })

  it.each(['(631) 555-0123', '6315550123', '555-0123', '131-555-0123', '631-555-0123 x5', 'call me', '<script>'])('screens the phone format: %j is a 400 naming the field', async (phone) => {
    const res = await patch({ host_contact_phone: phone })
    expect(res.status).toBe(400)
    expect((await json(res)).field).toBe('host_contact_phone')
    expect(eviteUpdates()).toHaveLength(0)
    expect(mockQueueRender).not.toHaveBeenCalled()
  })

  it('an empty phone means the studio default (NULL)', async () => {
    db = makeHostDb({ evite: { host_contact_phone: '212-555-0100' } })
    const res = await patch({ host_contact_phone: '' })
    expect(res.status).toBe(200)
    expect(eviteUpdates()[0].patch).toEqual({ host_contact_phone: null })
  })

  describe('rsvp_deadline must fall in today ... party_date (today is 1 Nov, the party is 14 Nov)', () => {
    it.each(['2026-11-01', '2026-11-07', '2026-11-14'])('%s is accepted', async (d) => {
      const res = await patch({ rsvp_deadline: d })
      expect(res.status).toBe(200)
      expect(eviteUpdates()[0].patch).toEqual({ rsvp_deadline: d })
    })
    it.each(['2026-10-31', '2026-11-15', '2027-01-01', '2026-02-30', 'soon', '11/07/2026'])('%s is refused', async (d) => {
      const res = await patch({ rsvp_deadline: d })
      expect(res.status).toBe(400)
      expect((await json(res)).field).toBe('rsvp_deadline')
      expect(eviteUpdates()).toHaveLength(0)
    })
    it('null clears it', async () => {
      db = makeHostDb({ evite: { rsvp_deadline: '2026-11-08' } })
      expect((await patch({ rsvp_deadline: null })).status).toBe(200)
      expect(eviteUpdates()[0].patch).toEqual({ rsvp_deadline: null })
    })
    it('"today" is the Eastern date, not the UTC one', async () => {
      // 02:00Z on 2 Nov is still the evening of 1 Nov in New York.
      jest.setSystemTime(new Date('2026-11-02T02:00:00Z'))
      expect((await patch({ rsvp_deadline: '2026-11-01' })).status).toBe(200)
    })
  })

  it('140-character notes pass and 141 do not', async () => {
    expect((await patch({ host_note: 'a'.repeat(140), gift_note: 'b'.repeat(140) })).status).toBe(200)
    expect((await patch({ host_note: 'a'.repeat(141) })).status).toBe(400)
    expect((await patch({ gift_note: 'b'.repeat(141) })).status).toBe(400)
  })

  it('a name over 40 characters and a non-boolean toggle are refused', async () => {
    expect((await patch({ host_contact_name: 'n'.repeat(41) })).status).toBe(400)
    expect((await patch({ show_host_contact: 'no' })).status).toBe(400)
  })

  it('a failed UPDATE is a 503, and no render is queued for a change that did not land', async () => {
    db.errors.push({ table: 'evites', op: 'update' })
    const res = await patch({ host_note: 'hi' })
    expect(res.status).toBe(503)
    expect(mockQueueRender).not.toHaveBeenCalled()
  })

  it('an UPDATE that changed no row (archived in the meantime) is a 404, not a silent success', async () => {
    db.hooks.beforeUpdate = (info, tables) => {
      if (info.table === 'evites') for (const e of tables.evites) e.archived_at = '2026-11-01T14:59:00Z'
    }
    const res = await patch({ host_note: 'hi' })
    expect(res.status).toBe(404)
    expect(mockQueueRender).not.toHaveBeenCalled()
  })

  it('a party that has happened can no longer be customised (409), and nothing is written', async () => {
    db = makeHostDb({ booking: { party_date: '2026-10-20' } })
    const res = await patch({ host_note: 'hi' })
    expect(res.status).toBe(409)
    expect(eviteUpdates()).toHaveLength(0)
    expect(mockQueueRender).not.toHaveBeenCalled()
  })

  it.each([
    ['no evite', () => { db.tables.evites = db.tables.evites.filter((e) => e.id !== EVITE_ID) }, 404],
    ['flag off', () => { process.env.EVITES_PAGES = 'off' }, 404],
    ['cancelled', () => { db = makeHostDb({ booking: { status: 'cancelled' } }) }, 404],
  ])('%s: refused, nothing written', async (_n, arrange, status) => {
    arrange()
    const res = await patch({ host_note: 'hi' })
    expect(res.status).toBe(status)
    expect(eviteUpdates()).toHaveLength(0)
    expect(mockQueueRender).not.toHaveBeenCalled()
  })

  it('a failed read before the write is a 503 and nothing is written', async () => {
    db.errors.push({ table: 'booking_payments', op: 'select' })
    expect((await patch({ host_note: 'hi' })).status).toBe(503)
    expect(eviteUpdates()).toHaveLength(0)
  })

  it('is rate-limited per caller (plannerRule: 30 per 10 minutes) before it does any work', async () => {
    for (let i = 0; i < 30; i++) expect((await patch({ host_note: `n${i}` })).status).toBe(200)
    const before = db.selects.length
    const limited = await patch({ host_note: 'one too many' })
    expect(limited.status).toBe(429)
    expect(db.selects.length).toBe(before) // refused before a single read
    // a different caller is not affected
    expect((await patch({ host_note: 'fine' }, { ip: '198.51.100.7' })).status).toBe(200)
  })
})

// ------------------------------------------------------------------------------------------------

describe('POST /api/portal/invitation/event', () => {
  it('records share_clicked against the evite the cookie’s booking owns, and answers 204 with no body', async () => {
    const res = await event({ event: 'share_clicked' })
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(eviteEvents()).toEqual([{ evite_id: EVITE_ID, event: 'share_clicked' }])
  })

  it('a different booking’s cookie records against that booking’s evite', async () => {
    await event({ event: 'share_clicked' }, { cookie: portalCookie(OTHER_REF) })
    expect(eviteEvents()).toEqual([{ evite_id: OTHER_EVITE_ID, event: 'share_clicked' }])
  })

  it.each(['invite_viewed', 'rsvp_started', 'rsvp_completed', 'club_opted_in', 'calendar_added', 'birthday_month_saved', '', 'x', 5, null])('%j is a 400 and reads nothing', async (e) => {
    const res = await event({ event: e })
    expect(res.status).toBe(400)
    expect(db.selects).toHaveLength(0)
    expect(eviteEvents()).toHaveLength(0)
  })

  it('invalid JSON is a 400', async () => {
    expect((await EVENT(request('POST', '/api/portal/invitation/event', { raw: '{nope' }))).status).toBe(400)
  })

  it('no invitation is a 404, a failed read is a 503', async () => {
    process.env.EVITES_PAGES = 'off'
    expect((await event({ event: 'share_clicked' })).status).toBe(404)
    process.env.EVITES_PAGES = 'on'
    db.errors.push({ table: 'evites', op: 'select' })
    expect((await event({ event: 'share_clicked' })).status).toBe(503)
    expect(eviteEvents()).toHaveLength(0)
  })

  it('a failed analytics insert never changes the answer', async () => {
    db.errors.push({ table: 'evite_events', op: 'insert' })
    expect((await event({ event: 'share_clicked' })).status).toBe(204)
  })

  it('is rate-limited', async () => {
    for (let i = 0; i < 30; i++) expect((await event({ event: 'share_clicked' })).status).toBe(204)
    expect((await event({ event: 'share_clicked' })).status).toBe(429)
  })
})

describe('sanity: the fixtures are what the tests assume', () => {
  it('Mia’s party is live on 1 Nov 2026 and the seeded row carries every private column', () => {
    expect(rsvpRow({ ...{} }).reminder_email).toBeNull()
    expect(guest().reminder_email).toBe('leak-email@example.com')
    expect(bookingRow().guest_count_approx).toBe(12)
  })
})
