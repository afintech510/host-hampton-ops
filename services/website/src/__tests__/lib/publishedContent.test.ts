/**
 * The read half of the content pipeline.
 *
 * The two things that matter here are (a) rule 12 — a failed read is NOT "this
 * page does not exist", because 404ing every published page during a Supabase
 * blip tells Google the content was deleted; and (b) that an unpublished path
 * costs no DB query, which is what makes caching a CATCH-ALL route safe.
 */

const cacheCalls: { keyParts: string[]; opts: any }[] = []
jest.mock('next/cache', () => ({
  // Pass-through so the wrapped function's behaviour is what is under test;
  // the registered tags are asserted separately.
  unstable_cache: (fn: any, keyParts: string[], opts: any) => {
    cacheCalls.push({ keyParts, opts })
    return fn
  },
  revalidateTag: jest.fn(),
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))

import {
  loadPublishedIndex,
  loadPublishedRow,
  localesForSlug,
  revalidateContent,
  CONTENT_TAG,
  CONTENT_CACHE_SECONDS,
} from '@/lib/content/published'
import { revalidateTag } from 'next/cache'

const INDEX_ROWS = [
  { slug: 'party-room-rental', locale: 'es', updated_at: '2026-08-17T00:00:00Z' },
  { slug: 'permanent-jewelry-southampton', locale: 'en', updated_at: '2026-09-12T00:00:00Z' },
]

const ROW = {
  slug: 'permanent-jewelry-southampton',
  title: 'Permanent Jewelry in Southampton | Host Hampton',
  meta_description: 'd',
  body_html: null,
  featured_image: null,
  keywords: ['a'],
  page_type: 'landing',
  structured: { sections: [], faq: [] },
  published_at: '2026-09-12T00:00:00Z',
  updated_at: '2026-09-12T00:00:00Z',
}

/**
 * Two independent chains: the index query ends at `.eq('status','published')`
 * and is awaited; the row query ends at `.maybeSingle()`.
 */
function makeSupabase(opts: { indexError?: string; rowError?: string; row?: any; index?: any[] } = {}) {
  const rowQueries: { slug?: string; locale?: string }[] = []
  let indexQueries = 0
  return {
    rowQueries,
    indexCount: () => indexQueries,
    from: jest.fn(() => {
      const chain: any = {}
      const captured: any = {}
      let isRowQuery = false
      chain.select = jest.fn((cols: string) => {
        isRowQuery = cols.includes('title')
        if (!isRowQuery) indexQueries++
        return chain
      })
      chain.eq = jest.fn((col: string, val: any) => {
        captured[col] = val
        if (!isRowQuery && col === 'status') {
          // Index query resolves here.
          return opts.indexError
            ? Promise.resolve({ data: null, error: { message: opts.indexError } })
            : Promise.resolve({ data: opts.index ?? INDEX_ROWS, error: null })
        }
        return chain
      })
      chain.maybeSingle = jest.fn(() => {
        rowQueries.push({ slug: captured.slug, locale: captured.locale })
        return opts.rowError
          ? Promise.resolve({ data: null, error: { message: opts.rowError } })
          : Promise.resolve({ data: opts.row === undefined ? ROW : opts.row, error: null })
      })
      return chain
    }),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('cache registration', () => {
  it('both readers are tagged so a publish can flush them', () => {
    expect(cacheCalls.length).toBeGreaterThanOrEqual(2)
    for (const c of cacheCalls) {
      expect(c.opts.tags).toContain(CONTENT_TAG)
      expect(c.opts.revalidate).toBe(CONTENT_CACHE_SECONDS)
    }
  })

  it('revalidateContent flushes the tag', () => {
    revalidateContent()
    expect(revalidateTag).toHaveBeenCalledWith(CONTENT_TAG)
  })
})

describe('loadPublishedIndex', () => {
  it('returns every published pair', async () => {
    mockGetSupabase.mockReturnValue(makeSupabase())
    const r = await loadPublishedIndex()
    expect(r.state).toBe('found')
    if (r.state !== 'found') return
    expect(r.value).toEqual([
      { slug: 'party-room-rental', locale: 'es', updated_at: '2026-08-17T00:00:00Z' },
      { slug: 'permanent-jewelry-southampton', locale: 'en', updated_at: '2026-09-12T00:00:00Z' },
    ])
  })

  it('an unrecognised locale is normalised to en rather than guessed at', () => {
    return (async () => {
      mockGetSupabase.mockReturnValue(makeSupabase({ index: [{ slug: 'x', locale: 'fr', updated_at: null }] }))
      const r = await loadPublishedIndex()
      expect(r.state).toBe('found')
      if (r.state !== 'found') return
      expect(r.value[0].locale).toBe('en')
    })()
  })

  it('a read failure is `unavailable`, NOT an empty index', async () => {
    mockGetSupabase.mockReturnValue(makeSupabase({ indexError: 'connection reset' }))
    const r = await loadPublishedIndex()
    expect(r.state).toBe('unavailable')
    if (r.state !== 'unavailable') return
    expect(r.reason).toMatch(/connection reset/)
  })
})

describe('loadPublishedRow', () => {
  it('finds a published row', async () => {
    mockGetSupabase.mockReturnValue(makeSupabase())
    const r = await loadPublishedRow('permanent-jewelry-southampton', 'en')
    expect(r.state).toBe('found')
    if (r.state !== 'found') return
    expect(r.value.title).toContain('Southampton')
  })

  it('a path not in the index costs NO row query', async () => {
    // This is what bounds the cache key space on a catch-all route: a scanner
    // probing /wp-login.php must not create a cache entry or a DB round-trip.
    const supa = makeSupabase()
    mockGetSupabase.mockReturnValue(supa)
    const r = await loadPublishedRow('wp-login.php', 'en')
    expect(r.state).toBe('absent')
    expect(supa.rowQueries).toEqual([])
  })

  it('the same slug in the WRONG locale is absent, not found', async () => {
    const supa = makeSupabase()
    mockGetSupabase.mockReturnValue(supa)
    // party-room-rental is published in `es` only.
    const r = await loadPublishedRow('party-room-rental', 'en')
    expect(r.state).toBe('absent')
    expect(supa.rowQueries).toEqual([])
  })

  it('an index failure propagates as `unavailable` — it does not become a 404', async () => {
    mockGetSupabase.mockReturnValue(makeSupabase({ indexError: 'timeout' }))
    const r = await loadPublishedRow('permanent-jewelry-southampton', 'en')
    expect(r.state).toBe('unavailable')
  })

  it('a row-read failure is `unavailable` too', async () => {
    mockGetSupabase.mockReturnValue(makeSupabase({ rowError: 'boom' }))
    const r = await loadPublishedRow('permanent-jewelry-southampton', 'en')
    expect(r.state).toBe('unavailable')
    if (r.state !== 'unavailable') return
    expect(r.reason).toMatch(/boom/)
  })

  it('an index that is stale against a just-archived row is `absent`, not a failure', async () => {
    // The index still lists the slug; the row query says it is no longer
    // published. 404 is right, and the next revalidation fixes the index.
    mockGetSupabase.mockReturnValue(makeSupabase({ row: null }))
    const r = await loadPublishedRow('permanent-jewelry-southampton', 'en')
    expect(r.state).toBe('absent')
  })
})

describe('localesForSlug drives hreflang without a second query', () => {
  it('reports only the locales actually published', () => {
    expect(localesForSlug(INDEX_ROWS as any, 'party-room-rental')).toEqual(new Set(['es']))
    expect(localesForSlug(INDEX_ROWS as any, 'permanent-jewelry-southampton')).toEqual(new Set(['en']))
    expect(localesForSlug(INDEX_ROWS as any, 'nope')).toEqual(new Set())
  })
})
