import { makeSendDb, freshenRender, SEND_NOW, type SendDb } from '../helpers/sendFixtures'
import { ADMIN_PW, adminReq } from '../helpers/adminInvitationFixtures'
import { __resetRateLimitForTests } from '@/lib/rateLimit'
import { sendEviteEmail } from '@/lib/evites/mail'
import { runEviteSendsTick } from '@/lib/evites/cronTick'

/**
 * `send_invite_ready` (spec 03 section 9.1 / 14): the admin's "send it" for a booking the automatic email holds back
 * (Adam, 2026-10-11). It waives the launch cutoff EVITES_AUTOSEND_SINCE and nothing else.
 */

jest.mock('@/lib/evites/mail')
jest.mock('@/lib/evites/render', () => ({ queueRender: jest.fn(), renderEvite: jest.fn(), renderViaQueue: jest.fn() }))
let db: SendDb
jest.mock('@/lib/supabase', () => ({ getSupabase: () => db.supabase }))

import { POST, GET } from '@/app/api/admin/parties/[id]/invitation/route'

type Row = Record<string, unknown>

const mailMock = sendEviteEmail as jest.Mock
const BOOKING = '11111111-1111-4111-8111-111111111111'
const ENV = ['EVITES_PAGES', 'EVITES_SENDS', 'EVITES_PILOT_REFS', 'EVITES_AUTOSEND_SINCE', 'ADMIN_PASSWORD', 'ADMIN_SESSION_SECRET', 'PORTAL_LINK_SIGNING_SECRET', 'SUPABASE_URL'] as const
const saved: Record<string, string | undefined> = {}

const URL_FOR = `/api/admin/parties/${BOOKING}/invitation`
const ctx = { params: { id: BOOKING } }
const send = (o: Parameters<typeof adminReq>[1] = {}) => POST(adminReq(URL_FOR, { ...o, method: 'POST', body: { action: 'send_invite_ready' } }), ctx)
const rows = () => db.tables.evite_sends.filter((r) => r.send_type === 'invite_ready')
const audits = () => db.inserts.filter((i) => i.table === 'booking_modifications').map((i) => i.row)

/** A booked, live, fresh-rendered party made BEFORE the launch cutoff. */
async function heldDb(over: { booking?: Row; evite?: Row; contacts?: Row[]; interactions?: Row[]; payments?: Row[] } = {}): Promise<SendDb> {
  const d = makeSendDb({
    booking: { id: BOOKING, created_at: '2026-09-15T12:00:00Z', ...over.booking },
    evite: { booking_id: BOOKING, went_live_at: '2026-10-31T00:00:00Z', ...over.evite },
    payments: over.payments ?? [{ booking_id: BOOKING, amount_cents: 25000, payment_type: 'deposit' }],
    contacts: over.contacts,
    interactions: over.interactions,
  })
  await freshenRender(d, SEND_NOW)
  return d
}

