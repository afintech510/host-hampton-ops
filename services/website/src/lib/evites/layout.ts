/**
 * The sizing pass (spec §2 `fit.ts`, §5 step 3, §6): which font size does every
 * auto-shrinking slot get for THESE facts? Server-side, because it measures with
 * the bundled `.woff` files through `fit.ts` (opentype.js + fs). The answer is a
 * plain `Record<slotId, px>`, which is what `InviteCanvas` takes as `sizes`, so
 * the canvas itself stays client-safe.
 *
 * What is measured is exactly what is drawn: both go through `slotText()`.
 *
 * A single text slot with a `maxWidth` shrinks from `size` toward `minSize`. A
 * ROW (honoree + star, age + "Birthday!") shrinks as a unit: every text child
 * scales by the same factor and an image child's width scales with them, so the
 * star stays in proportion to a shrunken "BIRTHDAY STAR" (spec §3: "the name slot
 * auto-shrinks to fit it").
 *
 * `minSize` is the designer's floor. A name that cannot fit even at the floor
 * would overflow a 1085 px canvas (a 20-character first name in a wide face), and
 * a clipped child's name is worse than a small one, so the last resort goes to
 * `HARD_FLOOR`. `fit.ts` never invents a size below the floor it is handed; this
 * module is the one that decides to hand it a lower one.
 *
 * The OG card has its own handful of strings and sizes (`ogTexts`, `ogSizes`).
 */

import { screenForImage } from '@/lib/evites/glyphs'
import { fitFontSize } from '@/lib/evites/fit'
import type { FontKey } from '@/lib/evites/glyphs'
import type { InviteFacts } from '@/lib/evites/facts'
import { showWhenOk, slotText } from '@/lib/evites/templates/slotText'
import type { InviteSizes, RowSlot, TemplateLayout, TextSlot } from '@/lib/evites/templates/types'

/** Below this a slot is unreadable on a phone; the sizing pass never goes lower. */
export const HARD_FLOOR = 36

/** Width of `text` at exactly `size` px for a slot's font (kerning on, letter-spacing included). */
function widthAt(font: FontKey, letterSpacingEm: number | undefined, text: string, size: number): number {
  return fitFontSize({ text, font, size, minSize: size, maxWidth: Number.POSITIVE_INFINITY, letterSpacingEm }).width
}

function fitSingle(slot: TextSlot, text: string): number {
  if (slot.maxWidth === undefined) return slot.size
  const floor = slot.minSize ?? slot.size
  const base = { text, font: slot.font, size: slot.size, maxWidth: slot.maxWidth, letterSpacingEm: slot.letterSpacingEm }
  const first = fitFontSize({ ...base, minSize: floor })
  if (first.fits) return first.size
  return fitFontSize({ ...base, minSize: Math.min(floor, HARD_FLOOR) }).size
}

function fitRow(row: RowSlot, facts: InviteFacts): InviteSizes {
  const kids = row.children.filter((c) => showWhenOk(c.showWhen, facts))
  const out: InviteSizes = {}
  const texts = kids.flatMap((c) => (c.type === 'text' ? [{ slot: c, text: slotText(c, facts) }] : [])).filter((t) => t.text !== '')
  const images = kids.flatMap((c) => (c.type === 'image' ? [c] : []))
  if (texts.length === 0 && images.length === 0) return out

  const gaps = Math.max(0, texts.length + images.length - 1) * row.gap
  const refSize = texts.length > 0 ? texts[0].slot.size : 0

  // Total width of the row at the reference text size `ref` (every other child scales by ref / refSize).
  const totalAt = (ref: number): number => {
    const k = refSize > 0 ? ref / refSize : 1
    let w = gaps
    for (const t of texts) w += widthAt(t.slot.font, t.slot.letterSpacingEm, t.text, Math.max(1, Math.floor(t.slot.size * k)))
    for (const im of images) w += Math.round(im.width * k)
    return w
  }

  // A row whose first text is already small ("YOU'RE INVITED TO MIA'S" at 33 px) may still need to
  // shrink: its floor is HARD_FLOOR or half its own size, whichever is lower, never "it cannot move".
  const floor = Math.min(HARD_FLOOR, Math.floor(refSize / 2))
  let ref = refSize
  if (refSize > 0) {
    ref = refSize
    while (ref > floor && totalAt(ref) > row.maxWidth) ref -= 1
  }
  const k = refSize > 0 ? ref / refSize : 1
  for (const t of texts) out[t.slot.id] = Math.max(1, Math.floor(t.slot.size * k))
  for (const im of images) out[im.id] = Math.round(im.width * k)
  return out
}

