import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import type { getSupabase } from '@/lib/supabase'
import { TENANT } from '@/tenant'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { portalSigningSecret } from '@/lib/portalAuth'
import { findPhotos, MAX_PHOTOS_PER_REQUEST, type Photo } from '@/lib/media'
import { escapeHtml } from '@/lib/escapeHtml'
import { mailHrefExternal } from '@/lib/emailSafety'

/**
 * The photos an admin sends a family: a SET behind a signed link.
 *
 * SMS carries the link, never the pictures (no MMS — a photo of a party is a
 * large message and a carrier-filtered one, and we have no way to know what a
 * family's plan costs them). The link opens `/p/<token>`, which lists the
 * chosen photos. Email carries the same photos inline.
 *
 * What the token is. `<code><sig>`: a 10-character random code (the row's
 * primary key in `photo_sets`) followed by 8 characters of an HMAC over it, so
 * a made-up link is refused without touching the database, and a guessed code
 * needs the signature as well. It is the capability to see these photos and
 * nothing else — it names no booking, no person, no price.
 *
 * What the page shows. Only the photo IDS are stored; the page re-reads them
 * through `findPhotos` on every view, so a photo that is un-approved or flagged
 * as possibly showing a child AFTER the link went out stops being served on that
 * link too. Links expire after PHOTO_SET_TTL_DAYS.
 */

type Supa = ReturnType<typeof getSupabase>

export const PHOTO_SET_TTL_DAYS = 30
const CODE_LEN = 10
const SIG_LEN = 8
// No 0/O/1/l/I: a link read aloud or retyped from a text survives.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

