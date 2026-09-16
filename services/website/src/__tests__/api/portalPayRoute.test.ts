/**
 * `/api/portal/pay`, driven, plus the ledger row the webhook writes from it.
 *
 * The headline this file exists for: **`/my-booking`'s "Pay Deposit" button
 * charged the card and recorded $0.** The route copies a body-supplied
 * `paymentType` into `metadata.payment_type`; the webhook's PaymentIntent branch
 * reads the credited figure as `paymentType === 'deposit' ? depositCents :
 * amountCents`; and this route set `amountCents` and never `depositCents`. The
 * UI DEFAULTS to `'deposit'` on any `awaiting_deposit` booking
 * (`MyBookingContent.tsx:323`) and 8 of those carry a live balance.
 *
 * The metadata is asserted here as a VALUE, not as source text, because the
 * defect was two keys naming one figure and only one of them written — which
 * reads perfectly in the source and is only visible in the object.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: async () => body, body }),
  },
}))

const created: any[] = []
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn(async (args: any) => {
        created.push(args)
        return { id: `pi_test_${created.length}`, client_secret: 'cs_secret', amount: args.amount }
      }),
    },
  }))
})

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))

/**
 * Rule 7: spread the REAL module. Link 20 broke four suites with a whole-module
 * `jest.mock('@/lib/portalAuth')` that silently dropped a function the route
 * later started importing, and the failure surfaced as a TypeError inside the
 * handler rather than as a missing assertion.
 */
jest.mock('@/lib/portalAuth', () => ({
  ...jest.requireActual('@/lib/portalAuth'),
  getPortalBookingRef: () => 'HH-PTY-TEST1',
  portalSigningSecret: () => 'test-secret',
}))

import { POST } from '@/app/api/portal/pay/route'
import { __resetRateLimitForTests } from '@/lib/rateLimit'
import { makeFakeMoneyDb } from '../helpers/fakeMoneyDb'
import { BOOKING_DEPOSIT_CENTS } from '@/lib/partyPricing'

const BOOKING = {
  id: 'bk-1',
  booking_ref: 'HH-PTY-TEST1',
  status: 'awaiting_deposit',
  total_cents: 110_000,
  balance_due_cents: 85_000,
  contact_name: 'Adam Test',
  contact_email: 'adam@easternbuilding.supply',
  package_type: 'Studio Rental',
}

const req = (body: any): any => ({
  headers: { get: (n: string) => (n === 'cookie' ? 'hh_portal=x' : null) },
  json: async () => body,
})

function seed(overrides: Record<string, unknown> = {}) {
  const db = makeFakeMoneyDb({ bookings: [{ ...BOOKING, ...overrides }] })
  mockGetSupabase.mockReturnValue(db.client as any)
  return db
}

beforeEach(() => {
  jest.clearAllMocks()
  created.length = 0
  __resetRateLimitForTests()
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
})

describe('the deposit branch that recorded $0', () => {
  it('names the amount under BOTH metadata keys, with the same figure', async () => {
    seed()
    const res: any = await POST(req({ amountCents: 9_900, paymentMethod: 'card', paymentType: 'deposit' }))
    expect(res.status).toBe(200)

    const meta = created[0].metadata
    expect(meta.payment_type).toBe('deposit')
    expect(meta.amountCents).toBe('9900')
    // The key whose absence credited nothing. THIS is the assertion the whole
    // file exists for.
    expect(meta.depositCents).toBe('9900')
    expect(meta.depositCents).toBe(meta.amountCents)
  })

  it('the webhook would now credit the real figure, not zero', async () => {
    seed()
    await POST(req({ amountCents: 9_900, paymentMethod: 'card', paymentType: 'deposit' }))
    const m = created[0].metadata

    // The webhook's own arithmetic, reproduced exactly as it reads the metadata.
    const depositCents = parseInt(m.depositCents || '0', 10)
    const paymentType = m.payment_type
    const credited = paymentType === 'deposit'
      ? (depositCents || parseInt(m.amountCents || '0', 10))
      : (parseInt(m.amountCents || '0', 10) || depositCents)

    expect(credited).toBe(9_900)

    // …and what it used to be. Before the fix this branch read
    // `parseInt(m.depositCents || '0')` with the key absent.
    const before = paymentType === 'deposit' ? parseInt((undefined as any) || '0', 10) : 0
    expect(before).toBe(0)
  })

  it('a deposit still charges the card fee on top, so the charge is unchanged', async () => {
    seed()
    await POST(req({ amountCents: 9_900, paymentMethod: 'card', paymentType: 'deposit' }))
    // 3% card fee — the customer pays the same either way; only the LEDGER was wrong.
    expect(created[0].amount).toBeGreaterThan(9_900)
  })
})

