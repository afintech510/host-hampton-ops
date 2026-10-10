import {
  partyWindow,
  partyDurationMinutes,
  validPartyDate,
  DURATION_THEME_MIN,
  DURATION_MINI_MIN,
  DURATION_MOBILE_ENTRY_MIN,
  DURATION_MOBILE_SIGNATURE_MIN,
} from '@/lib/evites/partyWindow'

const theme = (over: Record<string, unknown> = {}) => ({
  party_type: 'in_studio_theme',
  party_date: '2026-11-14', // a Saturday; EST (UTC-5)
  party_time: '14:00',
  package_type: 'Glow Party',
  party_tags: { location_type: 'host_hampton' },
  quote_snapshot: null,
  ...over,
})

const mobile = (over: Record<string, unknown> = {}) =>
  theme({ party_type: 'mobile_party', party_tags: { location_type: 'mobile' }, ...over })

const iso = (d: Date | undefined) => d?.toISOString()

describe('evites/partyWindow - start time', () => {
  it('"14:00" on a November Saturday is 14:00 EST = 19:00Z, and a theme party runs 120 minutes', () => {
    const w = partyWindow(theme())
    expect(iso(w?.startUtc)).toBe('2026-11-14T19:00:00.000Z')
    expect(iso(w?.endUtc)).toBe('2026-11-14T21:00:00.000Z')
  })

  it.each([
    ['2:00 PM', '2026-11-14T19:00:00.000Z'],
    ['12:00 PM', '2026-11-14T17:00:00.000Z'], // noon
    ['10:30', '2026-11-14T15:30:00.000Z'], // 10:30 with no period is 10:30 AM, inside 08:00-21:00
    ['10:30 AM', '2026-11-14T15:30:00.000Z'],
    ['9:00 PM', '2026-11-15T02:00:00.000Z'], // 21:00 is inclusive
    ['8:00 AM', '2026-11-14T13:00:00.000Z'], // 08:00 is inclusive
  ])('%s is accepted', (time, startIso) => {
    expect(iso(partyWindow(theme({ party_time: time }))?.startUtc)).toBe(startIso)
  })

  it.each([
    ['Evening'],
    ['TBD'],
    [''],
    ['   '],
    ['2:00'], // parseTime reads this as 02:00; outside 08:00-21:00 it is "unknown", not a 2 AM party
    ['23:00'],
    ['7:59'],
    ['21:01'],
    ['9:30 PM'],
    ['12:00 AM'],
    ['25:00'],
    ['10:75'],
  ])('%j is null', (time) => {
    expect(partyWindow(theme({ party_time: time }))).toBeNull()
  })

  it('a null or non-string time is null', () => {
    expect(partyWindow(theme({ party_time: null }))).toBeNull()
    expect(partyWindow(theme({ party_time: 14 }))).toBeNull()
    expect(partyWindow(null)).toBeNull()
    expect(partyWindow(undefined)).toBeNull()
  })
})

describe('evites/partyWindow - the date is a real calendar date', () => {
  it.each([[null], [undefined], [''], ['2026'], ['2026-11'], ['2026-13-01'], ['2026-02-31'], ['11/14/2026'], ['Saturday'], [20261114]])(
    '%j is null',
    (d) => {
      expect(partyWindow(theme({ party_date: d }))).toBeNull()
    },
  )

  it('a timestamp-shaped date column is read by its date part', () => {
    expect(validPartyDate('2026-11-14T00:00:00')).toBe('2026-11-14')
    expect(iso(partyWindow(theme({ party_date: '2026-11-14T00:00:00' }))?.startUtc)).toBe('2026-11-14T19:00:00.000Z')
  })

  it('a leap day is real and a non-leap Feb 29 is not', () => {
    expect(validPartyDate('2028-02-29')).toBe('2028-02-29')
    expect(validPartyDate('2026-02-29')).toBeNull()
  })
})

