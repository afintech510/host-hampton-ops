import { autosendAllowedFor, eviteAutosendSince, evitePagesMode, eviteSendsMode, isPilotBooking } from '@/lib/evites/config'

const KEYS = ['EVITES_PAGES', 'EVITES_SENDS', 'EVITES_PILOT_REFS', 'EVITES_AUTOSEND_SINCE'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('evites/config modes', () => {
  it('unset reads as off', () => {
    expect(evitePagesMode()).toBe('off')
    expect(eviteSendsMode()).toBe('off')
  })

  it.each(['off', 'pilot', 'on'] as const)('recognises %s on both flags', (mode) => {
    process.env.EVITES_PAGES = mode
    process.env.EVITES_SENDS = mode
    expect(evitePagesMode()).toBe(mode)
    expect(eviteSendsMode()).toBe(mode)
  })

  it('trims and lower-cases', () => {
    process.env.EVITES_PAGES = '  ON '
    process.env.EVITES_SENDS = 'Pilot'
    expect(evitePagesMode()).toBe('on')
    expect(eviteSendsMode()).toBe('pilot')
  })

  it.each(['', 'true', 'false', '1', '0', 'enabled', 'yes', 'onn', 'p1lot', 'on,pilot', 'null', 'undefined'])(
    'garbage %j reads as off',
    (v) => {
      process.env.EVITES_PAGES = v
      process.env.EVITES_SENDS = v
      expect(evitePagesMode()).toBe('off')
      expect(eviteSendsMode()).toBe('off')
    },
  )

  it('the two flags are independent', () => {
    process.env.EVITES_PAGES = 'on'
    process.env.EVITES_SENDS = 'off'
    expect(evitePagesMode()).toBe('on')
    expect(eviteSendsMode()).toBe('off')
  })

  it('is read at call time, not frozen at import', () => {
    expect(evitePagesMode()).toBe('off')
    process.env.EVITES_PAGES = 'on'
    expect(evitePagesMode()).toBe('on')
  })
})

describe('evites/config isPilotBooking', () => {
  it('is false when the list is unset or empty', () => {
    expect(isPilotBooking('HH-PTY-AAAAA')).toBe(false)
    process.env.EVITES_PILOT_REFS = ''
    expect(isPilotBooking('HH-PTY-AAAAA')).toBe(false)
    process.env.EVITES_PILOT_REFS = ' , ,'
    expect(isPilotBooking('')).toBe(false)
  })

  it('matches listed refs, trimmed and case-insensitively', () => {
    process.env.EVITES_PILOT_REFS = 'HH-PTY-AAAAA, hh-pty-bbbbb ,HH-PTY-CCCCC'
    expect(isPilotBooking('HH-PTY-AAAAA')).toBe(true)
    expect(isPilotBooking('HH-PTY-BBBBB')).toBe(true)
    expect(isPilotBooking(' hh-pty-ccccc ')).toBe(true)
    expect(isPilotBooking('HH-PTY-DDDDD')).toBe(false)
  })

  it('is exact: a prefix of a listed ref is not a match', () => {
    process.env.EVITES_PILOT_REFS = 'HH-PTY-AAAAA'
    expect(isPilotBooking('HH-PTY-AAAA')).toBe(false)
    expect(isPilotBooking('HH-PTY-AAAAAX')).toBe(false)
  })

  it('null, undefined and non-strings are never pilot', () => {
    process.env.EVITES_PILOT_REFS = 'HH-PTY-AAAAA'
    expect(isPilotBooking(null)).toBe(false)
    expect(isPilotBooking(undefined)).toBe(false)
    expect(isPilotBooking(5 as unknown as string)).toBe(false)
  })
})

describe('evites/config EVITES_AUTOSEND_SINCE (the launch cutoff for the automatic parent emails)', () => {
  it('unset or empty: no cutoff, so nothing is allowed automatically (fail closed)', () => {
    expect(eviteAutosendSince()).toBeNull()
    expect(autosendAllowedFor('2030-01-01T00:00:00Z')).toBe(false)
    process.env.EVITES_AUTOSEND_SINCE = '  '
    expect(eviteAutosendSince()).toBeNull()
  })

  it.each(['2026', '2026-10', '2026-10-12', '2026-10-12T00:00', '2026-10-12T00:00:00', '12 Oct 2026', 'now', 'true', '2026-13-01T00:00:00Z', '2026-10-32T00:00:00Z', '2026-10-12T24:00:00Z', '2026-10-12T00:60:00Z'])(
    'rejects %j (not a full ISO datetime with a zone)',
    (v) => {
      process.env.EVITES_AUTOSEND_SINCE = v
      expect(eviteAutosendSince()).toBeNull()
      expect(autosendAllowedFor('2099-01-01T00:00:00Z')).toBe(false)
    },
  )

  it('reads a full ISO datetime, with Z or an offset, trimmed', () => {
    process.env.EVITES_AUTOSEND_SINCE = ' 2026-10-12T04:00:00Z '
    expect(eviteAutosendSince()?.toISOString()).toBe('2026-10-12T04:00:00.000Z')
    process.env.EVITES_AUTOSEND_SINCE = '2026-10-12T00:00:00-04:00'
    expect(eviteAutosendSince()?.toISOString()).toBe('2026-10-12T04:00:00.000Z')
    process.env.EVITES_AUTOSEND_SINCE = '2026-10-12T04:00Z'
    expect(eviteAutosendSince()?.toISOString()).toBe('2026-10-12T04:00:00.000Z')
  })

  it('allows a booking created at or after the cutoff, never one before, and never one with no readable creation time', () => {
    process.env.EVITES_AUTOSEND_SINCE = '2026-10-12T04:00:00Z'
    expect(autosendAllowedFor('2026-10-12T04:00:00Z')).toBe(true)
    expect(autosendAllowedFor('2026-10-12T04:00:01.500Z')).toBe(true)
    expect(autosendAllowedFor('2026-10-12T03:59:59Z')).toBe(false)
    expect(autosendAllowedFor(null)).toBe(false)
    expect(autosendAllowedFor(undefined)).toBe(false)
    expect(autosendAllowedFor('')).toBe(false)
    expect(autosendAllowedFor('garbage')).toBe(false)
  })
})
