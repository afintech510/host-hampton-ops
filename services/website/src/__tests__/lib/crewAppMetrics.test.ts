/**
 * The crew-management Dashboard's numbers and the month / week filter.
 * Pure functions, so every figure is pinned with a worked example.
 */
import { monthKeys, weeksOfMonth, weekNumberOf, weekCaption, passesDateFilter, monthShort, passesWeekend, weekdayOf, countByDate, dayCaption, dayOfMonth } from '@/lib/bookingWeeks'
import {
  ytdSales, salesPeriods, backlog, bookingsMade, bookingWindows, leadVelocity, openLeads, upcomingEvents, sundayOf,
  type BookedRow, type LedgerRow,
} from '@/lib/dashboardMetrics'

describe('months and weeks', () => {
  it('offers this month and the next two, across a year end', () => {
    expect(monthKeys('2026-11-07')).toEqual(['2026-11', '2026-12', '2027-01'])
    expect(monthKeys('2026-01-31', 2)).toEqual(['2026-01', '2026-02'])
  })

  it('cuts a month into Sunday-start weeks clipped to the month', () => {
    // Nov 2026: the 1st is a Sunday.
    expect(weeksOfMonth('2026-11')).toEqual([
      { n: 1, start: '2026-11-01', end: '2026-11-07' },
      { n: 2, start: '2026-11-08', end: '2026-11-14' },
      { n: 3, start: '2026-11-15', end: '2026-11-21' },
      { n: 4, start: '2026-11-22', end: '2026-11-28' },
      { n: 5, start: '2026-11-29', end: '2026-11-30' },
    ])
    // Dec 2026 starts on a Tuesday: week 1 is Tue 1 - Sat 5.
    const dec = weeksOfMonth('2026-12')
    expect(dec[0]).toEqual({ n: 1, start: '2026-12-01', end: '2026-12-05' })
    expect(dec[dec.length - 1].end).toBe('2026-12-31')
  })

  it('every day of a month is in exactly one week, for every month of a leap year', () => {
    for (let m = 1; m <= 12; m++) {
      const key = `2028-${String(m).padStart(2, '0')}`
      const weeks = weeksOfMonth(key)
      const days = weeks.reduce((n, w) => n + Number(w.end.slice(8)) - Number(w.start.slice(8)) + 1, 0)
      expect(days).toBe(new Date(Date.UTC(2028, m, 0)).getUTCDate())
      for (let i = 1; i < weeks.length; i++) expect(Number(weeks[i].start.slice(8))).toBe(Number(weeks[i - 1].end.slice(8)) + 1)
    }
  })

  it('numbers a date by its week and captions the range', () => {
    expect(weekNumberOf('2026-11-07')).toBe(1)
    expect(weekNumberOf('2026-11-08')).toBe(2)
    expect(weekNumberOf('2026-11-30')).toBe(5)
    expect(weekCaption({ n: 2, start: '2026-11-08', end: '2026-11-14' })).toBe('Nov 8-14')
    expect(weekCaption({ n: 5, start: '2026-11-30', end: '2026-11-30' })).toBe('Nov 30')
    expect(monthShort('2027-01')).toBe('Jan')
  })

  it('filters by month and week; a row with no date passes only the "none" month', () => {
    expect(passesDateFilter('2026-11-14', { month: '2026-11', week: null })).toBe(true)
    expect(passesDateFilter('2026-11-14', { month: '2026-11', week: 2 })).toBe(true)
    expect(passesDateFilter('2026-11-14', { month: '2026-11', week: 3 })).toBe(false)
    expect(passesDateFilter('2026-12-01', { month: '2026-11', week: null })).toBe(false)
    expect(passesDateFilter(null, { month: '2026-11', week: null })).toBe(false)
    expect(passesDateFilter(null, { month: 'none', week: null })).toBe(true)
    expect(passesDateFilter('2026-11-14', { month: 'none', week: null })).toBe(false)
    expect(passesDateFilter('2026-11-14', { month: '2026-11', week: 9 })).toBe(false)
  })
})

