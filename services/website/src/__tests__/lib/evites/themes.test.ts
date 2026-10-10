import { resolveTheme, themeLabelOf, themeShortOf } from '@/lib/evites/themes'
import type { PartyThemeRow } from '@/lib/evites/types'

const T = (name: string, slug: string, pricing_item_id: string | null = null): PartyThemeRow => ({
  id: `id-${slug}`,
  name,
  slug,
  pricing_item_id,
})

// The nine live slugs (review 01 s1.2). Names are as the catalogue spells them; pricing_item_id is arbitrary here.
const THEMES: PartyThemeRow[] = [
  T('Glow Party', 'glow-party', 'pi-glow'),
  T('Swiftie Party', 'swiftie-party', 'pi-swift'),
  T('Spa Party', 'spa-party', 'pi-spa'),
  T('Slime Party', 'slime-party', 'pi-slime'),
  T('K-Pop Party', 'kpop-party', 'pi-kpop'),
  T('Barbie Party', 'barbie-party', 'pi-barbie'),
  T('Sweets & Treats', 'sweets-treats', 'pi-sweets'),
  T('Sleep Under Party', 'sleep-under-party', 'pi-sleep'),
  T('Toddler Party', 'toddler-party', 'pi-toddler'),
]

const bk = (over: Record<string, unknown> = {}) => ({ package_type: null, quote_snapshot: null, party_tags: {}, ...over }) as never
const themeLine = (name: string, pricing_item_id: string | null) => ({ name, category: 'theme', pricing_item_id })

