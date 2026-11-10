/**
 * Changing a theme party's guest count keeps its flat "Additional Guests" line
 * in step (Denise, 2026-11-09: the assistant typed its own extra-guest line, the
 * planner derived the same heads from the count and charged both, $315 twice).
 */
type Row = Record<string, any>
let lines: Row[] = []
let booking: Row = {}
let nextId = 100

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, json: async () => body, body }) },
}))
jest.mock('@/lib/adminAuth', () => ({
  isAdminAuthorized: () => true,
  unauthorizedResponse: () => ({ status: 401 }),
  adminActorId: () => 'admin:test',
}))
jest.mock('@/lib/bookingAudit', () => ({ logBookingChange: jest.fn(async () => undefined) }))
jest.mock('@/lib/calendarSync', () => ({ syncBookingCalendar: jest.fn(async () => ({ ok: true })), clearBookingCalendar: jest.fn() }))
jest.mock('@/lib/checkinReminders', () => ({ enqueueCheckinReminders: jest.fn(), cancelCheckinReminders: jest.fn() }))
jest.mock('@/lib/pricingCatalog', () => ({
  ...jest.requireActual('@/lib/pricingCatalog'),
  loadPricingCatalog: async () => ({ guestRules: { includedGuests: 10, extraGuestCents: 3500, miniPartyMaxGuests: 6 } }),
}))

function table(name: string) {
  let op: 'select' | 'update' | 'delete' | 'insert' = 'select'
  let patch: Row = {}
  const filters: [string, any[]][] = []
  const q: Record<string, any> = {}
  const src = () => (name === 'booking_line_items' ? lines : name === 'bookings' ? [booking] : [])
  const match = (r: Row) => filters.every(([c, vs]) => vs.includes(r[c]))
  q.select = () => q
  q.eq = (c: string, v: any) => (filters.push([c, [v]]), q)
  q.in = (c: string, vs: any[]) => (filters.push([c, vs]), q)
  q.single = async () => ({ data: src().filter(match)[0] ?? null, error: null })
  q.update = (p: Row) => ((op = 'update'), (patch = p), q)
  q.delete = () => ((op = 'delete'), q)
  q.insert = (p: Row) => {
    if (name === 'booking_line_items') lines.push({ id: `n${nextId++}`, ...p })
    return Promise.resolve({ error: null })
  }
  q.then = (res: (v: any) => any) => {
    const rows = src().filter(match)
    if (op === 'update') rows.forEach(r => Object.assign(r, patch))
    if (op === 'delete' && name === 'booking_line_items') lines = lines.filter(r => !rows.includes(r))
    return Promise.resolve({ data: rows, error: null }).then(res)
  }
  return q
}
jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ from: (n: string) => table(n) }) }))

import { PATCH } from '@/app/api/admin/parties/[id]/route'

const theme = { booking_id: 'b1', id: 't', name: 'Slime Party', category: 'theme', pricing_item_id: 'p1', quantity: 1, unit_price_cents: 45000, guest_multiplied: false, sort_order: 1 }
const patch = (guests: number) =>
  PATCH({ json: async () => ({ guest_count_approx: guests }), headers: { get: () => null } } as any, { params: Promise.resolve({ id: 'b1' }) })
const extra = () => lines.filter(l => /additional guests/i.test(l.name))

beforeEach(() => {
  booking = { id: 'b1', guest_count_approx: 10, total_cents: 45000, balance_due_cents: 45000 }
  lines = [{ ...theme }]
})

describe('guest count on a theme party', () => {
  it('adds the flat Additional Guests line for the heads over the included ten, once', async () => {
    const res: any = await patch(19)
    expect(res.body.ok).toBe(true)
    expect(extra()).toHaveLength(1)
    expect(extra()[0]).toMatchObject({ category: 'theme', quantity: 9, unit_price_cents: 3500, guest_multiplied: false })
    expect(res.body.totalCents).toBe(45000 + 9 * 3500)
    await patch(19)
    expect(extra()).toHaveLength(1)
  })

  it('updates the line when the count moves, and drops it at or under ten', async () => {
    await patch(19)
    await patch(12)
    expect(extra()[0].quantity).toBe(2)
    const res: any = await patch(8)
    expect(extra()).toHaveLength(0)
    expect(res.body.totalCents).toBe(45000)
  })

  it('removes a hand-typed extra-guest line so the heads are charged once', async () => {
    lines.push({ booking_id: 'b1', id: 'x', name: 'Additional guest', category: 'custom', pricing_item_id: null, quantity: 9, unit_price_cents: 3500, guest_multiplied: false, sort_order: 2 })
    const res: any = await patch(19)
    expect(lines.filter(l => l.id === 'x')).toHaveLength(0)
    expect(res.body.totalCents).toBe(45000 + 9 * 3500)
  })

  it('leaves a booking with no catalogue theme line alone (mobile, rental)', async () => {
    lines = [{ booking_id: 'b1', id: 'm', name: 'Mobile Party Package', category: 'mobile-package', pricing_item_id: null, quantity: 1, unit_price_cents: 135000, guest_multiplied: false, sort_order: 1 }]
    await patch(19)
    expect(extra()).toHaveLength(0)
  })
})

describe('a mini party bills at most the mini cap', () => {
  it('adds no extra-guest line past ten when the party is a mini party capped at six', async () => {
    booking.quote_snapshot = { isMiniParty: true }
    await patch(19)
    expect(extra()).toHaveLength(0)
  })
})
