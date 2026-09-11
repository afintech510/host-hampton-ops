import {
  classifyPartyType,
  evaluateRequiredInfo,
  evaluateInquiry,
  hasStudioDuration,
  hasVenueAddress,
  describeMissing,
  type InquiryBooking,
} from '@/lib/inquiryDrafts'

/** A fully-specified booking; individual tests override fields to create gaps. */
function booking(overrides: Partial<InquiryBooking> = {}): InquiryBooking {
  return {
    event_type: 'studio-rental',
    package_type: null,
    notes: null,
    party_tags: { duration_hours: 3 },
    contact_name: 'Holly Gioso',
    contact_email: 'holly@example.com',
    contact_phone: '+16315551234',
    party_date: '2026-10-03',
    party_time: '9-12, 3 hrs',
    guest_count_approx: 30,
    child_name: null,
    child_age: null,
    ...overrides,
  }
}

describe('classifyPartyType', () => {
  it('classifies an explicit studio-rental event_type', () => {
    expect(classifyPartyType(booking({ event_type: 'studio-rental' })).partyType).toBe('studio_rental')
  })

  it('classifies room-rental as studio_rental', () => {
    expect(classifyPartyType(booking({ event_type: 'room-rental' })).partyType).toBe('studio_rental')
  })

  it('classifies a mobile craft party from keywords', () => {
    const c = classifyPartyType(booking({ event_type: 'other', notes: 'Mobile craft party at our home' }))
    expect(c.partyType).toBe('mobile_party')
  })

  it('prefers mobile over in-studio when both signals are present', () => {
    const c = classifyPartyType(
      booking({ event_type: 'Kids Birthday Party', notes: 'wants a mobile party at their house' }),
    )
    expect(c.partyType).toBe('mobile_party')
  })

  it('classifies an in-studio themed party from a label event_type', () => {
    const c = classifyPartyType(
      booking({ event_type: 'Kids Birthday Party', package_type: 'Glow Party', party_tags: {} }),
    )
    expect(c.partyType).toBe('in_studio_theme')
  })

  it('low-confidence in_studio_theme when only a package + child details exist', () => {
    const c = classifyPartyType(
      booking({ event_type: 'other', package_type: 'Mystery Package', child_age: 6, party_tags: {} }),
    )
    expect(c.partyType).toBe('in_studio_theme')
    expect(c.confidence).toBe('low')
  })

  it('returns unknown when there is no confident signal', () => {
    const c = classifyPartyType(
      booking({ event_type: 'other', package_type: null, notes: null, party_tags: {}, child_age: null }),
    )
    expect(c.partyType).toBe('unknown')
  })
})

describe('hasStudioDuration', () => {
  it('detects a duration in party_tags', () => {
    expect(hasStudioDuration(booking({ party_time: '', party_tags: { duration_hours: 3 } }))).toBe(true)
  })
  it('detects "3 hrs" text in party_time', () => {
    expect(hasStudioDuration(booking({ party_tags: {}, party_time: '9-12, 3 hrs' }))).toBe(true)
  })
  it('detects a plain time range as an implied duration', () => {
    expect(hasStudioDuration(booking({ party_tags: {}, party_time: '10-1' }))).toBe(true)
  })
  it('is false when only a single start time is given', () => {
    expect(hasStudioDuration(booking({ party_tags: {}, party_time: '2:00 PM' }))).toBe(false)
  })
})

describe('hasVenueAddress', () => {
  it('detects an address in party_tags', () => {
    expect(hasVenueAddress(booking({ party_tags: { venue_address: '28 South Dr, Sag Harbor' } }))).toBe(true)
  })
  it('is false with no address tag', () => {
    expect(hasVenueAddress(booking({ party_tags: { theme: 'glam' } }))).toBe(false)
  })
})

describe('evaluateRequiredInfo', () => {
  it('studio rental with all fields present => quote path', () => {
    const r = evaluateRequiredInfo('studio_rental', booking())
    expect(r.path).toBe('quote')
    expect(r.missing).toEqual([])
  })

  it('studio rental missing duration => info_gather', () => {
    const r = evaluateRequiredInfo('studio_rental', booking({ party_tags: {}, party_time: '2:00 PM' }))
    expect(r.path).toBe('info_gather')
    expect(r.missing).toContain('rental_duration')
  })

  it('mobile party missing venue address => info_gather', () => {
    const r = evaluateRequiredInfo('mobile_party', booking({ event_type: 'mobile', party_tags: {} }))
    expect(r.path).toBe('info_gather')
    expect(r.missing).toContain('venue_address')
  })

  it('mobile party with an address => quote path', () => {
    const r = evaluateRequiredInfo(
      'mobile_party',
      booking({ event_type: 'mobile', party_tags: { venue_address: '28 South Dr' } }),
    )
    expect(r.path).toBe('quote')
  })

  it('in-studio theme does NOT require age or child name', () => {
    const r = evaluateRequiredInfo(
      'in_studio_theme',
      booking({ event_type: 'Kids Birthday Party', party_tags: {}, child_age: null, child_name: null }),
    )
    expect(r.path).toBe('quote')
    expect(r.missing).toEqual([])
  })

  it('flags each missing contact field', () => {
    const r = evaluateRequiredInfo(
      'in_studio_theme',
      booking({ event_type: 'Kids Birthday Party', party_tags: {}, contact_email: '', contact_phone: null }),
    )
    expect(r.missing).toEqual(expect.arrayContaining(['contact_email', 'contact_phone']))
    expect(r.path).toBe('info_gather')
  })

  it('treats guest_count of 0 as missing', () => {
    const r = evaluateRequiredInfo('in_studio_theme', booking({ event_type: 'Kids Birthday Party', party_tags: {}, guest_count_approx: 0 }))
    expect(r.missing).toContain('guest_count')
  })

  it('unknown type is forced to info_gather + needsHuman even when fields are complete', () => {
    const r = evaluateRequiredInfo('unknown', booking())
    expect(r.path).toBe('info_gather')
    expect(r.needsHuman).toBe(true)
  })
})

describe('evaluateInquiry', () => {
  it('happy-path studio rental => quote', () => {
    const e = evaluateInquiry(booking())
    expect(e.partyType).toBe('studio_rental')
    expect(e.path).toBe('quote')
    expect(e.needsHuman).toBe(false)
  })

  it('ambiguous booking => unknown + human review', () => {
    const e = evaluateInquiry(
      booking({ event_type: 'other', package_type: null, notes: null, party_tags: {}, child_age: null }),
    )
    expect(e.partyType).toBe('unknown')
    expect(e.needsHuman).toBe(true)
    expect(e.path).toBe('info_gather')
  })
})

describe('describeMissing', () => {
  it('maps field keys to human labels', () => {
    expect(describeMissing(['contact_phone', 'venue_address', 'rental_duration'])).toEqual([
      'contact phone',
      'venue address',
      'rental duration',
    ])
  })
})
