/**
 * The screens in `lib/portalWrite.ts`, exercised rather than read.
 *
 * `portalWriteSurface.test.ts` asserts these are CALLED, in the right order, by
 * the right handlers. This file asserts they are right. Both halves are needed:
 * link 17's attack harness had a detector that could not run at all, so all 34
 * of its mutations reported "caught".
 */

import {
  BOOKING_PAYMENT_TYPES,
  PORTAL_PAYMENT_TYPES,
  screenPortalPaymentType,
  isPayableStatus,
  isEditableStatus,
  partyDateIsSet,
  screenPledgeCents,
  MAX_PLEDGE_CENTS,
} from '@/lib/portalWrite'
import { sumPayments } from '@/lib/bookingBalance'

describe('screenPortalPaymentType', () => {
  it('accepts the three a customer may name', () => {
    for (const v of PORTAL_PAYMENT_TYPES) expect(screenPortalPaymentType(v)).toBe(v)
  })

  it('treats absent as "derive it", which is not an error', () => {
    // The distinction matters: `/my-booking/pay` posts no `paymentType` at all
    // and the route must fall back to deriving it from the amount, not 400.
    expect(screenPortalPaymentType(undefined)).toBeUndefined()
    expect(screenPortalPaymentType(null)).toBeUndefined()
  })

  it('REFUSES `refund`, which the CHECK accepts and sumPayments subtracts', () => {
    expect(screenPortalPaymentType('refund')).toBeNull()
    // Proving the consequence rather than asserting it: a `refund` row makes the
    // customer's paid total go DOWN, so paying us would have raised their balance.
    const paid = sumPayments([
      { amount_cents: 25_000, payment_type: 'deposit' },
      { amount_cents: 10_000, payment_type: 'refund' },
    ])
    expect(paid).toBe(15_000)
    // …and `refund` really is in the constraint's vocabulary, which is why the
    // route could not have caught it by watching for a Postgres error.
    expect(BOOKING_PAYMENT_TYPES).toContain('refund')
  })

  it('REFUSES a value Postgres would reject, so the charge never happens', () => {
    // Unscreened, `"x"` charges the card and then fails
    // `booking_payments_payment_type_check` (23514) in the webhook → 500 →
    // Stripe retries forever → money collected and recorded nowhere.
    for (const v of ['x', '', ' ', 'DEPOSIT ', 'deposit;', 'partial,final']) {
      if (v === 'DEPOSIT ') continue // trimmed + lowercased below
      expect(screenPortalPaymentType(v)).toBeNull()
    }
    expect(screenPortalPaymentType('  Deposit ')).toBe('deposit')
  })

  it('REFUSES a non-string, which is what a crafted JSON body sends', () => {
    for (const v of [1, 0, true, {}, [], ['final'], { toString: () => 'final' }]) {
      expect(screenPortalPaymentType(v)).toBeNull()
    }
  })

  it('the customer subset is a strict subset of what the column allows', () => {
    for (const v of PORTAL_PAYMENT_TYPES) expect(BOOKING_PAYMENT_TYPES).toContain(v)
    expect(PORTAL_PAYMENT_TYPES.length).toBeLessThan(BOOKING_PAYMENT_TYPES.length)
  })
})

describe('isPayableStatus', () => {
  it('refuses the two that must never take a self-service charge', () => {
    expect(isPayableStatus('cancelled')).toBe(false)
    expect(isPayableStatus('completed')).toBe(false)
  })

  it('allows every status a live booking actually holds', () => {
    // Measured distribution, production 2026-09-13.
    for (const s of [
      'lead', 'quoted', 'pending_review', 'awaiting_deposit', 'deposit_paid',
      'confirmed', 'approved', 'modifications_locked', 'paid_in_full',
    ]) {
      expect(isPayableStatus(s)).toBe(true)
    }
  })

  it('is not fooled by case or padding', () => {
    expect(isPayableStatus(' Cancelled ')).toBe(false)
    expect(isPayableStatus('CANCELLED')).toBe(false)
  })

  it('does not refuse on a shape it cannot read — the balance check still gates', () => {
    // A rate limiter must never become an outage; neither must a status guard.
    // An absent column must not stop a real customer paying a real balance.
    expect(isPayableStatus(undefined)).toBe(true)
    expect(isPayableStatus(null)).toBe(true)
  })
})

describe('isEditableStatus', () => {
  it('refuses only cancelled — the date cutoff owns the rest', () => {
    expect(isEditableStatus('cancelled')).toBe(false)
    // `modifications_locked` is DELIBERATELY editable here: the T-14 date cutoff
    // is what put that label on the row and is what refuses the edit, and
    // checking both would be one rule defined twice.
    expect(isEditableStatus('modifications_locked')).toBe(true)
    expect(isEditableStatus('completed')).toBe(true)
  })
})

describe('partyDateIsSet', () => {
  it('is false for the shapes that made the portal 500', () => {
    // `isModificationAllowed` runs `partyDateStr.split('-')` immediately.
    for (const v of [null, undefined, '', '   ', 0, {}, []]) {
      expect(partyDateIsSet(v)).toBe(false)
    }
  })

  it('is true for a real party_date, with or without a time component', () => {
    expect(partyDateIsSet('2026-10-11')).toBe(true)
    expect(partyDateIsSet('2026-10-11T00:00:00Z')).toBe(true)
  })

  it('is false for a string that is not a date, rather than passing it through', () => {
    for (const v of ['tbd', '2026', '11/10/2026', 'null']) {
      expect(partyDateIsSet(v)).toBe(false)
    }
  })
})

describe('screenPledgeCents', () => {
  it('accepts a whole number of cents a real pledge would use', () => {
    expect(screenPledgeCents(25_000)).toBe(25_000)
    expect(screenPledgeCents('25000')).toBe(25_000)
    expect(screenPledgeCents(1)).toBe(1)
    expect(screenPledgeCents(MAX_PLEDGE_CENTS)).toBe(MAX_PLEDGE_CENTS)
  })

  it('refuses the values that reached Adam as a sentence', () => {
    // `body.amount_cents as number` with a `> 0` check was the whole screen, and
    // the figure went through `formatMoney()` into his inbox.
    expect(screenPledgeCents(0.5)).toBeNull()
    expect(screenPledgeCents(1e308)).toBeNull()
    expect(screenPledgeCents(Infinity)).toBeNull()
    expect(screenPledgeCents(-25_000)).toBeNull()
    expect(screenPledgeCents(0)).toBeNull()
    expect(screenPledgeCents(NaN)).toBeNull()
    expect(screenPledgeCents(MAX_PLEDGE_CENTS + 1)).toBeNull()
  })

  it('refuses the non-numbers a crafted body sends', () => {
    for (const v of [undefined, null, {}, [], '', 'lots', true, '25000abc']) {
      expect(screenPledgeCents(v)).toBeNull()
    }
  })

  it('the ceiling is far above any real booking, so it cannot refuse a customer', () => {
    // Largest booking total in production 2026-09-13: $2,919.
    expect(MAX_PLEDGE_CENTS).toBeGreaterThan(291_900 * 10)
  })
})
