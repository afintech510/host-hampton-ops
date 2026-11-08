/**
 * The crew-management app's new screens: the booking tiles' data, the filter buttons,
 * the routes' gates, the roster's party lines, the data cache that makes a tab change
 * instant, and the staff app's prefetching.
 */
import fs from 'fs'
import path from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { decomment } from '../helpers/sourceScan'

const mockBooked = jest.fn()
jest.mock('@/app/api/admin/booked/route', () => ({ GET: (...a: unknown[]) => mockBooked(...a) }))
jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({}) }))

import { bookingsWindow, loadBookingTiles } from '@/lib/crewAppData'
import * as cache from '@/app/admin/crew/_components/adminData'
import PartyFilters, { passesTypes } from '@/app/admin/crew/_components/PartyFilters'
import { GET as dashboardGet } from '@/app/api/admin/crew-app/dashboard/route'
import { GET as bookingsGet } from '@/app/api/admin/crew-app/bookings/route'
import { GET as bookingGet } from '@/app/api/admin/crew-app/booking/[id]/route'

const read = (rel: string) => decomment(fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8'))

const TODAY = '2026-11-07'

const party = (over: Record<string, unknown>) => ({
  id: 'b1', booking_ref: 'HH-PTY-AAA11', stage: 'booked', payment_status: 'deposit_paid', party_type: 'in_studio_theme', party_date: '2026-11-14', party_time: '14:00',
  guest_count_approx: 12, child_name: 'Sam', child_age: 7, contact_name: 'Sample Client', package_type: 'Glow Party', total_cents: 100_000, balance_cents: 75_000, paid_cents: 25_000, ...over,
}) as never

type Rows = Record<string, Array<Record<string, unknown>>>
function fakeDb(tables: Rows, failOn?: string) {
  return {
    from: (t: string) => {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'in', 'neq']) q[m] = () => q
      q.then = (res: (v: unknown) => unknown) => Promise.resolve(failOn === t ? { data: null, error: { message: 'down' } } : { data: tables[t] ?? [], error: null }).then(res)
      return q
    },
  } as never
}

describe('the booking tiles\' data', () => {
  it('the window is this month and the next two, whole months', () => {
    expect(bookingsWindow(TODAY)).toEqual({ from: '2026-11-01', to: '2027-01-31' })
  })

  it('keeps booked / completed parties inside the window, soonest first, with who is on the crew', async () => {
    const parties = [
      party({ id: 'late', booking_ref: 'HH-LATE', party_date: '2027-01-30' }),
      party({ id: 'b1' }),
      party({ id: 'out', party_date: '2027-02-01' }),
      party({ id: 'past', party_date: '2026-10-31' }),
      party({ id: 'lead', stage: 'quoted' }),
      party({ id: 'cancelled', stage: 'cancelled' }),
      party({ id: 'nodate', party_date: null }),
      party({ id: 'done', stage: 'completed', party_date: '2026-11-02', booking_ref: 'HH-DONE' }),
    ]
    const db = fakeDb({
      crew_parties: [{ id: 'cp1', booking_id: 'b1', status: 'published' }],
      crew_slots: [
        { party_id: 'cp1', role: 'lead', status: 'assigned', member_id: 'm1', confirmed_at: '2026-11-01T00:00:00Z' },
        { party_id: 'cp1', role: 'crew', status: 'assigned', member_id: 'm2', confirmed_at: null },
        { party_id: 'cp1', role: 'crew', status: 'open', member_id: null, confirmed_at: null },
      ],
      crew_members: [{ id: 'm1', first_name: 'Riley' }, { id: 'm2', first_name: 'Jordan' }],
    })
    const r = await loadBookingTiles(db, parties as never, TODAY)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tiles.map(t => t.id)).toEqual(['done', 'b1', 'late'])
    const b1 = r.tiles.find(t => t.id === 'b1')!
    expect(b1).toMatchObject({ partyTime: '2:00 PM', balanceCents: 75_000, totalCents: 100_000 })
    expect(b1.crew).toEqual({
      partyId: 'cp1', status: 'published', needed: 3, staffed: 2,
      people: [{ firstName: 'Riley', role: 'lead', confirmed: true }, { firstName: 'Jordan', role: 'crew', confirmed: false }],
    })
    expect(r.tiles.find(t => t.id === 'late')!.crew).toBeNull()
  })

  it('All includes past, later and undated bookings while excluding leads and cancelled parties', async () => {
    const r = await loadBookingTiles(fakeDb({}), [
      party({ id: 'past', party_date: '2025-12-01' }),
      party({ id: 'later', party_date: '2028-04-01' }),
      party({ id: 'no-date', party_date: null }),
      party({ id: 'lead', stage: 'quoted' }),
      party({ id: 'cancelled', stage: 'cancelled' }),
    ], TODAY, undefined, true)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.tiles.map(t => t.id).sort()).toEqual(['later', 'no-date', 'past'])
  })

  it('an unreadable crew table is an error, not "nobody is staffed"', async () => {
    const r = await loadBookingTiles(fakeDb({}, 'crew_parties'), [party({})] as never, TODAY)
    expect(r.ok).toBe(false)
    const r2 = await loadBookingTiles(fakeDb({ crew_parties: [{ id: 'cp1', booking_id: 'b1', status: 'draft' }] }, 'crew_slots'), [party({})] as never, TODAY)
    expect(r2.ok).toBe(false)
  })

  it('reads the crew by first name only, never a pay column', () => {
    const src = read('lib/crewAppData.ts')
    expect(src).toMatch(/select\('id, first_name'\)/)
    expect(src).not.toMatch(/hourly_rate|pay_cents|tip_cents|extra_flat|steps/)
    expect(src.match(/\.(insert|update|upsert|delete)\s*\(/g)).toBeNull()
  })
})

