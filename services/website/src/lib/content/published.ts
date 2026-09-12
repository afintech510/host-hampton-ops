/**
 * The read half of the agent content pipeline: COPY → `website_content` →
 * **cache** → published page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A CACHE AND NOT `force-dynamic`, AND WHY THE CACHE IS HERE AND
 * NOT ON THE ROUTE.
 *
 * `app/[...slug]/page.tsx` was `export const dynamic = 'force-dynamic'`, which
 * means **two Supabase round-trips per visitor** (the row, then the hreflang
 * locales) on a marketing landing page whose content changes a few times a
 * year. Phase 3C asks for ISR, and caching is right — but route-level
 * `revalidate` on THIS route is not, for two reasons.
 *
 * **First, it does not work.** Setting `export const revalidate = 60` on the
 * catch-all and rebuilding leaves it `ƒ (Dynamic)` in the build table, not `●`:
 * `lib/supabase.ts` puts `cache: 'no-store'` on every Supabase fetch, and a
 * no-store fetch opts its route out of static rendering. This was measured, not
 * reasoned about — rule 8, do not trust a stated guarantee.
 *
 * **Second, the key space is unbounded.** `[...slug]` is the last route Next
 * tries, so it is also the site's de-facto 404 handler: every scanner probing
 * `/wp-login.php`, `/.env`, `/vendor/…` lands here. Each distinct path would
 * become its own on-disk ISR entry, keyed by a URL an attacker chooses. (It is
 * also why the present code is worse than it looks: today every one of those
 * probes costs a DB query.)
 *
 * So the cache is at the DATA layer, in two stages, which bounds the key space
 * by construction:
 *
 *   1. `loadPublishedIndex()` — ONE cache entry for the whole table: every
 *      published (slug, locale) pair. A path that is not in it is a 404 with
 *      no per-path cache entry and no DB query at all.
 *   2. `loadPublishedRow()` — one cache entry per row that really exists.
 *
 * The index also replaces the second query outright: hreflang alternates are
 * "which locales are published for this slug", which the index already knows.
 *
 * Freshness is by TAG, not by clock. `revalidateContent()` is called from the
 * one place that changes a row's status (`/api/admin/marketing/content`), so an
 * approve → publish is live immediately rather than up to an hour later. The
 * `revalidate` seconds below are a SAFETY NET for a write path that forgets to
 * call it, not the mechanism — a content fix nobody sees is not a fix.
 *
 * Rule 12: a lookup that can fail needs THREE outcomes. `absent` (no such
 * published page → 404, which tells Google the URL is gone) and `unavailable`
 * (we could not read → 500, which tells Google to come back) are different
 * facts and the caller must not collapse them. The previous code's
 * `catch { return null }` turned a Supabase blip into "this page does not
 * exist" on every published page at once.
 */

import { unstable_cache, revalidateTag } from 'next/cache'
import { getSupabase } from '@/lib/supabase'
import type { Locale } from '@/lib/content/slug'

/**
 * Tag covering every cached content read. ONE tag, deliberately: a per-row tag
 * would have to be attached at `unstable_cache` construction time, which is
 * module scope, so it could be declared and exported but never actually
 * registered against anything — rule 11’s failure mode, a constant nothing is
 * checking. The table holds five rows; flushing all of them is free.
 */
export const CONTENT_TAG = 'website-content'

/**
 * Safety-net TTL. Content is published a few times a year; the real freshness
 * mechanism is `revalidateContent()` on the write path.
 */
export const CONTENT_CACHE_SECONDS = 3600

export interface ContentRow {
  slug: string
  title: string
  meta_description: string | null
  body_html: string | null
  featured_image: string | null
  keywords: string[] | null
  page_type: string
  structured: unknown
  published_at: string | null
  updated_at: string
}

export interface PublishedEntry {
  slug: string
  locale: Locale
  updated_at: string | null
}

/** Found / absent / could-not-tell. Never collapse the last two. */
export type Lookup<T> =
  | { state: 'found'; value: T }
  | { state: 'absent' }
  | { state: 'unavailable'; reason: string }

const ROW_COLUMNS =
  'slug, title, meta_description, body_html, featured_image, keywords, page_type, structured, published_at, updated_at'

/**
 * The cached callbacks THROW on a read failure on purpose: `unstable_cache`
 * stores a resolved value and does not store a rejection, so a Supabase blip
 * must not be able to pin "this page is gone" into the cache for an hour.
 */
const cachedIndex = unstable_cache(
  async (): Promise<PublishedEntry[]> => {
    const { data, error } = await getSupabase()
      .from('website_content')
      .select('slug, locale, updated_at')
      .eq('status', 'published')
    if (error) throw new Error(error.message)
    return (data || []).map(r => {
      const row = r as { slug: string; locale: string; updated_at: string | null }
      return { slug: row.slug, locale: row.locale === 'es' ? 'es' : 'en', updated_at: row.updated_at }
    })
  },
  ['website-content-index'],
  { tags: [CONTENT_TAG], revalidate: CONTENT_CACHE_SECONDS },
)

const cachedRow = unstable_cache(
  async (slug: string, locale: Locale): Promise<ContentRow | null> => {
    const { data, error } = await getSupabase()
      .from('website_content')
      .select(ROW_COLUMNS)
      .eq('slug', slug)
      .eq('locale', locale)
      .eq('status', 'published')
      .maybeSingle()
    if (error) throw new Error(error.message)
    return (data as ContentRow | null) ?? null
  },
  ['website-content-row'],
  { tags: [CONTENT_TAG], revalidate: CONTENT_CACHE_SECONDS },
)

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Every published (slug, locale) pair. One cache entry for the whole table. */
export async function loadPublishedIndex(): Promise<Lookup<PublishedEntry[]>> {
  try {
    return { state: 'found', value: await cachedIndex() }
  } catch (err) {
    console.error('[content] published index read failed:', reasonOf(err))
    return { state: 'unavailable', reason: reasonOf(err) }
  }
}

/**
 * One published row. Consults the index first, so a path that has never been
 * published costs no DB query and creates no cache entry — which is what makes
 * caching a CATCH-ALL route's data safe.
 */
export async function loadPublishedRow(slug: string, locale: Locale): Promise<Lookup<ContentRow>> {
  const index = await loadPublishedIndex()
  if (index.state === 'unavailable') return index
  if (index.state === 'found' && !index.value.some(e => e.slug === slug && e.locale === locale)) {
    return { state: 'absent' }
  }
  try {
    const row = await cachedRow(slug, locale)
    // The index said this row is published and the row read says it is not.
    // That is a stale index (published then archived inside the TTL), not a
    // failure — 404 is the right answer and the next revalidation fixes it.
    return row ? { state: 'found', value: row } : { state: 'absent' }
  } catch (err) {
    console.error(`[content] row read failed for ${locale}:${slug}:`, reasonOf(err))
    return { state: 'unavailable', reason: reasonOf(err) }
  }
}

/** Which locales are published for a base slug — drives hreflang alternates. */
export function localesForSlug(index: PublishedEntry[], slug: string): Set<Locale> {
  return new Set(index.filter(e => e.slug === slug).map(e => e.locale))
}

/**
 * Flush the content cache. Called by EVERY writer that changes what a published
 * page says — status transitions and field edits alike.
 *
 * Rule 10 in cache form: a publish that does not revalidate looks exactly like
 * a publish that did, for an hour, to everyone except the person who pressed
 * the button and then reloaded the page.
 */
export function revalidateContent(): void {
  revalidateTag(CONTENT_TAG)
}
