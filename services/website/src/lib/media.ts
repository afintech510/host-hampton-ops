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

import { createHash } from 'crypto'
import type { getSupabase } from '@/lib/supabase'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { GALLERY_PHOTOS, type GalleryPhoto } from '@/lib/gallery'
import { convertImageBuffer, MAX_IMAGE_BYTES } from '@/lib/mediaImage'
import { canonicalActivities, canonicalDecor, canonicalTheme, unknownTags } from '@/lib/mediaVocab'

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

/** photo = a still; reel = an Instagram reel's thumbnail (permalink is the reel); video_still = a poster frame from a phone album. */
export type MediaKind = 'photo' | 'reel' | 'video_still'
export const MEDIA_KINDS: readonly MediaKind[] = ['photo', 'reel', 'video_still']
export type MediaSource = 'instagram' | 'gallery' | 'admin' | 'icloud'
export const MEDIA_SOURCES: readonly MediaSource[] = ['instagram', 'gallery', 'admin', 'icloud']

export interface MuseCandidate {
  sourceKey: string
  shortcode: string
  slide: number
  mediaUrl: string
  /** NULL for a phone album: its share link is private and find_photos returns this column to customers. */
  permalink: string | null
  mediaKind: MediaKind
  /** Why a human should look twice before approving (text in the picture may name a child), or null. */
  reviewFlag: string | null
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
// Muse writes "catalogued from poster frame" on every video still. That is a video
// FRAME, not a poster: before this was stripped it cost ~160 of 517 album photos.
const POSTER_FRAME = /\bposter[ -]frames?\b/gi
const SCREENSHOT = /\b(screenshot|screen capture)\b/i
// A picture of a letterboard, banner or name card can carry a child's name and age.
const NAME_TEXT = /\b(letterboard|name tag|name card|banner|chalkboard|whiteboard|place ?card|name and age)\b/i
const list = (v: string) => v.split('|').map(s => s.trim()).filter(Boolean)
const none = (v: string) => (!v || v === 'none' || v === 'unsure' ? null : v)

/** Is this a flyer/promo graphic? Looks at Muse's own words about the picture. */
export function looksLikeFlyer(text: string): boolean {
  return FLYER.test(text.replace(POSTER_FRAME, ' '))
}

/** The checks shared by every source: a child, a flyer, a screenshot, quality, content. */
function screenCommon(r: Record<string, string>): { ok: false; reason: string } | { ok: true; tags: Pick<MuseCandidate, 'partyType' | 'venue' | 'themeSlug' | 'activities' | 'decorTags' | 'description' | 'quality' | 'confidence' | 'notes' | 'postedAt' | 'reviewFlag'> } {
  if ((r.identifiable_child_face || '').toLowerCase() !== 'no') return { ok: false, reason: 'a child may be identifiable' }
  const text = `${r.description || ''} ${r.notes || ''}`
  if (looksLikeFlyer(text)) return { ok: false, reason: 'a flyer or promo graphic' }
  if (SCREENSHOT.test(text)) return { ok: false, reason: 'a screenshot' }
  const quality = Number(r.quality)
  if (Number.isFinite(quality) && quality > 0 && quality < 3) return { ok: false, reason: 'low quality' }
  const activities = canonicalActivities(list(r.activities || ''))
  const decorTags = canonicalDecor(list(r.decor_tags || ''))
  const theme = canonicalTheme(r.theme_slug)
  const partyType = r.party_type && r.party_type !== 'not_a_party' ? r.party_type : null
  if (!partyType && !theme && activities.length === 0 && decorTags.length === 0) return { ok: false, reason: 'no party content visible' }
  return {
    ok: true,
    tags: {
      partyType, venue: none(r.venue || ''), themeSlug: theme, activities, decorTags,
      description: (r.description || '').slice(0, 300), quality: Number.isFinite(quality) && quality > 0 ? quality : null,
      confidence: r.confidence || null, notes: r.notes ? r.notes.slice(0, 300) : null,
      postedAt: /^\d{4}-\d{2}-\d{2}$/.test(r.posted_at || '') ? r.posted_at : null,
      reviewFlag: NAME_TEXT.test(text) ? 'text in the picture may show a name' : null,
    },
  }
}

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
  const c = screenCommon(r)
  if (!c.ok) return c
  const slide = Number.parseInt(r.slide_index || '1', 10) || 1
  const isReel = /\/(reel|tv)\//.test(r.ig_permalink) || (r.media_type || '') === 'video_thumbnail'
  return {
    ok: true,
    candidate: {
      sourceKey: `ig:${shortcode}:${slide}`, shortcode, slide, mediaUrl: r.media_url, permalink: r.ig_permalink,
      mediaKind: isReel ? 'reel' : 'photo', ...c.tags,
    },
  }
}

