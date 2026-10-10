/**
 * The RSVP edit token (spec §7.5): a signed, stateless, expiring, nonce-revocable
 * credential for ONE guest's answer.
 *
 *   <rsvpId>.<expEpochSec>.<sig>
 *   sig = base64url( HMAC-SHA256( portalSigningSecret(), "evite-rsvp:" + rsvpId + ":" + edit_nonce + ":" + exp ) )
 *
 * Stateless so a cron can build the link in an email with no stored token: the
 * `edit_nonce` is on the row and the secret is the same one that signs portal
 * links. `exp` is the party's end plus 30 days. Revoke one token by rotating that
 * row's `edit_nonce`; revoke them all by rotating the secret (which also kills
 * every unsubscribe link: do not).
 *
 * VERIFYING needs the row: the nonce is not in the token. `verifyEditToken` reads
 * `(id, evite_id, edit_nonce)` filtered on BOTH the id and the evite the request
 * is for, so another party's token is "no such row" (and so an invalid token), and
 * answers THREE ways because a database blip is not a forged token:
 *
 *   { ok: true,  rsvpId }
 *   { ok: false, reason: 'invalid' | 'expired' }   forged, malformed, unknown rsvp, wrong evite, revoked nonce
 *   { ok: false, reason: 'unavailable' }           the read failed; callers answer 503, never "log in again"
 *
 * 'invalid' and 'expired' are the SAME answer to a caller (401 / a plain redirect):
 * a failed link and an unknown link say the same thing (AGENTS.md). The reason is
 * for tests and logs.
 *
 * The compare is constant-time with a length guard (`timingSafeEqual` throws on a
 * length mismatch). `portalSigningSecret()` throws in production when unset and
 * is never given a literal fallback here.
 */

import crypto from 'crypto'
import type { getSupabase } from '@/lib/supabase'
import { portalSigningSecret } from '@/lib/portalAuth'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { etToUtc } from '@/lib/partyTime'

type Supa = ReturnType<typeof getSupabase>

/** An edit link outlives the party by this long (spec §7.5). */
export const EDIT_TOKEN_GRACE_DAYS = 30
/** `edit_nonce` is 16 characters (the table CHECK). */
export const EDIT_NONCE_LENGTH = 16

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EXP = /^\d{1,12}$/
const SIG = /^[A-Za-z0-9_-]{43}$/

/** A fresh `edit_nonce`: 12 random bytes as base64url is exactly 16 characters. */
export function newEditNonce(): string {
  const n = crypto.randomBytes(12).toString('base64url')
  if (n.length !== EDIT_NONCE_LENGTH) throw new Error('evites/rsvpToken: edit_nonce is not 16 characters')
  return n
}

function mac(rsvpId: string, nonce: string, exp: number): string {
  return crypto.createHmac('sha256', portalSigningSecret()).update(`evite-rsvp:${rsvpId}:${nonce}:${exp}`).digest('base64url')
}

/**
 * The expiry (epoch SECONDS) for a party: its end plus 30 days. With no window,
 * the end of the party DATE (23:59 Eastern) plus 30 days. Null when neither is
 * usable: the caller must not mint a token that never expires.
 */
export function editTokenExpiry(window: { endUtc: Date } | null | undefined, partyDate?: string | null): number | null {
  let endMs: number | null = null
  if (window && Number.isFinite(window.endUtc.getTime())) endMs = window.endUtc.getTime()
  else if (typeof partyDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(partyDate)) {
    const t = etToUtc(partyDate.slice(0, 10), 23, 59).getTime()
    if (Number.isFinite(t)) endMs = t
  }
  if (endMs === null) return null
  return Math.floor(endMs / 1000) + EDIT_TOKEN_GRACE_DAYS * 86_400
}

export function signEditToken(rsvp: { id: string; edit_nonce: string }, exp: number): string {
  if (!UUID.test(rsvp.id)) throw new Error('evites/rsvpToken: rsvp id is not a uuid')
  if (rsvp.edit_nonce.length !== EDIT_NONCE_LENGTH) throw new Error('evites/rsvpToken: edit_nonce is not 16 characters')
  if (!Number.isInteger(exp) || exp <= 0) throw new Error('evites/rsvpToken: exp must be a positive whole number of seconds')
  return `${rsvp.id}.${exp}.${mac(rsvp.id, rsvp.edit_nonce, exp)}`
}

/** The shape of a token, with nothing checked against the database. Null when it is not even that. */
export function parseEditToken(token: unknown): { rsvpId: string; exp: number; sig: string } | null {
  if (typeof token !== 'string' || token.length > 200) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [rsvpId, expRaw, sig] = parts
  if (!UUID.test(rsvpId) || !EXP.test(expRaw) || !SIG.test(sig)) return null
  const exp = Number(expRaw)
  if (!Number.isSafeInteger(exp) || exp <= 0) return null
  return { rsvpId: rsvpId.toLowerCase(), exp, sig }
}

export type VerifyEditTokenResult =
  | { ok: true; rsvpId: string; exp: number }
  | { ok: false; reason: 'invalid' | 'expired' | 'unavailable' }

export async function verifyEditToken(supabase: Supa, token: unknown, eviteId: string, now: Date = new Date()): Promise<VerifyEditTokenResult> {
  const parsed = parseEditToken(token)
  if (!parsed) return { ok: false, reason: 'invalid' }
  if (parsed.exp * 1000 <= now.getTime()) return { ok: false, reason: 'expired' }

  const read = await supabase
    .from('evite_rsvps')
    .select('id, evite_id, edit_nonce')
    .eq('id', parsed.rsvpId)
    .eq('evite_id', eviteId)
    .maybeSingle<{ id: string; evite_id: string; edit_nonce: string }>()
  if (read.error) {
    console.error(`evites/rsvpToken: rsvp read failed: ${read.error.message}`)
    return { ok: false, reason: 'unavailable' }
  }
  const row = read.data
  if (!row || row.evite_id !== eviteId || typeof row.edit_nonce !== 'string') return { ok: false, reason: 'invalid' }

  const expected = Buffer.from(mac(row.id, row.edit_nonce, parsed.exp))
  const given = Buffer.from(parsed.sig)
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return { ok: false, reason: 'invalid' }
  return { ok: true, rsvpId: row.id, exp: parsed.exp }
}

/** The absolute edit link for an email or text. CANONICAL_ORIGIN, never a request header. */
export function editLink(slug: string, token: string): string {
  return `${CANONICAL_ORIGIN}/i/${slug}/rsvp/${token}`
}

/** `hh_rsvp_<first 8 hex of the evite id>`: one cookie per invitation, so two parties on one phone do not collide. */
export function cookieName(eviteId: string): string {
  return `hh_rsvp_${eviteId.replace(/-/g, '').slice(0, 8)}`
}
