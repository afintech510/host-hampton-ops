import { NOW } from '../helpers/eviteFixtures'
import { ADMIN_PW, BOOKING_ID, OTHER_BOOKING_ID, adminBookingRow, adminReq, makeAdminDb, sendRow, type AdminDb } from '../helpers/adminInvitationFixtures'
import { readSrc } from '../helpers/sourceScan'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'

/**
 * GET /api/admin/evites/summary (the Booked page's per-party invitation button): the gate, the
 * eligibility and state it reports, the batch read's allow-listed columns and chunking, and the
 * three-outcome rule (a failed read is "unavailable", never "no invitation").
 */

let db: AdminDb
jest.mock('@/lib/supabase', () => ({ getSupabase: () => db.supabase }))

import { GET } from '@/app/api/admin/evites/summary/route'

const ENV = ['EVITES_PAGES', 'EVITES_PILOT_REFS', 'ADMIN_PASSWORD', 'ADMIN_SESSION_SECRET', 'PORTAL_LINK_SIGNING_SECRET'] as const
const saved: Record<string, string | undefined> = {}

const call = (ids: string[] | string, o: Parameters<typeof adminReq>[1] = {}) =>
  GET(adminReq(`/api/admin/evites/summary?bookingIds=${Array.isArray(ids) ? ids.join(',') : ids}`, o))

const STUDIO_ID = '77777777-7777-4777-8777-777777777777'
const CANCELLED_ID = '88888888-8888-4888-8888-888888888888'
const NO_EVITE_ID = '99999999-9999-4999-8999-999999999999'

