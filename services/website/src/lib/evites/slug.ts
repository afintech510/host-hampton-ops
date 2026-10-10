/**
 * Invitation slugs (spec §2 `slug.ts`, §1 CHECK).
 *
 *   mia-glow-7kq2     <name>-<theme>-<4 random base32 characters>
 *
 * The slug is the only thing between the public and a child's name on a web
 * page, so the random suffix uses `crypto.randomInt` (never Math.random) and
 * the alphabet drops the four characters that get misread when a link is typed
 * from a screenshot: i, l, o, u.
 *
 * `SLUG_REGEX` is byte-identical to the CHECK in migration 068; a test reads
 * the SQL and compares the two. Change both or neither.
 */

import { randomInt } from 'crypto'

/** Crockford-style base32 without i, l, o, u. */
export const SLUG_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
export const SLUG_SUFFIX_LENGTH = 4

/** The migration's `char_length(slug) BETWEEN 9 AND 48`. */
export const SLUG_MIN_LENGTH = 9
export const SLUG_MAX_LENGTH = 48

/** Name and theme parts are each capped here (themes also fit `theme_word` <= 12). */
export const SLUG_NAME_MAX = 12
export const SLUG_THEME_MAX = 12

/** Used when there is no usable first name (or no usable theme). */
export const SLUG_FALLBACK_NAME = 'party'

/** The shape half of the migration CHECK. Keep identical to the SQL. */
export const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*-[0-9a-hjkmnp-tv-z]{4}$/

/** Does `s` satisfy BOTH halves of the migration CHECK (shape and length)? */
export function isSlugShape(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    s.length >= SLUG_MIN_LENGTH &&
    s.length <= SLUG_MAX_LENGTH &&
    SLUG_REGEX.test(s)
  )
}

/**
 * First whitespace-separated token, NFKD-decomposed, combining marks removed,
 * ASCII `[a-z0-9]` only, lowercase. `"Zoë-Ann  Smith"` -> `"zoeann"`.
 * Returns '' when nothing usable survives (an emoji-only or non-Latin name).
 */
function asciiToken(input: string | null | undefined): string {
  if (typeof input !== 'string') return ''
  const first = input.trim().split(/\s+/)[0] ?? ''
  return first
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** The name part a slug minted for `firstName` would carry (`party` when none). */
export function slugNameFor(firstName: string | null | undefined): string {
  const t = asciiToken(firstName).slice(0, SLUG_NAME_MAX)
  return t === '' ? SLUG_FALLBACK_NAME : t
}

function randomSuffix(): string {
  let out = ''
  for (let i = 0; i < SLUG_SUFFIX_LENGTH; i++) {
    out += SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)]
  }
  return out
}

/**
 * Mint a slug. Always returns something that satisfies the migration CHECK:
 * the name part is 1..12 chars, the theme part 1..12, and if the two together
 * are too short to reach the 9-character floor (a one-letter name and a
 * one-letter theme) the theme part falls back to `party`.
 */
export function makeSlug(firstName: string | null | undefined, themeShort: string | null | undefined): string {
  const name = slugNameFor(firstName)
  let theme = asciiToken(themeShort).slice(0, SLUG_THEME_MAX)
  if (theme === '' || `${name}-${theme}`.length < SLUG_MIN_LENGTH - SLUG_SUFFIX_LENGTH - 1) {
    theme = SLUG_FALLBACK_NAME
  }
  return `${name}-${theme}-${randomSuffix()}`
}

/**
 * The name part of an existing slug (everything before the first hyphen), or
 * null when `slug` is not slug-shaped. The name part never contains a hyphen.
 */
export function slugNamePart(slug: string): string | null {
  if (!isSlugShape(slug)) return null
  return slug.split('-')[0]
}
