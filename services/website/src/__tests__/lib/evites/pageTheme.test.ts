import {
  DEFAULT_PAGE_COLOR,
  PAGE_COLORS,
  PAGE_MOTIONS,
  isPageColor,
  isPageMotion,
  pageColorOf,
  pageMotionOf,
  pageThemeCss,
} from '@/lib/evites/pageTheme'

/** The look of the public invitation page (migration 097): a static palette, never a stored value in CSS. */

describe('the palette', () => {
  it('has unique, well-formed keys and the default is one of them', () => {
    const keys = PAGE_COLORS.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of keys) expect(k).toMatch(/^[a-z]{3,20}$/) // the migration's CHECK shape
    expect(keys).toContain(DEFAULT_PAGE_COLOR)
  })

  it('every colour is a hex background, a glow and a swatch the white page text can sit on', () => {
    for (const c of PAGE_COLORS) {
      expect(c.bg).toMatch(/^#[0-9a-f]{6}$/)
      expect(c.swatch).toMatch(/^#[0-9a-f]{6}$/)
      expect(c.glow).toMatch(/^rgba\(\d{1,3},\d{1,3},\d{1,3},\.\d+\)$/)
      const n = parseInt(c.bg.slice(1), 16)
      const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
      expect(lum).toBeLessThan(0.35) // dark enough for white text
      expect(isPageColor(c.key)).toBe(true)
    }
  })
})

describe('unknown values read as the defaults', () => {
  it.each([null, undefined, '', 'nope', 7, {}, '__proto__', 'MIDNIGHT'])('colour %j -> the default', (v) => {
    expect(pageColorOf(v).key).toBe(DEFAULT_PAGE_COLOR)
    expect(isPageColor(v)).toBe(false)
  })
  it.each([null, undefined, '', 'blink', 3, 'SPARKLE'])('motion %j -> none', (v) => {
    expect(pageMotionOf(v)).toBe('none')
    expect(isPageMotion(v)).toBe(false)
  })
  it('known motions round-trip', () => {
    for (const m of PAGE_MOTIONS) expect(pageMotionOf(m)).toBe(m)
  })
})

describe('pageThemeCss', () => {
  it('is a static string: a hostile stored value cannot reach it', () => {
    const hostile = '}</style><script>alert(1)</script>{'
    for (const v of [hostile, 'red;background:url(x)', "' onload='x"]) {
      const css = pageThemeCss(v, v)
      expect(css).toBe(pageThemeCss(null, null))
      expect(css).not.toContain('<')
      expect(css).not.toContain('alert')
    }
  })

  it('a colour sets the root background and the picture glow', () => {
    for (const c of PAGE_COLORS) {
      const css = pageThemeCss(c.key, 'none')
      expect(css).toContain(`.hh-inv-root{background:${c.bg}}`)
      expect(css).toContain(c.glow)
    }
  })

  it('the default colour is the purple the page has always been', () => {
    expect(pageThemeCss(null, null)).toContain('#1b0630')
  })

  it('"none" draws no fx layer and no animation', () => {
    const css = pageThemeCss('navy', 'none')
    expect(css).not.toContain('.hh-inv-fx')
    expect(css).not.toContain('@keyframes')
  })

  it.each(['sparkle', 'drift'])('%s has a fx layer that ignores the pointer and a reduced-motion rule', (m) => {
    const css = pageThemeCss('navy', m)
    expect(css).toContain('.hh-inv-fx{')
    expect(css).toContain('pointer-events:none')
    expect(css).toContain('@keyframes')
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  })
})