describe('the payment type a customer may name', () => {
  it('refuses a value Postgres would reject, BEFORE Stripe is touched', async () => {
    seed()
    const res: any = await POST(req({ amountCents: 5_000, paymentMethod: 'card', paymentType: 'x' }))
    expect(res.status).toBe(400)
    expect(created).toHaveLength(0)
  })

  it('refuses `refund`, which the CHECK accepts and which subtracts', async () => {
    seed()
    const res: any = await POST(req({ amountCents: 5_000, paymentMethod: 'card', paymentType: 'refund' }))
    expect(res.status).toBe(400)
    expect(created).toHaveLength(0)
  })

  it('the ledger row an unscreened type would have produced is REFUSED by the column', async () => {
    // Rule 8 in its mock form: prove the consequence against a fake that refuses
    // what Postgres refuses, rather than asserting it. This is what the webhook
    // would have hit after the card was already charged — 23514, then a 500, then
    // Stripe retrying forever against a charge recorded nowhere.
    const db = makeFakeMoneyDb({ bookings: [BOOKING] })
    const { error } = await (db.client as any)
      .from('booking_payments')
      .insert({
        booking_id: 'bk-1', payment_type: 'x', payment_method: 'card',
        amount_cents: 5_000, total_charged_cents: 5_150, recorded_by: 'system',
        stripe_payment_intent_id: 'pi_x',
      })
    expect(error?.code).toBe('23514')
    expect(error?.message).toContain('booking_payments_payment_type_check')
  })

  it('omitting it is not an error — it is derived from the amount', async () => {
    seed()
    // `/my-booking/pay` posts no paymentType at all.
    const partial: any = await POST(req({ amountCents: 5_000, paymentMethod: 'card' }))
    expect(partial.status).toBe(200)
    expect(created[0].metadata.payment_type).toBe('partial')

    created.length = 0
    seed()
    const full: any = await POST(req({ amountCents: 85_000, paymentMethod: 'card' }))
    expect(full.status).toBe(200)
    expect(created[0].metadata.payment_type).toBe('final')
  })
})

describe('a party that is not happening does not take money', () => {
  it('refuses a cancelled booking that still carries a balance', async () => {
    // Four real ones, $47,470 between them, measured 2026-09-13.
    seed({ status: 'cancelled' })
    const res: any = await POST(req({ amountCents: 25_000, paymentMethod: 'card', paymentType: 'final' }))
    expect(res.status).toBe(409)
    expect(created).toHaveLength(0)
    expect((await res.json()).error).toMatch(/no longer taking payments/i)
  })

  it('refuses it on the Venmo/Zelle branch too, not just the card one', async () => {
    // A guard on one of two paths is a guard on nothing.
    seed({ status: 'cancelled' })
    const res: any = await POST(req({ amountCents: 25_000, paymentMethod: 'venmo' }))
    expect(res.status).toBe(409)
  })

  it('still takes money on every status a live booking actually holds', async () => {
    // The other direction — the expensive one. A guard that refuses a paying
    // customer is worse than the abuse it prevents.
    for (const status of ['awaiting_deposit', 'deposit_paid', 'approved', 'modifications_locked']) {
      created.length = 0
      __resetRateLimitForTests()
      seed({ status })
      const res: any = await POST(req({ amountCents: 5_000, paymentMethod: 'card', paymentType: 'partial' }))
      expect([status, res.status]).toEqual([status, 200])
    }
  })
})