describe('evites/themes - resolveTheme', () => {
  it('a theme line item resolves through party_themes.pricing_item_id', () => {
    const r = resolveTheme(bk(), [themeLine('Glow Party', 'pi-glow')], THEMES)
    expect(r).toMatchObject({ partyThemeSlug: 'glow-party', templateSlug: 'glow', themeWord: 'GLOW', themeSub: 'PARTY', label: 'Glow', short: 'glow', source: 'line_item' })
  })

  it('the line item beats every text field', () => {
    const r = resolveTheme(bk({ package_type: 'Swiftie Party' }), [themeLine('K-Pop Demon Hunter Party', 'pi-kpop')], THEMES)
    expect(r.partyThemeSlug).toBe('kpop-party')
  })

  it('"Additional Guests" is also category theme and must not be read as a theme', () => {
    const r = resolveTheme(bk({ package_type: 'Glow Party' }), [themeLine('Additional Guests', null)], THEMES)
    expect(r.partyThemeSlug).toBe('glow-party')
    expect(r.source).toBe('name')
    // and with nothing else to go on it does not become the theme word either
    expect(resolveTheme(bk(), [themeLine('Additional Guests', null)], THEMES).themeWord).toBe('BIRTHDAY')
  })

  it('a line item of another category with a matching id is ignored', () => {
    const r = resolveTheme(bk(), [{ name: 'Glow Party', category: 'food-add-on', pricing_item_id: 'pi-glow' }], THEMES)
    expect(r.partyThemeSlug).toBeNull()
  })

  it('the catalogue category name "party-theme" counts as a theme line too', () => {
    const r = resolveTheme(bk(), [{ name: 'Spa Party', category: 'party-theme', pricing_item_id: 'pi-spa' }], THEMES)
    expect(r.partyThemeSlug).toBe('spa-party')
  })

  it.each([
    ['Glow Party', 'glow-party'],
    ['glow party ', 'glow-party'],
    ['GLOW', 'glow-party'],
    ['K-Pop Demon Hunter Party', 'kpop-party'],
    ['KPop Party', 'kpop-party'],
    ['Taylor Swiftie Party', 'swiftie-party'],
    ['Sweets & Treats Party', 'sweets-treats'],
    ['Sleep Under Party', 'sleep-under-party'],
    ['Slime Party at the studio', 'slime-party'],
    ['Toddler Party', 'toddler-party'],
  ])('package_type %j matches %s', (pkg, slug) => {
    expect(resolveTheme(bk({ package_type: pkg }), [], THEMES).partyThemeSlug).toBe(slug)
  })

  it('text sources are tried in the spec order: package_type, quote_snapshot.themeName, party_tags.theme, party_tags.party_theme', () => {
    expect(resolveTheme(bk({ package_type: 'Spa Party', quote_snapshot: { themeName: 'Glow Party' } }), [], THEMES).partyThemeSlug).toBe('spa-party')
    expect(resolveTheme(bk({ quote_snapshot: { themeName: 'Glow Party' }, party_tags: { theme: 'Spa Party' } }), [], THEMES).partyThemeSlug).toBe('glow-party')
    expect(resolveTheme(bk({ party_tags: { theme: 'Spa Party', party_theme: 'Glow Party' } }), [], THEMES).partyThemeSlug).toBe('spa-party')
    expect(resolveTheme(bk({ party_tags: { party_theme: 'Barbie Party' } }), [], THEMES).partyThemeSlug).toBe('barbie-party')
  })

  it('a text source that does not match falls through to the next one', () => {
    const r = resolveTheme(bk({ package_type: 'Custom Party Theme', quote_snapshot: { themeName: 'Glow Party' } }), [], THEMES)
    expect(r.partyThemeSlug).toBe('glow-party')
  })

  it('every catalogue theme except glow is the plain template', () => {
    for (const t of THEMES) {
      const r = resolveTheme(bk({ package_type: t.name }), [], THEMES)
      expect(r.partyThemeSlug).toBe(t.slug)
      expect(r.templateSlug).toBe(t.slug === 'glow-party' ? 'glow' : 'plain')
    }
  })

  it('theme words are at most 12 characters, upper-case, and from the catalogue name', () => {
    const words = Object.fromEntries(THEMES.map((t) => [t.slug, resolveTheme(bk({ package_type: t.name }), [], THEMES).themeWord]))
    expect(words).toEqual({
      'glow-party': 'GLOW',
      'swiftie-party': 'SWIFTIE',
      'spa-party': 'SPA',
      'slime-party': 'SLIME',
      'kpop-party': 'K-POP',
      'barbie-party': 'BARBIE',
      'sweets-treats': 'SWEETS', // "SWEETS TREATS" is 13 characters
      'sleep-under-party': 'SLEEP UNDER',
      'toddler-party': 'TODDLER',
    })
    for (const w of Object.values(words)) expect(w.length).toBeLessThanOrEqual(12)
  })

  describe('unmatched: the plain template with a word from the name, else BIRTHDAY', () => {
    it('"Pool party " is POOL', () => {
      const r = resolveTheme(bk({ package_type: 'Pool party ' }), [], THEMES)
      expect(r).toMatchObject({ partyThemeSlug: null, templateSlug: 'plain', themeWord: 'POOL', label: 'Pool', short: 'pool', source: 'fallback' })
    })

    it.each([['Custom Party Theme'], ['Mobile Party Package'], [''], [null], ['Party']])('%j is BIRTHDAY', (pkg) => {
      const r = resolveTheme(bk({ package_type: pkg }), [], THEMES)
      expect(r).toMatchObject({ partyThemeSlug: null, templateSlug: 'plain', themeWord: 'BIRTHDAY', themeSub: 'PARTY', label: '', short: 'birthday' })
    })

    it('a name too long for 12 characters uses its first word, or BIRTHDAY if that is too long too', () => {
      expect(resolveTheme(bk({ package_type: 'Underwater Adventure Party' }), [], THEMES).themeWord).toBe('UNDERWATER')
      expect(resolveTheme(bk({ package_type: 'Supercalifragilistic Party' }), [], THEMES).themeWord).toBe('BIRTHDAY')
    })

    it('no data at all is BIRTHDAY, and an empty catalogue still resolves', () => {
      expect(resolveTheme(bk(), [], []).themeWord).toBe('BIRTHDAY')
      expect(resolveTheme(bk({ package_type: 'Glow Party' }), [], []).themeWord).toBe('GLOW') // fallback word, but...
      expect(resolveTheme(bk({ package_type: 'Glow Party' }), [], []).templateSlug).toBe('plain') // ...no catalogue row, no Glow art
    })

    it('junk in the jsonb columns does not throw', () => {
      expect(() => resolveTheme(bk({ quote_snapshot: 'x', party_tags: [1, 2] }), [], THEMES)).not.toThrow()
      expect(() => resolveTheme(bk({ quote_snapshot: { themeName: 42 }, party_tags: { theme: {} } }), [], THEMES)).not.toThrow()
    })
  })
})

describe('evites/themes - helpers', () => {
  it('themeLabelOf', () => {
    expect(themeLabelOf('GLOW')).toBe('Glow')
    expect(themeLabelOf('K-POP')).toBe('K-Pop')
    expect(themeLabelOf('SLEEP UNDER')).toBe('Sleep Under')
    expect(themeLabelOf('BIRTHDAY')).toBe('')
  })

  it('themeShortOf is slug-safe and never empty', () => {
    expect(themeShortOf('K-POP')).toBe('kpop')
    expect(themeShortOf('SLEEP UNDER')).toBe('sleepunder')
    expect(themeShortOf('!!!')).toBe('party')
  })
})
