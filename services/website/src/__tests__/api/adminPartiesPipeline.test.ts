/**
 * Tests for GET /api/admin/parties — Phase 4 item 5's pipeline view.
 *
 * The regression worth locking down is the `event_type` allowlist this route
 * used to filter on. It hid seven real parties in production (four
 * `room-rental` studio bookings and three whose event_type is the label
 * 'Kids Birthday Party') and would have hidden every mobile lead, because
 * `ensureLeadPlan` keeps the form's own words in `event_type`. A pipeline view
 * whose entire purpose is "no lead gets lost" must not be built on a list of
 * spellings, so this asserts the filter is an EXCLUSION of non-party forms.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }),
  },
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))

const mockIsAdminAuthorized = jest.fn(() => true)
jest.mock('@/lib/adminAuth', () => ({
  isAdminAuthorized: () => mockIsAdminAuthorized(),
  unauthorizedResponse: () => ({ status: 401, json: () => ({ error: 'Unauthorized' }), body: { error: 'Unauthorized' } }),
}))

import { GET } from '@/app/api/admin/parties/route'
import { PIPELINE_STAGES } from '@/lib/pipelineStages'

function makeReq(params: Record<string, string> = {}) {
  return {
    headers: { get: () => null },
    nextUrl: { searchParams: { get: (k: string) => params[k] ?? null } },
  } as any
}

interface Opts {
  /** Rows the paged list query returns. */
  page?: Record<string, unknown>[]
  /** Rows the count scan returns. */
  all?: { status: string; party_type: string | null }[]
  listError?: { message: string } | null
}

function makeSupabase(opts: Opts = {}) {
  /** Every chained call, so the test can assert on the filter that was built. */
  const calls: { table: string; ops: [string, ...unknown[]][] }[] = []

  const from = jest.fn((table: string) => {
    const ops: [string, ...unknown[]][] = []
    const record = { table, ops }
    calls.push(record)

    const chain: any = {
      then: (res: any, rej: any) => {
        // The paged query is the one that asked for an exact count.
        const isPaged = ops.some(o => o[0] === 'select' && (o[2] as { count?: string })?.count === 'exact')
        const result = isPaged
          ? { data: opts.page ?? [], error: opts.listError ?? null, count: (opts.page ?? []).length }
          : { data: opts.all ?? [], error: null, count: null }
        return Promise.resolve(result).then(res, rej)
      },
    }
    for (const m of ['select', 'eq', 'in', 'not', 'is', 'gte', 'lt', 'order', 'limit', 'range']) {
      chain[m] = jest.fn((...args: unknown[]) => { ops.push([m, ...args]); return chain })
    }
    return chain
  })

  return { supabase: { from } as any, calls }
}

/** The filter the list query actually built, as `[column, operator, value]`. */
function notFilters(calls: { ops: [string, ...unknown[]][] }[]): unknown[][] {
  return calls.flatMap(c => c.ops.filter(o => o[0] === 'not').map(o => o.slice(1)))
}