describe('evites/partyWindow - DST boundaries (the box is UTC)', () => {
  it('Saturday Oct 31 2026 is still EDT (UTC-4); the next Saturday is EST (UTC-5)', () => {
    expect(iso(partyWindow(theme({ party_date: '2026-10-31' }))?.startUtc)).toBe('2026-10-31T18:00:00.000Z')
    expect(iso(partyWindow(theme({ party_date: '2026-11-07' }))?.startUtc)).toBe('2026-11-07T19:00:00.000Z')
  })

  it('the Sunday it falls back (Nov 1 2026), 14:00 is EST', () => {
    const w = partyWindow(theme({ party_date: '2026-11-01' }))
    expect(iso(w?.startUtc)).toBe('2026-11-01T19:00:00.000Z')
    expect(iso(w?.endUtc)).toBe('2026-11-01T21:00:00.000Z')
  })

  it('Saturday Mar 7 2026 is EST; the Sunday it springs forward (Mar 8) and the next Saturday are EDT', () => {
    expect(iso(partyWindow(theme({ party_date: '2026-03-07' }))?.startUtc)).toBe('2026-03-07T19:00:00.000Z')
    expect(iso(partyWindow(theme({ party_date: '2026-03-08' }))?.startUtc)).toBe('2026-03-08T18:00:00.000Z')
    expect(iso(partyWindow(theme({ party_date: '2026-03-14' }))?.startUtc)).toBe('2026-03-14T18:00:00.000Z')
  })

  it('an 8 AM start on the fall-back Sunday is after the change (EST)', () => {
    expect(iso(partyWindow(theme({ party_date: '2026-11-01', party_time: '8:00 AM' }))?.startUtc)).toBe('2026-11-01T13:00:00.000Z')
  })
})

describe('evites/partyWindow - duration', () => {
  it('a theme party is 120 minutes', () => {
    expect(partyDurationMinutes(theme())).toBe(DURATION_THEME_MIN)
    expect(DURATION_THEME_MIN).toBe(120)
  })

  it('a mini party (quote_snapshot.isMiniParty) is 90 minutes', () => {
    const b = theme({ quote_snapshot: { isMiniParty: true } })
    expect(partyDurationMinutes(b)).toBe(DURATION_MINI_MIN)
    expect(iso(partyWindow(b)?.endUtc)).toBe('2026-11-14T20:30:00.000Z')
    // only a real boolean true counts
    expect(partyDurationMinutes(theme({ quote_snapshot: { isMiniParty: 'true' } }))).toBe(120)
    expect(partyDurationMinutes(theme({ quote_snapshot: { isMiniParty: false } }))).toBe(120)
  })

  it('a mobile party is 90 by default (Signature) and 60 only when the booking says Entry', () => {
    expect(partyDurationMinutes(mobile())).toBe(DURATION_MOBILE_SIGNATURE_MIN)
    expect(partyDurationMinutes(mobile({ package_type: 'Mobile Party - Signature' }))).toBe(90)
    expect(partyDurationMinutes(mobile({ package_type: 'Mobile Entry Party' }))).toBe(DURATION_MOBILE_ENTRY_MIN)
    expect(partyDurationMinutes(mobile({ quote_snapshot: { mobileTier: 'Entry' } }))).toBe(60)
    expect(partyDurationMinutes(mobile({ party_tags: { location_type: 'mobile', mobile_tier: 'entry' } }))).toBe(60)
    expect(iso(partyWindow(mobile({ package_type: 'Entry' }))?.endUtc)).toBe('2026-11-14T20:00:00.000Z')
    expect(iso(partyWindow(mobile())?.endUtc)).toBe('2026-11-14T20:30:00.000Z')
  })

  it('"Entertainment" is not "Entry"', () => {
    expect(partyDurationMinutes(mobile({ package_type: 'Entertainment Party' }))).toBe(90)
  })

  it('location_type beats party_type: the planner writes in_studio_theme for a mobile plan', () => {
    const planner = theme({ party_type: 'in_studio_theme', party_tags: { location_type: 'mobile' } })
    expect(partyDurationMinutes(planner)).toBe(90)
    // and a studio location on a mobile_party row is the studio
    expect(partyDurationMinutes(theme({ party_type: 'mobile_party', party_tags: { location_type: 'host_hampton' } }))).toBe(120)
  })

  it('a mobile party that is also flagged mini is still a mobile party', () => {
    expect(partyDurationMinutes(mobile({ quote_snapshot: { isMiniParty: true } }))).toBe(90)
  })
})
