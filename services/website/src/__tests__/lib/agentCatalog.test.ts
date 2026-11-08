/**
 * What the AI surfaces (the ChatGPT connector and the website Host Assistant)
 * read about the business: the theme list, the party menu, the mobile anchor
 * and a month of availability. One rule runs through all of it — a name the
 * list gives out is a name the quote accepts, and a price the menu prints is
 * the price the engine charges.
 */
import fs from 'fs'
import path from 'path'
import { FALLBACK_CATALOG, catalogFromRows } from '@/lib/pricingCatalog'
import { buildQuoteItems } from '@/lib/quoteEngine'
import { listThemes, matchTheme, quoteFromCatalog, type LoadedCatalog, type ThemeInfo } from '@/lib/quoteRequest'
import { buildPartyMenu, includesSentence, mobileAnchor, STUDIO_PARTY_INCLUDES } from '@/lib/partyMenu'
import { startTimes, summarizeMonth, twelveHour, type AvailabilitySlot } from '@/lib/agentAvailability'
import { readCalendarMonth } from '@/lib/googleCalendar'
import type { PricingItem } from '@/components/QuoteBuilder/types'

const item = (id: string, name: string, category: string, price_cents: number, price_type: PricingItem['price_type'] = 'flat', description: string | null = null): PricingItem => ({
  id, name, description, category, price_cents, price_label: null, price_type, is_popular: false, sort_order: 0, emoji: null,
})

const groups = {
  themes: [
    item('t-sweets', 'Sweets-n-Treats Party', 'party-theme', 95000),
    item('t-kpop', 'K-Pop Demon Hunter Party', 'party-theme', 95000),
    item('t-unicorn', 'Unicorn Party', 'party-theme', 85000, 'flat', 'Rainbows'),
  ],
  premiumActivities: [item('p1', 'Make Your Own Slime', 'activity-premium', 0), item('p2', 'Perfume Making', 'activity-premium', 0), item('p3', 'Sand Art', 'activity-premium', 0)],
  standardActivities: [item('s1', 'Glitter Tattoos', 'activity-standard', 0), item('s2', 'Kiddie Karaoke', 'activity-standard', 0), item('s3', 'Glam Station', 'activity-standard', 0), item('s4', 'Unicorn Craft', 'activity-standard', 0)],
  food: [item('f1', 'Pizza Party Spread (per person)', 'food-add-on', 1000, 'per_person', 'Hot and ready'), item('f2', 'Fruit Platter', 'food-add-on', 7500)],
  desserts: [item('d1', 'Candy Wall', 'dessert-add-on', 20000)],
  beverages: [], decor: [], entertainment: [], partyAddOns: [item('x1', 'Goody Bags', 'party-add-on', 1000, 'per_person')],
}
const themeInfo: ThemeInfo[] = [
  { pricing_item_id: 't-sweets', name: 'Sweets & Treats', slug: 'sweets-treats', description: 'Cookie, cupcake and donut decorating' },
  { pricing_item_id: 't-kpop', name: 'K-Pop Party', slug: 'kpop-party', description: null },
]
const ANCHOR = { cents: 85000, kids: 10 }
const loaded: LoadedCatalog = { cat: { ...FALLBACK_CATALOG, mobileQuoteFrom: ANCHOR }, groups, items: buildQuoteItems(groups), themeInfo }

describe('one theme list: every listed name prices', () => {
  it('the site name, the price-list name and the slug all reach the same priced theme (the "Sweets & Treats" refusal, 2026-11-07)', () => {
    for (const asked of ['Sweets & Treats', 'sweets and treats', 'Sweets-n-Treats Party', 'sweets-treats']) {
      expect(matchTheme(loaded, asked)).toMatchObject({ kind: 'one', item: { id: 't-sweets' } })
    }
    expect(matchTheme(loaded, 'K-Pop Party')).toMatchObject({ kind: 'one', item: { id: 't-kpop' } })
    expect(matchTheme(loaded, 'Swifty')).toEqual({ kind: 'none' })
  })

  it('lists EVERY priced theme, with the website name where there is one, and each listed name quotes', () => {
    const list = listThemes(loaded)
    expect(list.map(t => t.name)).toEqual(['Sweets & Treats', 'K-Pop Party', 'Unicorn Party'])
    expect(list[2]).toMatchObject({ slug: null, about: 'Rainbows', price_cents: 85000 })
    for (const t of list) {
      const q = quoteFromCatalog(loaded, { partyType: 'studio', guests: 10, theme: t.name })
      expect(q.ok && q.quote.totalCents).toBe(t.price_cents)
    }
  })

  it('without the website names (party_themes unreadable) themes still match by price-list name', () => {
    const bare = { ...loaded, themeInfo: undefined }
    expect(matchTheme(bare, 'Sweets-n-Treats Party')).toMatchObject({ kind: 'one' })
    expect(listThemes(bare)[0].name).toBe('Sweets-n-Treats Party')
  })
})

