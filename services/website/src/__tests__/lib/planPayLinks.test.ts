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
  isPayPurpose,
  createPlanPayLink,
  voidLivePayLinks,
  purposeAcceptsTip,
  MIN_CHARGE_CENTS,
} from '@/lib/planPayLinks'
import { hasPartyTeam, paidTowardTotalCents, planMoney, type PaymentRow } from '@/lib/planBalance'
import {
  MAX_TIP_CENTS,
  TIP_PRESET_PERCENTS,
  recommendedTipCents,
  tipCentsForPercent,
} from '@/lib/partyPricing'
import type { PlanInvoice } from '@/lib/planInvoice'
import { contentFromRows, FALLBACK_CONTENT_ROWS } from '@/lib/planContent'
import { makePlanDb, writesTo } from '../mocks/planDb'

/**
 * An invoice as `loadPlanInvoice` would return it. Only the fields the pay path
 * reads are meaningful; the rest exists so the type is satisfied honestly rather
 * than with an `as any`.
 *
 * The money fields are derived by `planMoney()` — the same function production
 * derives them with — rather than hand-written here. A factory that computes the
 * answer its own way is a factory that can agree with a broken implementation,
 * which is hard-won rule 8 pointed at the test rather than the code. `payments`
 * is the input that moves them, because since link 23 the invoice carries the
 * payment rows and `quoteFor` no longer takes them separately.
 */
