import {
  calculateCardFee,
  calculateLineItemTotal,
  calculateBalanceDue,
  computeCutoffDates,
  isModificationAllowed,
  formatMoney,
  generatePartyRef,
  getDepositCents,
  BOOKING_DEPOSIT_CENTS,
  MAJOR_BOOKING_THRESHOLD_CENTS,
} from '@/lib/partyPricing'
import type { BookingLineItem } from '@/types/booking-flow'

describe('getDepositCents', () => {
  it('is a flat $250 on a typical booking', () => {
    expect(getDepositCents(75000)).toBe(25000) // $750 party
    expect(getDepositCents(195000)).toBe(25000) // $1,950 party
  })

  it('is $250 on the cheapest weekday rental ($475)', () => {
    expect(getDepositCents(47500)).toBe(25000)
  })

  // The clamp is the money-critical case: without it a small booking would be
  // asked for a deposit bigger than the job, leaving a negative balance.
  it('never exceeds the booking total', () => {
    expect(getDepositCents(7500)).toBe(7500) // $75 studio hour
    expect(getDepositCents(BOOKING_DEPOSIT_CENTS)).toBe(BOOKING_DEPOSIT_CENTS)
    expect(getDepositCents(24999)).toBe(24999)
  })

  it('leaves a non-negative balance for any total', () => {
    for (const total of [0, 1, 7500, 24999, 25000, 47500, 195000, 300000, 442500, 10_000_00]) {
      expect(total - getDepositCents(total)).toBeGreaterThanOrEqual(0)
    }
  })

  // ── 50% on a major booking (owner ruling 2026-09-16) ──────────────────────
  describe('once the job reaches $3,000', () => {
    it('asks for half, not the flat $250', () => {
      // HH-PTY-NVLCP, the quote that prompted the rule.
      expect(getDepositCents(442500)).toBe(221250) // $4,425 → $2,212.50
      expect(getDepositCents(300000)).toBe(150000) // exactly at the threshold
    })

    it('is inclusive at $3,000 and leaves $2,999.99 alone', () => {
      // The boundary is where a rounding or `>` slip would silently mis-charge.
      expect(getDepositCents(MAJOR_BOOKING_THRESHOLD_CENTS)).toBe(150000)
      expect(getDepositCents(MAJOR_BOOKING_THRESHOLD_CENTS - 1)).toBe(BOOKING_DEPOSIT_CENTS)
    })

    it('rounds to a whole cent rather than emitting a fraction', () => {
      // An odd total halves to a half-cent. Stripe takes integers only, so a
      // fraction here would be a charge that cannot be created.
      const dep = getDepositCents(300001)
      expect(Number.isInteger(dep)).toBe(true)
      expect(dep).toBe(150001) // 150000.5 rounds up
    })

    it('asks a studio rental for half too, now that its deposit comes off the total', () => {
      // This exemption existed only because `depositIsSeparateFor('studio_rental')`
      // was true: asking half of a $3,200 rental as a REFUNDABLE damage hold
      // invented a second charge rather than changing the payment terms.
      //
      // needs-Adam 41 (ruled 2026-09-16) made the deposit a reservation payment
      // for every product, so the rationale is gone and a special case here
      // would be a second, unruled policy. Forward-only: the largest studio
      // rental in production is HH-STU-2CTJ3 at $1,100, well under the $3,000
      // threshold, so no live booking's deposit changed.
      expect(getDepositCents(320000, 'studio_rental')).toBe(160000)
      expect(getDepositCents(320000, 'mobile_party')).toBe(160000)
      expect(getDepositCents(320000, 'in_studio_theme')).toBe(160000)
      expect(getDepositCents(320000, null)).toBe(160000)
      expect(getDepositCents(320000)).toBe(160000)
      // Under the threshold a studio rental is still the flat $250.
      expect(getDepositCents(110000, 'studio_rental')).toBe(BOOKING_DEPOSIT_CENTS)
    })

    it('still clamps a studio rental to its total', () => {
      expect(getDepositCents(7500, 'studio_rental')).toBe(7500)
    })
  })

  it('returns 0 for zero, negative or invalid totals', () => {
    expect(getDepositCents(0)).toBe(0)
    expect(getDepositCents(-100)).toBe(0)
    expect(getDepositCents(NaN)).toBe(0)
  })
})

describe('calculateCardFee', () => {
  it('calculates 3% fee on $99 deposit', () => {
    expect(calculateCardFee(9900)).toBe(297) // $2.97
  })

  it('calculates 3% fee on $800', () => {
    expect(calculateCardFee(80000)).toBe(2400) // $24.00
  })

  it('calculates 3% fee on $701', () => {
    expect(calculateCardFee(70100)).toBe(2103) // $21.03
  })

  it('rounds correctly on odd amounts', () => {
    expect(calculateCardFee(3333)).toBe(100) // $1.00 (3333 * 0.03 = 99.99 → 100)
  })

  it('accepts custom rate', () => {
    expect(calculateCardFee(10000, 0.05)).toBe(500) // 5% of $100
  })

  it('returns 0 for 0 amount', () => {
    expect(calculateCardFee(0)).toBe(0)
  })
})

