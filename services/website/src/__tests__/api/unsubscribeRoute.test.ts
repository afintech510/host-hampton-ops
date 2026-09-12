/**
 * POST /api/unsubscribe — the RFC 8058 one-click endpoint.
 *
 * There was no test for this route at all, only for the token module, and the
 * route is where the defect was: the token always names a LOWERCASED address
 * and `.eq('email', …)` is case-sensitive, so for the 21 real contacts stored
 * with capitals — **7 of them on an active sequence enrollment** — the endpoint
 * answered 200 and wrote nothing. A guardrail that says it stopped something it
 * did not stop is the other half of hard-won rule 10, and on this surface the
 * cost is a spam complaint.
 *
 * The store below matches `eq` case-sensitively and `ilike` the way LIKE really
 * behaves, so the old code fails these tests rather than passing them.
 */

interface Row {
  id: string
  email: string | null
  email_opt_in: boolean
  status?: string
}

function makeStore(contacts: Row[]) {
  const interactions: { contact_id: string; type: string }[] = []
  const enrollments: { contact_id: string; status: string }[] = []

  const ilikeMatch = (value: string | null, pattern: string): boolean =>
    new RegExp(
      '^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.').replace(/%/g, '.*') + '$',
      'i'
    ).test(String(value ?? ''))

  const table = (rows: any[]) => {
    let filtered = rows.slice()
    let op: 'select' | 'update' | 'insert' = 'select'
    let patch: Record<string, unknown> = {}

    const chain: any = {
      select: () => chain,
      insert: (row: any) => {
        op = 'insert'
        rows.push(row)
        return chain
      },
      update: (p: Record<string, unknown>) => {
        op = 'update'
        patch = p
        return chain
      },
      eq: (col: string, val: any) => {
        filtered = filtered.filter(r => r[col] === val)
        return chain
      },
      ilike: (col: string, val: string) => {
        filtered = filtered.filter(r => ilikeMatch(r[col], val))
        return chain
      },
      in: (col: string, vals: any[]) => {
        filtered = filtered.filter(r => vals.includes(r[col]))
        return chain
      },
      then: (res: any, rej: any) => {
        if (op === 'update') for (const r of filtered) Object.assign(r, patch)
        return Promise.resolve({ data: op === 'select' ? filtered : null, error: null }).then(res, rej)
      },
    }
    return chain
  }

  return {
    client: {
      from: (t: string) =>
        t === 'contacts'
          ? table(contacts)
          : t === 'contact_sequence_enrollments'
            ? table(enrollments)
            : table(interactions),
    },
    contacts,
    interactions,
    enrollments,
  }
}

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: (...a: any[]) => mockGetSupabase(...a) }))

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }),
  },
}))

import { POST } from '@/app/api/unsubscribe/route'
import { generateUnsubscribeToken } from '@/lib/unsubscribeLink'

const SECRET = 'test-signing-secret-for-unsubscribe'

function makeReq(token: string | null) {
  return {
    nextUrl: { searchParams: new URLSearchParams(token === null ? '' : `t=${encodeURIComponent(token)}`) },
    headers: new Headers(),
  } as any
}

describe('POST /api/unsubscribe', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, PORTAL_LINK_SIGNING_SECRET: SECRET }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('opts out an address stored exactly as the token names it', async () => {
    const store = makeStore([{ id: 'c-1', email: 'adam@easternbuilding.supply', email_opt_in: true }])
    mockGetSupabase.mockReturnValue(store.client)

    const res = await POST(makeReq(generateUnsubscribeToken('adam@easternbuilding.supply')!))

    expect(res.status).toBe(200)
    expect(store.contacts[0].email_opt_in).toBe(false)
    expect(store.interactions.map(i => i.type)).toContain('email_unsubscribed')
  })

  /** THE regression. 21 live contacts look like this. */
  it('opts out an address stored with capitals', async () => {
    const store = makeStore([{ id: 'c-2', email: 'BON.Jovi@GMAIL.COM', email_opt_in: true }])
    mockGetSupabase.mockReturnValue(store.client)

    // The token can only ever carry the lowercased form — that is deliberate,
    // so one person does not have two valid tokens.
    const res = await POST(makeReq(generateUnsubscribeToken('BON.Jovi@GMAIL.COM')!))

    expect(res.status).toBe(200)
    expect(store.contacts[0].email_opt_in).toBe(false)
    expect(store.interactions).toHaveLength(1)
  })

  it('does not opt out a stranger an underscore would have matched', async () => {
    const store = makeStore([
      { id: 'c-a', email: 'first_last@gmail.com', email_opt_in: true },
      { id: 'c-b', email: 'firstXlast@gmail.com', email_opt_in: true },
    ])
    mockGetSupabase.mockReturnValue(store.client)

    await POST(makeReq(generateUnsubscribeToken('first_last@gmail.com')!))

    expect(store.contacts.find(c => c.id === 'c-a')!.email_opt_in).toBe(false)
    expect(store.contacts.find(c => c.id === 'c-b')!.email_opt_in).toBe(true)
  })

  it('answers a forged token 400 and writes nothing', async () => {
    const store = makeStore([{ id: 'c-3', email: 'victim@example.com', email_opt_in: true }])
    mockGetSupabase.mockReturnValue(store.client)

    const real = generateUnsubscribeToken('victim@example.com')!
    const tampered = real.slice(0, real.lastIndexOf('.')) + '.' + 'f'.repeat(64)

    expect((await POST(makeReq(tampered))).status).toBe(400)
    expect((await POST(makeReq(null))).status).toBe(400)
    expect(store.contacts[0].email_opt_in).toBe(true)
  })

  /**
   * The old body was `{ok: true, alreadyOff: true}` for an unknown address,
   * directly under a comment saying this must not become an oracle for whether
   * an address is on the list. Rule 8: a comment that asserts the opposite of
   * its code.
   */
  it('answers an unknown address identically to a known one', async () => {
    const known = makeStore([{ id: 'c-4', email: 'known@example.com', email_opt_in: true }])
    mockGetSupabase.mockReturnValue(known.client)
    const a = (await POST(makeReq(generateUnsubscribeToken('known@example.com')!))).json()

    const unknown = makeStore([])
    mockGetSupabase.mockReturnValue(unknown.client)
    const b = (await POST(makeReq(generateUnsubscribeToken('stranger@example.com')!))).json()

    expect(b).toEqual(a)
  })

  it('is idempotent', async () => {
    const store = makeStore([{ id: 'c-5', email: 'twice@example.com', email_opt_in: true }])
    mockGetSupabase.mockReturnValue(store.client)
    const token = generateUnsubscribeToken('twice@example.com')!

    expect((await POST(makeReq(token))).status).toBe(200)
    expect((await POST(makeReq(token))).status).toBe(200)
    expect(store.contacts[0].email_opt_in).toBe(false)
  })

  it('refuses when no signing secret is configured', async () => {
    delete process.env.PORTAL_LINK_SIGNING_SECRET
    const store = makeStore([{ id: 'c-6', email: 'x@example.com', email_opt_in: true }])
    mockGetSupabase.mockReturnValue(store.client)

    expect((await POST(makeReq('anything.deadbeef'))).status).toBe(400)
    expect(store.contacts[0].email_opt_in).toBe(true)
  })
})