beforeEach(async () => {
  jest.useFakeTimers({
    now: SEND_NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance'],
  })
  for (const k of ENV) saved[k] = process.env[k]
  process.env.EVITES_PAGES = 'on'
  process.env.EVITES_SENDS = 'on'
  process.env.EVITES_AUTOSEND_SINCE = '2026-10-12T00:00:00Z' // the booking (15 Sep) is BEFORE it
  delete process.env.EVITES_PILOT_REFS
  process.env.ADMIN_PASSWORD = ADMIN_PW
  process.env.ADMIN_SESSION_SECRET = 'test-admin-session-secret-0123456789'
  process.env.PORTAL_LINK_SIGNING_SECRET = 'test-signing-secret-0123456789abcdef'
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
  __resetRateLimitForTests()
  mailMock.mockReset()
  mailMock.mockResolvedValue({ kind: 'sent', providerId: 're_ok' })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  db = await heldDb()
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('POST send_invite_ready', () => {
  it('is admin-only: 401 with no credential, before any read or send', async () => {
    db.selects.length = 0 // (the fixture's own freshenRender read the tables)
    const res = await send({ auth: 'none' })
    expect(res.status).toBe(401)
    expect(mailMock).not.toHaveBeenCalled()
    expect(db.selects).toHaveLength(0)
    expect(rows()).toHaveLength(0)
  })

  it('sends the held booking exactly once (bypassing the cutoff), writes the ledger row and an audit row naming the admin', async () => {
    const res = await send()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, outcome: 'sent' })
    expect(mailMock).toHaveBeenCalledTimes(1)
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toMatchObject({ rsvp_id: null, ref_version: 0, status: 'sent' })
    expect(audits()).toHaveLength(1)
    expect(audits()[0]).toMatchObject({ booking_id: BOOKING, modified_by: 'ADMIN' })
    expect(JSON.stringify(audits()[0])).toMatch(/invitation email sent/i)
  })

  it('a second press says it was already sent and sends nothing more', async () => {
    await send()
    const res = await send()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, outcome: 'already', status: 'sent' })
    expect(mailMock).toHaveBeenCalledTimes(1)
    expect(rows()).toHaveLength(1)
  })

  it('two overlapping presses send one email', async () => {
    const [a, b] = await Promise.all([send(), send()])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(mailMock).toHaveBeenCalledTimes(1)
    expect(rows()).toHaveLength(1)
  })

  it('the automatic cron still holds this booking (it neither sends nor claims)', async () => {
    await runEviteSendsTick(db.supabase, { now: new Date(SEND_NOW.getTime() + 60_000) })
    expect(mailMock).not.toHaveBeenCalled()
    expect(rows()).toHaveLength(0)
  })

  it('refuses (409, with the reason) when the invitation is not live', async () => {
    db = await heldDb({ booking: { status: 'awaiting_deposit' }, payments: [] })
    const res = await send()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ ok: false, outcome: 'refused', reason: 'state' })
    expect(mailMock).not.toHaveBeenCalled()
    expect(rows()).toHaveLength(0)
    expect(audits()).toHaveLength(0)
  })

  it('refuses (409) when the render is not fresh, and when the invitation has not been stamped live', async () => {
    db.tables.evites[0].render_inputs_hash = 'stale'
    let res = await send()
    expect(res.status).toBe(409)
    expect((await res.json()).reason).toBe('render-stale')

    db = await heldDb({ evite: { went_live_at: null } })
    res = await send()
    expect(res.status).toBe(409)
    expect((await res.json()).reason).toBe('not-stamped')
    expect(mailMock).not.toHaveBeenCalled()
    expect(rows()).toHaveLength(0)
  })

  it('does NOT bypass EVITES_SENDS off, the pilot list, or a missing parent email', async () => {
    process.env.EVITES_SENDS = 'off'
    let res = await send()
    expect(res.status).toBe(409)
    expect((await res.json()).reason).toBe('sends-off')

    process.env.EVITES_SENDS = 'pilot'
    process.env.EVITES_PILOT_REFS = 'HH-SOMEONE-ELSE'
    res = await send()
    expect(res.status).toBe(409)
    expect((await res.json()).reason).toBe('not-pilot')

    process.env.EVITES_SENDS = 'on'
    db = await heldDb({ booking: { contact_email: null } })
    res = await send()
    expect(res.status).toBe(409)
    expect((await res.json()).reason).toBe('no-email')

    expect(mailMock).not.toHaveBeenCalled()
    expect(rows()).toHaveLength(0)
  })

  it('does NOT bypass the suppression list: the refusal is recorded and nothing is mailed', async () => {
    db = await heldDb({
      contacts: [{ id: 'c1', email: 'pat@example.com', email_opt_in: false, status: 'lead', created_at: '2026-01-01T00:00:00Z' }],
      interactions: [{ id: 'i1', contact_id: 'c1', type: 'email_unsubscribed', metadata: {}, created_at: '2026-02-01T00:00:00Z' }],
    })
    const res = await send()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ ok: false, outcome: 'skipped', reason: 'suppressed' })
    expect(mailMock).not.toHaveBeenCalled()
    expect(rows()[0]).toMatchObject({ status: 'skipped', outcome: 'suppressed' })
  })

  it('a provider failure is a 502 and the failed row is left for the retry sweep (a second press does not re-send)', async () => {
    mailMock.mockResolvedValueOnce({ kind: 'failed', error: 'resend 500' })
    const res = await send()
    expect(res.status).toBe(502)
    expect(rows()[0]).toMatchObject({ status: 'failed' })
    const again = await send()
    expect(again.status).toBe(200)
    expect(await again.json()).toMatchObject({ outcome: 'already', status: 'failed' })
    expect(mailMock).toHaveBeenCalledTimes(1)
  })

  it('an invitation that does not exist is 404', async () => {
    db.tables.evites.length = 0
    expect((await send()).status).toBe(404)
  })
})

describe('GET: the held note', () => {
  it('reports whether the automatic email would go for this booking', async () => {
    let b = await (await GET(adminReq(URL_FOR), ctx)).json()
    expect(b.autosend).toEqual({ configured: true, allowed: false })
    process.env.EVITES_AUTOSEND_SINCE = '2026-09-01T00:00:00Z'
    b = await (await GET(adminReq(URL_FOR), ctx)).json()
    expect(b.autosend).toEqual({ configured: true, allowed: true })
    delete process.env.EVITES_AUTOSEND_SINCE
    b = await (await GET(adminReq(URL_FOR), ctx)).json()
    expect(b.autosend).toEqual({ configured: false, allowed: false })
  })
})
