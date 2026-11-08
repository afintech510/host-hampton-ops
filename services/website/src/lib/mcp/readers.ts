/**
 * The database reads behind the public MCP tools (`list_party_themes`,
 * `get_party_menu`, `get_quote`, `find_photos`).
 *
 * Kept out of `server.ts` on purpose: that file touches no table, and a test
 * holds it to that, so "the only write the public MCP server can make is the
 * replayed lead form" stays checkable by reading one import list. These
 * functions are READ-ONLY (the same test holds this file to no
 * insert/update/upsert/delete), and each delegates to the one implementation
 * the website uses: `loadQuoteCatalog` + `quoteFromCatalog` (the planner's
 * rows and engine), `buildPartyMenu` over that same catalog, and `findPhotos`
 * (approved AND no identifiable child).
 */

import { getSupabase } from '@/lib/supabase'
import { listThemes, loadQuoteCatalog, quoteFromCatalog, type LoadedCatalog, type QuoteAnswer, type QuoteRequest, type ThemeListing } from '@/lib/quoteRequest'
import { buildPartyMenu, mobileAnchor, type PartyMenu } from '@/lib/partyMenu'
import { findPhotos, type Photo, type PhotoQuery } from '@/lib/media'

type Read<T> = { kind: 'ok' } & T | { kind: 'unavailable' }

async function catalog(): Promise<{ kind: 'ok'; data: LoadedCatalog } | { kind: 'unavailable' }> {
  const loaded = await loadQuoteCatalog(getSupabase())
  if (loaded.kind !== 'ok') {
    console.error('mcp: price list unreadable:', loaded.error)
    return { kind: 'unavailable' }
  }
  return loaded
}

export async function quoteParty(req: QuoteRequest): Promise<Read<{ answer: QuoteAnswer }>> {
  const c = await catalog()
  return c.kind === 'ok' ? { kind: 'ok', answer: quoteFromCatalog(c.data, req) } : c
}

/** The priced studio themes, named as the website names them — every name here prices. */
export async function themesForAgents(): Promise<Read<{ themes: ThemeListing[] }>> {
  const c = await catalog()
  return c.kind === 'ok' ? { kind: 'ok', themes: listThemes(c.data) } : c
}

export async function partyMenu(): Promise<Read<{ menu: PartyMenu }>> {
  const c = await catalog()
  return c.kind === 'ok' ? { kind: 'ok', menu: buildPartyMenu(c.data) } : c
}

/** The mobile "starts at" answer. Falls back to the compiled anchor inside the catalog loader, never to a total. */
export async function mobileQuoteAnchor(): Promise<Read<{ anchor: ReturnType<typeof mobileAnchor> }>> {
  const c = await catalog()
  return c.kind === 'ok' ? { kind: 'ok', anchor: mobileAnchor(c.data.cat) } : c
}

export async function photosFor(q: PhotoQuery): Promise<Read<{ photos: Photo[] }>> {
  const r = await findPhotos(getSupabase(), q)
  if (r.kind !== 'ok') {
    console.error('mcp: photos unreadable:', r.error)
    return { kind: 'unavailable' }
  }
  return { kind: 'ok', photos: r.data }
}
