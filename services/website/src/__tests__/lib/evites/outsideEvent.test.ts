import { inviteFacts, type InviteFactsBooking, type InviteFactsEvite } from '@/lib/evites/facts'
import { isEviteEligible } from '@/lib/evites/eligibility'
import { eviteLocationType } from '@/lib/evites/location'
import { calTitleOf, calInputsHash } from '@/lib/evites/hash'
import { partyWindow } from '@/lib/evites/partyWindow'
import { resolveTheme } from '@/lib/evites/themes'
import { audienceOf, eventEndOf, isOutsideEvent, occasionOf, occasionWords, venueNameOf } from '@/lib/evites/outsideEvent'
import { makeSlug } from '@/lib/evites/slug'
import type { PartyThemeRow } from '@/lib/evites/types'

const DOT = String.fromCharCode(0xb7)
const DASH = String.fromCharCode(0x2013)

const THEMES: PartyThemeRow[] = [{ id: 't1', name: 'Glow Party', slug: 'glow-party', pricing_item_id: 'pi-glow' }]

const TAGS = {
  location_type: 'mobile',
  venue_name: 'James Joyce',
  location_address: '49 S Ocean Ave, Patchogue, NY 11772',
  occasion: 'Baby Shower',
  audience: 'guests',
  event_end_time: '15:00',
}

/** The first real one: Maeghan Murphy's baby shower at James Joyce, Patchogue, Jan 30 2027, 12-3pm. */
const shower = (over: Record<string, unknown> = {}): InviteFactsBooking => ({
  party_type: 'outside_event',
  party_date: '2027-01-30',
  party_time: '12:00',
  package_type: null,
  guest_count_approx: null,
  child_name: 'Maeghan Murphy',
  child_age: null,
  party_tags: TAGS,
  quote_snapshot: { outsideEvent: true },
  ...over,
})

const evite = (over: Partial<InviteFactsEvite> = {}): InviteFactsEvite => ({
  template_slug: 'glow',
  theme_word: null,
  theme_sub: null,
  host_contact_name: null,
  host_contact_phone: null,
  show_host_contact: true,
  host_note: null,
  gift_note: null,
  rsvp_deadline: null,
  ...over,
})

const facts = (b = shower(), e = evite(), state: Parameters<typeof inviteFacts>[4] = 'live') => inviteFacts(b, e, [], THEMES, state)

describe('outside event helpers', () => {
  it('only the outside_event party type is one', () => {
    expect(isOutsideEvent({ party_type: 'outside_event' })).toBe(true)
    for (const t of ['in_studio_theme', 'mobile_party', 'studio_rental', 'hat_bar', 'unknown', null, undefined]) {
      expect(isOutsideEvent({ party_type: t })).toBe(false)
    }
    expect(isOutsideEvent(null)).toBe(false)
  })

  it('a tag on any OTHER party type is ignored: the type decides', () => {
    const tags = { occasion: 'Baby Shower', venue_name: 'James Joyce', audience: 'guests', event_end_time: '15:00' }
    const b = { party_type: 'in_studio_theme', party_tags: tags }
    expect(occasionOf(b)).toBeNull()
    expect(venueNameOf(b)).toBeNull()
    expect(audienceOf(b)).toBe('kids')
    expect(eventEndOf(b)).toBeNull()
  })

  it('occasion: cleaned, capped at 40, a shouty one title-cased, one with its own capitals left alone', () => {
    const occ = (occasion: unknown) => occasionOf({ party_type: 'outside_event', party_tags: { occasion } })
    expect(occ('baby shower')).toBe('Baby Shower')
    expect(occ('BABY SHOWER')).toBe('Baby Shower')
    expect(occ('  Bridal   Shower\nBrunch ')).toBe('Bridal Shower Brunch')
    expect(occ("Mia's Sweet 16")).toBe("Mia's Sweet 16")
    expect(Array.from(occ('x'.repeat(80)) ?? '').length).toBe(40)
    for (const bad of ['', '   ', null, 5, {}, undefined]) expect(occ(bad)).toBeNull()
  })

  it('audience: adults unless the tag says kids', () => {
    const aud = (audience: unknown) => audienceOf({ party_type: 'outside_event', party_tags: { audience } })
    expect(aud('guests')).toBe('guests')
    expect(aud(undefined)).toBe('guests')
    expect(aud('nonsense')).toBe('guests')
    expect(aud('kids')).toBe('kids')
  })

  it('end time: HH:MM only, padded; anything else is none', () => {
    const end = (v: unknown) => eventEndOf({ party_type: 'outside_event', party_tags: { event_end_time: v } })
    expect(end('15:00')).toBe('15:00')
    expect(end('9:30')).toBe('09:30')
    for (const bad of ['3pm', '25:00', '15:60', '', null, 15]) expect(end(bad)).toBeNull()
  })

  it('occasionWords: the last word is the sub line; one word gets PARTY; too long gives up', () => {
    expect(occasionWords('Baby Shower')).toEqual({ word: 'BABY', sub: 'SHOWER' })
    expect(occasionWords('Retirement')).toEqual({ word: 'RETIREMENT', sub: 'PARTY' })
    expect(occasionWords('Bridal Shower Brunch')).toEqual({ word: 'BRIDAL', sub: 'BRUNCH' })
    expect(occasionWords('Baby Shower Brunch Bash')).toEqual({ word: 'BABY', sub: 'BASH' })
    expect(occasionWords('Congratulations')).toBeNull() // 15 characters: does not fit a theme word
    expect(occasionWords(null)).toBeNull()
  })
})

