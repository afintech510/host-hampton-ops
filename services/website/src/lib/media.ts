/**
 * The photo library (`media_assets`, migration 083).
 *
 * THE RULE THIS FILE EXISTS FOR: a photo is served only if a human approved it
 * AND it shows no identifiable child. `findPhotos` is the ONE reader that
 * enforces both, and `mediaSurface.test.ts` fails the suite if any other file
 * selects the table. The CHECK constraint in the migration makes "approved
 * without the face check" impossible at the database too.
 *
 * Rows arrive as CANDIDATES (approved = false) from three places: the curated
 * /gallery set (`seedFromGallery`, pre-approved: those were curated by hand),
 * the Instagram index Muse tags (`importMuseRows`), and the admin grid.
 *
 * Instagram image URLs expire, so the importer downloads each image, drops its
 * EXIF/GPS, converts it to WebP and stores OUR copy in the public `media`
 * bucket; `url` is never an Instagram URL.
 */

import type { getSupabase } from '@/lib/supabase'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { GALLERY_PHOTOS, type GalleryPhoto } from '@/lib/gallery'

type Supa = ReturnType<typeof getSupabase>

export type Read<T> = { kind: 'ok'; data: T } | { kind: 'unavailable'; error: string }

export const MEDIA_BUCKET = 'media'
export const MAX_PHOTOS_PER_REQUEST = 12

/* ── CSV (RFC 4180, enough for Muse's export) ─────────────────────────────── */

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(c => c !== '')) rows.push(row)
      row = []
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some(c => c !== '')) rows.push(row) }
  if (rows.length < 2) return []
  const head = rows[0].map(h => h.trim())
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])))
}

/* ── Screening Muse's rows ────────────────────────────────────────────────── */

export interface MuseCandidate {
  sourceKey: string
  shortcode: string
  slide: number
  mediaUrl: string
  permalink: string
  postedAt: string | null
  partyType: string | null
  venue: string | null
  themeSlug: string | null
  activities: string[]
  decorTags: string[]
  description: string
  quality: number | null
  confidence: string | null
  notes: string | null
}

export type MuseScreen = { ok: true; candidate: MuseCandidate } | { ok: false; reason: string }

const FLYER = /\b(flyer|poster|promo(?:tional)? graphic|announc\w*|sign reading)\b/i
const list = (v: string) => v.split('|').map(s => s.trim()).filter(Boolean)
const none = (v: string) => (!v || v === 'none' || v === 'unsure' ? null : v)

/** Is this the shortcode of an instagram.com/p/… or /reel/… permalink? */
export function shortcodeOf(permalink: string): string | null {
  const m = /^https:\/\/www\.instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]{5,20})\/?/.exec(permalink)
  return m ? m[1] : null
}

/**
 * Decide whether a row of Muse's index is worth importing as a candidate. It is
 * deliberately strict on children: only an explicit `no` passes; `yes` and
 * `unsure` are never downloaded, so a child's face is never even stored.
 */
