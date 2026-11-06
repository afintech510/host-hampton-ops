/**
 * Adam, 2026-11-05: "remove the pricing listed for now" for mobile parties.
 *
 * The packages stay (name, minutes, kids, what is included, the free-travel and
 * no-gratuity promises) and every dollar figure goes: the $500 / $750 tiers, the
 * extra-child price and the deposit. What is CHARGED is untouched: the planner
 * and the quote engine read `mobileBands`, which this does not touch.
 */
import fs from 'fs'
import path from 'path'
import { renderToStaticMarkup } from 'react-dom/server'
import { FALLBACK_CATALOG, FALLBACK_MOBILE_TIERS } from '@/lib/pricingCatalog'

jest.mock('next/cache', () => ({ unstable_noStore: () => undefined }))
jest.mock('@/lib/pricingCatalog', () => {
  const actual = jest.requireActual('@/lib/pricingCatalog')
  return { ...actual, loadPricingCatalog: async () => actual.FALLBACK_CATALOG }
})

import MobilePriceBlock from '@/components/MobilePriceBlock'

const SRC = path.join(process.cwd(), 'src')
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8')

describe('the mobile package block', () => {
  it('shows both packages with their length, kids and inclusions, and no dollar figure at all', async () => {
    const html = renderToStaticMarkup(await MobilePriceBlock({}))
    expect(html).toContain('Entry')
    expect(html).toContain('Signature')
    expect(html).toContain('Most Booked')
    expect(html).toMatch(/>60<[^]*minutes/)
    expect(html).toMatch(/>90<[^]*minutes/)
    expect(html).toContain('Up to <strong>8 kids</strong>')
    expect(html).toContain('A finished keepsake for every child')
    expect(html).toContain('No mandatory gratuity')
    expect(html).not.toMatch(/\$/)
    expect(html).not.toMatch(/\b(500|750)\b/)
  })

  it('says it is packages, not pricing, and how to get a price', async () => {
    const html = renderToStaticMarkup(await MobilePriceBlock({}))
    expect(html).toContain('Mobile Party Packages')
    expect(html).not.toMatch(/Pricing/)
    expect(html).toMatch(/exact quote/)
  })

  it('holds with every caller\'s heading (none says Pricing)', () => {
    for (const [file, needle] of [
      [['app', 'mobile-party', 'page.tsx'], 'MobilePriceBlock'],
      [['app', 'mobile-craft-party', 'page.tsx'], 'Mobile Craft Party Packages'],
      [['app', 'mobile-craft-party', '[location]', 'page.tsx'], 'Craft Party Packages in'],
      [['components', 'CraftPartyLanding.tsx'], 'Packages`}'],
    ] as [string[], string][]) {
      const src = read(...file)
      expect(src).toContain(needle)
      expect(src).not.toMatch(/Pricing[`"']\s*(subheading|\/>)|Pricing`\}/)
    }
  })
})

describe('what is charged is not what was hidden', () => {
  it('the block reads the published tiers and nothing the quote engine reads', () => {
    const block = read('components', 'MobilePriceBlock.tsx')
    expect(block).not.toMatch(/tier\.price\}/)
    expect(block).not.toMatch(/extraChildCents|BOOKING_DEPOSIT_CENTS/)
    // The charge path reads bands, never tiers.
    for (const f of [['lib', 'quoteEngine.ts']]) expect(read(...f)).not.toMatch(/mobileTiers/)
  })

  it('the catalog still holds the tier prices and the planner bands, unchanged', () => {
    expect(FALLBACK_MOBILE_TIERS.map(t => [t.name, t.price])).toEqual([['Entry', 500], ['Signature', 750]])
    expect(FALLBACK_CATALOG.mobileBands.baseCents).toBe(40000)
  })
})

describe('no public copy still points at the removed prices', () => {
  it('the mobile-party FAQ and llms.txt say a price is quoted, not that it is "above" or "listed"', () => {
    const page = read('app', 'mobile-party', 'page.tsx')
    expect(page).not.toMatch(/Entry and Signature packages above/)
    expect(page).toMatch(/We quote every mobile party/)
    const llms = read('app', 'llms.txt', 'route.ts')
    expect(llms).not.toMatch(/starting packages are listed/)
    expect(llms).toMatch(/every mobile party is quoted/)
  })
})
