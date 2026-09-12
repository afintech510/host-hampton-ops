/**
 * Tests for GET /api/cron/send-reminders.
 *
 * This route had no test at all, which is part of why it could mark a reminder
 * `sent` over a send that never happened — for a missing RESEND_API_KEY, for a
 * provider rejection, for a booking it could not read, and for a reminder type
 * that matched no branch. Every one of those is pinned below, in the only form
 * that means anything: the row must NOT say 'sent'.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }),
  },
}))

const mockResendSend = jest.fn()
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockResendSend } })),
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))

const mockSendSMSVia = jest.fn()
jest.mock('@/lib/sms', () => ({ sendSMSVia: (...a: any[]) => mockSendSMSVia(...a) }))

const mockSendCheckinLinkSms = jest.fn()
const mockHasExplicitSmsOptOut = jest.fn()
jest.mock('@/lib/checkinLink', () => ({
  sendCheckinLinkSms: (...a: any[]) => mockSendCheckinLinkSms(...a),
  hasExplicitSmsOptOut: (...a: any[]) => mockHasExplicitSmsOptOut(...a),
}))

jest.mock('@/lib/marketing/graph', () => ({ writeLedger: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/portalAuth', () => ({
  generatePortalToken: () => ({ token: 'raw', hash: 'hash', expiresAt: new Date('2027-01-01') }),
  buildPortalUrl: () => 'https://www.hosthampton.com/portal/x',
}))

import { GET } from '@/app/api/cron/send-reminders/route'
import { makeFakeDb, scheduledRemindersSpec, type TableSpec } from '../helpers/fakeReminderDb'

const CRON_SECRET = 'test-cron-secret'
const CONTACT_ID = '11111111-1111-4111-8111-111111111111'
const EVENT_ID = '22222222-2222-4222-8222-222222222222'
const BOOKING_ID = '33333333-3333-4333-8333-333333333333'
const REMINDER_ID = 'aaaaaaaa-0000-4000-8000-000000000001'

function makeReq(secret?: string, params: Record<string, string> = {}) {
  const headers = new Map<string, string>()
  if (secret) headers.set('x-cron-secret', secret)
  return {
    headers: { get: (k: string) => headers.get(k) ?? null },
    nextUrl: { searchParams: { get: (k: string) => params[k] ?? null } },
  } as any
}

const contactsSpec: TableSpec = {
  columns: {
    id: 'uuid', email: 'text', phone: 'text', first_name: 'text',
    sms_opt_in: 'bool', email_opt_in: 'bool', status: 'text', created_at: 'timestamptz',
  },
}
const bookingsSpec: TableSpec = {
  columns: {
    id: 'uuid', booking_ref: 'text', party_date: 'text', party_time: 'text',
    package_type: 'text', balance_due_cents: 'int', contact_name: 'text',
    contact_phone: 'text', child_name: 'text', child_age: 'int',
    photo_gallery_url: 'text', checkin_status: 'text', status: 'text',
  },
}
const eventsSpec: TableSpec = {
  columns: { id: 'uuid', title: 'text', event_date: 'text', event_time: 'text', location: 'text' },
}
const portalTokensSpec: TableSpec = {
  columns: { id: 'uuid', booking_id: 'uuid', token_hash: 'text', expires_at: 'timestamptz', created_at: 'timestamptz' },
}

function contact(over: Record<string, any> = {}) {
  return {
    id: CONTACT_ID, email: 'parent@example.com', phone: '+16314008080', first_name: 'Sam',
    sms_opt_in: true, email_opt_in: true, status: 'customer', created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function reminder(over: Record<string, any> = {}) {
  return {
    id: REMINDER_ID,
    contact_id: CONTACT_ID,
    reminder_type: 'booking_email_7day',
    reference_type: 'booking',
    reference_id: 'HH-2026-0001',
    scheduled_for: '2000-01-01T00:00:00.000Z', // long overdue, sorts first
    status: 'pending',
    channel: 'email',
    attempts: 0,
    ...over,
  }
}

function booking(over: Record<string, any> = {}) {
  return {
    id: BOOKING_ID, booking_ref: 'HH-2026-0001', party_date: '2026-12-01', party_time: '2:00 PM',
    package_type: 'Deluxe', balance_due_cents: 25000, contact_name: 'Sam Jones',
    contact_phone: '+16314008080', child_name: 'Mia', status: 'approved', checkin_status: 'pending',
    ...over,
  }
}

/**
 * The join `select('*, contacts(...)')` is what the route reads. The fake store
 * is relational-flat, so the contact is attached the way PostgREST would.
 */