export function screenMuseRow(r: Record<string, string>): MuseScreen {
  const shortcode = shortcodeOf(r.ig_permalink || '')
  if (!shortcode) return { ok: false, reason: 'no usable permalink' }
  if (!/^https:\/\/[^/]*(cdninstagram\.com|fbcdn\.net)\//.test(r.media_url || '')) return { ok: false, reason: 'media_url is not an Instagram CDN link' }
  if ((r.identifiable_child_face || '').toLowerCase() !== 'no') return { ok: false, reason: 'a child may be identifiable' }
  const text = `${r.description || ''} ${r.notes || ''}`
  if (FLYER.test(text)) return { ok: false, reason: 'a flyer or promo graphic' }
  const quality = Number(r.quality)
  if (Number.isFinite(quality) && quality > 0 && quality < 3) return { ok: false, reason: 'low quality' }
  const activities = list(r.activities || '')
  const decorTags = list(r.decor_tags || '')
  const theme = none(r.theme_slug || '')
  const partyType = r.party_type && r.party_type !== 'not_a_party' ? r.party_type : null
  if (!partyType && !theme && activities.length === 0 && decorTags.length === 0) return { ok: false, reason: 'no party content visible' }
  const slide = Number.parseInt(r.slide_index || '1', 10) || 1
  return {
    ok: true,
    candidate: {
      sourceKey: `ig:${shortcode}:${slide}`, shortcode, slide, mediaUrl: r.media_url, permalink: r.ig_permalink,
      postedAt: /^\d{4}-\d{2}-\d{2}$/.test(r.posted_at || '') ? r.posted_at : null,
      partyType, venue: none(r.venue || ''), themeSlug: theme, activities, decorTags,
      description: (r.description || '').slice(0, 300), quality: Number.isFinite(quality) && quality > 0 ? quality : null,
      confidence: r.confidence || null, notes: r.notes ? r.notes.slice(0, 300) : null,
    },
  }
}

/* ── Serving ──────────────────────────────────────────────────────────────── */

export interface Photo {
  id: string
  url: string
  alt: string
  w: number | null
  h: number | null
  partyType: string | null
  themeSlug: string | null
  activities: string[]
  igPermalink: string | null
}

/** A relative path (the curated gallery) becomes absolute against OUR origin. */
export function absoluteMediaUrl(url: string): string {
  return /^https?:\/\//.test(url) ? url : `${CANONICAL_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`
}

const PHOTO_COLUMNS = 'id, url, alt, w, h, party_type, theme_slug, activities, ig_permalink'

export interface PhotoQuery {
  partyType?: string
  activity?: string
  themeSlug?: string
  ids?: string[]
  limit?: number
}

const SAFE_TAG = /^[a-z0-9][a-z0-9_-]{0,60}$/

/**
 * THE reader. Approved AND no identifiable faces — both, always, whatever the
 * caller asked for. A filter value that is not a plain tag matches NOTHING
 * (never "drop the filter"): an unrecognised ask returns no photos, not all.
 */
export async function findPhotos(sb: Supa, q: PhotoQuery = {}): Promise<Read<Photo[]>> {
  const limit = Math.max(1, Math.min(MAX_PHOTOS_PER_REQUEST, Math.floor(q.limit ?? 6)))
  for (const v of [q.partyType, q.activity, q.themeSlug]) {
    if (v !== undefined && !SAFE_TAG.test(v)) return { kind: 'ok', data: [] }
  }
  let query = sb.from('media_assets').select(PHOTO_COLUMNS).eq('approved', true).eq('no_identifiable_faces', true)
  if (q.partyType) query = query.eq('party_type', q.partyType)
  if (q.themeSlug) query = query.eq('theme_slug', q.themeSlug)
  if (q.activity) query = query.contains('activities', [q.activity])
  if (q.ids) {
    const ids = q.ids.filter(i => /^[0-9a-f-]{36}$/i.test(i)).slice(0, MAX_PHOTOS_PER_REQUEST)
    if (ids.length === 0) return { kind: 'ok', data: [] }
    query = query.in('id', ids)
  }
  const { data, error } = await query.order('sort', { ascending: false }).order('quality', { ascending: false, nullsFirst: false }).order('posted_at', { ascending: false, nullsFirst: false }).limit(limit)
  if (error) return { kind: 'unavailable', error: error.message }
  type Row = { id: string; url: string; alt: string; w: number | null; h: number | null; party_type: string | null; theme_slug: string | null; activities: string[] | null; ig_permalink: string | null }
  return {
    kind: 'ok',
    data: ((data ?? []) as unknown as Row[]).map(r => ({
      id: r.id, url: absoluteMediaUrl(r.url), alt: r.alt, w: r.w, h: r.h, partyType: r.party_type, themeSlug: r.theme_slug,
      activities: r.activities ?? [], igPermalink: r.ig_permalink,
    })),
  }
}

/* ── Seeding the curated gallery ──────────────────────────────────────────── */

const GALLERY_PARTY: Record<GalleryPhoto['category'], string | null> = {
  studio: 'in_studio_theme', 'at-home': 'mobile_party', spa: 'in_studio_theme', crafts: null, events: 'public_event',
}

/**
 * The /gallery photos were curated by hand under the no-identifiable-children
 * rule (see lib/gallery.ts), so they are seeded APPROVED. Idempotent: an
 * existing row is left alone (a human's later edits are theirs).
 */
export async function seedFromGallery(sb: Supa): Promise<Read<{ added: number; existing: number }>> {
  const keys = GALLERY_PHOTOS.map(p => `gallery:${p.src}`)
  const { data: have, error } = await sb.from('media_assets').select('source_key').in('source_key', keys)
  if (error) return { kind: 'unavailable', error: error.message }
  const present = new Set(((have ?? []) as { source_key: string }[]).map(r => r.source_key))
  const fresh = GALLERY_PHOTOS.filter(p => !present.has(`gallery:${p.src}`)).map(p => ({
    source: 'gallery', source_key: `gallery:${p.src}`, url: p.src, alt: p.alt, w: p.w, h: p.h,
    party_type: GALLERY_PARTY[p.category], activities: [] as string[], no_identifiable_faces: true, approved: true,
    approved_by: 'seed:gallery', approved_at: new Date().toISOString(),
  }))
  if (fresh.length) {
    const { error: insErr } = await sb.from('media_assets').insert(fresh)
    if (insErr) return { kind: 'unavailable', error: insErr.message }
  }
  return { kind: 'ok', data: { added: fresh.length, existing: present.size } }
}

/* ── Importing Muse's rows ────────────────────────────────────────────────── */

export interface ImageProcessor {
  /** Download, drop metadata, convert to WebP ≤1200px. Never throws for a bad image; returns null. */
  fetchAndConvert(url: string): Promise<{ bytes: Uint8Array; w: number; h: number } | null>
}

const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024

export const sharpProcessor: ImageProcessor = {
  async fetchAndConvert(url) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      if (!res.ok) return null
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length === 0 || buf.length > MAX_DOWNLOAD_BYTES) return null
      const sharp = (await import('sharp')).default
      // rotate() applies EXIF orientation; sharp drops all metadata (incl. GPS) unless asked to keep it.
      const out = await sharp(buf).rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true })
      return { bytes: new Uint8Array(out.data), w: out.info.width, h: out.info.height }
    } catch {
      return null
    }
  },
}

