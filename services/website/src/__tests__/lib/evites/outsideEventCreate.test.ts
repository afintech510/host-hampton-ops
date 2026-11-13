import { screenOutsideEvent } from '@/lib/evites/outsideEventCreate'

const GOOD = {
  childName: 'Maeghan',
  occasion: 'Baby Shower',
  venueName: 'James Joyce',
  locationAddress: '49 S Ocean Ave, Patchogue, NY 11772',
  partyDate: '2027-01-30',
  partyTime: '12:00',
  eventEndTime: '15:00',
}

const err = (over: Record<string, unknown>) => {
  const r = screenOutsideEvent({ ...GOOD, ...over })
  return r.ok ? null : r.error
}

describe('screenOutsideEvent', () => {
  it('accepts the first real one and builds exactly the tags the invitation reads', () => {
    const r = screenOutsideEvent(GOOD)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toMatchObject({ honoree: 'Maeghan', occasion: 'Baby Shower', partyDate: '2027-01-30', partyTime: '12:00', guestCount: null, audience: 'guests' })
    expect(r.value.partyTags).toEqual({
      location_type: 'mobile',
      occasion: 'Baby Shower',
      audience: 'guests',
      venue_name: 'James Joyce',
      location_address: '49 S Ocean Ave, Patchogue, NY 11772',
      event_end_time: '15:00',
    })
  })

  it('stores times as 24-hour HH:MM whichever way they were typed', () => {
    const r = screenOutsideEvent({ ...GOOD, partyTime: '12:00 PM', eventEndTime: '3:00 PM' })
    expect(r.ok && r.value.partyTime).toBe('12:00')
    expect(r.ok && r.value.partyTags.event_end_time).toBe('15:00')
    const pm = screenOutsideEvent({ ...GOOD, partyTime: '1:30pm', eventEndTime: '' })
    expect(pm.ok && pm.value.partyTime).toBe('13:30')
    expect(pm.ok && 'event_end_time' in pm.value.partyTags).toBe(false)
  })

  it('the honoree and the occasion are required', () => {
    expect(err({ childName: '' })).toMatch(/honoree/i)
    expect(err({ childName: undefined })).toMatch(/honoree/i)
    expect(err({ occasion: '  ' })).toMatch(/what the event is/i)
  })

  it('the date must be a real calendar date', () => {
    for (const d of ['', undefined, '2027-02-30', '2027-1-5', 'Jan 30']) expect(err({ partyDate: d })).toMatch(/date/i)
  })

  it('the start must be a clock time the invitation can place (8 AM to 9 PM)', () => {
    for (const t of ['', undefined, 'noon', '07:00', '21:30', '23:00']) expect(err({ partyTime: t })).toMatch(/start time/i)
    expect(err({ partyTime: '08:00' })).toBeNull()
    expect(err({ partyTime: '21:00', eventEndTime: undefined })).toBeNull()
  })

  it('an end that is before the start, equal to it, or more than 12 hours later is refused, not ignored', () => {
    for (const e of ['11:00', '12:00', 'soon']) expect(err({ eventEndTime: e })).toMatch(/end time/i)
    expect(err({ partyTime: '08:00', eventEndTime: '21:00' })).toMatch(/end time/i)
    expect(err({ eventEndTime: undefined })).toBeNull()
  })

  it('needs the venue name or a street address, and refuses an address with no street number', () => {
    expect(err({ venueName: undefined })).toBeNull()
    expect(err({ locationAddress: undefined })).toBeNull()
    expect(err({ venueName: undefined, locationAddress: undefined })).toMatch(/venue/i)
    expect(err({ locationAddress: 'Patchogue' })).toMatch(/street number/i)
    expect(err({ locationAddress: 'TBD' })).toMatch(/street number/i)
  })

  it('audience: adults unless it says kids', () => {
    const aud = (audience: unknown) => {
      const r = screenOutsideEvent({ ...GOOD, audience })
      return r.ok ? r.value.audience : null
    }
    expect(aud(undefined)).toBe('guests')
    expect(aud('guests')).toBe('guests')
    expect(aud('whatever')).toBe('guests')
    expect(aud('kids')).toBe('kids')
  })

  it('the guest count is optional, and a whole number from 1 to 500 when given', () => {
    const count = (guestCount: unknown) => {
      const r = screenOutsideEvent({ ...GOOD, guestCount })
      return r.ok ? r.value.guestCount : 'refused'
    }
    expect(count(undefined)).toBeNull()
    expect(count('')).toBeNull()
    expect(count(40)).toBe(40)
    expect(count('40')).toBe(40)
    for (const bad of [0, -3, 2.5, 501, 'many']) expect(count(bad)).toBe('refused')
  })

  it('control characters and runs of spaces never reach a tag', () => {
    const r = screenOutsideEvent({ ...GOOD, venueName: ' James\n  Joyce\t', occasion: 'Baby\u0000  Shower' })
    expect(r.ok && r.value.partyTags.venue_name).toBe('James Joyce')
    expect(r.ok && r.value.partyTags.occasion).toBe('Baby Shower')
  })
})
