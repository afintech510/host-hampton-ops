/**
 * The admin refund path — both routes, driven against a fake that refuses what
 * Postgres refuses.
 *
 * This file used to drive `buildChain({ data: sampleTicket(), error: null })`:
 * a mock that accepts every write, answers every read with the same fixed row,
 * and returns `{data: null, error: null}` to every RPC. Against that mock the
 * three defects link 18 found all look fine:
 *
 *   * the guard "already refunded" depends on an UPDATE whose failure was
 *     discarded, so a second click issued A SECOND REAL STRIPE REFUND — a mock
 *     that always succeeds can never show that;
 *   * `/api/admin/events/[id]/tickets/[ticketId]/refund` restored inventory for
 *     the event named in the URL rather than the ticket's own `event_id`, and a
 *     fixed-row mock returns the same ticket for every id, so a cross-event
 *     refund was indistinguishable from a correct one;
 *   * neither route wrote a `financial_transactions` row, and there was no
 *     `financial_transactions` table in the mock to notice.
 *
 * Hard-won rule 8's mock form, for the seventh session running.
 */

import { makeFakeMoneyDb } from '../helpers/fakeMoneyDb'

const mockStripeRefundCreate = jest.fn()
jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    refunds: { create: (...a: any[]) => mockStripeRefundCreate(...a) },
  })),
}))

const mockResendSend = jest.fn().mockResolvedValue({ error: null })
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockResendSend } })),
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: (...args: any[]) => mockGetSupabase(...args) }))

jest.mock('@/lib/emailTemplates', () => ({
  ticketRefundHtml: jest.fn().mockReturnValue('<html>Refund email</html>'),
  bookingRefundHtml: jest.fn().mockReturnValue('<html>Booking refund</html>'),
}))

jest.mock('@/lib/adminAuth', () => ({
  ...jest.requireActual('@/lib/adminAuth'),
  isAdminAuthorized: jest.fn(() => true),
}))

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }),
  },
}))

import { POST as refundViaEvent } from '@/app/api/admin/events/[id]/tickets/[ticketId]/refund/route'
import { POST as refundViaOrders } from '@/app/api/admin/orders/[id]/refund/route'

const EVENT_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const EVENT_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const TICKET = 'tttttttt-0000-4000-8000-000000000001'

function ticketRow(over: Record<string, unknown> = {}) {
  return {
    id: TICKET,
    ticket_ref: 'HH-EVT-10001',
    event_id: EVENT_A,
    session_id: null,
    quantity: 2,
    unit_price_cents: 2500,
    total_cents: 5000,
    status: 'confirmed',
    customer_name: 'Test Customer',
    customer_email: 'adam@easternbuilding.supply',
    stripe_payment_intent_id: 'pi_test_1',
    refund_amount_cents: null,
    refund_reason: null,
    ...over,
  }
}

function seeded(over: Record<string, unknown> = {}) {
  return makeFakeMoneyDb({
    event_tickets: [ticketRow(over)],
    events: [
      { id: EVENT_A, title: 'Glow Party', available_tickets: 5 },
      { id: EVENT_B, title: 'Other Event', available_tickets: 5 },
    ],
    financial_transactions: [],
  })
}

const req = () => ({ headers: { get: () => null }, json: async () => reqBody }) as any
let reqBody: any = {}

