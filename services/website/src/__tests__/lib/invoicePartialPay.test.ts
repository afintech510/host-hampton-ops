/**
 * What a customer paying from the invoice may be charged — the pure half.
 *
 * `resolveInvoicePayment` turns "what the customer pressed" into "what they are
 * charged FOR", and `partialPaymentBounds` decides whether the invoice offers a
 * part payment at all. Both are driven here off `planMoney` — the same function
 * the printed invoice is built from — with the figures of the live booking this
 * feature was built against (HH-PTY-XY8VU: a $1,700 studio rental, $250 deposit
 * paid, $1,450 left), so the assertions are the numbers a customer would read.
 */

import {
  MIN_PARTIAL_PAYMENT_CENTS,
  partialPaymentBounds,
  planMoney,
  resolveInvoicePayment,
  screenInvoicePayPurpose,
} from '@/lib/planBalance'
import { calculateCardFee } from '@/lib/partyPricing'

const money = (over: Partial<Parameters<typeof planMoney>[0]> = {}) =>
  planMoney({
    totalCents: 170_000,
    depositCents: 25_000,
    depositIsSeparate: false,
    payments: [{ amount_cents: 25_000, payment_type: 'deposit' }],
    reservationDepositCents: 25_000,
    ...over,
  })

describe('the live shape: $1,700 rental, $250 deposit paid', () => {
  const m = money()

  it('owes $1,450 and no deposit', () => {
    expect(m.outstandingCents).toBe(145_000)
    expect(m.depositOwedCents).toBe(0)
  })

  it('offers a part payment from $50.00 up to the whole $1,450.00', () => {
    expect(partialPaymentBounds(m)).toEqual({ minCents: 5_000, maxCents: 145_000 })
  })

  it('charges a $500 part payment $515.00 — the same 3% as the $250 -> $257.50 behaviour', () => {
    const r = resolveInvoicePayment(m, 'partial', 50_000)
    expect(r).toEqual({ ok: true, amountCents: 50_000, paymentType: 'partial' })
    expect(calculateCardFee(50_000)).toBe(1_500)
    expect(calculateCardFee(25_000)).toBe(750)
  })

  it('a balance payment is the whole $1,450.00 and is recorded final — the request names no figure', () => {
    expect(resolveInvoicePayment(m, 'balance', 1)).toEqual({ ok: true, amountCents: 145_000, paymentType: 'final' })
    expect(resolveInvoicePayment(m, 'balance')).toEqual({ ok: true, amountCents: 145_000, paymentType: 'final' })
  })

  it('refuses the deposit: it is already paid', () => {
    const r = resolveInvoicePayment(m, 'deposit')
    expect(r.ok).toBe(false)
  })
})

describe('a part payment is bounded', () => {
  const m = money()

  it('refuses anything under the floor', () => {
    for (const cents of [1, 100, 4_999]) {
      const r = resolveInvoicePayment(m, 'partial', cents)
      expect([cents, r.ok]).toEqual([cents, false])
    }
    expect(resolveInvoicePayment(m, 'partial', MIN_PARTIAL_PAYMENT_CENTS).ok).toBe(true)
  })

  it('CLAMPS an over-payment to what is left, and then calls it final', () => {
    const r = resolveInvoicePayment(m, 'partial', 999_999_999)
    expect(r).toEqual({ ok: true, amountCents: 145_000, paymentType: 'final' })
  })

  it('paying exactly the balance as a "part" payment is final, not partial', () => {
    expect(resolveInvoicePayment(m, 'partial', 145_000)).toEqual({ ok: true, amountCents: 145_000, paymentType: 'final' })
    expect(resolveInvoicePayment(m, 'partial', 144_999)).toEqual({ ok: true, amountCents: 144_999, paymentType: 'partial' })
  })

  it.each([undefined, null, 0, -5_000, NaN, Infinity, '', 'abc', {}, []])('refuses %p as an amount', bad => {
    expect(resolveInvoicePayment(m, 'partial', bad).ok).toBe(false)
  })

  it('accepts a numeric string and rounds fractional cents', () => {
    expect(resolveInvoicePayment(m, 'partial', '50000')).toEqual({ ok: true, amountCents: 50_000, paymentType: 'partial' })
    expect(resolveInvoicePayment(m, 'partial', 50_000.4)).toEqual({ ok: true, amountCents: 50_000, paymentType: 'partial' })
  })

  it('the floor is min($50, what is left): the last $30 can always be paid', () => {
    const small = money({ payments: [{ amount_cents: 170_000 - 3_000, payment_type: 'partial' }] })
    expect(small.outstandingCents).toBe(3_000)
    expect(resolveInvoicePayment(small, 'partial', 3_000)).toEqual({ ok: true, amountCents: 3_000, paymentType: 'final' })
    expect(resolveInvoicePayment(small, 'partial', 2_999).ok).toBe(false)
    // …but at or under $50 the invoice does not offer a "part" payment at all.
    expect(partialPaymentBounds(small)).toBeNull()
  })
})

