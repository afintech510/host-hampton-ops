/**
 * The money-going-OUT branches of `/api/webhook`, driven against the fake that
 * refuses what Postgres refuses (`helpers/fakeMoneyDb.ts`).
 *
 * Before link 21 the handler had no such branches and the endpoint was
 * subscribed to none of these events, so a refund, a chargeback and a declined
 * card were each invisible to this business. Every case here is one of the three
 * ways that showed up.
 */

import { makeFakeMoneyDb, type FakeMoneyDb } from '../helpers/fakeMoneyDb'

const mockConstructEvent = jest.fn()
const mockRefundsList = jest.fn()
const mockResendSend = jest.fn().mockResolvedValue({ id: 'email_1' })

jest.mock('stripe', () => jest.fn().mockImplementation(() => ({
  webhooks: { constructEvent: mockConstructEvent },
  refunds: { list: mockRefundsList },
})))
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockResendSend } })),
}))

let db: FakeMoneyDb
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn().mockImplementation(() => db.client),
}))

const mockOwnerSms = jest.fn().mockResolvedValue(1)
jest.mock('@/lib/ownerNotify', () => ({
  ownerEmail: () => 'hosthampton295@gmail.com',
  notifyOwnerSms: (...a: unknown[]) => mockOwnerSms(...a),
  reviewerPhones: () => ['+15555550000'],
}))

jest.mock('@/lib/contacts', () => ({ upsertContact: jest.fn().mockResolvedValue('contact-1') }))
jest.mock('@/lib/sequences', () => ({ enrollInSequence: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/reminders', () => ({
  enqueueEventReminders: jest.fn().mockResolvedValue(undefined),
  enqueueBookingReminders: jest.fn().mockResolvedValue(undefined),
  enqueueReviewRequest: jest.fn().mockResolvedValue(undefined),
  enqueuePartyReminders: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/googleCalendar', () => ({
  createCalendarEvent: jest.fn().mockResolvedValue('cal_1'),
  addMinutes: (t: string) => t,
}))

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: () => body, body }),
  },
}))

function req() {
  return {
    text: jest.fn().mockResolvedValue('raw'),
    headers: { get: (n: string) => (n === 'stripe-signature' ? 'sig' : n === 'host' ? 'www.hosthampton.com' : null) },
  } as never
}

function fire(type: string, object: Record<string, unknown>) {
  mockConstructEvent.mockReturnValue({ type, data: { object } })
}

async function post() {
  const { POST } = await import('@/app/api/webhook/route')
  return POST(req()) as unknown as Promise<{ status: number; body: Record<string, unknown> }>
}

const ledger = () => db.rows('financial_transactions')
const subjects = () => mockResendSend.mock.calls.map(c => String((c[0] as { subject?: string }).subject ?? ''))

const charge = (over: Record<string, unknown> = {}) => ({
  id: 'ch_live_1',
  object: 'charge',
  currency: 'usd',
  payment_intent: 'pi_live_1',
  billing_details: { name: 'Jordan Reyes' },
  ...over,
})

const refund = (over: Record<string, unknown> = {}) => ({
  id: 're_1',
  amount: 5000,
  created: 1_758_000_000,
  reason: 'requested_by_customer',
  status: 'succeeded',
  ...over,
})

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  db = makeFakeMoneyDb({})
  process.env.RESEND_API_KEY = 'test-key'
  process.env.STRIPE_SECRET_KEY = 'sk_test'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  mockResendSend.mockResolvedValue({ id: 'email_1' })
})

