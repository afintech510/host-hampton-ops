/**
 * `buildPortalPartyDetails` — what `/my-booking` lists, per product.
 *
 * Fixtures are shaped like real rows measured 2026-10-11 (names changed): an
 * in-studio Glow Party with planner food choices and a discount, a mobile party
 * with stations and a provisional address, and a studio rental with a window in
 * `party_tags`.
 */

import {
  buildPortalPartyDetails,
  buildSections,
  partyKindOf,
  PORTAL_SELECTION_COLUMNS,
  PORTAL_INTERNAL_ROW_KEYS,
  type PortalLineItem,
} from '@/lib/portalPartyDetails'
import { billedTotalCents, lineAmountCents } from '@/lib/planBalance'

const FAR = '2099-06-20'
const TODAY = '2026-10-11'

const li = (o: Partial<PortalLineItem> & { name: string; category: string }): PortalLineItem => ({
  unit_price_cents: 0,
  quantity: 1,
  guest_multiplied: false,
  is_optional: false,
  ...o,
})

const IN_STUDIO_ROW = {
  booking_ref: 'HH-PTY-TEST1',
  status: 'deposit_paid',
  party_type: 'in_studio_theme',
  event_type: 'kid-party',
  party_date: FAR,
  party_time: '13:00',
  guest_count_approx: 14,
  child_name: 'Ava',
  child_age: 8,
  package_type: 'Glow Party',
  party_tags: { location_type: 'host_hampton', custom_rate_reason: 'INTERNAL — never shown' },
  sel_pizza_or_bagels: 'bagels',
  sel_cupcake_flavor: 'chocolate',
  sel_add_mobile_cupcakes: 'false',
  sel_character_request: 'Elsa if possible',
  sel_party_preferences: '1 is gluten free',
  sel_catchy_party_name: "Ava's Glow Party!",
  sel_theme_name: 'Glow Party',
  sel_is_mini_party: 'false',
}

const IN_STUDIO_ITEMS = [
  li({ name: 'Glow Party', category: 'theme', unit_price_cents: 85000 }),
  li({ name: 'Additional Guests', category: 'theme', unit_price_cents: 4500, quantity: 4 }),
  li({ name: 'Glitter Tattoos (included)', category: 'activity-add-on' }),
  li({ name: 'Canvas Painting (2nd premium — $20 per guest)', category: 'activity-add-on', unit_price_cents: 2000, guest_multiplied: true }),
  li({ name: 'Bagel Platter', category: 'food-add-on', unit_price_cents: 6000 }),
  li({ name: 'Balloon Tower 6 ft.', category: 'decor-add-on', unit_price_cents: 15000 }),
  li({ name: 'Candy Wall (no artificial dyes)', category: 'custom', unit_price_cents: 12000 }),
  li({ name: 'Face Painter', category: 'entertainment-add-on', unit_price_cents: 25000, is_optional: true }),
  li({ name: 'Friends & Fam', category: 'discount', unit_price_cents: -5000 }),
]