function fullDb(): AdminDb {
  return makeAdminDb({
    extraBookings: [
      adminBookingRow({ id: STUDIO_ID, booking_ref: 'HH-STUDIO', party_type: 'studio_rental', party_tags: null }),
      adminBookingRow({ id: CANCELLED_ID, booking_ref: 'HH-CANC', status: 'cancelled' }),
      adminBookingRow({ id: NO_EVITE_ID, booking_ref: 'HH-NOEV' }),
    ],
  })
}

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance'],
  })
  for (const k of ENV) saved[k] = process.env[k]
  process.env.EVITES_PAGES = 'on'
  delete process.env.EVITES_PILOT_REFS
  process.env.ADMIN_PASSWORD = ADMIN_PW
  process.env.ADMIN_SESSION_SECRET = 'test-admin-session-secret-0123456789'
  process.env.PORTAL_LINK_SIGNING_SECRET = 'test-signing-secret-0123456789abcdef'
  db = fullDb()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('the gate', () => {
  it('401 with no credential, before any database read', async () => {
    expect((await call([BOOKING_ID], { auth: 'none' })).status).toBe(401)
    expect(db.selects).toHaveLength(0)
  })

  it('an unset ADMIN_PASSWORD is not a bypass', async () => {
    delete process.env.ADMIN_PASSWORD
    const res = await call([BOOKING_ID], { auth: 'none' })
    expect(res.status).toBe(401)
    expect(db.selects).toHaveLength(0)
  })

  it('refuses a missing, malformed or oversized id list without reading', async () => {
    expect((await call('')).status).toBe(400)
    expect((await call(['not-a-uuid'])).status).toBe(400)
    const many = Array.from({ length: 301 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    expect((await call(many)).status).toBe(400)
    expect(db.selects).toHaveLength(0)
  })
})

describe('what it reports', () => {
  it('a booked party with an invitation: public link, live state, not yet emailed', async () => {
    const res = await call([BOOKING_ID])
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const { summaries } = await res.json()
    expect(summaries[BOOKING_ID]).toMatchObject({
      eligible: true,
      canEnsure: true,
      noParentEmail: false,
      evite: { slug: 'mia-glow-7kq2', publicUrl: `${CANONICAL_ORIGIN}/i/mia-glow-7kq2`, state: 'live', inviteReadySent: false },
    })
    expect(typeof summaries[BOOKING_ID].evite.renderFresh).toBe('boolean')
  })

  it('a sent invite_ready email is inviteReadySent; a failed or other-type row is not', async () => {
    db = makeAdminDb({ sends: [sendRow({ send_type: 'invite_ready', status: 'sent' })] })
    expect((await (await call([BOOKING_ID])).json()).summaries[BOOKING_ID].evite.inviteReadySent).toBe(true)
    db = makeAdminDb({ sends: [sendRow({ send_type: 'invite_ready', status: 'failed' }), sendRow({ send_type: 'lead_preview', status: 'sent' })] })
    expect((await (await call([BOOKING_ID])).json()).summaries[BOOKING_ID].evite.inviteReadySent).toBe(false)
  })

  it('an eligible booking with no invitation: evite null and canEnsure', async () => {
    const { summaries } = await (await call([NO_EVITE_ID])).json()
    expect(summaries[NO_EVITE_ID]).toMatchObject({ eligible: true, canEnsure: true, evite: null })
  })

  it('a studio rental and a cancelled party are not eligible', async () => {
    const { summaries } = await (await call([STUDIO_ID, CANCELLED_ID])).json()
    expect(summaries[STUDIO_ID]).toMatchObject({ eligible: false, canEnsure: false, evite: null })
    expect(summaries[CANCELLED_ID]).toMatchObject({ eligible: false, canEnsure: false })
  })

  it('an unknown booking id is null; a missing parent email is reported', async () => {
    db = makeAdminDb({ booking: { contact_email: null } })
    const { summaries } = await (await call([BOOKING_ID, OTHER_BOOKING_ID])).json()
    expect(summaries[OTHER_BOOKING_ID]).toBeNull()
    expect(summaries[BOOKING_ID].noParentEmail).toBe(true)
  })

  it('a deposit-less party is a preview; an archived invitation is withdrawn', async () => {
    db = makeAdminDb({ payments: [], booking: { status: 'awaiting_deposit' } })
    expect((await (await call([BOOKING_ID])).json()).summaries[BOOKING_ID].evite.state).toBe('preview')
    db = makeAdminDb({ evite: { archived_at: '2026-10-30T00:00:00Z' } })
    expect((await (await call([BOOKING_ID])).json()).summaries[BOOKING_ID].evite).toMatchObject({ state: 'unavailable', renderFresh: null })
  })

  it('pages switched off: nothing can be created', async () => {
    process.env.EVITES_PAGES = 'off'
    const { summaries } = await (await call([NO_EVITE_ID])).json()
    expect(summaries[NO_EVITE_ID]).toMatchObject({ eligible: true, canEnsure: false })
  })
})

describe('the batch read', () => {
  it('never selects *; reads each table once for the page, not once per row', async () => {
    await call([BOOKING_ID, STUDIO_ID, CANCELLED_ID, NO_EVITE_ID])
    expect(db.selects.length).toBeGreaterThan(0)
    for (const s of db.selects) {
      expect(s.cols).not.toBe('')
      expect(s.cols).not.toContain('*')
    }
    for (const table of ['evites', 'bookings', 'booking_payments', 'booking_line_items', 'party_themes', 'evite_sends']) {
      expect(db.selects.filter((s) => s.table === table)).toHaveLength(1)
    }
    // No raw RSVP contact, no render claim, no provider id.
    const all = db.selects.map((s) => s.cols).join(' | ')
    for (const forbidden of ['render_claim', 'provider_id', 'reminder_email', 'club_email']) expect(all).not.toContain(forbidden)
  })

  it.each(['evites', 'bookings', 'booking_payments', 'booking_line_items', 'party_themes', 'evite_sends'])(
    'a failed %s read is 503 "unavailable", never an empty or "no invitation" answer',
    async (table) => {
      db.errors.push({ table, op: 'select' })
      const res = await call([BOOKING_ID])
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.error).toMatch(/unavailable/i)
      expect(body.summaries).toBeUndefined()
    },
  )
})

describe('source rules', () => {
  const route = readSrc('app', 'api', 'admin', 'evites', 'summary', 'route.ts')
  const lib = readSrc('lib', 'evites', 'adminSummary.ts')

  it('the handler authorizes before any database call', () => {
    const gate = route.search(/isAdminAuthorized\s*\(/)
    const dbAt = route.search(/getSupabase\s*\(/)
    expect(gate).toBeGreaterThan(-1)
    expect(dbAt).toBeGreaterThan(gate)
  })

  it('no select("*"), no bare .select(), every read checks its error and the .in() chunk is 300', () => {
    for (const src of [route, lib]) {
      expect(/select\(\s*['"`]\*['"`]/.test(src)).toBe(false)
      expect(/\.select\(\s*\)/.test(src)).toBe(false)
    }
    expect(lib).toMatch(/SUMMARY_IN_CHUNK\s*=\s*300/)
    const reads = lib.match(/await supabase\s*\.from\(/g) ?? []
    const checked = lib.match(/\.error\)\s*return\s*\{\s*kind:\s*'unavailable'/g) ?? []
    expect(reads.length).toBeGreaterThanOrEqual(6)
    expect(checked.length).toBe(reads.length)
  })

  it('state comes from inviteState and freshness from the same hash comparison as the card', () => {
    expect(lib).toMatch(/\binviteState\s*\(/)
    expect(lib).toMatch(/renderInputsHash\s*\(\s*facts\s*\)\s*===\s*evite\.render_inputs_hash/)
    expect(lib).toMatch(/isEviteEligible\s*\(/)
  })

  it('exports only handlers and route config', () => {
    const exported = Array.from(route.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)).map((m) => m[1]).sort()
    expect(exported).toEqual(['GET', 'dynamic', 'runtime'])
  })
})
