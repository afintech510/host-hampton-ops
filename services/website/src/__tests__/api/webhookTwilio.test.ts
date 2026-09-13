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

import crypto from 'crypto'
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

const AUTH_TOKEN = 'test-auth-token-0123456789abcdef'
const SIGNED_URL = 'https://www.hosthampton.com/api/webhooks/twilio'

/**
 * Twilio's documented signing algorithm, WRITTEN OUT HERE rather than imported
 * from the module under test.
 *
 * That is the whole point. The Quo edge went down for 2.5 days because the only
 * verification anybody ran signed the payload the way the verifier checks it —
 * a test that can only prove the verifier agrees with itself. This one restates
 * the spec (https://www.twilio.com/docs/usage/security): HMAC-SHA1 over the
 * full URL followed by every POST parameter sorted by name, key then value,
 * keyed by the auth token, base64. If the module drifts from the spec, this
 * disagrees with it.
 */
function twilioSign(url: string, form: string, token = AUTH_TOKEN): string {
  const params = new URLSearchParams(form)
  const keys: string[] = []
  params.forEach((_v, k) => { if (!keys.includes(k)) keys.push(k) })
  keys.sort()
  let payload = url
  for (const k of keys) for (const v of params.getAll(k)) payload += k + v
  return crypto.createHmac('sha1', token).update(Buffer.from(payload, 'utf8')).digest('base64')
}

describe('POST /api/webhooks/twilio', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, TWILIO_AUTH_TOKEN: AUTH_TOKEN }
  })
  afterAll(() => { process.env = originalEnv })

  /** A request carrying a genuine Twilio signature. */
  function makeReq(formBody: string, opts: { signature?: string | null } = {}) {
    const signature =
      opts.signature === undefined ? twilioSign(SIGNED_URL, formBody) : opts.signature
    const headers: Record<string, string> = { host: 'www.hosthampton.com' }
    if (signature) headers['x-twilio-signature'] = signature
    return {
      text: jest.fn().mockResolvedValue(formBody),
      url: SIGNED_URL,
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    } as any
  }

  function db(seed: Record<string, any[]> = {}) {
    const fake = makeContactsDb(seed)
    mockGetSupabase.mockReturnValue(fake.supabase)
    return fake
  }

  it('returns 400 for invalid body', async () => {
    db()
    const res = await POST({
      text: jest.fn().mockRejectedValue(new Error('read error')),
      url: SIGNED_URL,
      headers: { get: () => null },
    } as any)
    expect(res.status).toBe(400)
  })

  /* ── Signature (added by link 24) ─────────────────────────────────────
   *
   * This route verified NOTHING at all until 2026-09-13, on a public URL whose
   * whole job is to write `contacts.sms_opt_in = false` for every row holding a
   * number. Every test below now drives it through a real signature, so the
   * check cannot be deleted without turning this file red. */

  it('FAILS CLOSED: an unsigned STOP is a 401 and nobody is opted out', async () => {
    const fake = db({
      contacts: [
        { id: C1, email: 'a@x.com', phone: '6315551234', sms_opt_in: true, status: 'lead', email_opt_in: true, created_at: '2026-01-01T00:00:00Z' },
      ],
    })
    const res = await POST(makeReq('From=%2B16315551234&Body=STOP&MessageSid=SM1', { signature: null }))
    expect(res.status).toBe(401)
    expect(fake.tables.contacts[0].sms_opt_in).toBe(true)
    expect(fake.tables.contact_interactions).toHaveLength(0)
  })

  it('FAILS CLOSED: a WRONG signature is a 401', async () => {
    const fake = db({
      contacts: [
        { id: C1, email: 'a@x.com', phone: '6315551234', sms_opt_in: true, status: 'lead', email_opt_in: true, created_at: '2026-01-01T00:00:00Z' },
      ],
    })
    const res = await POST(
      makeReq('From=%2B16315551234&Body=STOP&MessageSid=SM2', { signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=' }),
    )
    expect(res.status).toBe(401)
    expect(fake.tables.contacts[0].sms_opt_in).toBe(true)
  })

  it('FAILS CLOSED: a signature over DIFFERENT parameters does not authorise these ones', async () => {
    const fake = db({
      contacts: [
        { id: C1, email: 'a@x.com', phone: '6315551234', sms_opt_in: true, status: 'lead', email_opt_in: true, created_at: '2026-01-01T00:00:00Z' },
      ],
    })
    // A genuine signature — for somebody else's number. `From` decides whose
    // consent we write, so it has to be inside what was signed.
    const stolen = twilioSign(SIGNED_URL, 'From=%2B16319990000&Body=STOP&MessageSid=SM3')
    const res = await POST(makeReq('From=%2B16315551234&Body=STOP&MessageSid=SM3', { signature: stolen }))
    expect(res.status).toBe(401)
    expect(fake.tables.contacts[0].sms_opt_in).toBe(true)
  })

  it('FAILS CLOSED in production when TWILIO_AUTH_TOKEN is unset', async () => {
    db()
    delete process.env.TWILIO_AUTH_TOKEN
    const nodeEnv = process.env.NODE_ENV
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true })
    try {
      const res = await POST(makeReq('From=%2B16315551234&Body=STOP&MessageSid=SM4', { signature: null }))
      expect(res.status).toBe(401)
    } finally {
      Object.defineProperty(process.env, 'NODE_ENV', { value: nodeEnv, configurable: true })
    }
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
