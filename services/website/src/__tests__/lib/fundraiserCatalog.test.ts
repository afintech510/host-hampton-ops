/**
 * The server's copy of the ESM Sharks price list, and the paper-order pricing
 * built on it. The first block is the DRIFT test: the list exists twice (the
 * page's JSX and `lib/fundraiserCatalog.ts`), so it is read off the page source
 * and compared — a price changed in one place only is the bug this catches.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  ESM_COLORS, ESM_PATCHES, ESM_PRODUCTS, looseKey, priceEsmPaperOrder, variantKey, variantName,
} from '@/lib/fundraiserCatalog'
import { patchPriceCents } from '@/lib/fundraiserPatches'

const page = readFileSync(join(__dirname, '../../app/esm-sharks/page.tsx'), 'utf8')

describe('catalogue agrees with /esm-sharks', () => {
  it.each(ESM_PRODUCTS)('$key: title, price and cost match the page', p => {
    const block = page.match(new RegExp(String.raw`key: '${p.key}',[\s\S]*?title: '([^']+)',\s*price: (\d+),[\s\S]*?cost: ([\d.]+),`))
    expect(block).not.toBeNull()
    expect(block![1]).toBe(p.title)
    expect(Number(block![2]) * 100).toBe(p.priceCents)
    expect(Math.round(Number(block![3]) * 100)).toBe(p.costCents)
  })

  it('has the same colours and patch designs, in the same order', () => {
    const colors = [...page.matchAll(/\{ key: '(navy|silver)', label: '([^']+)'/g)].map(m => [m[1], m[2]])
    expect(colors).toEqual(ESM_COLORS.map(c => [c.key, c.label]))
    const patches = [...page.matchAll(/\{ key: '(circle|script)', label: '([^']+)'/g)].map(m => [m[1], m[2]])
    expect(patches).toEqual(ESM_PATCHES.map(c => [c.key, c.label]))
  })

  it('names a line exactly as the page does (em dash included)', () => {
    expect(page).toContain('`${c.label} ${p.title} — ${patch.name}`')
    expect(variantName(ESM_PRODUCTS[1], ESM_COLORS[0], ESM_PATCHES[0])).toBe('Navy Canvas Tote — Circle Patch')
  })
})

describe('priceEsmPaperOrder', () => {
  it('prices a mixed order and derives cost', () => {
    const r = priceEsmPaperOrder({ [variantKey('tote', 'navy', 'circle')]: 1, [variantKey('hat', 'silver', 'script')]: 2 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.totalCents).toBe(4000 + 2 * 2500)
    expect(r.costCents).toBe(3000 + 2 * 1875)
    expect(r.lines.map(l => l.name)).toEqual(['Silver Trucker Hat — Script Patch', 'Navy Canvas Tote — Circle Patch'])
  })

  it('mixes loose patches across designs into one tiered line', () => {
    const r = priceEsmPaperOrder({ [looseKey('circle')]: 2, [looseKey('script')]: 1 })
    expect(r.ok && r.totalCents).toBe(2000)
    expect(r.ok && r.lines).toHaveLength(1)
    expect(r.ok && r.lines[0].name).toBe('Patches (2x Circle, 1x Script)')
    const five = priceEsmPaperOrder({ [looseKey('circle')]: 3, [looseKey('script')]: 2 })
    expect(five.ok && five.totalCents).toBe(patchPriceCents(5))
    expect(five.ok && five.totalCents).toBe(3200)
  })

  it('refuses an unknown item rather than dropping it', () => {
    const r = priceEsmPaperOrder({ 'hat-navy-circle': 1, 'sock-navy-circle': 2 })
    expect(r.ok).toBe(false)
  })

  it.each([-1, 1.5, 51, 'abc'])('refuses quantity %p', bad => {
    expect(priceEsmPaperOrder({ 'hat-navy-circle': bad }).ok).toBe(false)
  })

  it('refuses an empty order and non-objects', () => {
    expect(priceEsmPaperOrder({}).ok).toBe(false)
    expect(priceEsmPaperOrder({ 'hat-navy-circle': 0 }).ok).toBe(false)
    expect(priceEsmPaperOrder(null).ok).toBe(false)
    expect(priceEsmPaperOrder([1]).ok).toBe(false)
  })
})
