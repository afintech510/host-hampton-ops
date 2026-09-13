/**
 * Short links — /r/<code> (plan §25.3).
 *
 * Quo bills $0.01 per SMS SEGMENT, and a preview URL is 112 characters:
 *
 *   https://www.hosthampton.com/review/HH-2026-0042.<64 hex chars>
 *
 * 64 hex characters carry 256 bits; hex spends 8 bits of string on 4 bits of
 * entropy, so half of that is waste. 16 random bytes in base64url is 22
 * characters and 128 bits, which takes the whole URL to 48 — the difference
 * between a 2-segment and a 3-segment text on every draft, forever.
 *
 * ── This is not a new credential system ──────────────────────────────────
 *
 * The code IS the token. It is stored exactly as lib/agent/reviewLink.ts and
 * lib/portalAuth.ts store theirs: only the HMAC is persisted, so a read of
 * `short_links` cannot reconstruct a working link. The raw code exists only in
 * the SMS.
 *
 * 128 bits instead of 256 is a deliberate trade, and it is only safe because of
 * the two things standing beside it — `expires_at`, enforced on every read, and
 * the fact that the route is rate-limited. A bearer link that never expired
 * would not have earned the shorter code.
 *
 * ── Never use a public shortener ─────────────────────────────────────────
 *
 * bit.ly, tinyurl and friends are a well-known 10DLC spam signal and US
 * carriers filter messages containing them. The saving here comes from the
 * token, not from someone else's domain. This is why the module exists at all
 * rather than a two-line call to an API.
 */

import crypto from 'crypto'
import { siteUrl } from '@/lib/agent/config'

/** 16 bytes -> 22 base64url characters. See the header for why not 32. */
const CODE_BYTES = 16

/** Default life of a short link. Matches REVIEW_TOKEN_TTL_MS (§20). */
export const SHORT_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type ShortLinkKind = 'review' | 'slack' | 'portal'

export interface MintedShortLink {
  /** Raw code — goes in the SMS, never stored. */
  code: string
  /** HMAC of the raw code — this is what `short_links.code_hash` holds. */
  hash: string
  /** The full short URL. */
  url: string
}

function hmac(code: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`short:${code}`).digest('hex')
}

/**
 * Hosts a short link is allowed to point at.
 *
 * Slack permalinks live on `<workspace>.slack.com`, which is why that is here
 * and why it is matched as a SUFFIX — but a suffix match on a hostname has to
 * be anchored on a dot, or `evilslack.com` passes. `notslack.com` is the test
 * that matters, not `slack.com`.
 */
function allowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  let own: string
  try {
    own = new URL(siteUrl()).hostname.toLowerCase()
  } catch {
    own = 'www.hosthampton.com'
  }
  if (h === own) return true
  if (h === 'hosthampton.com' || h === 'www.hosthampton.com') return true
  if (h === 'slack.com' || h.endsWith('.slack.com')) return true
  return false
}

/**
 * Is this a URL we are willing to redirect a human to?
 *
 * PARSES, never prefix-matches. A prefix check on
 * `https://www.hosthampton.com` is satisfied by
 * `https://www.hosthampton.com.evil.test/` — the string starts with it, and the
 * host is somebody else's. This is the same lesson the content-pipeline URL
 * screen learned, and it is cheap to get right with the URL parser.
 *
 * Exported because a guarantee that is only enforced on the write path is not a
 * guarantee: the /r/ route re-screens what it read back out of the table.
 */
export function isAllowedTarget(target: string): boolean {
  let u: URL
  try {
    u = new URL(target)
  } catch {
    return false
  }
  // No javascript:, no data:, no http:// downgrade.
  if (u.protocol !== 'https:') return false
  // A username in the authority is how `https://www.hosthampton.com@evil.test`
  // reads as our host to a human and as evil.test to a browser.
  if (u.username || u.password) return false
  return allowedHost(u.hostname)
}