const TODAY = '2026-11-07' // a Saturday

describe('Sat / Sun and the date buttons', () => {
  it('reads the weekday off the plain date', () => {
    expect(weekdayOf('2026-11-07')).toBe(6)
    expect(weekdayOf('2026-11-08')).toBe(0)
    expect(weekdayOf('2026-11-09')).toBe(1)
    expect(dayCaption('2026-11-07')).toBe('Sat Nov 7')
    expect(dayOfMonth('2026-11-07')).toBe(7)
  })

  it('no day lit passes everything, including a missing date; lit days narrow', () => {
    expect(passesWeekend('2026-11-10', [])).toBe(true)
    expect(passesWeekend(null, [])).toBe(true)
    expect(passesWeekend('2026-11-07', ['sat'])).toBe(true)
    expect(passesWeekend('2026-11-08', ['sat'])).toBe(false)
    expect(passesWeekend('2026-11-08', ['sun'])).toBe(true)
    expect(passesWeekend('2026-11-08', ['sat', 'sun'])).toBe(true)
    expect(passesWeekend('2026-11-10', ['sat', 'sun'])).toBe(false)
    expect(passesWeekend(null, ['sat'])).toBe(false)
  })

  it('counts only the dates that have something on', () => {
    expect(countByDate(['2026-11-07', null, '2026-11-01', '2026-11-07', undefined])).toEqual({ '2026-11-07': 2, '2026-11-01': 1 })
    expect(countByDate([])).toEqual({})
  })
})

describe('YTD gross sales', () => {
  const rows: LedgerRow[] = [
    { date: '2025-12-31', amount_cents: 99_999, category: 'Party Booking' }, // last year
    { date: '2026-01-02', amount_cents: 10_000, category: 'Party Booking' },
    { date: '2026-03-05', amount_cents: 2_500, category: 'Event Ticket' },
    { date: '2026-04-01', amount_cents: 5_000, category: 'Room Rental' },
    { date: '2026-05-01', amount_cents: 7_000, category: 'Mobile Party' },
    { date: '2026-06-01', amount_cents: 300, category: 'Merchandise' },
    { date: '2026-06-02', amount_cents: 200, category: null },
    { date: '2026-09-01', amount_cents: -1_000, category: 'Party Booking' }, // a refund
    { date: '2026-12-01', amount_cents: 77_777, category: 'Party Booking' }, // after today
  ]

  it('counts this year\'s money in, groups it, and shows refunds beside it rather than inside it', () => {
    const y = ytdSales(rows, TODAY)
    expect(y.grossCents).toBe(10_000 + 2_500 + 5_000 + 7_000 + 300 + 200)
    expect(y.refundsCents).toBe(1_000)
    expect(y.netCents).toBe(y.grossCents - 1_000)
    expect(Object.fromEntries(y.byGroup.map(g => [g.group, g.cents]))).toEqual({
      Parties: 10_000, 'Mobile parties': 7_000, 'Room rentals': 5_000, Events: 2_500, 'Other sales': 500,
    })
    expect(y.byGroup.reduce((s, g) => s + g.cents, 0)).toBe(y.grossCents)
    expect(y.throughDate).toBe('2026-09-01')
    expect(y.year).toBe(2026)
  })

  it('is zero, not an error, with no rows', () => {
    expect(ytdSales([], TODAY).grossCents).toBe(0)
    expect(ytdSales([], TODAY).throughDate).toBeNull()
  })
})