describe('outside event: where the party type sends the invitation code', () => {
  it('is eligible for an invitation, unless cancelled or lost', () => {
    expect(isEviteEligible({ party_type: 'outside_event', status: 'confirmed' })).toBe(true)
    expect(isEviteEligible({ party_type: 'outside_event', status: 'cancelled' })).toBe(false)
    expect(isEviteEligible({ party_type: 'outside_event', status: 'lost' })).toBe(false)
  })

  it('is never at the studio, whatever a stray location tag says', () => {
    expect(eviteLocationType({ party_type: 'outside_event', party_tags: {} })).toBe('mobile')
    expect(eviteLocationType({ party_type: 'outside_event', party_tags: { location_type: 'host_hampton' } })).toBe('mobile')
  })

  it('its theme is named by the occasion, so its slug is too', () => {
    const t = resolveTheme(shower(), [], THEMES)
    expect(t.short).toBe('babyshower')
    expect(t.templateSlug).toBe('plain')
    expect(makeSlug('Maeghan', t.short)).toMatch(/^maeghan-babyshower-[0-9a-hjkmnp-tv-z]{4}$/)
  })

  it('a normal party still gets its theme word in the slug', () => {
    const t = resolveTheme({ party_type: 'in_studio_theme', package_type: 'Glow Party', quote_snapshot: null, party_tags: {} }, [], THEMES)
    expect(t.short).toBe('glow')
  })
})

describe('outside event: the window', () => {
  const win = (over: Record<string, unknown> = {}) => partyWindow(shower(over))

  it('uses the stated end: 12-3pm Eastern in January is 17:00-20:00 UTC', () => {
    expect(win()?.startUtc.toISOString()).toBe('2027-01-30T17:00:00.000Z')
    expect(win()?.endUtc.toISOString()).toBe('2027-01-30T20:00:00.000Z')
  })

  it('without a usable end it is a theme party two hours', () => {
    for (const end of [undefined, 'soon', '11:00', '12:00']) {
      const w = win({ party_tags: { ...TAGS, event_end_time: end } })
      expect((w!.endUtc.getTime() - w!.startUtc.getTime()) / 60000).toBe(120)
    }
  })

  it('an end more than 12 hours after the start is a typo, not a window', () => {
    const w = win({ party_time: '08:00', party_tags: { ...TAGS, event_end_time: '21:00' } })
    expect((w!.endUtc.getTime() - w!.startUtc.getTime()) / 60000).toBe(120)
    const ok = win({ party_time: '08:00', party_tags: { ...TAGS, event_end_time: '20:00' } })
    expect((ok!.endUtc.getTime() - ok!.startUtc.getTime()) / 60000).toBe(720)
  })

  it('a start the invitation cannot place is still no window', () => {
    expect(win({ party_time: '23:00' })).toBeNull()
    expect(win({ party_time: null })).toBeNull()
  })
})

