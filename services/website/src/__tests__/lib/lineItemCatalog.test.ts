/**
 * loadLineItemAddOns: the names an invoice line can be added from, by the Manager assistant and the
 * Parties tab's Add Line Item box. It once searched only service and decor add-ons, so the Hot
 * Chocolate Bar (a beverage add-on) "was not in the pricing catalog" for Alise Pulliam's Dec 12 lead.
 */
import { LINE_ITEM_CATEGORIES, loadLineItemAddOns } from '@/lib/pricingCatalog'

type Row = { name: string; price_cents: number; price_type: string; category: string }

function fakeDb(rows: Row[], error: unknown = null) {
  const seen: { inCategories?: string[]; active?: boolean } = {}
  const q: any = {
    select: () => q,
    eq: (_c: string, v: unknown) => { seen.active = v as boolean; return q },
    in: (_c: string, v: string[]) => { seen.inCategories = v; return q },
    order: () => q,
    then: (res: any) => res({ data: error ? null : rows.filter(r => seen.inCategories?.includes(r.category)), error }),
  }
  return { db: { from: () => q } as never, seen }
}

const row = (name: string, cents: number, category: string, price_type = 'flat'): Row => ({ name, price_cents: cents, price_type, category })

describe('loadLineItemAddOns', () => {
  it('reads food, drinks, desserts, entertainment and extras as well as services and decor', async () => {
    expect([...LINE_ITEM_CATEGORIES].sort()).toEqual([
      'beverage-add-on', 'decor-add-on', 'dessert-add-on', 'entertainment-add-on', 'food-add-on', 'party-add-on', 'service-add-on',
    ])
    const { db, seen } = fakeDb([
      row('Hot Chocolate Bar', 15000, 'beverage-add-on'),
      row('Coffee Bar', 15000, 'beverage-add-on'),
      row('Fruit Platter', 8500, 'food-add-on'),
      row('Pizza Party Spread (per person)', 1000, 'food-add-on', 'per_person'),
      row('Sheet Cake', 12000, 'dessert-add-on'),
      row('Balloon Garland', 15000, 'decor-add-on'),
      row('Mystic Seas', 45000, 'party-theme'),
    ])
    const out = await loadLineItemAddOns(db)
    expect(seen.active).toBe(true)
    expect(seen.inCategories).toEqual([...LINE_ITEM_CATEGORIES])
    expect(out.map(o => o.name)).toEqual(['Hot Chocolate Bar', 'Coffee Bar', 'Fruit Platter', 'Pizza Party Spread (per person)', 'Sheet Cake', 'Balloon Garland'])
    expect(out[0]).toEqual({ name: 'Hot Chocolate Bar', priceCents: 15000, guestMultiplied: false, category: 'beverage-add-on' })
    expect(out.find(o => o.name.startsWith('Pizza'))?.guestMultiplied).toBe(true)
  })

  it('never offers a theme, activity, package or rate by name', () => {
    for (const c of ['party-theme', 'activity-premium', 'activity-standard', 'mobile-package', 'mobile-station', 'studio-rental-rate', 'studio-rental', 'room-rental', 'deposit', 'guest-overage']) {
      expect(LINE_ITEM_CATEGORIES).not.toContain(c as never)
    }
  })

  it('collapses an item sold under two categories at one price, and keeps one sold at two prices as two', async () => {
    const { db } = fakeDb([
      row('Photo Booth', 11900, 'service-add-on'),
      row('Photo Booth', 11900, 'party-add-on'),
      row('Linen Rentals', 9500, 'service-add-on'),
      row('Linen Rentals', 9500, 'decor-add-on'),
      row('Balloon Arch', 10000, 'decor-add-on'),
      row('Balloon Arch', 12000, 'party-add-on'),
    ])
    const out = await loadLineItemAddOns(db)
    expect(out.filter(o => o.name === 'Photo Booth')).toHaveLength(1)
    expect(out.filter(o => o.name === 'Linen Rentals')).toHaveLength(1)
    expect(out.filter(o => o.name === 'Balloon Arch')).toHaveLength(2)
  })

  it('drops an unpriced row rather than offering a $0 line', async () => {
    const { db } = fakeDb([row('Mystery Add-on', 0, 'party-add-on'), row('Real Add-on', 500, 'party-add-on')])
    expect((await loadLineItemAddOns(db)).map(o => o.name)).toEqual(['Real Add-on'])
  })

  it('returns nothing, not a partial list, when the read fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(await loadLineItemAddOns(fakeDb([], { message: 'down' }).db)).toEqual([])
  })
})
