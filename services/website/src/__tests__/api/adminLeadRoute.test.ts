/**
 * Tests for /api/admin/lead/[ref] — the lead workspace's data route.
 *
 * Two properties, both of which are guardrails rather than features:
 *
 *  1. **PATCH writes a whitelist.** Money columns and `status` must be
 *     unwritable here. Totals are derived by `lib/plan.ts` and the pipeline
 *     stage moves through `advance()`; a panel that could set either would make
 *     this route a second, unguarded writer of the two things the ledger exists
 *     to explain. A blocklist would have to be updated every time a column is
 *     added, so the test asserts the ALLOWED set, not a list of forbidden ones.
 *  2. **Quote readiness comes from `evaluateInquiry`**, the same gate the draft
 *     node runs — so the panel cannot offer a "Send quote" button for a plan the
 *     gate will refuse to price.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }),
  },
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))

jest.mock('@/lib/adminAuth', () => ({
  isAdminAuthorized: () => true,
  adminActorId: () => 'admin:allie@example.com',
  unauthorizedResponse: () => ({ status: 401, json: () => ({ error: 'Unauthorized' }) }),
}))

const mockWriteLedger = jest.fn(async () => undefined)
jest.mock('@/lib/marketing/graph', () => ({ writeLedger: (...a: unknown[]) => mockWriteLedger(...(a as [])) }))

// The gate is the thing under test, not a collaborator — the real one runs.
jest.mock('@/lib/agent/threadTimeline', () => ({
  loadLeadTimeline: async () => ({ items: [], draftIds: [], errors: [] }),
}))

import { GET, PATCH } from '@/app/api/admin/lead/[ref]/route'

const BOOKING: Record<string, unknown> = {
  id: 'bk-1',
  booking_ref: 'HH-PTY-TEST1',
  status: 'lead',
  party_type: 'in_studio_theme',
  event_type: 'Kids Birthday Party',
  contact_name: 'Jess R',
  contact_email: 'jess@example.com',
  contact_phone: '+16315551234',
  party_date: '2026-10-10',
  party_time: '2:00 PM',
  guest_count_approx: 12,
  total_cents: 60000,
  deposit_amount: 250,
  balance_due_cents: 60000,
}

/** The last `.update()` patch this route issued against `bookings`. */
let lastPatch: Record<string, unknown> | null

function makeSupabase(booking: Record<string, unknown> | null = BOOKING) {
  const from = jest.fn((table: string) => {
    const chain: any = {
      then: (res: any, rej: any) => {
        const data =
          table === 'bookings' ? booking : table === 'inquiry_drafts' ? [] : table === 'booking_line_items' ? [] : []
        return Promise.resolve({ data, error: null }).then(res, rej)
      },
    }
    for (const m of ['select', 'eq', 'or', 'in', 'order', 'limit']) chain[m] = () => chain
    // `.maybeSingle()` resolves to a ROW or null — never the empty array a list
    // query returns. Getting that wrong made a lead with no plan look like a
    // draft-only lead, because `[]` is truthy.
    chain.maybeSingle = () => ({
      then: (res: any, rej: any) =>
        Promise.resolve({ data: table === 'bookings' ? booking : null, error: null }).then(res, rej),
    })
    chain.update = (patch: Record<string, unknown>) => {
      if (table === 'bookings') lastPatch = patch
      return chain
    }
    return chain
  })
  return { from } as never
}

function makeReq(body?: unknown) {
  return {
    headers: { get: () => null },
    nextUrl: { searchParams: { get: () => null } },
    json: async () => body,
  } as any
}

beforeEach(() => {
  jest.clearAllMocks()
  lastPatch = null
  mockGetSupabase.mockReturnValue(makeSupabase())
})