/* ── Screening a phone album (local files) ────────────────────────────────── */

/** A photo from a phone album, to be uploaded as a file. No URL is ever fetched for it. */
export interface LocalCandidate extends Omit<MuseCandidate, 'shortcode' | 'slide' | 'mediaUrl' | 'permalink'> {
  /** `items/001.jpg` as Muse wrote it: a relative path inside the album folder. */
  item: string
  /** Stable, non-reversible id of the album (the share link is private and is never stored). */
  albumKey: string
  /** The numeric part of the file name, to read "duplicate of item 3". */
  itemNumber: number | null
  /** WebP path in the public bucket. */
  storagePath: string
}

export type LocalScreen = { ok: true; candidate: LocalCandidate } | { ok: false; reason: string }

/** `items/001.jpg`: letters, digits, `_ - .`, one `/` at most, a picture extension, no `..`, never absolute. */
const SAFE_ITEM = /^(?:[A-Za-z0-9_-]{1,40}\/)?[A-Za-z0-9_-][A-Za-z0-9_.-]{0,60}\.(?:jpe?g|png|webp|heic)$/i
const DUPLICATE_OF = /\b(?:near[- ])?identical(?: duplicate)?\s+(?:of|to)\s+item\s+(\d+)/i

export function albumKeyOf(albumLink: string): string {
  return createHash('sha256').update(albumLink.trim()).digest('hex').slice(0, 8)
}

export function screenLocalRow(r: Record<string, string>): LocalScreen {
  const item = (r.media_url || '').trim()
  if (!SAFE_ITEM.test(item) || item.includes('..')) return { ok: false, reason: 'media_url is not a plain file name inside the album folder' }
  if (!(r.ig_permalink || '').trim()) return { ok: false, reason: 'no album reference' }
  const c = screenCommon(r)
  if (!c.ok) return c
  const albumKey = albumKeyOf(r.ig_permalink)
  const base = item.slice(item.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
  const num = /(\d+)$/.exec(base)
  return {
    ok: true,
    candidate: {
      sourceKey: `icloud:${albumKey}:${base.toLowerCase()}`, item, albumKey, itemNumber: num ? Number.parseInt(num[1], 10) : null,
      storagePath: `icloud/${albumKey}-${base.toLowerCase()}.webp`,
      mediaKind: (r.media_type || '') === 'video_thumbnail' ? 'video_still' : 'photo', ...c.tags,
    },
  }
}

/**
 * Plan a whole album before any file moves: screen every row, then drop the
 * LATER copy of a pair Muse called "near-identical duplicate of item N" (the
 * earlier one is kept, so a pair never loses both). A duplicate reference to a
 * row we are not importing anyway keeps the row.
 */
export function planLocalImport(rows: Record<string, string>[], opts: { keepDuplicates?: boolean } = {}): { accepted: LocalCandidate[]; skipped: { reason: string; count: number }[] } {
  const skipped = new Map<string, number>()
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1)
  const accepted: LocalCandidate[] = []
  const seen = new Set<string>()
  const dupeOf = new Map<string, number>()
  for (const r of rows) {
    const s = screenLocalRow(r)
    if (!s.ok) { skip(s.reason); continue }
    if (seen.has(s.candidate.sourceKey)) { skip('duplicate row'); continue }
    seen.add(s.candidate.sourceKey)
    const m = DUPLICATE_OF.exec(`${r.notes || ''} ${r.description || ''}`)
    if (m) dupeOf.set(s.candidate.sourceKey, Number.parseInt(m[1], 10))
    accepted.push(s.candidate)
  }
  if (opts.keepDuplicates) return { accepted, skipped: Array.from(skipped, ([reason, count]) => ({ reason, count })) }
  const byNumber = new Set(accepted.map(c => `${c.albumKey}:${c.itemNumber}`))
  const kept = accepted.filter(c => {
    const ref = dupeOf.get(c.sourceKey)
    if (ref === undefined || c.itemNumber === null || ref >= c.itemNumber) return true
    if (!byNumber.has(`${c.albumKey}:${ref}`)) return true
    skip('near-identical to an earlier photo')
    return false
  })
  return { accepted: kept, skipped: Array.from(skipped, ([reason, count]) => ({ reason, count })) }
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
  /** For kind 'reel' this is the REEL's own URL: what a later click-to-load embed needs. Otherwise the post's, or null. */
  igPermalink: string | null
  kind: MediaKind
}

