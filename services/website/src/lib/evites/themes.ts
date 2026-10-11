/**
 * Which theme a booking is, and what the invitation says about it
 * (spec §2 `themes.ts`).
 *
 *   resolveTheme(booking, lineItems, partyThemes) -> ResolvedTheme
 *
 * PURE: the caller reads `booking_line_items` and `party_themes` (see
 * `readThemeInputs` in themeInputs.ts) and passes the rows in.
 *
 * A booking has no theme column (review 01 s1.2). It lives in four places, tried
 * in this order, first hit wins:
 *
 *   1. a theme line item's `pricing_item_id` -> `party_themes.pricing_item_id`
 *      (category `theme`; migration 062 linked the two tables by that column).
 *   2. a normalised, whole-word name match of `party_themes` over, in order:
 *      `package_type`, `quote_snapshot.themeName`, `party_tags.theme`,
 *      `party_tags.party_theme`, then (not in the spec, added because it is the
 *      same evidence one hop later) the theme line item's own `name`.
 *   3. nothing matched: the `plain` template, with a theme word drawn from the
 *      first usable name above, else `BIRTHDAY`.
 *
 * Two themes have artwork of their own: `glow-party` is the `glow` template and
 * `sleep-under-party` the `sleepunder` one (`THEME_TEMPLATES`). Every other theme
 * (and every unmatched one) is `plain` = Glow art with no icon strip and its own
 * theme word.
 *
 * Theme WORD rules (`theme_word` is `char_length BETWEEN 1 AND 12` in the
 * database): drop the filler words (party, theme, package, birthday, custom,
 * mobile, mini...), upper-case, and if that is over 12 characters fall back to
 * the first word, and failing that to `BIRTHDAY`. "Sweets & Treats" is `SWEETS`.
 * `themeSub` is always `PARTY`. An admin override (`evites.theme_word` /
 * `theme_sub`) is applied in facts.ts, not here.
 */

import type { EviteBookingRow, EviteLineItemRow, PartyThemeRow } from '@/lib/evites/types'
import type { TemplateSlug } from '@/lib/evites/templates/types'

export type EviteTemplateSlug = TemplateSlug

/** `party_themes.slug` -> the template drawn with that theme's own artwork. Anything absent is `plain`. */
export const THEME_TEMPLATES: Readonly<Record<string, EviteTemplateSlug>> = {
  'glow-party': 'glow',
  'sleep-under-party': 'sleepunder',
}

export const GENERIC_THEME_WORD = 'BIRTHDAY'
export const DEFAULT_THEME_SUB = 'PARTY'
export const THEME_WORD_MAX = 12

export interface ResolvedTheme {
  /** `party_themes.slug` (e.g. `glow-party`), or null when no catalogue row matched. */
  partyThemeSlug: string | null
  templateSlug: EviteTemplateSlug
  /** Upper-case, 1..12 characters. */
  themeWord: string
  themeSub: string
  /** Title-case word for sentences ("Glow"), or '' when the theme is generic. */
  label: string
  /** Lower-case slug-safe form for `makeSlug` ("glow", "swiftie", "birthday"). */
  short: string
  source: 'line_item' | 'name' | 'fallback'
}

type ThemeBooking = Pick<EviteBookingRow, 'package_type' | 'quote_snapshot' | 'party_tags'>

const FILLER = new Set([
  'party', 'parties', 'theme', 'themed', 'package', 'packages', 'birthday', 'bday', 'custom',
  'mobile', 'mini', 'studio', 'kids', 'kid', 'celebration', 'rental', 'and', 'the', 'a',
])

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** U+0300..U+036F, built from numbers so no escape sequence has to survive an editor. */
const COMBINING_MARKS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g')

/** Lower-case, accents folded, everything but letters and digits becomes a space. */
function norm(s: string): string {
  return s
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function wordsOf(s: string): string[] {
  return norm(s).split(' ').filter((w) => w !== '')
}

/** The words of a name that say what the theme IS ("Swiftie Party" -> ["swiftie"]). */
function contentWords(s: string): string[] {
  return wordsOf(s).filter((w) => !FILLER.has(w))
}

/** Upper-case theme word of at most 12 characters, or BIRTHDAY. */
function themeWordFrom(name: string): string {
  const words = contentWords(name)
  if (words.length === 0) return GENERIC_THEME_WORD
  // Keep the hyphen of "K-Pop": only a join of single letters ("k pop") needs it.
  const joined = words.join(' ').toUpperCase()
  const kpop = joined.replace(/^([A-Z]) ([A-Z]+)$/, '$1-$2')
  if (kpop.length <= THEME_WORD_MAX) return kpop
  const first = words[0].toUpperCase()
  return first.length <= THEME_WORD_MAX ? first : GENERIC_THEME_WORD
}

/** "GLOW" -> "Glow", "K-POP" -> "K-Pop", generic -> ''. */
export function themeLabelOf(themeWord: string): string {
  if (themeWord === GENERIC_THEME_WORD || themeWord.trim() === '') return ''
  return themeWord
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase())
}

