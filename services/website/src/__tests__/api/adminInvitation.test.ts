import { NOW, bookingRow } from '../helpers/eviteFixtures'
import {
  ADMIN_PW,
  BOOKING_ID,
  EVITE_ID,
  OTHER_BOOKING_ID,
  OTHER_EVITE_ID,
  RAW,
  adminBookingRow,
  adminEviteRow,
  adminReq,
  adminRsvp,
  collideSlugUpdates,
  makeAdminDb,
  sendRow,
  type AdminDb,
} from '../helpers/adminInvitationFixtures'
import { ADMIN_RSVP_COLUMNS } from '@/lib/evites/views'
import { ADMIN_EVITE_COLUMNS } from '@/lib/evites/adminView'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { isSlugShape, slugNamePart } from '@/lib/evites/slug'
import { renderInputsHash } from '@/lib/evites/hash'
import { loadFactsContext } from '@/lib/evites/adminLoad'
import { adminHooks } from '@/lib/evites/adminHooks'

/**
 * GET / POST /api/admin/parties/[id]/invitation (spec §7.3): the gate, the
 * allow-listed reads, the logged reveal, and every action's guard and write.
 *
 * Driven against `fakeEviteDb` (real filter semantics: a conditional UPDATE that
 * matches nothing touches nothing). `renderEvite` / `queueRender` are mocked: they
 * have their own suites and would otherwise draw a real JPEG.
 */

let db: AdminDb
jest.mock('@/lib/supabase', () => ({ getSupabase: () => db.supabase }))
jest.mock('@/lib/evites/render', () => ({ renderEvite: jest.fn(), queueRender: jest.fn(() => 'queued') }))

import { GET, POST } from '@/app/api/admin/parties/[id]/invitation/route'
import { renderEvite, queueRender } from '@/lib/evites/render'

const renderMock = renderEvite as jest.Mock
const queueMock = queueRender as jest.Mock

const ENV = ['EVITES_PAGES', 'EVITES_PILOT_REFS', 'ADMIN_PASSWORD', 'ADMIN_SESSION_SECRET', 'PORTAL_LINK_SIGNING_SECRET', 'SUPABASE_URL'] as const
const saved: Record<string, string | undefined> = {}
const realNotify = adminHooks.notifyPartyCancelled

const URL_FOR = (id = BOOKING_ID) => `/api/admin/parties/${id}/invitation`
const ctx = (id = BOOKING_ID) => ({ params: { id } })
const get = (query = '', o: Parameters<typeof adminReq>[1] = {}, id = BOOKING_ID) => GET(adminReq(`${URL_FOR(id)}${query}`, o), ctx(id))
const post = (body: unknown, o: Parameters<typeof adminReq>[1] = {}, id = BOOKING_ID) => POST(adminReq(URL_FOR(id), { ...o, method: 'POST', body }), ctx(id))

const audits = () => db.inserts.filter((i) => i.table === 'booking_modifications').map((i) => i.row)
const evUpdates = () => db.updates.filter((u) => u.table === 'evites')
const eviteRow = () => db.tables.evites.find((e) => e.id === EVITE_ID) as Record<string, unknown>

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
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
  db = makeAdminDb()
  renderMock.mockReset()
  queueMock.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  adminHooks.notifyPartyCancelled = realNotify
  jest.useRealTimers()
  jest.restoreAllMocks()
})

// ----------------------------------------------------------------------------------------------

describe('the gate', () => {
  it('GET and POST answer 401 with no credential, before any database read', async () => {
    expect((await get('', { auth: 'none' })).status).toBe(401)
    expect((await post({ action: 'archive' }, { auth: 'none' })).status).toBe(401)
    expect(db.selects).toHaveLength(0)
    expect(db.updates).toHaveLength(0)
    expect(db.inserts).toHaveLength(0)
  })

  it('a wrong password is 401, and an unset ADMIN_PASSWORD is not a bypass', async () => {
    expect((await GET(adminReq(URL_FOR(), { auth: 'none' }), ctx())).status).toBe(401)
    delete process.env.ADMIN_PASSWORD
    const res = await GET(
      new (jest.requireActual('next/server').NextRequest)(`http://localhost:3002${URL_FOR()}`, { headers: { authorization: 'Bearer undefined' } }),
      ctx(),
    )
    expect(res.status).toBe(401)
  })

  it('a booking id that is not a uuid is 404 and reads nothing', async () => {
    expect((await get('', {}, 'not-a-uuid')).status).toBe(404)
    expect((await post({ action: 'archive' }, {}, 'not-a-uuid')).status).toBe(404)
    expect(db.selects).toHaveLength(0)
  })
})

// ----------------------------------------------------------------------------------------------

