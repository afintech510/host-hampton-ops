import {
  studioRentalRate,
  isWeekendDate,
  hoursBetween,
  STUDIO_MIN_HOURS,
  customHourlyRateCents,
  customHourlyRentalPrice,
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

describe('studioRentalRate — weekend ($600/3hr, +$150/hr)', () => {
  it('base 3-hour block = $600', () => {
    expect(studioRentalRate(SAT, 3).rentalCents).toBe(60000)
  })
  it('5 hours = $600 + 2×$150 = $900', () => {
    expect(studioRentalRate(SAT, 5).rentalCents).toBe(90000)
  })
  it('reports additional-hour breakdown', () => {
    const r = studioRentalRate(SUN, 5)
    expect(r.isWeekend).toBe(true)
    expect(r.addlHours).toBe(2)
    expect(r.addlHourCents).toBe(30000)
    expect(r.rentalCents).toBe(90000)
  })
})

describe('studioRentalRate — weekday ($475/3hr, +$100/hr)', () => {
  it('base 3-hour block = $475', () => {
    expect(studioRentalRate(MON, 3).rentalCents).toBe(47500)
  })
  it('5 hours = $475 + 2×$100 = $675', () => {
    expect(studioRentalRate(MON, 5).rentalCents).toBe(67500)
  })
  it('Friday is weekday-priced', () => {
    expect(studioRentalRate(FRI, 4).rentalCents).toBe(47500 + 10000)
  })
})

describe('studioRentalRate — full-day cap', () => {
  it('weekend caps at $975 (full day) for long windows', () => {
    expect(studioRentalRate(SAT, 7).rentalCents).toBe(97500)  // uncapped 600+4×150=1200, capped
    expect(studioRentalRate(SAT, 10).rentalCents).toBe(97500) // would be far higher, capped
    expect(studioRentalRate(SUN, 16).rentalCents).toBe(97500)
    expect(studioRentalRate(SAT, 12).isFullDay).toBe(true)
    expect(studioRentalRate(SAT, 12).lineItemLabel).toBe('Studio Rental — Weekend Full Day')
  })
  it('weekday caps at $700 (full day) for long windows', () => {
    expect(studioRentalRate(MON, 7).rentalCents).toBe(70000)  // uncapped 475+4×100=875, capped 700
    expect(studioRentalRate(MON, 12).rentalCents).toBe(70000)
    expect(studioRentalRate(FRI, 14).rentalCents).toBe(70000)
    expect(studioRentalRate(MON, 12).isFullDay).toBe(true)
  })
  it('does not cap shorter windows', () => {
    expect(studioRentalRate(SAT, 4).rentalCents).toBe(75000)  // below cap
    expect(studioRentalRate(SAT, 4).isFullDay).toBe(false)
    expect(studioRentalRate(MON, 4).rentalCents).toBe(57500)
    expect(studioRentalRate(MON, 4).isFullDay).toBe(false)
  })
})

describe('studioRentalRate — guards', () => {
  it('clamps below-minimum hours to the 3-hour block', () => {
    const r = studioRentalRate(MON, 1)
    expect(r.hours).toBe(STUDIO_MIN_HOURS)
    expect(r.rentalCents).toBe(47500)
    expect(r.addlHours).toBe(0)
  })
  it('builds a human-readable label', () => {
    expect(studioRentalRate(SAT, 4).lineItemLabel).toBe('Studio Rental — Weekend 4 hrs')
    expect(studioRentalRate(MON, 3).lineItemLabel).toBe('Studio Rental — Weekday 3 hrs')
  })
})

describe('custom hourly rate (owner-approved, per booking)', () => {
  // HH-PTY-33VDT: a $75/hr photoshoot shortened 11–4 → 11–2 was re-priced at
  // the $600 weekend base. The rate on the booking must win over the card.
  const tags = { custom_hourly_rate_cents: 7500, event_label: 'Professional photoshoot' }

  it('reads the tag only when it is a positive whole number of cents', () => {
    expect(customHourlyRateCents(tags)).toBe(7500)
    expect(customHourlyRateCents({})).toBeNull()
    expect(customHourlyRateCents(null)).toBeNull()
    expect(customHourlyRateCents({ custom_hourly_rate_cents: 0 })).toBeNull()
    expect(customHourlyRateCents({ custom_hourly_rate_cents: -7500 })).toBeNull()
    expect(customHourlyRateCents({ custom_hourly_rate_cents: '7500' })).toBeNull()
    expect(customHourlyRateCents({ custom_hourly_rate_cents: 75.5 })).toBeNull()
  })

  it('prices 11–2 at 3 × $75 = $225, not the $600 card rate', () => {
    const p = customHourlyRentalPrice(tags, 7500, '11:00', '14:00', hoursBetween('11:00', '14:00'))
    expect(p.rentalCents).toBe(22500)
    expect(p.hours).toBe(3)
    expect(p.unitCents).toBe(7500)
    expect(p.lineItemLabel).toBe('Studio Rental — Professional photoshoot (3 hrs @ $75/hr)')
    expect(p.description).toBe('11:00 AM – 2:00 PM · owner-approved hourly rate')
  })

  it('is not bound by the 3-hour minimum (HH-PTY-73LGZ was 2 hrs @ $150)', () => {
    const p = customHourlyRentalPrice({ custom_hourly_rate_cents: 15000 }, 15000, '15:00', '17:00', 2)
    expect(p.rentalCents).toBe(30000)
    expect(p.lineItemLabel).toBe('Studio Rental — Custom rate (2 hrs @ $150/hr)')
    expect(p.description).toBe('3:00 PM – 5:00 PM · owner-approved hourly rate')
  })

  it('prints noon and a cents rate correctly', () => {
    const p = customHourlyRentalPrice(tags, 7550, '12:00', '13:00', 1)
    expect(p.lineItemLabel).toBe('Studio Rental — Professional photoshoot (1 hr @ $75.50/hr)')
    expect(p.description).toBe('12:00 PM – 1:00 PM · owner-approved hourly rate')
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