describe('the amount is still clamped to what is owed', () => {
  it('a customer cannot pay more than the balance', async () => {
    seed()
    await POST(req({ amountCents: 500_000, paymentMethod: 'card', paymentType: 'final' }))
    expect(created[0].metadata.amountCents).toBe('85000')
    expect(created[0].metadata.depositCents).toBe('85000')
  })

  it('a PRICED plan that owes nothing is refused rather than charged the body figure', async () => {
    for (const balance of [0, null]) {
      created.length = 0
      __resetRateLimitForTests()
      // Priced and settled: there are line items, so "owes 0" means SETTLED and
      // the refusal stands. (An unpriced plan is the separate case below — it
      // owes 0 only for want of a quote.)
      const db = makeFakeMoneyDb({
        bookings: [{ ...BOOKING, balance_due_cents: balance }],
        booking_line_items: [
          { id: 'li-1', booking_id: BOOKING.id, name: 'Party', quantity: 1, unit_price_cents: 60_000, guest_multiplied: false },
        ],
        booking_payments: [
          { id: 'p-1', booking_id: BOOKING.id, amount_cents: 60_000, payment_type: 'partial' },
        ],
      })
      mockGetSupabase.mockReturnValue(db.client as any)
      const res: any = await POST(req({ amountCents: 50_000, paymentMethod: 'card' }))
      expect([balance, res.status]).toEqual([balance, 409])
      expect(created).toHaveLength(0)
    }
  })

  /**
   * The reservation deposit (2026-09-16). An UNPRICED plan — a real customer
   * arrived from an Instagram inquiry with a date, a portal link and no line
   * items — owes 0 because nobody has quoted it, and every pay surface read
   * that as "settled". She had no way to leave the flat deposit that holds her
   * date. See `isUnpricedPlan` in lib/planBalance.ts.
   */
  it('an UNPRICED plan takes the flat deposit — clamped to it, not to the body figure', async () => {
    created.length = 0
    __resetRateLimitForTests()
    const db = makeFakeMoneyDb({ bookings: [{ ...BOOKING, balance_due_cents: 0, total_cents: 0 }] })
    mockGetSupabase.mockReturnValue(db.client as any)

    const res: any = await POST(req({ amountCents: 50_000, paymentMethod: 'card' }))
    expect(res.status).toBe(200)
    expect(created).toHaveLength(1)
    // The body asked for $500. The ceiling is the server's flat deposit.
    expect(created[0].metadata.amountCents).toBe(String(BOOKING_DEPOSIT_CENTS))
    // …and it is typed `deposit`, or `paidAsDepositCents` will not net it off
    // and the customer can be invited to pay it a second time.
    expect(created[0].metadata.payment_type).toBe('deposit')
  })

  it('an unpriced plan that has ALREADY paid its reservation is refused', async () => {
    created.length = 0
    __resetRateLimitForTests()
    const db = makeFakeMoneyDb({
      bookings: [{ ...BOOKING, balance_due_cents: 0, total_cents: 0 }],
      booking_payments: [
        { id: 'p-1', booking_id: BOOKING.id, amount_cents: BOOKING_DEPOSIT_CENTS, payment_type: 'deposit' },
      ],
    })
    mockGetSupabase.mockReturnValue(db.client as any)

    const res: any = await POST(req({ amountCents: 50_000, paymentMethod: 'card' }))
    expect(res.status).toBe(409)
    expect(created).toHaveLength(0)
  })

  it('a CANCELLED unpriced plan is still refused — status is checked first', async () => {
    created.length = 0
    __resetRateLimitForTests()
    seed({ balance_due_cents: 0, total_cents: 0, status: 'cancelled' })
    const res: any = await POST(req({ amountCents: 50_000, paymentMethod: 'card' }))
    expect(res.status).toBe(409)
    expect(created).toHaveLength(0)
  })
})

describe('the rate limit', () => {
  it('bounds the PaymentIntents one caller can create, and says it refused', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const r = (): any => ({
      headers: { get: (n: string) => (n === 'cookie' ? 'hh_portal=x' : n === 'cf-connecting-ip' ? '203.0.113.7' : null) },
      json: async () => ({ amountCents: 100, paymentMethod: 'card', paymentType: 'partial' }),
    })
    let refused = 0
    for (let i = 0; i < 40; i++) {
      seed()
      const res: any = await POST(r())
      if (res.status === 429) refused++
    }
    expect(refused).toBeGreaterThan(0)
    // 30 per caller per 10 minutes: a declined card retried a few times must get
    // through, so the bound is generous on purpose.
    expect(created.length).toBeGreaterThanOrEqual(30)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('portal/pay'))
    // …and the masked key never carries the middle octets.
    expect(warn.mock.calls.flat().join(' ')).not.toContain('203.0.113.7')
    warn.mockRestore()
  })
})
