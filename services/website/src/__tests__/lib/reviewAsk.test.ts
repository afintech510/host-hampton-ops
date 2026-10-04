/**
 * The past-client review ask (migration 061): who is asked, in what order, and
 * that asking is once per person — plus the enqueue route against a fake that
 * carries the real CHECK constraints and unique index.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }),
  },
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))

const mockWriteLedger = jest.fn().mockResolvedValue(undefined)
jest.mock('@/lib/marketing/graph', () => ({ writeLedger: (...a: any[]) => mockWriteLedger(...a) }))

const mockCheckSmsBudget = jest.fn()
const mockRecordSmsSent = jest.fn().mockResolvedValue(0)
jest.mock('@/lib/marketing/budget', () => ({
  checkSmsBudget: (...a: any[]) => mockCheckSmsBudget(...a),
  recordSmsSent: (...a: any[]) => mockRecordSmsSent(...a),
}))

import { GET } from '@/app/api/cron/review-asks/route'
import { planReviewAsks, isInternalAddress, askTime, type AskContact, type ReviewAskInput } from '@/lib/reviewAsk'
import { smsReviewAsk } from '@/lib/sms-templates'
import { smsSegmentInfo } from '@/lib/smsSegments'
import { makeFakeDb, scheduledRemindersSpec, type TableSpec } from '../helpers/fakeReminderDb'

const NOW = new Date('2026-10-05T14:30:00Z') // 10:30am EDT

let n = 0
function uuid(): string {
  n++
  return `00000000-0000-4000-9000-${n.toString(16).padStart(12, '0')}`
}

function person(over: Partial<AskContact> = {}): AskContact {
  return {
    id: uuid(),
    email: `p${n}@example.com`,
    phone: `+1631400${String(1000 + n).slice(-4)}`,
    first_name: 'Sam',
    status: 'customer',
    email_opt_in: true,
    sms_opt_in: true,
    created_at: '2026-03-05T00:00:00Z',
    lifetime_value: 0,
    ...over,
  }
}

function input(over: Partial<ReviewAskInput> = {}): ReviewAskInput {
  return { contacts: [], pastBookings: [], pastTickets: [], existing: [], ...over }
}

const plan = (i: ReviewAskInput, perDay = 40) => planReviewAsks(i, { perDay, now: NOW })

describe('planReviewAsks — who counts as a past client', () => {
  it('asks a 2025 customer, a past party client and a past ticket buyer, and not a lead', () => {
    const imported = person()
    const party = person({ status: 'lead' })
    const ticket = person({ status: 'lead' })
    const lead = person({ status: 'lead' })
    const p = plan(input({
      contacts: [imported, party, ticket, lead],
      pastBookings: [{ contact_email: party.email!.toUpperCase(), party_date: '2026-09-20' }],
      pastTickets: [{ customer_email: ticket.email, event_date: '2026-08-01' }],
    }))
    expect(p.email.map(x => x.contact.id).sort()).toEqual([imported.id, party.id, ticket.id].sort())
    expect(p.counts.pastClients).toBe(3)
  })

  it('never asks our own addresses', () => {
    expect(isInternalAddress('Allie@HostHampton.com')).toBe(true)
    expect(isInternalAddress('adam@easternbuilding.supply')).toBe(true)
    expect(isInternalAddress('hosthampton295@gmail.com')).toBe(true)
    expect(isInternalAddress('someone@gmail.com')).toBe(false)
    const p = plan(input({ contacts: [person({ email: 'info@hosthampton.com' })] }))
    expect(p.email).toHaveLength(0)
    expect(p.counts.internalExcluded).toBe(1)
  })

  it('treats two rows with one address as ONE person — the oldest row', () => {
    const newer = person({ email: 'Jen@Example.com', created_at: '2026-06-01T00:00:00Z' })
    const older = person({ email: 'jen@example.com', created_at: '2026-03-05T00:00:00Z' })
    const p = plan(input({ contacts: [newer, older] }))
    expect(p.email.map(x => x.contact.id)).toEqual([older.id])
    expect(p.counts.pastClients).toBe(1)
  })
})

describe('planReviewAsks — order and pace', () => {
  it('most recent client first, then the biggest spenders, capped at perDay', () => {
    const old = person({ lifetime_value: 5000 })
    const recent = person({ status: 'lead' })
    const mid = person({ status: 'lead' })
    const small = person({ lifetime_value: 100 })
    const p = plan(input({
      contacts: [small, old, mid, recent],
      pastBookings: [
        { contact_email: recent.email, party_date: '2026-10-03' },
        { contact_email: mid.email, party_date: '2026-06-01' },
      ],
    }), 3)
    expect(p.email.map(x => x.contact.id)).toEqual([recent.id, mid.id, old.id])
    expect(p.counts.emailRemaining).toBe(4)
  })
})

describe('planReviewAsks — once per person', () => {
  it('a prior ask in ANY status — even cancelled — is never re-queued', () => {
    const a = person()
    const p = plan(input({
      contacts: [a],
      existing: [{ contact_id: a.id, reminder_type: 'review_ask_email', status: 'cancelled', scheduled_for: '2026-10-01T15:00:00Z' }],
    }))
    expect(p.email).toHaveLength(0)
    expect(p.counts.emailAlreadyAsked).toBe(1)
  })

  it('a party thank-you email IS the email ask; a cancelled one is not', () => {
    const thanked = person()
    const cancelled = person()
    const p = plan(input({
      contacts: [thanked, cancelled],
      existing: [
        { contact_id: thanked.id, reminder_type: 'party_thank_you_t1', status: 'pending', scheduled_for: '2026-10-06T14:00:00Z' },
        { contact_id: cancelled.id, reminder_type: 'party_thank_you_t1', status: 'cancelled', scheduled_for: '2026-09-01T14:00:00Z' },
      ],
    }))
    expect(p.email.map(x => x.contact.id)).toEqual([cancelled.id])
  })

  it('a duplicate row of an already-asked person is not asked through the other row', () => {
    const older = person({ email: 'kim@example.com', created_at: '2026-03-05T00:00:00Z' })
    const newer = person({ email: 'KIM@example.com', created_at: '2026-07-01T00:00:00Z' })
    const p = plan(input({
      contacts: [older, newer],
      existing: [{ contact_id: newer.id, reminder_type: 'review_ask_email', status: 'sent', scheduled_for: '2026-09-01T15:00:00Z' }],
    }))
    expect(p.email).toHaveLength(0)
  })
})

describe('planReviewAsks — consent', () => {
  it('no email without email_opt_in === true (a NULL is not a yes)', () => {
    const p = plan(input({ contacts: [person({ email_opt_in: null }), person({ email_opt_in: false })] }))
    expect(p.email).toHaveLength(0)
    expect(p.counts.emailNoConsent).toBe(2)
  })

  it('no text without sms_opt_in === true or without a usable phone', () => {
    const p = plan(input({
      contacts: [
        person({ email_opt_in: false, sms_opt_in: null }),
        person({ email_opt_in: false, phone: '12345' }),
      ],
    }))
    expect(p.sms).toHaveLength(0)
    expect(p.counts.smsNoConsent).toBe(2)
  })

  it('an unsubscribed contact is asked on neither channel', () => {
    const p = plan(input({ contacts: [person({ status: 'unsubscribed' })], pastTickets: [] }))
    // not 'customer' and no booking → not even a past client; with a booking:
    const u = person({ status: 'unsubscribed' })
    const p2 = plan(input({ contacts: [u], pastBookings: [{ contact_email: u.email, party_date: '2026-09-01' }] }))
    expect(p.email).toHaveLength(0)
    expect(p2.email).toHaveLength(0)
    expect(p2.sms).toHaveLength(0)
  })
})

describe('planReviewAsks — the text follows the email', () => {
  it('waits while the email is unsent, and for 3 days after it went', () => {
    const notYetEmailed = person()
    const queued = person()
    const sentYesterday = person()
    const sentLastWeek = person()
    const p = plan(input({
      contacts: [notYetEmailed, queued, sentYesterday, sentLastWeek],
      existing: [
        { contact_id: queued.id, reminder_type: 'review_ask_email', status: 'pending', scheduled_for: '2026-10-05T15:00:00Z' },
        { contact_id: sentYesterday.id, reminder_type: 'review_ask_email', status: 'sent', scheduled_for: '2026-10-04T15:00:00Z' },
        { contact_id: sentLastWeek.id, reminder_type: 'review_ask_email', status: 'sent', scheduled_for: '2026-09-28T15:00:00Z' },
      ],
    }))
    expect(p.sms.map(x => x.contact.id)).toEqual([sentLastWeek.id])
    expect(p.counts.smsWaitingForEmail).toBe(3)
  })

  it('texts straight away someone we may text but not email', () => {
    const smsOnly = person({ email_opt_in: false })
    const p = plan(input({ contacts: [smsOnly] }))
    expect(p.sms.map(x => x.contact.id)).toEqual([smsOnly.id])
  })

  it('one text per household phone, however it is spelled', () => {
    const a = person({ email_opt_in: false, phone: '(631) 555-0101' })
    const b = person({ email_opt_in: false, phone: '+16315550101' })
    const p = plan(input({ contacts: [a, b] }))
    expect(p.sms).toHaveLength(1)
  })

  it('a number already texted for review (from another row) is not texted again', () => {
    const a = person({ email_opt_in: false, phone: '631-555-0102' })
    const other = person({ status: 'lead', email_opt_in: false, phone: '6315550102' })
    const p = plan(input({
      contacts: [a, other],
      existing: [{ contact_id: other.id, reminder_type: 'review_request_sms', status: 'pending', scheduled_for: '2026-10-10T18:00:00Z' }],
    }))
    expect(p.sms).toHaveLength(0)
    expect(p.counts.smsAlreadyAsked).toBe(1)
  })
})

describe('the text itself', () => {
  it('is GSM-7 and two segments even for a long first name', () => {
    const info = smsSegmentInfo(smsReviewAsk({ firstName: 'Christopher-Alexander' }))
    expect(info.encoding).toBe('GSM-7')
    expect(info.segments).toBe(2)
    expect(smsReviewAsk({ firstName: 'Sam' })).toContain('Reply STOP')
  })
})

describe('askTime', () => {
  it('is 11am ET today when that is still ahead, else now', () => {
    expect(askTime(NOW, 11).toISOString()).toBe('2026-10-05T15:00:00.000Z')
    const late = new Date('2026-10-05T20:00:00Z')
    expect(askTime(late, 11).getTime()).toBe(late.getTime())
  })
})

/* ── the route ─────────────────────────────────────────────────────────────── */

