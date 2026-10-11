/**
 * `/api/portal/pay` as the INVOICE page drives it: a `purpose`, not an amount.
 *
 * `/plan/[ref]/summary` opens Stripe's card form in place by posting
 * `{ purpose: 'deposit' | 'balance' | 'partial' }` here, instead of minting a
 * hosted Payment Link. This file pins what has to be true for that to be safe —
 * driven against the route, the PaymentIntent it creates read back as a VALUE
 * (the `$0 receipt` lesson in portalPayRoute.test.ts: two metadata keys naming
 * one figure are only visible in the object):
 *
 *   * the credited amount is derived from the plan, and the request's own figure
 *     is ignored for `deposit` and `balance`;
 *   * a part payment is bounded — a $50 floor, clamped to what is left;
 *   * BOTH metadata keys carry the credited figure, and the card fee / tip /
 *     charge add up the way the Payment Link's did ($250 -> $257.50);
 *   * a cancelled booking takes nothing, and `refund` is no customer's word;
 *   * the response reads back what the SERVER settled on.
 *
 * The figures are HH-PTY-XY8VU's: a $1,700 studio rental with $250 paid.
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
        return { id: `pi_test_${created.length}`, client_secret: `pi_test_${created.length}_secret_x`, amount: args.amount }
      }),
    },
  }))
})

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))
jest.mock('@/lib/portalAuth', () => ({
  ...jest.requireActual('@/lib/portalAuth'),
  getPortalBookingRef: () => 'HH-PTY-XY8VU',
  portalSigningSecret: () => 'test-secret',
}))

import { POST } from '@/app/api/portal/pay/route'
import { __resetRateLimitForTests } from '@/lib/rateLimit'
import { makeFakeMoneyDb } from '../helpers/fakeMoneyDb'

const STUDIO = {
  id: 'bk-xy',
  booking_ref: 'HH-PTY-XY8VU',
  status: 'deposit_paid',
  party_type: 'studio_rental',
  total_cents: 170_000,
  balance_due_cents: 145_000,
  guest_count_approx: null,
  contact_name: 'Test Customer',
  contact_email: 'customer@example.com',
  package_type: 'Studio Rental',
}
const ITEMS = [
  { id: 'li-1', booking_id: 'bk-xy', name: 'Room', quantity: 1, unit_price_cents: 170_000, guest_multiplied: false },
]
const DEPOSIT_PAID = [{ id: 'p-1', booking_id: 'bk-xy', amount_cents: 25_000, payment_type: 'deposit' }]

const req = (body: any): any => ({
  headers: { get: (n: string) => (n === 'cookie' ? 'hh_portal=x' : null) },
  json: async () => body,
})

function seed(opts: { booking?: Record<string, unknown>; payments?: any[]; items?: any[] } = {}) {
  const db = makeFakeMoneyDb({
    bookings: [{ ...STUDIO, ...(opts.booking ?? {}) }],
    booking_line_items: opts.items ?? ITEMS,
    booking_payments: opts.payments ?? DEPOSIT_PAID,
  })
  mockGetSupabase.mockReturnValue(db.client as any)
  return db
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  created.length = 0
  __resetRateLimitForTests()
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
})
afterEach(() => jest.restoreAllMocks())

describe('purpose: balance — the amount is the plan\'s, not the request\'s', () => {
  it('charges the whole $1,450 + 3% = $1,493.50, ignoring a body figure of $1', async () => {
    seed()
    const res: any = await POST(req({ paymentMethod: 'card', purpose: 'balance', amountCents: 100 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(created).toHaveLength(1)
    expect(created[0].amount).toBe(149_350)
    expect(created[0].metadata.payment_type).toBe('final')
    // Both keys, same figure — the "$0 receipt" defect is one of these being absent.
    expect(created[0].metadata.amountCents).toBe('145000')
    expect(created[0].metadata.depositCents).toBe('145000')
    expect(created[0].metadata.cardFeeCents).toBe('4350')
    expect(body).toMatchObject({ amountCents: 145_000, feeCents: 4_350, tipCents: 0, chargeCents: 149_350, paymentType: 'final' })
  })

  it('does not even need an amount in the request', async () => {
    seed()
    const res: any = await POST(req({ paymentMethod: 'card', purpose: 'balance' }))
    expect(res.status).toBe(200)
    expect(created[0].metadata.amountCents).toBe('145000')
  })

  it('refuses a paid-in-full plan', async () => {
    seed({ payments: [{ id: 'p-9', booking_id: 'bk-xy', amount_cents: 170_000, payment_type: 'final' }], booking: { balance_due_cents: 0 } })
    const res: any = await POST(req({ paymentMethod: 'card', purpose: 'balance' }))
    expect(res.status).toBe(409)
    expect(created).toHaveLength(0)
  })
})

describe('purpose: partial — a bounded custom amount', () => {
  it('charges $500 + 3% = $515.00 and records it partial', async () => {
    seed()
    const res: any = await POST(req({ paymentMethod: 'card', purpose: 'partial', amountCents: 50_000 }))
    expect(res.status).toBe(200)
    expect(created[0].amount).toBe(51_500)
    expect(created[0].metadata.payment_type).toBe('partial')
    expect(created[0].metadata.amountCents).toBe('50000')
    expect(created[0].metadata.depositCents).toBe('50000')
    expect(created[0].metadata.cardFeeCents).toBe('1500')
    expect((await res.json()).chargeCents).toBe(51_500)
  })

  it('refuses under $50 and creates no PaymentIntent', async () => {
    seed()
    for (const cents of [1, 100, 4_999]) {
      __resetRateLimitForTests()
      const res: any = await POST(req({ paymentMethod: 'card', purpose: 'partial', amountCents: cents }))
      expect([cents, res.status]).toEqual([cents, 409])
    }
    expect(created).toHaveLength(0)
  })

  it('refuses a missing / zero / negative amount with a 400', async () => {
    seed()
    for (const bad of [undefined, 0, -5_000]) {
      __resetRateLimitForTests()
      const res: any = await POST(req({ paymentMethod: 'card', purpose: 'partial', amountCents: bad }))
      expect([bad, res.status]).toEqual([bad, 400])
    }
    expect(created).toHaveLength(0)
  })

  it('CLAMPS an over-payment to the $1,450 still owed and records it final', async () => {
    seed()
    const res: any = await POST(req({ paymentMethod: 'card', purpose: 'partial', amountCents: 9_999_999 }))
    expect(res.status).toBe(200)
    expect(created[0].metadata.amountCents).toBe('145000')
    expect(created[0].metadata.payment_type).toBe('final')
  })

  it('refuses a part payment while the deposit is still owed', async () => {
    seed({ payments: [], booking: { status: 'lead', balance_due_cents: 145_000 } })
    const res: any = await POST(req({ paymentMethod: 'card', purpose: 'partial', amountCents: 50_000 }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/deposit first/i)
    expect(created).toHaveLength(0)
  })

  it('takes NO tip — a part payment is not the final one, and this is a studio', async () => {
    seed()
    await POST(req({ paymentMethod: 'card', purpose: 'partial', amountCents: 50_000, tipCents: 10_000 }))
    expect(created[0].metadata.tipCents).toBe('0')
    expect(created[0].amount).toBe(51_500)
  })

  it('ignores a body paymentType: a customer cannot name their own ledger type', async () => {
    seed()
    await POST(req({ paymentMethod: 'card', purpose: 'partial', amountCents: 50_000, paymentType: 'deposit' }))
    expect(created[0].metadata.payment_type).toBe('partial')
  })
})

describe('purpose: deposit', () => {
  it('derives $250 from the plan and charges $257.50, whatever the body says', async () => {
    seed({ payments: [], booking: { status: 'lead', balance_due_cents: 145_000 } })
    const res: any = await POST(req({ paymentMethod: 'card', purpose: 'deposit', amountCents: 100 }))
    expect(res.status).toBe(200)
    expect(created[0].amount).toBe(25_750)
    expect(created[0].metadata.payment_type).toBe('deposit')
    expect(created[0].metadata.amountCents).toBe('25000')
    expect(created[0].metadata.depositCents).toBe('25000')
  })

  it('refuses a deposit that is already paid', async () => {
    seed()
    const res: any = await POST(req({ paymentMethod: 'card', purpose: 'deposit' }))
    expect(res.status).toBe(409)
    expect(created).toHaveLength(0)
  })
})

describe('tips follow purposeAcceptsTip', () => {
  const PARTY = { party_type: 'in_studio_theme', package_type: 'Glow' }

  it('a party WITH a team may tip on the balance — and the tip rides on top of the fee base', async () => {
    seed({ booking: PARTY })
    await POST(req({ paymentMethod: 'card', purpose: 'balance', tipCents: 10_000 }))
    // (145,000 + 10,000) * 3% = 4,650 ; charge = 159,650 ; credited stays 145,000.
    expect(created[0].metadata.tipCents).toBe('10000')
    expect(created[0].metadata.cardFeeCents).toBe('4650')
    expect(created[0].metadata.amountCents).toBe('145000')
    expect(created[0].amount).toBe(159_650)
  })

  it('a studio rental is the room: the same request carries no tip', async () => {
    seed()
    await POST(req({ paymentMethod: 'card', purpose: 'balance', tipCents: 10_000 }))
    expect(created[0].metadata.tipCents).toBe('0')
    expect(created[0].amount).toBe(149_350)
  })
})

describe('the standing guards still hold on a purposeful request', () => {
  it('a CANCELLED booking takes nothing, whichever purpose', async () => {
    for (const purpose of ['deposit', 'balance', 'partial']) {
      __resetRateLimitForTests()
      seed({ booking: { status: 'cancelled' } })
      const res: any = await POST(req({ paymentMethod: 'card', purpose, amountCents: 50_000 }))
      expect([purpose, res.status]).toEqual([purpose, 409])
    }
    expect(created).toHaveLength(0)
  })

  it('an unknown purpose is a 400, not a fallback to the request amount', async () => {
    seed()
    for (const purpose of ['custom', 'refund', 'final', 7, {}]) {
      __resetRateLimitForTests()
      const res: any = await POST(req({ paymentMethod: 'card', purpose, amountCents: 50_000 }))
      expect([String(purpose), res.status]).toEqual([String(purpose), 400])
    }
    expect(created).toHaveLength(0)
  })

  it('"refund" is still not a customer word as a paymentType', async () => {
    seed()
    const res: any = await POST(req({ paymentMethod: 'card', purpose: 'balance', paymentType: 'refund' }))
    expect(res.status).toBe(400)
    expect(created).toHaveLength(0)
  })

  it('an unreadable invoice refuses a purposeful request — it does not fall back to the browser figure', async () => {
    const db = seed()
    db.breakReadsOn('booking_line_items')
    const res: any = await POST(req({ paymentMethod: 'card', purpose: 'partial', amountCents: 50_000 }))
    expect(res.status).toBe(503)
    expect(created).toHaveLength(0)
  })
})

describe('the legacy no-purpose caller (/my-booking) is unchanged — except for the floor', () => {
  it('still picks its own amount, up to the ceiling', async () => {
    seed()
    await POST(req({ paymentMethod: 'card', amountCents: 20_000 }))
    expect(created[0].metadata.amountCents).toBe('20000')
    expect(created[0].metadata.payment_type).toBe('partial')
  })

  it('a $1 "partial" is now refused on the server too, as the page always said ("Minimum $50")', async () => {
    seed()
    const res: any = await POST(req({ paymentMethod: 'card', amountCents: 100, paymentType: 'partial' }))
    expect(res.status).toBe(400)
    expect(created).toHaveLength(0)
  })

  it('but clearing the last $30 is allowed: the floor is min($50, what is left)', async () => {
    seed({
      booking: { balance_due_cents: 3_000 },
      payments: [{ id: 'p-2', booking_id: 'bk-xy', amount_cents: 167_000, payment_type: 'partial' }],
    })
    const res: any = await POST(req({ paymentMethod: 'card', amountCents: 3_000 }))
    expect(res.status).toBe(200)
    expect(created[0].metadata.payment_type).toBe('final')
  })
})
