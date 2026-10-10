import { evitePagesMode, eviteSendsMode, isPilotBooking } from '@/lib/evites/config'

const KEYS = ['EVITES_PAGES', 'EVITES_SENDS', 'EVITES_PILOT_REFS'] as const
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
