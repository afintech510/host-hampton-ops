import { NextRequest } from 'next/server'
import { NOW } from '../helpers/eviteFixtures'
import { EVITE_ID, OTHER_EVITE_ID, OTHER_SLUG, SLUG, cookieFor, makeRsvpDb, rsvpRow, tokenFor } from '../helpers/rsvpFixtures'
import { readSrc } from '../helpers/sourceScan'
import { __resetRateLimitForTests } from '@/lib/rateLimit'
import { PUBLIC_RSVP_SELF_COLUMNS } from '@/lib/evites/views'
import { cookieName, editLink, signEditToken, verifyEditToken } from '@/lib/evites/rsvpToken'
import { rsvpHooks } from '@/lib/evites/rsvpHooks'
import { clubHooks } from '@/lib/evites/clubHook'

/**
 * POST / PATCH /api/i/[slug]/rsvp (spec §7.5): every gate, the screens, the token,
 * the own-row-only response, the revision rules and the club box.
 */

let db: ReturnType<typeof makeRsvpDb>
jest.mock('@/lib/supabase', () => ({ getSupabase: () => db.supabase }))

import { PATCH, POST } from '@/app/api/i/[slug]/rsvp/route'

const ENV = ['EVITES_PAGES', 'EVITES_PILOT_REFS', 'PORTAL_LINK_SIGNING_SECRET'] as const
const saved: Record<string, string | undefined> = {}
const ORIGIN = 'http://localhost:3002'

const YES = { status: 'yes', parentName: 'Pat Parent', children: [{ firstName: 'Ava' }], adultCount: 1, hasAllergy: false }

type Init = { slug?: string; headers?: Record<string, string | null>; raw?: string; cookie?: string; token?: string; origin?: string | null }

function req(method: 'POST' | 'PATCH', body: unknown, o: Init = {}): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'UA/1.0' }
  if (o.origin !== null) headers.origin = o.origin ?? ORIGIN
  if (o.cookie) headers.cookie = o.cookie
  if (o.token) headers['x-rsvp-token'] = o.token
  for (const [k, v] of Object.entries(o.headers ?? {})) {
    if (v === null) delete headers[k]
    else headers[k] = v
  }
  return new NextRequest(`${ORIGIN}/api/i/${o.slug ?? SLUG}/rsvp`, { method, headers, body: o.raw ?? JSON.stringify(body) })
}
const post = (body: unknown, o: Init = {}) => POST(req('POST', body, o), { params: { slug: o.slug ?? SLUG } })
const patch = (body: unknown, o: Init = {}) => PATCH(req('PATCH', body, o), { params: { slug: o.slug ?? SLUG } })

const rsvps = () => db.tables.evite_rsvps
const events = () => db.inserts.filter((i) => i.table === 'evite_events').map((i) => i.row.event)
const rsvpInserts = () => db.inserts.filter((i) => i.table === 'evite_rsvps')

/** A seeded RSVP for this party plus the cookie that authenticates as it. */
function seeded(over: Record<string, unknown> = {}) {
  const row = rsvpRow(over)
  db = makeRsvpDb({ rsvps: [row, ...(db?.tables?.evite_rsvps ?? [])] })
  return { row, cookie: cookieFor(EVITE_ID, tokenFor(row)) }
}

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
  rsvpHooks.onRsvpCreated = () => undefined
  rsvpHooks.onRsvpChanged = () => undefined
  clubHooks.recordClubOptIn = () => undefined
  clubHooks.recordClubOptOut = () => undefined
})

// ──────────────────────────────────────────────────────────────── the gates, in order

describe('gate 1: the rate limiter is first', () => {
  it('counts a request before the Origin check: ten refused calls, then 429 (and never a database read)', async () => {
    const codes: number[] = []
    for (let i = 0; i < 11; i++) codes.push((await post(YES, { origin: null })).status)
    expect(codes).toEqual([403, 403, 403, 403, 403, 403, 403, 403, 403, 403, 429])
    expect(db.selects).toHaveLength(0)
    expect(db.rpcCalls).toHaveLength(0)
  })
  it('PATCH shares the same allowance', async () => {
    for (let i = 0; i < 10; i++) await patch({ parentName: 'x' }, { origin: null })
    expect((await post(YES)).status).toBe(429)
  })
})

describe('gate 2: Origin', () => {
  it.each([
    ['missing', null],
    ['foreign', 'https://evil.example.com'],
    ['a lookalike', 'https://www.hosthampton.com.evil.example.com'],
    ['userinfo', 'https://www.hosthampton.com@evil.example.com'],
    ['null', 'null'],
    ['not a url', 'garbage'],
    ['another scheme', 'ftp://www.hosthampton.com'],
  ])('%s Origin is 403 on POST and PATCH, with nothing read or written', async (_n, origin) => {
    expect((await post(YES, { origin })).status).toBe(403)
    expect((await patch({ parentName: 'x' }, { origin })).status).toBe(403)
    expect(db.selects).toHaveLength(0)
    expect(db.inserts).toHaveLength(0)
    expect(db.updates).toHaveLength(0)
  })
  it.each(['https://www.hosthampton.com', 'https://hosthampton.com', 'http://localhost:3002', 'http://127.0.0.1:3002'])('%s is accepted', async (origin) => {
    expect((await post(YES, { origin })).status).toBe(200)
  })
})

describe('gate 3: resolve', () => {
  it('an unknown slug, an unknown shape, a cancelled party, an archived invitation, a switched-off feature and an old alias are all the same 404', async () => {
    const results: Array<[number, unknown]> = []
    const one = async (r: Response) => results.push([r.status, await r.json()])
    await one(await post(YES, { slug: 'zed-glow-0000' }))
    await one(await post(YES, { slug: 'NOT A SLUG' }))
    db = makeRsvpDb({ booking: { status: 'cancelled' } })
    await one(await post(YES))
    db = makeRsvpDb({ evite: { archived_at: '2026-10-01T00:00:00Z' } })
    await one(await post(YES))
    db = makeRsvpDb({ evite: { slug: 'mia-glow-9zzz', previous_slugs: [SLUG] } })
    await one(await post(YES))
    db = makeRsvpDb()
    process.env.EVITES_PAGES = 'off'
    await one(await post(YES))
    expect(results.map((r) => r[0])).toEqual([404, 404, 404, 404, 404, 404])
    expect(new Set(results.map((r) => JSON.stringify(r[1]))).size).toBe(1)
    expect(rsvpInserts()).toHaveLength(0)
  })
  it('a read error is a 500, not a 404 and not "closed"', async () => {
    db.errors.push({ table: 'booking_payments', op: 'select' })
    const res = await post(YES)
    expect(res.status).toBe(500)
    expect(rsvpInserts()).toHaveLength(0)
  })
})

