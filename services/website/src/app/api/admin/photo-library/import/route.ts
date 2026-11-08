/**
 * Import photos into the library.
 *
 *   POST { csv: "<Muse's export>" }     candidates from the Instagram index (approved = false)
 *   POST { source: "gallery" }          seed the curated /gallery photos (approved)
 *   POST { source: "reels", csv, posters? }   Muse's tags folded to ONE row per reel; tags attach to the reel
 *                                        (a child flagged in any frame withdraws the face flag and approval);
 *                                        `posters` = { shortcode: base64 } used only for a NEW unflagged reel
 *
 * Instagram rows are downloaded, stripped of metadata and stored as our own WebP
 * (see lib/media.ts). A request handles at most MAX_ROWS rows; send a big index
 * in pieces. Re-running is safe: existing rows are re-tagged, never re-approved.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { importMuseRows, importReelTags, MAX_REEL_POSTERS, MAX_REEL_ROWS, parseCsv, seedFromGallery } from '@/lib/media'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_ROWS = 60
const MAX_CSV_CHARS = 400_000

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const body = (await req.json().catch(() => null)) as { csv?: unknown; source?: unknown } | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const sb = getSupabase()

  if (body.source === 'gallery') {
    const r = await seedFromGallery(sb)
    if (r.kind !== 'ok') return NextResponse.json({ error: r.error }, { status: 503 })
    return NextResponse.json({ ok: true, ...r.data })
  }

  if (typeof body.csv !== 'string' || !body.csv.trim()) return NextResponse.json({ error: 'Send { csv } or { source: "gallery" }.' }, { status: 400 })
  if (body.csv.length > MAX_CSV_CHARS) return NextResponse.json({ error: 'That CSV is too large; send it in pieces.' }, { status: 413 })
  const rows = parseCsv(body.csv)
  if (rows.length === 0) return NextResponse.json({ error: 'No rows found. The first line must be the header.' }, { status: 400 })
  if (body.source === 'reels') {
    // One row per REEL (reel_aggregate.py): tags attach to the reel, no slice picture is imported.
    if (!('ig_permalink' in rows[0]) || !('identifiable_child_face' in rows[0])) return NextResponse.json({ error: 'The CSV needs ig_permalink and identifiable_child_face columns.' }, { status: 400 })
    if (rows.length > MAX_REEL_ROWS) return NextResponse.json({ error: `At most ${MAX_REEL_ROWS} reels per request (this has ${rows.length}).` }, { status: 413 })
    const rawPosters = (body as { posters?: unknown }).posters
    const posters: Record<string, Uint8Array> = {}
    if (rawPosters !== undefined) {
      if (!rawPosters || typeof rawPosters !== 'object' || Array.isArray(rawPosters)) return NextResponse.json({ error: 'posters must be { "<shortcode>": "<base64>" }.' }, { status: 400 })
      const entries = Object.entries(rawPosters as Record<string, unknown>)
      if (entries.length > MAX_REEL_POSTERS) return NextResponse.json({ error: `At most ${MAX_REEL_POSTERS} posters per request.` }, { status: 413 })
      for (const [code, b64] of entries) {
        if (!/^[A-Za-z0-9_-]{5,20}$/.test(code) || typeof b64 !== 'string' || b64.length > 3_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return NextResponse.json({ error: `Poster for ${String(code).slice(0, 24)} is not valid base64.` }, { status: 400 })
        posters[code] = new Uint8Array(Buffer.from(b64, 'base64'))
      }
    }
    const r = await importReelTags(sb, rows, posters, adminActorId(req), undefined, { dryRun: (body as { dryRun?: unknown }).dryRun === true })
    if (r.kind !== 'ok') return NextResponse.json({ error: r.error }, { status: 503 })
    return NextResponse.json({ ok: true, ...r.data })
  }

  if (!('ig_permalink' in rows[0]) || !('media_url' in rows[0])) return NextResponse.json({ error: 'The CSV needs ig_permalink and media_url columns.' }, { status: 400 })
  if (rows.length > MAX_ROWS) return NextResponse.json({ error: `At most ${MAX_ROWS} rows per request (this has ${rows.length}).` }, { status: 413 })

  const r = await importMuseRows(sb, rows, adminActorId(req))
  if (r.kind !== 'ok') return NextResponse.json({ error: r.error }, { status: 503 })
  return NextResponse.json({ ok: true, ...r.data })
}