export interface ImportReport {
  rows: number
  skipped: { reason: string; count: number }[]
  imported: number
  updated: number
  failed: string[]
}

export async function importMuseRows(
  sb: Supa, rows: Record<string, string>[], actor: string, proc: ImageProcessor = sharpProcessor,
): Promise<Read<ImportReport>> {
  const skipped = new Map<string, number>()
  const cands: MuseCandidate[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    const s = screenMuseRow(r)
    if (!s.ok) { skipped.set(s.reason, (skipped.get(s.reason) ?? 0) + 1); continue }
    if (seen.has(s.candidate.sourceKey)) { skipped.set('duplicate row', (skipped.get('duplicate row') ?? 0) + 1); continue }
    seen.add(s.candidate.sourceKey)
    cands.push(s.candidate)
  }

  const keys = cands.map(c => c.sourceKey)
  const { data: have, error } = keys.length ? await sb.from('media_assets').select('source_key').in('source_key', keys) : { data: [], error: null }
  if (error) return { kind: 'unavailable', error: error.message }
  const existing = new Set(((have ?? []) as { source_key: string }[]).map(r => r.source_key))

  const tags = (c: MuseCandidate) => ({
    alt: c.description, party_type: c.partyType, venue: c.venue, theme_slug: c.themeSlug, activities: c.activities, decor_tags: c.decorTags,
    description: c.description, ig_permalink: c.permalink, posted_at: c.postedAt, quality: c.quality, tag_confidence: c.confidence,
    notes: c.notes, updated_at: new Date().toISOString(),
  })

  let imported = 0
  let updated = 0
  const failed: string[] = []
  for (const c of cands) {
    if (existing.has(c.sourceKey)) {
      // Re-tag only. Approval and the face flag belong to the human who set them.
      const { error: upErr } = await sb.from('media_assets').update(tags(c)).eq('source_key', c.sourceKey).select('id')
      if (upErr) failed.push(`${c.sourceKey}: ${upErr.message}`)
      else updated++
      continue
    }
    const img = await proc.fetchAndConvert(c.mediaUrl)
    if (!img) { failed.push(`${c.sourceKey}: image could not be downloaded or converted`); continue }
    const path = `ig/${c.shortcode}-${c.slide}.webp`
    const { error: upload } = await sb.storage.from(MEDIA_BUCKET).upload(path, img.bytes, { contentType: 'image/webp', upsert: true })
    if (upload) { failed.push(`${c.sourceKey}: upload failed (${upload.message})`); continue }
    const { data: pub } = sb.storage.from(MEDIA_BUCKET).getPublicUrl(path)
    const { error: insErr } = await sb.from('media_assets').insert({
      source: 'instagram', source_key: c.sourceKey, url: pub.publicUrl, w: img.w, h: img.h, ...tags(c),
      // Muse said no identifiable face; a human still has to look before it is served.
      no_identifiable_faces: true, approved: false,
    })
    if (insErr) failed.push(`${c.sourceKey}: ${insErr.message}`)
    else imported++
  }
  console.log(`media: import by ${actor}: ${imported} new, ${updated} re-tagged, ${failed.length} failed`)
  return {
    kind: 'ok',
    data: { rows: rows.length, skipped: Array.from(skipped, ([reason, count]) => ({ reason, count })), imported, updated, failed },
  }
}

