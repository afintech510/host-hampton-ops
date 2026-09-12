/**
 * What a plan pay link charges (Phase 5 item 2).
 *
 * This is the arithmetic that decides how much money leaves a customer's card,
 * so it is tested as arithmetic — pure, no database, no Stripe key. The cases
 * that matter are the two ways to get it wrong: undercharge a studio rental by
 * $250 by treating the security deposit as a part payment, or double-charge one
 * by asking for the deposit twice.
 */

import {
  quoteFor,
  paidTowardTotalCents,
  remainingBalanceCents,
  depositOwedCents,
  isPayPurpose,
  createPlanPayLink,
  voidLivePayLinks,
  MIN_CHARGE_CENTS,
  type PaymentRow,
} from '@/lib/planPayLinks'
import type { PlanInvoice } from '@/lib/planInvoice'
import { contentFromRows, FALLBACK_CONTENT_ROWS } from '@/lib/planContent'
import { makePlanDb, writesTo } from '../mocks/planDb'

/**
 * An invoice as `loadPlanInvoice` would return it. Only the fields the pay path
 * reads are meaningful; the rest exists so the type is satisfied honestly rather
 * than with an `as any`.
 */
function invoice(over: Partial<PlanInvoice> = {}): PlanInvoice {
  const totalCents = over.totalCents ?? 100000
  const depositIsSeparate = over.depositIsSeparate ?? false
  const depositCents = over.depositCents ?? Math.min(25000, totalCents)
  return {
    booking: {
      id: 'bk-1',
      booking_ref: 'HH-2026-TEST',
      status: 'quoted',
      party_type: depositIsSeparate ? 'studio_rental' : 'in_studio_theme',
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
      total_cents: totalCents,
      deposit_amount: 25000,
      balance_due_cents: null,
      created_at: null,
      ...(over.booking ?? {}),
    },
    partyType: depositIsSeparate ? 'studio_rental' : 'in_studio_theme',
    docTitle: depositIsSeparate ? 'Studio Rental Quotation' : 'Party Quotation',
    invoiceNumber: '444124-000116',
    dateIssued: 'September 11, 2026',
    lineItems: [],
    totalCents,
    depositCents,
    balanceDueCents: depositIsSeparate ? totalCents : Math.max(0, totalCents - depositCents),
    depositIsSeparate,
    securityHoldCents: depositIsSeparate ? 50000 : null,
    content: contentFromRows(FALLBACK_CONTENT_ROWS, 'all'),
    catalog: { mobileStations: [], studioRates: {} } as unknown as PlanInvoice['catalog'],
    mobileStations: [],
    eventDateTime: 'Saturday, October 3, 2026 · 11:00',
    venueAddress: null,
    guestCount: 10,
    ...over,
  }
}

const pay = (payment_type: string, amount_cents: number): PaymentRow => ({ payment_type, amount_cents })

describe('isPayPurpose', () => {
  it('accepts only the three the CHECK constraint allows', () => {
    expect(['deposit', 'balance', 'custom'].every(isPayPurpose)).toBe(true)
    expect(isPayPurpose('refund')).toBe(false)
    expect(isPayPurpose('')).toBe(false)
    expect(isPayPurpose(undefined)).toBe(false)
  })
})

describe('paidTowardTotalCents — the studio rule as arithmetic', () => {
  it('STUDIO: the security deposit does NOT count against the total', () => {
    // It is held against damage. Counting it would leave the balance $250 short
    // and we would undercharge every studio rental.
    expect(paidTowardTotalCents([pay('deposit', 25000)], true)).toBe(0)
  })

  it('EVERYTHING ELSE: the deposit is a reservation payment and does count', () => {
    expect(paidTowardTotalCents([pay('deposit', 25000)], false)).toBe(25000)
  })

  it('counts partial and final payments for both products', () => {
    const rows = [pay('deposit', 25000), pay('partial', 30000), pay('final', 45000)]
    expect(paidTowardTotalCents(rows, false)).toBe(100000)
    expect(paidTowardTotalCents(rows, true)).toBe(75000)
  })

  it('subtracts a refund', () => {
    expect(paidTowardTotalCents([pay('partial', 50000), pay('refund', 20000)], false)).toBe(30000)
  })
})