describe('an in-studio party', () => {
  const d = buildPortalPartyDetails({ row: IN_STUDIO_ROW, lineItems: IN_STUDIO_ITEMS, canEditFull: true, today: TODAY })

  it('is labelled and titled for the child', () => {
    expect(d.kind).toBe('in_studio')
    expect(d.kindLabel).toBe('In-studio party')
    expect(d.title).toBe("Ava's Party")
    expect(d.subtitle).toBe("Ava's Glow Party!")
  })

  it('lists date, a 12-hour time, guests, the child and the theme', () => {
    const f = Object.fromEntries(d.facts.map(x => [x.label, x.value]))
    expect(f.Date).toBe('Saturday, June 20, 2099')
    expect(f.Time).toBe('1:00 PM')
    expect(f.Guests).toBe('14')
    expect(f.Celebrating).toBe('Ava, age 8')
    expect(f.Theme).toBe('Glow Party')
  })

  it('shows the planner food choices — pizza or bagels and the cupcake flavor', () => {
    expect(d.choices).toEqual([
      { label: 'Pizza or bagels', value: 'Bagels' },
      { label: 'Cupcake flavor', value: 'Chocolate' },
    ])
  })

  it("shows the customer's own notes, never bookings.notes", () => {
    expect(d.notes).toEqual([
      { label: 'Character request', value: 'Elsa if possible' },
      { label: 'Your notes', value: '1 is gluten free' },
    ])
    expect(JSON.stringify(d)).not.toContain('INTERNAL')
  })

  it('is held at the studio, with a directions link', () => {
    expect(d.location).toMatchObject({ kind: 'studio' })
    expect((d.location as { mapsUrl: string }).mapsUrl).toMatch(/^https:\/\/www\.google\.com\/maps/)
  })

  it('groups the line items into the sections a customer reads', () => {
    expect(d.sections.map(s => s.title)).toEqual([
      'Party package', 'Activities', 'Food & drinks', 'Decor', 'Extras & services', 'Custom add-ons', 'Discounts',
    ])
    const acts = d.sections.find(s => s.key === 'activities')!.lines
    // Per-head: $20 × 14 guests, from the same function the total is built from.
    expect(acts[1].amountCents).toBe(28000)
    expect(acts[0].amountCents).toBe(0)
    expect(d.sections.find(s => s.key === 'discounts')!.lines[0].amountCents).toBe(-5000)
    expect(d.sections.find(s => s.key === 'extras')!.lines[0].optional).toBe(true)
    // "×4" for a flat quantity; never for a per-head line.
    expect(d.sections[0].lines[1].quantityLabel).toBe('×4')
    expect(acts[1].quantityLabel).toBeNull()
  })

  it('the non-optional line amounts add up to the billed total exactly', () => {
    const sum = d.sections.flatMap(s => s.lines).filter(l => !l.optional).reduce((a, l) => a + l.amountCents, 0)
    expect(sum).toBe(billedTotalCents(IN_STUDIO_ITEMS, IN_STUDIO_ROW.guest_count_approx))
  })

  it('offers the party planner, and only while the plan may be edited', () => {
    expect(d.editLink).toEqual({ href: '/party-planner?ref=HH-PTY-TEST1', label: 'Change my party plan' })
    const locked = buildPortalPartyDetails({ row: IN_STUDIO_ROW, lineItems: [], canEditFull: false, today: TODAY })
    expect(locked.editLink).toBeNull()
  })
})

describe('a mobile party', () => {
  const row = {
    booking_ref: 'HH-PTY-TEST2',
    status: 'approved',
    party_type: 'mobile_party',
    event_type: 'mobile party',
    party_date: FAR,
    party_time: '15:00',
    guest_count_approx: 15,
    child_name: 'Mia',
    child_age: 6,
    package_type: 'Mobile Spa Party',
    party_tags: { location_address: 'Westhampton, NY (address TBC)' },
    sel_pizza_or_bagels: 'pizza',
    sel_cupcake_flavor: 'vanilla',
    sel_add_mobile_cupcakes: 'true',
  }
  const items = [
    li({ name: 'Mobile Party - up to 15 Guests', category: 'package', unit_price_cents: 95000 }),
    li({ name: 'Glitter Tattoos', category: 'station' }),
    li({ name: 'Nails', category: 'station' }),
    li({ name: 'Character Visit', category: 'add-on', unit_price_cents: 20000 }),
  ]
  const d = buildPortalPartyDetails({ row, lineItems: items, canEditFull: true, today: TODAY })

  it('is a mobile party with its package and its stations', () => {
    expect(d.kindLabel).toBe('Mobile party')
    expect(d.facts.find(f => f.label === 'Package')?.value).toBe('Mobile Spa Party')
    expect(d.sections.map(s => s.title)).toEqual(['Package', 'Stations & activities', 'Extras & services'])
  })

  it('shows the address it has, and asks for a real one while it is a placeholder', () => {
    expect(d.location).toEqual({ kind: 'home', address: 'Westhampton, NY (address TBC)', needsAddress: true })
    const real = buildPortalPartyDetails({
      row: { ...row, party_tags: { location_address: '105a Ponquogue Ave, Hampton Bays, NY' } },
      lineItems: items, canEditFull: true, today: TODAY,
    })
    expect(real.location).toMatchObject({ needsAddress: false })
  })

  it('does not claim pizza for a mobile party; shows the cupcake add-on only when chosen', () => {
    expect(d.choices).toEqual([{ label: 'Cupcakes', value: 'Vanilla cupcakes' }])
    const none = buildPortalPartyDetails({ row: { ...row, sel_add_mobile_cupcakes: 'false' }, lineItems: items, canEditFull: true, today: TODAY })
    expect(none.choices).toEqual([])
  })

  it('is not offered the in-studio planner', () => {
    expect(d.editLink).toBeNull()
  })
})