describe('the planner\'s activity limits hold in a quote', () => {
  it('a 3rd premium and a 4th standard are reported, not priced', () => {
    const q = quoteFromCatalog(loaded, {
      partyType: 'studio', guests: 10, theme: 'Sweets & Treats',
      activities: ['Slime', 'Perfume Making', 'Sand Art', 'Glitter Tattoos', 'Kiddie Karaoke', 'Glam Station', 'Unicorn Craft'],
    })
    expect(q.ok).toBe(true)
    if (!q.ok) return
    expect(q.overLimit).toEqual(['Sand Art', 'Unicorn Craft'])
    expect(q.activities).toHaveLength(5)
    // 950 + 2nd premium $25 × 11 + 3rd standard $5 × 11 — the dropped two add nothing.
    expect(q.quote.totalCents).toBe(95000 + 2500 * 11 + 500 * 11)
  })
})

describe('the party menu', () => {
  const menu = buildPartyMenu(loaded)

  it('every add-on carries the catalog price, per child where the row says so, and the exact name the quote takes', () => {
    expect(menu.add_ons.food).toEqual([
      { name: 'Pizza Party Spread (per person)', price: '$10 per child', per_child: true, about: 'Hot and ready' },
      { name: 'Fruit Platter', price: '$75', per_child: false, about: null },
    ])
    for (const f of [...menu.add_ons.food, ...menu.add_ons.desserts, ...menu.add_ons.party_extras]) {
      const q = quoteFromCatalog(loaded, { partyType: 'studio', guests: 10, theme: 'Unicorn Party', addOns: [f.name] })
      expect(q.ok && q.unmatched).toEqual([])
      expect(q.ok && q.ambiguous).toEqual([])
    }
  })

  it('states the party from the catalog: guests, extra child, mini party, deposit, inclusions', () => {
    expect(menu.studio_party).toMatchObject({ kids_included: '10 kids plus the birthday child', extra_child: '$35' })
    expect(menu.studio_party.mini_party).toMatch(/^\$200 off/)
    expect(menu.studio_party.deposit).toMatch(/^\$250 holds the date/)
    expect(menu.studio_party.every_party_includes).toEqual([...STUDIO_PARTY_INCLUDES])
    expect(menu.themes.map(t => t.name)).toEqual(['Sweets & Treats', 'K-Pop Party', 'Unicorn Party'])
    expect(menu.activities.premium).toHaveLength(3)
  })

  it('never totals a mobile party: it gives the anchor and the quote link', () => {
    expect(menu.mobile_parties).toMatchObject({ starts_at: '$850', for_kids: 10 })
    expect(menu.mobile_parties.get_a_quote).toMatch(/\/mobile-party$/)
    expect(JSON.stringify(menu.mobile_parties)).not.toMatch(/\$400|\$650/)
  })

  it('a per-child item always says so; a flat item keeps its label ("From $110")', () => {
    const labelled = {
      ...groups,
      desserts: [{ ...item('d2', 'Sheet Cake', 'dessert-add-on', 11000), price_label: 'From $110' }],
      food: [{ ...item('f3', 'Pizza Party Spread', 'food-add-on', 1000, 'per_person'), price_label: '$10pp' }],
    }
    const m = buildPartyMenu({ ...loaded, groups: labelled, items: buildQuoteItems(labelled) })
    expect(m.add_ons.desserts[0].price).toBe('From $110')
    expect(m.add_ons.food[0].price).toBe('$10 per child')
  })

  it('llms.txt prints the same inclusions list (one copy)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/app/llms.txt/route.ts'), 'utf8')
    expect(src).toMatch(/includesSentence\(\)/)
    expect(src).not.toMatch(/pizza or bagels/)
    // The mobile anchor stays in the tools, where it has an off switch (Adam removed mobile prices from the site 2026-11-05).
    expect(src).not.toMatch(/\.mobileQuoteFrom/)
    expect(includesSentence()).toBe(
      'a dedicated host, full themed decor and setup, the theme activities, pizza or bagels, cupcakes, juice and water, a treat cart, a Host Hampton EVITE, and full cleanup',
    )
  })
})