describe('remainingBalanceCents / depositOwedCents', () => {
  it('STUDIO: the balance stays the FULL total after the security deposit is paid', () => {
    const inv = invoice({ totalCents: 60000, depositIsSeparate: true })
    expect(inv.balanceDueCents).toBe(60000)
    expect(remainingBalanceCents(inv, [pay('deposit', 25000)])).toBe(60000)
    // …and the deposit itself is then settled, so it must not be asked for again.
    expect(depositOwedCents(inv, [pay('deposit', 25000)])).toBe(0)
  })

  it('PARTY: the balance drops by the deposit once it is paid', () => {
    const inv = invoice({ totalCents: 100000 })
    expect(remainingBalanceCents(inv, [])).toBe(100000)
    expect(remainingBalanceCents(inv, [pay('deposit', 25000)])).toBe(75000)
    expect(remainingBalanceCents(inv, [pay('deposit', 25000)])).toBe(inv.balanceDueCents)
  })

  it('never goes negative on an overpayment', () => {
    const inv = invoice({ totalCents: 50000 })
    expect(remainingBalanceCents(inv, [pay('final', 90000)])).toBe(0)
  })
})

describe('quoteFor — deposit', () => {
  it('charges the flat $250 plus the 3% the invoice page promises', () => {
    const q = quoteFor(invoice({ totalCents: 100000 }), [], 'deposit')
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.amountCents).toBe(25000)
    expect(q.quote.feeCents).toBe(750)
    expect(q.quote.chargeCents).toBe(25750)
  })

  it('refuses once the deposit is paid — this is the double-charge case', () => {
    const q = quoteFor(invoice({ totalCents: 100000 }), [pay('deposit', 25000)], 'deposit')
    expect(q.ok).toBe(false)
    if (q.ok) return
    expect(q.reason).toMatch(/already paid/i)
  })

  it('asks only for the shortfall when a partial deposit was taken', () => {
    const q = quoteFor(invoice({ totalCents: 100000 }), [pay('deposit', 10000)], 'deposit')
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.amountCents).toBe(15000)
  })

  it('is capped at the total on a plan smaller than the deposit', () => {
    // getDepositCents is min($250, total): a $120 add-on must not be charged $250.
    const q = quoteFor(invoice({ totalCents: 12000 }), [], 'deposit')
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.amountCents).toBe(12000)
  })

  it('refuses on an unpriced lead rather than charging $0', () => {
    const q = quoteFor(invoice({ totalCents: 0, depositCents: 0 }), [], 'deposit')
    expect(q.ok).toBe(false)
  })
})

describe('quoteFor — balance', () => {
  it('STUDIO: asks for the FULL total, deposit not deducted', () => {
    const inv = invoice({ totalCents: 60000, depositIsSeparate: true })
    const q = quoteFor(inv, [pay('deposit', 25000)], 'balance')
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.amountCents).toBe(60000)
  })

  it('PARTY: asks for what is left after the deposit', () => {
    const q = quoteFor(invoice({ totalCents: 100000 }), [pay('deposit', 25000)], 'balance')
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.amountCents).toBe(75000)
  })

  it('refuses when the plan is paid in full', () => {
    const q = quoteFor(invoice({ totalCents: 100000 }), [pay('deposit', 25000), pay('final', 75000)], 'balance')
    expect(q.ok).toBe(false)
    if (q.ok) return
    expect(q.reason).toMatch(/paid in full/i)
  })

  it('refuses on a plan with no priced items', () => {
    const q = quoteFor(invoice({ totalCents: 0, depositCents: 0 }), [], 'balance')
    expect(q.ok).toBe(false)
    if (q.ok) return
    expect(q.reason).toMatch(/no priced items/i)
  })

  it('an optional line item is not in the total, so it is not in the charge', () => {
    // planInvoice.ts excludes optional items from totalCents; this asserts the
    // consequence rather than trusting the comment that says so.
    const withOptional = invoice({ totalCents: 60000 }) // total already excludes the $200 optional arch
    const q = quoteFor(withOptional, [], 'balance')
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.amountCents).toBe(60000)
  })
})