beforeEach(() => {
  jest.clearAllMocks()
  reqBody = {}
  mockStripeRefundCreate.mockResolvedValue({ id: 're_1' })
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake'
  process.env.RESEND_API_KEY = 're_test_fake'
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('refund — the claim is taken before the money moves', () => {
  it('refunds once, restores inventory, and writes the books', async () => {
    const db = seeded()
    mockGetSupabase.mockReturnValue(db.client)

    const res: any = await refundViaEvent(req(), { params: { id: EVENT_A, ticketId: TICKET } })
    expect(res.status).toBe(200)
    expect(res.json().refunded).toBe(true)

    expect(mockStripeRefundCreate).toHaveBeenCalledTimes(1)
    expect(db.rows('event_tickets')[0].status).toBe('refunded')
    expect(db.rows('events').find(e => e.id === EVENT_A)!.available_tickets).toBe(7)

    // THE POINT OF THIS REVIEW: a refund now reaches the Financials tab, as a
    // NEGATIVE row so it reduces reported revenue.
    const fin = db.rows('financial_transactions')
    expect(fin).toHaveLength(1)
    expect(fin[0].amount_cents).toBe(-5000)
    // Link 21: keyed on the STRIPE REFUND, not on the ticket. `/api/webhook` now
    // has a `charge.refunded` branch, so this refund is about to arrive a second
    // time from Stripe; sharing the reference is what makes that delivery a
    // no-op instead of a second negative row for the same money.
    expect(fin[0].reference).toBe('stripe-refund-re_1')
    expect(fin[0].source).toBe('stripe')
    expect(fin[0].category).toBe('Event Ticket')
  })

  it('a SECOND refund of the same ticket does not reach Stripe', async () => {
    const db = seeded()
    mockGetSupabase.mockReturnValue(db.client)

    await refundViaEvent(req(), { params: { id: EVENT_A, ticketId: TICKET } })
    expect(mockStripeRefundCreate).toHaveBeenCalledTimes(1)

    const again: any = await refundViaEvent(req(), { params: { id: EVENT_A, ticketId: TICKET } })
    expect(again.status).toBe(400)
    expect(again.json().error).toMatch(/already refunded/i)
    // The assertion this whole file exists for: real money moved exactly once.
    expect(mockStripeRefundCreate).toHaveBeenCalledTimes(1)
    expect(db.rows('financial_transactions')).toHaveLength(1)
  })

  it('a failed Stripe refund RELEASES the claim, so the ticket is not left lying', async () => {
    const db = seeded()
    mockGetSupabase.mockReturnValue(db.client)
    mockStripeRefundCreate.mockRejectedValue(new Error('card_declined'))

    const res: any = await refundViaEvent(req(), { params: { id: EVENT_A, ticketId: TICKET } })
    expect(res.status).toBe(500)
    expect(res.json().error).toMatch(/Stripe refund failed/)
    expect(db.rows('event_tickets')[0].status).toBe('confirmed')
    expect(db.rows('event_tickets')[0].refund_amount_cents).toBeNull()
    // Nothing in the books for money that never moved.
    expect(db.rows('financial_transactions')).toHaveLength(0)
    // And no email claiming a refund was processed.
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it('a ticket belonging to ANOTHER event is 404, not a misapplied refund', async () => {
    const db = seeded()
    mockGetSupabase.mockReturnValue(db.client)

    // Ticket belongs to EVENT_A; the URL names EVENT_B.
    const res: any = await refundViaEvent(req(), { params: { id: EVENT_B, ticketId: TICKET } })
    expect(res.status).toBe(404)
    expect(mockStripeRefundCreate).not.toHaveBeenCalled()
    // Neither event's inventory moved, and the ticket is untouched.
    expect(db.rows('events').find(e => e.id === EVENT_B)!.available_tickets).toBe(5)
    expect(db.rows('events').find(e => e.id === EVENT_A)!.available_tickets).toBe(5)
    expect(db.rows('event_tickets')[0].status).toBe('confirmed')
  })

  it('restores the SESSION inventory when the ticket has one', async () => {
    const db = makeFakeMoneyDb({
      event_tickets: [ticketRow({ session_id: 'sess-1' })],
      events: [{ id: EVENT_A, title: 'Glow Party', available_tickets: 5 }],
      event_sessions: [{ id: 'sess-1', available_tickets: 1 }],
    })
    mockGetSupabase.mockReturnValue(db.client)

    await refundViaEvent(req(), { params: { id: EVENT_A, ticketId: TICKET } })
    expect(db.rows('event_sessions')[0].available_tickets).toBe(3)
    // The event's own count is NOT touched when the ticket belongs to a session.
    expect(db.rows('events')[0].available_tickets).toBe(5)
  })

  it('refuses an amount larger than was paid, before touching Stripe', async () => {
    const db = seeded()
    mockGetSupabase.mockReturnValue(db.client)
    reqBody = { amountCents: 999999 }

    const res: any = await refundViaEvent(req(), { params: { id: EVENT_A, ticketId: TICKET } })
    expect(res.status).toBe(400)
    expect(res.json().error).toMatch(/exceeds/)
    expect(mockStripeRefundCreate).not.toHaveBeenCalled()
  })

  it('honours a smaller partial amount', async () => {
    const db = seeded()
    mockGetSupabase.mockReturnValue(db.client)
    reqBody = { amountCents: 1500, reason: 'partial' }

    const res: any = await refundViaEvent(req(), { params: { id: EVENT_A, ticketId: TICKET } })
    expect(res.status).toBe(200)
    expect(mockStripeRefundCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_test_1', amount: 1500 }),
    )
    expect(db.rows('financial_transactions')[0].amount_cents).toBe(-1500)
  })

  it('a read failure is 503, not a confident 404', async () => {
    const db = seeded()
    db.breakReadsOn('event_tickets')
    mockGetSupabase.mockReturnValue(db.client)

    const res: any = await refundViaEvent(req(), { params: { id: EVENT_A, ticketId: TICKET } })
    expect(res.status).toBe(503)
    expect(mockStripeRefundCreate).not.toHaveBeenCalled()
  })

  it('an unknown ticket is 404', async () => {
    const db = seeded()
    mockGetSupabase.mockReturnValue(db.client)
    const res: any = await refundViaEvent(req(), { params: { id: EVENT_A, ticketId: 'nope' } })
    expect(res.status).toBe(404)
  })
})

describe('refund — the orders route reaches the same implementation', () => {
  it('refunds a ticket through /orders and writes one ledger row', async () => {
    const db = seeded()
    mockGetSupabase.mockReturnValue(db.client)
    reqBody = { order_type: 'ticket' }

    const res: any = await refundViaOrders(req(), { params: { id: TICKET } })
    expect(res.status).toBe(200)
    expect(db.rows('event_tickets')[0].status).toBe('refunded')
    expect(db.rows('financial_transactions')).toHaveLength(1)
    // Shared with the `charge.refunded` webhook — see the ticket case above.
    expect(db.rows('financial_transactions')[0].reference).toBe('stripe-refund-re_1')
  })

  it('a booking refund writes a NEGATIVE ledger row AND a refund payment row', async () => {
    const BK = 'bbbbbbbb-1111-4000-8000-000000000001'
    const db = makeFakeMoneyDb({
      bookings: [{
        id: BK, booking_ref: 'HH-PTY-TEST1', status: 'approved', contact_email: 'adam@easternbuilding.supply',
        contact_name: 'Test Customer', event_type: 'kid-party', party_type: 'kid_party',
        total_cents: 60000, deposit_amount: 25000, stripe_payment_intent_id: 'pi_bk_1',
        refund_amount_cents: null, refund_reason: null,
      }],
      booking_payments: [{
        id: 'p1', booking_id: BK, payment_type: 'deposit', payment_method: 'card',
        amount_cents: 25000, card_fee_cents: 0, total_charged_cents: 25000, recorded_by: 'system',
      }],
    })
    mockGetSupabase.mockReturnValue(db.client)
    reqBody = { order_type: 'booking', amountCents: 25000, reason: 'cancelled' }

    const res: any = await refundViaOrders(req(), { params: { id: BK } })
    expect(res.status).toBe(200)

    const fin = db.rows('financial_transactions')
    expect(fin).toHaveLength(1)
    expect(fin[0].amount_cents).toBe(-25000)
    // Shared with the `charge.refunded` webhook — see the ticket case above.
    expect(fin[0].reference).toBe('stripe-refund-re_1')
    expect(fin[0].source).toBe('stripe')

    // `booking_payments` held ZERO rows of type 'refund' in production against a
    // booking that really was refunded $200 — so the balance still said the
    // customer had paid it.
    const refunds = db.rows('booking_payments').filter(p => p.payment_type === 'refund')
    expect(refunds).toHaveLength(1)
    expect(refunds[0].amount_cents).toBe(25000)
    // `adminActorId` on the shared-password path, which migration 047's relaxed
    // CHECK now permits.
    expect(refunds[0].recorded_by).toBe('ADMIN')
  })

  it('a booking refund is capped at what was actually PAID, not deposit_amount', async () => {
    const BK = 'bbbbbbbb-1111-4000-8000-000000000002'
    const db = makeFakeMoneyDb({
      bookings: [{
        id: BK, booking_ref: 'HH-PTY-TEST2', status: 'approved', contact_email: 'a@b.com',
        contact_name: 'X', event_type: 'kid-party', total_cents: 60000,
        // The deposit was SET to $250 but only $100 ever arrived.
        deposit_amount: 25000, stripe_payment_intent_id: null, refund_amount_cents: null,
      }],
      booking_payments: [{
        id: 'p1', booking_id: BK, payment_type: 'deposit', payment_method: 'venmo',
        amount_cents: 10000, card_fee_cents: 0, total_charged_cents: 10000, recorded_by: 'admin',
      }],
    })
    mockGetSupabase.mockReturnValue(db.client)
    reqBody = { order_type: 'booking', amountCents: 25000 }

    const res: any = await refundViaOrders(req(), { params: { id: BK } })
    expect(res.status).toBe(400)
    expect(res.json().error).toMatch(/exceeds/)
    expect(db.rows('financial_transactions')).toHaveLength(0)
  })

  it('a second booking refund is refused by the claim', async () => {
    const BK = 'bbbbbbbb-1111-4000-8000-000000000003'
    const db = makeFakeMoneyDb({
      bookings: [{
        id: BK, booking_ref: 'HH-PTY-TEST3', status: 'approved', contact_email: 'a@b.com',
        contact_name: 'X', event_type: 'kid-party', total_cents: 60000,
        deposit_amount: 25000, stripe_payment_intent_id: 'pi_x', refund_amount_cents: null,
      }],
      booking_payments: [{
        id: 'p1', booking_id: BK, payment_type: 'deposit', payment_method: 'card',
        amount_cents: 25000, card_fee_cents: 0, total_charged_cents: 25000, recorded_by: 'system',
      }],
    })
    mockGetSupabase.mockReturnValue(db.client)
    reqBody = { order_type: 'booking', amountCents: 10000 }

    await refundViaOrders(req(), { params: { id: BK } })
    expect(mockStripeRefundCreate).toHaveBeenCalledTimes(1)
    const again: any = await refundViaOrders(req(), { params: { id: BK } })
    expect(again.status).toBe(400)
    expect(mockStripeRefundCreate).toHaveBeenCalledTimes(1)
  })

  it('rejects an invalid order_type', async () => {
    mockGetSupabase.mockReturnValue(seeded().client)
    reqBody = { order_type: 'nonsense' }
    const res: any = await refundViaOrders(req(), { params: { id: TICKET } })
    expect(res.status).toBe(400)
  })
})
