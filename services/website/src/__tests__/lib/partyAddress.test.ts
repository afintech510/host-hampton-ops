import {
  acceptsPartyAddress,
  isProvisionalAddress,
  screenPartyAddress,
  shouldAskForPartyAddress,
} from '@/lib/partyAddress'

jest.mock('@/lib/supabase', () => ({ getSupabase: jest.fn() }))

describe('isProvisionalAddress', () => {
  it.each([
    [null, true],
    ['', true],
    ['Westhampton, NY (address TBC)', true],
    ['Westhampton, NY', true],
    ['Address TBD', true],
    ['12 Dune Rd, Westhampton Beach, NY 11978', false],
  ])('%p → %p', (input, expected) => {
    expect(isProvisionalAddress(input)).toBe(expected)
  })
})

describe('acceptsPartyAddress', () => {
  const today = '2026-10-01'
  it('takes a mobile party on or before its date', () => {
    expect(acceptsPartyAddress({ partyType: 'mobile_party', status: 'deposit_paid', partyDate: '2026-10-03', today })).toBe(true)
    expect(acceptsPartyAddress({ partyType: 'mobile_party', status: 'deposit_paid', partyDate: today, today })).toBe(true)
    expect(acceptsPartyAddress({ partyType: 'mobile_party', status: 'lead', partyDate: null, today })).toBe(true)
  })
  it('refuses the studio, a cancelled plan, and a party that has happened', () => {
    expect(acceptsPartyAddress({ partyType: 'studio_rental', status: 'deposit_paid', partyDate: '2026-10-03', today })).toBe(false)
    expect(acceptsPartyAddress({ partyType: 'in_studio_theme', status: 'deposit_paid', partyDate: '2026-10-03', today })).toBe(false)
    expect(acceptsPartyAddress({ partyType: 'mobile_party', status: 'cancelled', partyDate: '2026-10-03', today })).toBe(false)
    expect(acceptsPartyAddress({ partyType: 'mobile_party', status: 'deposit_paid', partyDate: '2026-09-30', today })).toBe(false)
  })
})

describe('shouldAskForPartyAddress', () => {
  const base = { partyType: 'mobile_party', status: 'deposit_paid', partyDate: '2026-10-03', today: '2026-10-01' }
  it('asks while the address is a placeholder', () => {
    expect(shouldAskForPartyAddress({ ...base, partyTags: { location_address: 'Westhampton, NY (address TBC)' } })).toBe(true)
    expect(shouldAskForPartyAddress({ ...base, partyTags: null })).toBe(true)
  })
  it('stops asking once a street address is on file', () => {
    expect(shouldAskForPartyAddress({ ...base, partyTags: { location_address: '12 Dune Rd, Westhampton Beach, NY 11978' } })).toBe(false)
  })
})

describe('screenPartyAddress', () => {
  it('flattens a pasted multi-line address to one line', () => {
    expect(screenPartyAddress('  12 Dune Rd\r\nWesthampton Beach,   NY 11978 ')).toEqual({
      ok: true,
      address: '12 Dune Rd Westhampton Beach, NY 11978',
    })
  })
  it('refuses a non-string, a too-short and a too-long value', () => {
    expect(screenPartyAddress(42).ok).toBe(false)
    expect(screenPartyAddress('12 Rd').ok).toBe(false)
    expect(screenPartyAddress('x'.repeat(201)).ok).toBe(false)
  })
})
