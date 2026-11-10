/**
 * change_theme: swap the studio theme (price from the catalogue row, not the card), toggle the
 * mini-party discount, or convert a mobile party to an in-studio theme party. The extra-guest
 * line and the totals follow.
 */
type Row = Record<string, any>
let lines: Row[] = []
let bookings: Row[] = []
let items: Row[] = []
let nextId = 100

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, json: async () => body, body }) },
}))
jest.mock('@/lib/adminAuth', () => ({ isAdminAuthorized: () => true, unauthorizedResponse: () => ({ status: 401 }), adminActorId: () => 'admin:test' }))
jest.mock('@/lib/bookingAudit', () => ({ logBookingChange: jest.fn(async () => true) }))
jest.mock('@/lib/calendarSync', () => ({ syncBookingCalendar: jest.fn(async () => ({ ok: true })), clearBookingCalendar: jest.fn() }))
jest.mock('@/lib/checkinReminders', () => ({ enqueueCheckinReminders: jest.fn(), cancelCheckinReminders: jest.fn() }))
jest.mock('@/lib/pricingCatalog', () => ({
  ...jest.requireActual('@/lib/pricingCatalog'),
  loadPricingCatalog: async () => ({ guestRules: { includedGuests: 10, extraGuestCents: 3500, miniPartyDiscountCents: 20000, miniPartyMaxGuests: 6 } }),
}))

function table(name: string) {
  let op: 'select' | 'update' | 'delete' | 'insert' = 'select'
  let patch: Row = {}
  let inserted: Row[] = []
  const filters: ((r: Row) => boolean)[] = []
  const q: Record<string, any> = {}
  const src = (): Row[] => (name === 'booking_line_items' ? lines : name === 'bookings' ? bookings : name === 'pricing_items' ? items : [])
  q.select = () => q
  q.eq = (c: string, v: any) => (filters.push(r => r[c] === v), q)
  q.in = (c: string, vs: any[]) => (filters.push(r => vs.includes(r[c])), q)
  q.update = (p: Row) => ((op = 'update'), (patch = p), q)
  q.delete = () => ((op = 'delete'), q)
  q.insert = (p: Row) => {
    op = 'insert'
    inserted = [{ id: `n${nextId++}`, ...p }]
    if (name === 'booking_line_items') lines.push(...inserted)
    return q
  }
  const rowsNow = () => src().filter(r => filters.every(f => f(r)))
  q.maybeSingle = async () => ({ data: rowsNow()[0] ?? null, error: null })
  q.single = async () => ({ data: rowsNow()[0] ?? null, error: null })
  q.then = (res: (v: any) => any) => {
    if (op === 'insert') return Promise.resolve({ data: inserted, error: null }).then(res)
    const rows = rowsNow()
    if (op === 'update') rows.forEach(r => Object.assign(r, patch))
    if (op === 'delete' && name === 'booking_line_items') lines = lines.filter(r => !rows.includes(r))
    return Promise.resolve({ data: rows, error: null }).then(res)
  }
  return q
}
jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ from: (n: string) => table(n) }) }))

import { POST } from '@/app/api/admin/parties/[id]/route'

const act = (b: Row) => POST({ json: async () => b, headers: { get: () => null } } as any, { params: Promise.resolve({ id: 'b1' }) })
const theme = () => lines.find(l => l.category === 'theme' && l.pricing_item_id)

beforeEach(() => {
  items = [
    { id: 'slime', name: 'Slime Party', category: 'party-theme', price_cents: 59500, is_active: true },
    { id: 'glow', name: 'Glow Party', category: 'party-theme', price_cents: 69500, is_active: true },
    { id: 'old', name: 'Retired Party', category: 'party-theme', price_cents: 50000, is_active: false },
    { id: 'pizza', name: 'Pizza', category: 'food-add-on', price_cents: 1000, is_active: true },
  ]
  bookings = [{
    id: 'b1', booking_ref: 'HH-PTY-1', event_type: 'kid-party', party_type: 'in_studio_theme', package_type: 'Slime Party', status: 'approved',
    guest_count_approx: 19, quote_snapshot: { theme: 'slime', themeName: 'Slime Party', guestCount: 19, activities: ['a1'] }, party_tags: {},
  }]
  lines = [
    { booking_id: 'b1', id: 't', name: 'Slime Party', category: 'theme', pricing_item_id: 'slime', quantity: 1, unit_price_cents: 59500, price_type: 'flat', guest_multiplied: false, sort_order: 0 },
    { booking_id: 'b1', id: 'x', name: 'Additional Guests', category: 'theme', pricing_item_id: null, quantity: 9, unit_price_cents: 3500, price_type: 'flat', guest_multiplied: false, sort_order: 1 },
  ]
})

