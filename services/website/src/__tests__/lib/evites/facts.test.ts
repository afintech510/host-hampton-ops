import { inviteFacts, timeRangeText, normalizeHostPhone, childNameOf, type InviteFactsBooking, type InviteFactsEvite } from '@/lib/evites/facts'
import { partyWindow } from '@/lib/evites/partyWindow'
import { mobileTown, mobileAddressOf, eviteLocationType } from '@/lib/evites/location'
import { screenForImage, fitsFont } from '@/lib/evites/glyphs'
import { STUDIO_ADDRESS_LINE, STUDIO_PHONE_DISPLAY } from '@/lib/studioLocation'
import type { PartyThemeRow } from '@/lib/evites/types'

const DOT = String.fromCharCode(0xb7)
const DASH = String.fromCharCode(0x2013)

const THEMES: PartyThemeRow[] = [
  { id: 't1', name: 'Glow Party', slug: 'glow-party', pricing_item_id: 'pi-glow' },
  { id: 't2', name: 'Swiftie Party', slug: 'swiftie-party', pricing_item_id: 'pi-swift' },
  { id: 't3', name: 'K-Pop Party', slug: 'kpop-party', pricing_item_id: 'pi-kpop' },
  { id: 't4', name: 'Sleep Under Party', slug: 'sleep-under-party', pricing_item_id: 'pi-sleep' },
]