describe('gate 4: live, and before the start', () => {
  it('after the party has started it is 409 closed', async () => {
    jest.setSystemTime(new Date('2026-11-14T19:00:00Z')) // the moment it starts
    const res = await post(YES)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'closed' })
    expect(rsvpInserts()).toHaveLength(0)
  })
  it('one second before the start it still takes an RSVP', async () => {
    jest.setSystemTime(new Date('2026-11-14T18:59:59Z'))
    expect((await post(YES)).status).toBe(200)
  })
  it('a preview (not booked yet) and a booked party with no start time are 409 closed', async () => {
    db = makeRsvpDb({ payments: [] , booking: { status: 'lead' } })
    expect((await post(YES)).status).toBe(409)
    db = makeRsvpDb({ booking: { party_time: 'Evening' } })
    expect((await post(YES)).status).toBe(409)
    expect(rsvpInserts()).toHaveLength(0)
  })
  it('PATCH is closed after the start too', async () => {
    const { cookie } = seeded()
    jest.setSystemTime(new Date('2026-11-14T19:30:00Z'))
    expect((await patch({ parentName: 'New' }, { cookie })).status).toBe(409)
  })
})

describe('gate 5: the honeypot', () => {
  it('a filled `website` field gets a plausible 200, and NOTHING is written or set', async () => {
    const res = await post({ ...YES, website: 'http://spam.example' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.rsvp.parent_name).toBe('Pat Parent')
    expect(body.calendarUrl).toBe(`/i/${SLUG}/cal`)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(db.inserts).toHaveLength(0)
    expect(db.updates).toHaveLength(0)
    expect(db.rpcCalls).toHaveLength(0)
  })
  it('on PATCH too, before the token is even looked at', async () => {
    const res = await patch({ parentName: 'x', website: 'spam' })
    expect(res.status).toBe(200)
    expect(db.updates).toHaveLength(0)
  })
  it('an EMPTY or whitespace honeypot is a person', async () => {
    expect((await post({ ...YES, website: '' })).status).toBe(200)
    expect(rsvpInserts()).toHaveLength(1)
    expect((await post({ ...YES, website: '   ' })).status).toBe(200)
    expect(rsvpInserts()).toHaveLength(2)
  })
  it('does not bypass the earlier gates: a trap on an unknown slug is still a 404', async () => {
    expect((await post({ ...YES, website: 'x' }, { slug: 'zed-glow-0000' })).status).toBe(404)
  })
})

describe('gate 6: the per-evite cap (POST only)', () => {
  // guest_count_approx 12 -> max(40, 3*12+10) = 46
  const fill = (n: number) => Array.from({ length: n }, () => rsvpRow())
  it('a full list is 429 with the host message, and nothing is inserted', async () => {
    db = makeRsvpDb({ rsvps: fill(46) })
    const res = await post(YES)
    expect(res.status).toBe(429)
    expect((await res.json()).error).toMatch(/list is full/i)
    expect(rsvpInserts()).toHaveLength(0)
  })
  it('one short of full still takes it', async () => {
    db = makeRsvpDb({ rsvps: fill(45) })
    expect((await post(YES)).status).toBe(200)
    expect(rsvps()).toHaveLength(46)
  })
  it('the floor is 40 when the booking has a small or unknown guest count', async () => {
    db = makeRsvpDb({ rsvps: fill(40), booking: { guest_count_approx: null } })
    expect((await post(YES)).status).toBe(429)
    db = makeRsvpDb({ rsvps: fill(39), booking: { guest_count_approx: 5 } })
    expect((await post(YES)).status).toBe(200)
  })
  it("another party's RSVPs do not count", async () => {
    db = makeRsvpDb({ rsvps: fill(60).map((r) => ({ ...r, evite_id: OTHER_EVITE_ID })) })
    expect((await post(YES)).status).toBe(200)
  })
  it('a failed count is a 503 and never "zero"', async () => {
    db.errors.push({ table: 'evite_rsvps', op: 'select' })
    expect((await post(YES)).status).toBe(503)
    expect(rsvpInserts()).toHaveLength(0)
  })
  it('does not apply to PATCH (an existing guest can always edit)', async () => {
    const mine = rsvpRow()
    db = makeRsvpDb({ rsvps: [mine, ...fill(60)] })
    const res = await patch({ parentName: 'New Name' }, { cookie: cookieFor(EVITE_ID, tokenFor(mine)) })
    expect(res.status).toBe(200)
  })
})

// ──────────────────────────────────────────────────────────────── POST

describe('POST: screens', () => {
  it('a yes needs at least one child', async () => {
    for (const children of [[], undefined, [{ firstName: '' }], 'Ava']) {
      const res = await post({ ...YES, children })
      expect(res.status).toBe(400)
      expect((await res.json()).field).toBe('children')
    }
    expect(rsvpInserts()).toHaveLength(0)
  })
  it('six children are fine and seven are not', async () => {
    const kids = (n: number) => Array.from({ length: n }, (_, i) => ({ firstName: `Kid${i}` }))
    expect((await post({ ...YES, children: kids(6) })).status).toBe(200)
    expect((await post({ ...YES, children: kids(7) })).status).toBe(400)
  })
  it('a no forces children and adults to zero, whatever was sent', async () => {
    const res = await post({ status: 'no', parentName: 'Pat Parent', children: [{ firstName: 'Ava' }], adultCount: 2, hasAllergy: true, allergyNote: 'x' })
    expect(res.status).toBe(200)
    const row = rsvps()[0]
    expect(row.status).toBe('no')
    expect(row.children).toEqual([])
    expect(row.adult_count).toBe(0)
    expect(row.has_allergy).toBeNull()
    expect(row.allergy_note).toBeNull()
    expect((await res.json()).rsvp.children).toEqual([])
  })
  it('the allergy note is dropped when hasAllergy is false, kept when true, and required when true', async () => {
    await post({ ...YES, hasAllergy: false, allergyNote: 'peanuts' })
    expect(rsvps()[0].allergy_note).toBeNull()
    await post({ ...YES, hasAllergy: true, allergyNote: ' peanuts ' })
    expect(rsvps()[1].allergy_note).toBe('peanuts')
    const bad = await post({ ...YES, hasAllergy: true })
    expect(bad.status).toBe(400)
    expect((await bad.json()).field).toBe('allergyNote')
  })
  it('adults may be 0, 1 or 2 ("2+") and nothing else', async () => {
    for (const n of [0, 1, 2]) expect((await post({ ...YES, adultCount: n })).status).toBe(200)
    for (const n of [3, -1, 1.5, '1', null]) expect((await post({ ...YES, adultCount: n })).status).toBe(400)
    expect(rsvps().map((r) => r.adult_count)).toEqual([0, 1, 2])
  })
  it('there is no "maybe"', async () => {
    expect((await post({ ...YES, status: 'maybe' })).status).toBe(400)
  })
  it('invalid JSON and a huge body are 400/413, and an array body is a 400', async () => {
    expect((await post(null, { raw: '{not json' })).status).toBe(400)
    expect((await post(null, { raw: JSON.stringify({ ...YES, parentName: 'x'.repeat(30_000) }) })).status).toBe(413)
    expect((await post([YES])).status).toBe(400)
    expect(rsvpInserts()).toHaveLength(0)
  })
  it('never takes id, evite_id, revision or edit_nonce from the body', async () => {
    await post({ ...YES, id: 'attacker', evite_id: OTHER_EVITE_ID, revision: 99, edit_nonce: 'AAAAAAAAAAAAAAAA', club_opt_in_at: '2020-01-01', consent_ip: '1.1.1.1' })
    const row = rsvps()[0]
    expect(row.evite_id).toBe(EVITE_ID)
    expect(row.id).not.toBe('attacker')
    expect(row.revision).toBe(1)
    expect(row.club_opt_in_at).toBeNull()
    expect(row.consent_ip).toBeNull()
    expect(row.edit_nonce).not.toBe('AAAAAAAAAAAAAAAA')
  })
})

describe('POST: the reminder box', () => {
  it('an email is stored as the reminder email', async () => {
    await post({ ...YES, reminderContact: ' Pat@Example.com ' })
    expect(rsvps()[0]).toMatchObject({ reminder_email: 'Pat@Example.com', reminder_phone_e164: null })
  })
  it('a mobile number in any common spelling is stored as +1XXXXXXXXXX', async () => {
    for (const v of ['(631) 400-8080', '631.400.8080'.replace(/\./g, '-'), '16314008080']) await post({ ...YES, reminderContact: v })
    expect(rsvps().map((r) => r.reminder_phone_e164)).toEqual(['+16314008080', '+16314008080', '+16314008080'])
    expect(rsvps().every((r) => r.reminder_email === null)).toBe(true)
  })
  it('something unparseable is a 400 naming the field, and nothing is stored', async () => {
    for (const v of ['hello', '12345', 'pat@', '063-400-8080']) {
      const res = await post({ ...YES, reminderContact: v })
      expect(res.status).toBe(400)
      expect((await res.json()).field).toBe('reminderContact')
    }
    expect(rsvpInserts()).toHaveLength(0)
  })
  it('no reminder box is fine, and a decline ignores one', async () => {
    expect((await post({ ...YES })).status).toBe(200)
    await post({ status: 'no', parentName: 'Pat', reminderContact: 'pat@example.com' })
    expect(rsvps()[1].reminder_email).toBeNull()
    expect(db.rpcCalls).toHaveLength(0)
  })
  it('the DB cap: at three RSVPs for that address in 24 hours the RSVP is stored WITHOUT it, and the response says so', async () => {
    const recent = new Date(NOW.getTime() - 3600_000).toISOString()
    db = makeRsvpDb({ rsvps: [1, 2, 3].map(() => rsvpRow({ evite_id: OTHER_EVITE_ID, reminder_email: 'PAT@example.com', created_at: recent })) })
    const res = await post({ ...YES, reminderContact: 'pat@example.com' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reminderDropped).toBe(true)
    expect(body.rsvp.reminder_email).toBeNull()
    const mine = rsvps().find((r) => r.evite_id === EVITE_ID)!
    expect(mine.reminder_email).toBeNull()
    expect(mine.parent_name).toBe('Pat Parent') // the answer itself is kept
    expect(db.rpcCalls[0]).toEqual({ name: 'evite_reminder_email_recent', args: { p_email: 'pat@example.com' } })
  })
  it('two recent RSVPs for the address is under the cap; older ones do not count', async () => {
    const recent = new Date(NOW.getTime() - 3600_000).toISOString()
    const old = new Date(NOW.getTime() - 30 * 3600_000).toISOString()
    db = makeRsvpDb({
      rsvps: [
        rsvpRow({ evite_id: OTHER_EVITE_ID, reminder_email: 'pat@example.com', created_at: recent }),
        rsvpRow({ evite_id: OTHER_EVITE_ID, reminder_email: 'pat@example.com', created_at: recent }),
        rsvpRow({ evite_id: OTHER_EVITE_ID, reminder_email: 'pat@example.com', created_at: old }),
        rsvpRow({ evite_id: OTHER_EVITE_ID, reminder_email: 'pat@example.com', created_at: old }),
      ],
    })
    const body = await (await post({ ...YES, reminderContact: 'pat@example.com' })).json()
    expect(body.reminderDropped).toBeUndefined()
    expect(body.rsvp.reminder_email).toBe('pat@example.com')
  })
  it('an RPC error fails toward NOT emailing a stranger: stored without the reminder, flagged, logged', async () => {
    db = makeRsvpDb()
    ;(db.supabase as unknown as { rpc: unknown }).rpc = async () => ({ data: null, error: { message: 'boom' } })
    const res = await post({ ...YES, reminderContact: 'pat@example.com' })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.reminderDropped).toBe(true)
    expect(rsvps()[0].reminder_email).toBeNull()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('evite_reminder_email_recent failed'))
  })
  it('a phone number is not subject to the email cap', async () => {
    await post({ ...YES, reminderContact: '631-400-8080' })
    expect(db.rpcCalls).toHaveLength(0)
  })
})