describe('charge.refunded', () => {
  it('records a refund as a NEGATIVE ledger row, so the books stop overstating revenue', async () => {
    mockRefundsList.mockResolvedValue({ data: [refund()] })
    fire('charge.refunded', charge())

    const res = await post()

    expect(res.status).toBe(200)
    expect(ledger()).toHaveLength(1)
    const row = ledger()[0]
    // The sign is the whole point: money out.
    expect(row.amount_cents).toBe(-5000)
    expect(row.source).toBe('stripe')
    expect(row.category).toBe('Refund')
    expect(row.reference).toBe('stripe-refund-re_1')
  })

  it('dates the row from STRIPE, not from when we processed it', async () => {
    mockRefundsList.mockResolvedValue({ data: [refund({ created: 1_758_000_000 })] })
    fire('charge.refunded', charge())
    await post()
    // 1_758_000_000 → 2025-09-16 UTC. A redelivery on any later day must agree.
    expect(ledger()[0].date).toBe(new Date(1_758_000_000 * 1000).toISOString().split('T')[0])
  })

  it('keys on the REFUND, so a second partial refund is not swallowed as a duplicate', async () => {
    mockRefundsList.mockResolvedValue({ data: [refund({ id: 're_1', amount: 3000 })] })
    fire('charge.refunded', charge())
    await post()

    // The customer is refunded again on the SAME charge. `amount_refunded` would
    // be cumulative; the refund ids are distinct and that is what we key on.
    jest.resetModules()
    mockRefundsList.mockResolvedValue({
      data: [refund({ id: 're_1', amount: 3000 }), refund({ id: 're_2', amount: 2000 })],
    })
    fire('charge.refunded', charge())
    const res = await post()

    expect(res.body.written).toBe(1)
    expect(res.body.duplicates).toBe(1)
    expect(ledger()).toHaveLength(2)
    expect(ledger().map(r => r.amount_cents).sort((a, b) => Number(a) - Number(b))).toEqual([-3000, -2000].sort((a, b) => a - b))
  })

  it('a redelivery writes no second row and sends no second alert', async () => {
    mockRefundsList.mockResolvedValue({ data: [refund()] })
    fire('charge.refunded', charge())
    await post()
    const alertsAfterFirst = subjects().filter(s => s.includes('Refund recorded')).length

    jest.resetModules()
    fire('charge.refunded', charge())
    const res = await post()

    expect(ledger()).toHaveLength(1)
    expect(res.body.written).toBe(0)
    expect(res.body.duplicates).toBe(1)
    expect(subjects().filter(s => s.includes('Refund recorded'))).toHaveLength(alertsAfterFirst)
  })

  it('does NOT record a refund that has not succeeded yet', async () => {
    mockRefundsList.mockResolvedValue({ data: [refund({ status: 'pending' })] })
    fire('charge.refunded', charge())
    await post()
    expect(ledger()).toHaveLength(0)
  })

  it('500s when the refund list cannot be read, so Stripe redelivers instead of losing it', async () => {
    mockRefundsList.mockRejectedValue(new Error('stripe unreachable'))
    fire('charge.refunded', charge())
    const res = await post()
    expect(res.status).toBe(500)
    expect(ledger()).toHaveLength(0)
  })

  it('reports failure — not partial success — when a ledger write is refused', async () => {
    // A Supabase blip on the money write. Recording three of four refunds and
    // answering 200 would leave the fourth permanently missing, which is the
    // shape of the original bug, so the whole call must fail and the route 500.
    const { recordChargeRefunds } = await import('@/lib/stripeAftermath')
    const refused = {
      from: () => ({ insert: async () => ({ error: { code: '42501', message: 'permission denied' } }) }),
    }
    const out = await recordChargeRefunds(refused as never, charge() as never, [
      refund({ id: 're_a' }),
      refund({ id: 're_b' }),
    ] as never)

    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.message).toContain('re_a')
  })
})

describe('the admin panel and the webhook are not two refunds', () => {
  it('records ONE negative row when the admin refunds and Stripe then fires charge.refunded', async () => {
    // The admin panel issues the refund. Stripe hands back `re_1`.
    const { recordAdminRefund } = await import('@/lib/adminMoney')
    const outcome = await recordAdminRefund(db.client as never, {
      kind: 'ticket',
      objectId: 'ticket-1',
      amountCents: 5000,
      refundedAt: new Date(1_758_000_000 * 1000).toISOString(),
      label: 'Embroidery Workshop (HH-EVT-10017)',
      customerName: 'Jordan Reyes',
      category: 'Event Ticket',
      notes: 'customer cancelled',
      viaStripe: true,
      stripeRefundId: 're_1',
    })
    expect(outcome.reference).toBe('stripe-refund-re_1')
    expect(ledger()).toHaveLength(1)

    // Moments later Stripe delivers the webhook for the same refund.
    mockRefundsList.mockResolvedValue({ data: [refund({ id: 're_1', amount: 5000 })] })
    fire('charge.refunded', charge())
    const res = await post()

    // One refund, one row. Two would understate revenue by $50 invisibly.
    expect(ledger()).toHaveLength(1)
    expect(ledger()[0].amount_cents).toBe(-5000)
    expect(res.body.written).toBe(0)
    expect(res.body.duplicates).toBe(1)
  })

  it('keeps a books-only reversal out of Stripe reference space', async () => {
    const { recordAdminRefund } = await import('@/lib/adminMoney')
    const outcome = await recordAdminRefund(db.client as never, {
      kind: 'booking',
      objectId: 'booking-1',
      amountCents: 20000,
      refundedAt: new Date().toISOString(),
      label: 'Kid Party (HH-2026-2800)',
      customerName: 'Sam',
      category: 'Party Booking',
      viaStripe: false,
      stripeRefundId: null,
    })
    // No Stripe object behind it, so it stays where it was: there is no webhook
    // delivery coming that it could collide with.
    expect(outcome.reference).toBe('admin-refund-booking-booking-1')
    expect(ledger()[0].source).toBe('other')
  })
})

