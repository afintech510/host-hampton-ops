/**
 * Tests for GET /api/cron/birthday-rebooking.
 *
 * Rebuilt 2026-09-12 on `helpers/fakeReminderDb`, which models the real column
 * types, CHECK constraints, unique index and — the one that matters here —
 * Postgres's CASE-SENSITIVE `.eq()` on a text column. The previous mock resolved
 * `contacts.maybeSingle()` to a fixed row no matter what was asked of it, so it
 * could not see that this route missed every contact whose stored address has a
 * capital letter in it. 21 of 1219 real contacts do.
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
import { checkSmsBudget, recordSmsSent } from '@/lib/marketing/budget'
import { makeFakeDb, scheduledRemindersSpec, type TableSpec } from '../helpers/fakeReminderDb'

const CRON_SECRET = 'test-cron-secret'
const CONTACT_ID = '11111111-1111-4111-8111-111111111111'
const BOOKING_ID = '33333333-3333-4333-8333-333333333333'

function makeReq(secret?: string) {
  const headers = new Map<string, string>()
  if (secret) headers.set('x-cron-secret', secret)
  return {
    headers: { get: (k: string) => headers.get(k) ?? null },
    nextUrl: { searchParams: { get: () => null } },
  } as any
}

const bookingsSpec: TableSpec = {
  columns: {
    id: 'uuid', booking_ref: 'text', contact_name: 'text', contact_email: 'text',
    child_name: 'text', child_age: 'int', party_date: 'text', event_type: 'text',
    status: 'text', created_at: 'timestamptz',
  },
}
const contactsSpec: TableSpec = {
  columns: {
    id: 'uuid', email: 'text', phone: 'text', first_name: 'text',
    sms_opt_in: 'bool', email_opt_in: 'bool', status: 'text', created_at: 'timestamptz',
  },
}

/** A party 9 months ago — squarely inside the 8–10 month window. */
function pastPartyDate(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 9)
  return d.toISOString().slice(0, 10)
}

function sampleBooking(over: Record<string, any> = {}) {
  return {
    id: BOOKING_ID,
    booking_ref: 'HH-2026-0001',
    contact_name: 'Sarah Jones',
    contact_email: 'sarah@example.com',
    child_name: 'Mia',
    child_age: 6,
    party_date: pastPartyDate(),
    event_type: 'kid-party',
    status: 'paid_in_full',
    ...over,
  }
}

