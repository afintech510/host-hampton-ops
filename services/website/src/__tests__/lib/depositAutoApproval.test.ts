/**
 * A deposit that lands approves the booking (Adam, 2026-10-12).
 *
 * `approved` used to be written only by the admin "Approve Booking" button, and
 * `/api/cron/booking-locks` locks `approved` bookings and nothing else — so a
 * paid-but-unapproved booking never locked. These tests drive the Payment Link
 * path (`recordPlanPayment`) and pin the shared helper; the card paths are driven
 * in `webhookMoneyBranches.test.ts`.
 *
 * Also pinned, because auto-approval removes the button that used to do it: the
 * calendar entry is created on this path, once, and only for a dated booking.
 */

import type Stripe from 'stripe'
import fs from 'fs'
import path from 'path'

const mockCreateEvent = jest.fn()
jest.mock('@/lib/googleCalendar', () => ({
  createCalendarEvent: (...a: unknown[]) => mockCreateEvent(...a),
  addMinutes: (t: string, m: number) => {
    const [h, mi] = t.split(':').map(Number)
    const total = h * 60 + mi + m
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  },
}))
jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ from: () => ({}) }) }))

import { recordPlanPayment, type PlanPayTarget } from '@/lib/planPayment'
import { DEPOSIT_APPROVER, depositApprovalFields } from '@/lib/depositApproval'
import { makePlanDb, writesTo, type Result } from '../mocks/planDb'

const BOOKING = {
  id: 'bk-1', booking_ref: 'HH-2026-TEST', status: 'quoted', party_type: 'in_studio_theme', event_type: null,
  package_type: 'Glow Party', invoice_number: '444124-000116', contact_name: 'Test Person',
  contact_email: 'adam@easternbuilding.supply', contact_phone: '+16314008080', party_date: '2026-10-03',
  party_time: '11:00', guest_count_approx: 10, child_name: null, child_age: null, party_tags: null, notes: null,
  total_cents: 100000, deposit_amount: 25000, balance_due_cents: 75000, created_at: null,
}
const LINE_ITEMS = [
  { name: 'Party Package', category: 'package', quantity: 1, unit_price_cents: 100000, price_type: 'flat', guest_multiplied: false, sort_order: 0, is_featured: true },
]
const session = (over: Partial<Stripe.Checkout.Session> = {}) =>
  ({ id: 'cs_test_1', amount_total: 25750, payment_intent: 'pi_1', metadata: {}, ...over }) as Stripe.Checkout.Session
const target = (over: Partial<PlanPayTarget> = {}): PlanPayTarget => ({
  payLinkId: 'row-1', bookingRef: 'HH-2026-TEST', purpose: 'deposit', expectedAmountCents: 25000,
  tipCents: 0, feeCents: 750, fromMetadataOnly: false, ...over,
})

