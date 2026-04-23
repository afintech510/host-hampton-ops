import {
  generatePortalToken,
  validatePortalToken,
  buildPortalCookieValue,
  getPortalBookingRef,
  setPortalCookieHeader,
  clearPortalCookieHeader,
} from '@/lib/portalAuth'

const SECRET = 'test-secret-key-for-unit-tests-only'
const BOOKING_REF = 'HH-PTY-ABC12'

describe('generatePortalToken', () => {
  it('returns token, hash, and expiry', () => {
    const result = generatePortalToken(BOOKING_REF, SECRET)
    expect(result.token).toBeTruthy()
    expect(result.hash).toBeTruthy()
    expect(result.expiresAt).toBeInstanceOf(Date)
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('generates different tokens each call', () => {
    const a = generatePortalToken(BOOKING_REF, SECRET)
    const b = generatePortalToken(BOOKING_REF, SECRET)
    expect(a.token).not.toBe(b.token)
    expect(a.hash).not.toBe(b.hash)
  })

  it('respects custom expiry', () => {
    const result = generatePortalToken(BOOKING_REF, SECRET, 1) // 1 hour
    const diff = result.expiresAt.getTime() - Date.now()
    expect(diff).toBeLessThanOrEqual(3600 * 1000 + 100)
    expect(diff).toBeGreaterThan(3500 * 1000)
  })
})

describe('validatePortalToken', () => {
  it('validates a correctly generated token', () => {
    const { token, hash } = generatePortalToken(BOOKING_REF, SECRET)
    expect(validatePortalToken(BOOKING_REF, token, SECRET, hash)).toBe(true)
  })

  it('rejects wrong token', () => {
    const { hash } = generatePortalToken(BOOKING_REF, SECRET)
    expect(validatePortalToken(BOOKING_REF, 'wrong-token', SECRET, hash)).toBe(false)
  })

  it('rejects wrong booking ref', () => {
    const { token, hash } = generatePortalToken(BOOKING_REF, SECRET)
    expect(validatePortalToken('HH-PTY-WRONG', token, SECRET, hash)).toBe(false)
  })

  it('rejects wrong secret', () => {
    const { token, hash } = generatePortalToken(BOOKING_REF, SECRET)
    expect(validatePortalToken(BOOKING_REF, token, 'wrong-secret', hash)).toBe(false)
  })
})

describe('cookie functions', () => {
  it('builds cookie value and reads it back', () => {
    const value = buildPortalCookieValue(BOOKING_REF, SECRET)
    expect(value).toContain(BOOKING_REF)

    const cookieHeader = `hh_portal=${value}; other=stuff`
    const ref = getPortalBookingRef(cookieHeader, SECRET)
    expect(ref).toBe(BOOKING_REF)
  })

  it('returns null for missing cookie', () => {
    expect(getPortalBookingRef('other=value', SECRET)).toBeNull()
  })

  it('returns null for null header', () => {
    expect(getPortalBookingRef(null, SECRET)).toBeNull()
  })

  it('returns null for tampered cookie', () => {
    const value = buildPortalCookieValue(BOOKING_REF, SECRET)
    const tampered = value.slice(0, -4) + 'xxxx'
    const ref = getPortalBookingRef(`hh_portal=${tampered}`, SECRET)
    expect(ref).toBeNull()
  })

  it('returns null for cookie with wrong secret', () => {
    const value = buildPortalCookieValue(BOOKING_REF, SECRET)
    const ref = getPortalBookingRef(`hh_portal=${value}`, 'wrong-secret')
    expect(ref).toBeNull()
  })
})

describe('setPortalCookieHeader', () => {
  it('produces a valid Set-Cookie string', () => {
    const header = setPortalCookieHeader(BOOKING_REF, SECRET)
    expect(header).toContain('hh_portal=')
    expect(header).toContain('HttpOnly')
    expect(header).toContain('Secure')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Max-Age=')
  })
})

describe('clearPortalCookieHeader', () => {
  it('produces a cookie-clearing header', () => {
    const header = clearPortalCookieHeader()
    expect(header).toContain('Max-Age=0')
    expect(header).toContain('hh_portal=')
  })
})
