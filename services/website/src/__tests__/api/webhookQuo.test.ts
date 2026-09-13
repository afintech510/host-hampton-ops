/**
 * Tests for the Quo inbound webhook: POST /api/webhooks/quo
 *
 * Phase 1 scope: STOP opt-out, inbound message logging, ignored event types,
 * invalid body.
 * Phase 2 scope: FAIL CLOSED on a bad signature, every inbound written to
 * ingested_messages with external_id='quo:<id>' (the dedupe), unknown numbers
 * becoming contacts instead of being dropped, and reviewer classification.
 *
 * DRIVEN AGAINST `makeContactsDb`, NOT a chain mock (link 17). The old mock
 * answered `{ data: { id: 'c-1' } }` to every read, so it could not see that
 * the contact lookup was a RAW PostgREST `.or()` of three guessed phone
 * spellings read through `.maybeSingle()` — which ERRORS when two rows share a
 * number. 21 numbers in production do, and the discarded error made the route
 * believe a texter it already knew was a stranger.
 */

import { makeContactsDb } from '../helpers/fakeContactsDb'

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: (...a: any[]) => mockGetSupabase(...a) }))

const mockRecordInboundEvent = jest.fn().mockResolvedValue('event-1')
jest.mock('@/lib/agent/events', () => ({
  recordInboundEvent: (...a: any[]) => mockRecordInboundEvent(...a),
}))

const NEW_CONTACT = '00000000-0000-4000-8000-0000000000f9'
const mockUpsertContactByPhone = jest.fn().mockResolvedValue(NEW_CONTACT)
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

const C1 = '00000000-0000-4000-8000-0000000000c1'
const C2 = '00000000-0000-4000-8000-0000000000c2'

function makeReq(jsonBody: string, headers: Record<string, string> = {}) {
  return {
    text: jest.fn().mockResolvedValue(jsonBody),
    headers: { get: jest.fn((k: string) => headers[k.toLowerCase()] ?? null) },
  } as any
}

function event(obj: Record<string, any>, type = 'message.received') {
  return JSON.stringify({ type, data: { object: obj } })
}

function contact(id: string, phone: string, extra: Record<string, any> = {}) {
  return {
    id,
    phone,
    email: `${id.slice(-4)}@x.com`,
    status: 'lead',
    email_opt_in: false,
    sms_opt_in: true,
    created_at: '2026-01-01T00:00:00Z',
    ...extra,
  }
}

