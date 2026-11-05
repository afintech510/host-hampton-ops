/**
 * The quote engine (lib/quoteEngine.ts): golden figures for the planner's
 * published rules, and the tripwire that keeps the planner on the engine.
 *
 * Hand-computed from the rules, not read back from the code under test:
 *   studio  10 guests included, $35 each extra, mini = -$200 and max 6 guests;
 *   premium 1st free on a $950+ theme, else +$100; 2nd +$25 × (guests+1);
 *   standard 1st/2nd included, 3rd +$5 × (guests+1);
 *   mobile  $400 up to 18 guests (+$150 at 19, +$150 at 28), every activity per person
 *           ($25 premium, $5 standard), plus travel.
 */
import fs from 'fs'
import path from 'path'
import { FALLBACK_CATALOG } from '@/lib/pricingCatalog'
import { buildQuoteItems, computeQuote, effectiveGuests, type QuoteSelection } from '@/lib/quoteEngine'
import type { PricingItem } from '@/components/QuoteBuilder/types'

const item = (id: string, category: string, price_cents: number, price_type: PricingItem['price_type'] = 'flat'): PricingItem => ({
  id, name: id, description: null, category, price_cents, price_label: null, price_type, is_popular: false, sort_order: 0, emoji: null,
})
const items = buildQuoteItems({
  themes: [item('t850', 'party-theme', 85000), item('t950', 'party-theme', 95000)],
  premiumActivities: [item('p1', 'activity-premium', 0), item('p2', 'activity-premium', 0), item('p3', 'activity-premium', 0)],
  standardActivities: [item('s1', 'activity-standard', 0), item('s2', 'activity-standard', 0), item('s3', 'activity-standard', 0), item('s4', 'activity-standard', 0)],
  food: [item('pizza', 'food-add-on', 1200, 'per_person'), item('cake', 'food-add-on', 6000)],
  desserts: [item('cupcakes', 'dessert-add-on', 3000)],
  beverages: [item('juice', 'beverage-add-on', 200, 'per_person')],
  decor: [item('garland', 'decor-add-on', 7500), item('favors', 'decor-add-on', 300, 'per_person')],
  entertainment: [item('dj', 'entertainment-add-on', 15000)],
  partyAddOns: [item('helper', 'party-add-on', 3000, 'per_person')],
})
const base = (over: Partial<QuoteSelection> = {}): QuoteSelection => ({
  locationType: 'studio', guestCount: 10, isMiniParty: false, themeId: 't850', activityIds: [], foodIds: [], dessertIds: [],
  beverageIds: [], decorIds: [], entertainmentIds: [], partyAddOnIds: [], ...over,
})
const total = (over: Partial<QuoteSelection>) => computeQuote(FALLBACK_CATALOG, items, base(over)).totalCents

describe('studio', () => {
  it('the theme alone, and extra guests at $35', () => {
    expect(total({})).toBe(85000)
    expect(total({ guestCount: 14 })).toBe(85000 + 4 * 3500)
  })

  it('premium activities: first costs $100 on an $850 theme, is free on $950, second is $25 x (guests+1)', () => {
    expect(total({ activityIds: ['p1'] })).toBe(85000 + 10000)
    expect(total({ themeId: 't950', activityIds: ['p1'] })).toBe(95000)
    expect(total({ activityIds: ['p1', 'p2'] })).toBe(85000 + 10000 + 2500 * 11)
    expect(total({ themeId: 't950', activityIds: ['p1', 'p2'] })).toBe(95000 + 2500 * 11)
  })

  it('standard activities: two included, the third is $5 x (guests+1)', () => {
    expect(total({ activityIds: ['s1', 's2'] })).toBe(85000)
    expect(total({ activityIds: ['s1', 's2', 's3'] })).toBe(85000 + 500 * 11)
  })

  it('the activity order matters: the FIRST premium picked is the free one', () => {
    const q = computeQuote(FALLBACK_CATALOG, items, base({ themeId: 't950', activityIds: ['p2', 's1', 'p1'] }))
    expect(q.lineItems.find(l => l.name.startsWith('p2'))!.unit_price_cents).toBe(0)
    expect(q.lineItems.find(l => l.name.startsWith('p1'))!.unit_price_cents).toBe(2500 * 11)
  })

  it('mini party: -$200, guests capped at 6, and no extra-guest charge', () => {
    expect(effectiveGuests(FALLBACK_CATALOG, { guestCount: 12, isMiniParty: true })).toBe(6)
    expect(total({ isMiniParty: true, guestCount: 12 })).toBe(85000 - 20000)
    const lines = computeQuote(FALLBACK_CATALOG, items, base({ isMiniParty: true })).lineItems
    expect(lines[0].unit_price_cents).toBe(65000)
  })

  it('add-ons: per-person x guests x qty, flat x qty, decor per-person ignores qty', () => {
    expect(total({ foodIds: ['pizza', 'cake'], foodQty: { pizza: 2, cake: 3 } })).toBe(85000 + 1200 * 10 * 2 + 6000 * 3)
    expect(total({ dessertIds: ['cupcakes'], beverageIds: ['juice'], entertainmentIds: ['dj'], partyAddOnIds: ['helper'] })).toBe(85000 + 3000 + 200 * 10 + 15000 + 3000 * 10)
    expect(total({ decorIds: ['garland', 'favors'], decorQty: { garland: 2, favors: 5 } })).toBe(85000 + 7500 * 2 + 300 * 10)
  })

  it('admin custom items and discounts, and the total never goes below zero', () => {
    expect(total({ customItems: [{ name: 'Deco', price_cents: 5000, quantity: 2, guest_multiplied: false }, { name: 'Per head', price_cents: 100, quantity: 1, guest_multiplied: true }] })).toBe(85000 + 10000 + 1000)
    expect(total({ customItems: [{ name: 'Comp', price_cents: -999999, quantity: 1, guest_multiplied: false, is_discount: true }] })).toBe(0)
  })

  it('the line items add up to the total', () => {
    const q = computeQuote(FALLBACK_CATALOG, items, base({ guestCount: 13, themeId: 't950', activityIds: ['p1', 'p2', 's1', 's2', 's3'], foodIds: ['pizza'], decorIds: ['garland'] }))
    const sum = q.lineItems.reduce((n, l) => n + l.unit_price_cents * l.quantity * (l.guest_multiplied ? q.effectiveGuestCount : 1), 0)
    expect(sum).toBe(q.totalCents)
  })
})