function invoice(over: Partial<PlanInvoice> & { payments?: PaymentRow[] } = {}): PlanInvoice {
  const totalCents = over.totalCents ?? 100000
  const depositIsSeparate = over.depositIsSeparate ?? false
  const depositCents = over.depositCents ?? Math.min(25000, totalCents)
  const payments = over.payments ?? []
  const m = planMoney({ totalCents, depositCents, depositIsSeparate, payments })
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
    balanceDueCents: m.balanceDueCents,
    depositOwedCents: m.depositOwedCents,
    outstandingCents: m.outstandingCents,
    paidCents: m.paidCents,
    overpaidCents: m.overpaidCents,
    payments,
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

describe('planMoney — outstanding, deposit owed and the balance the document prints', () => {
  it('STUDIO: the balance stays the FULL total after the security deposit is paid', () => {
    const inv = invoice({ totalCents: 60000, depositIsSeparate: true })
    expect(inv.balanceDueCents).toBe(60000)
    const paid = invoice({ totalCents: 60000, depositIsSeparate: true, payments: [pay('deposit', 25000)] })
    expect(paid.outstandingCents).toBe(60000)
    // …and the deposit itself is then settled, so it must not be asked for again.
    expect(paid.depositOwedCents).toBe(0)
  })

  it('PARTY: the balance drops by the deposit once it is paid', () => {
    expect(invoice({ totalCents: 100000 }).outstandingCents).toBe(100000)
    const paid = invoice({ totalCents: 100000, payments: [pay('deposit', 25000)] })
    expect(paid.outstandingCents).toBe(75000)
    expect(paid.balanceDueCents).toBe(75000)
  })

  it('never goes negative on an overpayment, and names the overpayment', () => {
    const inv = invoice({ totalCents: 50000, payments: [pay('final', 90000)] })
    expect(inv.outstandingCents).toBe(0)
    expect(inv.overpaidCents).toBe(40000)
  })

  it('deposit owed + balance due === everything outstanding, when the deposit comes off the total', () => {
    // The invariant the document's own layout promises: the callout and the
    // "Balance Due" line add up to what the customer actually still owes. It did
    // not hold before link 23 — "Balance Due" was a quote-time figure.
    for (const payments of [[], [pay('partial', 9900)], [pay('deposit', 10000)], [pay('partial', 60000)]]) {
      const inv = invoice({ totalCents: 159000, payments })
      expect(inv.depositOwedCents + inv.balanceDueCents).toBe(inv.outstandingCents)
    }
  })
})

describe('quoteFor — deposit', () => {
  it('charges the flat $250 plus the 3% the invoice page promises', () => {
    const q = quoteFor(invoice({ totalCents: 100000 }), 'deposit')
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.amountCents).toBe(25000)
    expect(q.quote.feeCents).toBe(750)
    expect(q.quote.chargeCents).toBe(25750)
  })

  it('refuses once the deposit is paid — this is the double-charge case', () => {
    const q = quoteFor(invoice({ totalCents: 100000, payments: [pay('deposit', 25000)] }), 'deposit')
    expect(q.ok).toBe(false)
    if (q.ok) return
    expect(q.reason).toMatch(/already paid/i)
  })

  it('asks only for the shortfall when a partial deposit was taken', () => {
    const q = quoteFor(invoice({ totalCents: 100000, payments: [pay('deposit', 10000)] }), 'deposit')
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.amountCents).toBe(15000)
  })

  it('is capped at the total on a plan smaller than the deposit', () => {
    // getDepositCents is min($250, total): a $120 add-on must not be charged $250.
    const q = quoteFor(invoice({ totalCents: 12000 }), 'deposit')
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.amountCents).toBe(12000)
  })

  it('refuses on an unpriced lead rather than charging $0', () => {
    const q = quoteFor(invoice({ totalCents: 0, depositCents: 0 }), 'deposit')
    expect(q.ok).toBe(false)
  })

  /**
   * THE $257.50 BUTTON ON A SETTLED PLAN.
   *
   * `depositOwedCents` used to ask only "has a `payment_type = 'deposit'` row
   * been recorded". Only 2 of the 18 real payments in production carry that
   * type — every hand-entered one is `partial` — so a plan paid IN FULL by
   * `partial` rows still owed its whole notional deposit. Measured in
   * production 2026-09-13 on a throwaway plan paid $600.00 of $600.00:
   * `/plan/<ref>/summary` rendered a live "Pay $250.00 deposit" button and
   * `POST /api/plan/<ref>/pay-link {"purpose":"deposit"}` answered 200 with a
   * real chargeable Stripe Payment Link.
   */
  it('refuses on a plan paid in full by payments typed anything but `deposit`', () => {
    const inv = invoice({ totalCents: 60000, payments: [pay('partial', 60000)] })
    expect(inv.outstandingCents).toBe(0)
    const q = quoteFor(inv, 'deposit')
    expect(q.ok).toBe(false)
    if (q.ok) return
    expect(q.reason).toMatch(/paid in full/i)
  })

  it('refuses once the deposit itself has been covered, whatever the rows are typed', () => {
    // $550 paid of $600. The $250 that books the date was covered long ago, so
    // there is no deposit to quote — the $50 left is a BALANCE, and the balance
    // quote below is what offers it. Asking for a "deposit" here is how
    // HH-PTY-F47YW came to demand $250 from a customer who had paid $300.
    const inv = invoice({ totalCents: 60000, payments: [pay('partial', 55000)] })
    const deposit = quoteFor(inv, 'deposit')
    expect(deposit.ok).toBe(false)

    const balance = quoteFor(inv, 'balance')
    if (!balance.ok) throw new Error(balance.reason)
    expect(balance.quote.amountCents).toBe(5000)
  })

  it('quotes the REMAINDER of the deposit while part of it is still owed', () => {
    // $100 of a $600 party: $150 of the $250 still books the date.
    const q = quoteFor(invoice({ totalCents: 60000, payments: [pay('partial', 10000)] }), 'deposit')
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.amountCents).toBe(15000)
  })

  it('STUDIO: the security deposit is NOT capped by the total, because it is not part of it', () => {
    // A fully-paid studio rental still owes its refundable $250 hold. This is
    // the half of the cap that must NOT fire, and it is what
    // STUDIO_DEPOSIT_IS_SEPARATE selects.
    const inv = invoice({ totalCents: 47500, depositIsSeparate: true, payments: [pay('final', 47500)] })
    expect(inv.outstandingCents).toBe(0)
    const q = quoteFor(inv, 'deposit')
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.amountCents).toBe(25000)
  })
})