describe('GET /api/admin/parties', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsAdminAuthorized.mockReturnValue(true)
  })

  it('401s without admin auth, before touching the database', async () => {
    mockIsAdminAuthorized.mockReturnValue(false)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
    expect(mockGetSupabase).not.toHaveBeenCalled()
  })

  it('EXCLUDES non-party forms rather than allowlisting party spellings', async () => {
    const { supabase, calls } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)

    await GET(makeReq())

    // The old bug: `.in('event_type', ['kid-party','kids-party','kids_party','studio-rental'])`.
    const inEventType = calls.flatMap(c => c.ops.filter(o => o[0] === 'in' && o[1] === 'event_type'))
    expect(inEventType).toHaveLength(0)

    const nots = notFilters(calls)
    expect(nots).toContainEqual(['event_type', 'in', '(vendor_registration)'])
  })

  it('returns the pipeline stages in order, with lead and quoted at the front', async () => {
    const { supabase } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)

    const res = await GET(makeReq())

    expect(res.body.stages).toEqual(PIPELINE_STAGES)
    expect(res.body.stages.slice(0, 2)).toEqual(['lead', 'quoted'])
    expect(res.body.stages[res.body.stages.length - 1]).toBe('completed')
  })

  it('counts every stage and every party type from one scan', async () => {
    const { supabase } = makeSupabase({
      all: [
        { status: 'lead', party_type: 'mobile_party' },
        { status: 'lead', party_type: 'in_studio_theme' },
        { status: 'quoted', party_type: 'mobile_party' },
        { status: 'deposit_paid', party_type: 'studio_rental' },
        { status: 'cancelled', party_type: null },
      ],
    })
    mockGetSupabase.mockReturnValue(supabase)

    const res = await GET(makeReq())

    expect(res.body.counts.byStatus).toEqual({ lead: 2, quoted: 1, deposit_paid: 1, cancelled: 1 })
    expect(res.body.counts.byPartyType).toEqual({
      mobile_party: 2, in_studio_theme: 1, studio_rental: 1, unknown: 1,
    })
    expect(res.body.counts.allTypes).toBe(5)
  })

  it('scopes the STAGE counts to the party-type filter, but not the type counts', async () => {
    const { supabase, calls } = makeSupabase({
      all: [
        { status: 'lead', party_type: 'mobile_party' },
        { status: 'lead', party_type: 'in_studio_theme' },
        { status: 'quoted', party_type: 'mobile_party' },
      ],
    })
    mockGetSupabase.mockReturnValue(supabase)

    const res = await GET(makeReq({ party_type: 'mobile_party' }))

    // Standing inside Mobile, the stage counts are Mobile's...
    expect(res.body.counts.byStatus).toEqual({ lead: 1, quoted: 1 })
    expect(res.body.counts.all).toBe(2)
    // ...but the type chips still show every product, so a chip never reads 0
    // merely because it is not the one selected.
    expect(res.body.counts.byPartyType).toEqual({ mobile_party: 2, in_studio_theme: 1 })

    // The list query itself is filtered on the 035 column, not on event_type.
    const eqs = calls.flatMap(c => c.ops.filter(o => o[0] === 'eq'))
    expect(eqs).toContainEqual(['eq', 'party_type', 'mobile_party'])
  })

  it('ignores an unrecognised party_type instead of returning nothing', async () => {
    const { supabase, calls } = makeSupabase({ page: [{ id: 'a' }] })
    mockGetSupabase.mockReturnValue(supabase)

    const res = await GET(makeReq({ party_type: 'mobil_party' }))

    // A typo in the query string must not read as "there are no parties".
    const eqs = calls.flatMap(c => c.ops.filter(o => o[0] === 'eq' && o[1] === 'party_type'))
    expect(eqs).toHaveLength(0)
    expect(res.body.bookings).toHaveLength(1)
  })

  it('filters by stage when one is selected', async () => {
    const { supabase, calls } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)

    await GET(makeReq({ status: 'lead' }))

    const eqs = calls.flatMap(c => c.ops.filter(o => o[0] === 'eq'))
    expect(eqs).toContainEqual(['eq', 'status', 'lead'])
  })

  it('selects the columns the pipeline rows render', async () => {
    const { supabase, calls } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)

    await GET(makeReq())

    const cols = String(calls[0].ops.find(o => o[0] === 'select')?.[1] ?? '')
    expect(cols).toContain('party_type')
    expect(cols).toContain('source')
  })

  it('surfaces a list error as a 500 rather than an empty pipeline', async () => {
    const { supabase } = makeSupabase({ listError: { message: 'column missing' } })
    mockGetSupabase.mockReturnValue(supabase)

    const res = await GET(makeReq())

    // An empty Parties tab reads as "no work to do", which is the worst
    // possible way to report a broken query.
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('column missing')
  })
})
