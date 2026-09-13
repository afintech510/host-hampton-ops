/**
 * GET /api/cron/booking-locks.
 *
 * This job has been scheduled at cron-job.org daily at 04:00 UTC and has
 * answered **401 on every run** in the whole ten-day nginx window — its
 * configured secret no longer matches `CRON_SECRET`. Nothing monitors a cron's
 * status, so a job failing every day looks exactly like one that is working,
 * and seven approved bookings are past their modification cutoff and still say
 * "Approved".
 *
 * It is therefore the one job whose behaviour could NOT be exercised in
 * production: making it run means flipping real customers' bookings, which is
 * the job's decision to make on a schedule and not mine to make by hand. This
 * file is that coverage instead, driven against a store that returns only the
 * rows a conditional UPDATE really matched — the distinction the old code could
 * not see, because it had no `.select()`.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }),
  },
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))

import { GET } from '@/app/api/cron/booking-locks/route'

const CRON_SECRET = 'test-cron-secret'
const TODAY = new Date().toISOString().split('T')[0]

function daysFromToday(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().split('T')[0]
}

/**
 * A store that models the two things the old route could not see: a conditional
 * UPDATE matching zero rows, and an INSERT that fails.
 */
function makeStore(
  bookings: any[],
  opts: { failAudit?: boolean; failUpdate?: boolean; afterRead?: () => void } = {}
) {
  const audits: any[] = []
  const supabase = {
    from(table: string) {
      if (table === 'booking_modifications') {
        return {
          insert: async (row: any) => {
            if (opts.failAudit) return { error: { message: 'audit refused' } }
            audits.push(row)
            return { error: null }
          },
        }
      }
      // bookings
      const chain: any = { _filters: [] as [string, any][], _update: null as any }
      chain.select = (_c?: string) => {
        if (chain._update) {
          if (opts.failUpdate) return Promise.resolve({ data: null, error: { message: 'update refused' } })
          const matched = bookings.filter(b => chain._filters.every(([k, v]) => b[k] === v))
          for (const b of matched) Object.assign(b, chain._update)
          return Promise.resolve({ data: matched.map(b => ({ id: b.id })), error: null })
        }
        return chain
      }
      chain.update = (patch: any) => { chain._update = patch; return chain }
      chain.eq = (k: string, v: any) => { chain._filters.push([k, v]); return chain }
      chain.lte = (k: string, v: any) => { chain._filters.push(['__lte:' + k, v]); return chain }
      // A read (no .update) resolves as a thenable at the end of the chain.
      chain.then = (res: any) => {
        const matched = bookings.filter(b =>
          chain._filters.every(([k, v]) =>
            k.startsWith('__lte:') ? String(b[k.slice(6)]) <= String(v) : b[k] === v
          )
        )
        // A snapshot, so a caller can move the row out from under the writer —
        // which is the race the status guard exists for.
        const snapshot = matched.map(b => ({ ...b }))
        opts.afterRead?.()
        return Promise.resolve({ data: snapshot, error: null }).then(res)
      }
      return chain
    },
  }
  return { supabase, audits, bookings }
}

function makeReq(secret?: string) {
  const headers = new Map<string, string>()
  if (secret) headers.set('x-cron-secret', secret)
  return {
    headers: { get: (k: string) => headers.get(k) ?? null },
    nextUrl: { searchParams: { get: () => null } },
  } as any
}

function booking(over: Record<string, any> = {}) {
  return {
    id: 'b1', booking_ref: 'HH-2026-0001', status: 'approved',
    modification_cutoff: daysFromToday(-1), party_date: daysFromToday(13),
    contact_email: 'a@example.com', contact_name: 'A',
    ...over,
  }
}

const originalEnv = process.env
beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...originalEnv, CRON_SECRET }
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())
afterAll(() => { process.env = originalEnv })

