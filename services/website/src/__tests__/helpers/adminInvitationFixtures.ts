import { NextRequest } from 'next/server'
import { makeFakeEviteDb } from './fakeEviteDb'
import { bookingRow, evitesRow, LINE_ITEM_ROWS, THEME_ROWS } from './eviteFixtures'
import { rsvpChecks, rsvpRow } from './rsvpFixtures'
import { buildAdminCookieValue, adminSessionSecret } from '@/lib/adminAuth'

/** Fixtures for the admin "Invitation & RSVPs" tests (P08): UUID ids, the columns the admin route reads, real auth. */

export const BOOKING_ID = '11111111-1111-4111-8111-111111111111'
export const EVITE_ID = '22222222-2222-4222-8222-222222222222'
export const OTHER_BOOKING_ID = '33333333-3333-4333-8333-333333333333'
export const OTHER_EVITE_ID = '44444444-4444-4444-8444-444444444444'
export const ADMIN_PW = 'test-admin-password'
export const ORIGIN = 'http://localhost:3002'

type Row = Record<string, unknown>

/** Every column `ADMIN_EVITE_COLUMNS` names (the P03 fixture predates some of them). */
export const adminEviteRow = (over: Row = {}): Row => ({
  ...evitesRow({ id: EVITE_ID, booking_id: BOOKING_ID }),
  previous_slugs: [],
  rendered_at: null,
  cal_version: 0,
  went_live_at: null,
  cancelled_notice_at: null,
  created_at: '2026-10-01T12:05:00Z',
  updated_at: '2026-10-01T12:05:00Z',
  ...over,
})

export const adminBookingRow = (over: Row = {}): Row => bookingRow({ id: BOOKING_ID, ...over })

/** An RSVP for THIS party. Reminder contacts are seeded so a leak is detectable. */
export const adminRsvp = (over: Row = {}): Row => rsvpRow({ evite_id: EVITE_ID, ...over })

export const RAW = {
  email: 'secret.parent@example.org',
  phone: '+16315550123',
  club: 'club.parent@example.net',
} as const

let sendSeq = 0
export const sendRow = (over: Row = {}): Row => ({
  id: `55555555-5555-4555-8555-${String(++sendSeq).padStart(12, '0')}`,
  evite_id: EVITE_ID,
  rsvp_id: null,
  send_type: 'lead_preview',
  ref_version: 0,
  channel: 'email',
  status: 'sent',
  attempts: 1,
  outcome: null,
  provider_id: 'secret-provider-id-123',
  last_error: null,
  claimed_at: '2026-10-31T12:00:00Z',
  sent_at: '2026-10-31T12:00:05Z',
  ...over,
})

export interface AdminDbOptions {
  evite?: Row | null
  booking?: Row
  rsvps?: Row[]
  sends?: Row[]
  payments?: Row[]
  extraBookings?: Row[]
  extraEvites?: Row[]
}

export function makeAdminDb(o: AdminDbOptions = {}) {
  return makeFakeEviteDb({
    tables: {
      evites: [...(o.evite === null ? [] : [adminEviteRow(o.evite ?? {})]), ...(o.extraEvites ?? [])],
      bookings: [adminBookingRow(o.booking), ...(o.extraBookings ?? [])],
      booking_payments: o.payments ?? [{ booking_id: BOOKING_ID, amount_cents: 25000, payment_type: 'deposit' }],
      booking_line_items: LINE_ITEM_ROWS.map((r) => ({ ...r, booking_id: BOOKING_ID })),
      party_themes: THEME_ROWS,
      evite_rsvps: o.rsvps ?? [],
      evite_sends: o.sends ?? [],
      booking_modifications: [],
    },
    rowDefaults: {
      // The database's DEFAULTs for an INSERT through `ensureEviteForBooking`.
      evites: () => ({
        id: '66666666-6666-4666-8666-666666666666',
        previous_slugs: [],
        template_slug: 'glow',
        show_host_contact: true,
        render_version: 0,
        went_live_at: null,
        archived_at: null,
      }),
    },
    checks: {
      evite_rsvps: rsvpChecks,
      // The two migration-068 CHECKs set_theme can trip.
      evites: (r) => {
        for (const col of ['theme_word', 'theme_sub'] as const) {
          const v = r[col]
          if (typeof v === 'string' && (v.length < 1 || v.length > 12)) return `evites_${col}_check`
        }
        return null
      },
    },
  })
}

export type AdminDb = ReturnType<typeof makeAdminDb>

/** Wrap `from('evites').update(...)` so a patch matching `when` fails like Postgres on `evites_slug_key`. */
export function collideSlugUpdates(db: AdminDb, when: (patch: Row) => boolean, times = Infinity): { count: () => number } {
  let n = 0
  const realFrom = (db.supabase as unknown as { from: (t: string) => Record<string, unknown> }).from.bind(db.supabase)
  ;(db.supabase as unknown as { from: unknown }).from = (table: string) => {
    const q = realFrom(table) as { update: (p: Row) => unknown }
    if (table !== 'evites') return q
    const realUpdate = q.update.bind(q)
    q.update = (patch: Row) => {
      if (!when(patch) || n >= times) return realUpdate(patch)
      n += 1
      const failing: Record<string, unknown> = {}
      for (const m of ['eq', 'is', 'select', 'neq', 'lt']) failing[m] = () => failing
      failing.then = (ok: (v: unknown) => unknown) =>
        Promise.resolve({
          data: null,
          error: { code: '23505', message: 'duplicate key value violates unique constraint "evites_slug_key"', details: 'Key (slug)=(x) already exists.' },
        }).then(ok)
      return failing
    }
    return q
  }
  return { count: () => n }
}

type Auth = 'password' | 'none' | { cookieEmail: string }

export function adminReq(url: string, o: { method?: string; auth?: Auth; body?: unknown; raw?: string } = {}): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const auth = o.auth ?? 'password'
  if (auth === 'password') headers.authorization = `Bearer ${ADMIN_PW}`
  else if (auth !== 'none') {
    headers.cookie = `hh_admin=${buildAdminCookieValue(auth.cookieEmail, adminSessionSecret())}`
    headers['sec-fetch-site'] = 'same-origin'
  }
  const method = o.method ?? 'GET'
  const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers }
  if (method !== 'GET') init.body = o.raw ?? JSON.stringify(o.body ?? {})
  return new NextRequest(`${ORIGIN}${url}`, init)
}
