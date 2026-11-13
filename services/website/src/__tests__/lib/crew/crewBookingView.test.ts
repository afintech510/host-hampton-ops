/**
 * The crew app's read-only Bookings and Schedule (migration 100): who may see them, and what they
 * are NOT shown. The business side (money, contact details, links, the booking reference) must never
 * reach a crew page, so the shapes are allow-lists and this pins both the mappers and the routes.
 */
import fs from 'fs'
import path from 'path'
import { NextRequest } from 'next/server'
import { decomment } from '../../helpers/sourceScan'

const mockRequireCrewMember = jest.fn()
let viewerRow: { data: unknown; error: unknown } = { data: null, error: null }
jest.mock('@/lib/crew/auth', () => ({
  requireCrewMember: (...a: unknown[]) => mockRequireCrewMember(...a),
  isUuid: (v: unknown) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v),
}))
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => viewerRow }) }) }) }),
}))
const mockBooked = jest.fn()
jest.mock('@/lib/bookedParties', () => ({ loadBookedParties: (...a: unknown[]) => mockBooked(...a) }))

import { crewDetailOf, crewScheduleRowOf, crewTileOf, crewWeekendOf, loadBookingViewer, requireBookingViewer, venueOf } from '@/lib/crew/bookingView'
import { GET as bookingsGet } from '@/app/api/crew/bookings/route'
import { GET as bookingGet } from '@/app/api/crew/bookings/[id]/route'
import type { PartyCardData } from '@/lib/assistant/partyCard'

const read = (rel: string) => decomment(fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8'))
const req = (url = 'http://x/api/crew/bookings') => new NextRequest(url)

const MEMBER = { ok: true, member: { id: 'm1' } }

beforeEach(() => {
  mockRequireCrewMember.mockReset().mockResolvedValue(MEMBER)
  mockBooked.mockReset()
  viewerRow = { data: { enabled: true }, error: null }
})

describe('who has the view', () => {
  it('a member with an enabled row passes the gate', async () => {
    expect((await requireBookingViewer(req())).ok).toBe(true)
  })

  it('a member with no row, or a disabled one, gets a 404 as if the route did not exist', async () => {
    for (const row of [null, { enabled: false }]) {
      viewerRow = { data: row, error: null }
      const g = await requireBookingViewer(req())
      expect(g.ok).toBe(false)
      if (!g.ok) expect(g.response.status).toBe(404)
    }
  })

  it('an unreadable grant is a 503, never "no"', async () => {
    viewerRow = { data: null, error: { message: 'down' } }
    const g = await requireBookingViewer(req())
    expect(g.ok).toBe(false)
    if (!g.ok) expect(g.response.status).toBe(503)
    expect((await loadBookingViewer({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => viewerRow }) }) }) } as never, 'm1')).kind).toBe('unavailable')
  })

  it('a signed-out request keeps the crew gate\'s own answer', async () => {
    const response = new Response('{}', { status: 401 })
    mockRequireCrewMember.mockResolvedValue({ ok: false, response })
    const g = await requireBookingViewer(req())
    expect(g.ok).toBe(false)
    if (!g.ok) expect(g.response.status).toBe(401)
  })

  it('the list and the detail routes refuse a member without the view', async () => {
    viewerRow = { data: null, error: null }
    expect((await bookingsGet(req())).status).toBe(404)
    expect((await bookingGet(req(), { params: { id: '11111111-1111-1111-1111-111111111111' } })).status).toBe(404)
    expect(mockBooked).not.toHaveBeenCalled()
  })

  it('the detail route answers 404 for a booking that is not on the Booked list (a lead)', async () => {
    mockBooked.mockResolvedValue({ ok: true, data: { parties: [{ id: '11111111-1111-1111-1111-111111111111', booking_ref: 'HH-X', stage: 'quoted' }] } })
    expect((await bookingGet(req(), { params: { id: '11111111-1111-1111-1111-111111111111' } })).status).toBe(404)
    mockBooked.mockResolvedValue({ ok: true, data: { parties: [] } })
    expect((await bookingGet(req(), { params: { id: '22222222-2222-2222-2222-222222222222' } })).status).toBe(404)
    expect((await bookingGet(req(), { params: { id: 'not-a-uuid' } })).status).toBe(404)
  })
})

