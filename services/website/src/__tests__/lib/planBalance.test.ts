/**
 * The one answer to "what does this party cost and what has been paid".
 *
 * Tested as arithmetic — pure, no database, no Stripe key — because this is the
 * function that decides what a customer is shown and what their card is charged.
 * The cases are the ones that were actually live and wrong, reproduced from the
 * production rows they were measured on (2026-09-13, all 62 bookings).
 */

import {
  STUDIO_DEPOSIT_IS_SEPARATE,
  COLUMN_FOLLOWS_INVOICE,
  billedTotalCents,
  depositIsSeparateFor,
  guestMultiplier,
  paidAsDepositCents,
  paidTowardTotalCents,
  planMoney,
  quoteTimeBalanceCents,
  type BilledItem,
  type PaymentRow,
} from '@/lib/planBalance'

const pay = (payment_type: string, amount_cents: number): PaymentRow => ({ payment_type, amount_cents })
const item = (over: Partial<BilledItem> = {}): BilledItem => ({
  unit_price_cents: 10000,
  quantity: 1,
  guest_multiplied: false,
  ...over,
})

describe('guestMultiplier — the number that multiplies the money', () => {
  it('is the guest count when there is a real one', () => {
    expect(guestMultiplier(14)).toBe(14)
  })

  it('is 1, never 0, for every way the column can be absent', () => {
    // `guest_count_approx` is nullable and has held 0. A multiplier of 0 does not
    // make a per-head line free — it silently deletes it from the invoice, which
    // is a worse failure than charging for one guest.
    for (const v of [null, undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(guestMultiplier(v as number | null)).toBe(1)
    }
  })
})

describe('billedTotalCents — an optional item is quoted, never charged', () => {
  it('sums flat items', () => {
    expect(billedTotalCents([item(), item({ unit_price_cents: 5000, quantity: 2 })], 10)).toBe(20000)
  })

  it('multiplies only the per-head ones', () => {
    expect(billedTotalCents([item({ unit_price_cents: 2500, guest_multiplied: true }), item()], 12)).toBe(40000)
  })

  it('EXCLUDES an optional line item — the defect four of five totals had', () => {
    const rows = [item({ unit_price_cents: 60000 }), item({ unit_price_cents: 20000, is_optional: true })]
    expect(billedTotalCents(rows, 10)).toBe(60000)
  })

  it('treats only a literal `true` as optional, so a null column bills', () => {
    // The column is NOT NULL DEFAULT false, but a row read through a partial
    // select can arrive with it undefined. Undefined must bill, not vanish.
    for (const v of [undefined, null, false]) {
      expect(billedTotalCents([item({ is_optional: v as boolean | null })], 10)).toBe(10000)
    }
  })

  it('is empty-safe', () => {
    expect(billedTotalCents([], 10)).toBe(0)
  })
})

describe('paidTowardTotalCents / paidAsDepositCents', () => {
  it('a refund subtracts', () => {
    expect(paidTowardTotalCents([pay('partial', 50000), pay('refund', 20000)], false)).toBe(30000)
  })

  it('a STUDIO security deposit does not count against the total', () => {
    expect(paidTowardTotalCents([pay('deposit', 25000)], true)).toBe(0)
    expect(paidTowardTotalCents([pay('deposit', 25000)], false)).toBe(25000)
  })

  it('counts a deposit as a deposit only when it is typed as one', () => {
    // 16 of the 18 real payments in production are typed `partial`, including
    // every hand-entered deposit. That is the data reality the cap in
    // `planMoney` has to survive.
    expect(paidAsDepositCents([pay('partial', 25000)])).toBe(0)
    expect(paidAsDepositCents([pay('deposit', 25000)])).toBe(25000)
  })
})

describe('planMoney — the figures the document and the buttons both use', () => {
  const party = (payments: PaymentRow[], totalCents = 60000) =>
    planMoney({ totalCents, depositCents: Math.min(25000, totalCents), depositIsSeparate: false, payments })

  it('a fresh quote reads exactly as the document always has', () => {
    const m = party([])
    expect(m.totalCents).toBe(60000)
    expect(m.depositOwedCents).toBe(25000)
    expect(m.balanceDueCents).toBe(35000)
    expect(m.outstandingCents).toBe(60000)
  })

  /**
   * HH-PTY-6GGMB and HH-PTY-PF3LJ. Both paid in full ($1,725.00 and $1,810.00),
   * both by `partial`/`final` rows, and `/plan/[ref]/summary` showed them
   * "Balance Due: $1,475.00" and "$1,560.00" beside a live "Pay $250.00 deposit"
   * button. Measured in production before this file existed.
   */
  it('a plan paid IN FULL by `partial` rows owes nothing, and asks for nothing', () => {
    const m = party([pay('partial', 60000)])
    expect(m.outstandingCents).toBe(0)
    expect(m.balanceDueCents).toBe(0)
    expect(m.depositOwedCents).toBe(0) // ← the $257.50 button
  })

  it('the deposit is capped by what is left, never by the notional $250 alone', () => {
    expect(party([pay('partial', 55000)]).depositOwedCents).toBe(5000)
    expect(party([pay('partial', 40000)]).depositOwedCents).toBe(20000)
    expect(party([pay('partial', 10000)]).depositOwedCents).toBe(25000)
  })

  /**
   * The invariant the document's own layout promises: the deposit callout and
   * the "Balance Due" line add up to what is actually outstanding. Checked
   * against the real payment shapes on the production rows.
   */
  it('deposit owed + balance due === outstanding, for every payment shape', () => {
    const shapes: PaymentRow[][] = [
      [],
      [pay('partial', 9900)], // HH-2026-1052, -2926, -3816, -4302
      [pay('deposit', 23800)], // HH-PTY-BVLMX
      [pay('partial', 21300)], // HH-PTY-3ZPMH
      [pay('partial', 45000)], // HH-2026-1418
      [pay('partial', 9900), pay('partial', 81300), pay('partial', 81300)], // HH-PTY-6GGMB
      [pay('partial', 50000), pay('refund', 20000)],
    ]
    for (const payments of shapes) {
      const m = party(payments, 172500)
      expect(m.depositOwedCents + m.balanceDueCents).toBe(m.outstandingCents)
    }
  })

  it('names an overpayment rather than clamping it out of existence', () => {
    const m = party([pay('final', 90000)])
    expect(m.outstandingCents).toBe(0)
    expect(m.overpaidCents).toBe(30000)
  })

  it('a refund that exceeds what was paid never makes the balance exceed the total', () => {
    const m = party([pay('partial', 10000), pay('refund', 50000)])
    expect(m.paidCents).toBe(-40000)
    expect(m.outstandingCents).toBe(100000)
    expect(m.overpaidCents).toBe(0)
  })

  it('an unpriced lead owes nothing and is asked for nothing', () => {
    const m = planMoney({ totalCents: 0, depositCents: 0, depositIsSeparate: false, payments: [] })
    expect(m.outstandingCents).toBe(0)
    expect(m.depositOwedCents).toBe(0)
    expect(m.balanceDueCents).toBe(0)
  })

  describe('STUDIO — where the deposit is separate', () => {
    const studio = (payments: PaymentRow[]) =>
      planMoney({ totalCents: 47500, depositCents: 25000, depositIsSeparate: true, payments })

    it('Balance Due is the FULL total: the hold is not a part payment', () => {
      // HH-STU-ZVM4U exactly: $475.00 total, nothing paid.
      expect(studio([]).balanceDueCents).toBe(47500)
      expect(studio([]).outstandingCents).toBe(47500)
    })

    it('paying the security deposit does not reduce the total', () => {
      const m = studio([pay('deposit', 25000)])
      expect(m.outstandingCents).toBe(47500)
      expect(m.depositOwedCents).toBe(0)
    })

    it('the security deposit is NOT capped by the total — it is not part of it', () => {
      // A fully-paid rental still owes its refundable hold. This is the half of
      // the cap that must not fire.
      const m = studio([pay('final', 47500)])
      expect(m.outstandingCents).toBe(0)
      expect(m.depositOwedCents).toBe(25000)
    })
  })
})

describe('needs-Adam 41 — the two switches, and what each one moves', () => {
  it('today the invoice holds the studio deposit separate', () => {
    expect(STUDIO_DEPOSIT_IS_SEPARATE).toBe(true)
    expect(depositIsSeparateFor('studio_rental')).toBe(true)
    expect(depositIsSeparateFor('in_studio_theme')).toBe(false)
    expect(depositIsSeparateFor(null)).toBe(false)
  })

  it('today the stored column does NOT follow it — that is the disagreement', () => {
    expect(COLUMN_FOLLOWS_INVOICE).toBe(false)
  })

  /**
   * The exact $250, on the exact rows. `quoteTimeBalanceCents` is what the
   * studio checkout writes into `bookings.balance_due_cents`, and
   * `/api/portal/pay` clamps its charge to that column.
   *
   * With the switch as it ships today the column keeps the value it has always
   * had, which is the point: fixing it silently would charge HH-STU-ZVM4U
   * (party 2026-09-30) and HH-STU-2CTJ3 $250 more than they were quoted.
   */
  it('writes what production actually holds for both live studio rentals', () => {
    expect(quoteTimeBalanceCents({ totalCents: 47500, depositCents: 25000, partyType: 'studio_rental' })).toBe(
      COLUMN_FOLLOWS_INVOICE ? 47500 : 22500, // HH-STU-ZVM4U: the column holds 22500
    )
    expect(quoteTimeBalanceCents({ totalCents: 110000, depositCents: 25000, partyType: 'studio_rental' })).toBe(
      COLUMN_FOLLOWS_INVOICE ? 110000 : 85000, // HH-STU-2CTJ3: the column holds 85000
    )
  })

  it('is a no-op for every non-studio product either way', () => {
    // Flipping the switch must move the studio rows and nothing else, or the
    // ruling is bigger than the question it answers.
    for (const partyType of ['in_studio_theme', 'mobile_party', 'unknown', null]) {
      expect(quoteTimeBalanceCents({ totalCents: 159000, depositCents: 25000, partyType })).toBe(134000)
    }
  })
})
