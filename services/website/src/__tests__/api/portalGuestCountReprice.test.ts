/**
 * Owner ruling 2026-11-09: a guest count is fluid until the final invoice is paid, and
 * changing it changes the price. A customer's portal edit reprices the plan
 * (flat "Additional Guests" line + stored total/balance) and is locked once paid in full.
 */
type Row = Record<string, any>
let lines: Row[] = []
let booking: Row = {}
let payments: Row[] = []

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, json: async () => body, body }) },
}))
jest.mock('@/lib/rateLimit', () => ({ guardRate: () => null, plannerRule: () => ({}) }))
jest.mock('@/lib/portalAuth', () => ({ portalSigningSecret: () => 's', getPortalBookingRef: () => 'HH-PTY-1' }))
jest.mock('@/lib/pricingCatalog', () => ({
  ...jest.requireActual('@/lib/pricingCatalog'),
  loadPricingCatalog: async () => ({ guestRules: { includedGuests: 10, extraGuestCents: 3500, miniPartyMaxGuests: 6 } }),
}))

function table(name: string) {
  let op: 'select' | 'update' | 'delete' | 'insert' = 'select'
  let patch: Row = {}
  const filters: ((r: Row) => boolean)[] = []
  const q: Record<string, any> = {}
  const src = (): Row[] =>
    name === 'booking_line_items' ? lines : name === 'bookings' ? [booking] : name === 'booking_payments' ? payments : []
  q.select = () => q
  q.eq = (c: string, v: any) => (filters.push(r => r[c] === v), q)
  q.in = (c: string, vs: any[]) => (filters.push(r => vs.includes(r[c])), q)
  q.update = (p: Row) => ((op = 'update'), (patch = p), q)
  q.delete = () => ((op = 'delete'), q)
  q.insert = (p: Row) => {
    if (name === 'booking_line_items') lines.push({ id: `n${lines.length + 100}`, ...p })
    return Promise.resolve({ error: null })
  }
  const rowsNow = () => src().filter(r => filters.every(f => f(r)))
  q.maybeSingle = async () => ({ data: rowsNow()[0] ?? null, error: null })
  q.single = async () => ({ data: rowsNow()[0] ?? null, error: null })
  q.then = (res: (v: any) => any) => {
    const rows = rowsNow()
    if (op === 'update') rows.forEach(r => Object.assign(r, patch))
    if (op === 'delete' && name === 'booking_line_items') lines = lines.filter(r => !rows.includes(r))
    return Promise.resolve({ data: rows, error: null }).then(res)
  }
  return q
}
jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ from: (n: string) => table(n) }) }))

import { PATCH } from '@/app/api/portal/booking/route'

const patch = (b: Row) => PATCH({ json: async () => b, headers: { get: () => null } } as any)

beforeEach(() => {
  booking = {
    id: 'b1', booking_ref: 'HH-PTY-1', status: 'deposit_paid', party_date: '2027-06-12', guest_count_approx: 10,
    party_tags: {}, quote_snapshot: {}, total_cents: 45000, balance_due_cents: 20000,
  }
  payments = [{ booking_id: 'b1', amount_cents: 25000, payment_type: 'deposit' }]
  lines = [{ booking_id: 'b1', id: 't', name: 'Slime Party', category: 'theme', pricing_item_id: 'p1', quantity: 1, unit_price_cents: 45000, guest_multiplied: false }]
})

describe('customer changes the headcount in the portal', () => {
  it('reprices: adds the Additional Guests line and moves the total and balance', async () => {
    const res: any = await patch({ guest_count_approx: 19 })
    expect(res.body.ok).toBe(true)
    expect(lines.find(l => l.name === 'Additional Guests')).toMatchObject({ quantity: 9, unit_price_cents: 3500 })
    expect(res.body.totalCents).toBe(45000 + 9 * 3500)
    expect(res.body.balanceCents).toBe(45000 + 9 * 3500 - 25000)
    expect(booking.total_cents).toBe(76500)
  })

  it('reprices back down when the count drops', async () => {
    await patch({ guest_count_approx: 19 })
    const res: any = await patch({ guest_count_approx: 12 })
    expect(lines.find(l => l.name === 'Additional Guests')!.quantity).toBe(2)
    expect(res.body.totalCents).toBe(45000 + 2 * 3500)
  })

  it('is locked once the booking is paid in full', async () => {
    booking.status = 'paid_in_full'
    const res: any = await patch({ guest_count_approx: 19 })
    expect(res.status).toBe(409)
    expect(booking.guest_count_approx).toBe(10)
    expect(lines.find(l => l.name === 'Additional Guests')).toBeUndefined()
  })

  it('leaves a non-count edit alone (no repricing)', async () => {
    const res: any = await patch({ child_name: 'Kit' })
    expect(res.body.ok).toBe(true)
    expect(res.body.totalCents).toBeUndefined()
    expect(booking.total_cents).toBe(45000)
  })
})