function sampleContact(over: Record<string, any> = {}) {
  return {
    id: CONTACT_ID,
    email: 'sarah@example.com',
    phone: '+16315551234',
    email_opt_in: true,
    sms_opt_in: true,
    status: 'customer',
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function setup(seed: { bookings: any[]; contacts: any[] }) {
  const fake = makeFakeDb(
    {
      scheduled_reminders: scheduledRemindersSpec(),
      bookings: bookingsSpec,
      contacts: contactsSpec,
    },
    seed
  )
  mockGetSupabase.mockReturnValue(fake.supabase)
  return fake
}

describe('GET /api/cron/birthday-rebooking', () => {
  const originalEnv = process.env
  beforeEach(() => {
    jest.clearAllMocks()
    ;(checkSmsBudget as jest.Mock).mockResolvedValue({ ok: true, sent: 0, cap: 500, remaining: 500 })
    process.env = { ...originalEnv, CRON_SECRET }
  })
  afterAll(() => { process.env = originalEnv })

  it('returns 401 without the cron secret', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('enqueues an email and an SMS reminder for a fully opted-in contact', async () => {
    const fake = setup({ bookings: [sampleBooking()], contacts: [sampleContact()] })

    const res = await GET(makeReq(CRON_SECRET))
    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ scanned: 1, emailQueued: 1, smsQueued: 1 })

    const rows = fake.tables.scheduled_reminders
    expect(rows.map(r => r.reminder_type).sort()).toEqual(['birthday_rebook_email', 'birthday_rebook_sms'])
    // reference_id is the booking_ref — ONE convention for the column, so the
    // sender does not need to guess which kind of key it is holding.
    expect(rows.every(r => r.reference_id === 'HH-2026-0001' && r.reference_type === 'booking')).toBe(true)
    expect(fake.refusals).toHaveLength(0)
  })

  it('finds a contact whose stored address is MIXED CASE', async () => {
    const fake = setup({
      bookings: [sampleBooking({ contact_email: 'sarah@example.com' })],
      contacts: [sampleContact({ email: 'Sarah@Example.COM' })],
    })

    const res = await GET(makeReq(CRON_SECRET))
    expect(res.json()).toMatchObject({ scanned: 1, noContact: 0, emailQueued: 1 })
    expect(fake.tables.scheduled_reminders.length).toBeGreaterThan(0)
  })

  it('excludes opted-out contacts (no email, no SMS)', async () => {
    const fake = setup({
      bookings: [sampleBooking()],
      contacts: [sampleContact({ email_opt_in: false, sms_opt_in: false })],
    })

    const res = await GET(makeReq(CRON_SECRET))
    expect(res.json()).toMatchObject({ emailQueued: 0, smsQueued: 0 })
    expect(fake.tables.scheduled_reminders).toHaveLength(0)
  })

  it('excludes a contact whose status is unsubscribed even if email_opt_in is stale', async () => {
    const fake = setup({
      bookings: [sampleBooking()],
      contacts: [sampleContact({ email_opt_in: true, sms_opt_in: false, status: 'unsubscribed' })],
    })

    await GET(makeReq(CRON_SECRET))
    expect(fake.tables.scheduled_reminders).toHaveLength(0)
  })

  it('does NOT nudge a cancelled party', async () => {
    const fake = setup({
      bookings: [sampleBooking({ status: 'cancelled' })],
      contacts: [sampleContact()],
    })

    const res = await GET(makeReq(CRON_SECRET))
    expect(res.json()).toMatchObject({ scanned: 0 })
    expect(fake.tables.scheduled_reminders).toHaveLength(0)
  })

  it('does not enqueue SMS when the marketing SMS budget is exhausted', async () => {
    ;(checkSmsBudget as jest.Mock).mockResolvedValue({ ok: false, sent: 500, cap: 500, remaining: 0 })
    const fake = setup({
      bookings: [sampleBooking()],
      contacts: [sampleContact({ email_opt_in: false, sms_opt_in: true })],
    })

    const res = await GET(makeReq(CRON_SECRET))
    expect(res.json()).toMatchObject({ smsQueued: 0 })
    expect(fake.tables.scheduled_reminders).toHaveLength(0)
  })

  it('charges the budget in SEGMENTS, not messages — the nudge carries an emoji', async () => {
    setup({ bookings: [sampleBooking()], contacts: [sampleContact()] })

    await GET(makeReq(CRON_SECRET))

    expect(checkSmsBudget).toHaveBeenCalledWith(expect.anything(), expect.any(Number))
    const askedFor = (checkSmsBudget as jest.Mock).mock.calls[0][1]
    expect(askedFor).toBeGreaterThan(1)
    expect(recordSmsSent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ count: askedFor })
    )
  })

  it('a second run enqueues nothing and does NOT charge the budget again', async () => {
    const fake = setup({ bookings: [sampleBooking()], contacts: [sampleContact()] })

    await GET(makeReq(CRON_SECRET))
    const afterFirst = fake.tables.scheduled_reminders.length
    ;(recordSmsSent as jest.Mock).mockClear()

    const res = await GET(makeReq(CRON_SECRET))

    expect(fake.tables.scheduled_reminders).toHaveLength(afterFirst)
    expect(res.json()).toMatchObject({ emailQueued: 0, smsQueued: 0, alreadyQueued: 2 })
    expect(recordSmsSent).not.toHaveBeenCalled()
  })

  it('reports a failed contacts read separately from "no such contact" (rule 12)', async () => {
    const fake = setup({ bookings: [sampleBooking()], contacts: [sampleContact()] })
    fake.failReads('contacts')

    const res = await GET(makeReq(CRON_SECRET))
    expect(res.json()).toMatchObject({ lookupFailed: 1, noContact: 0, emailQueued: 0 })
  })
})
