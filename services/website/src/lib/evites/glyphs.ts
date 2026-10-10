/**
 * Bundled fonts, and what they can draw (spec §2 `glyphs.ts`, §3, §5).
 *
 * Every string that is bound into a rendered image has to be drawn by one of
 * five bundled latin-subset `.woff` files. A character a font lacks does not
 * throw: Satori draws a notdef box or falls back to a network font loader, and
 * the first is a visible defect on a child's birthday card. So every
 * image-bound string passes `screenForImage()` for its slot's font first.
 *
 *   fitsFont(text, key)        does the font's cmap cover every character?
 *   screenForImage(text, key)  keep what the font has; otherwise fold it to the
 *                              nearest ASCII (Ł -> L, ’ -> '), else drop it.
 *
 * Folding is PER CHARACTER and tries the character as typed first. A blanket
 * NFKD up front would turn `é` (which these fonts have) into `e` + a combining
 * mark (which they do not) and lose the accent for no reason. Characters that
 * NFKD cannot decompose (Ł, Ø, Đ, ß, Æ, Œ, Þ...) have an explicit fold table.
 * Emoji, variation selectors, zero-width joiners and anything else unmapped are
 * dropped: "no emoji in image text, ever" (spec §3).
 *
 * Fonts live in `public/evites/fonts/` and are read from `process.cwd()`. Next
 * runs with cwd = the app root in dev, in jest, and in the standalone server
 * (`services/website/Dockerfile` copies `public/` into the runtime image), so
 * the same path works everywhere. Loads are memoised: a font is read and
 * parsed once per process.
 *
 * The only impurity in lib/evites is the file read below.
 */

import fs from 'fs'
import path from 'path'
import { parse, type Font } from 'opentype.js'

/** The spike's keys (`scripts/evite-spike/render.mjs` FONT_FILES). */
export type FontKey = 'monoton' | 'bungee' | 'neon' | 'poppins400' | 'poppins600'

export const FONT_KEYS: readonly FontKey[] = ['monoton', 'bungee', 'neon', 'poppins400', 'poppins600']

export const FONT_FILES: Record<FontKey, { family: string; weight: 400 | 600; file: string }> = {
  monoton: { family: 'Monoton', weight: 400, file: 'monoton-latin-400-normal.woff' },
  bungee: { family: 'Bungee Outline', weight: 400, file: 'bungee-outline-latin-400-normal.woff' },
  neon: { family: 'Neonderthaw', weight: 400, file: 'neonderthaw-latin-400-normal.woff' },
  poppins400: { family: 'Poppins', weight: 400, file: 'poppins-latin-400-normal.woff' },
  poppins600: { family: 'Poppins', weight: 600, file: 'poppins-latin-600-normal.woff' },
}

/** Where the `.woff` files are, resolved at call time. */
export function fontDir(): string {
  return path.join(process.cwd(), 'public', 'evites', 'fonts')
}

const fontCache = new Map<FontKey, Font>()

/** Read and parse a bundled font once. Throws if the file is missing (a deploy defect, not a runtime condition). */
export function loadFont(key: FontKey): Font {
  const hit = fontCache.get(key)
  if (hit) return hit
  const spec = FONT_FILES[key]
  if (!spec) throw new Error(`evites/glyphs: unknown font key "${String(key)}"`)
  const buf = fs.readFileSync(path.join(fontDir(), spec.file))
  const font = parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
  fontCache.set(key, font)
  return font
}

/** Code-point ranges that are never drawn, whatever a cmap says: C0/C1 controls, zero-width and bidi format characters, variation selectors, BOM. */
const UNDRAWN: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f], [0x007f, 0x009f], [0x200b, 0x200f], [0x2028, 0x202e],
  [0x2060, 0x206f], [0xfe00, 0xfe0f], [0xfeff, 0xfeff],
]

function supports(font: Font, ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0
  for (const [lo, hi] of UNDRAWN) if (cp >= lo && cp <= hi) return false
  return font.charToGlyphIndex(ch) > 0
}

