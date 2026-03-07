/**
 * Tests for POST /api/webhook (Stripe webhook handler)
 */

import { sampleEvent } from '../mocks/fixtures'

// --- Mocks ---
const mockConstructEvent = jest.fn()
const mockResendSend = jest.fn().mockResolvedValue({ id: 'email_1' })

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: mockConstructEvent,
    },
  }))
})

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockResendSend },
  })),
}))

// Mock Supabase via createClient (webhook uses direct import, not getSupabase)
const mockFrom = jest.fn()
const mockRpc = jest.fn().mockResolvedValue({ data: null, error: null })

function buildChain(resolveValue: any) {
  const chain: any = {}
  const methods = ['select', 'insert', 'update', 'eq', 'neq', 'gte', 'lte', 'order', 'single', 'in']
  for (const m of methods) {
    chain[m] = jest.fn().mockReturnValue(chain)
  }
  const p = Promise.resolve(resolveValue)
  chain.then = p.then.bind(p)
  chain.catch = p.catch.bind(p)
  return chain
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn().mockImplementation(() => ({
    from: mockFrom,
    rpc: mockRpc,
  })),
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

describe('POST /api/webhook', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    process.env = {
      ...originalEnv,
      STRIPE_SECRET_KEY: 'sk_test_fake',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_KEY: 'test-key',
      RESEND_API_KEY: 're_test_fake',
      RESEND_FROM_EMAIL: 'test@mail.hosthampton.com',
    }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns 400 when signature header is missing', async () => {
    const { POST } = await import('@/app/api/webhook/route')

    const req = {
      text: jest.fn().mockResolvedValue('{}'),
      headers: { get: () => null },
    } as any

    const response = await POST(req)
    expect(response.status).toBe(400)
    expect(response.json().error).toContain('Missing signature')
  })

  it('returns 400 when signature verification fails', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('Invalid signature')
    })

    const { POST } = await import('@/app/api/webhook/route')

    const req = {
      text: jest.fn().mockResolvedValue('{}'),
      headers: { get: (name: string) => name === 'stripe-signature' ? 'sig_test' : null },
    } as any

    const response = await POST(req)
    expect(response.status).toBe(400)
    expect(response.json().error).toContain('Invalid signature')
  })

  it('processes event_ticket checkout.session.completed', async () => {
    const ticketInsertChain = buildChain({ data: null, error: null })
    const eventSelectChain = buildChain({
      data: { title: 'Embroidery Workshop', event_date: '2026-03-15', event_time: '2:00 PM', location: 'Host Hampton' },
      error: null,
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'event_tickets') return ticketInsertChain
      if (table === 'events') return eventSelectChain
      return buildChain({ data: null, error: null })
    })

    mockConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          payment_intent: 'pi_test_123',
          amount_total: 9000,
          metadata: {
            type: 'event_ticket',
            eventId: sampleEvent.id,
            sessionId: '',
            quantity: '2',
            variantLabel: 'Baseball Hat',
            customerName: 'Jane Smith',
            customerEmail: 'jane@example.com',
            customerPhone: '555-123-4567',
          },
        },
      },
    })

    const { POST } = await import('@/app/api/webhook/route')

    const req = {
      text: jest.fn().mockResolvedValue('raw-body'),
      headers: { get: (name: string) => name === 'stripe-signature' ? 'sig_valid' : null },
    } as any

    const response = await POST(req)
    expect(response.json().received).toBe(true)

    // Should have inserted a ticket
    expect(mockFrom).toHaveBeenCalledWith('event_tickets')
    expect(ticketInsertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      customer_name: 'Jane Smith',
      customer_email: 'jane@example.com',
      quantity: 2,
      variant_label: 'Baseball Hat',
      status: 'confirmed',
      stripe_payment_intent_id: 'pi_test_123',
    }))

    // Should have decremented event-level tickets (no sessionId)
    expect(mockRpc).toHaveBeenCalledWith('decrement_event_tickets', expect.objectContaining({
      eid: sampleEvent.id,
      qty: 2,
    }))

    // Should send 2 emails
    expect(mockResendSend).toHaveBeenCalledTimes(2)
  })

  it('decrements session tickets when sessionId present', async () => {
    const chain = buildChain({ data: null, error: null })
    const eventChain = buildChain({
      data: { title: 'Soft Play', event_date: '2026-03-04', event_time: '10:00 AM', location: 'Host Hampton' },
      error: null,
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'events') return eventChain
      return chain
    })

    mockConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_456',
          payment_intent: 'pi_test_456',
          amount_total: 2000,
          metadata: {
            type: 'event_ticket',
            eventId: 'event-id-123',
            sessionId: 'session-id-456',
            quantity: '1',
            variantLabel: '',
            customerName: 'Test User',
            customerEmail: 'test@test.com',
            customerPhone: '',
          },
        },
      },
    })

    const { POST } = await import('@/app/api/webhook/route')

    const req = {
      text: jest.fn().mockResolvedValue('raw-body'),
      headers: { get: (name: string) => name === 'stripe-signature' ? 'sig_valid' : null },
    } as any

    await POST(req)

    // Should decrement session tickets, not event tickets
    expect(mockRpc).toHaveBeenCalledWith('decrement_session_tickets', {
      sid: 'session-id-456',
      qty: 1,
    })
  })

  it('processes party booking deposit (non-event_ticket)', async () => {
    const bookingChain = buildChain({ data: null, error: null })
    mockFrom.mockReturnValue(bookingChain)

    mockConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_booking',
          payment_intent: 'pi_test_booking',
          amount_total: 25000,
          metadata: {
            // No type: 'event_ticket' — falls through to booking deposit
            contactName: 'Sarah Jones',
            contactEmail: 'sarah@example.com',
            contactPhone: '555-999-8888',
            partyDate: '2026-04-01',
            partyTime: '2:00 PM',
            eventType: 'kid-party',
            packageName: 'Classic',
            childName: 'Emma',
            childAge: '5',
            guestCount: '15',
          },
        },
      },
    })

    const { POST } = await import('@/app/api/webhook/route')

    const req = {
      text: jest.fn().mockResolvedValue('raw-body'),
      headers: { get: (name: string) => name === 'stripe-signature' ? 'sig_valid' : null },
    } as any

    const response = await POST(req)
    expect(response.json().received).toBe(true)

    // Should have inserted into bookings table
    expect(mockFrom).toHaveBeenCalledWith('bookings')
    expect(bookingChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      status: 'deposit_paid',
      contact_name: 'Sarah Jones',
      contact_email: 'sarah@example.com',
      deposit_amount: 250,
      event_type: 'kid-party',
    }))
  })
})