describe('the filter buttons', () => {
  const noop = () => undefined
  const html = (over: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      createElement(PartyFilters, {
        types: [], onTypes: noop, months: [{ key: '2026-11', label: 'Nov', count: 5 }, { key: '2026-12', label: 'Dec', count: 2 }, { key: '2027-01', label: 'Jan', count: 0 }],
        month: '2026-11', onMonth: noop, dayCounts: { '2026-11-01': 1, '2026-11-05': 2, '2026-11-07': 1 }, day: null, onDay: noop, weekend: [], onWeekend: noop, ...over,
      } as never),
    )

  it('has, centred and in order: the three kinds, the three months, then the Sat / Sun / date row', () => {
    const h = html()
    const at = ['>Theme Party<', '>Mobile<', '>Studio Rental<', 'Nov', 'Dec', 'Jan', '>All<', '>Sat<', '>Sun<', '>1<', '>5<', '>7<'].map(s => h.indexOf(s))
    expect(at.every(i => i > -1)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(h.match(/justify-center/g)!.length).toBeGreaterThanOrEqual(3)
    // Only the dates that have something on are offered, and never a week number.
    expect(h).not.toContain('>2<')
    expect(h).not.toContain('Week of the month')
    expect(h).toContain('Sun Nov 1')
    expect(h).toContain('Thu Nov 5')
  })

  it('lights the chosen kind, month and date', () => {
    const h = html({ types: ['mobile_party'], month: '2026-12', day: '2026-12-12', dayCounts: { '2026-12-12': 1 } })
    expect(h).toMatch(/aria-pressed="true"[^>]*>Mobile</)
    expect(h).toMatch(/aria-pressed="false"[^>]*>Theme Party</)
    expect(h).toMatch(/aria-pressed="true"[^>]*>Dec/)
    expect(h).toMatch(/aria-pressed="true"[^>]*>12</)
    expect(h).toMatch(/aria-pressed="false"[^>]*>All</)
    expect(h).toContain('Sat Dec 12')
  })

  it('lights Sat and Sun on their own, and All only when nothing narrows', () => {
    const h = html({ weekend: ['sat'] })
    expect(h).toMatch(/aria-pressed="true"[^>]*>Sat</)
    expect(h).toMatch(/aria-pressed="false"[^>]*>Sun</)
    expect(h).toMatch(/aria-pressed="false"[^>]*>All</)
    expect(html()).toMatch(/aria-pressed="true"[^>]*>All</)
  })

  it('has no day row for the No date bucket, and no date buttons where no month is lit', () => {
    expect(html({ month: 'none', dayCounts: null })).not.toContain('aria-label="Day"')
    const later = html({ month: 'later', dayCounts: null })
    expect(later).toContain('>Sat<')
    expect(later).not.toMatch(/>\d{1,2}<\/button>/)
  })

  it('no kind lit means every kind passes; lit kinds narrow', () => {
    expect(passesTypes('mobile_party', [])).toBe(true)
    expect(passesTypes(null, [])).toBe(true)
    expect(passesTypes('mobile_party', ['in_studio_theme'])).toBe(false)
    expect(passesTypes('studio_rental', ['mobile_party', 'studio_rental'])).toBe(true)
    expect(passesTypes(null, ['mobile_party'])).toBe(false)
  })
})

describe('the routes are admin only', () => {
  const anon = (url: string) => new NextRequest(`http://localhost${url}`)
  beforeAll(() => {
    process.env.ADMIN_PASSWORD = 'pw-for-tests'
  })
  it('refuse a stranger and never reach the data', async () => {
    mockBooked.mockClear()
    expect((await dashboardGet(anon('/api/admin/crew-app/dashboard'))).status).toBe(401)
    expect((await bookingsGet(anon('/api/admin/crew-app/bookings'))).status).toBe(401)
    expect((await bookingGet(anon('/api/admin/crew-app/booking/x'), { params: { id: 'aaaaaaaa-0000-4000-8000-000000000001' } })).status).toBe(401)
    expect(mockBooked).not.toHaveBeenCalled()
  })

  it('each is gated first and writes nothing', () => {
    for (const f of ['dashboard/route.ts', 'bookings/route.ts', 'booking/[id]/route.ts']) {
      const s = read(`app/api/admin/crew-app/${f}`)
      expect(s).toMatch(/export async function GET\([^)]*\) \{\s*if \(!isAdminAuthorized\(req\)\) return unauthorizedResponse\(\)/)
      expect(s.match(/\.(insert|update|upsert|delete)\s*\(/g)).toBeNull()
    }
  })
})

describe('the data cache behind the instant tabs', () => {
  afterEach(() => cache.clearCache())

  it('holds what it read, joins a read already running, and serves the held copy at once', async () => {
    let calls = 0
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => {
      calls++
      return { ok: true, status: 200, json: async () => ({ n: calls }) }
    })
    await Promise.all([cache.load('/api/x'), cache.load('/api/x')])
    expect(calls).toBe(1)
    cache.warm(['/api/x']) // fresh: no new read
    expect(calls).toBe(1)
    await cache.load('/api/x')
    expect(calls).toBe(2)
  })

  it('a failed read keeps the last good data and records the error', async () => {
    let ok = true
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => (ok ? { ok: true, status: 200, json: async () => ({ v: 1 }) } : { ok: false, status: 503, json: async () => ({ error: 'down' }) }))
    await cache.load('/api/y')
    ok = false
    await cache.load('/api/y')
    const held = cache.peek('/api/y')
    expect(held?.data).toEqual({ v: 1 })
    expect(held?.error).toBe('down')
    expect(held?.at).toBeGreaterThan(0)
  })
})

