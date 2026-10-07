import { withEffectivePrices } from '@/lib/themePricing'

/**
 * Migration 062: a theme's price is its linked pricing_items row's price.
 * These pin the fallbacks, because a theme must never render at $0 or vanish.
 */
describe('withEffectivePrices', () => {
  const items = [
    { id: 'slime', price_cents: 95000, is_active: true },
    { id: 'off', price_cents: 70000, is_active: false },
    { id: 'zero', price_cents: 0, is_active: true },
  ]

  it('uses the linked price when the theme carries a stale mirror', () => {
    const [t] = withEffectivePrices([{ name: 'Slime', price_cents: 90000, pricing_item_id: 'slime' }], items)
    expect(t.price_cents).toBe(95000)
    expect(t.name).toBe('Slime')
  })

  it('keeps the theme price when there is no link (Sleep Under)', () => {
    const [t] = withEffectivePrices([{ price_cents: 90000, pricing_item_id: null }], items)
    expect(t.price_cents).toBe(90000)
  })

  it('keeps the theme price when the linked row is inactive, priced at zero, or missing', () => {
    const out = withEffectivePrices(
      [
        { price_cents: 85000, pricing_item_id: 'off' },
        { price_cents: 85000, pricing_item_id: 'zero' },
        { price_cents: 85000, pricing_item_id: 'gone' },
      ],
      items,
    )
    expect(out.map(t => t.price_cents)).toEqual([85000, 85000, 85000])
  })

  it('does not mutate its input', () => {
    const theme = { price_cents: 90000, pricing_item_id: 'slime' }
    withEffectivePrices([theme], items)
    expect(theme.price_cents).toBe(90000)
  })
})
