import { parseTime, etToUtc, shiftEtDate } from '@/lib/partyTime'

describe('parseTime', () => {
  it('parses 12-hour times', () => {
    expect(parseTime('2:00 PM')).toEqual({ hours: 14, minutes: 0 })
    expect(parseTime('9:30 AM')).toEqual({ hours: 9, minutes: 30 })
  })

  it('handles the 12 AM / 12 PM edge cases', () => {
    expect(parseTime('12:00 AM')).toEqual({ hours: 0, minutes: 0 })
    expect(parseTime('12:00 PM')).toEqual({ hours: 12, minutes: 0 })
  })

  it('parses 24-hour times', () => {
    expect(parseTime('19:00')).toEqual({ hours: 19, minutes: 0 })
  })

  it('returns null for unparseable free text', () => {
    expect(parseTime('afternoon')).toBeNull()
    expect(parseTime('')).toBeNull()
  })
})

describe('etToUtc', () => {
  // The whole point of this helper: the server runs in UTC, so a naive
  // setHours() would schedule these 4-5 hours early.
  it('converts a summer (EDT, UTC-4) wall clock', () => {
    expect(etToUtc('2026-07-04', 6, 0).toISOString()).toBe('2026-07-04T10:00:00.000Z')
  })

  it('converts a winter (EST, UTC-5) wall clock', () => {
    expect(etToUtc('2026-12-05', 6, 0).toISOString()).toBe('2026-12-05T11:00:00.000Z')
  })

  it('converts an afternoon party start', () => {
    expect(etToUtc('2026-10-11', 14, 0).toISOString()).toBe('2026-10-11T18:00:00.000Z')
  })

  it('respects minutes', () => {
    expect(etToUtc('2026-07-04', 14, 30).toISOString()).toBe('2026-07-04T18:30:00.000Z')
  })

  it('handles the day DST starts (spring forward, 2026-03-08)', () => {
    // 6am local on that date is already EDT.
    expect(etToUtc('2026-03-08', 6, 0).toISOString()).toBe('2026-03-08T10:00:00.000Z')
  })

  it('handles the day DST ends (fall back, 2026-11-01)', () => {
    // 6am local on that date is already back on EST.
    expect(etToUtc('2026-11-01', 6, 0).toISOString()).toBe('2026-11-01T11:00:00.000Z')
  })

  it('returns an invalid date for a malformed input', () => {
    expect(Number.isNaN(etToUtc('nonsense', 6, 0).getTime())).toBe(true)
  })
})

/**
 * shiftEtDate — the calendar arithmetic every reminder time is built on.
 *
 * The truncated-date cases below exist because the attack harness found a
 * real hole here: removing the `^\\d{4}-\\d{2}-\\d{2}` screen left the whole
 * suite green. `new Date("2026T12:00:00Z")` is NOT an Invalid Date — the
 * ECMAScript date parser reads a bare year as January 1st, and a bare
 * year-month as the 1st of that month. So a truncated `party_date` would not
 * have been refused; it would have silently scheduled a real customer's
 * reminders around a date they never chose. The `isFinite` check downstream
 * cannot catch it, because the date IS finite. Only the screen catches it.
 */
describe('shiftEtDate', () => {
  it('shifts forward and backward across month and year boundaries', () => {
    expect(shiftEtDate('2026-10-10', -7)).toBe('2026-10-03')
    expect(shiftEtDate('2026-10-01', -1)).toBe('2026-09-30')
    expect(shiftEtDate('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftEtDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftEtDate('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('is unaffected by either DST transition — the anchor is noon UTC', () => {
    // 2026-03-08 (spring forward) and 2026-11-01 (fall back).
    expect(shiftEtDate('2026-03-08', 1)).toBe('2026-03-09')
    expect(shiftEtDate('2026-03-09', -1)).toBe('2026-03-08')
    expect(shiftEtDate('2026-11-01', 1)).toBe('2026-11-02')
    expect(shiftEtDate('2026-11-02', -1)).toBe('2026-11-01')
  })

  it('REFUSES a truncated date rather than inventing January 1st', () => {
    // Without the screen these return real-looking dates: "2026" becomes
    // 2026-01-01 and "2026-10" becomes 2026-10-01.
    expect(shiftEtDate('2026', 0)).toBe('')
    expect(shiftEtDate('2026', -7)).toBe('')
    expect(shiftEtDate('2026-10', 0)).toBe('')
    expect(shiftEtDate('2026-10', 1)).toBe('')
  })

  it('refuses every other unusable shape, and returns a string not an Invalid Date', () => {
    let examined = 0
    for (const bad of ['', 'nonsense', 'afternoon', 'Oct 10 2026', '20261010', '2026/10/10', '  2026-10-10', '2026-1-1']) {
      expect(shiftEtDate(bad as string, 0)).toBe('')
      examined++
    }
    // Count what was examined: a loop that ran zero times passes.
    expect(examined).toBe(8)
  })

  it('accepts a full timestamp by taking its date part — party_date is a DATE column', () => {
    expect(shiftEtDate('2026-10-10T00:00:00+00:00', 0)).toBe('2026-10-10')
  })
})