describe('POST: the response and the cookie', () => {
  it('answers with exactly the caller\'s own columns plus the calendar link, and never another RSVP', async () => {
    const other = rsvpRow({ parent_name: 'Zed Secretparent', children: [{ first_name: 'Quincy' }], allergy_note: 'shellfish', note_to_honoree: 'private note', reminder_email: 'zed@example.com', consent_ip: '198.51.100.7' })
    const elsewhere = rsvpRow({ evite_id: OTHER_EVITE_ID, parent_name: 'Yan Elsewhere' })
    db = makeRsvpDb({ rsvps: [other, elsewhere] })
    const res = await post({ ...YES, reminderContact: 'pat@example.com' })
    const text = await res.text()
    const body = JSON.parse(text)
    expect(Object.keys(body).sort()).toEqual(['calendarUrl', 'ok', 'rsvp'])
    expect(Object.keys(body.rsvp).sort()).toEqual([...PUBLIC_RSVP_SELF_COLUMNS].sort())
    expect(body.calendarUrl).toBe(`/i/${SLUG}/cal`)
    expect(body.rsvp).toMatchObject({ status: 'yes', parent_name: 'Pat Parent', children: [{ first_name: 'Ava' }], adult_count: 1, revision: 1 })
    for (const leak of ['Zed', 'Quincy', 'shellfish', 'private note', 'zed@example.com', '198.51.100.7', 'Yan', 'edit_nonce', 'evite_id', 'consent_ip', 'contact_id']) expect(text).not.toContain(leak)
    expect(body.rsvp).not.toHaveProperty('id')
  })
  it('even if the database handed back more columns, only the allow-list is serialised', async () => {
    const real = db.supabase as unknown as { from: (t: string) => unknown }
    const spy = jest.spyOn(real, 'from')
    const body = await (await post(YES)).json()
    expect(spy).toHaveBeenCalled()
    expect(Object.keys(body.rsvp).every((k) => (PUBLIC_RSVP_SELF_COLUMNS as readonly string[]).includes(k))).toBe(true)
  })
  it('sets the per-evite cookie: HttpOnly, SameSite=Lax, Path=/, Max-Age to party end + 30 days, and it verifies', async () => {
    const res = await post(YES, { headers: { host: 'www.hosthampton.com' } })
    const header = res.headers.get('set-cookie') ?? ''
    expect(header.startsWith(`${cookieName(EVITE_ID)}=`)).toBe(true)
    expect(header).toMatch(/HttpOnly/i)
    expect(header).toMatch(/SameSite=lax/i)
    expect(header).toMatch(/Path=\//i)
    expect(header).toMatch(/Secure/i)
    const maxAge = Number(/Max-Age=(\d+)/i.exec(header)![1])
    const endPlus30 = Math.floor(Date.parse('2026-11-14T21:00:00Z') / 1000) + 30 * 86400
    expect(Math.abs(maxAge - (endPlus30 - Math.floor(NOW.getTime() / 1000)))).toBeLessThanOrEqual(2)
    const token = decodeURIComponent(/=([^;]+)/.exec(header)![1])
    const v = await verifyEditToken(db.supabase, token, EVITE_ID, NOW)
    expect(v).toMatchObject({ ok: true, rsvpId: rsvps()[0].id, exp: endPlus30 })
    expect(editLink(SLUG, token)).toContain(`/i/${SLUG}/rsvp/`)
  })
  it('is not Secure on a development host', async () => {
    const res = await post(YES, { headers: { host: 'localhost:3002' } })
    expect(res.headers.get('set-cookie') ?? '').not.toMatch(/Secure/i)
  })
  it('the stored edit_nonce is 16 characters and never in the response or the cookie', async () => {
    const res = await post(YES)
    const nonce = String(rsvps()[0].edit_nonce)
    expect(nonce).toHaveLength(16)
    expect(await res.text()).not.toContain(nonce)
    expect(res.headers.get('set-cookie') ?? '').not.toContain(nonce)
  })
  it('fires onRsvpCreated once, without waiting for it, and a throwing or rejecting hook cannot break the answer', async () => {
    const calls: unknown[] = []
    rsvpHooks.onRsvpCreated = (ctx) => {
      calls.push(ctx)
      throw new Error('mail is down')
    }
    const res = await post(YES)
    expect(res.status).toBe(200)
    expect(calls).toEqual([{ eviteId: EVITE_ID, rsvpId: rsvps()[0].id, slug: SLUG, revision: 1, status: 'yes' }])
    rsvpHooks.onRsvpCreated = () => Promise.reject(new Error('async mail is down'))
    expect((await post(YES)).status).toBe(200)
  })
  it('does not wait for a slow hook', async () => {
    let done = false
    let timer: ReturnType<typeof setTimeout> | undefined
    rsvpHooks.onRsvpCreated = () =>
      new Promise<void>((r) => {
        timer = setTimeout(() => {
          done = true
          r()
        }, 5_000)
      })
    await post(YES)
    expect(done).toBe(false)
    if (timer) clearTimeout(timer)
  })
  it('records rsvp_completed (and no other event)', async () => {
    await post(YES)
    expect(events()).toEqual(['rsvp_completed'])
  })
  it('an insert error is a 503 with no cookie and no hook', async () => {
    const hook = jest.fn()
    rsvpHooks.onRsvpCreated = hook
    db.errors.push({ table: 'evite_rsvps', op: 'insert' })
    const res = await post(YES)
    expect(res.status).toBe(503)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(hook).not.toHaveBeenCalled()
    expect(events()).toEqual([])
  })
  it('no signing secret in production means 503 BEFORE anything is written', async () => {
    delete process.env.PORTAL_LINK_SIGNING_SECRET
    const env = process.env as Record<string, string | undefined>
    const was = env.NODE_ENV
    env.NODE_ENV = 'production'
    try {
      const res = await post(YES)
      expect(res.status).toBe(503)
      expect(rsvpInserts()).toHaveLength(0)
    } finally {
      env.NODE_ENV = was
    }
  })
  it('sends no email and touches no contact: this route imports neither', () => {
    const src = readSrc('app', 'api', 'i', '[slug]', 'rsvp', 'route.ts')
    expect(src).not.toMatch(/resend|emails\.send|sendEviteEmail|upsertContact|brevo/i)
    expect(src).not.toMatch(/from\('contacts'\)/)
  })
})

// ──────────────────────────────────────────────────────────────── PATCH

describe('PATCH: the token', () => {
  it('without one it is 401', async () => {
    seeded()
    const res = await patch({ parentName: 'Hacker' })
    expect(res.status).toBe(401)
    expect(db.updates).toHaveLength(0)
  })
  it.each(['garbage', 'a.b.c', '00000000-0000-4000-8000-000000000001.9999999999.' + 'A'.repeat(43)])('a bad token %j is 401', async (token) => {
    seeded()
    expect((await patch({ parentName: 'Hacker' }, { token })).status).toBe(401)
    expect((await patch({ parentName: 'Hacker' }, { cookie: cookieFor(EVITE_ID, token) })).status).toBe(401)
    expect(db.updates).toHaveLength(0)
  })
  it("another party's RSVP token is 401 here, and the row is untouched", async () => {
    const mine = rsvpRow()
    const theirs = rsvpRow({ evite_id: OTHER_EVITE_ID, parent_name: 'Yan Elsewhere' })
    db = makeRsvpDb({ rsvps: [mine, theirs] })
    const stolen = tokenFor(theirs)
    expect((await patch({ parentName: 'Hacker' }, { token: stolen })).status).toBe(401)
    expect((await patch({ parentName: 'Hacker' }, { cookie: cookieFor(EVITE_ID, stolen) })).status).toBe(401)
    expect(db.tables.evite_rsvps.map((r) => r.parent_name)).toEqual(['Pat Parent', 'Yan Elsewhere'])
    // ...while it works on its own party's slug
    const ok = await PATCH(req('PATCH', { parentName: 'Yan Renamed' }, { slug: OTHER_SLUG, token: stolen }), { params: { slug: OTHER_SLUG } })
    expect(ok.status).toBe(200)
  })
  it('an expired token and a rotated nonce are 401', async () => {
    const { row } = seeded()
    const expired = signEditToken({ id: String(row.id), edit_nonce: String(row.edit_nonce) }, Math.floor(NOW.getTime() / 1000) - 10)
    expect((await patch({ parentName: 'X' }, { token: expired })).status).toBe(401)
    const live = tokenFor(row)
    rsvps()[0].edit_nonce = 'RotatedNonce1234'
    expect((await patch({ parentName: 'X' }, { token: live })).status).toBe(401)
  })
  it('a read failure while verifying is 503, not 401', async () => {
    const { cookie } = seeded()
    db.errors.push({ table: 'evite_rsvps', op: 'select' })
    expect((await patch({ parentName: 'X' }, { cookie })).status).toBe(503)
  })
  it('works from the cookie and from the x-rsvp-token header', async () => {
    const { row, cookie } = seeded()
    expect((await patch({ parentName: 'By Cookie' }, { cookie })).status).toBe(200)
    expect(rsvps()[0].parent_name).toBe('By Cookie')
    expect((await patch({ parentName: 'By Header' }, { token: tokenFor(row) })).status).toBe(200)
    expect(rsvps()[0].parent_name).toBe('By Header')
  })
  it('never reads id or evite_id from the body: it edits the token\'s own row only', async () => {
    const mine = rsvpRow()
    const victim = rsvpRow({ parent_name: 'Victim Parent' })
    db = makeRsvpDb({ rsvps: [mine, victim] })
    const res = await patch({ parentName: 'Hacker', id: victim.id, evite_id: OTHER_EVITE_ID }, { cookie: cookieFor(EVITE_ID, tokenFor(mine)) })
    expect(res.status).toBe(200)
    expect(db.tables.evite_rsvps.find((r) => r.id === victim.id)!.parent_name).toBe('Victim Parent')
    expect(db.tables.evite_rsvps.find((r) => r.id === mine.id)!.parent_name).toBe('Hacker')
    expect(db.tables.evite_rsvps.find((r) => r.id === mine.id)!.evite_id).toBe(EVITE_ID)
  })
  it('the response is the caller\'s own row and no one else\'s', async () => {
    const mine = rsvpRow()
    const other = rsvpRow({ parent_name: 'Zed Secretparent', children: [{ first_name: 'Quincy' }] })
    db = makeRsvpDb({ rsvps: [mine, other] })
    const text = await (await patch({ parentName: 'Pat Renamed' }, { cookie: cookieFor(EVITE_ID, tokenFor(mine)) })).text()
    expect(text).not.toMatch(/Zed|Quincy/)
    expect(Object.keys(JSON.parse(text).rsvp).sort()).toEqual([...PUBLIC_RSVP_SELF_COLUMNS].sort())
  })
})

describe('PATCH: revision bumps on a MATERIAL change only', () => {
  const run = async (body: unknown, over: Record<string, unknown> = {}) => {
    const { cookie } = seeded({ children: [{ first_name: 'Ava' }], adult_count: 1, has_allergy: false, ...over })
    const created = jest.fn()
    const changed = jest.fn()
    rsvpHooks.onRsvpCreated = created
    rsvpHooks.onRsvpChanged = changed
    const res = await patch(body, { cookie })
    return { res, row: rsvps()[0], changed, created }
  }

  it.each([
    ['status yes to no', { status: 'no' }],
    ['child count', { children: [{ firstName: 'Ava' }, { firstName: 'Ben' }] }],
    ['adult count', { adultCount: 2 }],
    ['the allergy answer', { hasAllergy: true, allergyNote: 'peanuts' }],
  ])('%s bumps the revision and fires onRsvpChanged once', async (_n, body) => {
    const { res, row, changed, created } = await run(body)
    expect(res.status).toBe(200)
    expect(row.revision).toBe(2)
    expect((await res.json()).rsvp.revision).toBe(2)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ eviteId: EVITE_ID, slug: SLUG, revision: 2 }))
    expect(created).not.toHaveBeenCalled()
  })

  it.each([
    ['the parent name', { parentName: 'Pat Renamed' }, {}],
    ["a child's name at the same count", { children: [{ firstName: 'Avery' }] }, {}],
    ['the allergy note text', { allergyNote: 'x' }, { has_allergy: true, allergy_note: 'peanuts' }],
    ['the note to the birthday child', { noteToHonoree: 'Happy birthday!' }, {}],
    ['the reminder contact', { reminderContact: '631-400-8080' }, {}],
    ['the same values again', { adultCount: 1, hasAllergy: false }, {}],
  ])('%s does not', async (_n, body, over) => {
    const { res, row, changed } = await run(body, over)
    expect(res.status).toBe(200)
    expect(row.revision).toBe(1)
    expect(changed).not.toHaveBeenCalled()
  })

  it('yes to no zeroes children and adults before the CHECKs could refuse it', async () => {
    const { res, row } = await run({ status: 'no' }, { adult_count: 2, children: [{ first_name: 'A' }, { first_name: 'B' }] })
    expect(res.status).toBe(200)
    expect(row).toMatchObject({ status: 'no', children: [], child_count: 0, adult_count: 0, has_allergy: null, allergy_note: null })
  })
  it('no to yes must bring a child and the allergy answer', async () => {
    const { cookie } = seeded({ status: 'no', children: [], adult_count: 0, has_allergy: null })
    const bad = await patch({ status: 'yes' }, { cookie })
    expect(bad.status).toBe(400)
    expect((await bad.json()).field).toBe('children')
    const good = await patch({ status: 'yes', children: [{ firstName: 'Ava' }], adultCount: 1, hasAllergy: false }, { cookie })
    expect(good.status).toBe(200)
    expect(rsvps()[0]).toMatchObject({ status: 'yes', child_count: 1, revision: 2 })
  })
  it('an empty patch and an unknown-keys-only patch are 400', async () => {
    const { cookie } = seeded()
    expect((await patch({}, { cookie })).status).toBe(400)
    expect((await patch({ colour: 'red' }, { cookie })).status).toBe(400)
    expect(db.updates).toHaveLength(0)
  })
  it('a validation failure writes nothing and names the field', async () => {
    const { cookie } = seeded()
    for (const [body, field] of [
      [{ adultCount: 3 }, 'adultCount'],
      [{ children: [] }, 'children'],
      [{ noteToHonoree: 'x'.repeat(501) }, 'noteToHonoree'],
      [{ reminderContact: 'nope' }, 'reminderContact'],
    ] as const) {
      const res = await patch(body, { cookie })
      expect(res.status).toBe(400)
      expect((await res.json()).field).toBe(field)
    }
    expect(db.updates).toHaveLength(0)
  })
  it('two tabs changing the party cannot silently overwrite each other: a stale revision is 409', async () => {
    const { cookie } = seeded()
    db.hooks.beforeUpdate = (info, tables) => {
      if (info.table === 'evite_rsvps') tables.evite_rsvps[0].revision = 5 // another tab got there first
    }
    const res = await patch({ adultCount: 2 }, { cookie })
    expect(res.status).toBe(409)
  })
  it('an update error is a 503 (and a CHECK violation a 400), with no hook', async () => {
    const { cookie } = seeded()
    const changed = jest.fn()
    rsvpHooks.onRsvpChanged = changed
    db.errors.push({ table: 'evite_rsvps', op: 'update', times: 1 })
    expect((await patch({ adultCount: 2 }, { cookie })).status).toBe(503)
    expect(changed).not.toHaveBeenCalled()
  })
})

