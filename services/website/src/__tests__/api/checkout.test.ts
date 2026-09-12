/**
 * Tests for POST /api/events/checkout
 */

import { sampleEvent, sampleFreeEvent, sampleSession, sampleSessionEvent } from '../mocks/fixtures'

// --- Supabase chain mock ---
function buildChain(resolveValue: any) {
  const chain: any = {}
  const methods = ['select', 'ilike', 'insert', 'update', 'eq', 'neq', 'gte', 'lte', 'order', 'limit', 'single', 'in']
  for (const m of methods) {
    chain[m] = jest.fn().mockReturnValue(chain)
  }
  const p = Promise.resolve(resolveValue)
  chain.then = p.then.bind(p)
  chain.catch = p.catch.bind(p)
  return chain
}

// --- Module mocks ---
const mockStripeCreate = jest.fn()
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: mockStripeCreate,
      },
    },
  }))
})

const mockResendSend = jest.fn().mockResolvedValue({ id: 'email_1' })
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockResendSend },
  })),
}))

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

import { POST } from '@/app/api/events/checkout/route'

describe('POST /api/events/checkout', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = {
      ...originalEnv,
      STRIPE_SECRET_KEY: 'sk_test_fake',
      RESEND_API_KEY: 're_test_fake',
      RESEND_FROM_EMAIL: 'test@mail.hosthampton.com',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_KEY: 'test-key',
    }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns 400 when required fields are missing', async () => {
    const req = {
      json: jest.fn().mockResolvedValue({ eventId: 'abc' }),
      headers: { get: () => null },
    } as any

    const response = await POST(req)
    expect(response.status).toBe(400)
    expect(response.json().error).toContain('Missing required fields')
  })

  it('returns 404 when event does not exist', async () => {
    const eventChain = buildChain({ data: null, error: { message: 'not found' } })
    mockGetSupabase.mockReturnValue({
      from: jest.fn().mockReturnValue(eventChain),
      rpc: jest.fn().mockResolvedValue({ data: null }),
    })

    const req = {
      json: jest.fn().mockResolvedValue({
        eventId: 'nonexistent', quantity: 1,
        customerName: 'Test', customerEmail: 'test@test.com', customerPhone: '555-000-0000',
      }),
      headers: { get: () => null },
    } as any

    const response = await POST(req)
    expect(response.status).toBe(404)
  })

  it('returns 400 when not enough tickets available', async () => {
    const lowTicketEvent = { ...sampleEvent, available_tickets: 1 }
    const eventChain = buildChain({ data: lowTicketEvent, error: null })
    mockGetSupabase.mockReturnValue({
      from: jest.fn().mockReturnValue(eventChain),
      rpc: jest.fn().mockResolvedValue({ data: null }),
    })

    const req = {
      json: jest.fn().mockResolvedValue({
        eventId: sampleEvent.id, quantity: 5,
        customerName: 'Test', customerEmail: 'test@test.com', customerPhone: '555-000-0000',
      }),
      headers: { get: () => null },
    } as any

    const response = await POST(req)
    expect(response.status).toBe(400)
    expect(response.json().error).toContain('Not enough tickets')
  })

  it('creates free ticket directly without Stripe for $0 events', async () => {
    const insertChain = buildChain({ data: null, error: null })
    const eventChain = buildChain({ data: sampleFreeEvent, error: null })
    const rpcMock = jest.fn().mockResolvedValue({ data: 42, error: null })

    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'event_tickets') return insertChain
      return eventChain
    })

    mockGetSupabase.mockReturnValue({ from: fromMock, rpc: rpcMock })

    const req = {
      json: jest.fn().mockResolvedValue({
        eventId: sampleFreeEvent.id, quantity: 1,
        customerName: 'John Doe', customerEmail: 'john@example.com', customerPhone: '555-000-0000',
      }),
      headers: { get: () => null },
    } as any

    const response = await POST(req)
    const body = response.json()

    expect(body.url).toContain('/events/success')
    expect(body.url).toContain('ref=HH-EVT-')
    expect(fromMock).toHaveBeenCalledWith('event_tickets')
    expect(insertChain.insert).toHaveBeenCalled()
    expect(rpcMock).toHaveBeenCalledWith('decrement_event_tickets', expect.any(Object))
  })

  it('creates Stripe checkout session for paid events', async () => {
    const eventChain = buildChain({ data: sampleEvent, error: null })
    mockGetSupabase.mockReturnValue({
      from: jest.fn().mockReturnValue(eventChain),
      rpc: jest.fn().mockResolvedValue({ data: null }),
    })

    mockStripeCreate.mockResolvedValue({
      url: 'https://checkout.stripe.com/c/pay_test',
      id: 'cs_test_123',
    })

    const req = {
      json: jest.fn().mockResolvedValue({
        eventId: sampleEvent.id, quantity: 2, variantLabel: 'Baseball Hat',
        customerName: 'Jane Smith', customerEmail: 'jane@example.com',
        customerPhone: '555-123-4567',
      }),
      headers: { get: (name: string) => name === 'x-forwarded-host' ? 'staging.hosthampton.com' : null },
    } as any

    const response = await POST(req)
    const body = response.json()

    expect(body.url).toBe('https://checkout.stripe.com/c/pay_test')
    expect(mockStripeCreate).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'payment',
      customer_email: 'jane@example.com',
      metadata: expect.objectContaining({
        type: 'event_ticket',
        eventId: sampleEvent.id,
        customerName: 'Jane Smith',
        variantLabel: 'Baseball Hat',
      }),
    }))
  })

  it('uses variant price when variantLabel is provided', async () => {
    const eventChain = buildChain({ data: sampleEvent, error: null })
    mockGetSupabase.mockReturnValue({
      from: jest.fn().mockReturnValue(eventChain),
      rpc: jest.fn().mockResolvedValue({ data: null }),
    })

    mockStripeCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/test', id: 'cs_test' })

    const req = {
      json: jest.fn().mockResolvedValue({
        eventId: sampleEvent.id, quantity: 1, variantLabel: 'Tote Bag',
        customerName: 'Test', customerEmail: 'test@test.com', customerPhone: '555-000-0000',
      }),
      headers: { get: () => null },
    } as any

    await POST(req)

    // Route also appends tax + processing-fee line items, so assert the variant
    // line item is present rather than the sole element.
    expect(mockStripeCreate).toHaveBeenCalledWith(expect.objectContaining({
      line_items: expect.arrayContaining([expect.objectContaining({
        price_data: expect.objectContaining({ unit_amount: 5500 }),
        quantity: 1,
      })]),
    }))
  })

  it('checks session availability for session-based events', async () => {
    const sessWithFewTickets = { ...sampleSession, available_tickets: 1 }
    const sessionChain = buildChain({ data: sessWithFewTickets, error: null })
    const eventChain = buildChain({ data: sampleSessionEvent, error: null })

    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'event_sessions') return sessionChain
      return eventChain
    })

    mockGetSupabase.mockReturnValue({ from: fromMock, rpc: jest.fn() })

    const req = {
      json: jest.fn().mockResolvedValue({
        eventId: sampleSessionEvent.id, sessionId: sampleSession.id,
        quantity: 3, customerName: 'Test', customerEmail: 'test@test.com', customerPhone: '555-000-0000',
      }),
      headers: { get: () => null },
    } as any

    const response = await POST(req)
    expect(response.status).toBe(400)
    expect(response.json().error).toContain('Not enough tickets available for this session')
  })

  it('sends emails for free event RSVPs', async () => {
    const insertChain = buildChain({ data: null, error: null })
    const eventChain = buildChain({ data: sampleFreeEvent, error: null })

    mockGetSupabase.mockReturnValue({
      from: jest.fn().mockImplementation((table: string) =>
        table === 'event_tickets' ? insertChain : eventChain
      ),
      rpc: jest.fn().mockResolvedValue({ data: 1, error: null }),
    })

    const req = {
      json: jest.fn().mockResolvedValue({
        eventId: sampleFreeEvent.id, quantity: 1,
        customerName: 'John Doe', customerEmail: 'john@example.com', customerPhone: '555-000-0000',
      }),
      headers: { get: () => null },
    } as any

    await POST(req)

    // Should send 2 emails: customer confirmation + owner notification
    expect(mockResendSend).toHaveBeenCalledTimes(2)
  })
})
