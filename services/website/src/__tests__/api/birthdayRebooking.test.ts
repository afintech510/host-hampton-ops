/**
 * Tests for GET /api/cron/birthday-rebooking.
 * Covers: cron auth, window scan → email+SMS enqueue for opted-in contacts,
 * opt-out exclusion, and the dedup unique-index (23505) conflict path.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }),
  },
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))

// Budget + ledger are unit-tested elsewhere; stub them here.
jest.mock('@/lib/marketing/budget', () => ({
  checkSmsBudget: jest.fn().mockResolvedValue({ ok: true, sent: 0, cap: 500, remaining: 500 }),
  recordSmsSent: jest.fn().mockResolvedValue(1),
}))
jest.mock('@/lib/marketing/graph', () => ({ writeLedger: jest.fn().mockResolvedValue(undefined) }))

import { GET } from '@/app/api/cron/birthday-rebooking/route'
import { checkSmsBudget } from '@/lib/marketing/budget'

const CRON_SECRET = 'test-cron-secret'

function makeReq(secret?: string) {
  const headers = new Map<string, string>()
  if (secret) headers.set('x-cron-secret', secret)
  return {
    headers: { get: (k: string) => headers.get(k) ?? null },
    nextUrl: { searchParams: { get: () => null } },
  } as any
}

/**
 * Supabase mock. bookings query resolves `bookings`; contacts.maybeSingle
 * resolves `contact`; scheduled_reminders.insert resolves `insertResult` and
 * records inserted rows.
 */
function makeSupabase(opts: { bookings: any[]; contact: any; insertError?: any }) {
  const inserted: any[] = []

  function chain(table: string): any {
    const c: any = {}
    ;['select', 'gte', 'lte', 'not', 'eq', 'order', 'limit'].forEach(m => (c[m] = jest.fn(() => c)))

    if (table === 'bookings') {
      const p = Promise.resolve({ data: opts.bookings, error: null })
      c.then = p.then.bind(p)
      c.catch = p.catch.bind(p)
    }
    c.maybeSingle = jest.fn(() => Promise.resolve({ data: table === 'contacts' ? opts.contact : null, error: null }))
    c.insert = jest.fn((row: any) => {
      if (table === 'scheduled_reminders') {
        if (!opts.insertError) inserted.push(row)
        return Promise.resolve({ error: opts.insertError ?? null })
      }
      return Promise.resolve({ error: null })
    })
    return c
  }

  return { supabase: { from: jest.fn((t: string) => chain(t)) } as any, inserted }
}

const sampleBooking = {
  id: 'b-uuid-1',
  contact_name: 'Sarah Jones',
  contact_email: 'sarah@example.com',
  child_name: 'Mia',
  child_age: 6,
  party_date: '2025-11-01',
  event_type: 'kid-party',
}

describe('GET /api/cron/birthday-rebooking', () => {
  const originalEnv = process.env
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, CRON_SECRET }
  })
  afterAll(() => { process.env = originalEnv })

  it('returns 401 without the cron secret', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('enqueues an email and an SMS reminder for a fully opted-in contact', async () => {
    const { supabase, inserted } = makeSupabase({
      bookings: [sampleBooking],
      contact: { id: 'contact-1', email_opt_in: true, sms_opt_in: true, phone: '+16315551234' },
    })
    mockGetSupabase.mockReturnValue(supabase)

    const res = await GET(makeReq(CRON_SECRET))
    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ scanned: 1, emailQueued: 1, smsQueued: 1 })

    const types = inserted.map(r => r.reminder_type).sort()
    expect(types).toEqual(['birthday_rebook_email', 'birthday_rebook_sms'])
    // reference_id is the booking UUID, reference_type is 'booking'.
    expect(inserted.every(r => r.reference_id === 'b-uuid-1' && r.reference_type === 'booking')).toBe(true)
  })

  it('excludes opted-out contacts (no email, no SMS)', async () => {
    const { supabase, inserted } = makeSupabase({
      bookings: [sampleBooking],
      contact: { id: 'contact-1', email_opt_in: false, sms_opt_in: false, phone: '+16315551234' },
    })
    mockGetSupabase.mockReturnValue(supabase)

    const res = await GET(makeReq(CRON_SECRET))
    expect(res.json()).toMatchObject({ emailQueued: 0, smsQueued: 0 })
    expect(inserted).toHaveLength(0)
  })

  it('does not enqueue SMS when the marketing SMS budget is exhausted', async () => {
    ;(checkSmsBudget as jest.Mock).mockResolvedValueOnce({ ok: false, sent: 500, cap: 500, remaining: 0 })
    const { supabase, inserted } = makeSupabase({
      bookings: [sampleBooking],
      contact: { id: 'contact-1', email_opt_in: false, sms_opt_in: true, phone: '+16315551234' },
    })
    mockGetSupabase.mockReturnValue(supabase)

    const res = await GET(makeReq(CRON_SECRET))
    expect(res.json()).toMatchObject({ smsQueued: 0 })
    expect(inserted).toHaveLength(0)
  })

  it('treats a 23505 unique violation as an already-enqueued no-op (dedup constraint)', async () => {
    const { supabase } = makeSupabase({
      bookings: [sampleBooking],
      contact: { id: 'contact-1', email_opt_in: true, sms_opt_in: false, phone: null },
      insertError: { code: '23505', message: 'duplicate key' },
    })
    mockGetSupabase.mockReturnValue(supabase)

    const res = await GET(makeReq(CRON_SECRET))
    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ emailQueued: 0 }) // conflict → not counted, no throw
  })
})
