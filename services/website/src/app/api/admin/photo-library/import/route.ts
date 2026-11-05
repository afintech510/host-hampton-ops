/**
 * Import photos into the library.
 *
 *   POST { csv: "<Muse's export>" }     candidates from the Instagram index (approved = false)
 *   POST { source: "gallery" }          seed the curated /gallery photos (approved)
 *
 * Instagram rows are downloaded, stripped of metadata and stored as our own WebP
 * (see lib/media.ts). A request handles at most MAX_ROWS rows; send a big index
 * in pieces. Re-running is safe: existing rows are re-tagged, never re-approved.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { importMuseRows, parseCsv, seedFromGallery } from '@/lib/media'

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
  if (!('ig_permalink' in rows[0]) || !('media_url' in rows[0])) return NextResponse.json({ error: 'The CSV needs ig_permalink and media_url columns.' }, { status: 400 })
  if (rows.length > MAX_ROWS) return NextResponse.json({ error: `At most ${MAX_ROWS} rows per request (this has ${rows.length}).` }, { status: 413 })

  const r = await importMuseRows(sb, rows, adminActorId(req))
  if (r.kind !== 'ok') return NextResponse.json({ error: r.error }, { status: 503 })
  return NextResponse.json({ ok: true, ...r.data })
}