describe('a studio rental', () => {
  const row = {
    booking_ref: 'HH-PTY-TEST3',
    status: 'deposit_paid',
    party_type: 'studio_rental',
    event_type: 'studio-rental',
    party_date: FAR,
    party_time: '13:30',
    guest_count_approx: 30,
    child_name: null,
    party_tags: {
      rental_start_time: '13:30', rental_end_time: '16:30', rental_hours: 3,
      event_label: 'Birthday Party', seating_needed: 24,
    },
  }
  const items = [
    li({ name: 'Studio Rental — 3 hours (weekend base)', category: 'studio-rental-rate', unit_price_cents: 60000 }),
    li({ name: 'Full Clean-up Service', category: 'service-add-on', unit_price_cents: 10000 }),
  ]
  const d = buildPortalPartyDetails({ row, lineItems: items, canEditFull: true, today: TODAY })

  it('shows the rental window and the seating, with the event as the title', () => {
    expect(d.title).toBe('Studio Rental · Birthday Party')
    const f = Object.fromEntries(d.facts.map(x => [x.label, x.value]))
    expect(f['Rental time']).toBe('1:30 PM – 4:30 PM (3 hours)')
    expect(f.Event).toBeUndefined() // it is the title
    expect(f.Seating).toBe('24 seated')
    expect(f.Celebrating).toBeUndefined()
  })

  it('has no food choices and a "Your rental" section', () => {
    expect(d.choices).toEqual([])
    expect(d.sections[0].title).toBe('Your rental')
  })

  it('offers the rental editor only for the event_type that page manages', () => {
    expect(d.editLink).toEqual({ href: '/studio-rental', label: 'Change my rental' })
    const legacy = buildPortalPartyDetails({ row: { ...row, event_type: 'room-rental' }, lineItems: items, canEditFull: true, today: TODAY })
    expect(legacy.editLink).toBeNull()
  })
})

describe('the unclassified and the empty', () => {
  it('a NULL / unknown party_type is a plain "Party" with no location guessed', () => {
    for (const t of [null, 'unknown', undefined]) {
      expect(partyKindOf(t)).toBe('other')
      const d = buildPortalPartyDetails({ row: { party_type: t, booking_ref: 'X' }, lineItems: [], canEditFull: true, today: TODAY })
      expect(d.location).toBeNull()
      expect(d.facts.find(f => f.label === 'Date')?.value).toBe('To be confirmed')
      expect(d.editLink).toBeNull()
    }
  })

  it('a negative price is a discount whatever its category, and an unknown category is not dropped', () => {
    const s = buildSections(
      [li({ name: 'Twin Discount', category: 'theme', unit_price_cents: -2500 }), li({ name: 'Mystery', category: 'nope', unit_price_cents: 100 })],
      10, 'in_studio',
    )
    expect(s.map(x => x.key)).toEqual(['extras', 'discounts'])
  })

  it('a hostile snapshot value is shown as text, never interpreted', () => {
    const d = buildPortalPartyDetails({
      row: { party_type: 'in_studio_theme', sel_pizza_or_bagels: 'sushi', sel_cupcake_flavor: '<img onerror=1>' },
      lineItems: [], canEditFull: false, today: TODAY,
    })
    expect(d.choices).toEqual([])
  })
})

describe('the column contract with the route', () => {
  it('reads each snapshot key as one aliased scalar, and the route strips every alias', () => {
    const cols = PORTAL_SELECTION_COLUMNS.split(', ')
    expect(cols.length).toBeGreaterThanOrEqual(8)
    for (const c of cols) expect(c).toMatch(/^sel_[a-z_]+:quote_snapshot->>[A-Za-z]+$/)
    for (const c of cols) expect(PORTAL_INTERNAL_ROW_KEYS).toContain(c.split(':')[0])
    expect(PORTAL_INTERNAL_ROW_KEYS).toContain('party_tags')
  })

  it('lineAmountCents agrees with billedTotalCents line by line', () => {
    for (const it of IN_STUDIO_ITEMS.filter(i => !i.is_optional)) {
      expect(lineAmountCents(it, 14)).toBe(billedTotalCents([it], 14))
    }
  })
})
