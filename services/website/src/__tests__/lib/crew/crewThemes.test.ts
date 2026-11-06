/**
 * The crew app's looks (`lib/crew/themes.ts`): every theme is complete, every
 * text/background pair a theme draws is readable, an unknown cookie is the
 * default, and no crew screen paints a colour of its own, which is the only
 * way a theme could leave a piece of the app behind.
 */
import fs from 'fs'
import path from 'path'
import { DEFAULT_THEME, THEMES, THEME_IDS, themeCss, themeFromCookie } from '@/lib/crew/themes'

const SRC = path.join(process.cwd(), 'src')

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('the theme list', () => {
  it('offers several, with unique ids, and the default is one of them', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(4)
    expect(new Set(THEME_IDS).size).toBe(THEMES.length)
    expect(THEME_IDS).toContain(DEFAULT_THEME)
  })

  it('defines the same complete set of tokens for every theme', () => {
    const keys = Object.keys(THEMES[0].tokens).sort()
    expect(keys.length).toBeGreaterThanOrEqual(26)
    for (const t of THEMES) {
      expect(Object.keys(t.tokens).sort()).toEqual(keys)
      for (const [k, v] of Object.entries(t.tokens)) expect(`${t.id}.${k}=${v}`).toMatch(/=\S/)
    }
  })

  it('emits one rule per theme for the app and one for the page behind it', () => {
    const css = themeCss()
    for (const t of THEMES) {
      expect(css).toContain(`.crew-root[data-theme="${t.id}"]{`)
      expect(css).toContain(`body:has(.crew-root[data-theme="${t.id}"]){background:${t.tokens.bg} !important}`)
    }
    expect(css).not.toMatch(/undefined|\[object/)
  })
})

describe('readability: no theme draws text a person cannot read', () => {
  const PAIRS: [string, string, string, number][] = [
    ['text on the page', 'text', 'bg', 4.5],
    ['text on a card', 'text', 'surface', 4.5],
    ['muted text on a card', 'muted', 'surface', 4.5],
    ['muted text on the page', 'muted', 'bg', 4.5],
    ['button text', 'onAccent', 'accent', 4.5],
    ['button text on hover', 'onAccent', 'accentHover', 4.5],
    ['the active tab', 'accentInk', 'accentSoft', 4.5],
    ['a link on a card', 'accent', 'surface', 3],
    ['"saved" notes', 'okInk', 'ok', 4.5],
    ['warnings', 'warnInk', 'warn', 4.5],
    ['errors', 'alertInk', 'alert', 4.5],
    ['information', 'infoInk', 'info', 4.5],
    ['the gold chip', 'goldInk', 'gold', 4.5],
    ['the dark banner', 'rateInk', 'rate', 4.5],
    ['a link on the dark banner', 'rateLink', 'rate', 3],
    ['errors written inline on a card', 'alertInk', 'surface', 4.5],
  ]
  for (const t of THEMES) {
    it(`${t.id}`, () => {
      const bad = PAIRS
        .map(([what, fg, bg, min]) => ({ what, ratio: contrast((t.tokens as unknown as Record<string, string>)[fg], (t.tokens as unknown as Record<string, string>)[bg]), min }))
        .filter(p => p.ratio < p.min)
        .map(p => `${p.what}: ${p.ratio.toFixed(2)} < ${p.min}`)
      expect(bad).toEqual([])
    })
  }
})

describe('the cookie', () => {
  it('a known id is itself', () => {
    for (const id of THEME_IDS) expect(themeFromCookie(id)).toBe(id)
  })
  it('anything else is the default — never an error, never echoed into the page', () => {
    for (const v of [undefined, null, '', 'neon', 'CLEAN', 'clean;x', '"><script>', 'constructor', '__proto__']) {
      expect(themeFromCookie(v as string | undefined)).toBe(DEFAULT_THEME)
    }
  })
})

describe('no crew screen paints a colour of its own', () => {
  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name)
      return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) ? [p] : []
    })
  }
  it('has no hex colour outside the layout stylesheet (the picker swatches read the theme tokens)', () => {
    const files = walk(path.join(SRC, 'app', 'crew'))
    const offenders: string[] = []
    for (const f of files) {
      if (f.endsWith(`${path.sep}layout.tsx`)) continue
      const m = fs.readFileSync(f, 'utf8').match(/#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b(?![0-9A-Fa-f])/g)
      if (m) offenders.push(`${path.relative(SRC, f)}: ${m.join(', ')}`)
    }
    expect(files.length).toBeGreaterThanOrEqual(25)
    expect(offenders).toEqual([])
  })

  it('the layout stylesheet reads colours only from theme variables', () => {
    const src = fs.readFileSync(path.join(SRC, 'app', 'crew', 'layout.tsx'), 'utf8')
    const css = src.slice(src.indexOf('const CSS = `'), src.indexOf('`\n\nexport default'))
    expect(css.length).toBeGreaterThan(3000)
    // The one hex allowed outside a variable is the shadow of the modal, which is black at an opacity; none else.
    const stray = (css.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? [])
    expect(stray).toEqual([])
  })
})
