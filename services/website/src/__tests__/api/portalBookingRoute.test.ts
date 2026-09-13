/**
 * `/api/portal/booking` — the customer editing their own booking, driven.
 *
 * Two things this route got wrong, and both are about a value the CUSTOMER
 * chooses reaching somewhere it should not:
 *
 * 1. **`guest_count_approx` is a money input.** `loadPlanInvoice()` computes a
 *    guest-multiplied line item as `unit_price × quantity × guest_count_approx`,
 *    and `/api/plan/[ref]/pay-link` — which accepts a PORTAL COOKIE for
 *    `purpose: 'deposit' | 'balance'` — derives the Stripe charge from that
 *    invoice, as does `recordPlanPayment`'s `newBalanceCents`. The bound here was
 *    `0 ≤ n ≤ 10_000`: **zero** removes every per-head charge from the invoice,
 *    and ten thousand multiplies a $20/head item to $200,000. Link 20 screened
 *    `unit_price_cents` because the browser chose it; the MULTIPLIER still came
 *    from the browser, through the one route link 20 left out of its rules.
 *
 * 2. **`party_date` is nullable and this route cast it to a string.**
 *    `isModificationAllowed` runs `partyDateStr.split('-')` immediately, so a
 *    plan with no date yet — three rows today, one of them a live `lead` —
 *    answered **500** from the customer's own portal, on both the GET and the
 *    PATCH.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: async () => body, body }),
  },
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))

// Rule 7: spread the real module so a function the route later imports is not
// silently dropped.
jest.mock('@/lib/portalAuth', () => ({
  ...jest.requireActual('@/lib/portalAuth'),
  getPortalBookingRef: () => 'HH-PTY-TEST1',
  portalSigningSecret: () => 'test-secret',
}))

import { GET, PATCH } from '@/app/api/portal/booking/route'
import { __resetRateLimitForTests } from '@/lib/rateLimit'
import { MAX_PUBLIC_GUEST_COUNT } from '@/lib/publicIntake'
import { makeFakeMoneyDb } from '../helpers/fakeMoneyDb'

/** A real shape: HH-PTY-BVLMX carries $20/head and a party far enough out to edit. */
const FAR_FUTURE = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10)

const BOOKING = {
  id: 'bk-1',
  booking_ref: 'HH-PTY-TEST1',
  status: 'approved',
  party_date: FAR_FUTURE,
  party_tags: {},
  guest_count_approx: 10,
  notes: 'original notes',
  child_name: 'Ava',
  child_age: 7,
}

const req = (body: any): any => ({
  headers: { get: (n: string) => (n === 'cookie' ? 'hh_portal=x' : null) },
  json: async () => body,
})

function seed(overrides: Record<string, unknown> = {}) {
  const db = makeFakeMoneyDb({
    bookings: [{ ...BOOKING, ...overrides }],
    booking_line_items: [],
    booking_payments: [],
    booking_modifications: [],
  })
  mockGetSupabase.mockReturnValue(db.client as any)
  return db
}

beforeEach(() => {
  jest.clearAllMocks()
  __resetRateLimitForTests()
})

describe('the guest count is a money input', () => {
  it('refuses zero, which removes every per-head charge from the invoice', async () => {
    const db = seed()
    const res: any = await PATCH(req({ guest_count_approx: 0 }))
    expect(res.status).toBe(400)
    expect(db.rows('bookings')[0].guest_count_approx).toBe(10)
  })

  it('refuses a negative count', async () => {
    const db = seed()
    expect((await PATCH(req({ guest_count_approx: -5 })) as any).status).toBe(400)
    expect(db.rows('bookings')[0].guest_count_approx).toBe(10)
  })

  it('refuses a count above the shared ceiling', async () => {
    const db = seed()
    const res: any = await PATCH(req({ guest_count_approx: MAX_PUBLIC_GUEST_COUNT + 1 }))
    expect(res.status).toBe(400)
    // The old bound. 10,000 × a $20/head item is a $200,000 invoice.
    expect((await PATCH(req({ guest_count_approx: 10_000 })) as any).status).toBe(400)
    expect(db.rows('bookings')[0].guest_count_approx).toBe(10)
  })

  it('refuses the shapes a crafted body sends', async () => {
    const db = seed()
    for (const v of [1.5, '12.5', NaN, Infinity, {}, [], true, '10; DROP']) {
      expect([v, ((await PATCH(req({ guest_count_approx: v }))) as any).status]).toEqual([v, 400])
    }
    expect(db.rows('bookings')[0].guest_count_approx).toBe(10)
  })

  it('STILL accepts a real headcount change, which is the whole product', async () => {
    // The expensive direction. The largest real guest count in production is 65.
    for (const n of [1, 6, 19, 65, MAX_PUBLIC_GUEST_COUNT]) {
      __resetRateLimitForTests()
      const db = seed()
      const res: any = await PATCH(req({ guest_count_approx: n }))
      expect([n, res.status]).toEqual([n, 200])
      expect(db.rows('bookings')[0].guest_count_approx).toBe(n)
    }
  })
})

