/**
 * The database reads behind the public MCP tools `get_quote` and `find_photos`.
 *
 * Kept out of `server.ts` on purpose: that file touches no table, and a test
 * holds it to that, so "the only write the public MCP server can make is the
 * replayed lead form" stays checkable by reading one import list. These two
 * functions are READ-ONLY (the same test holds this file to no
 * insert/update/upsert/delete), and each delegates to the one implementation
 * the website uses: `quoteFromCatalog` (the planner's engine) and `findPhotos`
 * (approved AND no identifiable child).
 */

import { getSupabase } from '@/lib/supabase'
import { loadQuoteCatalog, quoteFromCatalog, type QuoteAnswer, type QuoteRequest } from '@/lib/quoteRequest'
import { findPhotos, type Photo, type PhotoQuery } from '@/lib/media'

export async function quoteParty(req: QuoteRequest): Promise<{ kind: 'ok'; answer: QuoteAnswer } | { kind: 'unavailable' }> {
  const loaded = await loadQuoteCatalog(getSupabase())
  if (loaded.kind !== 'ok') {
    console.error('mcp: price list unreadable:', loaded.error)
    return { kind: 'unavailable' }
  }
  return { kind: 'ok', answer: quoteFromCatalog(loaded.data, req) }
}

export async function photosFor(q: PhotoQuery): Promise<{ kind: 'ok'; photos: Photo[] } | { kind: 'unavailable' }> {
  const r = await findPhotos(getSupabase(), q)
  if (r.kind !== 'ok') {
    console.error('mcp: photos unreadable:', r.error)
    return { kind: 'unavailable' }
  }
  return { kind: 'ok', photos: r.data }
}
