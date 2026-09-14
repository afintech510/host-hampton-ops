/**
 * `classifyPartyType` — the default that keeps hand-entered bookings out of
 * the Unclassified bucket.
 *
 * The bug this exists for: `/api/admin/bookings` (the booking Adam creates by
 * hand when someone books over the phone) never wrote `party_type` at all.
 * Migration 035 backfilled the rows that existed in August; every manual
 * booking since landed NULL and rendered as "Unclassified". On 2026-09-13 that
 * was two real October parties — HH-2026-7984 and HH-2026-8060.
 *
 * The strings below are the REAL `event_type` values from production, not
 * invented ones: that column holds whatever words the form or the operator
 * used, which is exactly why a classifier and not a lookup table.
 */

import { classifyPartyType, isPartyType, PARTY_TYPES } from '@/lib/pipelineStages'

describe('classifyPartyType', () => {
  it('only ever returns a value the CHECK constraint allows', () => {
    const inputs = [
      'kids-party', 'mobile party', 'room-rental', 'Other', '', null, undefined,
      'Looking to get pricing to rent the space for Christmas photoshoots for 2hrs',
    ]
    for (const i of inputs) {
      const out = classifyPartyType(i)
      expect(isPartyType(out)).toBe(true)
      expect(PARTY_TYPES).toContain(out)
    }
  })

  it('classifies the real in-studio spellings', () => {
    // Four different spellings of the same product, all live in production.
    for (const s of ['kids-party', 'kid-party', 'kids_party', 'Kids Birthday Party']) {
      expect(classifyPartyType(s)).toBe('in_studio_theme')
    }
  })

  it('classifies mobile before anything else', () => {
    expect(classifyPartyType('mobile party')).toBe('mobile_party')
    // The trap: a mobile booking's words are otherwise indistinguishable from
    // an in-studio one, so "party" must not win first.
    expect(classifyPartyType('Mobile Kids Birthday Party')).toBe('mobile_party')
    expect(classifyPartyType('at-home party')).toBe('mobile_party')
  })

  it('classifies rentals, including the ones that never say "rental"', () => {
    expect(classifyPartyType('room-rental')).toBe('studio_rental')
    expect(classifyPartyType('studio-rental')).toBe('studio_rental')
    // HH-PTY-73LGZ's actual event_type. It is a rental and says neither
    // "rental" nor "party".
    expect(
      classifyPartyType('Looking to get pricing to rent the space for Christmas photoshoots for 2hrs'),
    ).toBe('studio_rental')
  })

  it('does NOT read a bare "studio" as a rental', () => {
    // "in-studio" contains "studio". Matching on it would send every themed
    // party to the rental bucket.
    expect(classifyPartyType('in-studio theme party')).toBe('in_studio_theme')
  })

  it('says unknown rather than guessing, when there is nothing to go on', () => {
    expect(classifyPartyType('')).toBe('unknown')
    expect(classifyPartyType('   ')).toBe('unknown')
    expect(classifyPartyType(null)).toBe('unknown')
    expect(classifyPartyType(undefined)).toBe('unknown')
    // 'Other' is a real production value (HH-PTY-S4RMC). It carries no signal,
    // and a wrong bucket is worse than an honest one.
    expect(classifyPartyType('Other')).toBe('unknown')
  })
})
