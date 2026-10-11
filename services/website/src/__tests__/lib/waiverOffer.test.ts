/**
 * Should the invoice offer the room-rental waiver? (`lib/waiverOffer.ts`)
 *
 * The case that matters is a studio rental that has not signed, with SignWell
 * configured, before its date. Every other row of this file is a way the button
 * must NOT appear — a button leading to `{ unavailable: true }` is silent, and a
 * link on a cancelled or finished rental is a dead end.
 */

import { waiverOffer, waiverIsConfigured } from '@/lib/waiverOffer'

const NOW = new Date('2026-11-20T15:00:00Z')
const STUDIO = { event_type: 'studio-rental', status: 'deposit_paid', party_date: '2026-12-06', package_type: 'Studio Rental' }

describe('waiverOffer', () => {
  it('offers the button on an unsigned studio rental before its date', () => {
    expect(waiverOffer({ booking: STUDIO, signedAt: null }, true, NOW)).toEqual({ state: 'offer' })
  })

  it('says it is signed — from EITHER signature column — and stops asking', () => {
    const at = '2026-11-01T12:00:00Z'
    expect(waiverOffer({ booking: STUDIO, signedAt: at }, true, NOW)).toEqual({ state: 'signed', signedAt: at })
  })

  it('still says signed after the rental, and when SignWell is no longer configured', () => {
    const at = '2026-11-01T12:00:00Z'
    const later = new Date('2027-01-10T15:00:00Z')
    expect(waiverOffer({ booking: STUDIO, signedAt: at }, false, later).state).toBe('signed')
  })

  it('draws nothing when SignWell is not configured (the agreement route would answer unavailable)', () => {
    expect(waiverOffer({ booking: STUDIO, signedAt: null }, false, NOW)).toEqual({ state: 'none' })
  })

  it.each(['cancelled', 'lost', ' Cancelled '])('draws nothing on a %s rental', status => {
    expect(waiverOffer({ booking: { ...STUDIO, status }, signedAt: null }, true, NOW).state).toBe('none')
  })

  it('draws nothing once the rental day is over — the check-in link would already be dead', () => {
    const after = new Date('2026-12-07T05:00:00Z') // 12:00am ET on the 7th
    expect(waiverOffer({ booking: STUDIO, signedAt: null }, true, after).state).toBe('none')
    // …but the morning of the rental still gets in.
    const morningOf = new Date('2026-12-06T13:00:00Z')
    expect(waiverOffer({ booking: STUDIO, signedAt: null }, true, morningOf).state).toBe('offer')
  })

  it('an undated rental is not expired — staff sort it out', () => {
    expect(waiverOffer({ booking: { ...STUDIO, party_date: null }, signedAt: null }, true, NOW).state).toBe('offer')
  })

  it.each([
    ['a kids party', { event_type: 'kid-party', package_type: 'Glow Party' }],
    ['a mobile party', { event_type: 'mobile', package_type: 'Mobile Craft Party' }],
    ['an unclassifiable booking', { event_type: 'something-else', package_type: null }],
  ])('draws nothing for %s — the agreement is about renting the room', (_n, b) => {
    expect(waiverOffer({ booking: { status: 'deposit_paid', party_date: '2026-12-06', ...b }, signedAt: null }, true, NOW).state).toBe('none')
  })
})

describe('waiverIsConfigured', () => {
  const original = process.env
  afterEach(() => { process.env = original })

  it('needs BOTH the API key and the check-in template — the same two vars the agreement route reads', () => {
    process.env = { ...original, SIGNWELL_API_KEY: 'k', SIGNWELL_CHECKIN_TEMPLATE_ID: 't' }
    expect(waiverIsConfigured()).toBe(true)
    process.env = { ...original, SIGNWELL_API_KEY: 'k', SIGNWELL_CHECKIN_TEMPLATE_ID: '' }
    expect(waiverIsConfigured()).toBe(false)
    process.env = { ...original, SIGNWELL_API_KEY: '', SIGNWELL_CHECKIN_TEMPLATE_ID: 't' }
    expect(waiverIsConfigured()).toBe(false)
  })
})