describe('gross sales by period: year, quarter, month to date', () => {
  const row = (date: string, cents: number, category: string | null = 'Party Booking'): LedgerRow => ({ date, amount_cents: cents, category })
  const rows: LedgerRow[] = [
    row('2025-10-02', 1_000), row('2025-10-20', 2_000), row('2025-11-06', 300), row('2025-11-20', 4_000), row('2025-12-15', 5_000),
    row('2026-07-10', 700), row('2026-08-06', 800), row('2026-08-20', 9_000),
    row('2026-10-03', 6_000), row('2026-10-12', 400), row('2026-11-02', 1_500), row('2026-11-05', -500),
  ]
  const by = (ps: ReturnType<typeof salesPeriods>, k: string) => ps.find(p => p.key === k)!

  it('offers year, quarter and month, each from the first of the period to today', () => {
    const ps = salesPeriods(rows, '2026-11-06')
    expect(ps.map(p => [p.key, p.button, p.title, p.start, p.end])).toEqual([
      ['ytd', 'Year', '2026 to date', '2026-01-01', '2026-11-06'],
      ['qtd', 'Quarter', 'Q4 2026 to date', '2026-10-01', '2026-11-06'],
      ['mtd', 'Month', 'November 2026 to date', '2026-11-01', '2026-11-06'],
    ])
  })

  it('totals each period: gross is money in, refunds sit beside it, groups add up to gross', () => {
    const ps = salesPeriods(rows, '2026-11-06')
    expect(by(ps, 'qtd')).toMatchObject({ grossCents: 6_000 + 400 + 1_500, refundsCents: 500, netCents: 6_000 + 400 + 1_500 - 500 })
    expect(by(ps, 'mtd')).toMatchObject({ grossCents: 1_500, refundsCents: 500 })
    expect(by(ps, 'ytd').grossCents).toBe(700 + 800 + 9_000 + 6_000 + 400 + 1_500)
    for (const p of ps) expect(p.byGroup.reduce((s, g) => s + g.cents, 0)).toBe(p.grossCents)
  })

  it('quarter: held against the same number of days of last quarter and of the same quarter last year, with the whole period for reference', () => {
    const q = by(salesPeriods(rows, '2026-11-06'), 'qtd')
    // 37 days into Q4, so 37 days into Q3 (Jul 1 - Aug 6) and into Q4 2025 (Oct 1 - Nov 6).
    expect(q.comparisons.map(c => [c.label, c.title, c.start, c.end, c.fullEnd])).toEqual([
      ['Last quarter', 'Q3 2026', '2026-07-01', '2026-08-06', '2026-09-30'],
      ['Same quarter last year', 'Q4 2025', '2025-10-01', '2025-11-06', '2025-12-31'],
    ])
    expect(q.comparisons[0]).toMatchObject({ grossCents: 1_500, fullGrossCents: 1_500 + 9_000, changePct: 427 })
    expect(q.comparisons[1]).toMatchObject({ grossCents: 3_300, fullGrossCents: 3_300 + 4_000 + 5_000, changePct: 139 })
  })

  it('month: last month and the same month last year, to the same day', () => {
    const m = by(salesPeriods(rows, '2026-11-06'), 'mtd')
    expect(m.comparisons.map(c => [c.label, c.title, c.start, c.end, c.fullEnd])).toEqual([
      ['Last month', 'October 2026', '2026-10-01', '2026-10-06', '2026-10-31'],
      ['Same month last year', 'November 2025', '2025-11-01', '2025-11-06', '2025-11-30'],
    ])
    expect(m.comparisons[0]).toMatchObject({ grossCents: 6_000, fullGrossCents: 6_400, changePct: -75 })
    expect(m.comparisons[1]).toMatchObject({ grossCents: 300, fullGrossCents: 4_300, changePct: 400 })
  })

  it('year: held against the same point last year, or nothing when the books start later than that', () => {
    const y = by(salesPeriods(rows, '2026-11-06'), 'ytd')
    expect(y.comparisons).toHaveLength(1)
    // The first row is Oct 2025, so Jan-Nov 2025 is not in the books: null, never a zero that reads as "sold nothing".
    expect(y.comparisons[0]).toMatchObject({ label: 'Same point last year', start: '2025-01-01', end: '2025-11-06', grossCents: null, fullGrossCents: null, changePct: null })
    const full = salesPeriods([row('2025-01-02', 1_000), row('2025-06-01', 2_000), row('2025-12-30', 4_000), row('2026-03-01', 3_000)], '2026-11-06')
    expect(by(full, 'ytd').comparisons[0]).toMatchObject({ grossCents: 3_000, fullGrossCents: 7_000, changePct: 0 })
  })

  it('in January "last quarter" is last year\'s Q4, and in the first quarter the same-quarter comparison is Q1 last year', () => {
    const q = by(salesPeriods(rows, '2026-01-15'), 'qtd')
    expect(q.title).toBe('Q1 2026 to date')
    expect(q.comparisons[0]).toMatchObject({ title: 'Q4 2025', start: '2025-10-01', end: '2025-10-15', fullEnd: '2025-12-31' })
    expect(q.comparisons[1]).toMatchObject({ title: 'Q1 2025', start: '2025-01-01', end: '2025-01-15', grossCents: null })
    expect(by(salesPeriods(rows, '2026-01-15'), 'mtd').comparisons[0]).toMatchObject({ title: 'December 2025', start: '2025-12-01', end: '2025-12-15' })
  })

  it('a short month or a leap day never reaches past the end of the month it is compared with', () => {
    const m = by(salesPeriods(rows, '2026-03-31'), 'mtd')
    expect(m.comparisons[0]).toMatchObject({ title: 'February 2026', end: '2026-02-28', fullEnd: '2026-02-28' })
    const leap = salesPeriods(rows, '2028-02-29')
    expect(by(leap, 'mtd').comparisons[1]).toMatchObject({ title: 'February 2027', end: '2027-02-28', fullEnd: '2027-02-28' })
    expect(by(leap, 'ytd').comparisons[0]).toMatchObject({ end: '2027-02-28' })
  })

  it('a quarter that is not yet as long as the one before is compared whole days to whole days, and never past that quarter\'s end', () => {
    // Day 92 of Q3 against a 91-day Q2: the like-for-like end is Q2's last day.
    const q = by(salesPeriods(rows, '2026-09-30'), 'qtd')
    expect(q.comparisons[0]).toMatchObject({ title: 'Q2 2026', start: '2026-04-01', end: '2026-06-30', fullEnd: '2026-06-30' })
  })

  it('has nothing to divide by when the earlier period sold nothing: no percentage, not infinity', () => {
    const ps = salesPeriods([row('2025-10-02', 1_000), row('2026-11-02', 1_500)], '2026-11-06')
    expect(by(ps, 'mtd').comparisons[0]).toMatchObject({ grossCents: 0, changePct: null })
  })

  it('with no rows every comparison is unavailable rather than zero', () => {
    const ps = salesPeriods([], '2026-11-06')
    expect(ps.flatMap(p => p.comparisons).every(c => c.grossCents === null && c.fullGrossCents === null)).toBe(true)
  })

  it('the dashboard reads last year\'s ledger too, and the page has the three period buttons over the comparisons', () => {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), 'src', ...p), 'utf8')
    const data = read('lib', 'crewAppData.ts')
    expect(data).toMatch(/\.gte\('date', `\$\{Number\(today\.slice\(0, 4\)\) - 1\}-01-01`\)/)
    expect(data).toMatch(/sales: ledger \? salesPeriods\(ledger, today\) : null/)
    const page = read('app', 'admin', 'crew', 'dashboard', 'page.tsx')
    expect(page).toMatch(/useRemembered<SalesPeriodKey>\('dashboard\.period', 'ytd'\)/)
    expect(page).toContain('data-sales-periods')
    expect(page).toMatch(/d\.sales\.map\(p => \(\s*<button key=\{p\.key\}/)
    expect(page).toMatch(/sales\.comparisons\.map\(c => <Comparison/)
  })
})

