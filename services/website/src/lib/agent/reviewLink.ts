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