describe('the mobile anchor is a catalog row', () => {
  const row = { name: 'x', category: 'mobile-package', price_cents: 90000, metadata: { catalog_key: 'mobile_quote_from', kids: 12 } }

  it('reads `mobile_quote_from` by key and moves with the row', () => {
    expect(catalogFromRows([row]).mobileQuoteFrom).toEqual({ cents: 90000, kids: 12 })
    expect(mobileAnchor({ ...FALLBACK_CATALOG, mobileQuoteFrom: { cents: 90000, kids: 12 } }).starts_at).toBe('$900')
  })

  it('no usable row means NO figure, never a compiled one: a read failure must not publish a mobile price', () => {
    expect(FALLBACK_CATALOG.mobileQuoteFrom).toBeNull()
    expect(catalogFromRows([]).mobileQuoteFrom).toBeNull()
    expect(catalogFromRows([{ ...row, price_cents: 0 }]).mobileQuoteFrom).toBeNull()
    expect(catalogFromRows([{ ...row, metadata: { catalog_key: 'mobile_quote_from' } }]).mobileQuoteFrom).toBeNull()
  })

  it('with the row off, the answer has no dollar figure anywhere and tells the model not to state one', () => {
    const off = mobileAnchor(FALLBACK_CATALOG)
    expect(off).not.toHaveProperty('starts_at')
    expect(off.how_it_is_priced).toMatch(/are quoted individually/)
    expect(JSON.stringify(off)).not.toMatch(/\$\d/)
    expect(off.rule_for_assistants).toMatch(/Do not state any dollar figure/)
    expect(off.get_a_quote).toMatch(/\/mobile-party$/)
  })
})

describe('a calendar read says whether it worked', () => {
  const realFetch = global.fetch
  const env = { ...process.env }
  const respond = (calendar: Response, token: unknown = { access_token: 't' }) => {
    global.fetch = jest.fn(async (url: unknown) => (String(url).includes('oauth2') ? Response.json(token) : calendar)) as never
  }
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    Object.assign(process.env, { GOOGLE_CALENDAR_ID: 'cal', GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', GOOGLE_REFRESH_TOKEN: 'c' })
  })
  afterEach(() => { global.fetch = realFetch; process.env = { ...env }; jest.restoreAllMocks() })

  it('an empty month is not a failure', async () => {
    respond(Response.json({ items: [] }))
    expect(await readCalendarMonth('2027-03')).toEqual({ events: [], failed: false })
  })
  it('Google refusing the read is a failure, not an empty month', async () => {
    respond(new Response('nope', { status: 500 }))
    expect(await readCalendarMonth('2027-03')).toEqual({ events: [], failed: true })
  })
  it('a refused token is a failure too', async () => {
    respond(Response.json({ items: [] }), { error: 'invalid_grant' })
    expect(await readCalendarMonth('2027-03')).toEqual({ events: [], failed: true })
  })
  it('no calendar configured is not a failure: the route reports that as configured:false', async () => {
    delete process.env.GOOGLE_CALENDAR_ID
    respond(Response.json({ items: [] }))
    expect(await readCalendarMonth('2027-03')).toEqual({ events: [], failed: false })
  })
})

describe('a month of availability', () => {
  const hour = (h: number, status: AvailabilitySlot['status'] = 'open'): AvailabilitySlot => ({
    start: `${String(h).padStart(2, '0')}:00`, end: `${String(h + 1).padStart(2, '0')}:00`, status,
  })

  it('a 2-hour party needs two back-to-back open hours; a gap between slots breaks the run', () => {
    expect(startTimes([hour(11), hour(12), hour(13, 'blocked'), hour(14), hour(15)], 120)).toEqual(['11:00', '14:00'])
    expect(startTimes([hour(11), hour(13)], 120)).toEqual([])
    expect(startTimes([hour(11), hour(12), hour(13)], 90)).toEqual(['11:00', '12:00'])
    expect(twelveHour('11:00')).toBe('11:00 AM')
    expect(twelveHour('12:30')).toBe('12:30 PM')
    expect(twelveHour('17:00')).toBe('5:00 PM')
  })

  it('a date with anything on the calendar is booked, days before the lead time are too soon, the past is skipped', () => {
    const day = [hour(11), hour(12), hour(13)]
    const m = summarizeMonth('2027-03', {
      configured: true,
      blockedDates: ['2027-03-13', '2027-04-01'],
      slots: { '2027-03-13': day, '2027-03-14': day, '2027-03-20': [hour(11), hour(12, 'blocked')] },
    }, '2027-03-02')
    expect(m.open_dates).toEqual([{ date: '2027-03-14', weekday: 'Sunday', start_times: ['11:00 AM', '12:00 PM'] }])
    expect(m.booked_dates).toEqual(['2027-03-13', '2027-03-20'])
    expect(m.too_soon_to_book_online[0]).toBe('2027-03-03')
    expect(m.too_soon_to_book_online).not.toContain('2027-03-02')
    expect(m.too_soon_to_book_online[m.too_soon_to_book_online.length - 1]).toBe('2027-03-12')
  })
})