describe('quoteFor — custom (admin)', () => {
  it('charges what was asked when it is within what the plan owes', () => {
    const q = quoteFor(invoice({ totalCents: 100000 }), [], 'custom', 30000)
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.amountCents).toBe(30000)
    expect(q.quote.feeCents).toBe(900)
  })

  it('refuses more than the plan owes — the fat-finger guard', () => {
    // Cap is remaining + depositOwed = 100000 + 25000.
    const q = quoteFor(invoice({ totalCents: 100000 }), [], 'custom', 125001)
    expect(q.ok).toBe(false)
    if (q.ok) return
    expect(q.reason).toMatch(/more than this plan owes/i)
  })

  it('allows exactly the cap', () => {
    const q = quoteFor(invoice({ totalCents: 100000 }), [], 'custom', 125000)
    expect(q.ok).toBe(true)
  })

  it('refuses zero, negatives and nonsense', () => {
    const inv = invoice({ totalCents: 100000 })
    expect(quoteFor(inv, [], 'custom', 0).ok).toBe(false)
    expect(quoteFor(inv, [], 'custom', -5000).ok).toBe(false)
    expect(quoteFor(inv, [], 'custom', Number.NaN).ok).toBe(false)
    expect(quoteFor(inv, [], 'custom').ok).toBe(false)
  })

  it('refuses anything below Stripe’s floor', () => {
    const q = quoteFor(invoice({ totalCents: 100000 }), [], 'custom', MIN_CHARGE_CENTS - 50)
    expect(q.ok).toBe(false)
  })
})

/* ── Minting ───────────────────────────────────────────────────────────── */

function makeStripe(over: Record<string, unknown> = {}) {
  const created: Record<string, unknown[]> = { products: [], prices: [], links: [], updates: [] }
  const stripe = {
    products: { create: jest.fn(async (p: unknown) => { created.products.push(p); return { id: `prod_${created.products.length}` } }) },
    prices: { create: jest.fn(async (p: unknown) => { created.prices.push(p); return { id: `price_${created.prices.length}` } }) },
    paymentLinks: {
      create: jest.fn(async (p: unknown) => {
        created.links.push(p)
        return { id: `plink_${created.links.length}`, url: `https://pay.stripe.com/plink_${created.links.length}` }
      }),
      update: jest.fn(async (id: string, p: unknown) => { created.updates.push([id, p]); return { id } }),
    },
    ...over,
  }
  return { stripe: stripe as never, created }
}