describe('POST /api/webhooks/quo', () => {
  const originalEnv = process.env
  let fake: ReturnType<typeof makeContactsDb>

  function db(seed: Record<string, any[]> = {}) {
    fake = makeContactsDb(seed)
    mockGetSupabase.mockReturnValue(fake.supabase)
    return fake
  }

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, REVIEWER_PHONES: '+16314008080' }
    delete process.env.QUO_WEBHOOK_SECRET
    mockRecordInboundEvent.mockResolvedValue('event-1')
    mockUpsertContactByPhone.mockResolvedValue(NEW_CONTACT)
    db()
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
    db({
      contacts: [contact(C1, '6315551234')],
      scheduled_reminders: [
        { id: '00000000-0000-4000-8000-00000000ee01', contact_id: C1, channel: 'sms', status: 'pending' },
      ],
    })

    const res = await POST(makeReq(event({ from: '+16315551234', text: 'STOP', direction: 'incoming', id: 'AC1' })))

    expect(res.json()).toMatchObject({ action: 'opt_out' })
    expect(fake.tables.contacts[0].sms_opt_in).toBe(false)
    expect(fake.tables.scheduled_reminders[0].status).toBe('cancelled')
    expect(fake.tables.contact_interactions[0].type).toBe('sms_unsubscribed')
  })

  it('a STOP reaches EVERY row holding the number, whatever format each is stored in', async () => {
    db({
      contacts: [
        contact(C1, '(631) 555-1234'),
        contact(C2, '+16315551234', { created_at: '2026-02-01T00:00:00Z' }),
      ],
    })

    await POST(makeReq(event({ from: '+16315551234', text: 'STOP', direction: 'incoming', id: 'AC1b' })))

    expect(fake.tables.contacts.map(c => c.sms_opt_in)).toEqual([false, false])
  })

  it('a contact read failure answers 503 so Quo redelivers, rather than swallowing a STOP', async () => {
    db({ contacts: [contact(C1, '6315551234')] })
    fake.failReads('contacts')

    const res = await POST(makeReq(event({ from: '+16315551234', text: 'STOP', direction: 'incoming', id: 'AC1c' })))

    expect(res.status).toBe(503)
    expect(fake.tables.contacts[0].sms_opt_in).toBe(true)
    expect(mockRecordInboundEvent).not.toHaveBeenCalled()
  })

  it('logs a non-STOP inbound message for a known contact', async () => {
    db({ contacts: [contact(C2, '631-555-9999')] })

    const res = await POST(makeReq(event({ from: '+16315559999', text: 'thanks!', direction: 'incoming', id: 'AC2' })))

    expect(res.json()).toMatchObject({ received: true })
    expect(fake.tables.contact_interactions).toHaveLength(1)
    expect(fake.tables.contact_interactions[0]).toMatchObject({
      contact_id: C2,
      type: 'sms_received',
      metadata: expect.objectContaining({ provider: 'quo' }),
    })
    // It must NOT have created a second row for a number it already holds.
    expect(mockUpsertContactByPhone).not.toHaveBeenCalled()
  })

  it('ignores non-inbound events without touching the DB', async () => {
    const res = await POST(makeReq(event({ from: '+1631', text: 'x', direction: 'outgoing' }, 'message.delivered')))
    expect(res.json()).toMatchObject({ received: true })
    expect(fake.tables.contact_interactions).toHaveLength(0)
  })

  /* ── Phase 2 ──────────────────────────────────────────────────────── */

  it('FAILS CLOSED: a bad signature is rejected with 401, not processed', async () => {
    process.env.QUO_WEBHOOK_SECRET = Buffer.from('shhh').toString('base64')

    const res = await POST(
      makeReq(event({ from: '+16314008080', text: 'SEND', direction: 'incoming', id: 'AC9' }), {
        'webhook-id': 'msg_1',
        'webhook-timestamp': '1700000000',
        'webhook-signature': 'v1,bm90LWEtcmVhbC1zaWduYXR1cmU=',
      }),
    )

    expect(res.status).toBe(401)
    // Nothing was read, nothing recorded — a forged SEND cannot reach the loop.
    expect(fake.tables.contact_interactions).toHaveLength(0)
    expect(mockRecordInboundEvent).not.toHaveBeenCalled()
  })

  it('FAILS CLOSED: signature headers missing entirely is also a 401', async () => {
    process.env.QUO_WEBHOOK_SECRET = Buffer.from('shhh').toString('base64')

    const res = await POST(makeReq(event({ from: '+16314008080', text: 'SEND', direction: 'incoming', id: 'AC9' })))

    expect(res.status).toBe(401)
    expect(mockRecordInboundEvent).not.toHaveBeenCalled()
  })

  it('records every inbound message with external_id=quo:<id> so a redelivery dedupes', async () => {
    db({ contacts: [contact(C1, '5165550000')] })

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
    db({ contacts: [] })

    const res = await POST(makeReq(event({ from: '+15165551111', text: 'hi!', direction: 'incoming', id: 'ACY' })))

    expect(mockUpsertContactByPhone).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+15165551111', sourceDetail: 'quo-inbound-sms' }),
    )
    expect(mockRecordInboundEvent).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: NEW_CONTACT }),
    )
    expect(res.json()).toMatchObject({ received: true })
  })

  it('flags a reviewer phone on the event, and only the phone number decides it', async () => {
    db({ contacts: [contact(C1, '6314008080'), contact(C2, '5165552222', { created_at: '2026-02-01T00:00:00Z' })] })

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
    db({ contacts: [contact(C1, '6314008080')] })

    const res = await POST(makeReq(event({ from: '+16314008080', text: 'STOP', direction: 'incoming', id: 'AC-S' })))

    expect(res.json()).toMatchObject({ action: 'opt_out' })
    expect(mockRecordInboundEvent).toHaveBeenCalledWith(
      expect.objectContaining({ classification: 'reviewer_reply', parsed: expect.objectContaining({ stop: true }) }),
    )
  })

  it('does not manufacture a contact for a STOP from a number we have never seen', async () => {
    db({ contacts: [] })

    await POST(makeReq(event({ from: '+15165553333', text: 'STOP', direction: 'incoming', id: 'AC-S2' })))

    expect(mockUpsertContactByPhone).not.toHaveBeenCalled()
    expect(fake.tables.contact_interactions).toHaveLength(0)
  })
})
