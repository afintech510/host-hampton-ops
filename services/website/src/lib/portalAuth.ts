import crypto from 'crypto'
import { CANONICAL_ORIGIN } from './publicOrigin'

const COOKIE_NAME = 'hh_portal'
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 // 30 days in seconds
// Magic-link lifetime. Matches COOKIE_MAX_AGE so a customer who clicks their
// planner link on day 29 still gets in, and the session it hands out lasts as
// long as the link itself. Every email/SMS that contains a planner link mints
// a fresh token, so this is a floor on "how long is an old email still good".
const TOKEN_EXPIRY_HOURS = 30 * 24 // 30 days

export function generatePortalToken(
  bookingRef: string,
  secret: string,
  expiryHours = TOKEN_EXPIRY_HOURS
): { token: string; hash: string; expiresAt: Date } {
  const raw = crypto.randomBytes(32).toString('hex')
  const token = `${bookingRef}:${raw}`
  const hash = crypto.createHmac('sha256', secret).update(token).digest('hex')
  const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000)
  return { token: raw, hash, expiresAt }
}

export function validatePortalToken(
  bookingRef: string,
  rawToken: string,
  secret: string,
  storedHash: string
): boolean {
  const token = `${bookingRef}:${rawToken}`
  const computed = crypto.createHmac('sha256', secret).update(token).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(storedHash))
  } catch {
    // timingSafeEqual throws on a length mismatch (malformed/legacy hash row) —
    // treat that as "not this token" rather than a 500 on the auth route.
    return false
  }
}

export function buildPortalUrl(bookingRef: string, rawToken: string, redirect?: string): string {
  const baseUrl = CANONICAL_ORIGIN
  let url = `${baseUrl}/api/portal/auth?ref=${encodeURIComponent(bookingRef)}&token=${encodeURIComponent(rawToken)}`
  if (redirect) url += `&redirect=${encodeURIComponent(redirect)}`
  return url
}

/* ── Session expiry, which these cookies did not have ─────────────────────
 *
 * Until 2026-09-12 the value was `<ref>:HMAC("cookie:" + ref)`. Nothing in it
 * varied — measured in production, two derivations a second apart were
 * byte-identical — so:
 *
 *   * `Max-Age=30 days` was a HINT TO THE BROWSER and nothing else. A copy of
 *     the value kept anywhere (a shared laptop, a proxy log, a screenshot)
 *     authenticated that booking **forever**.
 *   * There was no revocation short of rotating `PORTAL_LINK_SIGNING_SECRET`,
 *     which AGENTS.md §7 says not to do because it also kills every outstanding
 *     unsubscribe link and every tracked link.
 *
 * `lib/adminAuth.ts` already solved exactly this for `hh_admin` — the expiry
 * lives INSIDE the signed payload, so a client cannot extend it — and the
 * portal, which is the older surface, never got it. Rule 11: a concept defined
 * twice is a concept nothing is checking. The payload shape below is
 * deliberately the same one (`<subject>:<issuedAtMs>:<sig>`).
 *
 * ── Why the legacy form is still accepted, and until when ────────────────
 *
 * Rejecting it outright signs out every customer holding a live session, on a
 * revenue path, to close a hole that requires somebody to have stolen the
 * cookie already. Instead a legacy cookie is honoured until `LEGACY_SUNSET_MS`
 * — a date in code, roughly a full cookie lifetime past the deploy — by which
 * point every browser has either been re-issued a v2 cookie on its next
 * authenticated request or dropped the old one on its own `Max-Age`. After that
 * date the two-part form is simply invalid and no deploy is needed to make it
 * so.
 */
const LEGACY_SUNSET_MS = Date.parse('2026-10-20T00:00:00Z')

function signPortalSession(bookingRef: string, issuedAtMs: number, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`cookie:${bookingRef}:${issuedAtMs}`)
    .digest('hex')
}

export function buildPortalCookieValue(
  bookingRef: string,
  secret: string,
  issuedAtMs = Date.now()
): string {
  return `${bookingRef}:${issuedAtMs}:${signPortalSession(bookingRef, issuedAtMs, secret)}`
}

