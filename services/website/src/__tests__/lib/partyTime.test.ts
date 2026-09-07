import { parseTime, etToUtc } from '@/lib/partyTime'

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