const contactsSpec: TableSpec = {
  columns: {
    id: 'uuid', email: 'text', phone: 'text', first_name: 'text', status: 'text',
    email_opt_in: 'bool', sms_opt_in: 'bool', created_at: 'timestamptz', lifetime_value: 'int',
  },
}

function setup(contacts: AskContact[], existing: any[] = []) {
  const fake = makeFakeDb(
    {
      scheduled_reminders: scheduledRemindersSpec(),
      contacts: contactsSpec,
      bookings: { columns: { contact_email: 'text', party_date: 'text', status: 'text' } },
      events: { columns: { id: 'uuid', event_date: 'text' } },
      event_tickets: { columns: { customer_email: 'text', event_id: 'uuid', status: 'text' } },
    },
    { contacts, scheduled_reminders: existing }
  )
  mockGetSupabase.mockReturnValue(fake.supabase)
  return fake
}

function req(params: Record<string, string> = {}, secret = 'test-cron-secret') {
  return {
    headers: { get: (k: string) => (k === 'x-cron-secret' ? secret : null) },
    nextUrl: { searchParams: { get: (k: string) => params[k] ?? null } },
  } as any
}

describe('GET /api/cron/review-asks', () => {
  const originalEnv = process.env
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] })
    jest.setSystemTime(NOW)
  })
  afterAll(() => { jest.useRealTimers(); process.env = originalEnv })
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, CRON_SECRET: 'test-cron-secret' }
    mockCheckSmsBudget.mockResolvedValue({ ok: true, sent: 0, cap: 500, remaining: 500 })
  })

  it('401s without the secret', async () => {
    expect((await GET(req({}, 'wrong'))).status).toBe(401)
  })

  it('400s on an out-of-range perDay', async () => {
    setup([])
    expect((await GET(req({ perDay: '0' }))).status).toBe(400)
    expect((await GET(req({ perDay: '101' }))).status).toBe(400)
  })

  it('dryRun reports and writes NOTHING', async () => {
    const fake = setup([person(), person({ email_opt_in: false })])
    const res = await GET(req({ dryRun: '1' }))
    expect(res.json()).toMatchObject({ dryRun: true, wouldQueue: { email: 1, sms: 1 } })
    expect(fake.tables.scheduled_reminders).toHaveLength(0)
    expect(mockRecordSmsSent).not.toHaveBeenCalled()
    expect(mockWriteLedger).not.toHaveBeenCalled()
  })

  it('queues rows the real CHECKs accept, and a re-run queues nothing new', async () => {
    const fake = setup([person(), person({ email_opt_in: false })])
    const first = await GET(req())
    expect(fake.refusals).toEqual([])
    expect(first.json()).toMatchObject({ ok: true, emailQueued: 1, smsQueued: 1 })
    expect(fake.tables.scheduled_reminders.map(r => [r.reminder_type, r.reference_type, r.reference_id]).sort()).toEqual([
      ['review_ask_email', 'contact', 'review-ask'],
      ['review_ask_sms', 'contact', 'review-ask'],
    ])
    expect(mockRecordSmsSent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ count: 2 }))

    const second = await GET(req())
    expect(second.json()).toMatchObject({ emailQueued: 0, smsQueued: 0 })
    expect(fake.tables.scheduled_reminders).toHaveLength(2)
  })

  it('reads past the 1000-row PostgREST page', async () => {
    const many = Array.from({ length: 1005 }, () => person({ email_opt_in: false, sms_opt_in: false }))
    const last = person() // sorts after every other id
    setup([...many, last])
    const res = await GET(req({ dryRun: '1' }))
    expect(res.json().counts.pastClients).toBe(1006)
    expect(res.json().wouldQueue.email).toBe(1)
  })

  it('stops texting at the SMS budget and still queues the email', async () => {
    mockCheckSmsBudget.mockResolvedValue({ ok: false, sent: 499, cap: 500, remaining: 1 })
    const fake = setup([person(), person({ email_opt_in: false })])
    const res = await GET(req())
    expect(res.json()).toMatchObject({ emailQueued: 1, smsQueued: 0 })
    expect(res.json().smsBudgetStop).toContain('cap')
    expect(fake.tables.scheduled_reminders.map(r => r.reminder_type)).toEqual(['review_ask_email'])
  })

  it('a failed audience read is a 503 that queues nothing (rule 12)', async () => {
    const fake = setup([person()])
    fake.failReads('contacts')
    const res = await GET(req())
    expect(res.status).toBe(503)
    expect(fake.tables.scheduled_reminders).toHaveLength(0)
  })
})
