/**
 * A studio rental's price follows its date and window on EVERY edit path.
 *  - customer self-serve edit keeps admin-typed lines and honours a custom hourly rate
 *  - admin date/time PATCH reprices (weekday -> weekend) and keeps the tags in step
 *  - admin edit_rental reports a failed save instead of answering ok
 */
type Row = Record<string, any>
let lines: Row[] = []
let bookings: Row[] = []
let failBookingUpdate = false
let nextId = 100

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, json: async () => body, body }) },
}))
jest.mock('@/lib/adminAuth', () => ({ isAdminAuthorized: () => true, unauthorizedResponse: () => ({ status: 401 }), adminActorId: () => 'admin:test' }))
jest.mock('@/lib/bookingAudit', () => ({ logBookingChange: jest.fn(async () => undefined) }))
jest.mock('@/lib/calendarSync', () => ({ syncBookingCalendar: jest.fn(async () => ({ ok: true })), clearBookingCalendar: jest.fn() }))
const mockEnqueue = jest.fn()
jest.mock('@/lib/checkinReminders', () => ({ enqueueCheckinReminders: (...a: unknown[]) => mockEnqueue(...a), cancelCheckinReminders: jest.fn() }))
jest.mock('@/lib/googleCalendar', () => ({ updateCalendarEvent: jest.fn(async () => undefined), createCalendarEvent: jest.fn(async () => null) }))
jest.mock('@/lib/rateLimit', () => ({ guardRate: () => null, plannerRule: () => ({}) }))
jest.mock('@/lib/portalAuth', () => ({ portalSigningSecret: () => 's', getPortalBookingRef: () => 'HH-RENT-1' }))
jest.mock('@/lib/bookingBalance', () => ({
  ...jest.requireActual('@/lib/bookingBalance'),
  readBalanceInputs: async () => ({ ok: true, paidSum: 25000 }),
}))
jest.mock('@/lib/pricingCatalog', () => ({
  ...jest.requireActual('@/lib/pricingCatalog'),
  loadPricingCatalog: async () => ({
    guestRules: { includedGuests: 10, extraGuestCents: 3500 },
    studioRates: {
      weekendBaseCents: 60000, weekdayBaseCents: 47500, weekendAddlHourCents: 15000, weekdayAddlHourCents: 10000,
      weekendFullDayCents: 97500, weekdayFullDayCents: 70000, minHours: 3, securityDepositCents: 25000,
    },
  }),
}))

function table(name: string) {
  let op: 'select' | 'update' | 'delete' | 'insert' = 'select'
  let patch: Row = {}
  let inserted: Row[] = []
  const filters: ((r: Row) => boolean)[] = []
  const q: Record<string, any> = {}
  const src = (): Row[] => (name === 'booking_line_items' ? lines : name === 'bookings' ? bookings : [])
  q.select = () => q
  q.eq = (c: string, v: any) => (filters.push(r => r[c] === v), q)
  q.neq = (c: string, v: any) => (filters.push(r => r[c] !== v), q)
  q.is = (c: string, v: any) => (filters.push(r => (r[c] ?? null) === v), q)
  q.in = (c: string, vs: any[]) => (filters.push(r => vs.includes(r[c])), q)
  q.order = () => q
  q.limit = () => q
  q.update = (p: Row) => ((op = 'update'), (patch = p), q)
  q.delete = () => ((op = 'delete'), q)
  q.insert = (p: Row | Row[]) => {
    op = 'insert'
    const arr = Array.isArray(p) ? p : [p]
    inserted = name === 'booking_line_items' ? arr.map(r => ({ id: `n${nextId++}`, ...r })) : arr
    if (name === 'booking_line_items') lines.push(...inserted)
    return q
  }
  const rowsNow = () => src().filter(r => filters.every(f => f(r)))
  q.maybeSingle = async () => ({ data: rowsNow()[0] ?? null, error: null })
  q.single = async () => ({ data: rowsNow()[0] ?? null, error: null })
  q.then = (res: (v: any) => any) => {
    if (op === 'insert') return Promise.resolve({ data: inserted, error: null }).then(res)
    const rows = rowsNow()
    if (op === 'update') {
      if (name === 'bookings' && failBookingUpdate && patch.party_tags) {
        return Promise.resolve({ data: null, error: { message: 'write refused' } }).then(res)
      }
      rows.forEach(r => Object.assign(r, patch))
    }
    if (op === 'delete' && name === 'booking_line_items') lines = lines.filter(r => !rows.includes(r))
    return Promise.resolve({ data: rows, error: null }).then(res)
  }
  return q
}
jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ from: (n: string) => table(n) }) }))

import { PATCH, POST as adminPost } from '@/app/api/admin/parties/[id]/route'
import { POST as customerEdit } from '@/app/api/studio-rental/edit/route'

const WEEKDAY = '2026-12-02' // Wednesday
const WEEKEND = '2026-12-05' // Saturday

