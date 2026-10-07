/**
 * Tests for GET /api/admin/parties — the pipeline view.
 *
 * The regression worth locking down first is the `event_type` allowlist this
 * route used to filter on. It hid seven real parties in production (four
 * `room-rental` studio bookings and three whose event_type is the label
 * 'Kids Birthday Party') and would have hidden every mobile lead, because
 * `ensureLeadPlan` keeps the form's own words in `event_type`. A pipeline view
 * whose entire purpose is "no lead gets lost" must not be built on a list of
 * spellings, so this asserts the filter is an EXCLUSION of non-party forms.
 *
 * Since 2026-10-07 the route derives a booking STAGE and a PAYMENT STATUS for
 * every row from its payments (lib/bookingStatus.ts) and filters, counts and
 * pages in memory, so these tests assert on what comes back, not on the
 * PostgREST filters built.
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
import { ALL_STAGES } from '@/lib/bookingStatus'

function makeReq(params: Record<string, string> = {}) {
  return {
    headers: { get: () => null },
    nextUrl: { searchParams: { get: (k: string) => params[k] ?? null } },
  } as any
}

interface Opts {
  /** Every party row the route reads (it filters, counts and pages in memory). */
  rows?: Record<string, unknown>[]
  /** booking_payments rows. */
  payments?: { booking_id: string; amount_cents: number; payment_type: string }[]
  listError?: { message: string } | null
  paymentsError?: { message: string } | null
}

function makeSupabase(opts: Opts = {}) {
  /** Every chained call, so the test can assert on the filter that was built. */
  const calls: { table: string; ops: [string, ...unknown[]][] }[] = []

  const from = jest.fn((table: string) => {
    const ops: [string, ...unknown[]][] = []
    calls.push({ table, ops })

    const chain: any = {
      then: (res: any, rej: any) => {
        // The pricing catalog read returns nothing, so the compiled fallback
        // rate card is used — this suite is testing the pipeline.
        const result =
          table === 'bookings'
            ? { data: opts.listError ? null : (opts.rows ?? []), error: opts.listError ?? null }
            : table === 'booking_payments'
              ? { data: opts.paymentsError ? null : (opts.payments ?? []), error: opts.paymentsError ?? null }
              : { data: [], error: null }
        return Promise.resolve(result).then(res, rej)
      },
    }
    for (const m of ['select', 'eq', 'neq', 'in', 'not', 'is', 'gte', 'lte', 'lt', 'or', 'order', 'limit', 'range']) {
      chain[m] = jest.fn((...args: unknown[]) => { ops.push([m, ...args]); return chain })
    }
    return chain
  })

  return { supabase: { from } as any, calls }
}

const FUTURE = '2099-06-01'
const row = (id: string, status: string, party_type: string | null, extra: Record<string, unknown> = {}) =>
  ({ id, booking_ref: `HH-${id}`, status, party_type, party_date: FUTURE, total_cents: 90000, deposit_amount: 25000, ...extra })