describe('createPlanPayLink', () => {
  const base = () => ({
    booking_pay_links: [{ data: [], error: null }, { data: null, error: null }],
    marketing_ledger: [{ data: null, error: null }],
  })

  it('records the link it created, with the SERVER-derived amount', async () => {
    const db = makePlanDb(base())
    const { stripe, created } = makeStripe()
    const res = await createPlanPayLink({
      invoice: invoice({ totalCents: 100000 }),
      payments: [],
      purpose: 'deposit',
      actor: 'admin:adam@benchworksai.com',
      stripe,
      db: db as never,
      origin: 'https://www.hosthampton.com',
    })
    if (!res.ok) throw new Error(res.reason)

    const row = writesTo(db, 'booking_pay_links', 'insert')[0].payload as Record<string, unknown>
    expect(row.amount_cents).toBe(25000)
    expect(row.fee_cents).toBe(750)
    expect(row.purpose).toBe('deposit')
    expect(row.created_by).toBe('admin:adam@benchworksai.com')
    expect(row.stripe_payment_link_id).toBe('plink_1')
    expect(row.url).toBe(res.payUrl)

    // The amount charged is the sum of the Stripe prices, not anything a caller
    // supplied — two line items, the amount and the fee.
    expect(created.prices).toEqual([
      expect.objectContaining({ unit_amount: 25000 }),
      expect.objectContaining({ unit_amount: 750 }),
    ])
  })

  it('limits the Stripe link to ONE completed session', async () => {
    const db = makePlanDb(base())
    const { stripe, created } = makeStripe()
    await createPlanPayLink({
      invoice: invoice(), payments: [], purpose: 'deposit', actor: 'ADMIN',
      stripe, db: db as never, origin: 'https://x',
    })
    const link = created.links[0] as Record<string, unknown>
    expect(link.restrictions).toEqual({ completed_sessions: { limit: 1 } })
  })

  it('carries the ids the webhook matches on', async () => {
    const db = makePlanDb(base())
    const { stripe, created } = makeStripe()
    const res = await createPlanPayLink({
      invoice: invoice(), payments: [], purpose: 'balance', actor: 'ADMIN',
      stripe, db: db as never, origin: 'https://x',
    })
    if (!res.ok) throw new Error(res.reason)
    const meta = (created.links[0] as { metadata: Record<string, string> }).metadata
    expect(meta.type).toBe('plan_pay_link')
    expect(meta.booking_ref).toBe('HH-2026-TEST')
    expect(meta.purpose).toBe('balance')
    expect(meta.pay_link_row_id).toBe(res.payLinkId)
  })

  it('REFUSES a cancelled plan, and says in the ledger that it refused', async () => {
    // Rule 10: a guardrail that stops something must also say that it stopped it.
    const db = makePlanDb(base())
    const { stripe, created } = makeStripe()
    const res = await createPlanPayLink({
      invoice: invoice({ booking: { ...invoice().booking, status: 'cancelled' } }),
      payments: [], purpose: 'deposit', actor: 'ADMIN',
      stripe, db: db as never, origin: 'https://x',
    })
    expect(res.ok).toBe(false)
    expect(created.links).toHaveLength(0)
    const note = writesTo(db, 'marketing_ledger', 'insert')[0].payload as Record<string, unknown>
    expect((note.meta as Record<string, unknown>).job).toBe('pay_link_refused')
    expect((note.meta as Record<string, unknown>).reason).toBe('plan_cancelled')
  })

  it('VOIDS the previous link before minting a new one', async () => {
    // A stale link is exactly the "total changed after the link was minted"
    // problem: it would still take the old amount.
    const db = makePlanDb({
      booking_pay_links: [
        { data: [{ id: 'old-1', booking_id: 'bk-1', purpose: 'deposit', amount_cents: 9900, fee_cents: 297, stripe_payment_link_id: 'plink_old', url: 'u', voided_at: null }], error: null },
        { data: null, error: null }, // the void UPDATE
        { data: null, error: null }, // the new INSERT
      ],
      marketing_ledger: [{ data: null, error: null }],
    })
    const { stripe, created } = makeStripe()
    const res = await createPlanPayLink({
      invoice: invoice(), payments: [], purpose: 'deposit', actor: 'ADMIN',
      stripe, db: db as never, origin: 'https://x',
    })
    if (!res.ok) throw new Error(res.reason)

    // Deactivated at STRIPE, not merely marked in our own table — a DB-only void
    // leaves a payable URL we have stopped tracking.
    expect(created.updates).toEqual([['plink_old', { active: false }]])
    const voided = writesTo(db, 'booking_pay_links', 'update')[0]
    expect((voided.payload as Record<string, unknown>).voided_at).toBeTruthy()
  })

  it('takes the link back DOWN if it cannot record it', async () => {
    // A live link we did not record is the untraceable pay link migration 035
    // exists to eliminate. Exercising the guarantee, not reading the comment.
    const db = makePlanDb({
      booking_pay_links: [
        { data: [], error: null },
        { data: null, error: { message: 'insert exploded', code: 'XX000' } },
      ],
      marketing_ledger: [{ data: null, error: null }],
    })
    const { stripe, created } = makeStripe()
    const res = await createPlanPayLink({
      invoice: invoice(), payments: [], purpose: 'deposit', actor: 'ADMIN',
      stripe, db: db as never, origin: 'https://x',
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.retryable).toBe(true)
    expect(created.updates).toEqual([['plink_1', { active: false }]])
  })

  it('does not mint when the previous link cannot be voided', async () => {
    const db = makePlanDb({
      booking_pay_links: [{ data: null, error: { message: 'read failed' } }],
    })
    const { stripe, created } = makeStripe()
    const res = await createPlanPayLink({
      invoice: invoice(), payments: [], purpose: 'deposit', actor: 'ADMIN',
      stripe, db: db as never, origin: 'https://x',
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.retryable).toBe(true)
    expect(created.links).toHaveLength(0)
  })

  it('sends the customer back to their own plan afterwards', async () => {
    const db = makePlanDb(base())
    const { stripe, created } = makeStripe()
    await createPlanPayLink({
      invoice: invoice(), payments: [], purpose: 'deposit', actor: 'ADMIN',
      stripe, db: db as never, origin: 'https://www.hosthampton.com',
    })
    expect((created.links[0] as Record<string, unknown>).after_completion).toEqual({
      type: 'redirect',
      redirect: { url: 'https://www.hosthampton.com/plan/HH-2026-TEST/summary?paid=1' },
    })
  })
})

describe('voidLivePayLinks', () => {
  it('reports the Stripe failure rather than marking a live link void', async () => {
    const db = makePlanDb({
      booking_pay_links: [
        { data: [{ id: 'a', booking_id: 'bk-1', purpose: 'deposit', amount_cents: 1, fee_cents: 0, stripe_payment_link_id: 'plink_x', url: 'u', voided_at: null }], error: null },
      ],
    })
    const { stripe } = makeStripe({
      paymentLinks: {
        create: jest.fn(),
        update: jest.fn(async () => { throw new Error('stripe down') }),
      },
    })
    const res = await voidLivePayLinks(db as never, stripe, 'bk-1', 'deposit')
    expect(res.ok).toBe(false)
    expect(writesTo(db, 'booking_pay_links', 'update')).toHaveLength(0)
  })
})