describe('mobile', () => {
  it('$850 at 10 guests: the $400 base + one premium ($25 x 10) + four standard ($5 x 10 each)', () => {
    const q = computeQuote(FALLBACK_CATALOG, items, base({ locationType: 'mobile', activityIds: ['p1', 's1', 's2', 's3', 's4'] }))
    expect(q.totalCents).toBe(85000)
    expect(q.lineItems[0]).toMatchObject({ category: 'mobile-package', unit_price_cents: 40000, name: 'Mobile Party Package (up to 18 guests)' })
  })

  it('every activity is billed (no first-free rule), the band steps up at 19 and 28, travel is added', () => {
    expect(total({ locationType: 'mobile', activityIds: ['p1', 'p2'] })).toBe(40000 + 2 * 2500 * 10)
    expect(total({ locationType: 'mobile', guestCount: 19 })).toBe(55000)
    expect(total({ locationType: 'mobile', guestCount: 28 })).toBe(70000)
    expect(total({ locationType: 'mobile', travelFeeCents: 4500 })).toBe(44500)
    expect(computeQuote(FALLBACK_CATALOG, items, base({ locationType: 'mobile', guestCount: 22 })).lineItems[0].name).toBe('Mobile Party Package (19–27 guests)')
  })

  it('theme, food, desserts and decor do not count in mobile mode; the legacy cupcakes auto-item is dropped', () => {
    expect(total({ locationType: 'mobile', themeId: 't950', foodIds: ['cake'], dessertIds: ['cupcakes'], decorIds: ['garland'] })).toBe(40000)
    expect(total({ locationType: 'mobile', customItems: [{ id: 'mobile-cupcakes', name: 'x', price_cents: 9999, quantity: 1, guest_multiplied: false }] })).toBe(40000)
  })

  it('a mobile mini party still caps guests at 6', () => {
    expect(total({ locationType: 'mobile', isMiniParty: true, guestCount: 20, activityIds: ['p1'] })).toBe(40000 + 2500 * 6)
  })
})

describe('the planner stays on the engine', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'party-builder', 'PartyBuilderContent.tsx'), 'utf8').replace(/\r\n/g, '\n')

  it('imports the engine and keeps no private copy of its rates or its arithmetic', () => {
    expect(src).toMatch(/from '@\/lib\/quoteEngine'/)
    expect(src).not.toMatch(/const\s+PREMIUM_EXTRA_CENTS\s*=|const\s+STANDARD_EXTRA_CENTS\s*=|const\s+PREMIUM_UPGRADE_FLAT_CENTS\s*=|const\s+THEME_PREMIUM_INCLUDED_THRESHOLD\s*=/)
    const total = src.slice(src.indexOf('const total = useMemo'), src.indexOf('const total = useMemo') + 200)
    expect(total).toMatch(/quoteTotalCents\(cat, quoteItems, quoteSelection\)/)
    const lines = src.slice(src.indexOf('function getLineItems()'), src.indexOf('function getLineItems()') + 120)
    expect(lines).toMatch(/buildLineItems\(cat, quoteItems, quoteSelection\)/)
  })
})
