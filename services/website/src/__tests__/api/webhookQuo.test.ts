/**
 * Tests for the Quo inbound webhook: POST /api/webhooks/quo
 *
 * Phase 1 scope: STOP opt-out, inbound message logging, ignored event types,
 * invalid body.
 * Phase 2 scope: FAIL CLOSED on a bad signature, every inbound written to
 * ingested_messages with external_id='quo:<id>' (the dedupe), unknown numbers
 * becoming contacts instead of being dropped, and reviewer classification.
 */

function buildChain(resolveValue: any) {
  const chain: any = {}
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'gte', 'lte', 'or', 'order', 'single', 'maybeSingle', 'in', 'range', 'limit']
  for (const m of methods) chain[m] = jest.fn().mockReturnValue(chain)
  const p = Promise.resolve(resolveValue)
  chain.then = p.then.bind(p)
  chain.catch = p.catch.bind(p)
  return chain
}

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: (...a: any[]) => mockGetSupabase(...a) }))

const mockRecordInboundEvent = jest.fn().mockResolvedValue('event-1')
jest.mock('@/lib/agent/events', () => ({
  recordInboundEvent: (...a: any[]) => mockRecordInboundEvent(...a),
}))

const mockUpsertContactByPhone = jest.fn().mockResolvedValue('new-contact-1')
jest.mock('@/lib/contacts', () => ({
  upsertContactByPhone: (...a: any[]) => mockUpsertContactByPhone(...a),
}))
jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }),
  },
}))

import { POST } from '@/app/api/webhooks/quo/route'

function makeReq(jsonBody: string, headers: Record<string, string> = {}) {
  return {
    text: jest.fn().mockResolvedValue(jsonBody),
    headers: { get: jest.fn((k: string) => headers[k.toLowerCase()] ?? null) },
  } as any
}

function event(obj: Record<string, any>, type = 'message.received') {
  return JSON.stringify({ type, data: { object: obj } })
}

describe('POST /api/webhooks/quo', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, REVIEWER_PHONES: '+16314008080' }
    delete process.env.QUO_WEBHOOK_SECRET
    mockRecordInboundEvent.mockResolvedValue('event-1')
    mockUpsertContactByPhone.mockResolvedValue('new-contact-1')
  })
  afterAll(() => { process.env = originalEnv })

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

  /* ── Phase 2 ──────────────────────────────────────────────────────── */

  it('FAILS CLOSED: a bad signature is rejected with 401, not processed', async () => {
    process.env.QUO_WEBHOOK_SECRET = Buffer.from('shhh').toString('base64')
    const fromMock = jest.fn()
    mockGetSupabase.mockReturnValue({ from: fromMock })

    const res = await POST(
      makeReq(event({ from: '+16314008080', text: 'SEND', direction: 'incoming', id: 'AC9' }), {
        'webhook-id': 'msg_1',
        'webhook-timestamp': '1700000000',
        'webhook-signature': 'v1,bm90LWEtcmVhbC1zaWduYXR1cmU=',
      }),
    )

    expect(res.status).toBe(401)
    // Nothing was read, nothing recorded — a forged SEND cannot reach the loop.
    expect(fromMock).not.toHaveBeenCalled()
    expect(mockRecordInboundEvent).not.toHaveBeenCalled()
  })

  it('FAILS CLOSED: signature headers missing entirely is also a 401', async () => {
    process.env.QUO_WEBHOOK_SECRET = Buffer.from('shhh').toString('base64')
    mockGetSupabase.mockReturnValue({ from: jest.fn() })

    const res = await POST(makeReq(event({ from: '+16314008080', text: 'SEND', direction: 'incoming', id: 'AC9' })))

    expect(res.status).toBe(401)
    expect(mockRecordInboundEvent).not.toHaveBeenCalled()
  })

  it('records every inbound message with external_id=quo:<id> so a redelivery dedupes', async () => {
    const chain = buildChain({ data: { id: 'c-3' }, error: null })
    mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

    await POST(makeReq(event({ from: '+15165550000', text: 'do you have Nov 8?', direction: 'incoming', id: 'ACX' })))

    expect(mockRecordInboundEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'quo',
        externalId: 'quo:ACX',
        fromAddress: '+15165550000',
        body: 'do you have Nov 8?',
        classification: 'sms_inbound',
      }),
    )
  })

  it('creates a contact for an unknown texter instead of dropping the message', async () => {
    // No contact matches the number.
    const chain = buildChain({ data: null, error: null })
    mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

    const res = await POST(makeReq(event({ from: '+15165551111', text: 'hi!', direction: 'incoming', id: 'ACY' })))

    expect(mockUpsertContactByPhone).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+15165551111', sourceDetail: 'quo-inbound-sms' }),
    )
    expect(mockRecordInboundEvent).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'new-contact-1' }),
    )
    expect(res.json()).toMatchObject({ received: true })
  })

  it('flags a reviewer phone on the event, and only the phone number decides it', async () => {
    const chain = buildChain({ data: { id: 'c-4' }, error: null })
    mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

    await POST(makeReq(event({ from: '+16314008080', text: 'SEND', direction: 'incoming', id: 'AC-R' })))
    expect(mockRecordInboundEvent).toHaveBeenCalledWith(
      expect.objectContaining({ classification: 'reviewer_reply' }),
    )

    mockRecordInboundEvent.mockClear()
    // Same words, different number → not a reviewer.
    await POST(makeReq(event({ from: '+15165552222', text: 'SEND', direction: 'incoming', id: 'AC-C' })))
    expect(mockRecordInboundEvent).toHaveBeenCalledWith(
      expect.objectContaining({ classification: 'sms_inbound' }),
    )
  })

  it('still records a STOP so the reviewer loop can read it as "drop that draft"', async () => {
    const chain = buildChain({ data: { id: 'c-5' }, error: null })
    mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

    const res = await POST(makeReq(event({ from: '+16314008080', text: 'STOP', direction: 'incoming', id: 'AC-S' })))

    expect(res.json()).toMatchObject({ action: 'opt_out' })
    expect(mockRecordInboundEvent).toHaveBeenCalledWith(
      expect.objectContaining({ classification: 'reviewer_reply', parsed: expect.objectContaining({ stop: true }) }),
    )
  })

  it('does not manufacture a contact for a STOP from a number we have never seen', async () => {
    const chain = buildChain({ data: null, error: null })
    mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

    await POST(makeReq(event({ from: '+15165553333', text: 'STOP', direction: 'incoming', id: 'AC-S2' })))

    expect(mockUpsertContactByPhone).not.toHaveBeenCalled()
  })
})