describe('when a part payment is NOT offered', () => {
  it('not while the deposit is owed — the deposit is what books the date', () => {
    const fresh = money({ payments: [] })
    expect(fresh.depositOwedCents).toBe(25_000)
    expect(partialPaymentBounds(fresh)).toBeNull()
    const r = resolveInvoicePayment(fresh, 'partial', 50_000)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/deposit first/i)
  })

  it('not on an unpriced plan — there is no balance to take part of', () => {
    const unpriced = money({ totalCents: 0, depositCents: 0, payments: [] })
    expect(partialPaymentBounds(unpriced)).toBeNull()
    expect(resolveInvoicePayment(unpriced, 'partial', 50_000).ok).toBe(false)
    expect(resolveInvoicePayment(unpriced, 'balance').ok).toBe(false)
  })

  it('not on a plan that is paid in full', () => {
    const paid = money({ payments: [{ amount_cents: 170_000, payment_type: 'final' }] })
    expect(paid.outstandingCents).toBe(0)
    expect(partialPaymentBounds(paid)).toBeNull()
    for (const purpose of ['partial', 'balance'] as const) {
      expect([purpose, resolveInvoicePayment(paid, purpose, 10_000).ok]).toEqual([purpose, false])
    }
    expect(resolveInvoicePayment(paid, 'deposit').ok).toBe(false)
  })
})

describe('the deposit is derived, never read from the request', () => {
  it('the unpriced reservation deposit is the flat $250, whatever the caller said', () => {
    const unpriced = money({ totalCents: 0, depositCents: 0, payments: [] })
    expect(resolveInvoicePayment(unpriced, 'deposit', 1)).toEqual({ ok: true, amountCents: 25_000, paymentType: 'deposit' })
    expect(resolveInvoicePayment(unpriced, 'deposit', 999_999)).toEqual({ ok: true, amountCents: 25_000, paymentType: 'deposit' })
  })

  it('on a fresh priced quote the deposit is what is owed and "balance" is the whole thing', () => {
    const fresh = money({ payments: [] })
    expect(resolveInvoicePayment(fresh, 'deposit')).toEqual({ ok: true, amountCents: 25_000, paymentType: 'deposit' })
    expect(resolveInvoicePayment(fresh, 'balance')).toEqual({ ok: true, amountCents: 170_000, paymentType: 'final' })
  })
})

describe('the purpose vocabulary', () => {
  it('accepts the three the invoice uses, case- and space-tolerant', () => {
    expect(screenInvoicePayPurpose(' Partial ')).toBe('partial')
    expect(screenInvoicePayPurpose('deposit')).toBe('deposit')
    expect(screenInvoicePayPurpose('BALANCE')).toBe('balance')
  })

  it('treats ABSENT as the legacy caller, and anything else as an error', () => {
    expect(screenInvoicePayPurpose(undefined)).toBeUndefined()
    expect(screenInvoicePayPurpose(null)).toBeUndefined()
    for (const bad of ['custom', 'refund', 'final', '', 7, {}, ['deposit']]) {
      expect([bad, screenInvoicePayPurpose(bad)]).toEqual([bad, null])
    }
  })
})
