/**
 * Auto-shrink a text slot to its box (spec §2 `fit.ts`, §6).
 *
 * `fitFontSize` returns the largest whole-pixel size in `[minSize, size]` at
 * which `text` is no wider than `maxWidth`, measured from the bundled `.woff`
 * advance widths (kerning on) plus letter-spacing. That is the same measure the
 * P01 spike used (`scripts/evite-spike/render.mjs` `measure`/`fit`), so the
 * sizes it picks are the ones the spike's mock was checked with.
 *
 * Letter-spacing is `letterSpacingEm * size` per character, counting EVERY
 * character including the last. Satori omits the trailing space, so this errs
 * a hair wide, never narrow: a name is never allowed to overflow its box.
 *
 * If even `minSize` is too wide the answer is `{ size: minSize, fits: false }`:
 * the caller decides (clip, or refuse to render) - this function never invents
 * a size below the floor the template author set.
 *
 * Width is exactly linear in the size (font units scale, nothing is hinted), so
 * the answer is found from one measurement and then verified, rather than by
 * stepping down 160 times. Memoised, bounded.
 */

import { loadFont, type FontKey } from '@/lib/evites/glyphs'

export interface FitInput {
  text: string
  font: FontKey
  /** The size the template wants. */
  size: number
  /** The smallest the template allows. */
  minSize: number
  maxWidth: number
  /** CSS `letter-spacing` in em (0.04 = 4%). Default 0. */
  letterSpacingEm?: number
  /** Measure the upper-cased text (the slot has `text-transform: uppercase`). */
  uppercase?: boolean
}

export interface FitResult {
  /** Whole pixels, within `[minSize, size]`. */
  size: number
  /** Measured width at `size`, in px. */
  width: number
  /** False when even `minSize` overflows `maxWidth`. */
  fits: boolean
}

const MEMO_MAX = 500
const memo = new Map<string, FitResult>()

function widthAt(font: FontKey, text: string, size: number, letterSpacingEm: number): number {
  const advance = loadFont(font).getAdvanceWidth(text, size, { kerning: true })
  return advance + letterSpacingEm * size * Array.from(text).length
}

export function fitFontSize(input: FitInput): FitResult {
  const letterSpacingEm = input.letterSpacingEm ?? 0
  const text = input.uppercase ? input.text.toLocaleUpperCase('en-US') : input.text
  const max = Math.floor(input.size)
  const min = Math.min(Math.floor(input.minSize), max)

  const key = [input.font, max, min, input.maxWidth, letterSpacingEm, text].join('\u0001')
  const hit = memo.get(key)
  if (hit) return hit

  let result: FitResult
  if (text === '') {
    result = { size: max, width: 0, fits: true }
  } else {
    // Linear in size: measure once at a large reference size, then correct by stepping.
    const perPx = widthAt(input.font, text, 1000, letterSpacingEm) / 1000
    let size = perPx > 0 ? Math.floor(input.maxWidth / perPx) : max
    size = Math.max(min, Math.min(max, size))
    while (size < max && widthAt(input.font, text, size + 1, letterSpacingEm) <= input.maxWidth) size++
    while (size > min && widthAt(input.font, text, size, letterSpacingEm) > input.maxWidth) size--
    const width = widthAt(input.font, text, size, letterSpacingEm)
    result = { size, width, fits: width <= input.maxWidth }
  }

  if (memo.size >= MEMO_MAX) memo.clear()
  memo.set(key, result)
  return result
}
