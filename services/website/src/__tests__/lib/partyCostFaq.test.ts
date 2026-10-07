import { buildCostFaq, isCostQuestion, withCostFaq, usd, type StudioTheme } from '@/lib/partyCostFaq'
import { CRAFT_PARTIES, type CraftParty } from '@/lib/craftParties'
import { FALLBACK_CATALOG, FALLBACK_MOBILE_TIERS } from '@/lib/pricingCatalog'

/**
 * The craft-page cost answer becomes FAQPage schema, which answer engines
 * quote. These pin that it states the CHARGED figures it was given, never a
 * typed one, and never a mobile price (plan §15).
 */

const theme = (slug: string, cents: number): StudioTheme => ({
  name: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  slug,
  price_cents: cents,
  description: null,
  pricing_item_id: null,
})
const THEMES = [theme('slime-party', 95000), theme('spa-party', 85000), theme('glow-party', 95000)]
const page = (slug: string) => CRAFT_PARTIES.find(c => c.slug === slug) as CraftParty
const dollars = (s: string) => (s.match(/\$[\d,]+(?:\.\d\d)?/g) ?? [])

describe('buildCostFaq', () => {
  it('states the exact theme price on a page that IS a studio theme', () => {
    const f = buildCostFaq(page('slime-party'), THEMES, FALLBACK_CATALOG)!
    expect(f.q).toBe('How much does a slime party cost?')
    expect(f.a).toContain('is $950 for 2 hours')
  })

  it('states the live studio range on a craft page that is not a theme', () => {
    const f = buildCostFaq(page('mermaid-party'), THEMES, FALLBACK_CATALOG)!
    expect(f.a).toContain('are $850–$950 for 2 hours')
  })

  it('states studio rental rates on the studio-only shower page', () => {
    const s = FALLBACK_CATALOG.studioRates
    const f = buildCostFaq(page('shower-venue'), THEMES, FALLBACK_CATALOG)!
    expect(f.q).toMatch(/rent the studio/)
    expect(f.a).toContain(usd(s.weekdayBaseCents))
    expect(f.a).toContain(usd(s.weekendBaseCents))
    expect(f.a).toContain(usd(s.securityDepositCents))
  })

  it('says nothing for a mobile-only activation (custom-quoted)', () => {
    expect(buildCostFaq(page('canvas-tote-activation'), THEMES, FALLBACK_CATALOG)).toBeNull()
  })

  it('says nothing rather than inventing a figure when no theme prices were read', () => {
    expect(buildCostFaq(page('slime-party'), [], FALLBACK_CATALOG)).toBeNull()
  })

  it('never puts a mobile price into the answer (plan §15) — every figure is one it was given', () => {
    const g = FALLBACK_CATALOG.guestRules
    const s = FALLBACK_CATALOG.studioRates
    const allowed = new Set(
      [85000, 95000, g.extraGuestCents, g.miniPartyDiscountCents, 25000,
        s.weekdayBaseCents, s.weekendBaseCents, s.weekdayFullDayCents, s.weekendFullDayCents,
        s.weekdayAddlHourCents, s.weekendAddlHourCents, s.securityDepositCents].map(usd),
    )
    const mobile = new Set(FALLBACK_MOBILE_TIERS.map(t => `$${t.price}`))
    let examined = 0
    for (const c of CRAFT_PARTIES) {
      const f = buildCostFaq(c, THEMES, FALLBACK_CATALOG)
      if (!f) continue
      examined++
      for (const d of dollars(f.a)) {
        expect(allowed.has(d)).toBe(true)
        if (!allowed.has(d)) throw new Error(`${c.slug}: unexpected figure ${d}`)
      }
      for (const m of Array.from(mobile)) {
        if (!allowed.has(m)) expect(f.a).not.toContain(m)
      }
    }
    expect(examined).toBeGreaterThanOrEqual(10)
  })
})

describe('withCostFaq', () => {
  it('puts the built answer first and REPLACES any typed cost question', () => {
    const typed = [
      { q: 'How much is a kids paint party?', a: 'Studio party packages start at $750.' },
      { q: 'Does the paint wash out?', a: 'Yes.' },
    ]
    const out = withCostFaq(typed, { q: 'How much does a paint party cost?', a: 'built' })
    expect(out.map(f => f.q)).toEqual(['How much does a paint party cost?', 'Does the paint wash out?'])
  })

  it('leaves the FAQs alone when there is no built answer', () => {
    const typed = [{ q: 'Q?', a: 'A' }]
    expect(withCostFaq(typed, null)).toBe(typed)
  })

  it('every non-mobile craft page ends with exactly one cost question', () => {
    for (const c of CRAFT_PARTIES) {
      const out = withCostFaq(c.faqs, buildCostFaq(c, THEMES, FALLBACK_CATALOG))
      const n = out.filter(isCostQuestion).length
      expect([c.slug, n]).toEqual([c.slug, c.venue === 'mobile' ? n : 1])
    }
  })

  it('no craft page carries a typed price in its FAQ data any more', () => {
    for (const c of CRAFT_PARTIES) {
      for (const f of c.faqs) expect([c.slug, f.q, dollars(f.a)]).toEqual([c.slug, f.q, []])
    }
  })
})
