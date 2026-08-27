/**
 * Tests for the Quo inbound webhook: POST /api/webhooks/quo
 * Covers: STOP opt-out, inbound message logging, ignored event types,
 *         invalid body. Signature verification is off (no QUO_WEBHOOK_SECRET).
 */

function buildChain(resolveValue: any) {
  const chain: any = {}
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'gte', 'lte', 'or', 'order', 'single', 'in', 'range', 'limit']
  for (const m of methods) chain[m] = jest.fn().mockReturnValue(chain)
  const p = Promise.resolve(resolveValue)
  chain.then = p.then.bind(p)
  chain.catch = p.catch.bind(p)
  return chain
}

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: (...a: any[]) => mockGetSupabase(...a) }))
jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }),
  },
}))

import { POST } from '@/app/api/webhooks/quo/route'

function makeReq(jsonBody: string) {
  return {
    text: jest.fn().mockResolvedValue(jsonBody),
    headers: { get: jest.fn().mockReturnValue(null) },
  } as any
}

function event(obj: Record<string, any>, type = 'message.received') {
  return JSON.stringify({ type, data: { object: obj } })
}

describe('POST /api/webhooks/quo', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.QUO_WEBHOOK_SECRET
  })

  it('returns 400 when the body cannot be read', async () => {
    const req = { text: jest.fn().mockRejectedValue(new Error('x')), headers: { get: () => null } } as any
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid JSON', async () => {
    const res = await POST(makeReq('not json'))
    expect(res.status).toBe(400)
  })

  it('handles STOP — opts out and cancels pending SMS reminders', async () => {
    const contactChain = buildChain({ data: { id: 'c-1' }, error: null })
    const genericChain = buildChain({ data: null, error: null })
    let contactsCalls = 0
    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'contacts') { contactsCalls++; return contactsCalls <= 1 ? contactChain : genericChain }
      return genericChain
    })
    mockGetSupabase.mockReturnValue({ from: fromMock })

    const res = await POST(makeReq(event({ from: '+16315551234', text: 'STOP', direction: 'incoming', id: 'AC1' })))

    expect(res.json()).toMatchObject({ action: 'opt_out' })
    expect(fromMock).toHaveBeenCalledWith('contacts')
    expect(fromMock).toHaveBeenCalledWith('scheduled_reminders')
    expect(fromMock).toHaveBeenCalledWith('contact_interactions')
  })

  it('logs a non-STOP inbound message for a known contact', async () => {
    const contactChain = buildChain({ data: { id: 'c-2' }, error: null })
    const insertChain = buildChain({ data: null, error: null })
    const fromMock = jest.fn().mockImplementation((table: string) =>
      table === 'contacts' ? contactChain : insertChain)
    mockGetSupabase.mockReturnValue({ from: fromMock })

    const res = await POST(makeReq(event({ from: '+16315559999', text: 'thanks!', direction: 'incoming', id: 'AC2' })))

    expect(res.json()).toMatchObject({ received: true })
    expect(fromMock).toHaveBeenCalledWith('contact_interactions')
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      contact_id: 'c-2',
      type: 'sms_received',
      metadata: expect.objectContaining({ provider: 'quo' }),
    }))
  })

  it('ignores non-inbound events without touching the DB', async () => {
    const fromMock = jest.fn()
    mockGetSupabase.mockReturnValue({ from: fromMock })

    const res = await POST(makeReq(event({ from: '+1631', text: 'x', direction: 'outgoing' }, 'message.delivered')))

    expect(res.json()).toMatchObject({ received: true })
    expect(fromMock).not.toHaveBeenCalled()
  })
})
