/**
 * POST /api/crew/availability — "I can't work" as a start and an end (migration 088).
 *
 * The promises: a datetime-local value is Eastern wall-clock time; a period that
 * overlaps a party the member is working is refused (that is "Can't make it");
 * a bad or backwards range is a 400; taking one back only ever touches the
 * caller's own row; an unreadable table is a 503, never a silent success.
 */
import { NextRequest } from 'next/server'

const MEMBER = { id: '11111111-1111-4111-8111-111111111111', first_name: 'Test', is_test: true }
const OTHERS_ROW = '99999999-9999-4999-8999-999999999999'

let INSERTS: Record<string, unknown>[] = []
let DELETES: { id: unknown; member_id: unknown }[] = []
let EXISTING: { starts_at: string; ends_at: string }[] = []
let WINDOWS: { partyId: string; window: { startsAt: Date; endsAt: Date } }[] = []
let failWrite = false
let failWindows = false

jest.mock('@/lib/crew/auth', () => ({
  requireCrewMember: async () => ({ ok: true, member: MEMBER }),
}))
jest.mock('@/lib/crew/board', () => ({
  myLiveWindows: async () => (failWindows ? { kind: 'unavailable', error: 'boom' } : { kind: 'ok', data: WINDOWS }),
}))
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table !== 'crew_unavailable_periods') throw new Error(`unexpected table ${table}`)
      const f: Record<string, unknown> = {}
      let mode: 'select' | 'delete' | 'insert' = 'select'
      let row: Record<string, unknown> = {}
      const chain: any = {
        select: () => chain,
        delete: () => { mode = 'delete'; return chain },
        insert: (r: Record<string, unknown>) => { mode = 'insert'; row = r; return chain },
        eq: (c: string, v: unknown) => { f[c] = v; return chain },
        gt: () => chain,
        maybeSingle: async () => run(),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
      }
      function run() {
        if (mode === 'delete') {
          if (failWrite) return { data: null, error: { message: 'boom' } }
          DELETES.push({ id: f.id, member_id: f.member_id })
          return { data: [], error: null }
        }
        if (mode === 'insert') {
          if (failWrite) return { data: null, error: { message: 'boom' } }
          INSERTS.push(row)
          return { data: { id: 'new' }, error: null }
        }
        return { data: EXISTING, error: null }
      }
      return chain
    },
  }),
}))

import { POST } from '@/app/api/crew/availability/route'
import { __resetRateLimitForTests } from '@/lib/rateLimit'

function post(body: unknown) {
  return POST(new NextRequest('http://localhost:3002/api/crew/availability', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
    body: JSON.stringify(body),
  }))
}

// "Now" is 2026-11-05 12:00 ET (EST, UTC-5). Everything below is after it.
const NOW = new Date('2026-11-05T17:00:00Z')

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout'] })
  jest.setSystemTime(NOW)
  INSERTS = []; DELETES = []; EXISTING = []; WINDOWS = []
  failWrite = false; failWindows = false
  __resetRateLimitForTests()
})
afterEach(() => jest.useRealTimers())

