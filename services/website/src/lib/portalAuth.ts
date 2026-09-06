import crypto from 'crypto'

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
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.hosthampton.com'
  let url = `${baseUrl}/api/portal/auth?ref=${encodeURIComponent(bookingRef)}&token=${encodeURIComponent(rawToken)}`
  if (redirect) url += `&redirect=${encodeURIComponent(redirect)}`
  return url
}

export function buildPortalCookieValue(bookingRef: string, secret: string): string {
  const sig = crypto.createHmac('sha256', secret).update(`cookie:${bookingRef}`).digest('hex')
  return `${bookingRef}:${sig}`
}

export function setPortalCookieHeader(bookingRef: string, secret: string, isInsecure = false): string {
  const value = buildPortalCookieValue(bookingRef, secret)
  const secureFlag = isInsecure ? '' : '; Secure'
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}${secureFlag}`
}

export function getPortalBookingRef(cookieHeader: string | null, secret: string): string | null {
  if (!cookieHeader) return null

  const cookies = cookieHeader.split(';').map(c => c.trim())
  const portal = cookies.find(c => c.startsWith(`${COOKIE_NAME}=`))
  if (!portal) return null

  const value = portal.slice(COOKIE_NAME.length + 1)
  const sepIdx = value.lastIndexOf(':')
  if (sepIdx === -1) return null

  const bookingRef = value.slice(0, sepIdx)
  const sig = value.slice(sepIdx + 1)

  const expected = crypto.createHmac('sha256', secret).update(`cookie:${bookingRef}`).digest('hex')
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  } catch {
    return null
  }

  return bookingRef
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

export function setEmailCookieHeader(email: string, secret: string, isInsecure = false): string {
  const normalized = email.toLowerCase()
  const sig = crypto.createHmac('sha256', secret).update(`emailcookie:${normalized}`).digest('hex')
  const value = `${encodeURIComponent(normalized)}:${sig}`
  const secureFlag = isInsecure ? '' : '; Secure'
  return `${EMAIL_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${EMAIL_COOKIE_MAX_AGE}${secureFlag}`
}

export function getEmailFromCookie(cookieHeader: string | null, secret: string): string | null {
  if (!cookieHeader) return null

  const cookies = cookieHeader.split(';').map(c => c.trim())
  const target = cookies.find(c => c.startsWith(`${EMAIL_COOKIE_NAME}=`))
  if (!target) return null

  const value = target.slice(EMAIL_COOKIE_NAME.length + 1)
  const sepIdx = value.lastIndexOf(':')
  if (sepIdx === -1) return null

  let email = value.slice(0, sepIdx)
  const sig = value.slice(sepIdx + 1)
  try { email = decodeURIComponent(email) } catch { return null }
  email = email.toLowerCase()

  const expected = crypto.createHmac('sha256', secret).update(`emailcookie:${email}`).digest('hex')
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  } catch {
    return null
  }
  return email
}

export function clearEmailCookieHeader(): string {
  return `${EMAIL_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`
}