const booked = (over: Partial<BookedRow>): BookedRow => ({
  partyType: 'in_studio_theme', partyDate: '2026-12-12', stage: 'booked', totalCents: 100_000, paidCents: 25_000, balanceCents: 75_000, bookedAt: '2026-11-05T15:00:00Z', ...over,
})

describe('backlog and what is booked ahead', () => {
  const rows = [
    booked({}),
    booked({ partyType: 'mobile_party', totalCents: 80_000, paidCents: 25_000, balanceCents: 55_000 }),
    booked({ partyType: 'studio_rental', totalCents: 60_000, paidCents: 60_000, balanceCents: 0 }),
    booked({ partyType: 'studio_rental', totalCents: 40_000, paidCents: 25_000, balanceCents: 15_000 }),
    booked({ partyType: null, totalCents: 5_000, paidCents: 5_000, balanceCents: 0 }),
    booked({ partyDate: '2026-11-06', totalCents: 999_999 }), // already happened
    booked({ stage: 'completed', totalCents: 999_999 }),
    booked({ stage: 'cancelled', totalCents: 999_999 }),
    booked({ stage: 'quoted', totalCents: 999_999 }),
    booked({ partyDate: null, totalCents: 999_999 }),
    booked({ partyDate: TODAY, totalCents: 10_000, paidCents: 10_000, balanceCents: 0 }), // today counts
  ]

  it('adds up only parties booked from today on', () => {
    const b = backlog(rows, TODAY)
    expect(b.count).toBe(6)
    expect(b.totalCents).toBe(100_000 + 80_000 + 60_000 + 40_000 + 5_000 + 10_000)
    expect(b.collectedCents).toBe(25_000 + 25_000 + 60_000 + 25_000 + 5_000 + 10_000)
    expect(b.toCollectCents).toBe(75_000 + 55_000 + 0 + 15_000 + 0 + 0)
    expect(b.totalCents).toBe(b.collectedCents + b.toCollectCents)
  })

  it('breaks it down by in-studio / mobile / room rental, and only shows "other" when there is some', () => {
    const b = backlog(rows, TODAY)
    expect(b.byType.map(t => [t.type, t.count, t.totalCents])).toEqual([
      ['in_studio_theme', 2, 110_000],
      ['mobile_party', 1, 80_000],
      ['studio_rental', 2, 100_000],
      ['other', 1, 5_000],
    ])
    expect(b.byType.reduce((s, t) => s + t.count, 0)).toBe(b.count)
    expect(backlog([booked({})], TODAY).byType.map(t => t.type)).toEqual(['in_studio_theme', 'mobile_party', 'studio_rental'])
  })
})