function setup(opts: { reminders: any[]; contacts?: any[]; bookings?: any[]; events?: any[] }) {
  const contacts = opts.contacts ?? [contact()]
  const rows = opts.reminders.map(r => ({
    ...r,
    contacts: contacts.find(c => c.id === r.contact_id) ?? null,
  }))
  const fake = makeFakeDb(
    {
      scheduled_reminders: { ...scheduledRemindersSpec(), columns: { ...scheduledRemindersSpec().columns, contacts: 'text' } },
      contacts: contactsSpec,
      bookings: bookingsSpec,
      events: eventsSpec,
      portal_tokens: portalTokensSpec,
    },
    {
      scheduled_reminders: rows,
      contacts,
      bookings: opts.bookings ?? [booking()],
      events: opts.events ?? [{ id: EVENT_ID, title: 'Make Your Own Squishy', event_date: '2026-09-25', event_time: '6:00 PM', location: 'Speonk' }],
    }
  )
  mockGetSupabase.mockReturnValue(fake.supabase)
  return fake
}

const row = (f: ReturnType<typeof setup>) => f.tables.scheduled_reminders[0]

describe('GET /api/cron/send-reminders', () => {
  const originalEnv = process.env
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, CRON_SECRET, RESEND_API_KEY: 're_test', TWILIO_ACCOUNT_SID: 'AC_test' }
    mockResendSend.mockResolvedValue({ data: { id: 'resend-1' }, error: null })
    mockSendSMSVia.mockResolvedValue('SM123')
    mockHasExplicitSmsOptOut.mockResolvedValue(false)
    mockSendCheckinLinkSms.mockResolvedValue({ sent: true, url: 'https://x/checkin/y' })
  })
  afterAll(() => { process.env = originalEnv })

  it('returns 401 without the cron secret', async () => {
    expect((await GET(makeReq())).status).toBe(401)
  })

  /* ── rule 10: three different runs must not look the same ──────────────── */

  it('says "no reminders due" distinctly from a run that could not read', async () => {
    setup({ reminders: [] })
    const res = await GET(makeReq(CRON_SECRET))
    expect(res.json()).toMatchObject({ ok: true, due: 0, message: 'no reminders due' })
    expect(res.json().configured).toEqual({ resend: true, sms: true })
  })

  it('500s when the queue cannot be read, rather than reporting a quiet success', async () => {
    const fake = setup({ reminders: [reminder()] })
    fake.failReads('scheduled_reminders')
    const res = await GET(makeReq(CRON_SECRET))
    expect(res.status).toBe(500)
  })

  it('does NOT mark a reminder sent when the mailer is unconfigured', async () => {
    delete process.env.RESEND_API_KEY
    const fake = setup({ reminders: [reminder()] })

    const res = await GET(makeReq(CRON_SECRET))

    expect(mockResendSend).not.toHaveBeenCalled()
    expect(row(fake).status).toBe('pending') // retryable, not consumed
    expect(row(fake).last_error).toContain('RESEND_API_KEY')
    expect(res.json()).toMatchObject({ retry: 1, delivered: 0, configured: { resend: false } })
  })

  /* ── the happy path, so the guardrails are not just refusing everything ── */

  it('sends a transactional booking reminder and records the provider id', async () => {
    const fake = setup({ reminders: [reminder()] })

    const res = await GET(makeReq(CRON_SECRET))

    expect(mockResendSend).toHaveBeenCalledTimes(1)
    expect(mockResendSend.mock.calls[0][0].to).toBe('parent@example.com')
    expect(row(fake).status).toBe('sent')
    expect(row(fake).last_outcome).toBe('resend:resend-1')
    expect(row(fake).sent_at).toBeTruthy()
    expect(res.json()).toMatchObject({ delivered: 1 })
  })

  /* ── rule 10's expensive half: never claim a send that did not happen ──── */

  it('does NOT mark sent when Resend rejects the message', async () => {
    mockResendSend.mockResolvedValue({ data: null, error: { message: 'rate limited' } })
    const fake = setup({ reminders: [reminder()] })

    const res = await GET(makeReq(CRON_SECRET))

    expect(row(fake).status).toBe('pending')
    expect(row(fake).attempts).toBe(1)
    expect(row(fake).last_error).toContain('rate limited')
    expect(res.json()).toMatchObject({ delivered: 0, retry: 1 })
  })

  it('does NOT mark sent when the SMS provider returns null', async () => {
    mockSendSMSVia.mockResolvedValue(null)
    const fake = setup({ reminders: [reminder({ channel: 'sms', reminder_type: 'booking_sms_1day' })] })

    await GET(makeReq(CRON_SECRET))

    expect(row(fake).status).toBe('pending')
    expect(row(fake).last_error).toContain('rejected')
  })

  it('does NOT mark sent for a reminder type with no template', async () => {
    const fake = setup({ reminders: [reminder({ reminder_type: 'event_email_3day', reference_type: 'booking' })] })

    const res = await GET(makeReq(CRON_SECRET))

    expect(mockResendSend).not.toHaveBeenCalled()
    expect(row(fake).status).toBe('failed')
    expect(row(fake).last_outcome).toContain('no email template')
    expect(res.json()).toMatchObject({ failed: 1, delivered: 0 })
  })

  it('does NOT mark sent when the check-in link could not go out', async () => {
    mockSendCheckinLinkSms.mockResolvedValue({ sent: false, url: null, reason: 'SMS provider rejected the send' })
    const fake = setup({ reminders: [reminder({ channel: 'sms', reminder_type: 'checkin_link_36hr' })] })

    await GET(makeReq(CRON_SECRET))

    expect(row(fake).status).toBe('pending')
    expect(row(fake).last_error).toContain('checkin link')
  })

  it('a failed booking read is RETRIED, not recorded as a permanent failure (rule 12)', async () => {
    const fake = setup({ reminders: [reminder()] })
    fake.failReads('bookings')

    await GET(makeReq(CRON_SECRET))

    expect(mockResendSend).not.toHaveBeenCalled()
    expect(row(fake).status).toBe('pending')
    expect(row(fake).last_error).toContain('booking read failed')
  })

  /* ── consent, read at SEND time ─────────────────────────────────────────── */

  it('does not text a contact who is not opted in, and SAYS so', async () => {
    const fake = setup({
      reminders: [reminder({ channel: 'sms', reminder_type: 'booking_sms_1day' })],
      contacts: [contact({ sms_opt_in: false })],
    })

    const res = await GET(makeReq(CRON_SECRET))

    expect(mockSendSMSVia).not.toHaveBeenCalled()
    expect(row(fake).status).toBe('cancelled')
    expect(row(fake).last_outcome).toContain('opted_out')
    expect(res.json().reasons[0]).toContain('opted_out')
  })

  it('refuses a MARKETING email to somebody who unsubscribed after it was enqueued', async () => {
    const fake = setup({
      reminders: [reminder({ reminder_type: 'birthday_rebook_email' })],
      contacts: [contact({ email_opt_in: false })],
    })

    await GET(makeReq(CRON_SECRET))

    expect(mockResendSend).not.toHaveBeenCalled()
    expect(row(fake).status).toBe('cancelled')
    expect(row(fake).last_outcome).toContain('email_opt_in')
  })

  it("refuses a marketing email on contacts.status = 'unsubscribed' even if the flag is stale", async () => {
    const fake = setup({
      reminders: [reminder({ reminder_type: 'birthday_rebook_email' })],
      contacts: [contact({ email_opt_in: true, status: 'unsubscribed' })],
    })

    await GET(makeReq(CRON_SECRET))

    expect(mockResendSend).not.toHaveBeenCalled()
    expect(row(fake).last_outcome).toContain('unsubscribed')
  })

  it('STILL sends a TRANSACTIONAL reminder to a contact with email_opt_in false', async () => {
    // The party is booked and paid for. Marketing consent is not what governs
    // a message about it — and treating it as if it did would silently disable
    // the feature for most customers.
    const fake = setup({
      reminders: [reminder({ reminder_type: 'booking_email_1day' })],
      contacts: [contact({ email_opt_in: false })],
    })

    await GET(makeReq(CRON_SECRET))

    expect(mockResendSend).toHaveBeenCalledTimes(1)
    expect(row(fake).status).toBe('sent')
  })

  it('honours an explicit STOP on the transactional check-in text', async () => {
    mockHasExplicitSmsOptOut.mockResolvedValue(true)
    const fake = setup({ reminders: [reminder({ channel: 'sms', reminder_type: 'checkin_link_36hr' })] })

    await GET(makeReq(CRON_SECRET))

    expect(mockSendCheckinLinkSms).not.toHaveBeenCalled()
    expect(row(fake).status).toBe('cancelled')
    expect(row(fake).last_outcome).toContain('STOP')
  })

  /* ── other guardrails ───────────────────────────────────────────────────── */

  it('does not chase a balance that was paid after the reminder was enqueued', async () => {
    const fake = setup({
      reminders: [reminder({ reminder_type: 'party_balance_t1' })],
      bookings: [booking({ balance_due_cents: 0 })],
    })

    await GET(makeReq(CRON_SECRET))

    expect(mockResendSend).not.toHaveBeenCalled()
    expect(row(fake).status).toBe('cancelled')
    expect(row(fake).last_outcome).toContain('balance_paid')
  })

  it('does not send a balance reminder whose pay link could not be minted', async () => {
    // The whole point of this email is the pay link. A token that failed to
    // store is a link that 404s, so the email must not go out claiming otherwise.
    const fake = setup({ reminders: [reminder({ reminder_type: 'party_balance_t1' })] })
    fake.failWrites('portal_tokens')

    const res = await GET(makeReq(CRON_SECRET))

    expect(mockResendSend).not.toHaveBeenCalled()
    expect(row(fake).status).toBe('pending')
    expect(row(fake).last_error).toContain('portal token')
    expect(res.json()).toMatchObject({ delivered: 0, retry: 1 })
  })

  it('skips a check-in text for a party that is already checked in', async () => {
    const fake = setup({
      reminders: [reminder({ channel: 'sms', reminder_type: 'checkin_link_dayof' })],
      bookings: [booking({ checkin_status: 'complete' })],
    })

    await GET(makeReq(CRON_SECRET))

    expect(mockSendCheckinLinkSms).not.toHaveBeenCalled()
    expect(row(fake).last_outcome).toBe('checkin_complete')
  })

  it('skips a check-in text for a cancelled booking', async () => {
    const fake = setup({
      reminders: [reminder({ channel: 'sms', reminder_type: 'checkin_link_dayof' })],
      bookings: [booking({ status: 'cancelled' })],
    })

    await GET(makeReq(CRON_SECRET))

    expect(mockSendCheckinLinkSms).not.toHaveBeenCalled()
    expect(row(fake).last_outcome).toBe('booking_cancelled')
  })

  /* ── the claim ──────────────────────────────────────────────────────────── */

  it('two overlapping ticks send exactly ONE email', async () => {
    setup({ reminders: [reminder()] })

    await Promise.all([GET(makeReq(CRON_SECRET)), GET(makeReq(CRON_SECRET))])

    expect(mockResendSend).toHaveBeenCalledTimes(1)
  })

  it('a second run after a successful send does nothing', async () => {
    setup({ reminders: [reminder()] })
    await GET(makeReq(CRON_SECRET))
    mockResendSend.mockClear()

    const res = await GET(makeReq(CRON_SECRET))
    expect(mockResendSend).not.toHaveBeenCalled()
    expect(res.json()).toMatchObject({ due: 0 })
  })

  /* ── the bounded manual run ─────────────────────────────────────────────── */

  it('rejects an out-of-range ?limit rather than silently clamping', async () => {
    setup({ reminders: [] })
    expect((await GET(makeReq(CRON_SECRET, { limit: '0' }))).status).toBe(400)
    expect((await GET(makeReq(CRON_SECRET, { limit: '999' }))).status).toBe(400)
    expect((await GET(makeReq(CRON_SECRET, { limit: 'all' }))).status).toBe(400)
  })

  it('?limit=1 reads exactly one row, oldest first', async () => {
    const fake = setup({
      reminders: [
        reminder({ id: 'aaaaaaaa-0000-4000-8000-000000000002', scheduled_for: '2026-09-01T00:00:00.000Z', reminder_type: 'booking_email_1day' }),
        reminder({ scheduled_for: '2000-01-01T00:00:00.000Z' }),
      ],
    })

    const res = await GET(makeReq(CRON_SECRET, { limit: '1' }))

    expect(res.json()).toMatchObject({ due: 1, delivered: 1 })
    const sent = fake.tables.scheduled_reminders.filter(r => r.status === 'sent')
    expect(sent).toHaveLength(1)
    expect(sent[0].scheduled_for).toBe('2000-01-01T00:00:00.000Z')
  })
})