const booking = (over: Record<string, unknown> = {}): InviteFactsBooking => ({
  party_type: 'in_studio_theme',
  party_date: '2026-11-14', // Saturday
  party_time: '14:00',
  package_type: 'Glow Party',
  guest_count_approx: 10,
  child_name: 'Mia',
  child_age: 7,
  party_tags: { location_type: 'host_hampton' },
  quote_snapshot: null,
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

const facts = (b = booking(), e = evite(), state: Parameters<typeof inviteFacts>[4] = 'live') => inviteFacts(b, e, [], THEMES, state)

describe('evites/facts - the honoree', () => {
  it('a name: first token, upper-cased for the image, title-cased in sentences', () => {
    const f = facts(booking({ child_name: 'mia rose' }))
    expect(f.hasName).toBe(true)
    expect(f.honoreeDisplay).toBe('MIA')
    expect(f.title).toBe("Mia's Glow Party")
    expect(f.shareText).toBe("You're invited to Mia's Glow Party on Sat, Nov 14! RSVP here:")
  })

  it('a name typed with its own capitals is left alone in sentences', () => {
    expect(facts(booking({ child_name: 'DeShawn' })).title).toBe("DeShawn's Glow Party")
    expect(facts(booking({ child_name: 'DeShawn' })).honoreeDisplay).toBe('DESHAWN')
  })

  it('NO name: BIRTHDAY STAR, hasName=false, no emoji in the string (the star is an image slot)', () => {
    const f = facts(booking({ child_name: null }))
    expect(f.hasName).toBe(false)
    expect(f.honoreeDisplay).toBe('BIRTHDAY STAR')
    expect(f.honoreeDisplay).not.toMatch(/[^\x20-\x7e]/)
    expect(f.title).toBe('Glow Birthday Party')
    expect(f.title.toUpperCase()).toBe('GLOW BIRTHDAY PARTY') // the OG card title, spec v1.1 B1
  })

  it.each([[''], ['   '], [null]])('child_name %j is no name', (n) => {
    expect(facts(booking({ child_name: n })).hasName).toBe(false)
  })

  it('falls back to quote_snapshot.childName, and child_name wins when both are there', () => {
    expect(facts(booking({ child_name: null, quote_snapshot: { childName: 'Ava Lee' } })).honoreeDisplay).toBe('AVA')
    expect(facts(booking({ child_name: 'Zoe', quote_snapshot: { childName: 'Ava Lee' } })).honoreeDisplay).toBe('ZOE')
    expect(childNameOf({ child_name: ' ', quote_snapshot: { childName: 'Ava' } })).toBe('Ava')
    expect(childNameOf({ child_name: null, quote_snapshot: 'junk' })).toBeNull()
  })

  it('caps the name at 20 characters', () => {
    const f = facts(booking({ child_name: 'Wolfeschlegelsteinhausenbergerdorff' }))
    expect(Array.from(f.honoreeDisplay).length).toBeLessThanOrEqual(20)
  })

  it('an emoji in a name is dropped; a name that is only an emoji is no name', () => {
    expect(facts(booking({ child_name: 'Mia' + String.fromCodePoint(0x1f389) })).honoreeDisplay).toBe('MIA')
    expect(facts(booking({ child_name: String.fromCodePoint(0x1f389) })).hasName).toBe(false)
  })

  it('a letter the fonts lack is folded: L-stroke becomes L', () => {
    const f = facts(booking({ child_name: String.fromCharCode(0x141) + 'ucja' }))
    expect(f.honoreeDisplay).toBe('LUCJA')
    expect(f.title).toBe("Lucja's Glow Party")
  })

  it('every image-bound string fits the font of its slot', () => {
    const f = facts(booking({ child_name: String.fromCharCode(0x141) + 'ucja' + String.fromCodePoint(0x1f389) }))
    expect(fitsFont(f.honoreeDisplay, 'bungee')).toBe(true)
    expect(fitsFont(f.title, 'bungee')).toBe(true)
    expect(fitsFont(f.themeWord, 'monoton')).toBe(true)
    expect(fitsFont(f.themeSub, 'bungee')).toBe(true)
    expect(fitsFont(f.dateLine, 'poppins600')).toBe(true)
    expect(fitsFont(f.placeLine, 'poppins400')).toBe(true)
    expect(fitsFont(f.cardPlaceLine, 'poppins400')).toBe(true)
    expect(fitsFont(f.hostContactLine as string, 'poppins400')).toBe(true)
  })

  it('ageOrdinal', () => {
    const o = (age: unknown) => facts(booking({ child_age: age })).ageOrdinal
    expect([1, 2, 3, 4, 7, 10, 11, 12, 13, 21, 22, 23, 101].map(o)).toEqual(['1st', '2nd', '3rd', '4th', '7th', '10th', '11th', '12th', '13th', '21st', '22nd', '23rd', null])
    expect([null, 0, -3, 7.5, 150, '7'].map(o)).toEqual([null, null, null, null, null, null])
  })

  it('guestCap is guest_count_approx when it is a positive whole number', () => {
    expect(facts(booking({ guest_count_approx: 12 })).guestCap).toBe(12)
    expect([null, 0, -1, 2.5].map((g) => facts(booking({ guest_count_approx: g })).guestCap)).toEqual([null, null, null, null])
  })
})

describe('evites/facts - when', () => {
  it('live: "Saturday, November 14 · 2–4 PM" with a middle dot and an en dash', () => {
    const f = facts()
    expect(f.dateLine).toBe(`Saturday, November 14 ${DOT} 2${DASH}4 PM`)
    expect(f.shortDateLine).toBe(`Sat, Nov 14 ${DOT} 2${DASH}4 PM`)
    expect(f.window).not.toBeNull()
    expect(f.window?.startUtc.toISOString()).toBe('2026-11-14T19:00:00.000Z')
  })

  it('preview: "Pick your date", whatever the booking has', () => {
    const f = facts(booking(), evite(), 'preview')
    expect(f.dateLine).toBe('Pick your date')
    expect(f.shortDateLine).toBe('Pick your date')
    expect(facts(booking({ party_date: null, party_time: null }), evite(), 'preview').dateLine).toBe('Pick your date')
  })

  it('needs_time: the date alone', () => {
    const f = facts(booking({ party_time: 'Evening' }), evite(), 'needs_time')
    expect(f.dateLine).toBe('Saturday, November 14')
    expect(f.shortDateLine).toBe('Sat, Nov 14')
    expect(f.window).toBeNull()
  })

  it('a live party with a missing or impossible date still says "Pick your date", never "Invalid Date"', () => {
    for (const d of [null, '2026', '2026-02-31']) expect(facts(booking({ party_date: d })).dateLine).toBe('Pick your date')
  })

  it('the window is returned even in preview (the calendar hash reads it)', () => {
    expect(facts(booking(), evite(), 'preview').window).not.toBeNull()
  })

  it('formats the time range: minutes only when non-zero, the period once when shared', () => {
    const range = (time: string, over: Record<string, unknown> = {}) => timeRangeText(partyWindow(booking({ party_time: time, ...over })) as never)
    expect(range('14:00')).toBe(`2${DASH}4 PM`)
    expect(range('2:30 PM')).toBe(`2:30${DASH}4:30 PM`)
    expect(range('11:00 AM')).toBe(`11 AM${DASH}1 PM`)
    expect(range('11:30 AM')).toBe(`11:30 AM${DASH}1:30 PM`)
    expect(range('10:00 AM')).toBe(`10 AM${DASH}12 PM`)
    expect(range('12:00 PM')).toBe(`12${DASH}2 PM`)
    expect(range('9:00 AM', { quote_snapshot: { isMiniParty: true } })).toBe(`9${DASH}10:30 AM`)
    expect(range('2:00 PM', { party_type: 'mobile_party', party_tags: { location_type: 'mobile' }, package_type: 'Entry' })).toBe(`2${DASH}3 PM`)
  })

  it('reads the Eastern calendar day on a DST-boundary Saturday, not the UTC one', () => {
    // 2026-10-31 20:00 EDT is 2026-11-01 00:00Z - the UTC date is the NEXT day.
    const f = facts(booking({ party_date: '2026-10-31', party_time: '8:00 PM' }))
    expect(f.dateLine).toBe(`Saturday, October 31 ${DOT} 8${DASH}10 PM`)
    expect(facts(booking({ party_date: '2026-03-07', party_time: '9:00 PM' })).dateLine).toBe(`Saturday, March 7 ${DOT} 9${DASH}11 PM`)
  })
})

describe('evites/facts - where', () => {
  it('studio: lines come from the studioLocation constants', () => {
    const f = facts()
    expect(f.locationType).toBe('studio')
    expect(f.placeLine).toBe(`Host Hampton ${DOT} 295 Montauk Hwy, Speonk`)
    expect(f.cardPlaceLine).toBe('Host Hampton, Speonk')
    expect(f.calendarLocation).toBe(`Host Hampton, ${STUDIO_ADDRESS_LINE}`)
    expect(f.calendarLocation).toBe('Host Hampton, 295 Montauk Hwy, Speonk, NY 11972')
    expect(f.placeLine + f.calendarLocation).not.toMatch(/suite|ste\.? ?7|bldg/i)
  })

  describe('mobile: the OG card carries the town, the page the address', () => {
    const mobile = (address: unknown) =>
      facts(booking({ party_type: 'mobile_party', party_tags: { location_type: 'mobile', location_address: address } }))

    it.each([
      ['12 Main St, Westhampton Beach, NY 11978', 'Westhampton Beach'],
      ['45 Dune Rd, Quogue NY 11959', 'Quogue'],
      ['8 Bay Ave, Eastport', 'Eastport'],
      ['8 Bay Ave, Eastport, NY', 'Eastport'],
      ['12 MAIN ST, WESTHAMPTON BEACH, NY 11978', 'Westhampton Beach'],
    ])('%s -> town %s', (address, town) => {
      const f = mobile(address)
      expect(f.locationType).toBe('mobile')
      expect(f.placeLine).toBe(address)
      expect(f.cardPlaceLine).toBe(town)
      expect(f.calendarLocation).toBe(address)
    })

    it.each([['1 Ocean Blvd'], ['12 Main St Westhampton Beach NY 11978'], ['12 Main St, Apt 4'], ['12 Main St, Suite 200, NY 11978']])(
      'an address whose town cannot be told (%s) says "Long Island" on the card',
      (address) => {
        const f = mobile(address)
        expect(f.cardPlaceLine).toBe('Long Island')
        expect(f.placeLine).toBe(address)
      },
    )

    it.each([[null], [undefined], [''], ['TBC'], ['Westhampton, NY'], ['address to be confirmed'], [42]])(
      'a missing or provisional address (%j) is "Location to be confirmed" everywhere, with no calendar location',
      (address) => {
        const f = mobile(address)
        expect(f.placeLine).toBe('Location to be confirmed')
        expect(f.cardPlaceLine).toBe('Location to be confirmed')
        expect(f.calendarLocation).toBeNull()
      },
    )

    it('a multi-line pasted address is flattened to one line', () => {
      expect(mobile('12 Main St\n  Quogue,\tNY 11959').placeLine).toBe('12 Main St Quogue, NY 11959')
    })

    it('mobileTown / mobileAddressOf / eviteLocationType directly', () => {
      expect(mobileTown('12 Main St, Quogue, NY 11959')).toBe('Quogue')
      expect(mobileTown(null)).toBe('Long Island')
      expect(mobileTown('Quogue')).toBe('Quogue')
      expect(mobileTown('')).toBe('Long Island')
      expect(mobileAddressOf({ party_tags: { location_address: 'Quogue, NY' } })).toBeNull()
      expect(eviteLocationType({ party_type: 'in_studio_theme', party_tags: { location_type: 'mobile' } })).toBe('mobile')
      expect(eviteLocationType({ party_type: 'mobile_party', party_tags: {} })).toBe('mobile')
      expect(eviteLocationType({ party_type: null, party_tags: null })).toBe('studio')
    })
  })
})

describe('evites/facts - the host contact', () => {
  it('defaults to Allie and the PUBLIC studio line, as 631-998-9325', () => {
    const f = facts()
    expect(f.hostContactLine).toBe(`Any questions? Ask Allie ${DOT} 631-998-9325`)
    expect(normalizeHostPhone(STUDIO_PHONE_DISPLAY)).toBe('631-998-9325')
  })

  it('is never the Venmo/Zelle payments number', () => {
    const f = facts()
    expect(f.hostContactLine).not.toContain('599-2469')
    expect(JSON.stringify(f)).not.toMatch(/599.?2469|6315992469/)
  })

  it('an evite override replaces the name and the number', () => {
    const f = facts(booking(), evite({ host_contact_name: 'Dana', host_contact_phone: '516-555-0123' }))
    expect(f.hostContactLine).toBe(`Any questions? Ask Dana ${DOT} 516-555-0123`)
  })

  it('one override alone leaves the other at the default', () => {
    expect(facts(booking(), evite({ host_contact_name: 'Dana' })).hostContactLine).toBe(`Any questions? Ask Dana ${DOT} 631-998-9325`)
    expect(facts(booking(), evite({ host_contact_phone: '516-555-0123' })).hostContactLine).toBe(`Any questions? Ask Allie ${DOT} 516-555-0123`)
  })

  it('a malformed stored phone falls back to the studio line rather than printing junk', () => {
    expect(facts(booking(), evite({ host_contact_phone: 'call me' })).hostContactLine).toContain('631-998-9325')
    expect(facts(booking(), evite({ host_contact_phone: '123-456-7890' })).hostContactLine).toContain('631-998-9325')
  })

  it('show_host_contact=false is no line at all', () => {
    expect(facts(booking(), evite({ show_host_contact: false })).hostContactLine).toBeNull()
  })

  it('a host name that is only an emoji falls back to Allie', () => {
    expect(facts(booking(), evite({ host_contact_name: String.fromCodePoint(0x1f389) })).hostContactLine).toContain('Ask Allie')
  })

  it('normalizeHostPhone', () => {
    expect(['(631) 998-9325', '+1 631 998 9325', '6319989325', '1-631-998-9325'].map(normalizeHostPhone)).toEqual(Array(4).fill('631-998-9325'))
    expect([null, '', '123', '063-123-4567', '631-998-932'].map((p) => normalizeHostPhone(p))).toEqual(Array(5).fill(null))
  })
})

describe('evites/facts - theme', () => {
  it('Glow: GLOW / PARTY on the glow template', () => {
    const f = facts()
    expect([f.themeWord, f.themeSub, f.templateSlug]).toEqual(['GLOW', 'PARTY', 'glow'])
  })

  it('another catalogue theme is the plain template with its own word', () => {
    const f = facts(booking({ package_type: 'Swiftie Party' }))
    expect([f.themeWord, f.templateSlug, f.title]).toEqual(['SWIFTIE', 'plain', "Mia's Swiftie Party"])
  })

  it('no theme evidence: BIRTHDAY, and the titles do not say "Birthday Birthday"', () => {
    const named = facts(booking({ package_type: 'Custom Party Theme' }))
    expect([named.themeWord, named.title]).toEqual(['BIRTHDAY', "Mia's Birthday Party"])
    const unnamed = facts(booking({ package_type: 'Custom Party Theme', child_name: null }))
    expect(unnamed.title).toBe('Birthday Party')
    expect(unnamed.shareText).toBe("You're invited to a Birthday Party on Sat, Nov 14! RSVP here:")
  })

  it('an evite override of theme_word / theme_sub wins, and brings its template_slug with it', () => {
    const f = facts(booking(), evite({ theme_word: 'neon', theme_sub: 'bash', template_slug: 'plain' }))
    expect([f.themeWord, f.themeSub, f.templateSlug, f.title]).toEqual(['NEON', 'BASH', 'plain', "Mia's Neon Party"])
  })

  it('Sleep Under: its own template, and the name and theme are screened for Lobster', () => {
    const f = facts(booking({ package_type: 'Sleep Under Party' }))
    expect([f.themeWord, f.themeSub, f.templateSlug, f.title]).toEqual(['SLEEP UNDER', 'PARTY', 'sleepunder', "Mia's Sleep Under Party"])
    expect(f.honoreePossessive).toBe("Mia's")
  })

  it('honoreePossessive: the cased name with an apostrophe, or the Birthday Star with none', () => {
    expect(facts(booking({ child_name: 'mia' })).honoreePossessive).toBe("Mia's")
    expect(facts(booking({ child_name: 'DeShawn' })).honoreePossessive).toBe("DeShawn's")
    expect(facts(booking({ child_name: null, quote_snapshot: null })).honoreePossessive).toBe("our Birthday Star's")
  })

  it('an override may pick the sleepunder template', () => {
    const f = facts(booking(), evite({ theme_word: 'pajama', template_slug: 'sleepunder' }))
    expect([f.themeWord, f.templateSlug]).toEqual(['PAJAMA', 'sleepunder'])
  })

  it('an override naming an unknown template keeps the resolved one', () => {
    expect(facts(booking(), evite({ theme_word: 'neon', template_slug: 'constructor' })).templateSlug).toBe('glow')
  })

  it('without an override the stored template_slug (default "glow" on every row) is NOT trusted', () => {
    expect(facts(booking({ package_type: 'Swiftie Party' }), evite({ template_slug: 'glow' })).templateSlug).toBe('plain')
  })

  it('an override made of unprintable characters is ignored', () => {
    const f = facts(booking(), evite({ theme_word: String.fromCodePoint(0x1f389) }))
    expect(f.themeWord).toBe('GLOW')
  })
})

describe('evites/facts - the words', () => {
  it('shareText and reshareText, named', () => {
    const f = facts()
    expect(f.shareText).toBe("You're invited to Mia's Glow Party on Sat, Nov 14! RSVP here:")
    expect(f.reshareText).toBe("Still hoping you can make Mia's party on Sat, Nov 14! RSVP here:") // spec 7.2, exactly
  })

  it('no name reads naturally, with a/an by the theme word', () => {
    const f = facts(booking({ child_name: null }))
    expect(f.shareText).toBe("You're invited to a Glow Birthday Party on Sat, Nov 14! RSVP here:")
    expect(f.reshareText).toBe('Still hoping you can make the party on Sat, Nov 14! RSVP here:')
    const an = facts(booking({ child_name: null }), evite({ theme_word: 'umbrella' }))
    expect(an.shareText).toBe("You're invited to an Umbrella Birthday Party on Sat, Nov 14! RSVP here:")
  })

  it('no date: the sentence simply has no "on ..."', () => {
    const f = facts(booking({ party_date: null }), evite(), 'preview')
    expect(f.shareText).toBe("You're invited to Mia's Glow Party! RSVP here:")
    expect(f.reshareText).toBe("Still hoping you can make Mia's party! RSVP here:")
  })

  it('share text carries no time, no address, no host phone', () => {
    const f = facts()
    expect(f.shareText + f.reshareText).not.toMatch(/PM|AM|Montauk|631/)
  })

  it('customer-facing copy signs as Allie, never Adam', () => {
    const f = facts()
    expect(JSON.stringify(f)).not.toMatch(/adam/i)
  })

  it('description by state', () => {
    expect(facts(booking(), evite(), 'preview').description).toBe("Mia's Glow Party. RSVPs open once the party is booked.")
    expect(facts(booking({ party_time: 'TBD' }), evite(), 'needs_time').description).toBe("Mia's Glow Party. Saturday, November 14. Start time coming soon.")
    expect(facts().description).toBe(`Mia's Glow Party. Saturday, November 14 ${DOT} 2${DASH}4 PM. Host Hampton, Speonk. RSVP online.`)
  })

  it('the public description never carries a mobile street address', () => {
    const f = facts(booking({ party_tags: { location_type: 'mobile', location_address: '12 Main St, Quogue, NY 11959' } }))
    expect(f.description).toContain('Quogue')
    expect(f.description).not.toContain('12 Main St')
  })

  it('host and gift notes and the RSVP deadline pass through, bounded and validated', () => {
    const f = facts(booking(), evite({ host_note: '  Bring a swimsuit  ', gift_note: 'x'.repeat(300), rsvp_deadline: '2026-11-07' }))
    expect(f.hostNote).toBe('Bring a swimsuit')
    expect(Array.from(f.giftNote as string)).toHaveLength(140)
    expect(f.rsvpDeadline).toBe('2026-11-07')
    const none = facts(booking(), evite({ host_note: '   ', rsvp_deadline: 'soon' }))
    expect([none.hostNote, none.giftNote, none.rsvpDeadline]).toEqual([null, null, null])
  })

  it('is pure: the same inputs give the same facts', () => {
    expect(facts()).toEqual(facts())
  })

  it('image strings are already screened (screening them again changes nothing)', () => {
    const f = facts(booking({ child_name: 'Zo' + String.fromCharCode(0xeb) }))
    expect(screenForImage(f.honoreeDisplay, 'bungee')).toBe(f.honoreeDisplay)
    expect(screenForImage(f.dateLine, 'poppins600')).toBe(f.dateLine)
  })
})