describe('PATCH: reminders', () => {
  it('reminderOptOut records the time, and keeps the first time on a repeat', async () => {
    const { cookie } = seeded({ reminder_email: 'pat@example.com' })
    await patch({ reminderOptOut: true }, { cookie })
    const first = rsvps()[0].reminder_opt_out_at
    expect(first).toBe(NOW.toISOString())
    jest.setSystemTime(new Date(NOW.getTime() + 3600_000))
    await patch({ reminderOptOut: true }, { cookie })
    expect(rsvps()[0].reminder_opt_out_at).toBe(first)
    expect(rsvps()[0].revision).toBe(1)
  })
  it('a new reminder address over its daily cap is not stored, and the response says so', async () => {
    const recent = new Date(NOW.getTime() - 3600_000).toISOString()
    const mine = rsvpRow()
    db = makeRsvpDb({ rsvps: [mine, ...[1, 2, 3].map(() => rsvpRow({ evite_id: OTHER_EVITE_ID, reminder_email: 'busy@example.com', created_at: recent }))] })
    const res = await patch({ reminderContact: 'busy@example.com' }, { cookie: cookieFor(EVITE_ID, tokenFor(mine)) })
    expect(res.status).toBe(200)
    expect((await res.json()).reminderDropped).toBe(true)
    expect(db.tables.evite_rsvps[0].reminder_email).toBeNull()
  })
  it('re-entering the address already stored does not hit the cap or clear an opt-out', async () => {
    const { cookie } = seeded({ reminder_email: 'pat@example.com', reminder_opt_out_at: '2026-10-25T00:00:00Z' })
    await patch({ reminderContact: 'pat@example.com', parentName: 'Pat Two' }, { cookie })
    expect(db.rpcCalls).toHaveLength(0)
    expect(rsvps()[0].reminder_opt_out_at).toBe('2026-10-25T00:00:00Z')
  })
})

