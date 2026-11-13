/**
 * The operational gate for an outside event (`party_type = 'outside_event'`,
 * migration 096): an invitation for a client's event at a venue that is not ours.
 *
 * The helper is pure. The Booked tab and the dashboard's inquiry count exclude it
 * AT THE QUERY, so the test drives them against a small fake that records every
 * `.or()` and applies it the way PostgREST does (a bare `.neq` would drop NULL).
 */
jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: async () => body, body }),
  },
}))
jest.mock('@/lib/adminAuth', () => ({ isAdminAuthorized: () => true, unauthorizedResponse: () => ({ status: 401 }) }))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))

import { OUTSIDE_EVENT_OR_FILTER, OUTSIDE_EVENT_TYPE, isOutsideEventType, takesPayments } from '@/lib/outsideEventGate'
import { GET as bookedGet } from '@/app/api/admin/booked/route'
import { loadDashboard } from '@/lib/crewAppData'

describe('outsideEventGate', () => {
  it('names one party type and refuses payments only for it', () => {
    expect(OUTSIDE_EVENT_TYPE).toBe('outside_event')
    expect(isOutsideEventType('outside_event')).toBe(true)
    expect(takesPayments('outside_event')).toBe(false)
    for (const t of ['in_studio_theme', 'mobile_party', 'studio_rental', 'hat_bar', 'unknown', '', null, undefined]) {
      expect(isOutsideEventType(t)).toBe(false)
      expect(takesPayments(t)).toBe(true)
    }
  })

  it('the exclusion is a null-safe string literal', () => {
    expect(OUTSIDE_EVENT_OR_FILTER).toBe('party_type.is.null,party_type.neq.outside_event')
  })
})

/** Rows + a PostgREST-ish chain that applies `.or()` / `.in()` / `.not(in)` and records the `.or()` strings. */
function fakeDb(bookings: Record<string, any>[], payments: Record<string, any>[] = []) {
  const ors: string[] = []
  const from = (table: string) => {
    const rows = table === 'bookings' ? bookings : table === 'booking_payments' ? payments : []
    const preds: Array<(r: any) => boolean> = []
    const q: any = {
      select: () => q,
      order: () => q,
      limit: () => q,
      eq: () => q,
      neq: () => q,
      range: () => q,
      gte: (c: string, v: any) => { preds.push(r => r[c] >= v); return q },
      lte: (c: string, v: any) => { preds.push(r => r[c] <= v); return q },
      in: (c: string, vs: any[]) => { preds.push(r => vs.includes(r[c])); return q },
      not: (c: string, op: string, v: string) => {
        if (op === 'in') {
          const set = v.replace(/[()]/g, '').split(',')
          preds.push(r => !set.includes(r[c]))
        }
        return q
      },
      or: (expr: string) => {
        if (table === 'bookings') ors.push(expr)
        const terms = expr.split(',').map(t => t.split('.'))
        preds.push(r => terms.some(([c, op, ...rest]) => {
          const v = rest.join('.')
          if (op === 'is') return r[c] === null || r[c] === undefined
          if (op === 'neq') return r[c] !== null && r[c] !== undefined && r[c] !== v
          return false
        }))
        return q
      },
      then: (res: any, rej: any) => Promise.resolve({ data: rows.filter(r => preds.every(p => p(r))), error: null }).then(res, rej),
    }
    return q
  }
  return { sb: { from } as any, ors }
}

const booking = (id: string, over: Record<string, any> = {}) => ({
  id, booking_ref: `HH-${id}`, status: 'confirmed', party_type: 'in_studio_theme', event_type: 'kid-party',
  party_date: '2026-12-05', created_at: '2026-11-01T00:00:00Z', total_cents: 0, ...over,
})

describe('the Booked tab ignores an outside event', () => {
  it('lists a confirmed studio party and a null-typed one, never the outside event', async () => {
    const db = fakeDb([
      booking('studio'),
      booking('untyped', { party_type: null }),
      booking('outside', { party_type: 'outside_event', event_type: 'baby-shower' }),
    ])
    mockGetSupabase.mockReturnValue(db.sb)
    const res: any = await bookedGet({} as any)
    expect(res.status).toBe(200)
    const refs = (res.body.parties as any[]).map(p => p.booking_ref).sort()
    expect(refs).toEqual(['HH-studio', 'HH-untyped'])
    // Both bookings queries (by payment ids, and the status-only sweep) carry the literal.
    expect(db.ors.length).toBeGreaterThanOrEqual(1)
    expect(db.ors.every(e => e === OUTSIDE_EVENT_OR_FILTER)).toBe(true)
  })

  it('a paid outside event (it should never happen) is still not a booked party', async () => {
    const db = fakeDb(
      [booking('outside', { party_type: 'outside_event', status: 'approved' })],
      [{ booking_id: 'outside', payment_type: 'deposit', payment_method: 'venmo', amount_cents: 25000, paid_at: '2026-11-02T00:00:00Z' }],
    )
    mockGetSupabase.mockReturnValue(db.sb)
    const res: any = await bookedGet({} as any)
    expect(res.body.parties).toEqual([])
  })
})

describe('the dashboard does not count an outside event as an inquiry', () => {
  it('lead velocity reads bookings through the same null-safe exclusion', async () => {
    const db = fakeDb([
      booking('studio', { created_at: '2026-11-10T00:00:00Z' }),
      booking('outside', { party_type: 'outside_event', created_at: '2026-11-10T00:00:00Z' }),
    ])
    const out: any = await loadDashboard(db.sb, [], new Date('2026-11-12T15:00:00Z'))
    expect(db.ors).toContain(OUTSIDE_EVENT_OR_FILTER)
    expect(out.errors.join(' ')).not.toMatch(/inquiries/)
  })
})