/** Font sizes (and a row image's width) for every auto-sizing slot of `template` under `facts`. */
export function computeSizes(template: TemplateLayout, facts: InviteFacts): InviteSizes {
  const sizes: InviteSizes = {}
  for (const slot of template.slots) {
    if (slot.type === 'text') {
      if (!showWhenOk(slot.showWhen, facts)) continue
      const text = slotText(slot, facts)
      if (text !== '') sizes[slot.id] = fitSingle(slot, text)
    } else if (slot.type === 'row') {
      if (!showWhenOk(slot.showWhen, facts)) continue
      Object.assign(sizes, fitRow(slot, facts))
    }
  }
  return sizes
}

// ---------------------------------------------------------------- the OG card

/** The OG card's column, in px: 1200 - 2 * 64 padding - 397 portrait - 56 gap. */
export const OG_COLUMN_WIDTH = 619
export const OG_WIDTH = 1200
export const OG_HEIGHT = 630
export const OG_TITLE_MIN = 36

export interface OgTexts {
  kicker: string
  /** `<NAME>'S <THEME> PARTY`, or `<THEME> BIRTHDAY PARTY` with no name (spec v1.1 B1). */
  title: string
  /** `shortDateLine`. */
  date: string
  /** `cardPlaceLine`. */
  place: string
  /** "Questions? Ask Allie . 631-998-9325", or null when the host line is switched off. */
  host: string | null
}

export interface OgSizes {
  title: number
  date: number
  place: number
  host: number
}

export const OG_KICKER = "YOU'RE INVITED"

export function ogTexts(facts: InviteFacts, template?: TemplateLayout): OgTexts {
  // facts.title is "Mia's Glow Party" / "Glow Birthday Party" / "Birthday Party": the same words as the
  // spec's two OG formulas, and right for a generic theme too (no "BIRTHDAY BIRTHDAY PARTY").
  // Capitals in Bungee for Glow; as typed in a script face (Sleep Under's Lobster), screened for THAT font.
  const spec = template?.ogCard
  const titleFont = spec?.titleFont ?? 'bungee'
  const titleText = spec?.titleUppercase === false ? facts.title : facts.title.toLocaleUpperCase('en-US')
  const title = screenForImage(titleText, titleFont)
  const host = facts.hostContactLine ? screenForImage(facts.hostContactLine.replace(/^Any questions\?/, 'Questions?'), 'poppins400') : null
  return {
    kicker: OG_KICKER,
    title,
    date: screenForImage(facts.shortDateLine, 'poppins400'),
    place: screenForImage(facts.cardPlaceLine, 'poppins400'),
    host,
  }
}

function lineCount(words: string[], measure: (s: string) => number, maxWidth: number): number {
  let lines = 1
  let cur = ''
  for (const w of words) {
    const next = cur === '' ? w : `${cur} ${w}`
    if (cur !== '' && measure(next) > maxWidth) {
      lines += 1
      cur = w
    } else cur = next
  }
  return lines
}

/** The largest title size (down to OG_TITLE_MIN) whose longest word fits the column and that wraps in at most two lines, else three. */
export function ogTitleSize(title: string, template: TemplateLayout): number {
  const spec = template.ogCard
  const words = title.split(' ').filter((w) => w !== '')
  const measure = (size: number) => (s: string) => widthAt(spec.titleFont, undefined, s, size)
  for (const maxLines of [2, 3]) {
    for (let size = spec.titleSize; size >= OG_TITLE_MIN; size--) {
      const m = measure(size)
      if (words.every((w) => m(w) <= OG_COLUMN_WIDTH) && lineCount(words, m, OG_COLUMN_WIDTH) <= maxLines) return size
    }
  }
  return OG_TITLE_MIN
}

function lineSize(font: 'poppins400', text: string, size: number): number {
  return fitFontSize({ text, font, size, minSize: 16, maxWidth: OG_COLUMN_WIDTH }).size
}

export function ogSizes(texts: OgTexts, template: TemplateLayout): OgSizes {
  return {
    title: ogTitleSize(texts.title, template),
    date: lineSize('poppins400', texts.date, 30),
    place: lineSize('poppins400', texts.place, 30),
    host: texts.host ? lineSize('poppins400', texts.host, 24) : 24,
  }
}
