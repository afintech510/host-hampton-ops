/**
 * Admin actions behind the assistant's edit tools: edit_line_item changes one line in place
 * and recalculates; set_preferences merges menu choices into the plan snapshot.
 */
type Row = Record<string, any>
let lines: Row[] = []
let bookings: Row[] = []
let failLineUpdate = false

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, json: async () => body, body }) },
}))
jest.mock('@/lib/adminAuth', () => ({ isAdminAuthorized: () => true, unauthorizedResponse: () => ({ status: 401 }), adminActorId: () => 'admin:test' }))
jest.mock('@/lib/bookingAudit', () => ({ logBookingChange: jest.fn(async () => true) }))
jest.mock('@/lib/calendarSync', () => ({ syncBookingCalendar: jest.fn(async () => ({ ok: true })), clearBookingCalendar: jest.fn() }))
jest.mock('@/lib/checkinReminders', () => ({ enqueueCheckinReminders: jest.fn(), cancelCheckinReminders: jest.fn() }))

function table(name: string) {
  let op: 'select' | 'update' = 'select'
  let patch: Row = {}
  const filters: ((r: Row) => boolean)[] = []
  const q: Record<string, any> = {}
  const src = (): Row[] => (name === 'booking_line_items' ? lines : name === 'bookings' ? bookings : [])
  q.select = () => q
  q.eq = (c: string, v: any) => (filters.push(r => r[c] === v), q)
  q.update = (p: Row) => ((op = 'update'), (patch = p), q)
  const rowsNow = () => src().filter(r => filters.every(f => f(r)))
  q.maybeSingle = async () => ({ data: rowsNow()[0] ?? null, error: null })
  q.single = async () => ({ data: rowsNow()[0] ?? null, error: null })
  q.then = (res: (v: any) => any) => {
    const rows = rowsNow()
    if (op === 'update') {
      if (name === 'booking_line_items' && failLineUpdate) return Promise.resolve({ data: null, error: { message: 'refused' } }).then(res)
      rows.forEach(r => Object.assign(r, patch))
    }
    return Promise.resolve({ data: rows, error: null }).then(res)
  }
  return q
}
jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ from: (n: string) => table(n) }) }))

import { POST } from '@/app/api/admin/parties/[id]/route'

const act = (b: Row) => POST({ json: async () => b, headers: { get: () => null } } as any, { params: Promise.resolve({ id: 'b1' }) })

beforeEach(() => {
  failLineUpdate = false
  bookings = [{ id: 'b1', booking_ref: 'HH-PTY-1', event_type: 'kid-party', status: 'approved', guest_count_approx: 10, quote_snapshot: { guestCount: 10, pizzaOrBagels: 'pizza' }, total_cents: 0, balance_due_cents: 0 }]
  lines = [
    { booking_id: 'b1', id: 'a', name: 'Slime Party', category: 'theme', quantity: 1, unit_price_cents: 59500, guest_multiplied: false, is_optional: false },
    { booking_id: 'b1', id: 'g', name: 'Balloon Garland', category: 'extra', quantity: 1, unit_price_cents: 15000, guest_multiplied: false, is_optional: false },
    { booking_id: 'b1', id: 'x', name: 'Additional Guests', category: 'theme', quantity: 9, unit_price_cents: 3500, guest_multiplied: false, is_optional: false },
    { booking_id: 'b1', id: 'd', name: 'Friends discount', category: 'discount', quantity: 1, unit_price_cents: -5000, guest_multiplied: false, is_optional: false },
    { booking_id: 'b1', id: 'r', name: 'Studio Rental', category: 'rental', quantity: 1, unit_price_cents: 47500, guest_multiplied: false, is_optional: false },
  ]
})

describe('edit_line_item', () => {
  it('changes the price in place and returns the recalculated total', async () => {
    const res: any = await act({ action: 'edit_line_item', line_item_id: 'g', unit_price_cents: 18000 })
    expect(res.body.ok).toBe(true)
    expect(lines.find(l => l.id === 'g')!.unit_price_cents).toBe(18000)
    expect(lines).toHaveLength(5)
    expect(res.body.totalCents).toBe(59500 + 18000 + 9 * 3500 - 5000 + 47500)
    expect(bookings[0].total_cents).toBe(res.body.totalCents)
  })

  it('can make a line optional (quoted, not charged)', async () => {
    const res: any = await act({ action: 'edit_line_item', line_item_id: 'g', is_optional: true })
    expect(res.body.totalCents).toBe(59500 + 9 * 3500 - 5000 + 47500)
  })

  it('refuses the rental fee and the Additional Guests line', async () => {
    expect(((await act({ action: 'edit_line_item', line_item_id: 'r', unit_price_cents: 1 })) as any).status).toBe(400)
    expect(((await act({ action: 'edit_line_item', line_item_id: 'x', quantity: 2 })) as any).status).toBe(400)
    expect(lines.find(l => l.id === 'x')!.quantity).toBe(9)
  })

  it('does not flip a discount into a charge', async () => {
    const res: any = await act({ action: 'edit_line_item', line_item_id: 'd', unit_price_cents: 5000 })
    expect(res.status).toBe(400)
    expect(lines.find(l => l.id === 'd')!.unit_price_cents).toBe(-5000)
  })

  it('answers 404 for a line on another booking and 500 when the write is refused', async () => {
    expect(((await act({ action: 'edit_line_item', line_item_id: 'nope', unit_price_cents: 1 })) as any).status).toBe(404)
    failLineUpdate = true
    const res: any = await act({ action: 'edit_line_item', line_item_id: 'g', unit_price_cents: 100 })
    expect(res.status).toBe(500)
    expect(lines.find(l => l.id === 'g')!.unit_price_cents).toBe(15000)
  })
})

describe('set_preferences', () => {
  it('merges choices into the snapshot and keeps the rest', async () => {
    const res: any = await act({ action: 'set_preferences', pizzaOrBagels: 'bagels', characterRequest: ' Elsa ' })
    expect(res.body.ok).toBe(true)
    expect(bookings[0].quote_snapshot).toEqual({ guestCount: 10, pizzaOrBagels: 'bagels', characterRequest: 'Elsa' })
  })

  it('refuses an unknown choice and an empty call, writing nothing', async () => {
    expect(((await act({ action: 'set_preferences', pizzaOrBagels: 'tacos' })) as any).status).toBe(400)
    expect(((await act({ action: 'set_preferences' })) as any).status).toBe(400)
    expect(bookings[0].quote_snapshot.pizzaOrBagels).toBe('pizza')
  })
})
