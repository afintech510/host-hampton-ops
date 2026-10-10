import {
  SLUG_ALPHABET,
  SLUG_REGEX,
  SLUG_MIN_LENGTH,
  SLUG_MAX_LENGTH,
  makeSlug,
  slugNamePart,
  slugNameFor,
  isSlugShape,
} from '@/lib/evites/slug'

describe('evites/slug', () => {
  it('the alphabet is 32 characters and excludes i, l, o, u', () => {
    expect(SLUG_ALPHABET).toHaveLength(32)
    expect(new Set(SLUG_ALPHABET).size).toBe(32)
    for (const c of 'ilou') expect(SLUG_ALPHABET).not.toContain(c)
    expect(SLUG_ALPHABET).toMatch(/^[0-9a-z]+$/)
  })

  it('the regex accepts exactly the alphabet in the suffix (every excluded letter is refused)', () => {
    for (const c of SLUG_ALPHABET) expect(SLUG_REGEX.test(`mia-glow-abc${c}`)).toBe(true)
    for (const c of 'ilou') expect(SLUG_REGEX.test(`mia-glow-abc${c}`)).toBe(false)
  })

  it('produces <name>-<theme>-<4 chars> in the expected shape', () => {
    const s = makeSlug('Mia', 'glow')
    expect(s).toMatch(/^mia-glow-[0-9a-hjkmnp-tv-z]{4}$/)
    expect(isSlugShape(s)).toBe(true)
  })

  it('normalises names: NFKD, marks stripped, first token only, [a-z0-9] only', () => {
    expect(slugNameFor('Zoë-Ann  Smith')).toBe('zoeann')
    expect(makeSlug('Zoë-Ann  Smith', 'glow')).toMatch(/^zoeann-glow-/)
    expect(slugNameFor('  José  ')).toBe('jose')
    expect(slugNameFor("O'Brien Jr")).toBe('obrien')
    expect(slugNameFor('ＭＩＡ')).toBe('mia') // fullwidth letters fold to ASCII under NFKD
    expect(slugNameFor('Ava2')).toBe('ava2')
  })

  it('null, empty, whitespace and unusable names become "party"', () => {
    expect(slugNameFor(null)).toBe('party')
    expect(slugNameFor(undefined)).toBe('party')
    expect(slugNameFor('')).toBe('party')
    expect(slugNameFor('   ')).toBe('party')
    expect(slugNameFor('🎉')).toBe('party')
    expect(slugNameFor('李')).toBe('party')
    expect(makeSlug(null, 'glow')).toMatch(/^party-glow-/)
  })

  it('caps the name at 12 characters', () => {
    expect(slugNameFor('Abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghijkl')
  })

  it('applies the same normalisation to the theme part', () => {
    expect(makeSlug('Mia', 'Glôw')).toMatch(/^mia-glow-/)
    expect(makeSlug('Mia', 'Glow Party')).toMatch(/^mia-glow-/) // first token
    expect(makeSlug('Mia', null)).toMatch(/^mia-party-/)
    expect(makeSlug('Mia', '!!!')).toMatch(/^mia-party-/)
  })

  it('edge: one-character name and one-character theme still reach the 9-character floor', () => {
    const s = makeSlug('A', 'x')
    expect(s).toMatch(/^a-party-/)
    expect(s.length).toBeGreaterThanOrEqual(SLUG_MIN_LENGTH)
    expect(isSlugShape(s)).toBe(true)
  })

  it('edge: one-character name with a two-character theme is exactly 9', () => {
    const s = makeSlug('A', 'xy')
    expect(s).toMatch(/^a-xy-/)
    expect(s).toHaveLength(9)
    expect(isSlugShape(s)).toBe(true)
  })

  it('edge: a 12-character name with a long theme stays within 48 and is slug-shaped', () => {
    const s = makeSlug('Abcdefghijklmnop', 'Supercalifragilisticexpialidocious')
    expect(s.startsWith('abcdefghijkl-supercalifra-')).toBe(true)
    expect(s.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH)
    expect(s).toHaveLength(12 + 1 + 12 + 1 + 4)
    expect(isSlugShape(s)).toBe(true)
  })

  it('1,000 generated slugs all match the migration regex and length bounds', () => {
    const names = ['Mia', 'Zoë-Ann Smith', null, 'A', '李', 'Abcdefghijklmnop', "O'Brien", '🎉', 'Ava2']
    const themes = ['glow', 'x', null, 'Supercalifragilisticexpialidocious', '', 'Glôw Party']
    for (let i = 0; i < 1000; i++) {
      const s = makeSlug(names[i % names.length], themes[i % themes.length])
      expect(SLUG_REGEX.test(s)).toBe(true)
      expect(s.length).toBeGreaterThanOrEqual(SLUG_MIN_LENGTH)
      expect(s.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH)
    }
  })

  it('the random suffix actually varies', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) seen.add(makeSlug('Mia', 'glow'))
    expect(seen.size).toBeGreaterThan(190)
  })

  it('slugNamePart reads the name back, and refuses non-slugs', () => {
    expect(slugNamePart('mia-glow-7kq2')).toBe('mia')
    expect(slugNamePart(makeSlug('Zoë-Ann', 'glow'))).toBe('zoeann')
    expect(slugNamePart(makeSlug(null, 'glow'))).toBe('party')
    expect(slugNamePart('not a slug')).toBeNull()
    expect(slugNamePart('mia-glow-7kqi')).toBeNull() // i is not in the alphabet
  })

  it('isSlugShape enforces the length floor and ceiling as well as the regex', () => {
    expect(isSlugShape('a-b-7kq2')).toBe(false) // regex-valid, 8 chars
    expect(isSlugShape('a-bc-7kq2')).toBe(true)
    expect(isSlugShape('a'.repeat(44) + '-7kq2')).toBe(false) // 49
    expect(isSlugShape('MIA-glow-7kq2')).toBe(false)
    expect(isSlugShape(null)).toBe(false)
    expect(isSlugShape(42)).toBe(false)
  })
})