describe('PATCH: the Birthday Club box', () => {
  const club = (over: Record<string, unknown> = {}) => ({ club: { optIn: true, email: 'pat@example.com', birthdayMonth: 6, consentVersion: 'club-v1', ...over } })

  it('stores the consent ON THE RSVP ROW, with the version, the time, the address and the caller\'s IP', async () => {
    const { cookie } = seeded()
    const res = await patch(club(), { cookie })
    expect(res.status).toBe(200)
    expect(rsvps()[0]).toMatchObject({
      club_email: 'pat@example.com',
      club_opt_in_at: NOW.toISOString(),
      opt_in_text_version: 'club-v1',
      club_opted_out_at: null,
      birthday_month: 6,
      consent_ip: '203.0.113.9',
    })
    expect(events()).toEqual(['club_opted_in', 'birthday_month_saved'])
    const body = await res.json()
    expect(body.rsvp).toMatchObject({ club_email: 'pat@example.com', birthday_month: 6 })
    expect(body.rsvp).not.toHaveProperty('consent_ip')
    expect(body.rsvp).not.toHaveProperty('opt_in_text_version')
  })
  it('calls the injected recordClubOptIn with what P10 needs, and does not wait for it', async () => {
    const { row, cookie } = seeded()
    const calls: unknown[] = []
    clubHooks.recordClubOptIn = (_s, input) => {
      calls.push(input)
      return new Promise<void>(() => undefined) // never settles
    }
    expect((await patch(club(), { cookie })).status).toBe(200)
    expect(calls).toEqual([{ email: 'pat@example.com', parentName: 'Pat Parent', birthdayMonth: 6, slug: SLUG, consentVersion: 'club-v1', rsvpId: row.id }])
  })
  it('a hook that throws cannot undo or fail the opt-in', async () => {
    const { cookie } = seeded()
    clubHooks.recordClubOptIn = () => {
      throw new Error('brevo is down')
    }
    expect((await patch(club(), { cookie })).status).toBe(200)
    expect(rsvps()[0].club_opt_in_at).toBe(NOW.toISOString())
  })
  it('without a month it records club_opted_in only', async () => {
    const { cookie } = seeded({ birthday_month: 3 })
    await patch(club({ birthdayMonth: undefined }), { cookie })
    expect(events()).toEqual(['club_opted_in'])
    expect(rsvps()[0].birthday_month).toBe(3) // not wiped
  })
  it('the wrong consent version is a 409 and nothing is written', async () => {
    const { cookie } = seeded()
    const res = await patch(club({ consentVersion: 'club-v0' }), { cookie })
    expect(res.status).toBe(409)
    expect(rsvps()[0].club_opt_in_at).toBeNull()
    expect(events()).toEqual([])
  })
  it('follows the CURRENT wording: a newer row makes club-v1 stale', async () => {
    const mine = rsvpRow()
    db = makeRsvpDb({
      rsvps: [mine],
      consent: [
        { version: 'club-v1', channel: 'email', wording: 'old', created_at: '2026-10-10T00:00:00Z' },
        { version: 'club-v2', channel: 'email', wording: 'new', created_at: '2026-11-01T00:00:00Z' },
      ],
    })
    const cookie = cookieFor(EVITE_ID, tokenFor(mine))
    expect((await patch(club(), { cookie })).status).toBe(409)
    expect((await patch(club({ consentVersion: 'club-v2' }), { cookie })).status).toBe(200)
    expect(rsvps()[0].opt_in_text_version).toBe('club-v2')
  })
  it('an unreadable or empty consent table is a 503, never a silent pass', async () => {
    const { cookie } = seeded()
    db.errors.push({ table: 'evite_consent_texts', op: 'select' })
    expect((await patch(club(), { cookie })).status).toBe(503)
    db.errors.length = 0
    db.tables.evite_consent_texts.length = 0
    expect((await patch(club(), { cookie })).status).toBe(503)
    expect(rsvps()[0].club_opt_in_at).toBeNull()
  })
  it('an address that is not an address, or a month of 13, is a 400', async () => {
    const { cookie } = seeded()
    expect((await patch(club({ email: 'nope' }), { cookie })).status).toBe(400)
    expect((await patch(club({ birthdayMonth: 13 }), { cookie })).status).toBe(400)
    expect((await patch({ club: { optIn: false, email: 'pat@example.com', consentVersion: 'club-v1' } }, { cookie })).status).toBe(400)
    expect(rsvps()[0].club_opt_in_at).toBeNull()
  })
  it('a forged IP header is stored as NULL, not as text the inet column would refuse', async () => {
    const { cookie } = seeded()
    const res = await patch(club(), { cookie, headers: { 'cf-connecting-ip': 'not-an-ip; DROP TABLE' } })
    expect(res.status).toBe(200)
    expect(rsvps()[0].consent_ip).toBeNull()
    expect(rsvps()[0].club_opt_in_at).toBe(NOW.toISOString())
  })
  it('falls back to x-real-ip when there is no Cloudflare header', async () => {
    const { cookie } = seeded()
    await patch(club(), { cookie, headers: { 'cf-connecting-ip': null, 'x-real-ip': '198.51.100.20' } })
    expect(rsvps()[0].consent_ip).toBe('198.51.100.20')
  })
  it('never writes the contacts table or the contact consent flags (that is P10, through the hook)', async () => {
    const { cookie } = seeded()
    await patch(club(), { cookie })
    expect(db.inserts.filter((i) => i.table === 'contacts')).toHaveLength(0)
    expect(db.updates.filter((u) => u.table === 'contacts')).toHaveLength(0)
    expect(Object.keys(db.updates.find((u) => u.table === 'evite_rsvps')!.patch)).not.toEqual(expect.arrayContaining(['email_opt_in', 'sms_opt_in']))
  })
  it('clubOptOut records the time and calls recordClubOptOut; with nothing to opt out of it is a no-op', async () => {
    const out = jest.fn()
    clubHooks.recordClubOptOut = out
    const { row, cookie } = seeded({ club_email: 'pat@example.com', club_opt_in_at: '2026-10-21T00:00:00Z', opt_in_text_version: 'club-v1' })
    expect((await patch({ clubOptOut: true }, { cookie })).status).toBe(200)
    expect(rsvps()[0].club_opted_out_at).toBe(NOW.toISOString())
    expect(rsvps()[0].club_opt_in_at).toBe('2026-10-21T00:00:00Z') // the consent record is kept
    expect(out).toHaveBeenCalledWith(expect.anything(), { email: 'pat@example.com', rsvpId: row.id })

    out.mockClear()
    const fresh = seeded()
    expect((await patch({ clubOptOut: true }, { cookie: fresh.cookie })).status).toBe(200)
    expect(out).not.toHaveBeenCalled()
  })
  // ---- v1.2, finding 2: one sign-up per RSVP, bound to its first address
  const joined = { club_email: 'pat@example.com', club_opt_in_at: '2026-10-21T00:00:00Z', opt_in_text_version: 'club-v1' }

  it('an RSVP that is already in the club refuses a DIFFERENT address: 409, nothing written, no contact created, no hook', async () => {
    const calls: unknown[] = []
    clubHooks.recordClubOptIn = (_s, input) => void calls.push(input)
    const { cookie } = seeded(joined)
    const res = await patch(club({ email: 'victim@example.com' }), { cookie })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already joined/i)
    expect(rsvps()[0]).toMatchObject({ club_email: 'pat@example.com', club_opt_in_at: '2026-10-21T00:00:00Z' })
    expect(db.updates.filter((u) => u.table === 'evite_rsvps')).toHaveLength(0)
    expect(calls).toHaveLength(0)
    expect(events()).toEqual([])
  })
  it('walking a list of addresses through one cookie reaches recordClubOptIn exactly once', async () => {
    const calls: unknown[] = []
    clubHooks.recordClubOptIn = (_s, input) => void calls.push(input)
    const { cookie } = seeded()
    const codes: number[] = []
    for (const email of ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']) codes.push((await patch(club({ email }), { cookie })).status)
    expect(codes).toEqual([200, 409, 409, 409])
    expect(calls).toHaveLength(1)
    expect(rsvps()[0].club_email).toBe('a@example.com')
  })
  it('the SAME address again (any case) is an idempotent no-op: 200, the consent record and the hook untouched', async () => {
    const calls: unknown[] = []
    clubHooks.recordClubOptIn = (_s, input) => void calls.push(input)
    const { cookie } = seeded(joined)
    const res = await patch(club({ email: 'PAT@Example.com', birthdayMonth: undefined }), { cookie })
    expect(res.status).toBe(200)
    expect(rsvps()[0]).toMatchObject({ club_email: 'pat@example.com', club_opt_in_at: '2026-10-21T00:00:00Z', consent_ip: null })
    expect(calls).toHaveLength(0)
    expect(events()).toEqual([]) // not a second 'club_opted_in'
  })
  it('the same address with a month only saves the month', async () => {
    const calls: unknown[] = []
    clubHooks.recordClubOptIn = (_s, input) => void calls.push(input)
    const { cookie } = seeded(joined)
    expect((await patch(club({ birthdayMonth: 9 }), { cookie })).status).toBe(200)
    expect(rsvps()[0]).toMatchObject({ birthday_month: 9, club_opt_in_at: '2026-10-21T00:00:00Z' })
    expect(calls).toHaveLength(0)
    expect(events()).toEqual(['birthday_month_saved'])
  })
  it('after an opt-out there is NO re-opt-in on that RSVP (club_opted_out_at is never cleared): 409, the time is kept', async () => {
    const calls: unknown[] = []
    clubHooks.recordClubOptIn = (_s, input) => void calls.push(input)
    const { cookie } = seeded({ ...joined, club_opted_out_at: '2026-10-22T00:00:00Z' })
    for (const email of ['pat@example.com', 'victim@example.com']) {
      const res = await patch(club({ email }), { cookie })
      expect(res.status).toBe(409)
      expect((await res.json()).error).toMatch(/left the Birthday Club/i)
    }
    expect(rsvps()[0].club_opted_out_at).toBe('2026-10-22T00:00:00Z')
    expect(calls).toHaveLength(0)
  })
  it('a second opt-out keeps the first time', async () => {
    const { cookie } = seeded({ ...joined, club_opted_out_at: '2026-10-22T00:00:00Z' })
    expect((await patch({ clubOptOut: true }, { cookie })).status).toBe(200)
    expect(rsvps()[0].club_opted_out_at).toBe('2026-10-22T00:00:00Z')
  })
  it('club sign-ups per invitation are capped at the RSVP cap', async () => {
    const full = Array.from({ length: 46 }, () => rsvpRow({ ...joined })) // max(40, 3 x 12 guests + 10) = 46
    const mine = rsvpRow()
    db = makeRsvpDb({ rsvps: [mine, ...full] })
    const calls: unknown[] = []
    clubHooks.recordClubOptIn = (_s, input) => void calls.push(input)
    const res = await patch(club(), { cookie: cookieFor(EVITE_ID, tokenFor(mine)) })
    expect(res.status).toBe(429)
    expect(db.tables.evite_rsvps[0].club_opt_in_at).toBeNull()
    expect(calls).toHaveLength(0)
  })
  it('two tabs racing two addresses cannot both win: the first write is conditional on "never opted in"', async () => {
    const { cookie } = seeded()
    db.hooks.beforeUpdate = (_info, tables) => {
      // the other tab's opt-in lands between our read and our write
      Object.assign(tables.evite_rsvps[0], { club_email: 'other@example.com', club_opt_in_at: '2026-11-01T14:59:00Z', opt_in_text_version: 'club-v1' })
    }
    const res = await patch(club({ email: 'mine@example.com' }), { cookie })
    expect(res.status).toBe(409)
    expect(rsvps()[0].club_email).toBe('other@example.com')
  })
})