const ids = (res: any) => res.body.bookings.map((b: any) => b.id)

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
    const nots = calls.flatMap(c => c.ops.filter(o => o[0] === 'not').map(o => o.slice(1)))
    expect(nots).toContainEqual(['event_type', 'in', '(vendor_registration)'])
  })

  it('hands the tab the live studio rate card', async () => {
    const { supabase } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)
    const res = await GET(makeReq())
    expect(res.body.studioRates.weekendBaseCents).toBeGreaterThan(0)
  })

  it('returns the booking stages: Inquiry, Quote sent, Booked, Completed, then the exits', async () => {
    const { supabase } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)
    const res = await GET(makeReq())
    expect(res.body.stages).toEqual(ALL_STAGES)
    expect(res.body.stages).toEqual(['inquiry', 'quoted', 'booked', 'completed', 'cancelled', 'lost'])
  })

  it('derives each row stage and payment status from the MONEY, not the status column', async () => {
    const { supabase } = makeSupabase({
      rows: [
        row('jenna', 'approved', 'in_studio_theme'), // approved, nothing paid
        row('alyssa', 'approved', 'in_studio_theme'), // approved, $250 paid
        row('gabriella', 'awaiting_deposit', 'in_studio_theme'), // $250 paid, column never moved
      ],
      payments: [
        { booking_id: 'alyssa', amount_cents: 25000, payment_type: 'deposit' },
        { booking_id: 'gabriella', amount_cents: 25000, payment_type: 'partial' },
      ],
    })
    mockGetSupabase.mockReturnValue(supabase)

    const res = await GET(makeReq())
    const by = Object.fromEntries(res.body.bookings.map((b: any) => [b.id, [b.stage, b.payment_status, b.paid_cents]]))
    expect(by.jenna).toEqual(['quoted', 'unpaid', 0])
    expect(by.alyssa).toEqual(['booked', 'deposit_paid', 25000])
    expect(by.gabriella).toEqual(['booked', 'deposit_paid', 25000])
  })

  it('counts every stage and every party type from one scan', async () => {
    const { supabase } = makeSupabase({
      rows: [
        row('a', 'lead', 'mobile_party'),
        row('b', 'lead', 'in_studio_theme'),
        row('c', 'quoted', 'mobile_party'),
        row('d', 'deposit_paid', 'studio_rental'),
        row('e', 'cancelled', null),
        row('f', 'lost', 'mobile_party'),
      ],
    })
    mockGetSupabase.mockReturnValue(supabase)

    const res = await GET(makeReq())

    // Every stage chip counts every row — the exits included, because those
    // chips are the only route back to a cancelled or lost party.
    expect(res.body.counts.byStage).toEqual({ inquiry: 2, quoted: 1, booked: 1, cancelled: 1, lost: 1 })
    // The type chips and "All" describe the DEFAULT list, which excludes exits.
    expect(res.body.counts.byPartyType).toEqual({ mobile_party: 2, in_studio_theme: 1, studio_rental: 1 })
    expect(res.body.counts.allTypes).toBe(4)
    expect(res.body.counts.all).toBe(4)
  })

  it('hides cancelled and lost by default, and lists them when their chip asks', async () => {
    const rows = [row('a', 'lead', 'mobile_party'), row('b', 'cancelled', 'mobile_party'), row('c', 'lost', 'mobile_party')]
    const cases: [Record<string, string>, string[]][] = [
      [{}, ['a']],
      [{ stage: 'cancelled' }, ['b']],
      [{ stage: 'lost' }, ['c']],
    ]
    for (const [params, expected] of cases) {
      const { supabase } = makeSupabase({ rows })
      mockGetSupabase.mockReturnValue(supabase)
      expect(ids(await GET(makeReq(params)))).toEqual(expected)
    }
  })

  it('filters by stage when one is selected', async () => {
    const { supabase } = makeSupabase({
      rows: [row('a', 'lead', null), row('b', 'approved', null), row('c', 'approved', null)],
      payments: [{ booking_id: 'c', amount_cents: 25000, payment_type: 'deposit' }],
    })
    mockGetSupabase.mockReturnValue(supabase)
    expect(ids(await GET(makeReq({ stage: 'booked' })))).toEqual(['c'])
  })

  it('still honours the old raw ?status= filter for a bookmarked URL', async () => {
    const { supabase } = makeSupabase({ rows: [row('a', 'lead', null), row('b', 'quoted', null)] })
    mockGetSupabase.mockReturnValue(supabase)
    expect(ids(await GET(makeReq({ status: 'quoted' })))).toEqual(['b'])
  })

  it('scopes the STAGE counts to the party-type filter, but not the type counts', async () => {
    const { supabase } = makeSupabase({
      rows: [row('a', 'lead', 'mobile_party'), row('b', 'lead', 'in_studio_theme'), row('c', 'quoted', 'mobile_party')],
    })
    mockGetSupabase.mockReturnValue(supabase)

    const res = await GET(makeReq({ party_type: 'mobile_party' }))

    expect(res.body.counts.byStage).toEqual({ inquiry: 1, quoted: 1 })
    expect(res.body.counts.all).toBe(2)
    expect(res.body.counts.byPartyType).toEqual({ mobile_party: 2, in_studio_theme: 1 })
    expect(ids(res).sort()).toEqual(['a', 'c'])
  })

  it('ignores an unrecognised party_type instead of returning nothing', async () => {
    const { supabase } = makeSupabase({ rows: [row('a', 'lead', 'mobile_party')] })
    mockGetSupabase.mockReturnValue(supabase)
    // A typo in the query string must not read as "there are no parties".
    expect(ids(await GET(makeReq({ party_type: 'mobil_party' })))).toEqual(['a'])
  })

  it('hides past parties by default but keeps undated ones; a booked past party is Completed', async () => {
    const { supabase } = makeSupabase({
      rows: [
        row('past', 'paid_in_full', null, { party_date: '2020-01-01' }),
        row('undated', 'lead', null, { party_date: null }),
        row('soon', 'lead', null),
      ],
    })
    mockGetSupabase.mockReturnValue(supabase)
    expect(ids(await GET(makeReq())).sort()).toEqual(['soon', 'undated'])

    const { supabase: s2 } = makeSupabase({ rows: [row('past', 'paid_in_full', null, { party_date: '2020-01-01' })] })
    mockGetSupabase.mockReturnValue(s2)
    const all = await GET(makeReq({ hidePast: 'false' }))
    expect(all.body.bookings[0].stage).toBe('completed')
  })

  it('selects the columns the pipeline rows render', async () => {
    const { supabase, calls } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)
    await GET(makeReq())
    const cols = String(calls.find(c => c.table === 'bookings')?.ops.find(o => o[0] === 'select')?.[1] ?? '')
    expect(cols).toContain('party_type')
    expect(cols).toContain('source')
    expect(cols).toContain('deposit_amount')
  })

  it('surfaces a list error as a 500 rather than an empty pipeline', async () => {
    const { supabase } = makeSupabase({ listError: { message: 'column missing' } })
    mockGetSupabase.mockReturnValue(supabase)
    const res = await GET(makeReq())
    // An empty Parties tab reads as "no work to do", the worst way to report a broken query.
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('column missing')
  })

  it('refuses (503) when payments cannot be read, rather than calling every party Unpaid', async () => {
    const { supabase } = makeSupabase({ rows: [row('a', 'approved', null)], paymentsError: { message: 'timeout' } })
    mockGetSupabase.mockReturnValue(supabase)
    const res = await GET(makeReq())
    expect(res.status).toBe(503)
  })
})