describe('adding a period', () => {
  it('stores it as the Eastern wall-clock instants it names', async () => {
    const res = await post({ start: '2026-11-14T15:00', end: '2026-11-15T09:30' })
    expect(res.status).toBe(200)
    expect(INSERTS).toEqual([{
      member_id: MEMBER.id,
      starts_at: '2026-11-14T20:00:00.000Z', // 3:00 PM EST
      ends_at: '2026-11-15T14:30:00.000Z',   // 9:30 AM EST
    }])
  })

  it('follows daylight time: July is UTC-4', async () => {
    jest.setSystemTime(new Date('2026-07-01T12:00:00Z'))
    await post({ start: '2026-07-10T15:00', end: '2026-07-10T18:00' })
    expect(INSERTS[0]).toMatchObject({ starts_at: '2026-07-10T19:00:00.000Z', ends_at: '2026-07-10T22:00:00.000Z' })
  })

  it.each([
    ['nothing at all', {}],
    ['a start with no end', { start: '2026-11-14T15:00' }],
    ['a date with no time', { start: '2026-11-14', end: '2026-11-15' }],
    ['a bare year', { start: '2026T12:00', end: '2026-11-15T12:00' }],
    ['a date that does not exist', { start: '2026-02-30T10:00', end: '2026-03-01T10:00' }],
    ['an hour that does not exist', { start: '2026-11-14T25:00', end: '2026-11-15T10:00' }],
    ['a number', { start: 5, end: 6 }],
  ])('refuses %s', async (_name, body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(INSERTS).toEqual([])
  })

  it('refuses an end that is not after the start', async () => {
    expect((await post({ start: '2026-11-14T15:00', end: '2026-11-14T15:00' })).status).toBe(400)
    expect((await post({ start: '2026-11-14T15:00', end: '2026-11-14T10:00' })).status).toBe(400)
    expect(INSERTS).toEqual([])
  })

  it('refuses a period that is already over, but accepts one that has started', async () => {
    expect((await post({ start: '2026-11-04T09:00', end: '2026-11-05T11:00' })).status).toBe(400)
    expect((await post({ start: '2026-11-05T09:00', end: '2026-11-05T20:00' })).status).toBe(200)
    expect(INSERTS).toHaveLength(1)
  })

  it('refuses a start more than a year out and a span longer than a year', async () => {
    expect((await post({ start: '2027-12-01T09:00', end: '2027-12-02T09:00' })).status).toBe(400)
    expect((await post({ start: '2026-11-06T09:00', end: '2027-12-30T09:00' })).status).toBe(400)
    expect(INSERTS).toEqual([])
  })

  it('refuses a period that lands on a party they are working, and names Can\'t make it', async () => {
    // Sat 2026-11-14, 1:00–4:00 PM ET.
    WINDOWS = [{ partyId: 'p1', window: { startsAt: new Date('2026-11-14T18:00:00Z'), endsAt: new Date('2026-11-14T21:00:00Z') } }]
    const res = await post({ start: '2026-11-14T15:00', end: '2026-11-14T20:00' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/Can't make it/)
    expect(INSERTS).toEqual([])
  })

  it('allows a period that ends exactly when the party starts, or starts when it ends', async () => {
    WINDOWS = [{ partyId: 'p1', window: { startsAt: new Date('2026-11-14T18:00:00Z'), endsAt: new Date('2026-11-14T21:00:00Z') } }]
    expect((await post({ start: '2026-11-14T08:00', end: '2026-11-14T13:00' })).status).toBe(200)
    expect((await post({ start: '2026-11-14T16:00', end: '2026-11-14T22:00' })).status).toBe(200)
  })

  it('adding the same period twice stores it once', async () => {
    EXISTING = [{ starts_at: '2026-11-14T20:00:00.000Z', ends_at: '2026-11-15T14:30:00.000Z' }]
    expect((await post({ start: '2026-11-14T15:00', end: '2026-11-15T09:30' })).status).toBe(200)
    expect(INSERTS).toEqual([])
  })

  it('stops at a bounded number of live periods', async () => {
    EXISTING = Array.from({ length: 60 }, (_, i) => ({
      starts_at: new Date(Date.UTC(2026, 11, 1 + (i % 28), 14 + Math.floor(i / 28))).toISOString(),
      ends_at: new Date(Date.UTC(2026, 11, 1 + (i % 28), 15 + Math.floor(i / 28))).toISOString(),
    }))
    const res = await post({ start: '2026-11-20T09:00', end: '2026-11-20T10:00' })
    expect(res.status).toBe(400)
    expect(INSERTS).toEqual([])
  })

  it('an unreadable party list is a 503, not a write', async () => {
    failWindows = true
    expect((await post({ start: '2026-11-14T15:00', end: '2026-11-15T09:30' })).status).toBe(503)
    expect(INSERTS).toEqual([])
  })

  it('a failed insert is a 503, not a success', async () => {
    failWrite = true
    expect((await post({ start: '2026-11-14T15:00', end: '2026-11-15T09:30' })).status).toBe(503)
  })
})

describe('taking one back', () => {
  it('deletes by id AND by the caller, never by id alone', async () => {
    const res = await post({ remove: OTHERS_ROW })
    expect(res.status).toBe(200)
    expect(DELETES).toEqual([{ id: OTHERS_ROW, member_id: MEMBER.id }])
  })

  it('refuses an id that is not a uuid', async () => {
    expect((await post({ remove: "x' or 1=1" })).status).toBe(400)
    expect((await post({ remove: 7 })).status).toBe(400)
    expect(DELETES).toEqual([])
  })

  it('a failed delete is a 503', async () => {
    failWrite = true
    expect((await post({ remove: OTHERS_ROW })).status).toBe(503)
  })
})
