/**
 * Extra pictures on an invitation PAGE (migration 101, `evites.extra_images`). Pure helpers only: a browser component imports this file, so it must never import sharp or a node module (see extraImagesProcess.ts).
 *
 *   screenExtraImagesValue(v)        the stored jsonb -> a safe list ({ object, alt }), never throwing
 *   extraImageUrls(evite, supabase)  [{ url, alt }] for the page and the host view ('' when there is no image_key)
 *   cleanExtraAlt(v)                 a typed description -> trimmed, control characters removed, <= 120 chars
 *
 * The picture lives in Storage `evites/<image_key>/<object>`, the party's own folder (as public as the
 * invitation itself). The object name is random; no file name is ever read, stored or logged. The
 * value is screened again on the way out, so a row written some other way cannot reach an `<img src>`.
 */

export const MAX_EXTRA_IMAGES = 4
export const EXTRA_ALT_MAX = 120
export const EXTRA_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const EXTRA_IMAGE_MAX_WIDTH = 1200
export const EXTRA_OBJECT = /^extra-[0-9a-f]{16}\.jpg$/
const IMAGE_KEY = /^[0-9a-f]{32}$/

export interface ExtraImage {
  object: string
  alt: string
}

export interface ExtraImageView extends ExtraImage {
  url: string
}

export function cleanExtraAlt(v: unknown): string {
  if (typeof v !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, EXTRA_ALT_MAX)
}

/** The stored jsonb as a safe list: valid entries only, at most four, no duplicates. */
export function screenExtraImagesValue(v: unknown): ExtraImage[] {
  if (!Array.isArray(v)) return []
  const out: ExtraImage[] = []
  const seen = new Set<string>()
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const o = (item as { object?: unknown }).object
    if (typeof o !== 'string' || !EXTRA_OBJECT.test(o) || seen.has(o)) continue
    seen.add(o)
    out.push({ object: o, alt: cleanExtraAlt((item as { alt?: unknown }).alt) })
    if (out.length >= MAX_EXTRA_IMAGES) break
  }
  return out
}

export function extraImageUrls(
  evite: { image_key?: string | null; extra_images?: unknown },
  supabaseUrl: string | undefined,
): ExtraImageView[] {
  const key = evite.image_key
  const base = (supabaseUrl ?? '').trim().replace(/\/+$/, '')
  if (!base || typeof key !== 'string' || !IMAGE_KEY.test(key)) return []
  return screenExtraImagesValue(evite.extra_images).map((e) => ({
    ...e,
    url: `${base}/storage/v1/object/public/evites/${key}/${e.object}`,
  }))
}
