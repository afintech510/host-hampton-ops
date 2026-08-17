/**
 * Tests for admin orders API:
 * - GET /api/admin/orders (unified bookings + tickets)
 */

function buildChain(resolveValue: any) {
  const chain: any = {}
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'gte', 'lte', 'or', 'order', 'single', 'in', 'range', 'limit']
  for (const m of methods) {
    chain[m] = jest.fn().mockReturnValue(chain)
  }
  const p = Promise.resolve(resolveValue)
  chain.then = p.then.bind(p)
  chain.catch = p.catch.bind(p)
  return chain
}

const mockGetSupabase = jest.fn()

jest.mock('@/lib/supabase', () => ({
  getSupabase: (...args: any[]) => mockGetSupabase(...args),
}))

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({
      status: init?.status || 200,
      json: () => body,
      body,
    }),
  },
}))

import { GET } from '@/app/api/admin/orders/route'

const sampleBooking = {
  id: 'bk-001',
  booking_ref: 'HH-BK-0001',
  contact_name: 'Alice Wonder',
  contact_email: 'alice@example.com',
  contact_phone: '555-111-2222',
  deposit_amount: 75,
  status: 'deposit_paid',
  event_type: 'kids-birthday-party',
  party_date: '2026-04-10',
  party_time: '2:00 PM',
  stripe_payment_intent_id: 'pi_test_bk',
  created_at: '2026-03-01T10:00:00Z',
  package_type: 'Glow',
  child_name: 'Bobby',
  child_age: 7,
  guest_count_approx: 15,
  notes: null,
  refund_amount_cents: null,
  refund_reason: null,
}

const sampleTicketOrder = {
  id: 'tk-001',
  ticket_ref: 'HH-EVT-0001',
  customer_name: 'Bob Builder',
  customer_email: 'bob@example.com',
  customer_phone: '555-333-4444',
  total_cents: 4500,
  status: 'confirmed',
  stripe_payment_intent_id: 'pi_test_tk',
  created_at: '2026-03-02T12:00:00Z',
  quantity: 2,
  variant_label: 'Baseball Hat',
  session_id: null,
  unit_price_cents: 2250,
  group_ref: null,
  refund_amount_cents: null,
  refund_reason: null,
  events: { title: 'Embroidery Workshop', event_date: '2026-03-15', event_time: '2:00 PM', location: 'Host Hampton' },
}

describe('Admin Orders API', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, ADMIN_PASSWORD: 'test-admin-pw' }
  })

  afterAll(() => { process.env = originalEnv })

  function authHeaders() {
    return { get: (n: string) => n === 'authorization' ? 'Bearer test-admin-pw' : null, has: (n: string) => n === 'authorization' }
  }
  function noAuthHeaders() {
    return { get: () => null, has: () => false }
  }

  it('returns 401 without auth', async () => {
    const req = { headers: noAuthHeaders() } as any
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns both bookings and tickets as unified orders', async () => {
    const bookingsChain = buildChain({ data: [sampleBooking], error: null })
    const ticketsChain = buildChain({ data: [sampleTicketOrder], error: null })

    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'bookings') return bookingsChain
      return ticketsChain
    })
    mockGetSupabase.mockReturnValue({ from: fromMock })

    const url = new URL('http://localhost:3002/api/admin/orders')
    const req = { headers: authHeaders(), nextUrl: url } as any
    const res = await GET(req)
    const body = res.json()

    expect(body.orders).toHaveLength(2)
    expect(body.orders.find((o: any) => o.order_type === 'booking')).toBeDefined()
    expect(body.orders.find((o: any) => o.order_type === 'ticket')).toBeDefined()
  })

  it('filters by type=booking (skips ticket fetch)', async () => {
    const bookingsChain = buildChain({ data: [sampleBooking], error: null })
    const ticketsChain = buildChain({ data: [], error: null })

    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'bookings') return bookingsChain
      return ticketsChain
    })
    mockGetSupabase.mockReturnValue({ from: fromMock })

    const url = new URL('http://localhost:3002/api/admin/orders?type=booking')
    const req = { headers: authHeaders(), nextUrl: url } as any
    const res = await GET(req)
    const body = res.json()

    expect(body.orders.every((o: any) => o.order_type === 'booking')).toBe(true)
    // event_tickets should not be queried
    expect(fromMock).not.toHaveBeenCalledWith('event_tickets')
  })

  it('filters by status', async () => {
    const bookingsChain = buildChain({ data: [sampleBooking], error: null })
    const ticketsChain = buildChain({ data: [sampleTicketOrder], error: null })

    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'bookings') return bookingsChain
      return ticketsChain
    })
    mockGetSupabase.mockReturnValue({ from: fromMock })

    const url = new URL('http://localhost:3002/api/admin/orders?status=confirmed')
    const req = { headers: authHeaders(), nextUrl: url } as any
    const res = await GET(req)
    const body = res.json()

    // Only the ticket is 'confirmed'; booking is 'deposit_paid'
    expect(body.orders.every((o: any) => o.status === 'confirmed')).toBe(true)
  })

  it('applies search filter on name/email/ref', async () => {
    const bookingsChain = buildChain({ data: [sampleBooking], error: null })
    const ticketsChain = buildChain({ data: [sampleTicketOrder], error: null })

    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'bookings') return bookingsChain
      return ticketsChain
    })
    mockGetSupabase.mockReturnValue({ from: fromMock })

    const url = new URL('http://localhost:3002/api/admin/orders?search=alice')
    const req = { headers: authHeaders(), nextUrl: url } as any
    const res = await GET(req)
    const body = res.json()

    expect(body.orders).toHaveLength(1)
    expect(body.orders[0].customer_name).toBe('Alice Wonder')
  })

  it('maps booking amount_cents directly from deposit_amount (stored in cents)', async () => {
    const bookingsChain = buildChain({ data: [sampleBooking], error: null })
    const ticketsChain = buildChain({ data: [], error: null })

    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'bookings') return bookingsChain
      return ticketsChain
    })
    mockGetSupabase.mockReturnValue({ from: fromMock })

    const url = new URL('http://localhost:3002/api/admin/orders')
    const req = { headers: authHeaders(), nextUrl: url } as any
    const res = await GET(req)
    const booking = res.json().orders[0]

    expect(booking.amount_cents).toBe(75) // deposit_amount is already in cents
  })

  it('sorts results by created_at descending', async () => {
    const bookingsChain = buildChain({ data: [sampleBooking], error: null })
    const ticketsChain = buildChain({ data: [sampleTicketOrder], error: null })

    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'bookings') return bookingsChain
      return ticketsChain
    })
    mockGetSupabase.mockReturnValue({ from: fromMock })

    const url = new URL('http://localhost:3002/api/admin/orders')
    const req = { headers: authHeaders(), nextUrl: url } as any
    const res = await GET(req)
    const orders = res.json().orders

    // ticket was created later (2026-03-02) than booking (2026-03-01)
    expect(orders[0].order_type).toBe('ticket')
    expect(orders[1].order_type).toBe('booking')
  })
})