describe('what a crew member is not shown', () => {
  const SECRETS = ['631-555-0142', 'host@example.com', 'HH-PTY-SECRET', '$', 'admin', 'invoice', 'planner', '/admin', 'Samplerson', 'Venmo']

  it('a tile carries first names, the party and who is staffed, and nothing else', () => {
    const tile = crewTileOf({
      id: 'b1', ref: 'HH-PTY-SECRET', name: 'Pat Samplerson', childName: 'Sam Samplerson', childAge: 7, partyType: 'in_studio_theme',
      partyDate: '2026-12-12', partyTime: '2:00 PM', guests: 12, stage: 'booked', paymentStatus: 'deposit_paid', packageType: 'Glow',
      totalCents: 100_000, paidCents: 25_000, balanceCents: 75_000,
      crew: { partyId: 'cp1', status: 'published', needed: 2, staffed: 1, people: [{ firstName: 'Lexi', role: 'lead', confirmed: true }] },
    })
    expect(tile).toEqual({
      id: 'b1', parent: 'Pat', child: 'Sam', childAge: 7, partyType: 'in_studio_theme', partyDate: '2026-12-12', partyTime: '2:00 PM', guests: 12,
      crew: { status: 'published', needed: 2, staffed: 1, people: [{ firstName: 'Lexi', role: 'lead' }] },
    })
    const json = JSON.stringify(tile)
    for (const s of ['Samplerson', 'HH-PTY-SECRET', '100000', '75000', 'deposit_paid']) expect(json).not.toContain(s)
  })

  const card = (): PartyCardData => ({
    ref: 'HH-PTY-SECRET', bookingId: 'b1', title: "Sam Samplerson's Party", adminUrl: 'https://www.hosthampton.com/admin?tab=parties&party=b1', asOf: '2026-11-13T00:00:00Z',
    contact: { name: 'Pat Samplerson', phone: '631-555-0142', email: 'host@example.com' },
    when: 'Sat, Dec 12 · 2:00 PM', type: 'Theme Party', child: { name: 'Sam Samplerson', age: 7 }, guests: 12, status: 'Booked, deposit paid',
    theme: [{ name: 'Glow Party', quantity: 1, text: 'Glow Party ($950.00)', amountCents: 95_000, optional: false }],
    activities: [{ name: 'Face painting', quantity: 1, text: 'Face painting ($100.00)', amountCents: 10_000, optional: false }],
    addOns: [
      { name: 'Balloon arch', quantity: 2, text: 'Balloon arch ×2 ($120.00)', amountCents: 12_000, optional: false },
      { name: 'Piñata', quantity: 1, text: 'Piñata ($40.00) - optional', amountCents: 4_000, optional: true },
    ],
    food: [{ name: 'Bagel Platter', quantity: 1, text: 'Bagel Platter ($30.00)', amountCents: 3_000, optional: false }],
    desserts: [{ name: 'Cupcakes', quantity: 1, text: 'Cupcakes ($40.00)', amountCents: 4_000, optional: false }],
    discounts: [{ name: 'Friends and family', quantity: 1, text: 'Friends and family (-$50.00)', amountCents: -5_000, optional: false }],
    extraGuests: { count: 3, text: '3 ($90.00)', amountCents: 9_000 },
    totalCents: 100_000, paidCents: 25_000, owedCents: 75_000, tipCents: 2_000,
  })

  it('a booking\'s details have what to prepare and no money, contact details, links, reference or discounts', () => {
    const d = crewDetailOf(card(), '12 Ocean Ave', 'Park at the side door')
    expect(d).toMatchObject({
      title: "Sam's Party", when: 'Sat, Dec 12 · 2:00 PM', parent: 'Pat', child: 'Sam', childAge: 7, guests: 12,
      theme: ['Glow Party'], activities: ['Face painting'], addOns: ['Balloon arch ×2'], food: ['Bagel Platter'], desserts: ['Cupcakes'],
      extraGuests: 3, venue: '12 Ocean Ave', notes: 'Park at the side door',
    })
    const json = JSON.stringify(d)
    for (const s of SECRETS.filter(x => !['Venmo', 'admin', 'invoice', 'planner'].includes(x))) expect(json).not.toContain(s)
    expect(json).not.toMatch(/\d+\.\d{2}/)
    expect(json).not.toContain('Friends and family')
    expect(json).not.toContain('Piñata') // quoted, not booked
  })

  it('a mobile party\'s address comes from the planner tags, and nothing else', () => {
    expect(venueOf({ location_address: '12 Ocean Ave' })).toBe('12 Ocean Ave')
    expect(venueOf({ address: '9 Bay St' })).toBe('9 Bay St')
    expect(venueOf({ other: 'x' })).toBeNull()
    expect(venueOf(null)).toBeNull()
  })

  it('a schedule row has no alerts, flags, pick counts or availability', () => {
    const row = crewScheduleRowOf({
      id: 'p1', title: 'Theme party', theme: 'Glow', kind: 'in_studio_theme', booked: true, childName: 'Sam Samplerson', childAge: 7, parentName: 'Pat Samplerson',
      food: 'Pizza', cupcake: 'Vanilla', pick: { work: 2, standby: 1, unavailable: 0 }, startsAt: '2026-12-12T19:00:00Z', endsAt: '2026-12-12T22:00:00Z',
      guestCount: 12, status: 'published', flags: ['needs_time'], needed: 3, staffed: 2, leadFilled: true, available: 4,
      crew: [{ firstName: 'Lexi', role: 'lead', confirmed: true, isOwner: false }],
    } as never)
    expect(Object.keys(row).sort()).toEqual(['booked', 'child', 'childAge', 'crew', 'cupcake', 'endsAt', 'food', 'guestCount', 'id', 'kind', 'leadFilled', 'needed', 'parent', 'staffed', 'startsAt', 'status', 'theme', 'title'])
    expect(row.child).toBe('Sam')
    expect(row.parent).toBe('Pat')
    expect(row.crew).toEqual([{ firstName: 'Lexi', role: 'lead' }])
  })

  it('the weekend prep has first names only', () => {
    const w = crewWeekendOf({
      from: '2026-12-12', to: '2026-12-13',
      parties: [{ partyId: 'p1', title: 'T', kind: 'in_studio_theme', status: 'published', startsAt: 'a', endsAt: 'b', kids: 10, child: 'Sam Samplerson', parent: 'Pat Samplerson', theme: 'Glow', main: 'Pizza', cupcakes: null, food: [], drinks: [], addOns: [], activities: [] }],
      totals: { parties: 1, kids: 10, pizzaKids: 10, bagelKids: 0, cupcakes: [], food: [], drinks: [], addOns: [], activities: [] },
    } as never)
    expect(w.parties[0]).toMatchObject({ child: 'Sam', parent: 'Pat' })
  })
})

