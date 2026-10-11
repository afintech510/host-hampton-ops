import fs from 'fs'
import path from 'path'
import {
  CUSTOMIZED_FOR_THEME,
  HOSTED_THEME_GROUPS,
  PARTY_THEMES_META,
  allHostedThemes,
  buildPartyThemesFaqs,
} from '@/lib/hostedThemes'
import { FALLBACK_CATALOG } from '@/lib/pricingCatalog'
import { MAX_DESCRIPTION_CHARS, MAX_TITLE_CHARS, TITLE_SUFFIX } from '@/lib/seo'

/**
 * /party-themes — the themes we have hosted. Its copy is also on
 * /party-packages and in /llms.txt, so these pin what it may and may not say:
 * no typed price, no licensing claim, no dead internal link, and a cost answer
 * that only ever states the figure it was handed.
 */

const SRC = path.join(process.cwd(), 'src')
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8')

/** Every string the module publishes. */
function publishedText(): string[] {
  const out: string[] = [PARTY_THEMES_META.title, PARTY_THEMES_META.description]
  for (const g of HOSTED_THEME_GROUPS) {
    out.push(g.title, g.blurb)
    for (const t of g.themes) out.push(t.name, t.tagline ?? '', t.note ?? '')
  }
  for (const c of CUSTOMIZED_FOR_THEME) out.push(c.title, c.desc)
  for (const f of buildPartyThemesFaqs(null, FALLBACK_CATALOG.guestRules)) out.push(f.q, f.a)
  return out
}

describe('the hosted theme list', () => {
  it('has groups, each with themes, and no theme twice', () => {
    expect(HOSTED_THEME_GROUPS.length).toBeGreaterThanOrEqual(4)
    for (const g of HOSTED_THEME_GROUPS) expect(g.themes.length).toBeGreaterThan(0)
    const names = allHostedThemes().map(t => t.name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
  })

  it('every internal link lands on a page that exists', () => {
    const hrefs = allHostedThemes().map(t => t.href).filter((h): h is string => !!h)
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) {
      expect(fs.existsSync(path.join(SRC, 'app', href, 'page.tsx'))).toBe(true)
    }
  })

  it('types no price — the only figure comes from the charged row', () => {
    for (const s of publishedText()) expect(s).not.toMatch(/\$\s*\d/)
  })

  it('never claims a theme is official or licensed, except to say it is not', () => {
    for (const s of publishedText()) {
      if (/\b(official|licensed)\b/i.test(s)) expect(s).toMatch(/not official or licensed/)
    }
  })

  it('fits the search snippet budget once the brand suffix is appended', () => {
    expect((PARTY_THEMES_META.title + TITLE_SUFFIX).length).toBeLessThanOrEqual(MAX_TITLE_CHARS)
    expect(PARTY_THEMES_META.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS)
  })
})

describe('buildPartyThemesFaqs', () => {
  const rules = FALLBACK_CATALOG.guestRules

  it('omits the cost answer when the price could not be read', () => {
    const faqs = buildPartyThemesFaqs(null, rules)
    expect(faqs.some(f => /cost|how much/i.test(f.q))).toBe(false)
  })

  it('states exactly the figure it was handed, never another', () => {
    const faqs = buildPartyThemesFaqs(123400, rules)
    const cost = faqs.find(f => /how much/i.test(f.q))!
    expect(cost.a).toContain('$1,234 for 2 hours')
    expect(cost.a).toContain(`${rules.includedGuests} kids`)
  })

  it('names every hosted theme in the "what themes" answer', () => {
    const a = buildPartyThemesFaqs(null, rules).find(f => /what party themes/i.test(f.q))!.a
    for (const t of allHostedThemes()) expect(a).toContain(t.name)
  })

  it('puts no mobile figure anywhere — at-home pricing is pointed at', () => {
    const faqs = buildPartyThemesFaqs(95000, rules)
    const atHouse = faqs.find(f => /at my house/i.test(f.q))!
    expect(atHouse.a).not.toMatch(/\$\s*\d/)
    // The one priced answer is the STUDIO answer, and says so.
    const priced = faqs.filter(f => /\$\s*\d/.test(f.a))
    expect(priced).toHaveLength(1)
    expect(priced[0].a).toMatch(/^At our private studio in Speonk/)
  })
})

describe('wiring', () => {
  it('the page renders per request, so the live reads are not prerendered away', () => {
    expect(read('app/party-themes/page.tsx')).toMatch(/export const dynamic = 'force-dynamic'/)
  })

  it('is in the XML sitemap, the HTML sitemap and /llms.txt', () => {
    expect(read('app/sitemap.xml/route.ts')).toContain("path: '/party-themes'")
    expect(read('app/sitemap/page.tsx')).toContain("href: '/party-themes'")
    const llms = read('app/llms.txt/route.ts')
    expect(llms).toContain('HOSTED_THEME_GROUPS')
    expect(llms).toContain('/party-themes')
  })

  it('/party-packages links to it and is handed the list by its server page', () => {
    expect(read('app/party-packages/PartyPackagesContent.tsx')).toContain('href="/party-themes"')
    expect(read('app/party-packages/page.tsx')).toContain('allHostedThemes()')
  })
})
