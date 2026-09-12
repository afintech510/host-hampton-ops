/**
 * `/api/party-builder/save` and the mixed-case address.
 *
 * Commit `9fedd91` — "one plan per customer, not one per save" — looked up the
 * customer's prior plan with `.eq('contact_email', normalizedEmail)` where
 * `normalizedEmail` is lowercased. `bookings.contact_email` is plain `text`
 * holding whatever the customer typed, and **9 of 61 live rows are not
 * lowercase**, so for those customers the lookup found nothing and a brand new
 * plan was created on EVERY save — the exact behaviour the commit removed, still
 * happening to the people most likely to hit it.
 *
 * These tests drive the real route against a store that models a case-sensitive
 * `.eq()` and real LIKE semantics for `.ilike()`, because a fake that treats
 * both as equality cannot see either half of this.
 */

const mockFrom = jest.fn()
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn().mockImplementation(() => ({ from: mockFrom, rpc: jest.fn().mockResolvedValue({ data: null, error: null }) })),
}))
jest.mock('@/lib/contacts', () => ({ upsertContact: jest.fn().mockResolvedValue('c1') }))
jest.mock('@/lib/sequences', () => ({ enrollInSequence: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/plan', () => ({
  buildPlanSnapshot: () => ({}),
  planTotals: () => ({ subtotalCents: 0, totalCents: 0, depositCents: 25000, balanceDueCents: 0 }),
  writeLineItems: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: jest.fn().mockResolvedValue({}) } })) }))
jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (b: unknown, i?: { status?: number }) => ({
      status: i?.status ?? 200,
      json: () => b,
      body: b,
      // The route sets the portal cookie on its own response.
      cookies: { set: jest.fn(), get: jest.fn(), delete: jest.fn() },
      headers: new Map(),
    }),
  },
}))

type Row = Record<string, unknown>

/** LIKE, for real: `%` a wildcard run, `_` any single character. */
function likeMatches(pattern: string, value: string): boolean {
  const rx = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i')
  return rx.test(value)
}

function store(bookings: Row[], opts: { failBookingRead?: boolean } = {}) {
  const created: Row[] = []
  mockFrom.mockImplementation((table: string) => {
    const eqs: [string, unknown][] = []
    let ilikeFilter: [string, string] | null = null
    let pendingInsert: Row | null = null
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'order', 'limit', 'not', 'is', 'in', 'update']) chain[m] = () => chain
    chain.eq = (c: string, v: unknown) => { eqs.push([c, v]); return chain }
    chain.ilike = (c: string, v: string) => { ilikeFilter = [c, v]; return chain }
    chain.insert = (r: Row) => { pendingInsert = r; return chain }
    const rows = () => {
      if (table !== 'bookings') return []
      let out = bookings
      // `.eq()` is CASE-SENSITIVE, byte-for-byte, like Postgres `text`.
      for (const [c, v] of eqs) out = out.filter(b => b[c] === v)
      if (ilikeFilter) out = out.filter(b => likeMatches(ilikeFilter![1], String(b[ilikeFilter![0]] ?? '')))
      return out
    }
    const settle = () => {
      if (pendingInsert) { created.push(pendingInsert); return { data: [pendingInsert], error: null } }
      if (table === 'bookings' && opts.failBookingRead) {
        return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
      }
      return { data: rows(), error: null }
    }
    chain.single = async () => { const r = settle(); return { data: (r.data as Row[])?.[0] ?? null, error: r.error } }
    chain.maybeSingle = chain.single
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(settle()).then(res, rej)
    return chain
  })
  return { created }
}

function req(body: Record<string, unknown>) {
  return {
    json: jest.fn().mockResolvedValue(body),
    headers: { get: (n: string) => (n === 'host' ? 'www.hosthampton.com' : null) },
  } as never
}

const BODY = {
  contactEmail: 'Sarah.OBrien@Gmail.com',
  contactName: 'Sarah OBrien',
  contactPhone: '+16314008080',
  guestCount: 10,
  partyDate: '2026-11-01',
  lineItems: [],
}

const originalEnv = process.env
beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...originalEnv, SUPABASE_URL: 'https://t.supabase.co', SUPABASE_SERVICE_KEY: 'k', PORTAL_LINK_SIGNING_SECRET: 's' }
})
afterAll(() => { process.env = originalEnv })

describe('party-builder/save finds a mixed-case customer their own plan', () => {
  const EXISTING = {
    id: 'bk-1',
    booking_ref: 'HH-PTY-EXIST',
    // Exactly how the customer typed it — this is what 9 of 61 live rows look like.
    contact_email: 'Sarah.OBrien@Gmail.com',
    party_date: '2026-11-01',
    status: 'awaiting_deposit',
    event_type: 'kid-party',
    created_at: '2026-09-01T00:00:00Z',
  }

  it('reuses the existing plan instead of creating a duplicate', async () => {
    const s = store([EXISTING])
    const { POST } = await import('@/app/api/party-builder/save/route')
    const res = await POST(req(BODY))

    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ bookingRef: 'HH-PTY-EXIST' })
    // The whole point: no second `bookings` row for the same customer.
    expect(s.created.filter(r => 'booking_ref' in r)).toHaveLength(0)
  })

  it('still creates a plan for a customer who genuinely has none', async () => {
    const s = store([])
    const { POST } = await import('@/app/api/party-builder/save/route')
    const res = await POST(req(BODY))

    expect(res.status).toBe(200)
    expect(s.created.some(r => 'booking_ref' in r)).toBe(true)
  })

  it('does NOT treat a `_` in the address as a wildcard onto someone else’s plan', async () => {
    // `ilike` fetches candidates and `findBookingsByContactEmail` re-compares
    // exactly. `_` is a single-character LIKE wildcard, so `a_b@x.com` would
    // otherwise match `axb@x.com` — a different person's plan.
    const other = { ...EXISTING, id: 'bk-2', booking_ref: 'HH-PTY-OTHER', contact_email: 'SarahXOBrien@Gmail.com' }
    const s = store([other])
    const { POST } = await import('@/app/api/party-builder/save/route')
    const res = await POST(req({ ...BODY, contactEmail: 'Sarah_OBrien@Gmail.com' }))

    expect(res.status).toBe(200)
    expect(res.json()).not.toMatchObject({ bookingRef: 'HH-PTY-OTHER' })
    expect(s.created.some(r => 'booking_ref' in r)).toBe(true)   // a new plan, correctly
  })

  it('refuses the save when the lookup FAILED, rather than making a duplicate', async () => {
    // Rule 12. "Could not read" read as "no prior plan" is how the duplicate
    // gets created — the failure mode the lookup exists to prevent.
    const s = store([EXISTING], { failBookingRead: true })
    const { POST } = await import('@/app/api/party-builder/save/route')
    const res = await POST(req(BODY))

    expect(res.status).toBe(503)
    expect(s.created.some(r => 'booking_ref' in r)).toBe(false)
  })
})
