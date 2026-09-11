/**
 * Tests for POST /api/admin/auth/login — per-person admin sign-in (plan §11.1).
 *
 * The properties worth locking down are all security properties, because this
 * route is the new front door to a panel whose downstream gate can message a
 * customer:
 *
 *   * an UNCLAIMED row cannot be claimed without the shared ADMIN_PASSWORD.
 *     /admin is a public URL, so if it could, anyone who guessed `allie@…`
 *     could take her account and every approval she ever makes.
 *   * a failure NEVER reveals whether the email is a real admin.
 *   * an inactive user cannot sign in.
 *   * the cookie that comes back is HttpOnly.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => {
      const headers = new Map<string, string>()
      return {
        status: init?.status || 200,
        json: () => body,
        body,
        headers: { set: (k: string, v: string) => headers.set(k.toLowerCase(), v), get: (k: string) => headers.get(k.toLowerCase()) ?? null },
      }
    },
  },
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))

import { POST } from '@/app/api/admin/auth/login/route'
import { hashPassword, getAdminEmailFromCookie } from '@/lib/adminAuth'

const SECRET = 'test-session-secret'

type Row = {
  id: string
  email: string
  password_hash: string | null
  display_name: string
  is_active: boolean
}

function makeSupabase(row: Row | null) {
  const updates: Record<string, unknown>[] = []
  const from = jest.fn(() => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      is: () => Promise.resolve({ error: null }),
      maybeSingle: () => Promise.resolve({ data: row, error: null }),
      update: (patch: Record<string, unknown>) => {
        updates.push(patch)
        return chain
      },
      then: (res: any) => res({ error: null }),
    }
    return chain
  })
  return { client: { from } as any, updates }
}

/** A fresh IP per test so the in-memory throttle never leaks between them. */
let ipCounter = 0
function makeReq(body: unknown) {
  ipCounter += 1
  return {
    json: async () => body,
    headers: {
      get: (name: string) => {
        const h: Record<string, string> = {
          'x-forwarded-for': `10.0.0.${ipCounter}`,
          host: 'www.hosthampton.com',
        }
        return h[name.toLowerCase()] ?? null
      },
    },
  } as any
}

const originalEnv = process.env

beforeEach(() => {
  process.env = { ...originalEnv, ADMIN_PASSWORD: 'shared-pw', ADMIN_SESSION_SECRET: SECRET }
})

afterAll(() => {
  process.env = originalEnv
})

function claimedRow(hash: string): Row {
  return { id: 'u1', email: 'allie@hosthampton.com', password_hash: hash, display_name: 'Allie', is_active: true }
}

const unclaimedRow: Row = {
  id: 'u1', email: 'allie@hosthampton.com', password_hash: null, display_name: 'Allie', is_active: true,
}

describe('a claimed account', () => {
  it('signs in with the right password and gets an HttpOnly session cookie', async () => {
    const { client } = makeSupabase(claimedRow(hashPassword('her-real-password')))
    mockGetSupabase.mockReturnValue(client)

    const res = await POST(makeReq({ email: 'Allie@HostHampton.com', password: 'her-real-password' }))

    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, displayName: 'Allie', claimed: false })

    const cookie = res.headers.get('Set-Cookie')!
    expect(cookie).toContain('HttpOnly')
    expect(getAdminEmailFromCookie(cookie, SECRET)).toBe('allie@hosthampton.com')
  })

  it('records last_login_at', async () => {
    const { client, updates } = makeSupabase(claimedRow(hashPassword('pw-pw-pw-pw')))
    mockGetSupabase.mockReturnValue(client)

    await POST(makeReq({ email: 'allie@hosthampton.com', password: 'pw-pw-pw-pw' }))

    expect(updates.some(u => 'last_login_at' in u)).toBe(true)
  })

  it('rejects the wrong password with no cookie', async () => {
    const { client } = makeSupabase(claimedRow(hashPassword('her-real-password')))
    mockGetSupabase.mockReturnValue(client)

    const res = await POST(makeReq({ email: 'allie@hosthampton.com', password: 'guess' }))

    expect(res.status).toBe(401)
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })

  it('ignores the shared password as a personal password', async () => {
    // Otherwise the shared password would silently be a second valid password
    // for every named account, and the ledger would name the wrong person.
    const { client } = makeSupabase(claimedRow(hashPassword('her-real-password')))
    mockGetSupabase.mockReturnValue(client)

    const res = await POST(makeReq({ email: 'allie@hosthampton.com', password: 'shared-pw' }))
    expect(res.status).toBe(401)
  })
})