describe('quoteFor — balance', () => {
  it('STUDIO: asks for the FULL total, deposit not deducted', () => {
    const inv = invoice({ totalCents: 60000, depositIsSeparate: true, payments: [pay('deposit', 25000)] })
    const q = quoteFor(inv, 'balance')
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.amountCents).toBe(60000)
  })

  it('PARTY: asks for what is left after the deposit', () => {
    const q = quoteFor(invoice({ totalCents: 100000, payments: [pay('deposit', 25000)] }), 'balance')
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.amountCents).toBe(75000)
  })

  it('refuses when the plan is paid in full', () => {
    const q = quoteFor(
      invoice({ totalCents: 100000, payments: [pay('deposit', 25000), pay('final', 75000)] }),
      'balance',
    )
    expect(q.ok).toBe(false)
    if (q.ok) return
    expect(q.reason).toMatch(/paid in full/i)
  })

  it('refuses on a plan with no priced items', () => {
    const q = quoteFor(invoice({ totalCents: 0, depositCents: 0 }), 'balance')
    expect(q.ok).toBe(false)
    if (q.ok) return
    expect(q.reason).toMatch(/no priced items/i)
  })

  it('an optional line item is not in the total, so it is not in the charge', () => {
    // planInvoice.ts excludes optional items from totalCents; this asserts the
    // consequence rather than trusting the comment that says so.
    const withOptional = invoice({ totalCents: 60000 }) // total already excludes the $200 optional arch
    const q = quoteFor(withOptional, 'balance')
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.amountCents).toBe(60000)
  })
})

/* ── The tip (2026-09-20, migration 057) ────────────────────────────────── */

describe('quoteFor — gratuity', () => {
  const priced = () => invoice({ totalCents: 125000, payments: [pay('deposit', 25000)] })

  it('rides on top of the balance and is never credited against it', () => {
    const q = quoteFor(priced(), 'balance', undefined, 12500)
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.amountCents).toBe(100000) // unchanged by the tip
    expect(q.quote.tipCents).toBe(12500)
  })

  it('is fee-bearing, exactly as the portal computes it', () => {
    const q = quoteFor(priced(), 'balance', undefined, 12500)
    if (!q.ok) throw new Error(q.reason)
    // 3% of (amount + tip), not of the amount alone.
    expect(q.quote.feeCents).toBe(Math.round((100000 + 12500) * 0.03))
    expect(q.quote.chargeCents).toBe(100000 + 12500 + q.quote.feeCents)
  })

  it('can only ever RAISE the charge — which is why the body may carry it', () => {
    const without = quoteFor(priced(), 'balance')
    const with_ = quoteFor(priced(), 'balance', undefined, 12500)
    if (!without.ok || !with_.ok) throw new Error('both should quote')
    expect(with_.quote.chargeCents).toBeGreaterThan(without.quote.chargeCents)
    expect(with_.quote.amountCents).toBe(without.quote.amountCents)
  })

  it('is dropped on a deposit — a gratuity for a party that has not happened', () => {
    const q = quoteFor(invoice({ totalCents: 125000 }), 'deposit', undefined, 12500)
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.tipCents).toBe(0)
    expect(q.quote.chargeCents).toBe(25000 + Math.round(25000 * 0.03))
  })

  it('is dropped on an admin custom charge', () => {
    const q = quoteFor(priced(), 'custom', 30000, 12500)
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.tipCents).toBe(0)
  })

  it('is clamped at the ceiling rather than refused', () => {
    const q = quoteFor(priced(), 'balance', undefined, 999_999_99)
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.tipCents).toBe(MAX_TIP_CENTS)
  })

  it('refuses to go negative, and shrugs off junk', () => {
    for (const junk of [-5000, NaN, Infinity, 'lots', null, undefined, {}]) {
      const q = quoteFor(priced(), 'balance', undefined, junk)
      if (!q.ok) throw new Error(q.reason)
      expect(q.quote.tipCents).toBe(0)
      expect(q.quote.chargeCents).toBe(100000 + Math.round(100000 * 0.03))
    }
  })

  it('rounds a fractional tip to the cent rather than sending Stripe a float', () => {
    const q = quoteFor(priced(), 'balance', undefined, 1234.6)
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.tipCents).toBe(1235)
    expect(Number.isInteger(q.quote.chargeCents)).toBe(true)
  })
})

/* ── A studio rental has nobody to tip (Adam, 2026-09-23) ─────────────────── */