/* ── Admin: the tagging grid ──────────────────────────────────────────────── */

const ADMIN_COLUMNS = 'id, source, url, alt, party_type, venue, theme_slug, activities, decor_tags, description, ig_permalink, posted_at, quality, tag_confidence, notes, no_identifiable_faces, approved, sort'

export interface AdminPhoto {
  id: string; source: string; url: string; alt: string; party_type: string | null; venue: string | null; theme_slug: string | null
  activities: string[]; decor_tags: string[]; description: string | null; ig_permalink: string | null; posted_at: string | null
  quality: number | null; tag_confidence: string | null; notes: string | null; no_identifiable_faces: boolean; approved: boolean; sort: number
}

export async function listForAdmin(sb: Supa, status: 'candidates' | 'approved' | 'all', limit = 200): Promise<Read<AdminPhoto[]>> {
  let q = sb.from('media_assets').select(ADMIN_COLUMNS)
  if (status === 'candidates') q = q.eq('approved', false)
  if (status === 'approved') q = q.eq('approved', true)
  const { data, error } = await q.order('posted_at', { ascending: false, nullsFirst: false }).limit(Math.min(500, limit))
  if (error) return { kind: 'unavailable', error: error.message }
  return { kind: 'ok', data: ((data ?? []) as unknown as AdminPhoto[]).map(p => ({ ...p, url: absoluteMediaUrl(p.url) })) }
}

export type PhotoPatch = Partial<{ approved: boolean; no_identifiable_faces: boolean; alt: string; party_type: string | null; theme_slug: string | null; activities: string[]; sort: number }>

export type PatchResult = { ok: true } | { ok: false; status: number; error: string }

/** Screen an admin edit. Approval needs the face check; clearing the face check withdraws approval. */
export function screenPatch(body: Record<string, unknown>): { ok: true; patch: PhotoPatch } | { ok: false; error: string } {
  const p: PhotoPatch = {}
  if ('approved' in body) { if (typeof body.approved !== 'boolean') return { ok: false, error: 'approved: true or false.' }; p.approved = body.approved }
  if ('no_identifiable_faces' in body) { if (typeof body.no_identifiable_faces !== 'boolean') return { ok: false, error: 'no_identifiable_faces: true or false.' }; p.no_identifiable_faces = body.no_identifiable_faces }
  if ('alt' in body) { if (typeof body.alt !== 'string' || body.alt.length > 300) return { ok: false, error: 'alt: up to 300 characters.' }; p.alt = body.alt.trim() }
  for (const k of ['party_type', 'theme_slug'] as const) {
    if (k in body) {
      const v = body[k]
      if (v !== null && (typeof v !== 'string' || !/^[a-z0-9_-]{1,60}$/.test(v))) return { ok: false, error: `${k}: a lowercase tag or null.` }
      p[k] = v as string | null
    }
  }
  if ('activities' in body) {
    const a = body.activities
    if (!Array.isArray(a) || a.length > 20 || a.some(x => typeof x !== 'string' || !SAFE_TAG.test(x))) return { ok: false, error: 'activities: up to 20 lowercase tags.' }
    p.activities = a as string[]
  }
  if ('sort' in body) { if (typeof body.sort !== 'number' || !Number.isInteger(body.sort) || Math.abs(body.sort) > 1000) return { ok: false, error: 'sort: a whole number.' }; p.sort = body.sort }
  if (Object.keys(p).length === 0) return { ok: false, error: 'Nothing to change.' }
  // Withdrawing the face check must also withdraw approval, in the same write.
  if (p.no_identifiable_faces === false) p.approved = false
  if (p.approved === true && p.no_identifiable_faces === false) return { ok: false, error: 'A photo that may show a child cannot be approved.' }
  return { ok: true, patch: p }
}

export async function patchPhoto(sb: Supa, id: string, patch: PhotoPatch, actor: string): Promise<PatchResult> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, status: 404, error: 'Unknown photo.' }
  const row: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() }
  if (patch.approved === true) { row.approved_by = actor; row.approved_at = new Date().toISOString() }
  if (patch.approved === false) { row.approved_by = null; row.approved_at = null }
  const { data, error } = await sb.from('media_assets').update(row).eq('id', id).select('id')
  if (error) {
    if ((error as { code?: string }).code === '23514') return { ok: false, status: 409, error: 'A photo needs the no-faces check before it can be approved.' }
    return { ok: false, status: 500, error: error.message }
  }
  if ((data ?? []).length === 0) return { ok: false, status: 404, error: 'Unknown photo.' }
  return { ok: true }
}
