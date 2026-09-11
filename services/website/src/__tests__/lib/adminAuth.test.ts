import {
  adminActorId,
  adminSessionSecret,
  buildAdminCookieValue,
  clearAdminCookieHeader,
  getAdminEmail,
  getAdminEmailFromCookie,
  hashPassword,
  isAdminAuthorized,
  setAdminCookieHeader,
  unauthorizedResponse,
  verifyPassword,
} from '@/lib/adminAuth'

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: any, init?: any) => ({
      status: init?.status || 200,
      json: () => body,
    }),
  },
}))

const SECRET = 'test-session-secret'

/** Minimal NextRequest stand-in: these functions only ever read headers. */
function reqWith(headers: Record<string, string>): any {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return { headers: { get: (name: string) => lower[name.toLowerCase()] ?? null } }
}

describe('isAdminAuthorized — shared password (unchanged behaviour)', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, ADMIN_PASSWORD: 'test-secret-pw' }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns true for valid Bearer token matching ADMIN_PASSWORD', () => {
    expect(isAdminAuthorized(reqWith({ authorization: 'Bearer test-secret-pw' }))).toBe(true)
  })

  it('returns false for missing authorization header', () => {
    expect(isAdminAuthorized(reqWith({}))).toBe(false)
  })

  it('returns false for wrong password', () => {
    expect(isAdminAuthorized(reqWith({ authorization: 'Bearer wrong-password' }))).toBe(false)
  })

  it('returns false for non-Bearer auth', () => {
    expect(isAdminAuthorized(reqWith({ authorization: 'Basic test-secret-pw' }))).toBe(false)
  })

  it('does not accept "Bearer undefined" when ADMIN_PASSWORD is unset', () => {
    // Otherwise an env var that failed to reach the container would turn a
    // literal string into a master key.
    process.env = { ...originalEnv, ADMIN_PASSWORD: undefined } as any
    expect(isAdminAuthorized(reqWith({ authorization: 'Bearer undefined' }))).toBe(false)
    expect(isAdminAuthorized(reqWith({ authorization: 'Bearer ' }))).toBe(false)
  })
})

describe('password hashing', () => {
  it('round-trips a password', () => {
    const hash = hashPassword('correct horse battery staple')
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true)
  })

  it('rejects the wrong password', () => {
    const hash = hashPassword('correct horse battery staple')
    expect(verifyPassword('Correct horse battery staple', hash)).toBe(false)
    expect(verifyPassword('', hash)).toBe(false)
  })

  it('is salted — the same password hashes differently every time', () => {
    expect(hashPassword('same-password')).not.toEqual(hashPassword('same-password'))
  })

  it('uses scrypt, never a bare digest', () => {
    expect(hashPassword('x')).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/)
  })

  it('treats an unclaimed (null) or malformed hash as "no login"', () => {
    expect(verifyPassword('anything', null)).toBe(false)
    expect(verifyPassword('anything', '')).toBe(false)
    expect(verifyPassword('anything', 'not-a-hash')).toBe(false)
    // A bare SHA-256 of the password must not validate.
    expect(verifyPassword('anything', 'sha256$abc')).toBe(false)
    expect(verifyPassword('anything', 'scrypt$0$0$0$aa$bb')).toBe(false)
  })
})

describe('session cookie', () => {
  it('round-trips an email', () => {
    const header = setAdminCookieHeader('Allie@HostHampton.com', SECRET)
    expect(getAdminEmailFromCookie(header, SECRET)).toBe('allie@hosthampton.com')
  })

  it('is HttpOnly, Lax and Secure', () => {
    const header = setAdminCookieHeader('a@b.com', SECRET)
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Secure')
  })

  it('omits Secure only for local development', () => {
    expect(setAdminCookieHeader('a@b.com', SECRET, true)).not.toContain('; Secure')
  })

  it('rejects a cookie signed with a different secret', () => {
    const header = setAdminCookieHeader('a@b.com', SECRET)
    expect(getAdminEmailFromCookie(header, 'other-secret')).toBeNull()
  })

  it('rejects a tampered email — the signature covers it', () => {
    const value = buildAdminCookieValue('allie@hosthampton.com', SECRET)
    const [, issuedAt, sig] = value.split(':')
    const forged = `hh_admin=${encodeURIComponent('attacker@evil.com')}:${issuedAt}:${sig}`
    expect(getAdminEmailFromCookie(forged, SECRET)).toBeNull()
  })

  it('rejects a session past its TTL even if the client kept the cookie', () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000
    const value = buildAdminCookieValue('a@b.com', SECRET, eightDaysAgo)
    expect(getAdminEmailFromCookie(`hh_admin=${value}`, SECRET)).toBeNull()
  })

  it('accepts a session inside its TTL', () => {
    const sixDaysAgo = Date.now() - 6 * 24 * 60 * 60 * 1000
    const value = buildAdminCookieValue('a@b.com', SECRET, sixDaysAgo)
    expect(getAdminEmailFromCookie(`hh_admin=${value}`, SECRET)).toBe('a@b.com')
  })

  it('rejects a future-dated issuedAt', () => {
    const value = buildAdminCookieValue('a@b.com', SECRET, Date.now() + 60_000)
    expect(getAdminEmailFromCookie(`hh_admin=${value}`, SECRET)).toBeNull()
  })

  it('rejects an extended expiry — issuedAt is inside the signed payload', () => {
    const old = Date.now() - 8 * 24 * 60 * 60 * 1000
    const [email, , sig] = buildAdminCookieValue('a@b.com', SECRET, old).split(':')
    const restamped = `hh_admin=${email}:${Date.now()}:${sig}`
    expect(getAdminEmailFromCookie(restamped, SECRET)).toBeNull()
  })

  it('ignores a portal cookie — a portal session is not an admin session', () => {
    // The `adminsession:` HMAC prefix is what guarantees this even when the two
    // cookies share a signing secret.
    expect(getAdminEmailFromCookie('hh_portal=HH-2026-0208:deadbeef', SECRET)).toBeNull()
    expect(getAdminEmailFromCookie('hh_portal_email=a%40b.com:deadbeef', SECRET)).toBeNull()
  })

  it('returns null for garbage and for no cookie at all', () => {
    expect(getAdminEmailFromCookie(null, SECRET)).toBeNull()
    expect(getAdminEmailFromCookie('', SECRET)).toBeNull()
    expect(getAdminEmailFromCookie('hh_admin=nonsense', SECRET)).toBeNull()
    expect(getAdminEmailFromCookie('hh_admin=a:b:c:d', SECRET)).toBeNull()
  })

  it('finds its cookie alongside others', () => {
    const value = buildAdminCookieValue('a@b.com', SECRET)
    expect(getAdminEmailFromCookie(`foo=1; hh_admin=${value}; bar=2`, SECRET)).toBe('a@b.com')
  })

  it('clears with an expiring header', () => {
    expect(clearAdminCookieHeader()).toContain('Max-Age=0')
  })
})