describe('the tip jar is off on a studio rental', () => {
  /**
   * A studio rental where the deposit is NOT separate — which is every studio
   * rental since needs-Adam 41 was ruled. The shared fixture couples
   * `partyType` to `depositIsSeparate`, and that coupling is exactly what this
   * rule must not inherit: the tip question is about whether we STAFF the
   * party, not about how its deposit is accounted for. Overriding `partyType`
   * alone is the point of the test.
   */
  const studio = () =>
    invoice({
      totalCents: 60000,
      partyType: 'studio_rental',
      payments: [pay('deposit', 25000)],
    })

  it('hasPartyTeam is false for a studio rental and true for the staffed products', () => {
    expect(hasPartyTeam('studio_rental')).toBe(false)
    for (const t of ['in_studio_theme', 'mobile_party', 'unknown', null, undefined]) {
      expect(hasPartyTeam(t)).toBe(true)
    }
  })

  it('purposeAcceptsTip needs BOTH the balance and a team', () => {
    expect(purposeAcceptsTip('balance', 'in_studio_theme')).toBe(true)
    expect(purposeAcceptsTip('balance', 'mobile_party')).toBe(true)
    // The product rule, which is the new half.
    expect(purposeAcceptsTip('balance', 'studio_rental')).toBe(false)
    // The purpose rule, which must survive it.
    expect(purposeAcceptsTip('deposit', 'in_studio_theme')).toBe(false)
    expect(purposeAcceptsTip('deposit', 'studio_rental')).toBe(false)
  })

  it('drops a tip sent on a studio rental balance instead of charging it', () => {
    const q = quoteFor(studio(), 'balance', undefined, 12500)
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.tipCents).toBe(0)
    // And the customer is charged the balance and the fee on the balance ALONE
    // — the tip must not survive into the fee either.
    expect(q.quote.amountCents).toBe(35000)
    expect(q.quote.feeCents).toBe(Math.round(35000 * 0.03))
    expect(q.quote.chargeCents).toBe(35000 + Math.round(35000 * 0.03))
  })

  it('still lets a studio rental pay its balance — dropped, never refused', () => {
    const q = quoteFor(studio(), 'balance', undefined, 12500)
    expect(q.ok).toBe(true)
  })

  it('leaves the tip working on the products that do send a team', () => {
    const q = quoteFor(
      invoice({ totalCents: 60000, partyType: 'mobile_party', payments: [pay('deposit', 25000)] }),
      'balance',
      undefined,
      12500,
    )
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.tipCents).toBe(12500)
  })
})

describe('recommendedTipCents — the 10% we state out loud', () => {
  it('is 10% of the total, rounded to a whole dollar', () => {
    expect(recommendedTipCents(125000)).toBe(12500)
    expect(recommendedTipCents(95000)).toBe(9500)
    // $1,234.00 → $123.40 → $123.00
    expect(recommendedTipCents(123400)).toBe(12300)
  })

  it('is nothing on an unpriced plan, so the document cannot suggest $0.00', () => {
    expect(recommendedTipCents(0)).toBe(0)
    expect(recommendedTipCents(-1)).toBe(0)
  })

  it('offers no-tip first, and the presets are whole dollars', () => {
    expect(TIP_PRESET_PERCENTS[0]).toBe(0)
    for (const p of TIP_PRESET_PERCENTS) {
      expect(tipCentsForPercent(123400, p) % 100).toBe(0)
    }
  })
})

