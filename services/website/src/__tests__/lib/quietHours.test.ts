/**
 * The SMS quiet-hours window.
 *
 * Every assertion names an EASTERN wall-clock time and the UTC instant it
 * corresponds to, in both DST halves — because the whole reason this module
 * exists is that a fixed offset is wrong for half the year, and a test that only
 * ever runs in one season cannot tell the difference.
 */

import {
  checkSmsQuietHours,
  nextWindowOpen,
  etHourMinute,
  SMS_WINDOW_OPEN_HOUR,
  SMS_WINDOW_CLOSE_HOUR,
} from '@/lib/quietHours'

/** An Eastern wall-clock time expressed as the UTC instant it really is. */
const EDT = (d: string, hhmm: string) => new Date(`${d}T${hhmm}:00-04:00`)
const EST = (d: string, hhmm: string) => new Date(`${d}T${hhmm}:00-05:00`)

describe('the window itself', () => {
  it('opens at 8am and closes at 9pm', () => {
    expect(SMS_WINDOW_OPEN_HOUR).toBe(8)
    expect(SMS_WINDOW_CLOSE_HOUR).toBe(21)
  })
})

describe('inside the window', () => {
  it.each([
    ['08:00 EDT — the moment it opens', EDT('2026-10-09', '08:00')],
    ['12:00 EDT — the middle of the day', EDT('2026-10-09', '12:00')],
    ['20:59 EDT — the last minute', EDT('2026-10-09', '20:59')],
    ['08:00 EST — the same boundary in winter', EST('2026-12-11', '08:00')],
    ['20:59 EST', EST('2026-12-11', '20:59')],
  ])('%s is open', (_label, at) => {
    expect(checkSmsQuietHours(at).kind).toBe('open')
  })
})

describe('outside the window', () => {
  it.each([
    ['07:59 EDT — one minute early', EDT('2026-10-09', '07:59')],
    ['06:00 EDT — where event_sms_1day used to land', EDT('2026-10-09', '06:00')],
    ['03:00 EDT — the middle of the night', EDT('2026-10-09', '03:00')],
    ['21:00 EDT — the moment it closes', EDT('2026-10-09', '21:00')],
    ['23:30 EDT', EDT('2026-10-09', '23:30')],
    ['05:00 EST — where event_sms_1day landed in winter', EST('2026-12-11', '05:00')],
    ['07:00 EST — where booking_sms_1day landed in winter', EST('2026-12-11', '07:00')],
  ])('%s is quiet', (_label, at) => {
    expect(checkSmsQuietHours(at).kind).toBe('quiet')
  })

  it('names the local clock time in the reason, not the UTC one', () => {
    const v = checkSmsQuietHours(EDT('2026-10-09', '06:30'))
    expect(v.kind).toBe('quiet')
    if (v.kind !== 'quiet') throw new Error('unreachable')
    // Rule 10: a guardrail must say what it stopped, in terms a human can act
    // on. "10:30" — the UTC hour — would send somebody hunting the wrong bug.
    expect(v.reason).toContain('06:30 local')
    expect(v.reason).toContain('quiet_hours')
  })
})