describe('v1.2 finding 1: the reminder address caps count when the address was SET', () => {
  const longAgo = new Date(NOW.getTime() - 30 * 24 * 3600_000).toISOString()
  const recent = new Date(NOW.getTime() - 3600_000).toISOString()

  it('POST stamps reminder_set_at; a phone or no reminder leaves it null', async () => {
    await post({ ...YES, reminderContact: 'pat@example.com' })
    await post({ ...YES, reminderContact: '631-400-8080' })
    await post(YES)
    expect(rsvps().map((r) => r.reminder_set_at ?? null)).toEqual([NOW.toISOString(), null, null])
  })
  it('three RSVPs created long ago whose address was SET just now by PATCH count against the 24-hour cap (a created_at count saw zero)', async () => {
    db = makeRsvpDb({ rsvps: [1, 2, 3].map(() => rsvpRow({ evite_id: OTHER_EVITE_ID, reminder_email: 'victim@example.com', created_at: longAgo, reminder_set_at: recent })) })
    const body = await (await post({ ...YES, reminderContact: 'victim@example.com' })).json()
    expect(body.reminderDropped).toBe(true)
    expect(rsvps().find((r) => r.evite_id === EVITE_ID)!.reminder_email).toBeNull()
  })
  it('PATCH-ing the address onto an OLD row stamps reminder_set_at, and the next ask for that address is counted', async () => {
    const rows = [1, 2, 3].map(() => rsvpRow({ created_at: longAgo }))
    db = makeRsvpDb({ rsvps: rows })
    for (const row of rows) {
      const res = await patch({ reminderContact: 'victim@example.com' }, { cookie: cookieFor(EVITE_ID, tokenFor(row)) })
      expect((await res.json()).reminderDropped).toBeUndefined()
    }
    expect(rsvps().map((r) => r.reminder_set_at)).toEqual([NOW.toISOString(), NOW.toISOString(), NOW.toISOString()])
    // the 24-hour count now sees all three (it saw ZERO while it counted created_at, which is 30 days old)
    const rpc = (db.supabase as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown }> }).rpc
    expect((await rpc('evite_reminder_email_recent', { p_email: 'victim@example.com' })).data).toBe(3)
    // and a fourth ask, by POST, is refused
    const body = await (await post({ ...YES, reminderContact: 'victim@example.com' })).json()
    expect(body.reminderDropped).toBe(true)
  })
  it('a PATCH over the 24-hour cap is stored WITHOUT the address and says so', async () => {
    const mine = rsvpRow({ created_at: longAgo })
    db = makeRsvpDb({ rsvps: [mine, ...[1, 2, 3].map(() => rsvpRow({ evite_id: OTHER_EVITE_ID, reminder_email: 'victim@example.com', created_at: longAgo, reminder_set_at: recent }))] })
    const res = await patch({ reminderContact: 'victim@example.com' }, { cookie: cookieFor(EVITE_ID, tokenFor(mine)) })
    expect((await res.json()).reminderDropped).toBe(true)
    expect(db.tables.evite_rsvps[0].reminder_email).toBeNull()
    expect(db.tables.evite_rsvps[0].reminder_set_at).toBeNull()
  })
  it('per evite: at most three RSVPs on ONE invitation may hold the same address (case-insensitive), by POST or by PATCH', async () => {
    const held = [1, 2, 3].map(() => rsvpRow({ reminder_email: 'Victim@Example.com', reminder_set_at: longAgo, created_at: longAgo }))
    const mine = rsvpRow({ created_at: longAgo })
    db = makeRsvpDb({ rsvps: [mine, ...held] })
    const viaPost = await (await post({ ...YES, reminderContact: 'victim@example.com' })).json()
    expect(viaPost.reminderDropped).toBe(true)
    const viaPatch = await (await patch({ reminderContact: 'victim@example.com' }, { cookie: cookieFor(EVITE_ID, tokenFor(mine)) })).json()
    expect(viaPatch.reminderDropped).toBe(true)
    expect(db.tables.evite_rsvps.filter((r) => r.reminder_email === 'victim@example.com')).toHaveLength(0)
    expect(db.rpcCalls.some((c) => c.name === 'evite_reminder_email_on_evite')).toBe(true)
  })
  it('two holders on the invitation is under the per-evite cap', async () => {
    const held = [1, 2].map(() => rsvpRow({ reminder_email: 'victim@example.com', reminder_set_at: longAgo, created_at: longAgo }))
    db = makeRsvpDb({ rsvps: held })
    const body = await (await post({ ...YES, reminderContact: 'victim@example.com' })).json()
    expect(body.reminderDropped).toBeUndefined()
  })
  it('a failed per-evite count fails toward NOT emailing a stranger', async () => {
    const real = db.supabase as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<unknown> }
    const original = real.rpc.bind(real)
    real.rpc = async (name, args) => (name === 'evite_reminder_email_on_evite' ? { data: null, error: { message: 'boom' } } : original(name, args))
    const body = await (await post({ ...YES, reminderContact: 'pat@example.com' })).json()
    expect(body.reminderDropped).toBe(true)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('evite_reminder_email_on_evite failed'))
  })
})