it('401s without the secret, and fails closed when CRON_SECRET is unset', async () => {
  expect((await GET(makeReq())).status).toBe(401)
  delete process.env.CRON_SECRET
  expect((await GET(makeReq())).status).toBe(401)
  expect((await GET(makeReq('anything'))).status).toBe(401)
})

it('locks an approved booking whose cutoff has passed and whose party has not', async () => {
  const store = makeStore([booking()])
  mockGetSupabase.mockReturnValue(store.supabase)

  const res = await GET(makeReq(CRON_SECRET))

  expect(res.json()).toMatchObject({ ok: true, checked: 1, locked: 1, skippedPast: 0, failed: 0 })
  expect(store.bookings[0].status).toBe('modifications_locked')
  expect(store.audits).toHaveLength(1)
  expect(store.audits[0].modified_by).toBe('system')
})

it('LEAVES a booking whose party has already happened, and says which', async () => {
  // Three of the seven live candidates are for parties on 2026-08-21,
  // 2026-09-04 and 2026-09-12. Relabelling finished history is not a lock.
  const store = makeStore([booking({ booking_ref: 'HH-PAST-1', party_date: daysFromToday(-20) })])
  mockGetSupabase.mockReturnValue(store.supabase)

  const res = await GET(makeReq(CRON_SECRET))

  expect(res.json()).toMatchObject({ checked: 1, locked: 0, skippedPast: 1 })
  expect(store.bookings[0].status).toBe('approved')
  expect(res.json().notes.join(' ')).toMatch(/HH-PAST-1/)
  expect(res.json().notes.join(' ')).toMatch(/already over/)
  expect(store.audits).toHaveLength(0)
})

it('a party TODAY is still lockable — the boundary is strictly in the past', async () => {
  const store = makeStore([booking({ party_date: TODAY })])
  mockGetSupabase.mockReturnValue(store.supabase)
  const res = await GET(makeReq(CRON_SECRET))
  expect(res.json()).toMatchObject({ locked: 1, skippedPast: 0 })
})

it('does NOT claim to have locked a row that was no longer approved', async () => {
  // The old code had no status guard on the UPDATE and no .select(), so it
  // counted `locked++` for a write it never verified. Here the row moves out
  // from under it between the read and the write.
  const rows = [booking()]
  const store = makeStore(rows, { afterRead: () => { rows[0].status = 'cancelled' } })
  mockGetSupabase.mockReturnValue(store.supabase)

  const res = await GET(makeReq(CRON_SECRET))

  expect(res.json()).toMatchObject({ checked: 1, locked: 0 })
  expect(res.json().notes.join(' ')).toMatch(/no longer approved/)
  expect(store.bookings[0].status).toBe('cancelled')
  expect(store.audits).toHaveLength(0)
})

it('reports a failed UPDATE rather than counting it, and answers ok:false', async () => {
  const store = makeStore([booking()], { failUpdate: true })
  mockGetSupabase.mockReturnValue(store.supabase)

  const res = await GET(makeReq(CRON_SECRET))

  expect(res.json()).toMatchObject({ ok: false, checked: 1, locked: 0, failed: 1 })
  expect(res.json().notes.join(' ')).toMatch(/update refused/)
})

it('a refused audit row does not undo the lock, but is not silent either', async () => {
  const store = makeStore([booking()], { failAudit: true })
  mockGetSupabase.mockReturnValue(store.supabase)
  const err = jest.spyOn(console, 'error')

  const res = await GET(makeReq(CRON_SECRET))

  expect(res.json()).toMatchObject({ locked: 1 })
  expect(store.bookings[0].status).toBe('modifications_locked')
  expect(err.mock.calls.flat().join(' ')).toMatch(/BOOKING AUDIT ROW NOT WRITTEN/)
})

it('an unreadable bookings table is a 500, not a green "locked 0"', async () => {
  mockGetSupabase.mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({ lte: () => Promise.resolve({ data: null, error: { message: 'statement timeout' } }) }),
      }),
    }),
  })

  const res = await GET(makeReq(CRON_SECRET))
  expect(res.status).toBe(500)
})