describe('session as a request credential', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, ADMIN_PASSWORD: 'shared-pw', ADMIN_SESSION_SECRET: SECRET }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  const cookie = () => `hh_admin=${buildAdminCookieValue('allie@hosthampton.com', SECRET)}`

  it('authorizes a request carrying a valid session cookie', () => {
    expect(isAdminAuthorized(reqWith({ cookie: cookie() }))).toBe(true)
    expect(getAdminEmail(reqWith({ cookie: cookie() }))).toBe('allie@hosthampton.com')
  })

  it('rejects a cross-site request even with a valid cookie (CSRF)', () => {
    // The gate downstream of this can message a customer, so the cookie path
    // gets an origin check on top of SameSite=Lax.
    const cross = reqWith({ cookie: cookie(), 'sec-fetch-site': 'cross-site' })
    expect(isAdminAuthorized(cross)).toBe(false)
    expect(getAdminEmail(cross)).toBeNull()

    const crossByOrigin = reqWith({
      cookie: cookie(),
      origin: 'https://evil.example',
      host: 'www.hosthampton.com',
    })
    expect(isAdminAuthorized(crossByOrigin)).toBe(false)
  })

  it('allows a same-origin request', () => {
    expect(isAdminAuthorized(reqWith({ cookie: cookie(), 'sec-fetch-site': 'same-origin' }))).toBe(true)
    expect(
      isAdminAuthorized(reqWith({
        cookie: cookie(),
        origin: 'https://www.hosthampton.com',
        host: 'www.hosthampton.com',
      })),
    ).toBe(true)
  })

  it('still rejects a request with neither credential', () => {
    expect(isAdminAuthorized(reqWith({}))).toBe(false)
    expect(isAdminAuthorized(reqWith({ cookie: 'hh_admin=forged:1:2' }))).toBe(false)
  })

  it('does not let the shared-password Bearer path invent an identity', () => {
    // The whole point: a session NAMES an admin, it does not create one.
    const req = reqWith({ authorization: 'Bearer shared-pw' })
    expect(isAdminAuthorized(req)).toBe(true)
    expect(getAdminEmail(req)).toBeNull()
  })
})

describe('adminActorId — who the ledger records', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, ADMIN_PASSWORD: 'shared-pw', ADMIN_SESSION_SECRET: SECRET }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('names the person when a session says who they are', () => {
    const cookie = `hh_admin=${buildAdminCookieValue('allie@hosthampton.com', SECRET)}`
    expect(adminActorId(reqWith({ cookie }))).toBe('admin:allie@hosthampton.com')
  })

  it('falls back to the historical anonymous ADMIN on the shared password', () => {
    expect(adminActorId(reqWith({ authorization: 'Bearer shared-pw' }))).toBe('ADMIN')
  })
})

describe('adminSessionSecret', () => {
  const originalEnv = process.env
  afterAll(() => { process.env = originalEnv })

  it('prefers its own var, then the portal secret', () => {
    process.env = { ...originalEnv, ADMIN_SESSION_SECRET: 'own', PORTAL_LINK_SIGNING_SECRET: 'portal' }
    expect(adminSessionSecret()).toBe('own')
    process.env = { ...originalEnv, ADMIN_SESSION_SECRET: undefined, PORTAL_LINK_SIGNING_SECRET: 'portal' } as any
    expect(adminSessionSecret()).toBe('portal')
  })
})

describe('unauthorizedResponse', () => {
  it('returns 401 status with error message', () => {
    const response = unauthorizedResponse()
    expect(response.status).toBe(401)
    expect(response.json().error).toBe('Unauthorized')
  })
})
