/**
 * The four things the Phase 5 review found by EXERCISING the recording path in
 * production, each of which cost money or hid money (plan §22).
 *
 *   1. `payment_status: 'unpaid'` was recorded as a full payment. A delayed
 *      method can still FAIL, and because the session id is unique, taking it
 *      early means the later `async_payment_succeeded` is swallowed as a
 *      redelivery and `async_payment_failed` is invisible.
 *   2. `amount_total: null` inserted a $0 payment row and burnt the session id,
 *      so a corrected redelivery would look like a duplicate.
 *   3. An overpayment was clamped to a $0 balance with no flag anywhere. Proven
 *      live: a $600 link minted, the plan re-priced DOWN to $300, the link paid
 *      — `paid_in_full`, and the $300 owed back visible nowhere.
 *   4. A FAILED `booking_line_items` read was indistinguishable from an empty
 *      plan, so `totalCents` came out 0 and the plan was marked `paid_in_full`
 *      with a zero balance. That one lives in planInvoice.test and
 *      planInvoiceReadFailure.test; this file covers the consequence.
 */

import type Stripe from 'stripe'
import { recordPlanPayment, type PlanPayTarget } from '@/lib/planPayment'
import { makePlanDb, writesTo, type Result } from '../mocks/planDb'

jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ from: () => ({}) }) }))

const BOOKING = {
  id: 'bk-1',
  booking_ref: 'HH-2026-TEST',
  status: 'quoted',
  party_type: 'in_studio_theme',
  event_type: null,
  package_type: null,
  invoice_number: '444124-000116',
  contact_name: 'Test Person',
  contact_email: 'adam@easternbuilding.supply',
  contact_phone: '+16314008080',
  party_date: '2026-10-03',
  party_time: '11:00',
  guest_count_approx: 10,
  child_name: null,
  child_age: null,
  party_tags: null,
  notes: null,
  total_cents: 60000,
  deposit_amount: 25000,
  balance_due_cents: 60000,
  created_at: null,
}

const item = (cents: number) => [
  { name: 'Party Package', category: 'package', quantity: 1, unit_price_cents: cents, price_type: 'flat', guest_multiplied: false, sort_order: 0, is_featured: true },
]