describe('GET: the card data', () => {
  it('a live party: state, facts, links, warnings clear', async () => {
    db = makeAdminDb({ rsvps: [adminRsvp()] })
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const b = await res.json()
    expect(b.state).toBe('live')
    expect(b.eligible).toBe(true)
    expect(b.facts.title).toBe("Mia's Glow Party")
    expect(b.facts.dateLine).toContain('Saturday, November 14')
    expect(b.facts.guestCap).toBe(12)
    expect(b.links.publicUrl).toBe(`${CANONICAL_ORIGIN}/i/mia-glow-7kq2`)
    expect(b.links.hostPageUrl).toBe(`${CANONICAL_ORIGIN}/my-booking/invitation`)
    expect(b.links.hostPageNote).toMatch(/sign-in/)
    expect(b.warnings).toEqual({ needsTime: false, noParentEmail: false })
    expect(b.evite.canReslug).toBe(true)
    expect(b.templateOptions).toEqual(['glow', 'plain'])
    expect(b.rsvps.available).toBe(true)
    expect(b.ledger).toEqual({ available: true, truncated: false, groups: [] })
  })

  it('never selects *: every read names columns, and the lists are the allow-lists', async () => {
    db = makeAdminDb({ rsvps: [adminRsvp()], sends: [sendRow()] })
    await get()
    expect(db.selects.length).toBeGreaterThan(5)
    for (const s of db.selects) {
      expect(s.cols).not.toBe('')
      expect(s.cols).not.toContain('*')
    }
    expect(db.selects.find((s) => s.table === 'evites')?.cols).toBe(ADMIN_EVITE_COLUMNS.join(', '))
    expect(db.selects.find((s) => s.table === 'evites')?.cols).not.toContain('render_claim,')
    const rsvpSelects = db.selects.filter((s) => s.table === 'evite_rsvps').map((s) => s.cols)
    expect(rsvpSelects).toContain(ADMIN_RSVP_COLUMNS.join(', '))
    // The contact columns live in ONE narrow select of their own, never in the list.
    expect(rsvpSelects.filter((c) => c.includes('reminder_email'))).toEqual(['id, reminder_email, reminder_phone_e164, club_email'])
    expect(ADMIN_RSVP_COLUMNS as readonly string[]).not.toContain('reminder_email')
    expect(db.selects.find((s) => s.table === 'evite_sends')?.cols).not.toContain('provider_id')
  })

  it('NEVER puts a raw reminder address, phone or club email in the payload; says only whether one exists', async () => {
    db = makeAdminDb({
      rsvps: [
        adminRsvp({ parent_name: 'Has Email', reminder_email: RAW.email, club_email: RAW.club, club_opt_in_at: '2026-10-20T00:00:00Z', opt_in_text_version: 'club-v1' }),
        adminRsvp({ parent_name: 'Has Phone', reminder_phone_e164: RAW.phone }),
        adminRsvp({ parent_name: 'Nothing' }),
      ],
      sends: [sendRow({ last_error: 'boom' })],
    })
    const res = await get()
    const text = JSON.stringify(await res.clone().json())
    for (const secret of [RAW.email, RAW.phone, RAW.club, 'secret-provider-id-123', 'edit_nonce', 'consent_ip', 'AAAAAAAAAAAAAAAA']) {
      expect(text).not.toContain(secret)
    }
    const b = await res.json()
    const byName = Object.fromEntries(b.rsvps.rows.map((r: { parent_name: string }) => [r.parent_name, r]))
    expect(byName['Has Email']).toMatchObject({ hasReminderContact: true, hasClubEmail: true })
    expect(byName['Has Phone']).toMatchObject({ hasReminderContact: true, hasClubEmail: false })
    expect(byName['Nothing']).toMatchObject({ hasReminderContact: false, hasClubEmail: false })
    expect(b.summary.withReminderContact).toBe(2)
  })

  it('headcount against the booked guest count: 11 of 10 kids is over the cap', async () => {
    const kids = (n: number) => Array.from({ length: n }, (_, i) => ({ first_name: `K${i}` }))
    db = makeAdminDb({
      booking: { guest_count_approx: 10 },
      rsvps: [
        adminRsvp({ parent_name: 'A', children: kids(6), adult_count: 2 }),
        adminRsvp({ parent_name: 'B', children: kids(5), adult_count: 1 }),
        adminRsvp({ parent_name: 'C', status: 'no', children: [], adult_count: 0, note_to_honoree: 'Sorry Mia!' }),
      ],
    })
    const { summary } = await (await get()).json()
    expect(summary).toMatchObject({ kidsYes: 11, cap: 10, overCap: true, yesCount: 2, noCount: 1, adultsYes: 3, adultsPlus: true })
    expect(summary.notes).toEqual([{ parent: 'C', note: 'Sorry Mia!' }])
  })

  it('allergy roll-up lists yes-RSVPs with a flag or a note, and keeps a purged note honest', async () => {
    db = makeAdminDb({
      rsvps: [
        adminRsvp({ parent_name: 'Peanut', children: [{ first_name: 'Ava' }], has_allergy: true, allergy_note: 'peanuts' }),
        adminRsvp({ parent_name: 'Purged', children: [{ first_name: 'Ben' }], has_allergy: true, allergy_note: null, allergy_purged_at: '2026-10-25T00:00:00Z' }),
        adminRsvp({ parent_name: 'Fine', has_allergy: false }),
        adminRsvp({ parent_name: 'Declined', status: 'no', children: [], adult_count: 0, has_allergy: true, allergy_note: 'ignored' }),
      ],
    })
    const { summary } = await (await get()).json()
    expect(summary.allergies).toEqual([
      { parent: 'Peanut', children: ['Ava'], note: 'peanuts', purged: false },
      { parent: 'Purged', children: ['Ben'], note: null, purged: true },
    ])
  })

  it('"Needs a start time" and "No parent email" warnings', async () => {
    db = makeAdminDb({ booking: { party_time: null, contact_email: 'nope' } })
    const b = await (await get()).json()
    expect(b.state).toBe('needs_time')
    expect(b.warnings).toEqual({ needsTime: true, noParentEmail: true })
    db = makeAdminDb({ booking: { contact_email: null } })
    expect((await (await get()).json()).warnings.noParentEmail).toBe(true)
  })

  it('the send ledger: counts by status, the latest row, failed and stuck-sending rows', async () => {
    db = makeAdminDb({
      sends: [
        sendRow({ send_type: 'lead_preview', status: 'sent', claimed_at: '2026-10-30T10:00:00Z' }),
        sendRow({ send_type: 'invite_ready', status: 'failed', attempts: 3, last_error: 'resend 500', claimed_at: '2026-10-31T10:00:00Z', sent_at: null }),
        // Claimed 20 minutes before "now": stuck. Five minutes before: still working.
        sendRow({ send_type: 'new_rsvp', rsvp_id: 'r1', status: 'sending', claimed_at: '2026-11-01T14:40:00Z', sent_at: null }),
        sendRow({ send_type: 'new_rsvp', rsvp_id: 'r2', status: 'sending', claimed_at: '2026-11-01T14:55:00Z', sent_at: null }),
        sendRow({ send_type: 'new_rsvp', rsvp_id: 'r3', status: 'sent', claimed_at: '2026-11-01T14:00:00Z' }),
      ],
    })
    const { ledger } = await (await get()).json()
    expect(ledger.available).toBe(true)
    const by = Object.fromEntries(ledger.groups.map((g: { sendType: string }) => [g.sendType, g]))
    expect(ledger.groups.map((g: { sendType: string }) => g.sendType)).toEqual(['lead_preview', 'invite_ready', 'new_rsvp'])
    expect(by.lead_preview.counts).toMatchObject({ sent: 1, failed: 0 })
    expect(by.lead_preview.stuckCount).toBe(0)
    expect(by.invite_ready.stuckCount).toBe(1)
    expect(by.invite_ready.problems[0]).toMatchObject({ status: 'failed', attempts: 3, lastError: 'resend 500' })
    expect(by.new_rsvp.counts).toMatchObject({ sending: 2, sent: 1 })
    expect(by.new_rsvp.stuckCount).toBe(1)
    expect(by.new_rsvp.problems[0]).toMatchObject({ status: 'sending', rsvpId: 'r1' })
    expect(by.new_rsvp.latest.claimedAt).toBe('2026-11-01T14:55:00Z')
  })

  it('a failed ledger read says "unavailable"; it is not an empty ledger', async () => {
    db = makeAdminDb({ rsvps: [adminRsvp()], sends: [sendRow()] })
    db.errors.push({ table: 'evite_sends', op: 'select' })
    const res = await get()
    expect(res.status).toBe(200)
    const b = await res.json()
    expect(b.ledger).toEqual({ available: false, error: 'Ledger unavailable' })
    expect(b.rsvps.available).toBe(true)
  })

  it('a failed RSVP read says "unavailable" and gives no summary; it is not zero kids', async () => {
    db = makeAdminDb({ rsvps: [adminRsvp()] })
    db.errors.push({ table: 'evite_rsvps', op: 'select' })
    const b = await (await get()).json()
    expect(b.rsvps).toEqual({ available: false, error: 'RSVPs unavailable' })
    expect(b.summary).toBeNull()
  })

  it('a failed payments read is a 503, never a "preview" state', async () => {
    db.errors.push({ table: 'booking_payments', op: 'select' })
    const res = await get()
    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).not.toContain('"state"')
  })

  it('a failed evite read is a 503, not "no invitation"', async () => {
    db.errors.push({ table: 'evites', op: 'select' })
    expect((await get()).status).toBe(503)
  })

  it('render freshness: stale without a hash, fresh when it matches; image URLs only for stored names', async () => {
    const evite = adminEviteRow()
    const ctx0 = await loadFactsContext(db.supabase, evite as never, NOW)
    expect(ctx0.kind).toBe('ok')
    const hash = ctx0.kind === 'ok' ? renderInputsHash(ctx0.facts) : ''
    const KEY = 'a'.repeat(32)
    db = makeAdminDb({ evite: { image_key: KEY, invite_object: 'invite-v1-9f2c.jpg', og_object: 'og-v1-9f2c.jpg', render_inputs_hash: hash, render_version: 1 } })
    let b = await (await get()).json()
    expect(b.renderFresh).toBe(true)
    expect(b.images.invite).toBe(`https://proj.supabase.co/storage/v1/object/public/evites/${KEY}/invite-v1-9f2c.jpg`)
    expect(b.images.og).toBe(`https://proj.supabase.co/storage/v1/object/public/evites/${KEY}/og-v1-9f2c.jpg`)

    db = makeAdminDb({ evite: { image_key: KEY, invite_object: 'invite-v1-9f2c.jpg', og_object: 'og-v1-9f2c.jpg', render_inputs_hash: 'stale' } })
    b = await (await get()).json()
    expect(b.renderFresh).toBe(false)

    db = makeAdminDb({ evite: { image_key: 'not-a-key', invite_object: '../../x.jpg', og_object: 'og.jpg', render_error: 'og-too-large' } })
    b = await (await get()).json()
    expect(b.images).toEqual({ invite: null, og: null })
    expect(b.evite.renderError).toBe('og-too-large')
  })

  it('an archived invitation reads "unavailable" and has no render freshness', async () => {
    db = makeAdminDb({ evite: { archived_at: '2026-10-30T00:00:00Z' } })
    const b = await (await get()).json()
    expect(b.state).toBe('unavailable')
    expect(b.renderFresh).toBeNull()
    expect(b.evite.archivedAt).toBe('2026-10-30T00:00:00Z')
  })

  it('a cancelled booking that still has an invitation is still shown (so it can be withdrawn)', async () => {
    db = makeAdminDb({ booking: { status: 'cancelled' } })
    const b = await (await get()).json()
    expect(b.state).toBe('unavailable')
    expect(b.booking.status).toBe('cancelled')
    expect(b.evite.id).toBe(EVITE_ID)
  })

  it('no invitation yet: eligible bookings can be ensured; studio rentals and a switched-off flag cannot', async () => {
    db = makeAdminDb({ evite: null })
    expect(await (await get()).json()).toMatchObject({ evite: null, eligible: true, canEnsure: true, pagesMode: 'on' })

    db = makeAdminDb({ evite: null, booking: { party_type: 'studio_rental' } })
    expect(await (await get()).json()).toMatchObject({ evite: null, eligible: false, canEnsure: false })

    process.env.EVITES_PAGES = 'off'
    db = makeAdminDb({ evite: null })
    expect(await (await get()).json()).toMatchObject({ evite: null, eligible: true, canEnsure: false, pagesMode: 'off' })

    process.env.EVITES_PAGES = 'pilot'
    process.env.EVITES_PILOT_REFS = 'HH-OTHER-9'
    db = makeAdminDb({ evite: null })
    expect((await (await get()).json()).canEnsure).toBe(false)
    process.env.EVITES_PILOT_REFS = 'HH-TEST-1'
    expect((await (await get()).json()).canEnsure).toBe(true)
  })

  it('an unknown booking is 404', async () => {
    db = makeAdminDb({ evite: null })
    expect((await get('', {}, OTHER_BOOKING_ID)).status).toBe(404)
  })
})

