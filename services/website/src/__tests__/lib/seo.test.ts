import fs from 'fs'
import path from 'path'
import {
  OG_DEFAULTS,
  OG_DEFAULT_IMAGE,
  NOINDEX,
  SITE_URL,
  BUSINESS_ID,
  ORGANIZATION_ID,
  businessRef,
  carriesPublishedPrice,
  MAX_TITLE_CHARS,
  MAX_DESCRIPTION_CHARS,
  TITLE_SUFFIX,
} from '@/lib/seo'
import { LOCATIONS, townMeta } from '@/lib/locations'
import { CRAFT_PARTIES } from '@/lib/craftParties'

const APP_DIR = path.join(process.cwd(), 'src', 'app')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (entry.name === 'page.tsx' || entry.name === 'layout.tsx') out.push(p)
  }
  return out
}

/** Byte spans of every `openGraph: { … }` object literal in a source file. */
function openGraphBlocks(src: string): string[] {
  const out: string[] = []
  const re = /openGraph:\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    let i = re.lastIndex
    let depth = 1
    while (i < src.length && depth) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      i++
    }
    out.push(src.slice(m.index, i))
  }
  return out
}

const SOURCES = walk(APP_DIR).map(p => ({ p, rel: path.relative(process.cwd(), p), src: fs.readFileSync(p, 'utf8') }))

describe('constants', () => {
  it('OG_DEFAULTS carries a share card', () => {
    expect(OG_DEFAULTS.images[0].url).toBe(OG_DEFAULT_IMAGE.url)
    expect(OG_DEFAULT_IMAGE.width).toBe(1200)
    expect(OG_DEFAULT_IMAGE.height).toBe(630)
  })

  it('NOINDEX actually says no', () => {
    expect(NOINDEX.index).toBe(false)
    expect(NOINDEX.googleBot.index).toBe(false)
  })

  it('the two @ids are distinct and absolute', () => {
    expect(BUSINESS_ID).not.toBe(ORGANIZATION_ID)
    for (const id of [BUSINESS_ID, ORGANIZATION_ID]) expect(id.startsWith(SITE_URL)).toBe(true)
  })

  it('businessRef points at the business node', () => {
    expect(businessRef()['@id']).toBe(BUSINESS_ID)
  })
})

/**
 * THE TRIPWIRE. Next.js merges metadata SHALLOWLY: a page that exports its own
 * `openGraph` replaces the root layout's entire object, `images` included. That
 * is how 40 of 69 live URLs — /book, /faq, /studio-rental, /mobile-party and
 * every town page — ended up with no og:image and a blank share card.
 *
 * Any new page that declares `openGraph` must either spread OG_DEFAULTS or set
 * `images` itself. This test is the only thing standing between that rule and
 * the next person who copies an existing metadata block.
 */