describe('v1.2 finding 3: the RSVP API shares the page ceiling (no second enumeration oracle)', () => {
  it('POST and PATCH count against eviteViewRule BEFORE resolving: 60 calls from one address, then 429, with no database read for the 61st', async () => {
    const codes: number[] = []
    // 404s (unknown slug) are exactly what an enumeration run produces; the RSVP rule (10) would stop at 10, so use a spread of callers for it
    for (let i = 0; i < 60; i++) {
      const ip = `198.51.100.${(i % 200) + 1}`
      codes.push((await post(YES, { slug: 'zed-glow-0000', headers: { 'cf-connecting-ip': ip } })).status)
    }
    expect(new Set(codes)).toEqual(new Set([404]))
    // the same caller, now on the view bucket alone: 60 shared with page views
    __resetRateLimitForTests()
    const caller = { 'cf-connecting-ip': '203.0.113.77' }
    const { eviteViewRule, guardRate } = await import('@/lib/rateLimit')
    for (let i = 0; i < 59; i++) expect(guardRate(new NextRequest(`${ORIGIN}/i/x`, { headers: caller }), eviteViewRule)).toBeNull()
    // one view token left: the RSVP POST spends it (and the RSVP rule's own), the next call is the view rule's 429
    const first = await post(YES, { slug: 'zed-glow-0000', headers: caller })
    expect(first.status).toBe(404)
    const selectsBefore = db.selects.length
    const second = await post(YES, { slug: 'zed-glow-0000', headers: caller })
    expect(second.status).toBe(429)
    expect(db.selects.length).toBe(selectsBefore)
    const third = await patch({ parentName: 'x' }, { slug: 'zed-glow-0000', headers: caller })
    expect(third.status).toBe(429)
  })
})
