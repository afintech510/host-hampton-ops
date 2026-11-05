/**
 * Quoting from words (lib/quoteRequest.ts) and the MCP tools built on it.
 * The model supplies names and a guest count; it never supplies a price.
 */
import { FALLBACK_CATALOG } from '@/lib/pricingCatalog'
import { buildQuoteItems } from '@/lib/quoteEngine'
import { matchByName, quoteFromCatalog, quoteToPlannerUrl, type LoadedCatalog } from '@/lib/quoteRequest'
import type { PricingItem } from '@/components/QuoteBuilder/types'

const item = (id: string, name: string, category: string, price_cents: number, price_type: PricingItem['price_type'] = 'flat'): PricingItem => ({
  id, name, description: null, category, price_cents, price_label: null, price_type, is_popular: false, sort_order: 0, emoji: null,
})
const groups = {
  themes: [item('t-glow', 'Glow Party', 'party-theme', 85000), item('t-spa', 'Spa Party', 'party-theme', 95000), item('t-spa2', 'Spa Party', 'party-theme', 99000)],
  premiumActivities: [item('a-slime', 'Slime Making', 'activity-premium', 0), item('a-perfume', 'Perfume Bar', 'activity-premium', 0)],
  standardActivities: [item('a-tattoo', 'Glitter Tattoos', 'activity-standard', 0)],
  food: [item('f-pizza', 'Pizza', 'food-add-on', 1200, 'per_person')], desserts: [item('d-cup', 'Cupcakes', 'dessert-add-on', 3000)],
  beverages: [], decor: [item('x-garland', 'Balloon Garland', 'decor-add-on', 7500)], entertainment: [], partyAddOns: [item('h-helper', 'Party Helper', 'party-add-on', 3000, 'per_person')],
}
const loaded: LoadedCatalog = { cat: FALLBACK_CATALOG, groups, items: buildQuoteItems(groups) }

describe('matchByName', () => {
  it('matches exactly (case, punctuation, ampersands), and with party/making noise stripped', () => {
    expect(matchByName(groups.themes, 'glow party')).toMatchObject({ kind: 'one', item: { id: 't-glow' } })
    expect(matchByName(groups.themes, 'Glow')).toMatchObject({ kind: 'one', item: { id: 't-glow' } })
    expect(matchByName(groups.premiumActivities, 'slime')).toMatchObject({ kind: 'one', item: { id: 'a-slime' } })
  })
  it('never fuzzy: a near miss matches nothing, and two equal names are ambiguous, not picked', () => {
    expect(matchByName(groups.themes, 'Glo Partee')).toEqual({ kind: 'none' })
    expect(matchByName(groups.themes, '')).toEqual({ kind: 'none' })
    expect(matchByName(groups.themes, 'Spa Party')).toEqual({ kind: 'ambiguous', names: ['Spa Party', 'Spa Party'] })
  })
})

describe('quoteFromCatalog', () => {
  const ask = (over: Record<string, unknown> = {}) => quoteFromCatalog(loaded, { partyType: 'studio', guests: 10, theme: 'Glow Party', ...over } as never)

  it('prices through the engine and returns the line items', () => {
    const a = ask({ activities: ['Slime Making'], addOns: ['Cupcakes', 'Pizza'] })
    expect(a.ok).toBe(true)
    if (a.ok) {
      expect(a.quote.totalCents).toBe(85000 + 10000 + 3000 + 1200 * 10)
      expect(a.theme).toBe('Glow Party')
      expect(a.activities).toEqual(['Slime Making'])
      expect(a.addOns.sort()).toEqual(['Cupcakes', 'Pizza'])
      expect(a.unmatched).toEqual([])
    }
  })

  it('a name it cannot match is reported and NOT priced — never approximated', () => {
    const a = ask({ activities: ['Slime Making', 'Skydiving'], addOns: ['Unicorn'] })
    expect(a.ok && a.unmatched.sort()).toEqual(['Skydiving', 'Unicorn'])
    expect(a.ok && a.quote.totalCents).toBe(85000 + 10000)
  })

  it('an ambiguous theme is an error that names the options; a missing theme is an error', () => {
    const amb = ask({ theme: 'Spa Party' })
    expect(amb).toMatchObject({ ok: false })
    expect(!amb.ok && amb.error).toMatch(/more than one theme/)
    expect(ask({ theme: undefined })).toMatchObject({ ok: false })
    expect(ask({ theme: 'Nope' })).toMatchObject({ ok: false })
  })

  it('guests are bounded and party type is checked', () => {
    for (const guests of [0, -3, 51, NaN, 'many']) expect(ask({ guests }).ok).toBe(false)
    expect(ask({ partyType: 'castle' }).ok).toBe(false)
    expect(ask({ guests: 10.9 }).ok && 1).toBe(1)
  })

  it('mobile ignores theme, says travel is not included, and bills every activity per child', () => {
    const a = quoteFromCatalog(loaded, { partyType: 'mobile', guests: 10, theme: 'Glow Party', activities: ['Slime Making', 'Glitter Tattoos'] })
    expect(a.ok && a.quote.totalCents).toBe(40000 + 2500 * 10 + 500 * 10)
    expect(a.ok && a.travelNotIncluded).toBe(true)
  })

  it('the mini party flag only applies to studio parties', () => {
    expect(ask({ mini: true }).ok && (ask({ mini: true }) as { quote: { totalCents: number } }).quote.totalCents).toBe(65000)
    const m = quoteFromCatalog(loaded, { partyType: 'mobile', guests: 10, mini: true })
    expect(m.ok && m.quote.totalCents).toBe(40000)
  })
})

describe('quoteToPlannerUrl', () => {
  it('round-trips through the planner\'s own parse (base64url JSON, ASCII only)', () => {
    const url = quoteToPlannerUrl({
      locationType: 'studio', guestCount: 12, isMiniParty: false, themeId: 't-glow', activityIds: ['a-slime'], foodIds: [], dessertIds: [],
      beverageIds: [], decorIds: [], entertainmentIds: [], partyAddOnIds: [],
    }, 'Glow Pärty ☃')
    const q = new URL(url).searchParams.get('q') as string
    expect(q).toMatch(/^[A-Za-z0-9_-]+$/)
    const json = Buffer.from(q.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1')
    expect(/^[\x00-\x7f]*$/.test(json)).toBe(true)
    const parsed = JSON.parse(json)
    expect(parsed).toMatchObject({ theme: 't-glow', guestCount: 12, activities: ['a-slime'], isMiniParty: false, contactName: '' })
    expect(parsed.themeName).toBe('Glow Pärty ☃')
  })
  it('mobile links to the planner without a prefilled studio theme', () => {
    expect(quoteToPlannerUrl({ locationType: 'mobile' } as never, null)).toMatch(/\/party-builder$/)
  })
})
