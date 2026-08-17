/**
 * Locale-prefix parsing for the DB-driven content renderer (app/[...slug]).
 *
 * Pure, framework-free helpers so they can be unit-tested without importing the
 * server component (which carries JSX). English keeps a bare slug
 * (/party-room-rental); Spanish is served under an /es/ path prefix
 * (/es/party-room-rental).
 */

export const BASE_URL = 'https://www.hosthampton.com'

// First path segments we must never serve from the DB, even if a row exists.
// Static routes already win by Next precedence; this covers reserved words with
// no static page. Checked AFTER stripping an `es/` locale prefix.
export const RESERVED_PREFIXES = new Set([
  'admin', 'api', 'book', '_next', 'static',
  'robots.txt', 'sitemap.xml', 'favicon.ico',
])

export type Locale = 'en' | 'es'

export interface ParsedSlug {
  locale: Locale
  slug: string
  reserved: boolean
}

/**
 * Split a catch-all path into (locale, base slug). A leading `es` segment maps
 * to Spanish; the remaining segments are the real slug. `reserved` is true when
 * the base slug is empty (e.g. bare `/es`) or its first segment is blocklisted.
 */
export function parseLocaleSlug(rawSlug: string): ParsedSlug {
  let segments = rawSlug.split('/').filter(Boolean)
  let locale: Locale = 'en'
  if (segments[0] === 'es') {
    locale = 'es'
    segments = segments.slice(1)
  }
  const slug = segments.join('/')
  const reserved = segments.length === 0 || RESERVED_PREFIXES.has(segments[0])
  return { locale, slug, reserved }
}

/** Canonical URL for a (slug, locale) pair. */
export function localeUrl(slug: string, locale: Locale): string {
  return locale === 'es' ? `${BASE_URL}/es/${slug}` : `${BASE_URL}/${slug}`
}