/** True when the font has a glyph for every character of `text`. */
export function fitsFont(text: string, key: FontKey): boolean {
  const font = loadFont(key)
  for (const ch of text) if (!supports(font, ch)) return false
  return true
}

/** Build a code point -> replacement map from [codePoint, replacement] pairs (keeps this file pure ASCII). */
function table(pairs: ReadonlyArray<readonly [number, string]>): Record<string, string> {
  const t: Record<string, string> = {}
  for (const [cp, to] of pairs) t[String.fromCodePoint(cp)] = to
  return t
}

/** Letters NFKD leaves whole: L-stroke, O-stroke, D-stroke, eth, H-stroke, dotless i, kra, eng, T-stroke, sharp s, AE, OE, thorn. */
const FOLD = table([
  [0x141, 'L'], [0x142, 'l'], [0xd8, 'O'], [0xf8, 'o'], [0x110, 'D'], [0x111, 'd'], [0xd0, 'D'], [0xf0, 'd'],
  [0x126, 'H'], [0x127, 'h'], [0x131, 'i'], [0x138, 'k'], [0x14a, 'N'], [0x14b, 'n'], [0x166, 'T'], [0x167, 't'],
  [0xdf, 'ss'], [0x1e9e, 'SS'], [0xc6, 'AE'], [0xe6, 'ae'], [0x152, 'OE'], [0x153, 'oe'], [0xde, 'Th'], [0xfe, 'th'],
])

/** Common typography the fonts may lack, as plain ASCII: curly quotes, dashes, ellipsis, middle dot and bullets. */
const PUNCT = table([
  [0x2018, "'"], [0x2019, "'"], [0x201a, "'"], [0x201b, "'"], [0x2032, "'"],
  [0x201c, '"'], [0x201d, '"'], [0x201e, '"'], [0x201f, '"'], [0x2033, '"'],
  [0x2010, '-'], [0x2011, '-'], [0x2012, '-'], [0x2013, '-'], [0x2014, '-'], [0x2015, '-'], [0x2212, '-'],
  [0x2026, '...'],
  [0xb7, '-'], [0x2022, '-'], [0x2027, '-'], [0x22c5, '-'],
])

/** Combining diacritical marks, removed after NFKD. */
function stripMarks(s: string): string {
  let out = ''
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp >= 0x300 && cp <= 0x36f) continue
    out += ch
  }
  return out
}

function allSupported(font: Font, s: string): boolean {
  for (const ch of s) if (!supports(font, ch)) return false
  return true
}

/** Fold one character to ASCII-ish text the font can draw, or '' if there is no way. */
function foldChar(font: Font, ch: string): string {
  const candidates: string[] = []
  if (FOLD[ch]) candidates.push(FOLD[ch])
  const stripped = stripMarks(ch.normalize('NFKD'))
  if (stripped !== '' && stripped !== ch) {
    candidates.push(stripped)
    // A compatibility form may itself land on punctuation (a fullwidth quote).
    candidates.push(Array.from(stripped).map((c) => PUNCT[c] ?? c).join(''))
  }
  if (PUNCT[ch]) candidates.push(PUNCT[ch])
  for (const c of candidates) if (c !== '' && allSupported(font, c)) return c
  return ''
}

/**
 * The string to hand to the renderer for a slot drawn in `key`: every character
 * the font has is kept as typed, every other one is folded to the nearest ASCII
 * the font has, and what cannot be folded is dropped. Whitespace runs collapse
 * to one space and the ends are trimmed (a dropped emoji must not leave a
 * double space in a name).
 */
export function screenForImage(text: string, key: FontKey): string {
  if (typeof text !== 'string' || text === '') return ''
  const font = loadFont(key)
  let out = ''
  for (const ch of text.normalize('NFC')) {
    if (/\s/.test(ch)) {
      out += ' '
      continue
    }
    out += supports(font, ch) ? ch : foldChar(font, ch)
  }
  return out.replace(/\s+/g, ' ').trim()
}