// ----------------------------------------------------------------------------------------------

describe('GET ?reveal=<rsvpId>', () => {
  it('returns that RSVP\'s contact and WRITES AN AUDIT ROW that names the RSVP but not the address', async () => {
    const r = adminRsvp({ reminder_email: RAW.email, club_email: RAW.club })
    db = makeAdminDb({ rsvps: [r] })
    const res = await get(`?reveal=${r.id}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ rsvpId: r.id, reminderEmail: RAW.email, reminderPhone: null, clubEmail: RAW.club })
    const rows = audits()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ booking_id: BOOKING_ID, modified_by: 'ADMIN' })
    expect(String(rows[0].change_summary)).toContain(String(r.id))
    expect(JSON.stringify(rows[0])).not.toContain(RAW.email)
    expect(JSON.stringify(rows[0])).not.toContain(RAW.club)
  })

  it('names the signed-in admin as the actor', async () => {
    const r = adminRsvp({ reminder_phone_e164: RAW.phone })
    db = makeAdminDb({ rsvps: [r] })
    const res = await get(`?reveal=${r.id}`, { auth: { cookieEmail: 'allie@example.com' } })
    expect(res.status).toBe(200)
    expect(audits()[0].modified_by).toBe('admin:allie@example.com')
  })

  it("an RSVP belonging to ANOTHER party's invitation is a 404, shows nothing and logs nothing", async () => {
    const mine = adminRsvp()
    const theirs = adminRsvp({ evite_id: OTHER_EVITE_ID, reminder_email: RAW.email })
    db = makeAdminDb({
      rsvps: [mine, theirs],
      extraBookings: [bookingRow({ id: OTHER_BOOKING_ID, booking_ref: 'HH-TEST-2' })],
      extraEvites: [adminEviteRow({ id: OTHER_EVITE_ID, booking_id: OTHER_BOOKING_ID, slug: 'zed-glow-9zzz' })],
    })
    const res = await get(`?reveal=${theirs.id}`)
    expect(res.status).toBe(404)
    expect(JSON.stringify(await res.json())).not.toContain(RAW.email)
    expect(audits()).toHaveLength(0)
    // And the same RSVP through ITS booking works.
    expect((await get(`?reveal=${theirs.id}`, {}, OTHER_BOOKING_ID)).status).toBe(200)
  })

  it('refuses to reveal when the audit row cannot be written', async () => {
    const r = adminRsvp({ reminder_email: RAW.email })
    db = makeAdminDb({ rsvps: [r] })
    db.errors.push({ table: 'booking_modifications', op: 'insert' })
    const res = await get(`?reveal=${r.id}`)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain(RAW.email)
  })

  it('a malformed id, an unknown id, a missing invitation and a failed read', async () => {
    db = makeAdminDb({ rsvps: [adminRsvp()] })
    expect((await get('?reveal=%25')).status).toBe(404)
    expect((await get('?reveal=00000000-0000-4000-8000-00000000ffff')).status).toBe(404)
    db.errors.push({ table: 'evite_rsvps', op: 'select' })
    expect((await get(`?reveal=${db.tables.evite_rsvps[0].id}`)).status).toBe(503)
    expect(audits()).toHaveLength(0)
    db = makeAdminDb({ evite: null })
    expect((await get('?reveal=00000000-0000-4000-8000-00000000ffff')).status).toBe(404)
  })
})

// ----------------------------------------------------------------------------------------------

describe('POST: request shape', () => {
  it('rejects a body that is not JSON, not an object, or names no known action', async () => {
    expect((await POST(adminReq(URL_FOR(), { method: 'POST', raw: 'nope' }), ctx())).status).toBe(400)
    expect((await post([1])).status).toBe(400)
    expect((await post({})).status).toBe(400)
    expect((await post({ action: 'delete_everything' })).status).toBe(400)
    expect(db.updates).toHaveLength(0)
  })

  it('every action except ensure answers 404 when there is no invitation', async () => {
    db = makeAdminDb({ evite: null })
    for (const action of ['rerender', 'archive', 'unarchive', 'set_theme', 'reslug', 'notify_cancelled']) {
      expect((await post({ action, theme_word: 'X' })).status).toBe(404)
    }
    expect(db.updates).toHaveLength(0)
    expect(audits()).toHaveLength(0)
  })
})

describe('POST ensure', () => {
  it('creates, queues a render, and logs', async () => {
    db = makeAdminDb({ evite: null })
    const res = await post({ action: 'ensure' })
    expect(res.status).toBe(200)
    const b = await res.json()
    expect(b).toMatchObject({ ok: true, outcome: 'created' })
    expect(isSlugShape(b.slug)).toBe(true)
    expect(queueMock).toHaveBeenCalledWith('66666666-6666-4666-8666-666666666666')
    expect(audits()).toHaveLength(1)
    expect(audits()[0]).toMatchObject({ booking_id: BOOKING_ID, modified_by: 'ADMIN' })
  })

  it('an existing invitation is "exists": no render queued, nothing logged', async () => {
    const b = await (await post({ action: 'ensure' })).json()
    expect(b).toMatchObject({ ok: true, outcome: 'exists', slug: 'mia-glow-7kq2' })
    expect(queueMock).not.toHaveBeenCalled()
    expect(audits()).toHaveLength(0)
  })

  it('reports the outcome kind for an ineligible booking (422) and a switched-off flag (409)', async () => {
    db = makeAdminDb({ evite: null, booking: { party_type: 'studio_rental' } })
    let res = await post({ action: 'ensure' })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ ok: false, outcome: 'ineligible' })

    process.env.EVITES_PAGES = 'off'
    db = makeAdminDb({ evite: null })
    res = await post({ action: 'ensure' })
    expect(res.status).toBe(409)
    expect((await res.json()).outcome).toBe('disabled')
    expect(queueMock).not.toHaveBeenCalled()
  })

  it('an unreadable table is 503 "unavailable", never created', async () => {
    db = makeAdminDb({ evite: null })
    db.errors.push({ table: 'booking_line_items', op: 'select' })
    const res = await post({ action: 'ensure' })
    expect(res.status).toBe(503)
    expect((await res.json()).outcome).toBe('unavailable')
    expect(db.inserts.filter((i) => i.table === 'evites')).toHaveLength(0)
  })
})

describe('POST rerender', () => {
  it('forces a render, awaits it and returns the outcome', async () => {
    renderMock.mockResolvedValue({ kind: 'rendered', version: 2, inviteObject: 'a', ogObject: 'b', inviteBytes: 1, ogBytes: 1, ms: 5 })
    const res = await post({ action: 'rerender' })
    expect(res.status).toBe(200)
    expect(renderMock).toHaveBeenCalledWith(db.supabase, EVITE_ID, { force: true })
    expect(await res.json()).toMatchObject({ ok: true, outcome: { kind: 'rendered', version: 2 } })
    expect(audits()).toHaveLength(1)
    expect(String(audits()[0].change_summary)).toContain('rendered')
  })

  it('a failed render is a 502 carrying the reason; a busy one is not an error', async () => {
    renderMock.mockResolvedValue({ kind: 'failed', reason: 'og-too-large' })
    let res = await post({ action: 'rerender' })
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ ok: false, outcome: { kind: 'failed', reason: 'og-too-large' } })

    renderMock.mockResolvedValue({ kind: 'busy', reason: 'claimed' })
    res = await post({ action: 'rerender' })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(false)
  })
})

describe('POST archive / unarchive', () => {
  it('archives with a conditional update, reads it back and logs', async () => {
    const res = await post({ action: 'archive' })
    expect(res.status).toBe(200)
    expect(eviteRow().archived_at).toBe(NOW.toISOString())
    const u = evUpdates()[0]
    expect(u.matched).toBe(1)
    expect(u.filters).toEqual(expect.arrayContaining([{ kind: 'is', col: 'archived_at', val: null }, { kind: 'eq', col: 'id', val: EVITE_ID }]))
    expect(audits()).toHaveLength(1)
    expect(audits()[0]).toMatchObject({ modified_by: 'ADMIN', old_data: { archived_at: null }, new_data: { archived_at: NOW.toISOString() } })
  })

  it('archiving twice is a 409 and writes nothing the second time', async () => {
    await post({ action: 'archive' })
    const before = evUpdates().length
    const res = await post({ action: 'archive' })
    expect(res.status).toBe(409)
    expect(evUpdates().length).toBe(before)
    expect(audits()).toHaveLength(1)
  })

  it('a concurrent archive (zero rows matched) is a 409, not a success', async () => {
    db.hooks.beforeUpdate = (_info, tables) => {
      ;(tables.evites[0] as Record<string, unknown>).archived_at = '2026-11-01T14:59:00Z'
    }
    const res = await post({ action: 'archive' })
    expect(res.status).toBe(409)
    expect(audits()).toHaveLength(0)
  })

  it('a failed update is a 500 and is not logged as done', async () => {
    db.errors.push({ table: 'evites', op: 'update' })
    expect((await post({ action: 'archive' })).status).toBe(500)
    expect(audits()).toHaveLength(0)
    expect(eviteRow().archived_at).toBeNull()
  })

  it('unarchive clears the stamp, queues a render and logs; unarchiving a live one is a 409', async () => {
    expect((await post({ action: 'unarchive' })).status).toBe(409)
    db = makeAdminDb({ evite: { archived_at: '2026-10-30T00:00:00Z' } })
    const res = await post({ action: 'unarchive' })
    expect(res.status).toBe(200)
    expect(eviteRow().archived_at).toBeNull()
    expect(queueMock).toHaveBeenCalledWith(EVITE_ID)
    expect(audits()[0]).toMatchObject({ old_data: { archived_at: '2026-10-30T00:00:00Z' }, new_data: { archived_at: null } })
  })

  it('unarchive is conditional on the stamp it saw', async () => {
    db = makeAdminDb({ evite: { archived_at: '2026-10-30T00:00:00Z' } })
    db.hooks.beforeUpdate = (_i, tables) => {
      ;(tables.evites[0] as Record<string, unknown>).archived_at = '2026-10-31T00:00:00Z'
    }
    expect((await post({ action: 'unarchive' })).status).toBe(409)
    expect(eviteRow().archived_at).toBe('2026-10-31T00:00:00Z')
  })

  it('a failed audit write does not undo or fail the action, but says so', async () => {
    db.errors.push({ table: 'booking_modifications', op: 'insert' })
    const res = await post({ action: 'archive' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, audited: false })
    expect(eviteRow().archived_at).not.toBeNull()
  })
})

describe('POST set_theme', () => {
  it('rejects a template that is not in the registry, and writes nothing', async () => {
    const res = await post({ action: 'set_theme', template_slug: 'swiftie' })
    expect(res.status).toBe(400)
    expect(evUpdates()).toHaveLength(0)
    expect(queueMock).not.toHaveBeenCalled()
    expect((await post({ action: 'set_theme', template_slug: 7 })).status).toBe(400)
  })

  it('rejects theme text over 12 characters, with control characters, or that the font cannot draw', async () => {
    expect((await post({ action: 'set_theme', theme_word: 'THIRTEENCHARS' })).status).toBe(400)
    expect((await post({ action: 'set_theme', theme_sub: 'A'.repeat(13) })).status).toBe(400)
    expect((await post({ action: 'set_theme', theme_word: 'GLOW' + String.fromCharCode(7) })).status).toBe(400)
    expect((await post({ action: 'set_theme', theme_word: 'GLOW' + String.fromCharCode(0x2028) + 'X' })).status).toBe(400)
    expect((await post({ action: 'set_theme', theme_word: 'PARTY \u{1F389}' })).status).toBe(400)
    expect((await post({ action: 'set_theme', theme_word: 42 })).status).toBe(400)
    expect(evUpdates()).toHaveLength(0)
  })

  it('accepts exactly 12 characters; trims, collapses spaces, saves, queues a render and logs old and new', async () => {
    const res = await post({ action: 'set_theme', template_slug: 'plain', theme_word: '  SWEET   TREATS ', theme_sub: 'BASH' })
    expect(res.status).toBe(200)
    expect(eviteRow()).toMatchObject({ template_slug: 'plain', theme_word: 'SWEET TREATS', theme_sub: 'BASH' })
    expect(queueMock).toHaveBeenCalledWith(EVITE_ID)
    expect(audits()[0]).toMatchObject({
      old_data: { template_slug: 'glow', theme_word: null, theme_sub: null },
      new_data: { template_slug: 'plain', theme_word: 'SWEET TREATS', theme_sub: 'BASH' },
    })
  })

  it('null or empty clears an override', async () => {
    db = makeAdminDb({ evite: { theme_word: 'GLOW', theme_sub: 'BASH' } })
    const res = await post({ action: 'set_theme', theme_word: null, theme_sub: '  ' })
    expect(res.status).toBe(200)
    expect(eviteRow()).toMatchObject({ theme_word: null, theme_sub: null })
  })

  it('nothing to change is a 400', async () => {
    expect((await post({ action: 'set_theme' })).status).toBe(400)
  })

  it('warns that a template alone changes nothing (facts honour it only beside a word or sub)', async () => {
    const b = await (await post({ action: 'set_theme', template_slug: 'plain' })).json()
    expect(b.warning).toMatch(/theme word or sub/)
    const c = await (await post({ action: 'set_theme', template_slug: 'plain', theme_word: 'NEON' })).json()
    expect(c.warning).toBeUndefined()
  })

  it('a failed update is a 500 and queues nothing', async () => {
    db.errors.push({ table: 'evites', op: 'update' })
    expect((await post({ action: 'set_theme', theme_word: 'NEON' })).status).toBe(500)
    expect(queueMock).not.toHaveBeenCalled()
  })
})

describe('POST reslug', () => {
  it('is REFUSED once the invitation has gone live, and writes nothing', async () => {
    db = makeAdminDb({ evite: { went_live_at: '2026-10-31T00:00:00Z' } })
    const res = await post({ action: 'reslug' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'went-live' })
    expect(evUpdates()).toHaveLength(0)
    expect(eviteRow().slug).toBe('mia-glow-7kq2')
  })

  it('mints a new slug from the current name and theme, keeps the old one as an alias, and logs', async () => {
    db = makeAdminDb({ booking: { child_name: 'Zoe' } })
    const res = await post({ action: 'reslug' })
    expect(res.status).toBe(200)
    const b = await res.json()
    expect(isSlugShape(b.slug)).toBe(true)
    expect(slugNamePart(b.slug)).toBe('zoe')
    expect(b.slug).toMatch(/^zoe-glow-/)
    expect(b.previousSlug).toBe('mia-glow-7kq2')
    expect(eviteRow().slug).toBe(b.slug)
    expect(eviteRow().previous_slugs).toEqual(['mia-glow-7kq2'])
    const u = evUpdates()[0]
    expect(u.filters).toEqual(
      expect.arrayContaining([
        { kind: 'eq', col: 'slug', val: 'mia-glow-7kq2' },
        { kind: 'is', col: 'went_live_at', val: null },
      ]),
    )
    expect(audits()[0]).toMatchObject({ old_data: { slug: 'mia-glow-7kq2' }, new_data: { slug: b.slug } })
  })

  it('uses the theme override in the new slug and accumulates aliases without duplicates', async () => {
    db = makeAdminDb({ evite: { theme_word: 'NEON', previous_slugs: ['old-one-aaaa', 'mia-glow-7kq2'] } })
    const b = await (await post({ action: 'reslug' })).json()
    expect(b.slug).toMatch(/^mia-neon-/)
    expect(eviteRow().previous_slugs).toEqual(['old-one-aaaa', 'mia-glow-7kq2'])
  })

  it('retries when the new slug collides (23505 on evites_slug_key), up to five times', async () => {
    const c = collideSlugUpdates(db, (p) => 'slug' in p, 2)
    const res = await post({ action: 'reslug' })
    expect(res.status).toBe(200)
    expect(c.count()).toBe(2)
    expect(eviteRow().slug).not.toBe('mia-glow-7kq2')
  })

  it('gives up with a 503 after five collisions and leaves the slug alone', async () => {
    const c = collideSlugUpdates(db, (p) => 'slug' in p)
    const res = await post({ action: 'reslug' })
    expect(res.status).toBe(503)
    expect(c.count()).toBe(5)
    expect(eviteRow().slug).toBe('mia-glow-7kq2')
    expect(audits()).toHaveLength(0)
  })

  it('is conditional on the old slug: someone else re-slugging in between is a 409', async () => {
    db.hooks.beforeUpdate = (_i, tables) => {
      ;(tables.evites[0] as Record<string, unknown>).slug = 'mia-glow-zzzz'
    }
    const res = await post({ action: 'reslug' })
    expect(res.status).toBe(409)
    expect(eviteRow().slug).toBe('mia-glow-zzzz')
    expect(audits()).toHaveLength(0)
  })

  it('is conditional on went_live_at: the cron stamping it in between is a 409', async () => {
    db.hooks.beforeUpdate = (_i, tables) => {
      ;(tables.evites[0] as Record<string, unknown>).went_live_at = '2026-11-01T14:59:59Z'
    }
    const res = await post({ action: 'reslug' })
    expect(res.status).toBe(409)
    expect(eviteRow().slug).toBe('mia-glow-7kq2')
  })

  it('a failed read is a 503 and a failed write is a 500; neither changes the slug', async () => {
    db.errors.push({ table: 'booking_payments', op: 'select' })
    expect((await post({ action: 'reslug' })).status).toBe(503)
    db = makeAdminDb()
    db.errors.push({ table: 'evites', op: 'update' })
    expect((await post({ action: 'reslug' })).status).toBe(500)
    expect(eviteRow().slug).toBe('mia-glow-7kq2')
  })
})

describe('POST notify_cancelled', () => {
  it('is refused (409) for a party that is not cancelled', async () => {
    const hook = jest.fn()
    adminHooks.notifyPartyCancelled = hook
    const res = await post({ action: 'notify_cancelled' })
    expect(res.status).toBe(409)
    expect(hook).not.toHaveBeenCalled()
  })

  it('calls the hook for a cancelled party; the P08 stub sends nothing and says so', async () => {
    db = makeAdminDb({ booking: { status: 'cancelled' } })
    const res = await post({ action: 'notify_cancelled' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, queued: false, reason: 'not-built' })
    expect(audits()).toHaveLength(1)
    expect(audits()[0]).toMatchObject({ booking_id: BOOKING_ID, modified_by: 'ADMIN' })
  })

  it('hands the hook the client and the invitation id; a throwing hook is an {ok:false}, not a 500', async () => {
    db = makeAdminDb({ booking: { status: 'lost' } })
    const hook = jest.fn().mockResolvedValue({ ok: true, queued: true, count: 3 })
    adminHooks.notifyPartyCancelled = hook
    const b = await (await post({ action: 'notify_cancelled' })).json()
    expect(hook).toHaveBeenCalledWith(db.supabase, EVITE_ID)
    expect(b).toMatchObject({ ok: true, queued: true, count: 3 })

    adminHooks.notifyPartyCancelled = jest.fn().mockRejectedValue(new Error('boom'))
    const res = await post({ action: 'notify_cancelled' })
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ ok: false, queued: false, reason: 'hook-failed' })
  })
})

describe('every write names the signed-in human', () => {
  it('admin:<email> from the session cookie, ADMIN from the shared password', async () => {
    await post({ action: 'archive' }, { auth: { cookieEmail: 'Allie@Example.com' } })
    expect(audits()[0].modified_by).toBe('admin:allie@example.com')
    db = makeAdminDb()
    await post({ action: 'archive' })
    expect(audits()[0].modified_by).toBe('ADMIN')
  })

  it('the second booking is untouched by a write to the first', async () => {
    db = makeAdminDb({
      extraBookings: [bookingRow({ id: OTHER_BOOKING_ID, booking_ref: 'HH-TEST-2' })],
      extraEvites: [adminEviteRow({ id: OTHER_EVITE_ID, booking_id: OTHER_BOOKING_ID, slug: 'zed-glow-9zzz' })],
    })
    await post({ action: 'archive' })
    expect(db.tables.evites.find((e) => e.id === OTHER_EVITE_ID)?.archived_at).toBeNull()
    expect(adminBookingRow().id).toBe(BOOKING_ID)
  })
})