describe('GET /api/admin/lead/[ref] — quote readiness', () => {
  it('reports a complete plan as ready to quote', async () => {
    const res = await GET(makeReq(), { params: { ref: 'HH-PTY-TEST1' } })
    expect(res.status).toBe(200)
    expect(res.body.evaluation).toMatchObject({ path: 'quote', reachable: true, missing: [] })
  })

  it('names the missing fields rather than just refusing', async () => {
    mockGetSupabase.mockReturnValue(makeSupabase({ ...BOOKING, party_date: null, guest_count_approx: null }))
    const res = await GET(makeReq(), { params: { ref: 'HH-PTY-TEST1' } })
    expect(res.body.evaluation.path).toBe('info_gather')
    expect(res.body.evaluation.missing).toEqual(expect.arrayContaining(['party_date', 'guest_count']))
    expect(res.body.evaluation.missingLabels).toEqual(expect.arrayContaining(['date', 'guest count']))
  })

  it('flags a plan with no email and no phone as unreachable, separately from missing fields', async () => {
    // A different kind of problem: it blocks the draft entirely, so it must not
    // be buried in a list of eight other fields.
    mockGetSupabase.mockReturnValue(makeSupabase({ ...BOOKING, contact_email: null, contact_phone: null }))
    const res = await GET(makeReq(), { params: { ref: 'HH-PTY-TEST1' } })
    expect(res.body.evaluation.reachable).toBe(false)
  })

  it('has no evaluation for a lead with no plan row', async () => {
    mockGetSupabase.mockReturnValue(makeSupabase(null))
    const res = await GET(makeReq(), { params: { ref: 'nope' } })
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/admin/lead/[ref] — the whitelist', () => {
  it('writes an allowed field', async () => {
    const res = await PATCH(makeReq({ fields: { contact_name: 'Jessica R' } }), { params: { ref: 'HH-PTY-TEST1' } })
    expect(res.status).toBe(200)
    expect(lastPatch).toMatchObject({ contact_name: 'Jessica R' })
    expect(res.body.changed).toMatchObject({ contact_name: { from: 'Jess R', to: 'Jessica R' } })
  })

  it('refuses to write any money column or the pipeline status', async () => {
    await PATCH(
      makeReq({
        fields: {
          total_cents: 1,
          deposit_amount: 0,
          balance_due_cents: 1,
          status: 'paid_in_full',
          invoice_number: '444124-000001',
          contact_name: 'Jessica R',
        },
      }),
      { params: { ref: 'HH-PTY-TEST1' } },
    )
    // The one legal field went through; nothing else did.
    expect(Object.keys(lastPatch!).sort()).toEqual(['contact_name', 'updated_at'])
  })

  it('drops an unknown column instead of passing it to the database', async () => {
    await PATCH(makeReq({ fields: { nonsense_column: 'x', contact_name: 'Jessica R' } }), {
      params: { ref: 'HH-PTY-TEST1' },
    })
    expect(lastPatch).not.toHaveProperty('nonsense_column')
  })

  it('rejects a party_type that is not one of the four', async () => {
    await PATCH(makeReq({ fields: { party_type: 'wedding' } }), { params: { ref: 'HH-PTY-TEST1' } })
    expect(lastPatch).toBeNull()
  })

  it('coerces a guest count and refuses a negative one', async () => {
    await PATCH(makeReq({ fields: { guest_count_approx: '18' } }), { params: { ref: 'HH-PTY-TEST1' } })
    expect(lastPatch).toMatchObject({ guest_count_approx: 18 })

    lastPatch = null
    await PATCH(makeReq({ fields: { guest_count_approx: -4 } }), { params: { ref: 'HH-PTY-TEST1' } })
    expect(lastPatch).toBeNull()
  })

  it('writes nothing and touches no ledger when the value is unchanged', async () => {
    const res = await PATCH(makeReq({ fields: { contact_name: 'Jess R' } }), { params: { ref: 'HH-PTY-TEST1' } })
    expect(lastPatch).toBeNull()
    expect(mockWriteLedger).not.toHaveBeenCalled()
    expect(res.body.changed).toEqual({})
  })

  it('records the edit against the booking with the per-user actor', async () => {
    await PATCH(makeReq({ fields: { contact_name: 'Jessica R' } }), { params: { ref: 'HH-PTY-TEST1' } })
    expect(mockWriteLedger).toHaveBeenCalled()
    const [, entry] = mockWriteLedger.mock.calls[0] as unknown as [unknown, Record<string, unknown>]
    expect(entry).toMatchObject({ entityType: 'booking', actor: 'admin:allie@example.com', action: 'note' })
  })

  it('never reports having sent anything to the customer', async () => {
    const res = await PATCH(makeReq({ fields: { contact_name: 'Jessica R' } }), { params: { ref: 'HH-PTY-TEST1' } })
    expect(res.body.sentToCustomer).toBe(false)
  })
})