describe('quoteFor — custom (admin)', () => {
  it('charges what was asked when it is within what the plan owes', () => {
    const q = quoteFor(invoice({ totalCents: 100000 }), 'custom', 30000)
    if (!q.ok) throw new Error(q.reason)
    expect(q.quote.amountCents).toBe(30000)
    expect(q.quote.feeCents).toBe(900)
  })

  it('refuses more than the plan owes — the fat-finger guard', () => {
    // Cap is remaining + depositOwed = 100000 + 25000.
    const q = quoteFor(invoice({ totalCents: 100000 }), 'custom', 125001)
    expect(q.ok).toBe(false)
    if (q.ok) return
    expect(q.reason).toMatch(/more than this plan owes/i)
  })

  it('allows exactly the cap', () => {
    const q = quoteFor(invoice({ totalCents: 100000 }), 'custom', 125000)
    expect(q.ok).toBe(true)
  })

  it('refuses zero, negatives and nonsense', () => {
    const inv = invoice({ totalCents: 100000 })
    expect(quoteFor(inv, 'custom', 0).ok).toBe(false)
    expect(quoteFor(inv, 'custom', -5000).ok).toBe(false)
    expect(quoteFor(inv, 'custom', Number.NaN).ok).toBe(false)
    expect(quoteFor(inv, 'custom').ok).toBe(false)
  })

  it('refuses anything below Stripe’s floor', () => {
    const q = quoteFor(invoice({ totalCents: 100000 }), 'custom', MIN_CHARGE_CENTS - 50)
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
      invoice: invoice(), purpose: 'deposit', actor: 'ADMIN',
      stripe, db: db as never, origin: 'https://x',
    })
    const link = created.links[0] as Record<string, unknown>
    expect(link.restrictions).toEqual({ completed_sessions: { limit: 1 } })
  })

  it('carries the ids the webhook matches on', async () => {
    const db = makePlanDb(base())
    const { stripe, created } = makeStripe()
    const res = await createPlanPayLink({
      invoice: invoice(), purpose: 'balance', actor: 'ADMIN',
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
      purpose: 'deposit', actor: 'ADMIN',
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
      invoice: invoice(), purpose: 'deposit', actor: 'ADMIN',
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
      invoice: invoice(), purpose: 'deposit', actor: 'ADMIN',
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
      invoice: invoice(), purpose: 'deposit', actor: 'ADMIN',
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
      invoice: invoice(), purpose: 'deposit', actor: 'ADMIN',
      stripe, db: db as never, origin: 'https://www.hosthampton.com',
    })
    expect((created.links[0] as Record<string, unknown>).after_completion).toEqual({
      type: 'redirect',
      redirect: { url: 'https://www.hosthampton.com/plan/HH-2026-TEST/summary?paid=1' },
    })
  })
})

describe('createPlanPayLink — losing the concurrent-mint race (migration 040)', () => {
  /**
   * `voidLivePayLinks` → Stripe create → row insert is three round trips with
   * nothing serialising them. Measured in production BEFORE migration 040: six
   * concurrent mints of the same (booking, purpose) produced SIX simultaneously
   * live, payable Stripe links, and paying two of them charged the same $250
   * deposit twice. §21's "there is never a window with two payable links" was
   * simply false.
   *
   * `idx_bpl_one_live_per_purpose` makes the DB the serialisation point, and the
   * existing failed-insert recovery then does the right thing by itself.
   */
  const raced = () => ({
    booking_pay_links: [
      { data: [], error: null },
      { data: null, error: { message: 'duplicate key value violates unique constraint "idx_bpl_one_live_per_purpose"', code: '23505' } },
    ],
    marketing_ledger: [{ data: null, error: null }],
  })

  const mint = (db: unknown, stripe: unknown) =>
    createPlanPayLink({
      invoice: invoice({ totalCents: 100000 }),
      payments: [],
      purpose: 'deposit',
      actor: 'admin:adam@benchworksai.com',
      stripe: stripe as never,
      db: db as never,
      origin: 'https://www.hosthampton.com',
    })

  it('takes its own Stripe link back down rather than leaving it payable', async () => {
    // A live link we did not record is the untraceable pay link migration 035
    // exists to eliminate — and here it would be a SECOND way to pay the same
    // deposit.
    const db = makePlanDb(raced())
    const { stripe, created } = makeStripe()
    const res = await mint(db, stripe)
    expect(res.ok).toBe(false)
    expect(created.updates).toEqual([['plink_1', { active: false }]])
  })

  it('tells the loser to use the link that won, not that something broke', async () => {
    const db = makePlanDb(raced())
    const { stripe } = makeStripe()
    const res = await mint(db, stripe)
    if (res.ok) throw new Error('expected the race to be lost')
    expect(res.reason).toMatch(/just created/)
    expect(res.retryable).toBe(true)
  })

  it('still says "could not record" for a failure that is NOT a race', async () => {
    const db = makePlanDb({
      booking_pay_links: [{ data: [], error: null }, { data: null, error: { message: 'connection reset' } }],
      marketing_ledger: [{ data: null, error: null }],
    })
    const { stripe } = makeStripe()
    const res = await mint(db, stripe)
    if (res.ok) throw new Error('expected failure')
    expect(res.reason).toMatch(/Could not record/)
  })

  it('writes no ledger "created" note for a link that was not recorded', async () => {
    const db = makePlanDb(raced())
    const { stripe } = makeStripe()
    await mint(db, stripe)
    const notes = writesTo(db, 'marketing_ledger', 'insert').map(
      w => ((w.payload as Record<string, unknown>).meta as Record<string, unknown>).job,
    )
    expect(notes).not.toContain('pay_link_created')
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