function sign(code: string, secret: string): string {
  return createHmac('sha256', `photo-set:${secret}`)
    .update(code)
    .digest('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, SIG_LEN)
    .toLowerCase()
}

export function newPhotoSetCode(): string {
  const bytes = randomBytes(CODE_LEN)
  let out = ''
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

export function photoSetToken(code: string, secret = portalSigningSecret()): string {
  return `${code}${sign(code, secret)}`
}

/** The code inside a well-formed, correctly signed token, or null. Never throws. */
export function verifyPhotoSetToken(token: unknown, secret = portalSigningSecret()): string | null {
  if (typeof token !== 'string' || token.length !== CODE_LEN + SIG_LEN) return null
  const code = token.slice(0, CODE_LEN)
  if (!code.split('').every(ch => ALPHABET.includes(ch))) return null
  const given = Buffer.from(token.slice(CODE_LEN))
  const expected = Buffer.from(sign(code, secret))
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  return code
}

export function photoSetUrl(token: string): string {
  return `${CANONICAL_ORIGIN}/p/${token}`
}

export type CreateSet = { ok: true; token: string; url: string } | { ok: false; error: string }

export async function createPhotoSet(
  sb: Supa,
  opts: { bookingId: string; photoIds: string[]; actor: string; now?: Date },
): Promise<CreateSet> {
  const ids = Array.from(new Set(opts.photoIds)).slice(0, MAX_PHOTOS_PER_REQUEST)
  if (ids.length === 0) return { ok: false, error: 'No photos to send.' }
  const code = newPhotoSetCode()
  const now = opts.now ?? new Date()
  const { error } = await sb.from('photo_sets').insert({
    code,
    booking_id: opts.bookingId,
    photo_ids: ids,
    created_by: opts.actor,
    expires_at: new Date(now.getTime() + PHOTO_SET_TTL_DAYS * 86_400_000).toISOString(),
  })
  if (error) return { ok: false, error: `Could not save the photo set (${error.message}).` }
  const token = photoSetToken(code)
  return { ok: true, token, url: photoSetUrl(token) }
}

export type LoadedSet = { kind: 'ok'; photos: Photo[] } | { kind: 'gone' } | { kind: 'unavailable' }

/**
 * A set's photos, in the order they were chosen. Unknown, expired, tampered and
 * "every photo has since been withdrawn" all answer `gone` — the page does not
 * say which, so a guessed link learns nothing.
 */
export async function loadPhotoSet(sb: Supa, token: unknown, now = new Date()): Promise<LoadedSet> {
  const code = verifyPhotoSetToken(token)
  if (!code) return { kind: 'gone' }
  const { data, error } = await sb.from('photo_sets').select('photo_ids, expires_at').eq('code', code).maybeSingle()
  if (error) return { kind: 'unavailable' }
  if (!data) return { kind: 'gone' }
  const row = data as { photo_ids: string[]; expires_at: string }
  if (new Date(row.expires_at).getTime() < now.getTime()) return { kind: 'gone' }
  const found = await findPhotos(sb, { ids: row.photo_ids, limit: MAX_PHOTOS_PER_REQUEST })
  if (found.kind !== 'ok') return { kind: 'unavailable' }
  const order = new Map(row.photo_ids.map((id, i) => [id, i]))
  const photos = [...found.data].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  return photos.length ? { kind: 'ok', photos } : { kind: 'gone' }
}

/* ── the words ────────────────────────────────────────────────────────── */

function firstName(name: string | null | undefined): string {
  return (name || '').trim().split(/\s+/)[0] || 'there'
}

export const PHOTOS_EMAIL_SUBJECT = `Some party photos from ${TENANT.business.name} 📸`

/** The SMS: one short link, signed by the customer sign-off, with the opt-out line. */
export function photosSmsText(contactName: string | null | undefined, url: string, count: number): string {
  return [
    `Hi ${firstName(contactName)}! It's ${TENANT.people.customerSignoff} from ${TENANT.business.name} 🎉`,
    `Here ${count === 1 ? 'is a photo' : `are ${count} photos`} from our parties: ${url}`,
    'Reply STOP to opt out',
  ].join('\n')
}

/** The plain-text half of the email. Never escaped — it is not markup. */
export function photosEmailText(contactName: string | null | undefined, photos: Photo[], url: string): string {
  return [
    `Hi ${firstName(contactName)},`,
    '',
    `Here ${photos.length === 1 ? 'is a photo' : 'are some photos'} from our parties:`,
    ...photos.map(p => `- ${p.alt || 'Party photo'}: ${p.url}`),
    '',
    `See them all here: ${url}`,
    '',
    `${TENANT.people.customerSignoff}`,
    TENANT.business.name,
  ].join('\n')
}

/**
 * The email, with the photos inline. Text is escaped; every image and link URL
 * goes through `mailHrefExternal` (https only, no `javascript:`/`data:`), so a
 * refused URL renders no image rather than a raw one.
 */
export function photosEmailHtml(contactName: string | null | undefined, photos: Photo[], url: string): string {
  const name = escapeHtml(firstName(contactName))
  const imgs = photos
    .map(p => {
      const src = mailHrefExternal(p.url)
      if (!src) return ''
      return `<p style="margin:0 0 16px;"><img src="${src}" alt="${escapeHtml(p.alt || 'Party photo')}" width="560" style="display:block;width:100%;max-width:560px;height:auto;border-radius:10px;border:0;"></p>`
    })
    .join('\n  ')
  const link = mailHrefExternal(url)
  const signoff = escapeHtml(TENANT.people.customerSignoff)
  const biz = escapeHtml(TENANT.business.name)
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:24px 16px;background:#ffffff;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#333333;max-width:600px;margin:0 auto;">
  <p style="margin:0 0 16px;line-height:1.6;">Hi ${name},</p>
  <p style="margin:0 0 16px;line-height:1.6;">Here ${photos.length === 1 ? 'is a photo' : 'are some photos'} from our parties:</p>
  ${imgs}
  ${link ? `<p style="margin:0 0 16px;line-height:1.6;">See them all here: <a href="${link}" style="color:#1a2744;font-weight:bold;word-break:break-all;">${link}</a></p>` : ''}
  <p style="margin:0 0 16px;line-height:1.6;">${signoff}<br>${biz}</p>
</div>
</body></html>`
}
