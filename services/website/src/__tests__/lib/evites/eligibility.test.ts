import { isEviteEligible } from '@/lib/evites/eligibility'

describe('evites/eligibility', () => {
  it.each([
    ['in_studio_theme', true],
    ['mobile_party', true],
    ['studio_rental', false],
  ])('party_type %s -> %s', (party_type, expected) => {
    expect(isEviteEligible({ status: 'awaiting_deposit', party_type })).toBe(expected)
  })

  it('an unrecognised party_type is not eligible, and the location fallback does NOT rescue it', () => {
    expect(isEviteEligible({ party_type: 'something_new', party_tags: { location_type: 'mobile' } })).toBe(false)
  })

  it('studio_rental is never eligible even with a mobile/host_hampton location tag', () => {
    expect(isEviteEligible({ party_type: 'studio_rental', party_tags: { location_type: 'host_hampton' } })).toBe(false)
    expect(isEviteEligible({ party_type: 'studio_rental', party_tags: { location_type: 'mobile' } })).toBe(false)
  })

  describe('location_type fallback (party_type NULL / unknown)', () => {
    it.each([null, undefined, 'unknown'])('party_type %s with host_hampton -> eligible', (pt) => {
      expect(isEviteEligible({ party_type: pt, party_tags: { location_type: 'host_hampton' } })).toBe(true)
    })
    it.each([null, undefined, 'unknown'])('party_type %s with mobile -> eligible', (pt) => {
      expect(isEviteEligible({ party_type: pt, party_tags: { location_type: 'mobile' } })).toBe(true)
    })
    it('an unrecognised location_type is not eligible', () => {
      expect(isEviteEligible({ party_type: null, party_tags: { location_type: 'backyard' } })).toBe(false)
    })
    it('no location_type is not eligible', () => {
      expect(isEviteEligible({ party_type: null, party_tags: {} })).toBe(false)
      expect(isEviteEligible({ party_type: 'unknown', party_tags: null })).toBe(false)
      expect(isEviteEligible({ party_type: null })).toBe(false)
    })
    it('malformed party_tags never throws and is not eligible', () => {
      for (const tags of ['mobile', 5, [], [{ location_type: 'mobile' }], true]) {
        expect(isEviteEligible({ party_type: null, party_tags: tags })).toBe(false)
      }
    })
    it('a non-string location_type is not eligible', () => {
      expect(isEviteEligible({ party_type: null, party_tags: { location_type: 7 } })).toBe(false)
    })
  })

  describe('exit statuses', () => {
    it.each(['cancelled', 'lost'])('%s is never eligible, whatever the type', (status) => {
      expect(isEviteEligible({ status, party_type: 'in_studio_theme' })).toBe(false)
      expect(isEviteEligible({ status, party_type: 'mobile_party' })).toBe(false)
      expect(isEviteEligible({ status, party_type: null, party_tags: { location_type: 'mobile' } })).toBe(false)
    })
    it.each(['lead', 'quoted', 'pending_review', 'awaiting_deposit', 'deposit_paid', 'confirmed', 'approved', 'paid_in_full', 'completed'])(
      'status %s does not exclude',
      (status) => {
        expect(isEviteEligible({ status, party_type: 'in_studio_theme' })).toBe(true)
      },
    )
    it('a missing status does not exclude', () => {
      expect(isEviteEligible({ party_type: 'mobile_party' })).toBe(true)
    })
  })

  it('null / undefined booking is not eligible', () => {
    expect(isEviteEligible(null)).toBe(false)
    expect(isEviteEligible(undefined)).toBe(false)
  })
})