describe('bookings made, by window', () => {
  it('builds the four windows with a prior of the same length', () => {
    const w = Object.fromEntries(bookingWindows(TODAY).map(x => [x.key, x]))
    expect(sundayOf(TODAY)).toBe('2026-11-01')
    expect(w.week).toMatchObject({ start: '2026-11-01', end: TODAY, priorStart: '2026-10-25', priorEnd: '2026-10-31' })
    expect(w.month).toMatchObject({ start: '2026-11-01', priorStart: '2026-10-01', priorEnd: '2026-10-07' })
    expect(w.last30).toMatchObject({ start: '2026-10-09', priorStart: '2026-09-09', priorEnd: '2026-10-08' })
    expect(w.last60).toMatchObject({ start: '2026-09-09', priorStart: '2026-07-11', priorEnd: '2026-09-08' })
  })

  it('a short prior month stops at its own last day', () => {
    const w = bookingWindows('2026-03-31').find(x => x.key === 'month')!
    expect(w.priorStart).toBe('2026-02-01')
    expect(w.priorEnd).toBe('2026-02-28')
  })

  it('counts a party on the day its first payment landed (Eastern), value = its total, and compares with the prior window', () => {
    const rows = [
      booked({ bookedAt: '2026-11-06T03:00:00Z', totalCents: 10_000 }), // 11:00 PM ET on Nov 5
      booked({ bookedAt: '2026-11-02T15:00:00Z', totalCents: 20_000 }),
      booked({ bookedAt: '2026-10-28T15:00:00Z', totalCents: 5_000 }), // prior week
      booked({ bookedAt: '2026-10-02T15:00:00Z', totalCents: 7_000 }),
      booked({ bookedAt: null, totalCents: 9_999 }),
      booked({ stage: 'cancelled', bookedAt: '2026-11-02T15:00:00Z', totalCents: 9_999 }),
      booked({ stage: 'completed', bookedAt: '2026-11-03T15:00:00Z', totalCents: 1_000 }),
    ]
    const m = Object.fromEntries(bookingsMade(rows, TODAY).map(x => [x.key, x]))
    expect(m.week).toMatchObject({ count: 3, cents: 31_000, prior: { count: 1, cents: 5_000 } })
    expect(m.month.count).toBe(3)
    expect(m.last30).toMatchObject({ count: 4, cents: 36_000 })
    expect(m.last60.count).toBe(5)
  })
})