export function setPortalCookieHeader(bookingRef: string, secret: string, isInsecure = false): string {
  const value = buildPortalCookieValue(bookingRef, secret)
  const secureFlag = isInsecure ? '' : '; Secure'
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}${secureFlag}`
}

function hmacEquals(a: string, b: string): boolean {
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    // timingSafeEqual throws on a length mismatch (a forged or legacy value) —
    // that is "not this signature", not a 500.
    return false
  }
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null
  const found = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith(`${name}=`))
  return found ? found.slice(name.length + 1) : null
}

export function getPortalBookingRef(
  cookieHeader: string | null,
  secret: string,
  now: number = Date.now()
): string | null {
  const value = readCookie(cookieHeader, COOKIE_NAME)
  if (!value) return null

  const parts = value.split(':')

  // Current form: <ref>:<issuedAtMs>:<sig>
  if (parts.length === 3) {
    const [bookingRef, issuedRaw, sig] = parts
    const issuedAtMs = Number(issuedRaw)
    if (!bookingRef || !Number.isFinite(issuedAtMs)) return null
    if (!hmacEquals(sig, signPortalSession(bookingRef, issuedAtMs, secret))) return null
    // A clock that says the cookie was issued in the future is not a cookie we
    // understand; expiring it is the safe direction.
    if (issuedAtMs > now + 60_000) return null
    if (now - issuedAtMs > COOKIE_MAX_AGE * 1000) return null
    return bookingRef
  }

  // Legacy form: <ref>:<sig>, no expiry. Honoured until the sunset above.
  if (parts.length === 2) {
    if (now >= LEGACY_SUNSET_MS) return null
    const [bookingRef, sig] = parts
    if (!bookingRef) return null
    const expected = crypto.createHmac('sha256', secret).update(`cookie:${bookingRef}`).digest('hex')
    return hmacEquals(sig, expected) ? bookingRef : null
  }

  return null
}

export function clearPortalCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`
}

/* ── Email-based login (multi-booking) ─────────────────────────
 * Separate cookie from the per-booking portal cookie. Lets a returning
 * customer pick from all bookings tied to their email address.
 */

const EMAIL_COOKIE_NAME = 'hh_portal_email'
const EMAIL_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 // 30 days
const EMAIL_CODE_TTL_MS = 15 * 60 * 1000 // 15 minutes
const EMAIL_CODE_MAX_ATTEMPTS = 5

export function generateEmailLoginCode(): { code: string; expiresAt: Date } {
  // 6-digit numeric, padded — generated from crypto for uniformity
  const n = crypto.randomInt(0, 1_000_000)
  const code = String(n).padStart(6, '0')
  const expiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MS)
  return { code, expiresAt }
}

export function hashEmailLoginCode(code: string, email: string, secret: string): string {
  // Email is part of the HMAC payload so a code stolen via DB read can't be
  // replayed against a different email row.
  return crypto.createHmac('sha256', secret).update(`emailcode:${email.toLowerCase()}:${code}`).digest('hex')
}

export function verifyEmailLoginCode(submittedCode: string, email: string, storedHash: string, secret: string): boolean {
  const computed = hashEmailLoginCode(submittedCode, email, secret)
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(storedHash))
  } catch {
    return false
  }
}

export function getEmailCodeMaxAttempts(): number {
  return EMAIL_CODE_MAX_ATTEMPTS
}

function signEmailSession(email: string, issuedAtMs: number, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`emailcookie:${email}:${issuedAtMs}`)
    .digest('hex')
}

export function buildEmailCookieValue(email: string, secret: string, issuedAtMs = Date.now()): string {
  const normalized = email.toLowerCase()
  return `${encodeURIComponent(normalized)}:${issuedAtMs}:${signEmailSession(normalized, issuedAtMs, secret)}`
}

export function setEmailCookieHeader(email: string, secret: string, isInsecure = false): string {
  const value = buildEmailCookieValue(email, secret)
  const secureFlag = isInsecure ? '' : '; Secure'
  return `${EMAIL_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${EMAIL_COOKIE_MAX_AGE}${secureFlag}`
}

/**
 * The address this session names, or null. See the note above
 * `signPortalSession` for why the expiry is inside the signature and why the
 * two-part legacy form is still honoured until `LEGACY_SUNSET_MS`.
 */
export function getEmailFromCookie(
  cookieHeader: string | null,
  secret: string,
  now: number = Date.now()
): string | null {
  const value = readCookie(cookieHeader, EMAIL_COOKIE_NAME)
  if (!value) return null

  const parts = value.split(':')
  const decode = (raw: string): string | null => {
    try { return decodeURIComponent(raw).toLowerCase() } catch { return null }
  }

  if (parts.length === 3) {
    const email = decode(parts[0])
    const issuedAtMs = Number(parts[1])
    if (!email || !Number.isFinite(issuedAtMs)) return null
    if (!hmacEquals(parts[2], signEmailSession(email, issuedAtMs, secret))) return null
    if (issuedAtMs > now + 60_000) return null
    if (now - issuedAtMs > EMAIL_COOKIE_MAX_AGE * 1000) return null
    return email
  }

  if (parts.length === 2) {
    if (now >= LEGACY_SUNSET_MS) return null
    const email = decode(parts[0])
    if (!email) return null
    const expected = crypto.createHmac('sha256', secret).update(`emailcookie:${email}`).digest('hex')
    return hmacEquals(parts[1], expected) ? email : null
  }

  return null
}

export function clearEmailCookieHeader(): string {
  return `${EMAIL_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`
}