describe('every page-level openGraph block keeps a share image', () => {
  it('spreads OG_DEFAULTS or sets images explicitly', () => {
    const offenders: string[] = []
    for (const { rel, src } of SOURCES) {
      for (const block of openGraphBlocks(src)) {
        if (!block.includes('OG_DEFAULTS') && !block.includes('images')) offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('the private and internal routes say noindex', () => {
  // A robots.txt Disallow is NOT a substitute: a disallowed URL is never
  // fetched, so the directive is never read, and the bare URL can still be
  // listed from an inbound link.
  const MUST_NOINDEX = [
    'admin/layout.tsx',
    'my-booking/layout.tsx',
    'plan/layout.tsx',
    'review/layout.tsx',
    'checkin/layout.tsx',
    'book/success/page.tsx',
    'events/success/page.tsx',
    'gift-cards/success/page.tsx',
    'kids-party-menu/success/layout.tsx',
    'kids-party-menu/summary/page.tsx',
    'vendor-registration/success/layout.tsx',
    'boggle/layout.tsx',
    'li-high/layout.tsx',
    'cora/page.tsx',
  ]

  it.each(MUST_NOINDEX)('%s is noindex', rel => {
    const full = path.join(APP_DIR, rel)
    expect(fs.existsSync(full)).toBe(true)
    const src = fs.readFileSync(full, 'utf8')
    expect(src.includes('NOINDEX') || /robots:\s*'noindex/.test(src)).toBe(true)
  })

  it('signup-sheet keeps its pre-existing noindex', () => {
    const src = fs.readFileSync(path.join(APP_DIR, 'signup-sheet', 'layout.tsx'), 'utf8')
    expect(src).toMatch(/noindex/)
  })
})

describe('the consolidated content moves are PERMANENT redirects', () => {
  // A 307 keeps the old URL in the index competing with the new one and
  // transfers nothing. These moves are permanent, so the status says so.
  it.each(['classes/page.tsx', 'party-add-ons/page.tsx'])('%s uses permanentRedirect', rel => {
    const src = fs.readFileSync(path.join(APP_DIR, rel), 'utf8')
    expect(src).toContain('permanentRedirect')
    expect(src).not.toMatch(/[^t]redirect\(/)
  })
})

describe('title and description length budget', () => {
  // Google truncates a title at roughly 60 characters and a description at
  // about 160. Past those, the part of the snippet that carries the offer is
  // never shown.
  it.each(LOCATIONS.map(l => [l.slug, l] as const))('town page %s fits', (_slug, loc) => {
    const { title, description } = townMeta(loc)
    // These use `title: { absolute }`, so the brand suffix is NOT appended.
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_CHARS)
    expect(description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS)
  })

  it.each(CRAFT_PARTIES.map(c => [c.slug, c] as const))('craft page %s fits', (_slug, c) => {
    // metaTitle is also `absolute` and carries its own '| Host Hampton'.
    expect(c.metaTitle.length).toBeLessThanOrEqual(MAX_TITLE_CHARS)
    expect(c.metaDescription.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS)
  })

  it('the brand suffix is what the root layout template appends', () => {
    const layout = fs.readFileSync(path.join(APP_DIR, 'layout.tsx'), 'utf8')
    expect(layout).toContain(`%s${TITLE_SUFFIX}`)
  })

  it('no craft title double-brands', () => {
    for (const c of CRAFT_PARTIES) {
      expect(c.metaTitle.split('Host Hampton').length - 1).toBeLessThanOrEqual(1)
    }
  })
})

/**
 * `website_content.structured.jsonLd` is rendered verbatim into a ld+json
 * script by app/[...slug]/page.tsx, and `website_content` is written by the
 * COPY agent and the weekly town-drafts cron. Hard-won rule 5: a field is
 * hostile because of who can WRITE it, not which block it prints in. A model
 * that emits an `offers.price` would be publishing an invented figure to
 * Google — and on a town page it would be a mobile price, which is Adam's
 * alone (plan §15).
 */
describe('carriesPublishedPrice', () => {
  it.each([
    ['a bare price', { '@type': 'Offer', price: '850' }],
    ['a nested offer', { '@type': 'Service', offers: { '@type': 'Offer', price: 1 } }],
    ['an AggregateOffer', { '@type': 'AggregateOffer', lowPrice: '35', highPrice: '45' }],
    ['only a currency', { '@type': 'Offer', priceCurrency: 'USD' }],
    ['a priceSpecification', { priceSpecification: { minPrice: 100 } }],
    ['a differently-cased key', { '@type': 'Offer', Price: '850' }],
    ['one entry in an array', [{ '@type': 'FAQPage' }, { '@type': 'Offer', price: '1' }]],
    ['buried five deep', { a: { b: { c: { d: { offers: {} } } } } }],
    // A depth cap would have been a bypass, not a guard: nest the price one
    // level past the limit and it sails through. There is no depth cap.
    ['buried twenty deep', Array.from({ length: 20 }).reduce<Record<string, unknown>>(
      acc => ({ nested: acc }), { price: '850' })],
  ])('catches %s', (_label, node) => {
    expect(carriesPublishedPrice(node)).toBe(true)
  })

  it.each([
    ['a FAQPage', { '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'How much?' }] }],
    ['a LocalBusiness with a priceRange band', { '@type': 'LocalBusiness', priceRange: '$$' }],
    ['a bare string', 'Offer'],
    ['null', null],
    ['an empty array', []],
  ])('leaves %s alone', (_label, node) => {
    expect(carriesPublishedPrice(node)).toBe(false)
  })

  it('does not blow the stack on a cyclic object', () => {
    const a: Record<string, unknown> = {}
    a.self = a
    expect(() => carriesPublishedPrice(a)).not.toThrow()
  })

  it('mentions the guard in the renderer that has to use it', () => {
    const src = fs.readFileSync(path.join(APP_DIR, '[...slug]', 'page.tsx'), 'utf8')
    expect(src).toContain('carriesPublishedPrice')
    // Rule 10: a guardrail that stops something must SAY that it stopped it.
    expect(src).toMatch(/console\.(warn|error)/)
  })
})

describe('no JSON-LD in the app tree publishes a mobile-party price', () => {
  // plan §15 / the mobile-pricing-rework memory: the mobile numbers are Adam's
  // and are mid-rework. A structured-data price is a price we publish, so none
  // of the mobile surfaces may carry one.
  const MOBILE_PAGES = [
    'mobile-party/page.tsx',
    'mobile-craft-party/page.tsx',
    path.join('mobile-craft-party', '[location]', 'page.tsx'),
  ]

  it.each(MOBILE_PAGES)('%s declares no offers/price in its schema', rel => {
    const src = fs.readFileSync(path.join(APP_DIR, rel), 'utf8')
    expect(src).not.toMatch(/^\s*offers:/m)
    expect(src).not.toMatch(/priceCurrency/)
  })

  it('CraftPartyLanding, which renders the mobile craft pages, has none either', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'CraftPartyLanding.tsx'), 'utf8')
    expect(src).not.toMatch(/^\s*offers:/m)
    expect(src).not.toMatch(/priceCurrency/)
  })
})