function seed(tags: Row = {}, date = WEEKDAY) {
  bookings = [{
    id: 'b1', booking_ref: 'HH-RENT-1', event_type: 'studio-rental', party_date: date, party_time: '10:00', status: 'deposit_paid',
    contact_name: 'Pat', contact_email: 'pat@example.com', guest_count_approx: 20, checkin_status: 'pending', quote_snapshot: {},
    party_tags: { rental_start_time: '10:00', rental_end_time: '13:00', rental_hours: 3, is_weekend: false, ...tags },
  }]
  lines = [
    { booking_id: 'b1', id: 'r', name: 'Studio Rental', category: 'rental', pricing_item_id: null, quantity: 1, unit_price_cents: 47500, price_type: 'flat', guest_multiplied: false, sort_order: 0 },
  ]
}
const patch = (b: Row) => PATCH({ json: async () => b, headers: { get: () => null } } as any, { params: Promise.resolve({ id: 'b1' }) })
const action = (b: Row) => adminPost({ json: async () => b, headers: { get: () => null } } as any, { params: Promise.resolve({ id: 'b1' }) })
const edit = (b: Row) => customerEdit({ json: async () => b, headers: { get: () => null } } as any)

beforeEach(() => { failBookingUpdate = false; mockEnqueue.mockClear(); seed() })

describe('admin date / time PATCH on a rental', () => {
  it('moving a weekday rental to a weekend reprices it and flips is_weekend', async () => {
    const res: any = await patch({ party_date: WEEKEND })
    expect(res.body.ok).toBe(true)
    expect(lines.find(l => l.category === 'rental')!.unit_price_cents).toBe(60000)
    expect(bookings[0].party_tags.is_weekend).toBe(true)
    expect(res.body.totalCents).toBe(60000)
  })

  it('moving only the start keeps the window length and moves the end tag', async () => {
    await patch({ party_time: '12:00' })
    expect(bookings[0].party_tags).toMatchObject({ rental_start_time: '12:00', rental_end_time: '15:00', rental_hours: 3 })
  })

  it('refuses to price a window that would run past midnight, and says so', async () => {
    const res: any = await patch({ party_time: '22:00' })
    expect(res.body.warning).toMatch(/past midnight/)
    expect(bookings[0].party_tags.rental_end_time).toBe('13:00')
  })

  it('keeps a custom hourly rate when the date moves', async () => {
    seed({ custom_hourly_rate_cents: 7500 })
    lines[0] = { ...lines[0], quantity: 3, unit_price_cents: 7500 }
    await patch({ party_date: WEEKEND })
    expect(lines.find(l => l.category === 'rental')).toMatchObject({ quantity: 3, unit_price_cents: 7500 })
  })
})

describe('admin edit_rental', () => {
  it('does not answer ok when the times could not be saved', async () => {
    failBookingUpdate = true
    const res: any = await action({ action: 'edit_rental', startTime: '10:00', endTime: '15:00' })
    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/NOT saved/)
  })

  it('reprices, returns the new total and re-enqueues the check-in texts', async () => {
    const res: any = await action({ action: 'edit_rental', startTime: '10:00', endTime: '15:00' })
    expect(res.body.ok).toBe(true)
    expect(res.body.totalCents).toBe(67500)
    expect(mockEnqueue).toHaveBeenCalled()
  })
})

describe('customer self-serve rental edit', () => {
  it('keeps an admin discount and a hand-typed line, replacing only the rental and add-ons', async () => {
    lines.push(
      { booking_id: 'b1', id: 'd', name: 'Friends and family', category: 'discount', pricing_item_id: null, quantity: 1, unit_price_cents: -5000, price_type: 'flat', guest_multiplied: false, sort_order: 5 },
      { booking_id: 'b1', id: 'h', name: 'Party Helper 10-1', category: 'service-add-on', pricing_item_id: null, quantity: 1, unit_price_cents: 9000, price_type: 'flat', guest_multiplied: false, sort_order: 6 },
    )
    const res: any = await edit({ startTime: '10:00', endTime: '14:00', guestCount: 20, lineItems: [] })
    expect(res.body.ok).toBe(true)
    expect(lines.map(l => l.name)).toEqual(expect.arrayContaining(['Friends and family', 'Party Helper 10-1']))
    expect(lines).toHaveLength(3)
    expect(res.body.totalCents).toBe(57500 + 9000 - 5000)
  })

  it('prices the new window at the booking custom hourly rate, not the rate card', async () => {
    seed({ custom_hourly_rate_cents: 7500 })
    const res: any = await edit({ startTime: '10:00', endTime: '12:00', guestCount: 20, lineItems: [] })
    expect(res.status).toBe(200)
    expect(res.body.totalCents).toBe(15000)
    expect(lines.find(l => l.category === 'rental')).toMatchObject({ quantity: 2, unit_price_cents: 7500 })
  })

  it('still enforces the 3-hour minimum on the rate card', async () => {
    const res: any = await edit({ startTime: '10:00', endTime: '12:00', guestCount: 20, lineItems: [] })
    expect(res.status).toBe(400)
  })
})