function db(opts: { booking?: Record<string, unknown>; after?: unknown[]; before?: unknown[]; eventId?: string | null; calReadError?: boolean } = {}) {
  const calRead: Result = opts.calReadError
    ? { data: null, error: { message: 'timeout' } }
    : { data: { google_calendar_event_id: opts.eventId ?? null }, error: null }
  return makePlanDb({
    // invoice read, balance update, status update, calendar-id read, calendar-id store
    bookings: [
      { data: { ...BOOKING, ...(opts.booking ?? {}) }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      calRead,
      { data: null, error: null },
    ],
    booking_line_items: [{ data: LINE_ITEMS, error: null }],
    pricing_items: [{ data: [], error: null }],
    plan_content: [{ data: [], error: null }],
    booking_payments: [
      { data: opts.before ?? [], error: null },
      { data: null, error: null },
      { data: opts.after ?? [{ payment_type: 'deposit', amount_cents: 25000 }], error: null },
    ],
    booking_pay_links: [{ data: null, error: null }],
    booking_modifications: [{ data: null, error: null }],
    financial_transactions: [{ data: null, error: null }],
    marketing_ledger: [{ data: null, error: null }],
  })
}

const bookingUpdates = (d: ReturnType<typeof db>) =>
  writesTo(d, 'bookings', 'update').map(w => w.payload as Record<string, unknown>)

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateEvent.mockResolvedValue('evt_1')
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('the shared helper', () => {
  it('writes the same three columns the admin button writes, with a machine actor', () => {
    const f = depositApprovalFields(new Date('2026-10-12T12:00:00Z'))
    expect(f).toEqual({ status: 'approved', approved_at: '2026-10-12T12:00:00.000Z', approved_by: 'system:deposit' })
    expect(DEPOSIT_APPROVER).toBe('system:deposit')
  })
})

describe('a deposit through the Payment Link path', () => {
  it('moves the booking to approved, stamped system:deposit — not deposit_paid', async () => {
    const d = db()
    const res = await recordPlanPayment(target(), session(), d as never)
    expect(res.ok).toBe(true)
    const status = bookingUpdates(d)[1]
    expect(status.status).toBe('approved')
    expect(status.approved_by).toBe('system:deposit')
    expect(typeof status.approved_at).toBe('string')
    expect(status.status).not.toBe('deposit_paid')
  })

  it('creates the calendar block the Approve button used to make, and stores its id', async () => {
    const d = db()
    await recordPlanPayment(target(), session(), d as never)
    expect(mockCreateEvent).toHaveBeenCalledTimes(1)
    expect(mockCreateEvent.mock.calls[0][0]).toMatchObject({
      startDate: '2026-10-03', startTime: '11:00', endTime: '13:00',
    })
    expect(bookingUpdates(d).some(u => u.google_calendar_event_id === 'evt_1')).toBe(true)
  })

  it('does not double-book the room when the booking already has an event', async () => {
    const d = db({ eventId: 'evt_existing' })
    await recordPlanPayment(target(), session(), d as never)
    expect(mockCreateEvent).not.toHaveBeenCalled()
  })

  it('does not create an event when it cannot tell whether one exists', async () => {
    const d = db({ calReadError: true })
    await recordPlanPayment(target(), session(), d as never)
    expect(mockCreateEvent).not.toHaveBeenCalled()
  })

  it('uses the rental window for a studio rental, not a two-hour party block', async () => {
    const d = db({ booking: { party_type: 'studio_rental', event_type: 'studio-rental', party_time: '09:00', party_tags: { rental_end_time: '21:00' } } })
    await recordPlanPayment(target(), session(), d as never)
    expect(mockCreateEvent.mock.calls[0][0]).toMatchObject({ startTime: '09:00', endTime: '21:00' })
    expect(mockCreateEvent.mock.calls[0][0].summary).toContain('STUDIO RENTAL')
  })

  it('a calendar failure never fails the payment', async () => {
    mockCreateEvent.mockRejectedValue(new Error('google down'))
    const d = db()
    const res = await recordPlanPayment(target(), session(), d as never)
    expect(res.ok).toBe(true)
  })

  it('a deposit that clears the whole balance stays paid_in_full (and makes no calendar event)', async () => {
    const d = db({ after: [{ payment_type: 'deposit', amount_cents: 100000 }] })
    await recordPlanPayment(target(), session({ amount_total: 103000 }), d as never)
    expect(bookingUpdates(d)[1].status).toBe('paid_in_full')
    expect(bookingUpdates(d)[1].approved_by).toBeUndefined()
    expect(mockCreateEvent).not.toHaveBeenCalled()
  })

  it('a CANCELLED plan is not approved by a stray deposit, and gets no calendar block', async () => {
    const d = db({ booking: { status: 'cancelled' } })
    await recordPlanPayment(target(), session(), d as never)
    expect(bookingUpdates(d).some(u => u.status === 'approved')).toBe(false)
    expect(mockCreateEvent).not.toHaveBeenCalled()
  })
})

describe('only a deposit approves', () => {
  it('a part payment against the balance changes no status', async () => {
    const d = db({
      booking: { status: 'approved' },
      before: [{ payment_type: 'deposit', amount_cents: 25000 }],
      after: [{ payment_type: 'deposit', amount_cents: 25000 }, { payment_type: 'partial', amount_cents: 20000 }],
    })
    await recordPlanPayment(target({ purpose: 'balance', expectedAmountCents: 20000, feeCents: 600 }), session({ amount_total: 20600, id: 'cs_2' }), d as never)
    expect(bookingUpdates(d).some(u => 'status' in u)).toBe(false)
    expect(mockCreateEvent).not.toHaveBeenCalled()
  })
})

describe('every card path that used to write pending_review now approves (source)', () => {
  const SRC = path.join(__dirname, '..', '..')
  const code = (r: string) =>
    fs.readFileSync(path.join(SRC, r), 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n\r]*/g, (m, p) => (p ?? '') + m.slice((p ?? '').length).replace(/[^\n\r]/g, ' '))

  it('none of the deposit writers writes pending_review any more', () => {
    for (const f of [
      'app/api/webhook/route.ts',
      'app/api/party-builder/confirm-session/route.ts',
      'app/api/studio-rental/confirm-session/route.ts',
      'lib/planPayment.ts',
    ]) {
      const src = code(f)
      expect([f, /status[^\n\r]*'pending_review'/.test(src)]).toEqual([f, false])
      expect([f, /depositApprovalFields/.test(src)]).toEqual([f, true])
    }
  })

  it('the webhook uses it on all three deposit branches (studio PI, planner PI, planner session)', () => {
    expect(code('app/api/webhook/route.ts').match(/depositApprovalFields\(\)/g)).toHaveLength(3)
  })

  it('a paid-in-full result still wins over approved on each of them', () => {
    const w = code('app/api/webhook/route.ts')
    expect(w.match(/paidInFull \? \{ status: 'paid_in_full' \} : depositApprovalFields\(\)/g)).toHaveLength(3)
  })
})