const session = (over: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session =>
  ({
    id: 'cs_test_1',
    amount_total: 61800,
    payment_status: 'paid',
    payment_intent: 'pi_test_1',
    payment_link: 'plink_1',
    metadata: {},
    ...over,
  }) as Stripe.Checkout.Session

const target = (over: Partial<PlanPayTarget> = {}): PlanPayTarget => ({
  payLinkId: 'row-1',
  bookingRef: 'HH-2026-TEST',
  purpose: 'balance',
  expectedAmountCents: 60000,
  feeCents: 1800,
  fromMetadataOnly: false,
  ...over,
})

function recordDb(opts: { lineItems?: unknown[]; lineItemsError?: { message: string } | null; paymentsAfter?: unknown[] } = {}) {
  const itemsResult: Result = opts.lineItemsError
    ? { data: null, error: opts.lineItemsError }
    : { data: opts.lineItems ?? item(30000), error: null }
  return makePlanDb({
    bookings: [{ data: BOOKING, error: null }, { data: null, error: null }, { data: null, error: null }],
    booking_line_items: [itemsResult],
    pricing_items: [{ data: [], error: null }],
    plan_content: [{ data: [], error: null }],
    booking_payments: [
      { data: [], error: null },
      { data: null, error: null },
      { data: opts.paymentsAfter ?? [{ payment_type: 'final', amount_cents: 60000 }], error: null },
    ],
    booking_pay_links: [{ data: null, error: null }],
    booking_modifications: [{ data: null, error: null }],
    financial_transactions: [{ data: null, error: null }],
    marketing_ledger: [{ data: null, error: null }],
  })
}

describe('recordPlanPayment — only money that has actually settled', () => {
  it('does NOT record a session whose payment_status is still unpaid', async () => {
    const db = recordDb()
    const res = await recordPlanPayment(target(), session({ payment_status: 'unpaid' }), db as never)
    expect(res.ok).toBe(false)
    expect(writesTo(db, 'booking_payments', 'insert')).toHaveLength(0)
    expect(writesTo(db, 'financial_transactions', 'insert')).toHaveLength(0)
  })

  it('does not ask Stripe to retry an unpaid session — the async event is what brings it back', async () => {
    // A 500 would make Stripe redeliver the SAME still-unpaid `completed` event
    // for three days, and it would be unpaid every time.
    const db = recordDb()
    const res = await recordPlanPayment(target(), session({ payment_status: 'unpaid' }), db as never)
    expect(res).toMatchObject({ ok: false, retryable: false })
  })

  it('records normally once the same session reports paid', async () => {
    const db = recordDb()
    const res = await recordPlanPayment(target(), session({ payment_status: 'paid' }), db as never)
    expect(res.ok).toBe(true)
    expect(writesTo(db, 'booking_payments', 'insert')).toHaveLength(1)
  })

  it('refuses to write a $0 row for a session with amount_total null', async () => {
    // The row would consume the UNIQUE session id, so a corrected redelivery
    // would then be swallowed as a duplicate and the real money lost.
    const db = recordDb()
    const res = await recordPlanPayment(target(), session({ amount_total: null }), db as never)
    expect(res).toMatchObject({ ok: false, retryable: false })
    expect(writesTo(db, 'booking_payments', 'insert')).toHaveLength(0)
  })

  it('refuses a zero-amount session too', async () => {
    const db = recordDb()
    const res = await recordPlanPayment(target(), session({ amount_total: 0 }), db as never)
    expect(res.ok).toBe(false)
    expect(writesTo(db, 'booking_payments', 'insert')).toHaveLength(0)
  })
})

describe('recordPlanPayment — an overpayment is named, not clamped into silence', () => {
  it('reports how much more was credited than the plan owes', async () => {
    // The live case: a $600 link, the plan then re-priced DOWN to $300, the old
    // link paid. `mismatch` cannot see this — what Stripe collected and what the
    // LINK expected agree exactly.
    const db = recordDb({ lineItems: item(30000), paymentsAfter: [{ payment_type: 'final', amount_cents: 60000 }] })
    const res = await recordPlanPayment(target(), session(), db as never)
    expect(res).toMatchObject({ ok: true, newBalanceCents: 0, overpaidCents: 30000 })
  })

  it('says so in the ledger and in the plan history, where a human will see it', async () => {
    const db = recordDb({ lineItems: item(30000) })
    await recordPlanPayment(target(), session(), db as never)
    const note = writesTo(db, 'marketing_ledger', 'insert')[0].payload as Record<string, unknown>
    expect(note.meta).toMatchObject({ overpaid_cents: 30000 })
    const mod = writesTo(db, 'booking_modifications', 'insert')[0].payload as Record<string, unknown>
    expect(String(mod.change_summary)).toMatch(/OVERPAID by \$300\.00/)
  })

  it('reports zero when the payment simply clears the plan', async () => {
    const db = recordDb({ lineItems: item(60000) })
    const res = await recordPlanPayment(target(), session(), db as never)
    expect(res).toMatchObject({ ok: true, newBalanceCents: 0, overpaidCents: 0 })
    const mod = writesTo(db, 'booking_modifications', 'insert')[0].payload as Record<string, unknown>
    expect(String(mod.change_summary)).not.toMatch(/OVERPAID/)
  })

  it('raises nothing on a redelivery, which changed nothing', async () => {
    const db = makePlanDb({
      bookings: [{ data: BOOKING, error: null }, { data: { balance_due_cents: 0 }, error: null }],
      booking_line_items: [{ data: item(30000), error: null }],
      pricing_items: [{ data: [], error: null }],
      plan_content: [{ data: [], error: null }],
      booking_payments: [
        { data: [], error: null },
        { data: null, error: { message: 'duplicate key', code: '23505' } },
      ],
    })
    const res = await recordPlanPayment(target(), session(), db as never)
    expect(res).toMatchObject({ ok: true, duplicate: true, overpaidCents: 0 })
  })
})

describe('recordPlanPayment — a plan whose items could not be read', () => {
  it('asks Stripe to come back rather than marking the plan paid in full', async () => {
    // Before the fix, a failed `booking_line_items` read yielded totalCents 0,
    // and `max(0, 0 - paid)` wrote balance 0 + `paid_in_full`. Reproduced in
    // production on a throwaway plan: a $600 payment against a plan whose items
    // were gone marked it PAID IN FULL with nothing outstanding.
    const db = recordDb({ lineItemsError: { message: 'connection reset' } })
    const res = await recordPlanPayment(target(), session(), db as never)
    expect(res).toMatchObject({ ok: false, retryable: true })
    expect(writesTo(db, 'booking_payments', 'insert')).toHaveLength(0)
    expect(writesTo(db, 'bookings', 'update')).toHaveLength(0)
  })
})
