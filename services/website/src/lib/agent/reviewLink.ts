/**
 * Tokenised preview links for /review/<token>.
 *
 * Same shape as lib/portalAuth.ts: a random secret is generated once, only its
 * HMAC is stored (`inquiry_drafts.preview_token_hash`), and the raw value only
 * ever exists in the SMS we send to a reviewer phone. A DB read alone cannot
 * reconstruct a working link.
 *
 * The token carries the draft's review code as a prefix so the page can find
 * the row without an extra lookup table:  HH-2026-0042.<64 hex chars>
 */

import crypto from 'crypto'

const SEP = '.'

export interface ReviewToken {
  /** Raw token — goes in the SMS, never stored. */
  token: string
  /** HMAC of the raw token — stored in preview_token_hash. */
  hash: string
}

function hmac(token: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`review:${token}`).digest('hex')
}

/** Mint a preview token for a draft. */
export function generateReviewToken(reviewCode: string, secret: string): ReviewToken {
  const raw = crypto.randomBytes(32).toString('hex')
  const token = `${reviewCode}${SEP}${raw}`
  return { token, hash: hmac(token, secret) }
}

/** The review code embedded in a token, or null when it is malformed. */
export function reviewCodeFromToken(token: string): string | null {
  const idx = token.indexOf(SEP)
  if (idx <= 0 || idx === token.length - 1) return null
  return token.slice(0, idx)
}

/** Constant-time check of a presented token against the stored hash. */
export function validateReviewToken(token: string, secret: string, storedHash: string | null): boolean {
  if (!token || !secret || !storedHash) return false
  const computed = hmac(token, secret)
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(storedHash))
  } catch {
    // Length mismatch (malformed/legacy hash) — treat as "not this token".
    return false
  }
}

/* ── Expiry (plan §11.1) ────────────────────────────────────────────────── */

/**
 * How long a preview link stays good for.
 *
 * A preview token is a bearer credential in a URL, so it is forwardable: an SMS
 * screenshot in a group chat is a working link for whoever receives it. Until
 * now those links never expired. Seven days matches the admin session TTL and
 * is well past the useful life of a draft — a draft nobody has acted on in a
 * week is not being reviewed, it is being forgotten, and the fix for that is a
 * nudge, not an immortal link.
 *
 * The token itself carries no timestamp (changing its shape would invalidate
 * every live link), so age is taken from the DRAFT ROW — which works because
 * the token is minted exactly when that timestamp is written, on all three
 * paths that mint one: the first draft (`created_at`), a re-draft, and an admin
 * edit (both `sent_for_review_at`). If a fourth mint site ever appears without
 * touching `sent_for_review_at`, it will hand out a link that is born expired,
 * which is the safe direction to fail.
 */
export const REVIEW_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** When the link minted at `mintedAt` stops working, or null if unknown. */
export function reviewTokenExpiresAt(mintedAt: string | null | undefined): Date | null {
  if (!mintedAt) return null
  const t = new Date(mintedAt).getTime()
  if (!Number.isFinite(t)) return null
  return new Date(t + REVIEW_TOKEN_TTL_MS)
}

/**
 * Has this link expired? An UNKNOWN mint time counts as expired: a row with no
 * usable timestamp is not evidence that the link is fresh, and the whole point
 * of the TTL is that a forwarded link stops working.
 */
export function isReviewTokenExpired(mintedAt: string | null | undefined, now: Date = new Date()): boolean {
  const expiresAt = reviewTokenExpiresAt(mintedAt)
  if (!expiresAt) return true
  return now.getTime() >= expiresAt.getTime()
}

export function buildReviewUrl(token: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/review/${encodeURIComponent(token)}`
}

/**
 * Human-facing draft code used in the SMS thread, e.g. HH-2026-0042.
 * Random (not sequential) so two dispatcher runs can never collide on it; the
 * DB's UNIQUE constraint on review_code is the real guarantee.
 */
export function generateReviewCode(now: Date = new Date()): string {
  const n = crypto.randomInt(0, 10000)
  return `HH-${now.getUTCFullYear()}-${String(n).padStart(4, '0')}`
}
