import { renderInputsHash, calInputsHash, canonicalJson, calTitleOf, RENDER_LAYOUT_TAG } from '@/lib/evites/hash'
import { inviteFacts, type InviteFacts, type InviteFactsBooking, type InviteFactsEvite } from '@/lib/evites/facts'
import type { PartyThemeRow } from '@/lib/evites/types'

const THEMES: PartyThemeRow[] = [
  { id: 't1', name: 'Glow Party', slug: 'glow-party', pricing_item_id: 'pi-glow' },
  { id: 't2', name: 'Swiftie Party', slug: 'swiftie-party', pricing_item_id: 'pi-swift' },
]

const booking = (over: Record<string, unknown> = {}): InviteFactsBooking => ({
  party_type: 'in_studio_theme',
  party_date: '2026-11-14',
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

const facts = (b = booking(), e = evite(), state: Parameters<typeof inviteFacts>[4] = 'live'): InviteFacts => inviteFacts(b, e, [], THEMES, state)

/** The same object with its keys inserted in reverse order. */
function reversed<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).reverse()) as unknown as T
}

describe('evites/hash - canonicalJson', () => {
  it('is stable across key order, at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: 4, c: [3, { z: 1, y: 2 }] } })).toBe(canonicalJson({ a: { c: [3, { y: 2, z: 1 }], d: 4 }, b: 1 }))
  })

  it('drops undefined, keeps null, and writes Dates as ISO strings', () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}')
    expect(canonicalJson({ d: new Date('2026-11-14T19:00:00Z') })).toBe('{"d":"2026-11-14T19:00:00.000Z"}')
    expect(canonicalJson({ d: new Date(NaN) })).toBe('{"d":null}')
  })

  it('does not sort arrays (order is content)', () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]))
  })
})

describe('evites/hash - renderInputsHash', () => {
  it('is a sha256 hex digest and is deterministic', () => {
    const h = renderInputsHash(facts())
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(renderInputsHash(facts())).toBe(h)
  })

  it('is stable when the facts object is built with its keys in another order', () => {
    const f = facts()
    expect(renderInputsHash(reversed(f))).toBe(renderInputsHash(f))
  })

  it('ignores everything that is not printed on the image', () => {
    const base = renderInputsHash(facts())
    expect(renderInputsHash({ ...facts(), hostNote: 'new', giftNote: 'new', rsvpDeadline: '2026-11-01', guestCap: 99, shareText: 'x', reshareText: 'y', description: 'z' })).toBe(base)
  })

  it('changes when the date changes', () => {
    expect(renderInputsHash(facts(booking({ party_date: '2026-11-21' })))).not.toBe(renderInputsHash(facts()))
  })

  it('changes when the time, name, age, theme, place or host line changes', () => {
    const base = renderInputsHash(facts())
    const changed = [
      facts(booking({ party_time: '3:00 PM' })),
      facts(booking({ child_name: 'Ava' })),
      facts(booking({ child_name: null })),
      facts(booking({ child_age: 8 })),
      facts(booking({ package_type: 'Swiftie Party' })),
      facts(booking({ party_tags: { location_type: 'mobile', location_address: '1 Main St, Quogue, NY 11959' } })),
      facts(booking(), evite({ host_contact_name: 'Dana' })),
      facts(booking(), evite({ show_host_contact: false })),
    ].map(renderInputsHash)
    for (const h of changed) expect(h).not.toBe(base)
    expect(new Set(changed).size).toBe(changed.length)
  })

  it('changes when the state changes what the date line says (preview -> live re-renders)', () => {
    expect(renderInputsHash(facts(booking(), evite(), 'preview'))).not.toBe(renderInputsHash(facts()))
    expect(renderInputsHash(facts(booking(), evite(), 'needs_time'))).not.toBe(renderInputsHash(facts()))
  })

  it('carries the layout tag, so a template change can force a re-render', () => {
    expect(RENDER_LAYOUT_TAG).toMatch(/\S/)
  })
})

describe('evites/hash - calInputsHash', () => {
  it('is stable across key order', () => {
    const f = facts()
    expect(calInputsHash(reversed(f))).toBe(calInputsHash(f))
  })

  it('changes when the date, the time or the length changes', () => {
    const base = calInputsHash(facts())
    expect(calInputsHash(facts(booking({ party_date: '2026-11-21' })))).not.toBe(base)
    expect(calInputsHash(facts(booking({ party_time: '3:00 PM' })))).not.toBe(base)
    expect(calInputsHash(facts(booking({ quote_snapshot: { isMiniParty: true } })))).not.toBe(base)
  })

  it('changes when the location or the name changes', () => {
    const base = calInputsHash(facts())
    expect(calInputsHash(facts(booking({ party_tags: { location_type: 'mobile', location_address: '1 Main St, Quogue, NY 11959' } })))).not.toBe(base)
    expect(calInputsHash(facts(booking({ child_name: 'Ava' })))).not.toBe(base)
  })

  it('does NOT change on a theme change (a theme is not on a guest\'s calendar)', () => {
    const glow = facts()
    const swiftie = facts(booking({ package_type: 'Swiftie Party' }))
    expect(swiftie.themeWord).not.toBe(glow.themeWord)
    expect(swiftie.title).not.toBe(glow.title)
    expect(renderInputsHash(swiftie)).not.toBe(renderInputsHash(glow)) // the image does change
    expect(calInputsHash(swiftie)).toBe(calInputsHash(glow))
    // nor on an admin theme override
    expect(calInputsHash(facts(booking(), evite({ theme_word: 'neon', theme_sub: 'bash', template_slug: 'plain' })))).toBe(calInputsHash(glow))
  })

  it('does NOT change on anything else in the facts (host line, notes, state wording)', () => {
    const base = calInputsHash(facts())
    expect(calInputsHash(facts(booking(), evite({ host_contact_name: 'Dana', host_note: 'hi', gift_note: 'no gifts' })))).toBe(base)
    expect(calInputsHash(facts(booking(), evite(), 'closed'))).toBe(base)
  })

  it('a party with no window hashes without throwing, and differs from one with a window', () => {
    const none = facts(booking({ party_time: 'Evening' }), evite(), 'needs_time')
    expect(none.window).toBeNull()
    expect(calInputsHash(none)).toMatch(/^[0-9a-f]{64}$/)
    expect(calInputsHash(none)).not.toBe(calInputsHash(facts()))
  })

  it('the calendar title is the child and the occasion, never the theme', () => {
    expect(calTitleOf(facts())).toBe("MIA's Birthday Party")
    expect(calTitleOf(facts(booking({ child_name: null })))).toBe('Birthday Party')
  })
})