/** A relative path (the curated gallery) becomes absolute against OUR origin. */
export function absoluteMediaUrl(url: string): string {
  return /^https?:\/\//.test(url) ? url : `${CANONICAL_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`
}

const PHOTO_COLUMNS = 'id, url, alt, w, h, party_type, theme_slug, activities, ig_permalink, media_kind'

export interface PhotoQuery {
  partyType?: string
  activity?: string
  themeSlug?: string
  /** Only photos of this kind. Unset = every kind (a reel thumbnail is still a picture). */
  kind?: MediaKind
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
  if (q.kind !== undefined && !MEDIA_KINDS.includes(q.kind)) return { kind: 'ok', data: [] }
  let query = sb.from('media_assets').select(PHOTO_COLUMNS).eq('approved', true).eq('no_identifiable_faces', true)
  if (q.partyType) query = query.eq('party_type', q.partyType)
  if (q.themeSlug) query = query.eq('theme_slug', q.themeSlug)
  if (q.kind) query = query.eq('media_kind', q.kind)
  if (q.activity) query = query.contains('activities', [q.activity])
  if (q.ids) {
    const ids = q.ids.filter(i => /^[0-9a-f-]{36}$/i.test(i)).slice(0, MAX_PHOTOS_PER_REQUEST)
    if (ids.length === 0) return { kind: 'ok', data: [] }
    query = query.in('id', ids)
  }
  const { data, error } = await query.order('sort', { ascending: false }).order('quality', { ascending: false, nullsFirst: false }).order('posted_at', { ascending: false, nullsFirst: false }).limit(limit)
  if (error) return { kind: 'unavailable', error: error.message }
  type Row = { id: string; url: string; alt: string; w: number | null; h: number | null; party_type: string | null; theme_slug: string | null; activities: string[] | null; ig_permalink: string | null; media_kind?: MediaKind | null }
  return {
    kind: 'ok',
    data: ((data ?? []) as unknown as Row[]).map(r => ({
      id: r.id, url: absoluteMediaUrl(r.url), alt: r.alt, w: r.w, h: r.h, partyType: r.party_type, themeSlug: r.theme_slug,
      activities: r.activities ?? [], igPermalink: r.ig_permalink, kind: r.media_kind ?? 'photo',
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

export const sharpProcessor: ImageProcessor = {
  async fetchAndConvert(url) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      if (!res.ok) return null
      // EXIF/GPS and every other metadata chunk are dropped inside convertImageBuffer.
      return await convertImageBuffer(Buffer.from(await res.arrayBuffer()))
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
  /** Tags in no vocabulary (lib/mediaVocab.ts): kept as written, listed so someone can map them. */
  unknownTags: string[]
}

/** The columns a (re-)tag writes. Never approval, the face flag or the url: those belong to a human. */
function tagColumns(c: Pick<MuseCandidate, 'description' | 'partyType' | 'venue' | 'themeSlug' | 'activities' | 'decorTags' | 'permalink' | 'postedAt' | 'quality' | 'confidence' | 'notes' | 'mediaKind' | 'reviewFlag'>) {
  return {
    alt: c.description, party_type: c.partyType, venue: c.venue, theme_slug: c.themeSlug, activities: c.activities, decor_tags: c.decorTags,
    description: c.description, ig_permalink: c.permalink, posted_at: c.postedAt, quality: c.quality, tag_confidence: c.confidence,
    notes: c.notes, media_kind: c.mediaKind, review_flag: c.reviewFlag, updated_at: new Date().toISOString(),
  }
}

function collectUnknown(cands: Pick<MuseCandidate, 'themeSlug' | 'activities' | 'decorTags'>[]): string[] {
  const s = new Set<string>()
  for (const c of cands) for (const u of unknownTags({ theme: c.themeSlug, activities: c.activities, decor: c.decorTags })) s.add(u)
  return Array.from(s).sort()
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

  const tags = tagColumns

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
    data: { rows: rows.length, skipped: Array.from(skipped, ([reason, count]) => ({ reason, count })), imported, updated, failed, unknownTags: collectUnknown(cands) },
  }
}

/* ── Importing a phone album from local files ─────────────────────────────── */

export type LocalImportOutcome =
  | { kind: 'imported'; sourceKey: string }
  | { kind: 'retagged'; sourceKey: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; error: string }

/**
 * ONE album photo: the row Muse wrote, plus the file's bytes. The row is
 * re-screened here (the browser is not trusted to have done it), the bytes are
 * re-encoded to WebP with every metadata chunk dropped (`convertImageBuffer`
 * refuses its own output if one survives), and the row lands as an UNAPPROVED
 * candidate. A row already in the library is only re-tagged.
 */
export async function importLocalPhoto(
  sb: Supa, row: Record<string, string>, file: Uint8Array | null, actor: string,
  convert: (b: Buffer) => Promise<{ bytes: Uint8Array; w: number; h: number } | null> = convertImageBuffer,
): Promise<LocalImportOutcome> {
  const s = screenLocalRow(row)
  if (!s.ok) return { kind: 'skipped', reason: s.reason }
  const c = s.candidate
  const { data: have, error } = await sb.from('media_assets').select('source_key').eq('source_key', c.sourceKey)
  if (error) return { kind: 'failed', error: error.message }
  if ((have ?? []).length > 0) {
    const { error: upErr } = await sb.from('media_assets').update(tagColumns({ ...c, permalink: null })).eq('source_key', c.sourceKey).select('id')
    return upErr ? { kind: 'failed', error: upErr.message } : { kind: 'retagged', sourceKey: c.sourceKey }
  }
  if (!file || file.length === 0) return { kind: 'failed', error: 'no file was sent for this row' }
  if (file.length > MAX_IMAGE_BYTES) return { kind: 'failed', error: 'file is larger than 15 MB' }
  const img = await convert(Buffer.from(file))
  if (!img) return { kind: 'failed', error: 'the image could not be read or converted' }
  const { error: upload } = await sb.storage.from(MEDIA_BUCKET).upload(c.storagePath, img.bytes, { contentType: 'image/webp', upsert: true })
  if (upload) return { kind: 'failed', error: `upload failed (${upload.message})` }
  const { data: pub } = sb.storage.from(MEDIA_BUCKET).getPublicUrl(c.storagePath)
  const { error: insErr } = await sb.from('media_assets').insert({
    source: 'icloud', source_key: c.sourceKey, url: pub.publicUrl, w: img.w, h: img.h, ...tagColumns({ ...c, permalink: null }),
    // Muse said no identifiable face; a human still has to look before it is served.
    no_identifiable_faces: true, approved: false,
  })
  if (insErr) return { kind: 'failed', error: insErr.message }
  console.log(`media: album import by ${actor}: ${c.sourceKey}`)
  return { kind: 'imported', sourceKey: c.sourceKey }
}

/** Which of these album photos are already in the library? (`planLocalImport` + this = the dry run.) */
export async function existingSourceKeys(sb: Supa, keys: string[]): Promise<Read<Set<string>>> {
  const have = new Set<string>()
  for (let i = 0; i < keys.length; i += 150) {
    const { data, error } = await sb.from('media_assets').select('source_key').in('source_key', keys.slice(i, i + 150))
    if (error) return { kind: 'unavailable', error: error.message }
    for (const r of (data ?? []) as { source_key: string }[]) have.add(r.source_key)
  }
  return { kind: 'ok', data: have }
}

/* ── Admin: the tagging grid ──────────────────────────────────────────────── */

const ADMIN_COLUMNS = 'id, source, url, alt, party_type, venue, theme_slug, activities, decor_tags, description, ig_permalink, posted_at, quality, tag_confidence, notes, no_identifiable_faces, approved, approved_by, sort, media_kind, review_flag'

export interface AdminPhoto {
  id: string; source: string; url: string; alt: string; party_type: string | null; venue: string | null; theme_slug: string | null
  activities: string[]; decor_tags: string[]; description: string | null; ig_permalink: string | null; posted_at: string | null
  quality: number | null; tag_confidence: string | null; notes: string | null; no_identifiable_faces: boolean; approved: boolean
  approved_by: string | null; sort: number; media_kind: MediaKind; review_flag: string | null
}

export type AdminStatus = 'candidates' | 'approved' | 'all'
export type AdminSort = 'newest' | 'confidence' | 'quality'

export interface AdminFilter {
  status: AdminStatus
  source?: string
  partyType?: string
  theme?: string
  activity?: string
  kind?: string
  /** true = only rows with a review_flag. */
  flagged?: boolean
  sort?: AdminSort
  offset?: number
  limit?: number
}

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 }
const ADMIN_SCAN_CAP = 1500
export const ADMIN_PAGE_MAX = 200

/**
 * The tagging grid's rows. Filters are applied in the query; a filter value
 * that is not a plain tag matches NOTHING (never "drop the filter"). Sorting by
 * Muse's confidence is done here, not in SQL, because `high|medium|low` sorts
 * alphabetically as high, low, medium.
 */
export async function listForAdmin(sb: Supa, f: AdminFilter): Promise<Read<{ photos: AdminPhoto[]; total: number }>> {
  for (const v of [f.partyType, f.theme, f.activity]) if (v !== undefined && !SAFE_TAG.test(v)) return { kind: 'ok', data: { photos: [], total: 0 } }
  if (f.source !== undefined && !(MEDIA_SOURCES as readonly string[]).includes(f.source)) return { kind: 'ok', data: { photos: [], total: 0 } }
  if (f.kind !== undefined && !(MEDIA_KINDS as readonly string[]).includes(f.kind)) return { kind: 'ok', data: { photos: [], total: 0 } }
  let q = sb.from('media_assets').select(ADMIN_COLUMNS)
  if (f.status === 'candidates') q = q.eq('approved', false)
  if (f.status === 'approved') q = q.eq('approved', true)
  if (f.source) q = q.eq('source', f.source)
  if (f.partyType) q = q.eq('party_type', f.partyType)
  if (f.theme) q = q.eq('theme_slug', f.theme)
  if (f.activity) q = q.contains('activities', [f.activity])
  if (f.kind) q = q.eq('media_kind', f.kind)
  if (f.flagged) q = q.not('review_flag', 'is', null)
  const { data, error } = await q.order('posted_at', { ascending: false, nullsFirst: false }).limit(ADMIN_SCAN_CAP)
  if (error) return { kind: 'unavailable', error: error.message }
  const all = ((data ?? []) as unknown as AdminPhoto[]).map(p => ({ ...p, url: absoluteMediaUrl(p.url), media_kind: p.media_kind ?? 'photo' }))
  if (f.sort === 'confidence') all.sort((a, b) => (CONFIDENCE_RANK[b.tag_confidence ?? ''] ?? 0) - (CONFIDENCE_RANK[a.tag_confidence ?? ''] ?? 0) || (b.quality ?? 0) - (a.quality ?? 0))
  if (f.sort === 'quality') all.sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0) || (CONFIDENCE_RANK[b.tag_confidence ?? ''] ?? 0) - (CONFIDENCE_RANK[a.tag_confidence ?? ''] ?? 0))
  const limit = Math.max(1, Math.min(ADMIN_PAGE_MAX, Math.floor(f.limit ?? 60)))
  const offset = Math.max(0, Math.floor(f.offset ?? 0))
  return { kind: 'ok', data: { photos: all.slice(offset, offset + limit), total: all.length } }
}

export interface AdminFacets {
  sources: Record<string, number>
  kinds: Record<string, number>
  partyTypes: Record<string, number>
  themes: Record<string, number>
  activities: Record<string, number>
  decor: Record<string, number>
  flagged: number
  /** Tags in no vocabulary (lib/mediaVocab.ts). */
  unknown: string[]
}

/** Distinct tags and how many photos carry each, for the grid's filters. */
export async function facetsForAdmin(sb: Supa, status: AdminStatus): Promise<Read<AdminFacets>> {
  let q = sb.from('media_assets').select('source, media_kind, party_type, theme_slug, activities, decor_tags, review_flag')
  if (status === 'candidates') q = q.eq('approved', false)
  if (status === 'approved') q = q.eq('approved', true)
  const { data, error } = await q.limit(5000)
  if (error) return { kind: 'unavailable', error: error.message }
  const out: AdminFacets = { sources: {}, kinds: {}, partyTypes: {}, themes: {}, activities: {}, decor: {}, flagged: 0, unknown: [] }
  const bump = (m: Record<string, number>, k: string | null | undefined) => { if (k) m[k] = (m[k] ?? 0) + 1 }
  const unknown = new Set<string>()
  type R = { source: string; media_kind: string | null; party_type: string | null; theme_slug: string | null; activities: string[] | null; decor_tags: string[] | null; review_flag: string | null }
  for (const r of (data ?? []) as unknown as R[]) {
    bump(out.sources, r.source); bump(out.kinds, r.media_kind ?? 'photo'); bump(out.partyTypes, r.party_type); bump(out.themes, r.theme_slug)
    for (const a of r.activities ?? []) bump(out.activities, a)
    for (const d of r.decor_tags ?? []) bump(out.decor, d)
    if (r.review_flag) out.flagged++
    for (const u of unknownTags({ theme: r.theme_slug, activities: r.activities ?? [], decor: r.decor_tags ?? [] })) unknown.add(u)
  }
  out.unknown = Array.from(unknown).sort()
  return { kind: 'ok', data: out }
}

export const BULK_MAX = 100

/** `unchanged`: already in the requested state, or (for approval) the face check is not set in the database. */
export type BulkResult = { ok: true; changed: string[]; unchanged: string[] } | { ok: false; status: number; error: string }

/**
 * Approve (or withdraw) several photos in ONE write. Approval is conditional on
 * the face check being true in the DATABASE for each row — the browser's idea of
 * the checkbox is not consulted — so a row whose check was cleared (or that was
 * never ticked) is returned in `unchanged`, not approved. The CHECK constraint in
 * migration 083 is the backstop. The actor is stamped on every row and logged.
 */
export async function bulkSetApproval(sb: Supa, ids: unknown, approve: boolean, actor: string): Promise<BulkResult> {
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, status: 400, error: 'Select at least one photo.' }
  if (ids.length > BULK_MAX) return { ok: false, status: 400, error: `At most ${BULK_MAX} photos at once.` }
  const want = Array.from(new Set(ids.map(String)))
  if (want.some(i => !/^[0-9a-f-]{36}$/i.test(i))) return { ok: false, status: 400, error: 'Unknown photo in the selection.' }
  const now = new Date().toISOString()
  const base = approve
    ? sb.from('media_assets').update({ approved: true, approved_by: actor, approved_at: now, updated_at: now }).in('id', want).eq('approved', false).eq('no_identifiable_faces', true)
    : sb.from('media_assets').update({ approved: false, approved_by: null, approved_at: null, updated_at: now }).in('id', want).eq('approved', true)
  const { data, error } = await base.select('id')
  if (error) return { ok: false, status: 500, error: error.message }
  const changed = ((data ?? []) as { id: string }[]).map(r => r.id)
  const unchanged = want.filter(i => !changed.includes(i))
  console.log(`media: bulk ${approve ? 'approve' : 'withdraw'} by ${actor}: ${changed.length} changed, ${unchanged.length} unchanged (ids ${changed.join(',')})`)
  return { ok: true, changed, unchanged }
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
      // Same spelling the importers write, so a hand edit is found by the same filter.
      p[k] = k === 'theme_slug' ? canonicalTheme(v as string | null) : (v as string | null)
    }
  }
  if ('activities' in body) {
    const a = body.activities
    if (!Array.isArray(a) || a.length > 20 || a.some(x => typeof x !== 'string' || !SAFE_TAG.test(x))) return { ok: false, error: 'activities: up to 20 lowercase tags.' }
    p.activities = canonicalActivities(a as string[])
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