describe('charge.dispute.created', () => {
  const dispute = (over: Record<string, unknown> = {}) => ({
    id: 'dp_1',
    object: 'dispute',
    amount: 25750,
    charge: 'ch_live_1',
    created: 1_758_000_000,
    reason: 'fraudulent',
    status: 'needs_response',
    evidence_details: { due_by: Math.floor(Date.now() / 1000) + 8 * 86400 },
    ...over,
  })

  it('alerts by email AND sms, because a chargeback has a deadline', async () => {
    fire('charge.dispute.created', dispute())
    const res = await post()

    expect(res.status).toBe(200)
    expect(subjects().some(s => s.includes('Chargeback'))).toBe(true)
    expect(mockOwnerSms).toHaveBeenCalledTimes(1)
    expect(String(mockOwnerSms.mock.calls[0][0])).toContain('CHARGEBACK')
  })

  it('writes NOTHING to the books on open — the money comes back if we win', async () => {
    fire('charge.dispute.created', dispute())
    await post()
    expect(ledger()).toHaveLength(0)
  })
})

describe('charge.dispute.closed', () => {
  const closed = (status: string) => ({
    id: 'dp_2',
    object: 'dispute',
    amount: 25750,
    charge: 'ch_live_1',
    created: 1_758_000_000,
    reason: 'fraudulent',
    status,
  })

  it('records money out ONLY when the dispute was lost', async () => {
    fire('charge.dispute.closed', closed('lost'))
    await post()
    expect(ledger()).toHaveLength(1)
    expect(ledger()[0].amount_cents).toBe(-25750)
    expect(ledger()[0].category).toBe('Chargeback')
    expect(ledger()[0].reference).toBe('stripe-dispute-dp_2')
  })

  it('records nothing when the dispute was WON — booking it would understate revenue', async () => {
    fire('charge.dispute.closed', closed('won'))
    const res = await post()
    expect(res.status).toBe(200)
    expect(ledger()).toHaveLength(0)
  })

  it('records nothing for a warning that closed without ever taking money', async () => {
    fire('charge.dispute.closed', closed('warning_closed'))
    await post()
    expect(ledger()).toHaveLength(0)
  })
})

describe('payment_intent.payment_failed', () => {
  const failedPi = (metadata: Record<string, string> = {}) => ({
    id: 'pi_failed_1',
    object: 'payment_intent',
    amount: 81300,
    metadata,
    receipt_email: 'customer@example.com',
    last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds', message: 'Your card has insufficient funds.' },
  })

  it('emails Adam when the decline is against a KNOWN booking', async () => {
    fire('payment_intent.payment_failed', failedPi({ booking_ref: 'HH-PTY-6GGMB' }))
    const res = await post()

    expect(res.status).toBe(200)
    expect(res.body.alerted).toBe(true)
    expect(subjects().some(s => s.includes('Card declined'))).toBe(true)
  })

  it('stays QUIET for an anonymous decline, so the alert keeps meaning something', async () => {
    fire('payment_intent.payment_failed', failedPi({}))
    const res = await post()

    expect(res.status).toBe(200)
    expect(res.body.alerted).toBe(false)
    expect(subjects().filter(s => s.includes('Card declined'))).toHaveLength(0)
  })

  it('never writes to the books — no money moved', async () => {
    fire('payment_intent.payment_failed', failedPi({ booking_ref: 'HH-PTY-6GGMB' }))
    await post()
    expect(ledger()).toHaveLength(0)
  })
})