describe('leads', () => {
  const at = (day: string) => ({ createdAt: `${day}T15:00:00Z` })

  it('buckets new inquiries by week for twelve weeks, the last one partial', () => {
    const v = leadVelocity([at('2026-11-02'), at('2026-11-03'), at('2026-10-27'), at('2026-10-26'), at('2026-10-20'), at('2026-02-01')], TODAY)
    expect(v.series).toHaveLength(12)
    expect(v.series[11]).toMatchObject({ weekStart: '2026-11-01', count: 2, partial: true })
    expect(v.series[10]).toMatchObject({ weekStart: '2026-10-25', count: 2, partial: false })
    expect(v.series[9].count).toBe(1)
    expect(v.series.reduce((s, r) => s + r.count, 0)).toBe(5) // the February one is off the chart
    expect(v.thisWeek).toBe(2)
    expect(v.lastWeek).toBe(2)
    expect(v.thisMonth).toBe(2)
  })

  it('reads the trend from the last four complete weeks against the four before', () => {
    const lots = (day: string, n: number) => Array.from({ length: n }, () => at(day))
    // weeks starting Oct 25, Oct 18, Oct 11, Oct 4 (recent) vs Sep 27, Sep 20, Sep 13, Sep 6 (earlier)
    const up = leadVelocity([...lots('2026-10-26', 6), ...lots('2026-10-19', 6), ...lots('2026-10-12', 6), ...lots('2026-10-05', 6), ...lots('2026-09-28', 3), ...lots('2026-09-21', 3), ...lots('2026-09-14', 3), ...lots('2026-09-07', 3)], TODAY)
    expect(up).toMatchObject({ perWeekRecent: 6, perWeekEarlier: 3, changePct: 100, trend: 'up' })
    const down = leadVelocity([...lots('2026-10-26', 3), ...lots('2026-09-28', 6), ...lots('2026-09-21', 6)], TODAY)
    expect(down.trend).toBe('down')
    expect(leadVelocity([], TODAY)).toMatchObject({ trend: 'flat', changePct: 0, perWeekRecent: 0 })
  })

  it('open leads: count, quoted value, and how many are unpriced', () => {
    expect(openLeads([{ totalCents: 50_000 }, { totalCents: 0 }, { totalCents: null }, { totalCents: 25_000 }])).toEqual({ count: 4, valueCents: 75_000, unpriced: 2 })
    expect(openLeads([])).toEqual({ count: 0, valueCents: 0, unpriced: 0 })
  })
})

describe('upcoming events', () => {
  it('lists the soonest first, totals signups and revenue, and drops past events', () => {
    const e = (id: string, date: string, signups: number, revenueCents: number) => ({ id, title: id, date, capacity: 20, signups, revenueCents })
    const r = upcomingEvents([e('late', '2026-12-20', 4, 4_000), e('past', '2026-11-06', 9, 9_000), e('soon', '2026-11-08', 3, 3_000), e('today', TODAY, 1, 1_000)], TODAY)
    expect(r.events.map(x => x.id)).toEqual(['today', 'soon', 'late'])
    expect(r).toMatchObject({ count: 3, signups: 8, revenueCents: 8_000 })
    expect(upcomingEvents([e('a', '2027-01-01', 1, 1), e('b', '2027-01-02', 1, 1)], TODAY, 1).events).toHaveLength(1)
  })
})
