import {
  studioRentalRate,
  isWeekendDate,
  hoursBetween,
  STUDIO_MIN_HOURS,
} from '@/lib/studioRental'

// Reference calendar anchors (local time):
//   2026-06-13 is a Saturday, 2026-06-14 a Sunday → weekend
//   2026-06-15 is a Monday, 2026-06-12 a Friday   → weekday
const SAT = '2026-06-13'
const SUN = '2026-06-14'
const MON = '2026-06-15'
const FRI = '2026-06-12'

describe('isWeekendDate', () => {
  it('treats Saturday and Sunday as weekend', () => {
    expect(isWeekendDate(SAT)).toBe(true)
    expect(isWeekendDate(SUN)).toBe(true)
  })
  it('treats Monday–Friday as weekday', () => {
    expect(isWeekendDate(MON)).toBe(false)
    expect(isWeekendDate(FRI)).toBe(false)
  })
})

describe('studioRentalRate — weekend ($575/3hr, +$100/hr)', () => {
  it('base 3-hour block = $575', () => {
    expect(studioRentalRate(SAT, 3).rentalCents).toBe(57500)
  })
  it('5 hours = $575 + 2×$100 = $775', () => {
    expect(studioRentalRate(SAT, 5).rentalCents).toBe(77500)
  })
  it('reports additional-hour breakdown', () => {
    const r = studioRentalRate(SUN, 6)
    expect(r.isWeekend).toBe(true)
    expect(r.addlHours).toBe(3)
    expect(r.addlHourCents).toBe(30000)
    expect(r.rentalCents).toBe(87500)
  })
})

describe('studioRentalRate — weekday ($450/3hr, +$75/hr)', () => {
  it('base 3-hour block = $450', () => {
    expect(studioRentalRate(MON, 3).rentalCents).toBe(45000)
  })
  it('6 hours = $450 + 3×$75 = $675', () => {
    expect(studioRentalRate(MON, 6).rentalCents).toBe(67500)
  })
  it('Friday is weekday-priced', () => {
    expect(studioRentalRate(FRI, 4).rentalCents).toBe(45000 + 7500)
  })
})

describe('studioRentalRate — guards', () => {
  it('clamps below-minimum hours to the 3-hour block', () => {
    const r = studioRentalRate(MON, 1)
    expect(r.hours).toBe(STUDIO_MIN_HOURS)
    expect(r.rentalCents).toBe(45000)
    expect(r.addlHours).toBe(0)
  })
  it('builds a human-readable label', () => {
    expect(studioRentalRate(SAT, 4).lineItemLabel).toBe('Studio Rental — Weekend 4 hrs')
    expect(studioRentalRate(MON, 3).lineItemLabel).toBe('Studio Rental — Weekday 3 hrs')
  })
})

describe('hoursBetween', () => {
  it('computes whole-hour windows', () => {
    expect(hoursBetween('10:00', '14:00')).toBe(4)
    expect(hoursBetween('13:30', '16:30')).toBe(3)
  })
  it('never returns negative', () => {
    expect(hoursBetween('16:00', '10:00')).toBe(0)
  })
})