describe('when it defers to', () => {
  it('an early-morning text waits for 8am the SAME day', () => {
    const v = checkSmsQuietHours(EDT('2026-10-09', '06:00'))
    if (v.kind !== 'quiet') throw new Error('expected quiet')
    expect(v.until.toISOString()).toBe(EDT('2026-10-09', '08:00').toISOString())
  })

  it('a late-night text waits for 8am the NEXT day', () => {
    const v = checkSmsQuietHours(EDT('2026-10-09', '22:30'))
    if (v.kind !== 'quiet') throw new Error('expected quiet')
    expect(v.until.toISOString()).toBe(EDT('2026-10-10', '08:00').toISOString())
  })

  it('lands on the top of the hour, not on the original due minute', () => {
    const v = checkSmsQuietHours(EDT('2026-10-09', '06:37'))
    if (v.kind !== 'quiet') throw new Error('expected quiet')
    expect(v.until.toISOString()).toBe(EDT('2026-10-09', '08:00').toISOString())
  })

  it('resolves 8am EST correctly in winter — an offset computed once would be an hour out', () => {
    const v = checkSmsQuietHours(EST('2026-12-11', '05:00'))
    if (v.kind !== 'quiet') throw new Error('expected quiet')
    expect(v.until.toISOString()).toBe(EST('2026-12-11', '08:00').toISOString())
  })

  /**
   * 2026-11-01 is the fall-back transition: 2am EDT becomes 1am EST, so that
   * local day is 25 hours long. A deferral computed by adding a fixed number of
   * hours would land at 7am, an hour before the window opens, and the next tick
   * would defer it again.
   */
  it('crosses the fall-back DST boundary without landing early', () => {
    const v = checkSmsQuietHours(new Date('2026-10-31T23:00:00-04:00'))
    if (v.kind !== 'quiet') throw new Error('expected quiet')
    const landed = etHourMinute(v.until)
    expect(landed).toEqual({ hour: 8, minute: 0 })
  })

  /** 2026-03-08: 2am EST becomes 3am EDT, a 23-hour day. */
  it('crosses the spring-forward DST boundary without landing late', () => {
    const v = checkSmsQuietHours(new Date('2026-03-07T23:00:00-05:00'))
    if (v.kind !== 'quiet') throw new Error('expected quiet')
    const landed = etHourMinute(v.until)
    expect(landed).toEqual({ hour: 8, minute: 0 })
  })

  it('a deferral is always in the future — it can never reschedule into the past', () => {
    for (const hour of [0, 1, 5, 7, 21, 22, 23]) {
      const at = new Date(`2026-10-09T${String(hour).padStart(2, '0')}:15:00-04:00`)
      const v = checkSmsQuietHours(at)
      if (v.kind !== 'quiet') throw new Error(`expected quiet at ${hour}`)
      expect(v.until.getTime()).toBeGreaterThan(at.getTime())
    }
  })

  it('never defers by more than the 11 hours the widest gap needs', () => {
    for (const hour of [0, 1, 5, 7, 21, 22, 23]) {
      const at = new Date(`2026-10-09T${String(hour).padStart(2, '0')}:15:00-04:00`)
      const v = checkSmsQuietHours(at)
      if (v.kind !== 'quiet') throw new Error(`expected quiet at ${hour}`)
      // Comfortably inside REMINDER_MAX_LATENESS_HOURS (48), so a deferral can
      // never push a row over the freshness bound and get it cancelled.
      expect(v.until.getTime() - at.getTime()).toBeLessThanOrEqual(11 * 60 * 60 * 1000)
    }
  })
})

describe('rule 12: an hour that cannot be read is not an hour we may text in', () => {
  it('returns "unreadable" for an Invalid Date rather than "open"', () => {
    const v = checkSmsQuietHours(new Date('not a date'))
    expect(v.kind).toBe('unreadable')
  })

  it('etHourMinute returns null rather than NaN', () => {
    expect(etHourMinute(new Date(NaN))).toBeNull()
  })
})

describe('nextWindowOpen terminates', () => {
  it('is idempotent — asking again from the answer gives the answer', () => {
    const first = nextWindowOpen(EDT('2026-10-09', '03:00'))
    expect(etHourMinute(first)).toEqual({ hour: 8, minute: 0 })
    // 08:00 is inside the window, so the window "opens" right there.
    expect(nextWindowOpen(first).toISOString()).toBe(first.toISOString())
  })

  it('resolves to hour 8 local for every hour of a normal day', () => {
    let examined = 0
    for (let h = 0; h < 24; h++) {
      const at = new Date(`2026-10-09T${String(h).padStart(2, '0')}:00:00-04:00`)
      expect(etHourMinute(nextWindowOpen(at))).toEqual({ hour: 8, minute: 0 })
      examined++
    }
    // Count what was examined (link 24's R8): a loop that ran zero times passes.
    expect(examined).toBe(24)
  })
})