describe('change_theme on an in-studio theme party', () => {
  it('swaps the theme line and price from the catalogue and updates the labels and snapshot', async () => {
    const res: any = await act({ action: 'change_theme', theme_id: 'glow' })
    expect(res.body.ok).toBe(true)
    expect(theme()).toMatchObject({ name: 'Glow Party', pricing_item_id: 'glow', unit_price_cents: 69500 })
    expect(lines).toHaveLength(2)
    expect(bookings[0].package_type).toBe('Glow Party')
    expect(bookings[0].quote_snapshot).toMatchObject({ theme: 'glow', themeName: 'Glow Party', activities: ['a1'] })
    expect(res.body.totalCents).toBe(69500 + 9 * 3500)
  })

  it('mini party takes the catalogue discount off the theme and caps the extra guests', async () => {
    const res: any = await act({ action: 'change_theme', theme_id: 'slime', mini: true })
    expect(theme()!.unit_price_cents).toBe(59500 - 20000)
    expect(bookings[0].quote_snapshot.isMiniParty).toBe(true)
    expect(lines.find(l => l.name === 'Additional Guests')).toBeUndefined()
    expect(res.body.totalCents).toBe(39500)
  })

  it('warns that activity lines were not re-derived', async () => {
    lines.push({ booking_id: 'b1', id: 'a', name: 'Slime Making (included)', category: 'activity-add-on', pricing_item_id: 'a1', quantity: 1, unit_price_cents: 0, price_type: 'flat', guest_multiplied: false })
    const res: any = await act({ action: 'change_theme', theme_id: 'glow' })
    expect(res.body.warning).toMatch(/activity lines.*not re-derived/)
  })

  it('refuses a retired theme, a non-theme item, and a missing id, changing nothing', async () => {
    for (const theme_id of ['old', 'pizza', 'nope']) {
      expect(((await act({ action: 'change_theme', theme_id })) as any).status).toBe(400)
    }
    expect(((await act({ action: 'change_theme' })) as any).status).toBe(400)
    expect(theme()!.name).toBe('Slime Party')
  })
})

describe('change_theme on a mobile party', () => {
  beforeEach(() => {
    bookings[0] = { ...bookings[0], party_type: 'mobile_party', package_type: 'Mobile Party', guest_count_approx: 12, quote_snapshot: { locationType: 'mobile' }, party_tags: { location_type: 'mobile', location_address: '1 Main St' } }
    lines = [{ booking_id: 'b1', id: 'm', name: 'Mobile Party Package (up to 15 guests)', category: 'mobile-package', pricing_item_id: null, quantity: 1, unit_price_cents: 135000, price_type: 'flat', guest_multiplied: false, sort_order: 0 }]
  })

  it('will not swap a mobile package without being told it is a conversion', async () => {
    const res: any = await act({ action: 'change_theme', theme_id: 'slime' })
    expect(res.status).toBe(400)
    expect(lines).toHaveLength(1)
  })

  it('converts: removes the mobile package, adds the theme and the extra guests, flips the type', async () => {
    const res: any = await act({ action: 'change_theme', theme_id: 'slime', from_mobile: true })
    expect(res.body.ok).toBe(true)
    expect(lines.find(l => l.category === 'mobile-package')).toBeUndefined()
    expect(theme()).toMatchObject({ name: 'Slime Party', unit_price_cents: 59500 })
    expect(lines.find(l => l.name === 'Additional Guests')).toMatchObject({ quantity: 2, unit_price_cents: 3500 })
    expect(bookings[0]).toMatchObject({ party_type: 'in_studio_theme', package_type: 'Slime Party' })
    expect(bookings[0].party_tags).toMatchObject({ location_type: 'studio', location_address: '1 Main St' })
    expect(res.body.totalCents).toBe(59500 + 2 * 3500)
  })
})