describe('claiming an unclaimed account', () => {
  it('REFUSES without the shared password — this is the whole guard', async () => {
    const { client, updates } = makeSupabase(unclaimedRow)
    mockGetSupabase.mockReturnValue(client)

    const res = await POST(makeReq({ email: 'allie@hosthampton.com', password: 'attacker-chosen-pw' }))

    expect(res.status).toBe(401)
    expect(res.headers.get('Set-Cookie')).toBeNull()
    expect(updates.some(u => 'password_hash' in u)).toBe(false)
  })

  it('REFUSES with the wrong shared password', async () => {
    const { client, updates } = makeSupabase(unclaimedRow)
    mockGetSupabase.mockReturnValue(client)

    const res = await POST(makeReq({
      email: 'allie@hosthampton.com', password: 'her-new-password', sharedPassword: 'not-it',
    }))

    expect(res.status).toBe(401)
    expect(updates.some(u => 'password_hash' in u)).toBe(false)
  })

  it('claims with the shared password and stores a scrypt hash, never the password', async () => {
    const { client, updates } = makeSupabase(unclaimedRow)
    mockGetSupabase.mockReturnValue(client)

    const res = await POST(makeReq({
      email: 'allie@hosthampton.com', password: 'her-new-password', sharedPassword: 'shared-pw',
    }))

    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, claimed: true })

    const hashPatch = updates.find(u => 'password_hash' in u)!
    expect(hashPatch.password_hash).toMatch(/^scrypt\$/)
    expect(hashPatch.password_hash).not.toContain('her-new-password')
    expect(getAdminEmailFromCookie(res.headers.get('Set-Cookie')!, SECRET)).toBe('allie@hosthampton.com')
  })

  it('refuses a too-short personal password', async () => {
    const { client, updates } = makeSupabase(unclaimedRow)
    mockGetSupabase.mockReturnValue(client)

    const res = await POST(makeReq({
      email: 'allie@hosthampton.com', password: 'short', sharedPassword: 'shared-pw',
    }))

    expect(res.status).toBe(400)
    expect(updates.some(u => 'password_hash' in u)).toBe(false)
  })
})

describe('what a failure reveals', () => {
  it('gives an unknown email the same answer as a wrong password', async () => {
    const { client } = makeSupabase(null)
    mockGetSupabase.mockReturnValue(client)
    const unknown = await POST(makeReq({ email: 'nobody@example.com', password: 'whatever' }))

    const { client: c2 } = makeSupabase(claimedRow(hashPassword('her-real-password')))
    mockGetSupabase.mockReturnValue(c2)
    const wrong = await POST(makeReq({ email: 'allie@hosthampton.com', password: 'whatever' }))

    expect(unknown.status).toBe(wrong.status)
    expect(unknown.json()).toEqual(wrong.json())
  })

  it('cannot be used to enumerate admins even with the shared password', async () => {
    const { client } = makeSupabase(null)
    mockGetSupabase.mockReturnValue(client)

    const res = await POST(makeReq({
      email: 'guess@example.com', password: 'a-new-password', sharedPassword: 'shared-pw',
    }))

    expect(res.status).toBe(401)
  })
})

describe('input handling', () => {
  it('rejects a missing email or password', async () => {
    mockGetSupabase.mockReturnValue(makeSupabase(null).client)
    expect((await POST(makeReq({ password: 'x' }))).status).toBe(400)
    expect((await POST(makeReq({ email: 'a@b.com' }))).status).toBe(400)
  })

  it('rejects a non-string password without throwing', async () => {
    mockGetSupabase.mockReturnValue(makeSupabase(null).client)
    const res = await POST(makeReq({ email: 'a@b.com', password: { evil: true } }))
    expect(res.status).toBe(400)
  })

  it('rejects an unparseable body', async () => {
    const req = { json: async () => { throw new Error('bad json') }, headers: { get: () => null } } as any
    expect((await POST(req)).status).toBe(400)
  })
})

describe('an inactive user', () => {
  it('cannot sign in', async () => {
    // The route filters on is_active, so the row simply is not found.
    const { client } = makeSupabase(null)
    mockGetSupabase.mockReturnValue(client)

    const res = await POST(makeReq({ email: 'allie@hosthampton.com', password: 'her-real-password' }))
    expect(res.status).toBe(401)
  })
})

describe('throttling', () => {
  it('locks out after repeated failures from the same IP and email', async () => {
    const { client } = makeSupabase(claimedRow(hashPassword('her-real-password')))
    mockGetSupabase.mockReturnValue(client)

    const fixedReq = () => ({
      json: async () => ({ email: 'allie@hosthampton.com', password: 'wrong' }),
      headers: {
        get: (n: string) => (n.toLowerCase() === 'x-forwarded-for' ? '198.51.100.7' : null),
      },
    }) as any

    let last: any
    for (let i = 0; i < 12; i++) last = await POST(fixedReq())

    expect(last.status).toBe(429)
  })
})
