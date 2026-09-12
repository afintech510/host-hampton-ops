/**
 * Recording a plan payment (Phase 5 item 3).
 *
 * These are the cases that cost money if they are wrong, so each one is
 * EXERCISED rather than asserted from a comment:
 *
 *   * a redelivered webhook must not record a second payment;
 *   * a read failure must not be reported as "no such pay link", because a 200
 *     tells Stripe to stop retrying and the payment is then lost;
 *   * the credit is what Stripe collected, never what we hoped to charge — which
 *     is what makes a link minted before the total changed safe;
 *   * a legacy admin pay link must still fall through to its own handler;
 *   * a payment on a cancelled plan is recorded anyway, because the money is real.
 */

import type Stripe from 'stripe'
import { matchPlanPayLink, recordPlanPayment, type PlanPayTarget } from '@/lib/planPayment'
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
  total_cents: 100000,
  deposit_amount: 25000,
  balance_due_cents: 75000,
  created_at: null,
}

const LINE_ITEMS = [
  { name: 'Party Package', category: 'package', quantity: 1, unit_price_cents: 100000, price_type: 'flat', guest_multiplied: false, sort_order: 0, is_featured: true },
]

const session = (over: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session =>
  ({
    id: 'cs_test_1',
    amount_total: 25750,
    payment_intent: 'pi_test_1',
    payment_link: 'plink_1',
    metadata: {
      type: 'plan_pay_link',
      booking_ref: 'HH-2026-TEST',
      booking_id: 'bk-1',
      purpose: 'deposit',
      pay_link_row_id: 'row-1',
      amount_cents: '25000',
      fee_cents: '750',
    },
    ...over,
  }) as Stripe.Checkout.Session

const PAY_LINK_ROW = {
  id: 'row-1',
  booking_id: 'bk-1',
  purpose: 'deposit',
  amount_cents: 25000,
  fee_cents: 750,
  stripe_payment_link_id: 'plink_1',
  url: 'https://pay.stripe.com/plink_1',
  voided_at: null,
}

const target = (over: Partial<PlanPayTarget> = {}): PlanPayTarget => ({
  payLinkId: 'row-1',
  bookingRef: 'HH-2026-TEST',
  purpose: 'deposit',
  expectedAmountCents: 25000,
  feeCents: 750,
  fromMetadataOnly: false,
  ...over,
})

/**
 * The read sequence `recordPlanPayment` performs, in order:
 *   bookings (invoice), booking_line_items, pricing_items, plan_content,
 *   booking_payments (before), booking_payments (insert), booking_pay_links
 *   (void), booking_payments (after), bookings (balance), bookings (status),
 *   booking_modifications, financial_transactions, marketing_ledger
 */
function recordDb(opts: {
  booking?: Record<string, unknown> | null
  bookingError?: { message: string } | null
  paymentsBefore?: unknown[]
  insertError?: { message: string; code?: string } | null
  paymentsAfter?: unknown[]
  statusError?: { message: string } | null
} = {}) {
  const bookingResult: Result = opts.bookingError
    ? { data: null, error: opts.bookingError }
    : { data: opts.booking === undefined ? BOOKING : opts.booking, error: null }

  return makePlanDb({
    bookings: [
      bookingResult,
      { data: null, error: null }, // balance update
      { data: null, error: opts.statusError ?? null }, // status update
    ],
    booking_line_items: [{ data: LINE_ITEMS, error: null }],
    pricing_items: [{ data: [], error: null }],
    plan_content: [{ data: [], error: null }],
    booking_payments: [
      { data: opts.paymentsBefore ?? [], error: null },
      { data: null, error: opts.insertError ?? null }, // the insert
      { data: opts.paymentsAfter ?? [{ payment_type: 'deposit', amount_cents: 25000 }], error: null },
    ],
    booking_pay_links: [{ data: null, error: null }],
    booking_modifications: [{ data: null, error: null }],
    financial_transactions: [{ data: null, error: null }],
    marketing_ledger: [{ data: null, error: null }],
  })
}

/* ── matchPlanPayLink ──────────────────────────────────────────────────── */

describe('matchPlanPayLink', () => {
  it('matches on our own row id', async () => {
    const db = makePlanDb({
      booking_pay_links: [{ data: PAY_LINK_ROW, error: null }],
      bookings: [{ data: { booking_ref: 'HH-2026-TEST' }, error: null }],
    })
    const res = await matchPlanPayLink(session(), db as never)
    expect(res.outcome).toBe('matched')
    if (res.outcome !== 'matched') return
    expect(res.target).toMatchObject({
      payLinkId: 'row-1',
      bookingRef: 'HH-2026-TEST',
      purpose: 'deposit',
      expectedAmountCents: 25000,
      feeCents: 750,
      fromMetadataOnly: false,
    })
  })

  it('matches on the Stripe link id when the metadata is gone', async () => {
    const db = makePlanDb({
      booking_pay_links: [{ data: PAY_LINK_ROW, error: null }],
      bookings: [{ data: { booking_ref: 'HH-2026-TEST' }, error: null }],
    })
    const res = await matchPlanPayLink(session({ metadata: {} }), db as never)
    expect(res.outcome).toBe('matched')
  })

  it('a READ FAILURE is "could not tell", NOT "not ours"', async () => {
    // Hard-won rule 12. Collapsing this into `unmatched` would let the event fall
    // through to the legacy handler, which writes no booking_payments row — a
    // real payment recorded nowhere.
    const db = makePlanDb({ booking_pay_links: [{ data: null, error: { message: 'connection reset' } }] })
    const res = await matchPlanPayLink(session(), db as never)
    expect(res.outcome).toBe('error')
  })

  it('leaves a LEGACY admin pay link alone', async () => {
    // /api/admin/pay-link also makes Stripe Payment Links. No row, and its
    // metadata does not claim to be ours, so it must fall through untouched.
    const db = makePlanDb({ booking_pay_links: [{ data: null, error: null }] })
    const res = await matchPlanPayLink(
      session({ metadata: { type: 'pay_link', customerName: 'Someone', amountCents: '5000' } }),
      db as never,
    )
    expect(res.outcome).toBe('unmatched')
  })

  it('leaves an unrelated checkout (a ticket) alone without querying at all', async () => {
    const db = makePlanDb({})
    const res = await matchPlanPayLink(
      session({ metadata: { type: 'event_ticket' }, payment_link: null }),
      db as never,
    )
    expect(res.outcome).toBe('unmatched')
    expect(db.reads.booking_pay_links).toBeUndefined()
  })

  it('falls back to metadata when the row has been deleted, so the money is not lost', async () => {
    const db = makePlanDb({ booking_pay_links: [{ data: null, error: null }] })
    const res = await matchPlanPayLink(session(), db as never)
    expect(res.outcome).toBe('matched')
    if (res.outcome !== 'matched') return
    expect(res.target.fromMetadataOnly).toBe(true)
    expect(res.target.payLinkId).toBeNull()
    expect(res.target.expectedAmountCents).toBe(25000)
  })

  it('treats a pay link with no booking as an error, not a miss', async () => {
    const db = makePlanDb({
      booking_pay_links: [{ data: PAY_LINK_ROW, error: null }],
      bookings: [{ data: null, error: null }],
    })
    const res = await matchPlanPayLink(session(), db as never)
    expect(res.outcome).toBe('error')
  })
})

/* ── recordPlanPayment ─────────────────────────────────────────────────── */

describe('recordPlanPayment', () => {
  it('records the payment with the fee separated out', async () => {
    const db = recordDb()
    const res = await recordPlanPayment(target(), session(), db as never)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.duplicate).toBe(false)

    const row = writesTo(db, 'booking_payments', 'insert')[0].payload as Record<string, unknown>
    expect(row).toMatchObject({
      booking_id: 'bk-1',
      payment_type: 'deposit',
      payment_method: 'card',
      amount_cents: 25000,
      card_fee_cents: 750,
      total_charged_cents: 25750,
      stripe_session_id: 'cs_test_1',
      stripe_payment_intent_id: 'pi_test_1',
      // The CHECK constraint allows only 'system' | 'admin'; the webhook is
      // never a person, and who minted the link lives on booking_pay_links.
      recorded_by: 'system',
    })
  })

  it('a REDELIVERED webhook is a success, not a second payment', async () => {
    // Stripe redelivers as a matter of course. idx_bp_stripe_session is UNIQUE on
    // stripe_session_id; 23505 means already-recorded.
    const db = recordDb({ insertError: { message: 'duplicate key value', code: '23505' } })
    const res = await recordPlanPayment(target(), session(), db as never)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.duplicate).toBe(true)
    // Nothing downstream re-runs: no balance rewrite, no audit row, no ledger row.
    expect(writesTo(db, 'bookings', 'update')).toHaveLength(0)
    expect(writesTo(db, 'booking_modifications', 'insert')).toHaveLength(0)
    expect(writesTo(db, 'marketing_ledger', 'insert')).toHaveLength(0)
  })

  it('detects the unique violation by CODE, not by message text', async () => {
    const db = recordDb({ insertError: { message: 'some other wording entirely', code: '23505' } })
    const res = await recordPlanPayment(target(), session(), db as never)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.duplicate).toBe(true)
  })

  it('asks Stripe to RETRY when the insert fails for any other reason', async () => {
    // The money is real and unrecorded. Acknowledging would lose it.
    const db = recordDb({ insertError: { message: 'deadlock detected', code: '40P01' } })
    const res = await recordPlanPayment(target(), session(), db as never)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.retryable).toBe(true)
  })

  it('asks Stripe to RETRY when the plan cannot be read', async () => {
    const db = recordDb({ bookingError: { message: 'connection reset' } })
    const res = await recordPlanPayment(target(), session(), db as never)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.retryable).toBe(true)
    expect(writesTo(db, 'booking_payments', 'insert')).toHaveLength(0)
  })

  it('does NOT retry forever when the plan genuinely does not exist', async () => {
    const db = recordDb({ booking: null })
    const res = await recordPlanPayment(target(), session(), db as never)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.retryable).toBe(false)
  })

  it('credits what Stripe COLLECTED, not what the link expected', async () => {
    // The "plan whose total changed after the link was minted" case. A link for
    // $250 + $7.50 paid before the plan was re-priced still collected $257.50;
    // crediting the new figure would credit money nobody paid.
    const db = recordDb()
    const res = await recordPlanPayment(
      target({ expectedAmountCents: 90000, feeCents: 2700 }),
      session({ amount_total: 25750 }),
      db as never,
    )
    if (!res.ok) throw new Error(res.message)
    const row = writesTo(db, 'booking_payments', 'insert')[0].payload as Record<string, unknown>
    expect(row.total_charged_cents).toBe(25750)
    expect(row.amount_cents).toBe(25750 - 2700)
    expect(row.card_fee_cents).toBe(2700)
    expect(String(row.notes)).toMatch(/link expected/i)
  })

  it('never lets a small charge produce a negative credit', async () => {
    const db = recordDb()
    const res = await recordPlanPayment(
      target({ expectedAmountCents: 90000, feeCents: 2700 }),
      session({ amount_total: 500 }),
      db as never,
    )
    if (!res.ok) throw new Error(res.message)
    const row = writesTo(db, 'booking_payments', 'insert')[0].payload as Record<string, unknown>
    expect(row.amount_cents).toBe(0)
    expect(row.card_fee_cents).toBe(500)
  })

  it('recomputes the balance from the payment rows, not from the link', async () => {
    const db = recordDb({
      paymentsAfter: [{ payment_type: 'deposit', amount_cents: 25000 }],
    })
    const res = await recordPlanPayment(target(), session(), db as never)
    if (!res.ok) throw new Error(res.message)
    expect(res.newBalanceCents).toBe(75000)
    const bal = writesTo(db, 'bookings', 'update')[0].payload as Record<string, unknown>
    expect(bal.balance_due_cents).toBe(75000)
    expect(bal.paid_in_full_at).toBeUndefined()
  })

  it('STUDIO: the security deposit does not reduce the balance', async () => {
    const db = recordDb({
      booking: { ...BOOKING, party_type: 'studio_rental' },
      paymentsAfter: [{ payment_type: 'deposit', amount_cents: 25000 }],
    })
    const res = await recordPlanPayment(target(), session(), db as never)
    if (!res.ok) throw new Error(res.message)
    // Full total still owed — the $250 is held against damage.
    expect(res.newBalanceCents).toBe(100000)
  })

  it('marks paid in full and stamps the date when nothing is left', async () => {
    const db = recordDb({
      paymentsBefore: [{ payment_type: 'deposit', amount_cents: 25000 }],
      paymentsAfter: [
        { payment_type: 'deposit', amount_cents: 25000 },
        { payment_type: 'final', amount_cents: 75000 },
      ],
    })
    const res = await recordPlanPayment(
      target({ purpose: 'balance', expectedAmountCents: 75000, feeCents: 2250 }),
      session({ amount_total: 77250, id: 'cs_test_2' }),
      db as never,
    )
    if (!res.ok) throw new Error(res.message)
    expect(res.newBalanceCents).toBe(0)

    const row = writesTo(db, 'booking_payments', 'insert')[0].payload as Record<string, unknown>
    expect(row.payment_type).toBe('final')
    const bal = writesTo(db, 'bookings', 'update')[0].payload as Record<string, unknown>
    expect(bal.paid_in_full_at).toBeTruthy()
    const status = writesTo(db, 'bookings', 'update')[1].payload as Record<string, unknown>
    expect(status.status).toBe('paid_in_full')
  })

  it('a part payment against the balance is recorded as partial', async () => {
    const db = recordDb({
      paymentsBefore: [{ payment_type: 'deposit', amount_cents: 25000 }],
      paymentsAfter: [
        { payment_type: 'deposit', amount_cents: 25000 },
        { payment_type: 'partial', amount_cents: 30000 },
      ],
    })
    const res = await recordPlanPayment(
      target({ purpose: 'custom', expectedAmountCents: 30000, feeCents: 900 }),
      session({ amount_total: 30900, id: 'cs_test_3' }),
      db as never,
    )
    if (!res.ok) throw new Error(res.message)
    const row = writesTo(db, 'booking_payments', 'insert')[0].payload as Record<string, unknown>
    expect(row.payment_type).toBe('partial')
    expect(res.newBalanceCents).toBe(45000)
  })

  it('RECORDS a payment on a CANCELLED plan, flags it, and does not advance status', async () => {
    // The money is real. Dropping it would leave a charge with no row anywhere;
    // whether to refund is Adam's call.
    const db = recordDb({ booking: { ...BOOKING, status: 'cancelled' } })
    const res = await recordPlanPayment(target(), session(), db as never)
    expect(res.ok).toBe(true)

    const row = writesTo(db, 'booking_payments', 'insert')[0].payload as Record<string, unknown>
    expect(String(row.notes)).toMatch(/CANCELLED/)
    // Balance is written; status is not touched.
    const updates = writesTo(db, 'bookings', 'update')
    expect(updates).toHaveLength(1)
    expect((updates[0].payload as Record<string, unknown>).balance_due_cents).toBeDefined()

    const note = writesTo(db, 'marketing_ledger', 'insert')[0].payload as Record<string, unknown>
    expect((note.meta as Record<string, unknown>).plan_was_cancelled).toBe(true)
  })

  it('keeps the balance even when the status change is REFUSED by the constraint', async () => {
    // bookings_scheduled_fields_check re-imposes date + time + name past
    // lead/quoted, so an unscheduled plan cannot legally be deposit_paid. The
    // balance write must survive that refusal — it is the number both sides read.
    const db = recordDb({ statusError: { message: 'violates check constraint "bookings_scheduled_fields_check"' } })
    const res = await recordPlanPayment(target(), session(), db as never)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.newBalanceCents).toBe(75000)
    const bal = writesTo(db, 'bookings', 'update')[0].payload as Record<string, unknown>
    expect(bal.balance_due_cents).toBe(75000)
    expect(bal.status).toBeUndefined()
  })

  it('consumes the pay link, guarded so a redelivery cannot reopen it', async () => {
    const db = recordDb()
    await recordPlanPayment(target(), session(), db as never)
    const voided = writesTo(db, 'booking_pay_links', 'update')[0]
    expect((voided.payload as Record<string, unknown>).voided_at).toBeTruthy()
    expect(voided.filters).toEqual(expect.arrayContaining([['is:voided_at', null]]))
  })

  it('records the ledger note a human can audit', async () => {
    const db = recordDb()
    await recordPlanPayment(target(), session(), db as never)
    const note = writesTo(db, 'marketing_ledger', 'insert')[0].payload as Record<string, unknown>
    expect(note.actor).toBe('system')
    expect(note.action).toBe('note')
    expect(note.meta).toMatchObject({
      job: 'plan_payment_recorded',
      purpose: 'deposit',
      pay_link_id: 'row-1',
      stripe_session_id: 'cs_test_1',
      amount_cents: 25000,
      charged_cents: 25750,
    })
  })

  it('records the financial transaction against the Stripe session, so a replay dedupes', async () => {
    const db = recordDb()
    await recordPlanPayment(target(), session(), db as never)
    const txn = writesTo(db, 'financial_transactions', 'insert')[0].payload as Record<string, unknown>
    expect(txn.reference).toBe('stripe-cs_test_1')
    expect(txn.amount_cents).toBe(25750)
    expect(txn.source).toBe('stripe')
  })
})
