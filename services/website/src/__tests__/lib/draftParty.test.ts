import fs from 'fs'
import path from 'path'
import {
  DRAFT_PACKAGES, DRAFT_PARTY_SLUG, DRAFT_PARTY_SOURCE_PAGE, DRAFT_MAX_GUESTS, DRAFT_HAS_BIG_SCREEN,
  draftFaqs, draftUsd, perManager,
} from '@/lib/draftParty'
import { MAX_DESCRIPTION_CHARS, MAX_TITLE_CHARS, TITLE_SUFFIX } from '@/lib/seo'

const SRC = path.join(process.cwd(), 'src')
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8')

describe('draft night offer', () => {
  it('formats the per-manager figure from the flat price', () => {
    const [room, pkg] = DRAFT_PACKAGES
    expect(perManager(room, 12)).toBe(draftUsd(Math.round(room.priceCents / 12 / 100) * 100))
    // 14 teams on the package: two extra people on top of the 12 it covers.
    const fourteen = pkg.priceCents + (14 - pkg.includesGuests) * pkg.extraGuestCents
    expect(perManager(pkg, 14)).toBe(draftUsd(Math.round(fourteen / 14 / 100) * 100))
  })

  it('never covers more people than the room is set up for', () => {
    for (const p of DRAFT_PACKAGES) expect(p.includesGuests).toBeLessThanOrEqual(DRAFT_MAX_GUESTS)
  })

  it('every FAQ answer that names a package price uses the real one', () => {
    const text = draftFaqs().map(f => f.a).join('\n')
    for (const p of DRAFT_PACKAGES) expect(text).toContain(draftUsd(p.priceCents))
  })

  it('does not promise a screen the room does not have', () => {
    const text = draftFaqs().map(f => f.a).join('\n')
    if (!DRAFT_HAS_BIG_SCREEN) expect(text).not.toMatch(/plug a laptop into the TV/i)
  })

  it('never advertises BYOB — NY ABC Law §64-b, the room seats more than 19', () => {
    const page = read('app', DRAFT_PARTY_SLUG, 'page.tsx')
    const lib = read('lib', 'draftParty.ts')
    const llms = read('app', 'llms.txt', 'route.ts')
    for (const src of [page, lib, llms]) expect(src).not.toMatch(/\bBYOB\b|bring your own (beer|booze|alcohol)/i)
  })
})

describe('draft night page is wired into the site', () => {
  it('fits the title and description budget', () => {
    const page = read('app', DRAFT_PARTY_SLUG, 'page.tsx')
    const title = page.match(/^\s*title: '([^']+)'/m)?.[1]
    expect(title).toBeDefined()
    expect((title! + TITLE_SUFFIX).length).toBeLessThanOrEqual(MAX_TITLE_CHARS)
    // The description template, with the one interpolation at its real width.
    const desc = page.match(/description:\s*`([^`]+)`/)?.[1]
    expect(desc).toBeDefined()
    const rendered = desc!.replace(/\$\{draftUsd\(ROOM\.priceCents\)\}/, draftUsd(DRAFT_PACKAGES[0].priceCents))
    expect(rendered).not.toContain('${')
    expect(rendered.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS)
  })

  it('is in the sitemap, llms.txt and the footer', () => {
    expect(read('app', 'sitemap.xml', 'route.ts')).toContain(`'/${DRAFT_PARTY_SLUG}'`)
    expect(read('app', 'llms.txt', 'route.ts')).toContain('DRAFT_PARTY_SLUG')
    expect(read('components', 'Footer.tsx')).toContain(`/${DRAFT_PARTY_SLUG}`)
  })

  it('the lead route treats a draft night as a room rental', () => {
    const route = read('app', 'api', 'lead', 'route.ts')
    expect(route).toMatch(/sourcePage === DRAFT_PARTY_SOURCE_PAGE/)
    expect(DRAFT_PARTY_SOURCE_PAGE).toBe(DRAFT_PARTY_SLUG)
  })

  it('publishes no price in structured data (prices live in visible text)', () => {
    const page = read('app', DRAFT_PARTY_SLUG, 'page.tsx')
    expect(page).not.toMatch(/^\s*offers:/m)
    expect(page).not.toMatch(/priceCurrency/)
  })
})
