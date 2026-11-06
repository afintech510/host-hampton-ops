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

describe('a look is a layout, not just a palette', () => {
  const layout = fs.readFileSync(path.join(SRC, 'app', 'crew', 'layout.tsx'), 'utf8')

  it('every look has its own structural CSS, and every rule in it is scoped to that look', () => {
    const css = themeCss()
    for (const t of THEMES) {
      expect(t.css.trim().length).toBeGreaterThan(200)
      expect(t.css).not.toMatch(/\{\s*\}/)
      const root = `.crew-root[data-theme="${t.id}"]`
      const block = css.split('\n').filter(l => l.startsWith(root) && !l.includes('--c-bg:'))
      expect(block.length).toBe(t.css.trim().split('\n').length)
    }
    expect(css).not.toContain('&')
  })

  it('looks differ in typeface, button shape and module size, not only colour', () => {
    const t = THEMES.map(x => x.tokens)
    expect(new Set(t.map(x => x.fontDisplay)).size).toBe(THEMES.length)
    expect(new Set(t.map(x => x.radiusBtn)).size).toBeGreaterThanOrEqual(3)
    expect(new Set(t.map(x => x.radiusCard)).size).toBeGreaterThanOrEqual(4)
    expect(new Set(t.map(x => x.btnHeight)).size).toBeGreaterThanOrEqual(2)
    expect(new Set(t.map(x => x.h2Transform)).size).toBeGreaterThanOrEqual(2)
  })

  it('looks differ in layout: the tab bar sits in different places and a party is drawn in different shapes', () => {
    const nav = (id: string) => THEMES.find(x => x.id === id)!.css
    // Editorial puts the tabs across the TOP; nothing else does.
    expect(nav('editorial')).toMatch(/\.crew-nav\{position:sticky;top:0;bottom:auto/)
    for (const id of ['bold', 'clean', 'pop', 'midnight']) expect(nav(id)).not.toMatch(/position:sticky/)
    // A floating pill bar vs an edge-to-edge bar.
    expect(nav('clean')).toMatch(/\.crew-nav\{left:14px;right:14px;[^}]*border-radius:999px/)
    expect(nav('pop')).toMatch(/\.crew-nav\{left:14px;right:14px;[^}]*border-radius:999px/)
    expect(nav('bold')).not.toMatch(/left:14px/)
    // A party: a ticket stub, a flat row, a boxed poster tile, a bubble.
    expect(nav('midnight')).toMatch(/border-right:2px dashed/)
    expect(nav('clean')).toMatch(/\.crew-party\{background:transparent;border:0;border-bottom/)
    expect(nav('editorial')).toMatch(/\.crew-party\{background:transparent;border:0;border-top:2px solid/)
    expect(nav('bold')).toMatch(/\.crew-date\{[^}]*box-shadow:3px 3px 0/)
    expect(nav('pop')).toMatch(/\.crew-date\{[^}]*border-radius:22px/)
  })

  it('every look shows the day of the week under the date, and none hides it or makes it small print', () => {
    for (const t of THEMES) {
      expect(t.css).not.toMatch(/\.crew-date-dow[^{]*\{[^}]*display:none/)
      expect(t.tokens.dateTile).toBe('flex')
      // Any size a look gives the weekday is at least 0.72rem.
      for (const m of t.css.matchAll(/\.crew-date-dow\{[^}]*font-size:([\d.]+)rem/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(0.72)
    }
    // The base is a column in reading order: month, day, then weekday.
    const card = fs.readFileSync(path.join(SRC, 'app', 'crew', '_components', 'PartyCard.tsx'), 'utf8')
    expect(card.indexOf('crew-date-mon')).toBeGreaterThan(-1)
    expect(card.indexOf('crew-date-mon')).toBeLessThan(card.indexOf('crew-date-day'))
    expect(card.indexOf('crew-date-day')).toBeLessThan(card.indexOf('crew-date-dow'))
    expect(layout).toMatch(/\.crew-date\{[^}]*flex-direction:column/)
    expect(layout).toMatch(/\.crew-date-dow\{font-size:\.74rem;font-weight:800/)
  })

  it('looks differ in icons: outline icons, emoji, or none', () => {
    const icons = THEMES.map(x => `${x.tokens.navEmoji}/${x.tokens.navLine}`)
    expect(new Set(icons)).toEqual(new Set(['none/inline-block', 'inline-block/none', 'none/none']))
  })

  it('every typeface a look names is loaded by the layout', () => {
    const wanted = new Set<string>()
    for (const t of THEMES) for (const f of [t.tokens.fontDisplay, t.tokens.fontBody]) for (const m of f.matchAll(/--crew-f-[a-z]+/g)) wanted.add(m[0])
    // Space Mono is used by the Midnight stub's own CSS.
    for (const m of themeCss().matchAll(/--crew-f-[a-z]+/g)) wanted.add(m[0])
    expect(wanted.size).toBeGreaterThanOrEqual(8)
    for (const v of wanted) expect(layout).toContain(`variable: '${v}'`)
  })

  it('only the default look\'s typefaces are preloaded', () => {
    const decls = Array.from(layout.matchAll(/const (\w+) = (\w+)\(\{[^}]*variable: '(--crew-f-[a-z]+)'[^}]*\}\)/g))
    expect(decls.length).toBeGreaterThanOrEqual(9)
    const preloaded = decls.filter(d => !/preload: false/.test(d[0])).map(d => d[3]).sort()
    const def = THEMES.find(x => x.id === DEFAULT_THEME)!.tokens
    const defaultFaces = Array.from(new Set([def.fontDisplay, def.fontBody].flatMap(f => Array.from(f.matchAll(/--crew-f-[a-z]+/g)).map(m => m[0])))).sort()
    expect(preloaded).toEqual(defaultFaces)
    expect(DEFAULT_THEME).toBe('pop')
  })

  it('an old cookie from before the redesign falls back to the default', () => {
    for (const old of ['classic', 'ocean', 'warm']) expect(themeFromCookie(old)).toBe(DEFAULT_THEME)
  })
})