describe('the audit row says what changed FROM', () => {
  it('records the old value, not a literal null', async () => {
    const db = seed()
    await PATCH(req({ guest_count_approx: 22, notes: 'more kids' }))
    const mod = db.rows('booking_modifications')[0]
    expect(mod).toBeDefined()
    expect(mod.modified_by).toBe('customer')
    expect(mod.old_data).toMatchObject({ guest_count_approx: 10, notes: 'original notes' })
    expect(mod.new_data).toMatchObject({ guest_count_approx: 22, notes: 'more kids' })
  })

  it('NAMES the guest-count move in the summary a human reads', async () => {
    // `change_summary` is what the Parties tab and the portal render. It is the
    // only place the per-head consequence surfaces, because `total_cents` is
    // deliberately not recomputed here — see needs-Adam 44.
    const db = seed()
    await PATCH(req({ guest_count_approx: 2 }))
    const summary = String(db.rows('booking_modifications')[0].change_summary)
    expect(summary).toContain('10')
    expect(summary).toContain('2')
    expect(summary).toMatch(/per-head/i)
  })

  it('the modified_by the route writes is one the CHECK accepts', async () => {
    // `booking_modifications_modified_by_check` allows customer|admin|system|
    // ADMIN|admin:%. A route that wrote anything else would have its audit row
    // refused — silently, before rule 19 was applied here.
    const db = seed()
    await PATCH(req({ notes: 'hello' }))
    expect(db.rows('booking_modifications')).toHaveLength(1)
  })
})

describe('a party_date that is not set', () => {
  it('does not 500 the GET for a plan with no date yet', async () => {
    const db = seed({ party_date: null, status: 'lead' })
    const res: any = await GET(req({}))
    expect(res.status).toBe(200)
    // No cutoff to be past, so the plan is open.
    expect(res.body.permissions.canEditFull).toBe(true)
    expect(res.body.permissions.canEditGuestCount).toBe(true)
    expect(db.rows('bookings')).toHaveLength(1)
  })

  it('does not 500 the PATCH either, and the edit lands', async () => {
    const db = seed({ party_date: null, status: 'lead' })
    const res: any = await PATCH(req({ guest_count_approx: 12 }))
    expect(res.status).toBe(200)
    expect(db.rows('bookings')[0].guest_count_approx).toBe(12)
  })
})

describe('a cancelled booking is not one a customer edits', () => {
  it('the PATCH refuses it even though its date is months away', async () => {
    const db = seed({ status: 'cancelled' })
    const res: any = await PATCH(req({ guest_count_approx: 25 }))
    expect(res.status).toBe(409)
    expect(db.rows('bookings')[0].guest_count_approx).toBe(10)
    expect(db.rows('booking_modifications')).toHaveLength(0)
  })

  it('and the GET does not offer an editor the PATCH will reject (rule 10)', async () => {
    seed({ status: 'cancelled' })
    const res: any = await GET(req({}))
    expect(res.status).toBe(200)
    expect(res.body.permissions.canEditFull).toBe(false)
    expect(res.body.permissions.canEditGuestCount).toBe(false)
    expect(String(res.body.permissions.fullReason)).toMatch(/cancelled/i)
  })
})

describe('the date cutoff still owns the rest', () => {
  it('refuses a full edit inside T-14 and a guest change inside T-7', async () => {
    const inFiveDays = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10)
    seed({ party_date: inFiveDays })
    expect(((await PATCH(req({ notes: 'x' }))) as any).status).toBe(403)
    expect(((await PATCH(req({ guest_count_approx: 20 }))) as any).status).toBe(403)
  })

  it('a guest change is still allowed between T-14 and T-7', async () => {
    const inTenDays = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10)
    const db = seed({ party_date: inTenDays })
    expect(((await PATCH(req({ guest_count_approx: 20 }))) as any).status).toBe(200)
    expect(db.rows('bookings')[0].guest_count_approx).toBe(20)
    // …while a full edit at the same moment is not.
    expect(((await PATCH(req({ notes: 'x' }))) as any).status).toBe(403)
  })
})
