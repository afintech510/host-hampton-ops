/**
 * The admin booking PATCH no longer writes derived or dangerous fields raw.
 *  - status / total_cents / balance_due_cents are refused (status has its own actions;
 *    totals follow the line items and payments)
 *  - party_tags: only keys that do not drive a price may change; the rest is merged, not replaced
 *  - a theme-name or party-type change that leaves the invoice contradicting the label warns
 */
type Row = Record<string, any>
let lines: Row[] = []
let booking: Row = {}

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, json: async () => body, body }) },
}))
jest.mock('@/lib/adminAuth', () => ({ isAdminAuthorized: () => true, unauthorizedResponse: () => ({ status: 401 }), adminActorId: () => 'admin:test' }))
jest.mock('@/lib/bookingAudit', () => ({ logBookingChange: jest.fn(async () => undefined) }))
jest.mock('@/lib/calendarSync', () => ({ syncBookingCalendar: jest.fn(async () => ({ ok: true })), clearBookingCalendar: jest.fn() }))
jest.mock('@/lib/checkinReminders', () => ({ enqueueCheckinReminders: jest.fn(), cancelCheckinReminders: jest.fn() }))

function table(name: string) {
  let op: 'select' | 'update' = 'select'
  let patch: Row = {}
  const filters: ((r: Row) => boolean)[] = []
  const q: Record<string, any> = {}
  const src = (): Row[] => (name === 'booking_line_items' ? lines : name === 'bookings' ? [booking] : [])
  q.select = () => q
  q.eq = (c: string, v: any) => (filters.push(r => r[c] === v), q)
  q.update = (p: Row) => ((op = 'update'), (patch = p), q)
  q.single = async () => ({ data: src().filter(r => filters.every(f => f(r)))[0] ?? null, error: null })
  q.then = (res: (v: any) => any) => {
    const rows = src().filter(r => filters.every(f => f(r)))
    if (op === 'update') rows.forEach(r => Object.assign(r, patch))
    return Promise.resolve({ data: rows, error: null }).then(res)
  }
  return q
}
jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ from: (n: string) => table(n) }) }))

import { PATCH } from '@/app/api/admin/parties/[id]/route'

const patch = (b: Row) => PATCH({ json: async () => b, headers: { get: () => null } } as any, { params: Promise.resolve({ id: 'b1' }) })

beforeEach(() => {
  booking = { id: 'b1', party_type: 'in_studio_theme', package_type: 'Slime Party', status: 'deposit_paid', total_cents: 50000, balance_due_cents: 25000, party_tags: { rental_start_time: '10:00', security_deposit_cents: 25000 } }
  lines = [{ booking_id: 'b1', name: 'Slime Party', category: 'theme', pricing_item_id: 'p1' }]
})

describe('refused raw fields', () => {
  it.each(['status', 'total_cents', 'balance_due_cents'])('%s is refused and nothing is written', async key => {
    const res: any = await patch({ [key]: key === 'status' ? 'cancelled' : 1, child_name: 'Kit' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain(key)
    expect(booking.status).toBe('deposit_paid')
    expect(booking.total_cents).toBe(50000)
    expect(booking.child_name).toBeUndefined()
  })
})

describe('party_tags', () => {
  it('lets the unlock switch through (the dashboard sends the whole object back) and keeps the rest', async () => {
    const res: any = await patch({ party_tags: { rental_start_time: '10:00', security_deposit_cents: 25000, modifications_unlocked: true } })
    expect(res.body.ok).toBe(true)
    expect(booking.party_tags).toEqual({ rental_start_time: '10:00', security_deposit_cents: 25000, modifications_unlocked: true })
  })

  it('refuses a changed tag that drives a price, and writes nothing', async () => {
    const res: any = await patch({ party_tags: { rental_start_time: '10:00', security_deposit_cents: 0, custom_hourly_rate_cents: 100 } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/security_deposit_cents, custom_hourly_rate_cents/)
    expect(booking.party_tags.security_deposit_cents).toBe(25000)
  })

  it('does not let a partial object wipe the stored tags', async () => {
    await patch({ party_tags: { modifications_unlocked: true } })
    expect(booking.party_tags).toMatchObject({ rental_start_time: '10:00', security_deposit_cents: 25000, modifications_unlocked: true })
  })
})

describe('a label that contradicts the invoice', () => {
  it('warns when the theme name no longer matches the theme line', async () => {
    const res: any = await patch({ package_type: 'Glow Party' })
    expect(res.body.ok).toBe(true)
    expect(res.body.warning).toMatch(/Slime Party.*old price/)
    expect(booking.package_type).toBe('Glow Party')
  })

  it('stays quiet when the name matches the theme line', async () => {
    const res: any = await patch({ package_type: 'slime party' })
    expect(res.body.warning).toBeUndefined()
  })

  it('warns when switching to mobile leaves the in-studio theme line', async () => {
    const res: any = await patch({ party_type: 'mobile_party' })
    expect(res.body.warning).toMatch(/in-studio theme or rental lines/)
  })

  it('stays quiet when the type already agrees with the lines', async () => {
    const res: any = await patch({ party_type: 'in_studio_theme' })
    expect(res.body.warning).toBeUndefined()
  })
})
