import crypto from 'crypto'

const COOKIE_NAME = 'hh_portal'
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 // 30 days in seconds
const TOKEN_EXPIRY_HOURS = 72

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
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(storedHash))
}

export function buildPortalUrl(bookingRef: string, rawToken: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.hosthampton.com'
  return `${baseUrl}/api/portal/auth?ref=${encodeURIComponent(bookingRef)}&token=${encodeURIComponent(rawToken)}`
}

export function buildPortalCookieValue(bookingRef: string, secret: string): string {
  const sig = crypto.createHmac('sha256', secret).update(`cookie:${bookingRef}`).digest('hex')
  return `${bookingRef}:${sig}`
}

export function setPortalCookieHeader(bookingRef: string, secret: string): string {
  const value = buildPortalCookieValue(bookingRef, secret)
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}; Secure`
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