describe('outside event: what the invitation says (Maeghan Murphy, James Joyce)', () => {
  it('names the occasion, not a birthday', () => {
    const f = facts()
    expect(f.partyNoun).toBe('Baby Shower')
    expect(f.occasion).toBe('Baby Shower')
    expect(f.title).toBe("Maeghan's Baby Shower")
    expect(f.shareText).toBe("You're invited to Maeghan's Baby Shower on Sat, Jan 30! RSVP here:")
    expect(f.reshareText).toBe("Still hoping you can make Maeghan's event on Sat, Jan 30! RSVP here:")
    expect(f.honoreeDisplay).toBe('MAEGHAN')
    expect(f.ageOrdinal).toBeNull()
    expect(f.themeWord).toBe('BABY')
    expect(f.themeSub).toBe('SHOWER')
    expect(f.audience).toBe('guests')
  })

  it('says when, to the minute of the window', () => {
    const f = facts()
    expect(f.dateLine).toBe(`Saturday, January 30 ${DOT} 12${DASH}3 PM`)
    expect(f.timeText).toBe(`12${DASH}3 PM`)
  })

  it('says where: the venue by name, then its street; the card says the venue and its town only', () => {
    const f = facts()
    expect(f.locationType).toBe('mobile')
    expect(f.venueName).toBe('James Joyce')
    expect(f.placeLine).toBe(`James Joyce ${DOT} 49 S Ocean Ave, Patchogue, NY 11772`)
    expect(f.cardPlaceLine).toBe('James Joyce, Patchogue')
    expect(f.calendarLocation).toBe('James Joyce, 49 S Ocean Ave, Patchogue, NY 11772')
    // The public description never carries the street, only the venue and its town.
    expect(f.description).toContain('James Joyce, Patchogue')
    expect(f.description).not.toContain('49 S Ocean')
  })

  it('never says studio, birthday or Host Hampton as the place', () => {
    const f = facts()
    for (const s of [f.title, f.shareText, f.description, f.placeLine, f.cardPlaceLine, f.calendarLocation ?? '']) {
      expect(s).not.toMatch(/birthday|speonk|montauk/i)
    }
    expect(f.placeLine).not.toMatch(/^Host Hampton/)
  })

  it('a street address and no venue name: the address is the place, the town the card', () => {
    const f = facts(shower({ party_tags: { ...TAGS, venue_name: undefined } }))
    expect(f.venueName).toBeNull()
    expect(f.placeLine).toBe('49 S Ocean Ave, Patchogue, NY 11772')
    expect(f.cardPlaceLine).toBe('Patchogue')
    expect(f.calendarLocation).toBe('49 S Ocean Ave, Patchogue, NY 11772')
  })

  it('a venue name and no address: the venue alone, and never a made-up town', () => {
    const f = facts(shower({ party_tags: { ...TAGS, location_address: undefined } }))
    expect(f.placeLine).toBe('James Joyce')
    expect(f.cardPlaceLine).toBe('James Joyce')
    expect(f.calendarLocation).toBe('James Joyce')
  })

  it('an address whose town cannot be read: the card says the venue and no town', () => {
    const f = facts(shower({ party_tags: { ...TAGS, location_address: '49 S Ocean Ave' } }))
    expect(f.cardPlaceLine).toBe('James Joyce')
  })

  it('neither a venue nor an address: location to be confirmed, never the studio', () => {
    const f = facts(shower({ party_tags: { ...TAGS, venue_name: undefined, location_address: undefined } }))
    expect(f.placeLine).toBe('Location to be confirmed')
    expect(f.calendarLocation).toBeNull()
  })

  it('no honoree name: the title is the occasion alone', () => {
    const f = facts(shower({ child_name: null }))
    expect(f.hasName).toBe(false)
    expect(f.title).toBe('Baby Shower')
    expect(f.shareText).toBe("You're invited to a Baby Shower on Sat, Jan 30! RSVP here:")
  })

  it('no occasion: it is an Event, never a birthday party', () => {
    const f = facts(shower({ party_tags: { ...TAGS, occasion: undefined } }))
    expect(f.partyNoun).toBe('Event')
    expect(f.title).toBe("Maeghan's Event")
  })

  it('a kids audience is carried through', () => {
    expect(facts(shower({ party_tags: { ...TAGS, audience: 'kids' } })).audience).toBe('kids')
  })

  it('an admin theme override still wins over the occasion words', () => {
    const f = facts(shower(), evite({ theme_word: 'brunch', theme_sub: 'bash' }))
    expect(f.themeWord).toBe('BRUNCH')
    expect(f.themeSub).toBe('BASH')
  })

  it('a preview says the event, not the party, is booked', () => {
    expect(facts(shower(), evite(), 'preview').description).toBe("Maeghan's Baby Shower. RSVPs open once the event is booked.")
  })

  it('a kids party is exactly what it was: no occasion, no venue, kids', () => {
    const f = inviteFacts(
      { party_type: 'in_studio_theme', party_date: '2026-11-14', party_time: '14:00', package_type: 'Glow Party', guest_count_approx: 10, child_name: 'Mia', child_age: 7, party_tags: { location_type: 'host_hampton' }, quote_snapshot: null },
      evite(), [], THEMES, 'live',
    )
    expect(f.occasion).toBeNull()
    expect(f.venueName).toBeNull()
    expect(f.audience).toBe('kids')
    expect(f.partyNoun).toBe('Glow Party')
    expect(f.title).toBe("Mia's Glow Party")
    expect(f.reshareText).toContain("Mia's party")
  })
})

describe('outside event: the calendar hash follows the occasion', () => {
  it('the title is the honoree and the occasion', () => {
    expect(calTitleOf({ hasName: true, honoreeDisplay: 'MAEGHAN', occasion: 'Baby Shower' })).toBe("MAEGHAN's Baby Shower")
    expect(calTitleOf({ hasName: false, honoreeDisplay: 'BIRTHDAY STAR', occasion: 'Baby Shower' })).toBe('Baby Shower')
  })

  it('without an occasion it is the title it always was, so no stored hash moves', () => {
    expect(calTitleOf({ hasName: true, honoreeDisplay: 'MIA' })).toBe("MIA's Birthday Party")
    expect(calTitleOf({ hasName: true, honoreeDisplay: 'MIA', occasion: null })).toBe("MIA's Birthday Party")
    expect(calTitleOf({ hasName: false, honoreeDisplay: 'BIRTHDAY STAR' })).toBe('Birthday Party')
  })

  it('changing the occasion changes the calendar hash; changing nothing does not', () => {
    const base = calInputsHash(facts())
    expect(calInputsHash(facts())).toBe(base)
    expect(calInputsHash(facts(shower({ party_tags: { ...TAGS, occasion: 'Bridal Shower' } })))).not.toBe(base)
  })
})
