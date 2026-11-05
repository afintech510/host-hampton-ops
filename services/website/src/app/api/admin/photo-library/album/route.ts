/**
 * Import a phone album (photos taken at parties, tagged by Muse) from LOCAL
 * FILES — the browser holds the folder; nothing is fetched from anywhere.
 *
 *   POST application/json   { csv, keepDuplicates? }
 *        PLAN: screens Muse's rows and says which files to send, which rows are
 *        skipped (and why) and which are already in the library. Writes nothing.
 *   POST multipart/form-data   row=<one CSV row as JSON>  file=<the picture>
 *        ONE photo: re-screened, re-encoded to WebP with all metadata (GPS
 *        included) dropped, stored in the public `media` bucket under icloud/…,
 *        and inserted as an UNAPPROVED candidate.
 *
 * One picture per request keeps every body small (nginx and Next both cap
 * request bodies) and makes a failure cost one photo.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { existingSourceKeys, importLocalPhoto, parseCsv, planLocalImport } from '@/lib/media'
import { MAX_IMAGE_BYTES } from '@/lib/mediaImage'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_CSV_CHARS = 600_000
const ROW_KEYS = ['ig_permalink', 'slide_index', 'media_url', 'posted_at', 'media_type', 'party_type', 'venue', 'theme_slug', 'activities', 'decor_tags', 'description', 'identifiable_child_face', 'people_count', 'quality', 'confidence', 'notes']

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const type = req.headers.get('content-type') || ''

  if (type.includes('multipart/form-data')) {
    const form = await req.formData().catch(() => null)
    const rowRaw = form?.get('row')
    const file = form?.get('file')
    if (!form || typeof rowRaw !== 'string' || !(file instanceof File)) return NextResponse.json({ error: 'Send row (JSON) and file.' }, { status: 400 })
    if (file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: 'That file is larger than 15 MB.' }, { status: 413 })
    let parsed: unknown
    try { parsed = JSON.parse(rowRaw) } catch { return NextResponse.json({ error: 'row is not JSON.' }, { status: 400 }) }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return NextResponse.json({ error: 'row must be an object.' }, { status: 400 })
    // Only the catalogue's own columns, only strings: nothing else reaches the importer.
    const row: Record<string, string> = {}
    for (const k of ROW_KEYS) { const v = (parsed as Record<string, unknown>)[k]; row[k] = typeof v === 'string' ? v : '' }
    const out = await importLocalPhoto(getSupabase(), row, new Uint8Array(await file.arrayBuffer()), adminActorId(req))
    return NextResponse.json({ ok: out.kind !== 'failed', ...out }, { status: out.kind === 'failed' ? 502 : 200 })
  }

  const body = (await req.json().catch(() => null)) as { csv?: unknown; keepDuplicates?: unknown } | null
  if (!body || typeof body.csv !== 'string' || !body.csv.trim()) return NextResponse.json({ error: 'Send { csv }.' }, { status: 400 })
  if (body.csv.length > MAX_CSV_CHARS) return NextResponse.json({ error: 'That CSV is too large.' }, { status: 413 })
  const rows = parseCsv(body.csv)
  if (rows.length === 0) return NextResponse.json({ error: 'No rows found. The first line must be the header.' }, { status: 400 })
  if (!('ig_permalink' in rows[0]) || !('media_url' in rows[0])) return NextResponse.json({ error: 'The CSV needs ig_permalink and media_url columns.' }, { status: 400 })
  const plan = planLocalImport(rows, { keepDuplicates: body.keepDuplicates === true })
  const have = await existingSourceKeys(getSupabase(), plan.accepted.map(c => c.sourceKey))
  if (have.kind !== 'ok') return NextResponse.json({ error: have.error }, { status: 503 })
  const rowByItem = new Map(rows.map(r => [(r.media_url || '').trim(), r]))
  return NextResponse.json({
    ok: true,
    rows: rows.length,
    skipped: plan.skipped,
    accepted: plan.accepted.map(c => ({
      item: c.item, sourceKey: c.sourceKey, exists: have.data.has(c.sourceKey), flag: c.reviewFlag, kind: c.mediaKind,
      row: Object.fromEntries(ROW_KEYS.map(k => [k, rowByItem.get(c.item)?.[k] ?? ''])),
    })),
  })
}