describe('calculateLineItemTotal', () => {
  const flatItem: BookingLineItem = {
    name: 'Balloon Garland',
    category: 'decor-add-on',
    quantity: 2,
    unit_price_cents: 7500,
    price_type: 'flat',
    guest_multiplied: false,
  }

  const perPersonItem: BookingLineItem = {
    name: 'Pizza',
    category: 'food-add-on',
    quantity: 1,
    unit_price_cents: 800,
    price_type: 'per_person',
    guest_multiplied: true,
  }

  it('calculates flat items with quantity', () => {
    expect(calculateLineItemTotal([flatItem], 10)).toBe(15000) // 7500 * 2
  })

  it('calculates per-person items multiplied by guests', () => {
    expect(calculateLineItemTotal([perPersonItem], 10)).toBe(8000) // 800 * 1 * 10
  })

  it('sums mixed items', () => {
    expect(calculateLineItemTotal([flatItem, perPersonItem], 10)).toBe(23000) // 15000 + 8000
  })

  it('returns 0 for empty array', () => {
    expect(calculateLineItemTotal([], 10)).toBe(0)
  })
})

describe('calculateBalanceDue', () => {
  it('subtracts payments from total', () => {
    const payments = [
      { amount_cents: 9900, payment_type: 'deposit' as const },
      { amount_cents: 20000, payment_type: 'partial' as const },
    ]
    expect(calculateBalanceDue(80000, payments)).toBe(50100)
  })

  it('adds back refunds', () => {
    const payments = [
      { amount_cents: 9900, payment_type: 'deposit' as const },
      { amount_cents: 5000, payment_type: 'refund' as const },
    ]
    expect(calculateBalanceDue(80000, payments)).toBe(75100) // 80000 - 9900 + 5000
  })

  it('never returns negative', () => {
    const payments = [
      { amount_cents: 100000, payment_type: 'final' as const },
    ]
    expect(calculateBalanceDue(50000, payments)).toBe(0)
  })

  it('returns total when no payments', () => {
    expect(calculateBalanceDue(80000, [])).toBe(80000)
  })
})

describe('computeCutoffDates', () => {
  it('computes T-14 and T-7 from party date', () => {
    const result = computeCutoffDates('2026-06-20')
    expect(result.modificationCutoff).toBe('2026-06-06')
    expect(result.guestCountCutoff).toBe('2026-06-13')
  })

  it('handles month boundary', () => {
    const result = computeCutoffDates('2026-07-05')
    expect(result.modificationCutoff).toBe('2026-06-21')
    expect(result.guestCountCutoff).toBe('2026-06-28')
  })

  it('handles year boundary', () => {
    const result = computeCutoffDates('2027-01-10')
    expect(result.modificationCutoff).toBe('2026-12-27')
    expect(result.guestCountCutoff).toBe('2027-01-03')
  })
})

describe('isModificationAllowed', () => {
  it('allows full modifications before T-14', () => {
    const result = isModificationAllowed('2026-06-30', 'full', '2026-06-01')
    expect(result.allowed).toBe(true)
  })

  it('blocks full modifications at T-14', () => {
    const result = isModificationAllowed('2026-06-30', 'full', '2026-06-16')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Modifications locked')
  })

  it('allows guest count between T-14 and T-7', () => {
    const result = isModificationAllowed('2026-06-30', 'guest_count', '2026-06-20')
    expect(result.allowed).toBe(true)
  })

  it('blocks guest count at T-7', () => {
    const result = isModificationAllowed('2026-06-30', 'guest_count', '2026-06-23')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Guest count locked')
  })
})

describe('formatMoney', () => {
  it('formats whole dollars without decimals', () => {
    expect(formatMoney(80000)).toBe('$800')
  })

  it('formats cents with two decimals', () => {
    expect(formatMoney(9900)).toBe('$99')
  })

  it('formats fractional amounts', () => {
    expect(formatMoney(2103)).toBe('$21.03')
  })

  it('formats zero', () => {
    expect(formatMoney(0)).toBe('$0')
  })
})

describe('generatePartyRef', () => {
  it('returns HH-PTY- prefix with 5 char code', () => {
    const ref = generatePartyRef()
    expect(ref).toMatch(/^HH-PTY-[A-Z2-9]{5}$/)
  })

  it('generates unique refs', () => {
    const refs = new Set(Array.from({ length: 100 }, () => generatePartyRef()))
    expect(refs.size).toBe(100)
  })
})