describe('the surface is read only and goes through the gate', () => {
  const ROUTES = ['app/api/crew/bookings/route.ts', 'app/api/crew/bookings/[id]/route.ts', 'app/api/crew/schedule/route.ts', 'app/api/crew/weekend/route.ts']

  it('every route is a GET behind requireBookingViewer, ahead of any read', () => {
    for (const f of ROUTES) {
      const src = read(f)
      expect(src).toMatch(/export async function GET\(/)
      expect(src).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)\b/)
      const gate = src.indexOf('requireBookingViewer(req)')
      expect(gate).toBeGreaterThan(-1)
      // The first thing after the gate's own check is the data; nothing is loaded before it.
      expect(src.slice(src.indexOf('export async function GET'), gate)).not.toMatch(/\.from\(|loadBookedParties\(|loadAdminOverview\(|loadWeekendSummary\(|loadPartyCard\(/)
    }
  })

  it('no route reaches the admin credential, a link minter or a writer', () => {
    for (const f of [...ROUTES, 'lib/crew/bookingView.ts']) {
      const src = read(f)
      expect(src).not.toMatch(/isAdminAuthorized|mintPortalLink|portalLinkMint|\.(insert|update|upsert|delete)\(/)
    }
  })

  it('both pages 404 without the view, and the tabs are only drawn for it', () => {
    for (const f of ['app/crew/bookings/page.tsx', 'app/crew/schedule/page.tsx']) {
      const src = read(f)
      expect(src).toMatch(/loadBookingViewer\(/)
      expect(src).toMatch(/if \(!v\.data\) notFound\(\)/)
    }
    expect(read('app/crew/_components/CrewTop.tsx')).toMatch(/showBookings=\{viewer\?\.kind === 'ok' && viewer\.data\}/)
    expect(read('app/crew/_components/CrewNav.tsx')).toMatch(/showBookings \|\| !bookingTabs\.includes\(t\.href\)/)
  })

  it('the crew screens render no money, contact or link field', () => {
    for (const f of ['app/crew/_components/BookingsView.tsx', 'app/crew/_components/ScheduleView.tsx', 'app/crew/_components/WeekendPrep.tsx']) {
      const src = read(f)
      expect(src).not.toMatch(/Cents|dollars|mailto:|tel:|\bphone\b|\bemail\b|invoice|planner|Ask AI|href=[^>]*\/admin/i)
    }
  })

  it('the Booked list has one definition: the admin route and the crew route both call loadBookedParties', () => {
    expect(read('app/api/admin/booked/route.ts')).toMatch(/loadBookedParties\(\)/)
    expect(read('app/api/crew/bookings/route.ts')).toMatch(/loadBookedParties\(\)/)
  })
})