describe('the staff app prefetches and the roster lists the parties', () => {
  it('tabs, party titles and the brand are prefetched links, and a skeleton covers a cold page', () => {
    expect(read('app/crew/_components/CrewNav.tsx')).toMatch(/<Link key=\{t\.href\} href=\{t\.href\} prefetch/)
    expect(read('app/crew/_components/PartyCard.tsx')).toMatch(/crew-party-link" href=\{`\/crew\/parties\/\$\{v\.id\}`\} prefetch>/)
    expect(read('app/crew/_components/CrewBrand.tsx')).toMatch(/<Link href=\{href\} prefetch/)
    expect(read('app/crew/loading.tsx')).toMatch(/aria-busy="true"/)
  })

  it('the roster carries each person\'s upcoming parties, soonest first, with no pay', () => {
    const lib = read('lib/crew/adminMembers.ts')
    expect(lib).toMatch(/parties: partiesOf\.get\(m\.id\) \?\? \[\]/)
    expect(lib).toMatch(/list\.sort\(\(a, b\) => a\.startsAt\.localeCompare\(b\.startsAt\)\)/)
    const iface = lib.slice(lib.indexOf('export interface RosterParty'), lib.indexOf('export interface HiredApplication'))
    expect(iface).not.toMatch(/pay|rate|steps|tip/i)
  })
})
