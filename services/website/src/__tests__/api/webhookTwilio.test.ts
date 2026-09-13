/**
 * Tests for the Twilio webhook handler: POST /api/webhooks/twilio
 *
 * Covers: STOP opt-out, HELP response, inbound SMS logging,
 *         delivery status callbacks, invalid body.
 *
 * DRIVEN AGAINST `makeContactsDb`, NOT a chain mock. The old mock answered
 * `{ data: { id: 'c-001' } }` to every read, which meant it could not see
 * either half of what was wrong here: the number was matched with a RAW
 * PostgREST `.or()` over three guessed spellings against a column that holds
 * five, and `.single()` on that filter ERRORS when two rows share a number —
 * which 21 numbers in production do — so the STOP was dropped on the floor.
 */

import { makeContactsDb } from '../helpers/fakeContactsDb'

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

import { POST } from '@/app/api/webhooks/twilio/route'

const C1 = '00000000-0000-4000-8000-0000000000c1'
const C2 = '00000000-0000-4000-8000-0000000000c2'

describe('POST /api/webhooks/twilio', () => {
  beforeEach(() => { jest.clearAllMocks() })

  function makeReq(formBody: string) {
    return { text: jest.fn().mockResolvedValue(formBody) } as any
  }

  function db(seed: Record<string, any[]> = {}) {
    const fake = makeContactsDb(seed)
    mockGetSupabase.mockReturnValue(fake.supabase)
    return fake
  }

  it('returns 400 for invalid body', async () => {
    db()
    const res = await POST({ text: jest.fn().mockRejectedValue(new Error('read error')) } as any)
    expect(res.status).toBe(400)
  })

  it('handles STOP — opts out of SMS and cancels pending SMS reminders', async () => {
    const fake = db({
      contacts: [
        { id: C1, email: 'a@x.com', phone: '6315551234', sms_opt_in: true, status: 'lead', email_opt_in: true, created_at: '2026-01-01T00:00:00Z' },
      ],
      scheduled_reminders: [
        { id: '00000000-0000-4000-8000-00000000ee01', contact_id: C1, channel: 'sms', status: 'pending' },
        { id: '00000000-0000-4000-8000-00000000ee02', contact_id: C1, channel: 'email', status: 'pending' },
      ],
    })

    const res = await POST(makeReq('From=%2B16315551234&Body=STOP&MessageSid=SM123'))
    expect(res.headers.get('Content-Type')).toBe('text/xml')

    expect(fake.tables.contacts[0].sms_opt_in).toBe(false)
    expect(fake.tables.scheduled_reminders[0].status).toBe('cancelled')
    // The email reminder is NOT a text message and must survive.
    expect(fake.tables.scheduled_reminders[1].status).toBe('pending')
    expect(fake.tables.contact_interactions).toHaveLength(1)
    expect(fake.tables.contact_interactions[0].type).toBe('sms_unsubscribed')
  })

  it('a STOP reaches EVERY contact row holding that number, in every spelling', async () => {
    // The measured shape: 21 normalised numbers carry more than one row, and
    // the formats really do differ between them.
    const fake = db({
      contacts: [
        { id: C1, email: 'first@x.com', phone: '631-555-1234', sms_opt_in: true, status: 'lead', email_opt_in: true, created_at: '2026-01-01T00:00:00Z' },
        { id: C2, email: 'second@x.com', phone: '+16315551234', sms_opt_in: true, status: 'lead', email_opt_in: true, created_at: '2026-02-01T00:00:00Z' },
      ],
    })

    await POST(makeReq('From=%2B16315551234&Body=STOP&MessageSid=SM124'))

    expect(fake.tables.contacts.map(c => c.sms_opt_in)).toEqual([false, false])
    expect(fake.tables.contact_interactions).toHaveLength(2)
  })

  it('a STOP whose contact read FAILS is not recorded as done', async () => {
    const fake = db({
      contacts: [
        { id: C1, email: 'a@x.com', phone: '6315551234', sms_opt_in: true, status: 'lead', email_opt_in: true, created_at: '2026-01-01T00:00:00Z' },
      ],
    })
    fake.failReads('contacts')

    const res = await POST(makeReq('From=%2B16315551234&Body=STOP&MessageSid=SM125'))
    // Twilio's reply is deliberately unchanged — a customer must never be told
    // their opt-out failed — but nothing was written and the log says so.
    expect(res.headers.get('Content-Type')).toBe('text/xml')
    expect(fake.tables.contacts[0].sms_opt_in).toBe(true)
    expect(fake.tables.contact_interactions).toHaveLength(0)
  })

  it('a STOP from a number we do not hold writes nothing and does not throw', async () => {
    const fake = db({ contacts: [] })
    const res = await POST(makeReq('From=%2B16319990000&Body=STOP&MessageSid=SM126'))
    expect(res.headers.get('Content-Type')).toBe('text/xml')
    expect(fake.tables.contact_interactions).toHaveLength(0)
  })

  it('handles HELP — returns TwiML with help text and the PUBLIC line', async () => {
    db()
    const res = await POST(makeReq('From=%2B16315551234&Body=HELP&MessageSid=SM456'))
    expect(res.headers.get('Content-Type')).toBe('text/xml')
    const body = await (res as Response).text()
    // The business line, not the Venmo/Zelle number (lib/paymentContacts.ts).
    expect(body).toContain('998-9325')
    expect(body).not.toContain('599-2469')
  })

  it('logs inbound SMS for a known contact, matching a number stored in another format', async () => {
    const fake = db({
      contacts: [
        { id: C2, email: 'b@x.com', phone: '(631) 555-9999', sms_opt_in: true, status: 'lead', email_opt_in: true, created_at: '2026-01-01T00:00:00Z' },
      ],
    })

    const res = await POST(makeReq('From=%2B16315559999&Body=Hello+there&MessageSid=SM789'))
    expect(res.headers.get('Content-Type')).toBe('text/xml')
    expect(fake.tables.contact_interactions).toHaveLength(1)
    expect(fake.tables.contact_interactions[0]).toMatchObject({
      contact_id: C2,
      type: 'sms_received',
    })
  })

  it('handles delivery status callback', async () => {
    db()
    const res = await POST(makeReq('MessageSid=SM999&MessageStatus=delivered'))
    expect(res.json().received).toBe(true)
  })

  it('returns received=true for empty body/from (status-only callback)', async () => {
    db()
    const res = await POST(makeReq('MessageSid=SM000&SmsStatus=sent'))
    expect(res.json().received).toBe(true)
  })
})