/** Slug-safe lower-case form of a theme word. */
export function themeShortOf(themeWord: string): string {
  const s = themeWord.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, THEME_WORD_MAX)
  return s === '' ? 'party' : s
}

function build(partyThemeSlug: string | null, word: string, source: ResolvedTheme['source']): ResolvedTheme {
  return {
    partyThemeSlug,
    templateSlug:
      partyThemeSlug !== null && Object.prototype.hasOwnProperty.call(THEME_TEMPLATES, partyThemeSlug) ? THEME_TEMPLATES[partyThemeSlug] : 'plain',
    themeWord: word,
    themeSub: DEFAULT_THEME_SUB,
    label: themeLabelOf(word),
    short: themeShortOf(word),
    source,
  }
}

/** The theme line items: category `theme` (the planner's name for it) or `party-theme` (the catalogue's). */
function themeLineItems(lineItems: readonly EviteLineItemRow[]): EviteLineItemRow[] {
  return lineItems.filter((li) => {
    const c = typeof li.category === 'string' ? li.category.trim().toLowerCase() : ''
    return c === 'theme' || c === 'party-theme'
  })
}

/** Match keys for one catalogue row: its name and its slug, minus the filler words, as space-joined words. */
function keysOf(t: PartyThemeRow): string[] {
  const keys = new Set<string>()
  const a = contentWords(t.name).join(' ')
  const b = contentWords(t.slug.replace(/-/g, ' ')).join(' ')
  if (a !== '') keys.add(a)
  if (b !== '') keys.add(b)
  return Array.from(keys)
}

/** Whole-word containment of `key` ("k pop") in `text` ("k pop demon hunter party"). */
function containsWords(text: string, key: string): boolean {
  return ` ${text} `.includes(` ${key} `)
}

function matchByName(text: string, themes: readonly PartyThemeRow[]): PartyThemeRow | null {
  const t = norm(text)
  if (t === '') return null
  let best: { row: PartyThemeRow; len: number } | null = null
  for (const row of themes) {
    for (const key of keysOf(row)) {
      // "kpop" (slug) must also match "k pop" (name) and the reverse: compare the
      // key with its spaces closed up against the candidate's words as well.
      const closed = key.replace(/ /g, '')
      const hit = containsWords(t, key) || (closed !== key && containsWords(t, closed)) || (t.indexOf(' ') > -1 && t.replace(/ /g, '') === closed)
      if (hit && (!best || key.length > best.len)) best = { row, len: key.length }
    }
  }
  return best ? best.row : null
}

export function resolveTheme(
  booking: ThemeBooking,
  lineItems: readonly EviteLineItemRow[],
  partyThemes: readonly PartyThemeRow[],
): ResolvedTheme {
  const themes = partyThemes ?? []
  const items = themeLineItems(lineItems ?? [])

  // 1. line-item pricing_item_id -> party_themes.pricing_item_id
  for (const li of items) {
    if (typeof li.pricing_item_id !== 'string' || li.pricing_item_id === '') continue
    const row = themes.find((t) => t.pricing_item_id === li.pricing_item_id)
    if (row) return build(row.slug, themeWordFrom(row.name), 'line_item')
  }

  // 2. name evidence, in the spec's order, then the theme line item's own name
  const snap = obj(booking.quote_snapshot)
  const tags = obj(booking.party_tags)
  const texts: string[] = []
  for (const v of [booking.package_type, snap.themeName, tags.theme, tags.party_theme]) {
    if (typeof v === 'string' && v.trim() !== '') texts.push(v)
  }
  // Only a line item tied to the catalogue: "Additional Guests" is also category `theme`.
  for (const li of items) {
    if (li.pricing_item_id && typeof li.name === 'string' && li.name.trim() !== '') texts.push(li.name)
  }

  for (const text of texts) {
    const row = matchByName(text, themes)
    if (row) return build(row.slug, themeWordFrom(row.name), 'name')
  }

  // 3. unmatched: a word from the first text that has any content, else BIRTHDAY
  for (const text of texts) {
    const word = themeWordFrom(text)
    if (word !== GENERIC_THEME_WORD) return build(null, word, 'fallback')
  }
  return build(null, GENERIC_THEME_WORD, 'fallback')
}
