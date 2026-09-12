/**
 * Tests for POST /api/admin/events/[id]/tickets/[ticketId]/refund
 */

import { sampleEvent, sampleTicket } from '../mocks/fixtures'

// --- Chain builder ---
function buildChain(resolveValue: any) {
  const chain: any = {}
  const methods = ['select', 'ilike', 'insert', 'update', 'delete', 'eq', 'neq', 'gte', 'lte', 'order', 'single', 'in']
  for (const m of methods) {
    chain[m] = jest.fn().mockReturnValue(chain)
  }
  const p = Promise.resolve(resolveValue)
  chain.then = p.then.bind(p)
  chain.catch = p.catch.bind(p)
  return chain
}

// --- Module mocks ---
const mockStripeRefundCreate = jest.fn()
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    refunds: {
      create: mockStripeRefundCreate,
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

jest.mock('@/lib/emailTemplates', () => ({
  ticketRefundHtml: jest.fn().mockReturnValue('<html>Refund email</html>'),
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

// Import AFTER mocks
import { POST as refundTicket } from '@/app/api/admin/events/[id]/tickets/[ticketId]/refund/route'

describe('POST /api/admin/events/[id]/tickets/[ticketId]/refund', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = {
      ...originalEnv,
      ADMIN_PASSWORD: 'test-admin-pw',
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

  const authHeaders = {
    get: (name: string) => name === 'authorization' ? 'Bearer test-admin-pw' : null,
  }
  const params = { params: { id: sampleEvent.id, ticketId: sampleTicket.id } }

  it('returns 401 without auth', async () => {
    const req = {
      headers: { get: () => null },
      json: jest.fn().mockResolvedValue({}),
    } as any

    const response = await refundTicket(req, params)
    expect(response.status).toBe(401)
  })

  it('returns 404 when ticket not found', async () => {
    const chain = buildChain({ data: null, error: { message: 'not found' } })
    mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain), rpc: jest.fn() })

    const req = { headers: authHeaders, json: jest.fn().mockResolvedValue({}) } as any
    const response = await refundTicket(req, params)
    expect(response.status).toBe(404)
  })

  it('returns 400 when ticket already refunded', async () => {
    const refundedTicket = { ...sampleTicket, status: 'refunded' }
    const chain = buildChain({ data: refundedTicket, error: null })
    mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain), rpc: jest.fn() })

    const req = { headers: authHeaders, json: jest.fn().mockResolvedValue({}) } as any
    const response = await refundTicket(req, params)
    expect(response.status).toBe(400)
    expect(response.json().error).toContain('Already refunded')
  })

  it('processes Stripe refund and updates ticket status', async () => {
    const ticketChain = buildChain({ data: sampleTicket, error: null })
    const eventChain = buildChain({ data: { title: 'Embroidery Workshop' }, error: null })
    const updateChain = buildChain({ data: null, error: null })

    let fromCallCount = 0
    const fromMock = jest.fn().mockImplementation((table: string) => {
      fromCallCount++
      if (table === 'events') return eventChain
      if (table === 'event_tickets') {
        if (fromCallCount <= 1) return ticketChain
        return updateChain
      }
      return buildChain({ data: null, error: null })
    })

    const rpcMock = jest.fn().mockResolvedValue({ data: null, error: null })
    mockGetSupabase.mockReturnValue({ from: fromMock, rpc: rpcMock })
    mockStripeRefundCreate.mockResolvedValue({ id: 're_test_123' })

    const req = {
      headers: authHeaders,
      json: jest.fn().mockResolvedValue({ reason: 'Customer request' }),
    } as any

    const response = await refundTicket(req, params)
    expect(response.json().refunded).toBe(true)
    expect(response.json().amount).toBe(sampleTicket.total_cents)

    expect(mockStripeRefundCreate).toHaveBeenCalledWith({
      payment_intent: sampleTicket.stripe_payment_intent_id,
      amount: sampleTicket.total_cents,
    })

    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'refunded',
      refund_reason: 'Customer request',
    }))

    expect(rpcMock).toHaveBeenCalledWith('increment_event_tickets', {
      eid: sampleEvent.id,
      qty: sampleTicket.quantity,
    })

    expect(mockResendSend).toHaveBeenCalledTimes(1)
  })

  it('increments session tickets when ticket has session_id', async () => {
    const sessionTicket = { ...sampleTicket, session_id: 'session-123' }
    const ticketChain = buildChain({ data: sessionTicket, error: null })
    const eventChain = buildChain({ data: { title: 'Soft Play' }, error: null })
    const updateChain = buildChain({ data: null, error: null })

    let ticketCallCount = 0
    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'events') return eventChain
      if (table === 'event_tickets') {
        ticketCallCount++
        return ticketCallCount === 1 ? ticketChain : updateChain
      }
      return buildChain({ data: null, error: null })
    })

    const rpcMock = jest.fn().mockResolvedValue({ data: null, error: null })
    mockGetSupabase.mockReturnValue({ from: fromMock, rpc: rpcMock })
    mockStripeRefundCreate.mockResolvedValue({ id: 're_test' })

    const req = { headers: authHeaders, json: jest.fn().mockResolvedValue({}) } as any
    await refundTicket(req, params)

    expect(rpcMock).toHaveBeenCalledWith('increment_session_tickets', {
      sid: 'session-123',
      qty: sampleTicket.quantity,
    })
  })

  it('handles partial refund amount', async () => {
    const ticketChain = buildChain({ data: sampleTicket, error: null })
    const eventChain = buildChain({ data: { title: 'Workshop' }, error: null })
    const updateChain = buildChain({ data: null, error: null })

    let ticketCallCount = 0
    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'events') return eventChain
      if (table === 'event_tickets') {
        ticketCallCount++
        return ticketCallCount === 1 ? ticketChain : updateChain
      }
      return buildChain({ data: null, error: null })
    })

    mockGetSupabase.mockReturnValue({ from: fromMock, rpc: jest.fn().mockResolvedValue({ data: null }) })
    mockStripeRefundCreate.mockResolvedValue({ id: 're_test' })

    const req = {
      headers: authHeaders,
      json: jest.fn().mockResolvedValue({ amountCents: 4500 }),
    } as any

    const response = await refundTicket(req, params)
    expect(response.json().amount).toBe(4500)

    expect(mockStripeRefundCreate).toHaveBeenCalledWith({
      payment_intent: sampleTicket.stripe_payment_intent_id,
      amount: 4500,
    })
  })

  it('returns 500 when Stripe refund fails', async () => {
    const ticketChain = buildChain({ data: sampleTicket, error: null })
    mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(ticketChain), rpc: jest.fn() })
    mockStripeRefundCreate.mockRejectedValue(new Error('Charge already refunded'))

    const req = {
      headers: authHeaders,
      json: jest.fn().mockResolvedValue({}),
    } as any

    const response = await refundTicket(req, params)
    expect(response.status).toBe(500)
    expect(response.json().error).toContain('Stripe refund failed')
  })
})