/** Mint a code. The raw value is returned once and never persisted. */
export function generateShortCode(secret: string): MintedShortLink {
  const code = crypto.randomBytes(CODE_BYTES).toString('base64url')
  return { code, hash: hmac(code, secret), url: buildShortUrl(code) }
}

/**
 * The short URL for a code.
 *
 * Deliberately drops a `www.` prefix — the site serves both, and those four
 * characters are four characters of every SMS. It keeps `https://`: some
 * clients do auto-link a bare `host/path`, but "some" is not good enough for
 * the link a lead's response depends on.
 */
export function buildShortUrl(code: string): string {
  const base = siteUrl().replace(/^https:\/\/www\./, 'https://')
  return `${base}/r/${code}`
}

/** Constant-time check of a presented code against a stored hash. */
export function validateShortCode(code: string, secret: string, storedHash: string | null): boolean {
  if (!code || !secret || !storedHash) return false
  const computed = hmac(code, secret)
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(storedHash))
  } catch {
    return false
  }
}

/** Hash a presented code so it can be looked up. Same HMAC as minting. */
export function hashShortCode(code: string, secret: string): string {
  return hmac(code, secret)
}

/**
 * Shape check before we ever touch the database.
 *
 * base64url of 16 bytes is always 22 characters from [A-Za-z0-9_-]. Anything
 * else is not a code we minted, so it is rejected without a query — which
 * keeps a scan of `/r/<sql injection>` off the database entirely.
 */
export function isWellFormedCode(code: string): boolean {
  return typeof code === 'string' && /^[A-Za-z0-9_-]{22}$/.test(code)
}

/* ── Minting against the database ──────────────────────────────────────── */

/** Minimal shape of the Supabase client this needs, so tests can fake it. */
interface ShortLinkDb {
  from(table: string): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>
  }
}

/**
 * Write a short link and return the raw code. `null` on ANY failure.
 *
 * Non-fatal by contract, and the callers depend on that: the reviewer SMS falls
 * back to the full-length URL rather than going out without a link. A lead
 * going unseen because the shortener had a bad day would be a far worse bug
 * than the two segments this saves — the same reasoning as §25.5's Slack
 * fallback, and the §18 lesson underneath both.
 */
export async function createShortLink(
  db: ShortLinkDb,
  opts: {
    target: string
    secret: string
    kind?: ShortLinkKind
    entityType?: string | null
    entityId?: string | null
    ttlMs?: number
    now?: Date
  },
): Promise<MintedShortLink | null> {
  if (!opts.secret) {
    console.error('[short-link] no signing secret — not minting')
    return null
  }
  // Screen on the way IN as well as on the way out. A target that would be
  // refused by /r/ has no business being stored in the first place.
  if (!isAllowedTarget(opts.target)) {
    console.error('[short-link] refusing to mint for target:', opts.target.slice(0, 80))
    return null
  }
  const minted = generateShortCode(opts.secret)
  try {
    const { error } = await db.from('short_links').insert({
      code_hash: minted.hash,
      target: opts.target,
      kind: opts.kind ?? 'review',
      entity_type: opts.entityType ?? null,
      entity_id: opts.entityId ?? null,
      expires_at: shortLinkExpiresAt(opts.now ?? new Date(), opts.ttlMs).toISOString(),
    })
    if (error) {
      console.error('[short-link] insert failed (non-fatal):', error.message)
      return null
    }
  } catch (err) {
    console.error('[short-link] insert threw (non-fatal):', err)
    return null
  }
  return minted
}

export function shortLinkExpiresAt(now: Date = new Date(), ttlMs = SHORT_LINK_TTL_MS): Date {
  return new Date(now.getTime() + ttlMs)
}

/**
 * Has this link expired? An UNKNOWN or unparseable expiry counts as EXPIRED.
 *
 * Same direction as isReviewTokenExpired: a row with no usable timestamp is not
 * evidence that the link is fresh, and the whole point of a TTL is that a
 * forwarded link stops working.
 */
export function isShortLinkExpired(expiresAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return true
  const t = new Date(expiresAt).getTime()
  if (!Number.isFinite(t)) return true
  return now.getTime() >= t
}
