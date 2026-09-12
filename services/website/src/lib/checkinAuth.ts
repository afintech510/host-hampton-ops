import crypto from 'crypto'
import { etToUtc } from '@/lib/partyTime'
import { CANONICAL_ORIGIN } from './publicOrigin'

/**
 * Pre-arrival check-in link tokens.
 *
 * Mirrors lib/portalAuth.ts: the raw token is random (never derived from the
 * booking ref, which is guessable — HH-2026-0042), and only an HMAC of it is
 * stored. A DB read therefore cannot be replayed as a working link.
 *
 * Unlike the portal token, the check-in token is NOT namespaced by booking ref:
 * the check-in URL is /checkin/<token> with nothing else in it, so the token has
 * to be self-identifying. We look the booking up *by* the hash.
 */

/**
 * How long a minted link stays good. Deliberately generous — the 36hr text and
 * the 6am-day-of text share nothing but the booking, and a customer may open
 * either one. The real cutoff is the event itself (see isExpiredForBooking).
 */
const TOKEN_EXPIRY_HOURS = 45 * 24 // 45 days

export function getCheckinSecret(): string {
  // Reuses the portal link secret so there is one signing key to rotate, not two.
  return process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
}

export function hashCheckinToken(rawToken: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`checkin:${rawToken}`).digest('hex')
}

export function generateCheckinToken(
  secret: string,
  expiryHours = TOKEN_EXPIRY_HOURS
): { token: string; hash: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString('hex')
  const hash = hashCheckinToken(token, secret)
  const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000)
  return { token, hash, expiresAt }
}

export function validateCheckinToken(
  rawToken: string,
  secret: string,
  storedHash: string
): boolean {
  const computed = hashCheckinToken(rawToken, secret)
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(storedHash))
  } catch {
    // timingSafeEqual throws on a length mismatch (malformed/legacy hash row) —
    // treat that as "not this token" rather than a 500 on the public route.
    return false
  }
}

export function buildCheckinUrl(rawToken: string): string {
  const baseUrl = CANONICAL_ORIGIN
  return `${baseUrl}/checkin/${encodeURIComponent(rawToken)}`
}

/**
 * A check-in link is dead once the party is over — there is nothing useful left
 * to collect and the page would otherwise expose booking details indefinitely.
 *
 * We expire at END of the party day in local terms rather than at the party
 * start time, so someone opening the link on the morning of still gets in, and
 * a late-running party doesn't lock staff out. party_date is a plain DATE.
 */
export function isExpiredForParty(partyDate: string | null | undefined, now: Date = new Date()): boolean {
  if (!partyDate) return false // no date on file — don't expire it, let staff sort it out
  // 11:59:59pm Eastern on the party date. Goes through etToUtc rather than a
  // fixed -04:00 so a party in November doesn't expire an hour early.
  const cutoff = etToUtc(partyDate, 23, 59)
  if (Number.isNaN(cutoff.getTime())) return false
  return now.getTime() > cutoff.getTime()
}
