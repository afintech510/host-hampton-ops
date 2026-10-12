import { cronDb, ticks, rowsOf, runTicks, fakeRenderer, freshenRender, EVITE_ID, SLUG, MIN, HOUR, DAY } from '../../helpers/cronFixtures'
import { guestRsvp, rsvpRow, sendRow, uuid, type SendDb } from '../../helpers/sendFixtures'
import { __resetRateLimitForTests } from '@/lib/rateLimit'
import { sendEviteEmail } from '@/lib/evites/mail'
import { renderViaQueue, queueRender } from '@/lib/evites/render'
import { runEviteSendsTick, scanRanges, SCAN_LIMIT, SCAN_NEWEST, STEP7_SENDS_PER_TICK, type TickReport } from '@/lib/evites/cronTick'
import { loadSendContext } from '@/lib/evites/sendContext'
import { calInputsHash } from '@/lib/evites/hash'

/**
 * The evite scheduler end to end (spec §9.3): the real `runEviteSendsTick`, the real claim / send / finish
 * path and the real selection, over an in-memory database and a clock that steps in 15 minutes.
 * Only Resend (`sendEviteEmail`) and the image renderer are replaced.
 *
 * The party: Mia's Glow party, Saturday 14 Nov 2026, 2 PM ET (19:00Z). DST ended 1 Nov, so ET is UTC-5:
 *   week_before     Sat  7 Nov 10:00 ET = 15:00Z        day_before   Fri 13 Nov 16:00 ET = 21:00Z
 *   final_headcount Fri 13 Nov 16:30 ET = 21:30Z        day_before stops 23:59 ET = Sat 14 Nov 04:59Z
 */

jest.mock('@/lib/evites/mail')
jest.mock('@/lib/evites/render', () => ({ queueRender: jest.fn(), renderEvite: jest.fn(), renderViaQueue: jest.fn() }))
let db: SendDb
jest.mock('@/lib/supabase', () => ({ getSupabase: () => db.supabase }))

const mailMock = sendEviteEmail as jest.Mock
const renderMock = renderViaQueue as jest.Mock
const ENV = ['EVITES_PAGES', 'EVITES_SENDS', 'EVITES_PILOT_REFS', 'EVITES_AUTOSEND_SINCE', 'PORTAL_LINK_SIGNING_SECRET', 'SUPABASE_URL'] as const
const saved: Record<string, string | undefined> = {}
const clock = { now: new Date('2026-10-31T12:00:00Z') }

type Row = Record<string, unknown>
type Mail = { to: string; subject: string; text: string; attachments?: Array<{ contentType: string }> }
const mails = (): Mail[] => mailMock.mock.calls.map((c) => c[0] as Mail)
const ids = (rows: Row[]) => rows.map((r) => String(r.rsvp_id))
const claimedAt = (r: Row) => String(r.claimed_at)
const noGuest = (over: Row = {}) => guestRsvp({ status: 'no', children: [], adult_count: 0, reminder_email: 'c@example.com', ...over })

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  process.env.EVITES_PAGES = 'on'
  process.env.EVITES_SENDS = 'on'
  // Every fixture booking (created 2026-10-01 or later) is at or after the launch cutoff; the cutoff tests move it.
  process.env.EVITES_AUTOSEND_SINCE = '2026-09-01T00:00:00Z'
  delete process.env.EVITES_PILOT_REFS
  process.env.PORTAL_LINK_SIGNING_SECRET = 'test-signing-secret-0123456789abcdef'
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
  __resetRateLimitForTests()
  mailMock.mockReset()
  mailMock.mockResolvedValue({ kind: 'sent', providerId: 're_ok' })
  renderMock.mockReset()
  ;(queueRender as jest.Mock).mockReset()
  renderMock.mockImplementation(fakeRenderer(() => db, clock))
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  jest.restoreAllMocks()
})

/** A booked party that is already live (stamped, with its calendar baseline) and whose render is fresh. */
async function liveDb(o: Parameters<typeof cronDb>[0] = {}, now = new Date('2026-11-01T00:00:00Z')): Promise<SendDb> {
  const d = cronDb({ ...o, evite: { went_live_at: '2026-11-01T00:00:00Z', ...o?.evite } })
  await freshenRender(d, now)
  const read = await loadSendContext(d.supabase, EVITE_ID, null, now)
  if (read.kind !== 'ok') throw new Error('fixture')
  d.tables.evites[0].cal_inputs_hash = calInputsHash(read.ctx.facts)
  return d
}

/** Every key in the ledger, to prove "once per key". */
const keys = (d: SendDb) => d.tables.evite_sends.map((r) => `${r.rsvp_id ?? '-'}|${r.send_type}|${r.ref_version}`)

// ============================================================================================
describe('the 16-day timeline: a Saturday party in November, ticked every 15 minutes', () => {
  let reports: TickReport[]
  let sent: Mail[] = []
  let renderCalls = 0
  let A: string, B: string, F: string, C: string, D: string, E: string

  beforeAll(async () => {
    // (beforeEach has not run for beforeAll: set the env the tick reads)
    process.env.EVITES_PAGES = 'on'
    process.env.EVITES_SENDS = 'on'
    process.env.EVITES_AUTOSEND_SINCE = '2026-09-01T00:00:00Z'
    process.env.PORTAL_LINK_SIGNING_SECRET = 'test-signing-secret-0123456789abcdef'
    process.env.SUPABASE_URL = 'https://proj.supabase.co'
    __resetRateLimitForTests()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    mailMock.mockReset()
    mailMock.mockResolvedValue({ kind: 'sent', providerId: 're_ok' })
    renderMock.mockReset()
    renderMock.mockImplementation(fakeRenderer(() => db, clock))

    A = uuid(); B = uuid(); C = uuid(); D = uuid(); E = uuid(); F = uuid()
    const old = { created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z' }
    db = cronDb({
      rsvps: [
        guestRsvp({ id: A, reminder_email: 'a@example.com', ...old }),
        guestRsvp({ id: B, reminder_email: 'b@example.com', ...old }),
        noGuest({ id: C, ...old }), // said No from the start
        guestRsvp({ id: D, reminder_email: 'd@example.com', ...old }), // said Yes, changes to No before the week-before
        guestRsvp({ id: E, reminder_email: 'e@example.com', reminder_opt_out_at: '2026-10-25T00:00:00Z', ...old }), // opted out of reminders
      ],
    })
    await freshenRender(db, clock.now)

    let lateAdded = false
    let changedD = false
    reports = await runTicks(db, ticks('2026-10-31T12:00:00Z', '2026-11-16T12:00:00Z'), (now) => {
      clock.now = now
      if (!changedD && now.getTime() >= Date.parse('2026-11-05T12:00:00Z')) {
        changedD = true
        Object.assign(db.tables.evite_rsvps.find((r) => r.id === D) as Row, { status: 'no', children: [], adult_count: 0, revision: 2, updated_at: now.toISOString() })
      }
      // F RSVPs the morning after the week-before reminder went out.
      if (!lateAdded && now.getTime() >= Date.parse('2026-11-08T12:00:00Z')) {
        lateAdded = true
        db.tables.evite_rsvps.push(guestRsvp({ id: F, reminder_email: 'f@example.com', created_at: now.toISOString(), updated_at: now.toISOString() }))
      }
    })
    sent = mails()
    renderCalls = renderMock.mock.calls.length
  }, 300_000)

  afterAll(() => jest.restoreAllMocks())

  it('every key is claimed once, and every email sent is one ledger row sent', () => {
    expect(new Set(keys(db)).size).toBe(keys(db).length)
    expect(db.tables.evite_sends.every((r) => r.status === 'sent')).toBe(true)
    expect(sent).toHaveLength(db.tables.evite_sends.length)
  })

  it('the parent gets invite_ready once, on the first tick after the party went live', () => {
    const rows = rowsOf(db, 'invite_ready')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ rsvp_id: null, ref_version: 0, status: 'sent' })
    expect(claimedAt(rows[0])).toBe('2026-10-31T12:00:00.000Z')
    expect(db.tables.evites[0].went_live_at).toBe('2026-10-31T12:00:00.000Z')
    expect(sent.filter((m) => m.subject.includes('is ready'))).toHaveLength(1)
  })

  it('each yes guest gets week_before exactly once, at 10:00 ET seven days out; a No, an opted-out guest and a late RSVP get none', () => {
    const rows = rowsOf(db, 'week_before')
    expect(ids(rows).sort()).toEqual([A, B].sort())
    for (const r of rows) {
      expect(r).toMatchObject({ ref_version: 0, status: 'sent' })
      expect(claimedAt(r)).toBe('2026-11-07T15:00:00.000Z')
    }
  })

  it('a No RSVP, an opted-out guest, and an RSVP changed to No before the week-before get nothing', () => {
    const guestTypes = ['week_before', 'day_before', 'details_changed', 'party_cancelled', 'rsvp_confirmed']
    for (const who of [C, D, E]) {
      const got = db.tables.evite_sends.filter((r) => r.rsvp_id === who && guestTypes.includes(String(r.send_type)))
      expect(got).toEqual([])
    }
    for (const gone of ['c@example.com', 'd@example.com', 'e@example.com']) expect(sent.some((m) => m.to === gone)).toBe(false)
  })

  it('an RSVP created after the week-before was due gets no week_before, but does get the day_before', () => {
    expect(rowsOf(db, 'week_before').some((r) => r.rsvp_id === F)).toBe(false)
    expect(rowsOf(db, 'day_before').some((r) => r.rsvp_id === F)).toBe(true)
  })

  it('each eligible guest gets day_before exactly once, at 16:00 ET the day before, and never on the party day', () => {
    const rows = rowsOf(db, 'day_before')
    expect(ids(rows).sort()).toEqual([A, B, F].sort())
    for (const r of rows) {
      expect(r).toMatchObject({ ref_version: 0, status: 'sent' })
      expect(claimedAt(r)).toBe('2026-11-13T21:00:00.000Z')
      // 23:59 ET on the 13th is 04:59Z on the 14th: nothing is claimed on the party day.
      expect(Date.parse(claimedAt(r))).toBeLessThan(Date.parse('2026-11-14T04:59:00Z'))
    }
  })

  it('the parent gets final_headcount once, at 16:30 ET, after every day_before', () => {
    const final = rowsOf(db, 'final_headcount')
    expect(final).toHaveLength(1)
    expect(claimedAt(final[0])).toBe('2026-11-13T21:30:00.000Z')
    const order = db.tables.evite_sends
    const at = order.indexOf(final[0])
    for (const d of rowsOf(db, 'day_before')) expect(order.indexOf(d)).toBeLessThan(at)
    expect(order.slice(0, at).filter((r) => r.send_type === 'day_before')).toHaveLength(3)
  })

  it('a late RSVP is still told about itself (orphan sweep: new_rsvp to the parent, rsvp_confirmed to the guest), once', () => {
    expect(rowsOf(db, 'new_rsvp').filter((r) => r.rsvp_id === F)).toHaveLength(1)
    expect(rowsOf(db, 'rsvp_confirmed').filter((r) => r.rsvp_id === F)).toHaveLength(1)
    // The one that changed to No is reported to the parent (revision 2) and nothing more.
    expect(rowsOf(db, 'rsvp_changed').filter((r) => r.rsvp_id === D)).toHaveLength(1)
    // The calendar never moved, so nobody is told "details changed".
    expect(rowsOf(db, 'details_changed')).toHaveLength(0)
    expect(db.tables.evites[0].cal_version).toBe(0)
  })

  it('no email names a party that has already happened: nothing is claimed after the party day starts, except the retention and nothing else', () => {
    for (const r of db.tables.evite_sends) {
      if (['week_before', 'day_before', 'final_headcount', 'invite_ready'].includes(String(r.send_type))) {
        expect(Date.parse(claimedAt(r))).toBeLessThan(Date.parse('2026-11-14T04:59:00Z'))
      }
    }
  })

  it('the render was fresh the whole time: the scheduler never re-rendered', () => {
    expect(renderCalls).toBe(0)
  })

  it('the answer is counts only: no address, no slug, no booking ref, no name', () => {
    const text = JSON.stringify(reports)
    expect(text).not.toMatch(/@/)
    expect(text).not.toContain(SLUG)
    expect(text).not.toContain('HH-TEST-1')
    expect(text).not.toContain('Mia')
    expect(text).not.toContain('Pat')
    expect(reports.every((r) => r.ok)).toBe(true)
    expect(reports.every((r) => r.step7.used <= STEP7_SENDS_PER_TICK)).toBe(true)
  })
})

// ============================================================================================
describe('the party moves after the day_before went out', () => {
  let A: string, B: string, G: string
  let renderCalls = 0

  beforeAll(async () => {
    process.env.EVITES_PAGES = 'on'
    process.env.EVITES_SENDS = 'on'
    process.env.PORTAL_LINK_SIGNING_SECRET = 'test-signing-secret-0123456789abcdef'
    process.env.SUPABASE_URL = 'https://proj.supabase.co'
    __resetRateLimitForTests()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    mailMock.mockReset()
    mailMock.mockResolvedValue({ kind: 'sent', providerId: 're_ok' })
    renderMock.mockReset()
    renderMock.mockImplementation(fakeRenderer(() => db, clock))

    A = uuid(); B = uuid(); G = uuid()
    const old = { created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z' }
    db = await liveDb({ rsvps: [guestRsvp({ id: A, reminder_email: 'a@example.com', ...old }), guestRsvp({ id: B, reminder_email: 'b@example.com', ...old })] }, new Date('2026-11-06T12:00:00Z'))
    let moved = false
    let late = false
    await runTicks(db, ticks('2026-11-06T12:00:00Z', '2026-11-22T12:00:00Z'), (now) => {
      clock.now = now
      // Friday evening, an hour after the day_before went out: the party moves a week.
      if (!moved && now.getTime() >= Date.parse('2026-11-13T22:00:00Z')) {
        moved = true
        db.tables.bookings[0].party_date = '2026-11-21'
        db.tables.bookings[0].updated_at = now.toISOString()
      }
      // G RSVPs after the change.
      if (!late && now.getTime() >= Date.parse('2026-11-15T12:00:00Z')) {
        late = true
        db.tables.evite_rsvps.push(guestRsvp({ id: G, reminder_email: 'g@example.com', created_at: now.toISOString(), updated_at: now.toISOString() }))
      }
    })
    renderCalls = renderMock.mock.calls.length
  }, 300_000)

  afterAll(() => jest.restoreAllMocks())

  it('the calendar version is bumped once, independent of the render', () => {
    expect(db.tables.evites[0].cal_version).toBe(1)
    expect(String(db.tables.evites[0].cal_changed_at)).toBe('2026-11-13T22:00:00.000Z')
    // The image DID go stale (the date is printed on it) and was re-rendered by the scheduler.
    expect(renderCalls).toBeGreaterThan(0)
  })

  it('day_before is re-sent at the new calendar version, on the new day before, and never on the new party day', () => {
    const rows = rowsOf(db, 'day_before')
    const v0 = rows.filter((r) => r.ref_version === 0)
    const v1 = rows.filter((r) => r.ref_version === 1)
    expect(ids(v0).sort()).toEqual([A, B].sort())
    expect(ids(v1).sort()).toEqual([A, B, G].sort())
    for (const r of v1) {
      expect(claimedAt(r)).toBe('2026-11-20T21:00:00.000Z')
      expect(Date.parse(claimedAt(r))).toBeLessThan(Date.parse('2026-11-21T04:59:00Z'))
    }
  })

  it('exactly one details_changed per guest who was on the list before the move, and none for the late RSVP', () => {
    const rows = rowsOf(db, 'details_changed')
    expect(ids(rows).sort()).toEqual([A, B].sort())
    for (const r of rows) {
      expect(r).toMatchObject({ ref_version: 1, status: 'sent' })
      expect(claimedAt(r)).toBe('2026-11-13T22:00:00.000Z')
    }
    expect(rows.some((r) => r.rsvp_id === G)).toBe(false)
  })

  it('a week_before whose new due time had not yet come is sent then, once, to those on the list', () => {
    const v1 = rowsOf(db, 'week_before').filter((r) => r.ref_version === 1)
    expect(ids(v1).sort()).toEqual([A, B].sort())
    for (const r of v1) expect(claimedAt(r)).toBe('2026-11-14T15:00:00.000Z')
  })

  it('final_headcount is sent for the new version after the new day_befores settle', () => {
    const rows = rowsOf(db, 'final_headcount')
    expect(rows.map((r) => r.ref_version).sort()).toEqual([0, 1])
    const v1 = rows.find((r) => r.ref_version === 1) as Row
    expect(claimedAt(v1)).toBe('2026-11-20T21:30:00.000Z')
    const order = db.tables.evite_sends
    for (const d of rowsOf(db, 'day_before').filter((r) => r.ref_version === 1)) expect(order.indexOf(d)).toBeLessThan(order.indexOf(v1))
  })

  it('every key once', () => {
    expect(new Set(keys(db)).size).toBe(keys(db).length)
  })
})

// ============================================================================================
describe('a moved date that is already inside the window: the one change email is not doubled by a week_before', () => {
  it('week_before at the new version is held back when its due time passed before the change (details_changed told them)', async () => {
    const A = uuid()
    // Booked for Sat 14 Nov. On Fri 6 Nov (before the week-before, 7 Nov) the party moves to Sat 28 Nov... a date whose
    // week_before (21 Nov) is still in the future: it is sent then. The doubled case is a move to a date whose own
    // week_before is already past: Wed 11 Nov -> party moves to Sat 14 Nov+1 week = 21 Nov (due 14 Nov, already past).
    db = await liveDb({ rsvps: [guestRsvp({ id: A, reminder_email: 'a@example.com', created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z' })] }, new Date('2026-11-10T00:00:00Z'))
    let moved = false
    await runTicks(db, ticks('2026-11-10T12:00:00Z', '2026-11-12T12:00:00Z'), (now) => {
      clock.now = now
      if (!moved && now.getTime() >= Date.parse('2026-11-11T12:00:00Z')) {
        moved = true
        db.tables.bookings[0].party_date = '2026-11-21'
      }
    })
    // week_before at v0 (7 Nov) was never sent: the run started on the 10th, inside its window, so it went at the first tick.
    expect(rowsOf(db, 'week_before').map((r) => r.ref_version)).toEqual([0])
    expect(rowsOf(db, 'details_changed')).toHaveLength(1)
    // The new date's own week_before (14 Nov) was due BEFORE the change on the 11th: no second email.
    expect(rowsOf(db, 'week_before').filter((r) => r.ref_version === 1)).toHaveLength(0)
  }, 120_000)
})

// ============================================================================================
describe('a cancelled party', () => {
  async function cancelledDb(over: Row = {}) {
    const A = uuid(), B = uuid(), C = uuid()
    const old = { created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z' }
    const d = await liveDb({
      booking: { status: 'cancelled', updated_at: '2026-11-03T10:00:00Z', ...over },
      rsvps: [guestRsvp({ id: A, reminder_email: 'a@example.com', ...old }), guestRsvp({ id: B, reminder_email: 'b@example.com', ...old }), noGuest({ id: C, ...old })],
    }, new Date('2026-11-02T00:00:00Z'))
    return { d, A, B, C }
  }

  it('sends party_cancelled once to each yes guest, after the 30-minute grace and not before', async () => {
    const { d, A, B } = await cancelledDb()
    db = d
    // 10:00Z is the cancellation. 10:15Z is inside the grace.
    await runTicks(db, ticks('2026-11-03T10:00:00Z', '2026-11-03T10:15:00Z'), (n) => (clock.now = n))
    expect(rowsOf(db, 'party_cancelled')).toHaveLength(0)
    expect(mailMock).not.toHaveBeenCalled()

    await runTicks(db, ticks('2026-11-03T10:30:00Z', '2026-11-03T14:00:00Z'), (n) => (clock.now = n))
    const rows = rowsOf(db, 'party_cancelled')
    expect(ids(rows).sort()).toEqual([A, B].sort())
    for (const r of rows) {
      expect(r).toMatchObject({ ref_version: 1, status: 'sent' })
      expect(claimedAt(r)).toBe('2026-11-03T10:30:00.000Z')
    }
    expect(mailMock).toHaveBeenCalledTimes(2)
    // Every notice carries a CANCEL calendar entry.
    for (const m of mails()) expect(m.attachments?.[0].contentType).toContain('method=CANCEL')
    expect(db.tables.evites[0].cancelled_notice_at).toBe('2026-11-03T10:30:00.000Z')
  })

  it('a party that never went live gets no cancellation notice', async () => {
    const { d } = await cancelledDb()
    d.tables.evites[0].went_live_at = null
    db = d
    await runTicks(db, ticks('2026-11-03T10:30:00Z', '2026-11-03T12:00:00Z'), (n) => (clock.now = n))
    expect(rowsOf(db, 'party_cancelled')).toHaveLength(0)
    expect(mailMock).not.toHaveBeenCalled()
  })

  it('a later edit to the cancelled booking restarts the grace (it can delay the notice, never hurry it)', async () => {
    const { d } = await cancelledDb()
    db = d
    await runTicks(db, ticks('2026-11-03T10:30:00Z', '2026-11-03T10:30:00Z'), (n) => {
      clock.now = n
      db.tables.bookings[0].updated_at = '2026-11-03T10:20:00Z'
    })
    expect(rowsOf(db, 'party_cancelled')).toHaveLength(0)
  })

  it('a cancellation for a party that has already happened is not sent', async () => {
    const { d } = await cancelledDb({ party_date: '2026-10-20' })
    db = d
    await runTicks(db, ticks('2026-11-03T10:30:00Z', '2026-11-03T11:00:00Z'), (n) => (clock.now = n))
    expect(rowsOf(db, 'party_cancelled')).toHaveLength(0)
  })

  it('a status of lost is treated the same as cancelled', async () => {
    const { d, A, B } = await cancelledDb({ status: 'lost' })
    db = d
    await runTicks(db, ticks('2026-11-03T10:30:00Z', '2026-11-03T10:30:00Z'), (n) => (clock.now = n))
    expect(ids(rowsOf(db, 'party_cancelled')).sort()).toEqual([A, B].sort())
  })
})

// ============================================================================================
describe('failures and recovery', () => {
  const guests = () => {
    const old = { created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z' }
    const A = uuid(), B = uuid()
    return { A, B, rsvps: [guestRsvp({ id: A, reminder_email: 'a@example.com', ...old }), guestRsvp({ id: B, reminder_email: 'b@example.com', ...old })] }
  }

  it("final_headcount waits while a guest's day_before is still being retried, and goes once it settles", async () => {
    const { A, B, rsvps } = guests()
    db = await liveDb({ rsvps })
    mailMock.mockImplementation(async (m: { to: string }) => (m.to === 'a@example.com' ? { kind: 'failed', error: 'resend refused' } : { kind: 'sent', providerId: 're_ok' }))
    const reports = await runTicks(db, ticks('2026-11-13T21:00:00Z', '2026-11-13T23:00:00Z'), (n) => (clock.now = n))
    expect(rowsOf(db, 'day_before').find((r) => r.rsvp_id === A)).toMatchObject({ status: 'failed', attempts: 4 })
    expect(rowsOf(db, 'day_before').find((r) => r.rsvp_id === B)).toMatchObject({ status: 'sent' })
    const final = rowsOf(db, 'final_headcount')
    expect(final).toHaveLength(1)
    // attempts 1, 2, 3 at 21:00, 21:15, 21:30 are still "being retried"; the 4th, at 21:45, settles it.
    expect(claimedAt(final[0])).toBe('2026-11-13T21:45:00.000Z')
    expect(reports.reduce((n, r) => n + r.step7.finalHeadcount.waiting, 0)).toBeGreaterThanOrEqual(1)
  })

  it('a failed send is retried on later ticks up to 4 attempts in all, and then left failed', async () => {
    const { A, B, rsvps } = guests()
    db = await liveDb({ rsvps })
    mailMock.mockImplementation(async (m: { to: string }) => (m.to === 'a@example.com' ? { kind: 'failed', error: 'resend refused' } : { kind: 'sent', providerId: 're_ok' }))
    await runTicks(db, ticks('2026-11-07T14:00:00Z', '2026-11-07T20:00:00Z'), (n) => (clock.now = n))
    const a = rowsOf(db, 'week_before').find((r) => r.rsvp_id === A) as Row
    expect(a).toMatchObject({ status: 'failed', attempts: 4 })
    expect(mails().filter((m) => m.to === 'a@example.com')).toHaveLength(4)
    const b = rowsOf(db, 'week_before').find((r) => r.rsvp_id === B) as Row
    expect(b).toMatchObject({ status: 'sent', attempts: 1 })
    expect(mails().filter((m) => m.to === 'b@example.com')).toHaveLength(1)
  })

  it('a `sending` row older than 15 minutes is reclaimed and sent once (and not duplicated by the selection)', async () => {
    const { A, B, rsvps } = guests()
    db = await liveDb({
      rsvps,
      sends: [sendRow({ id: 'stuck-1', rsvp_id: B, send_type: 'week_before', ref_version: 0, status: 'sending', attempts: 1, claimed_at: '2026-11-07T14:00:00Z' })],
    })
    await runTicks(db, ticks('2026-11-07T15:00:00Z', '2026-11-07T16:00:00Z'), (n) => (clock.now = n))
    const rows = rowsOf(db, 'week_before')
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.rsvp_id === B)).toMatchObject({ id: 'stuck-1', status: 'sent', attempts: 2 })
    expect(rows.find((r) => r.rsvp_id === A)).toMatchObject({ status: 'sent', attempts: 1 })
    expect(mails().filter((m) => m.to === 'b@example.com')).toHaveLength(1)
  })

  it('a stuck row that has used every attempt is finished failed, not sent again', async () => {
    const { B, rsvps } = guests()
    db = await liveDb({
      rsvps,
      sends: [sendRow({ id: 'stuck-4', rsvp_id: B, send_type: 'week_before', ref_version: 0, status: 'sending', attempts: 4, claimed_at: '2026-11-07T14:00:00Z' })],
    })
    await runTicks(db, ticks('2026-11-07T15:00:00Z', '2026-11-07T15:30:00Z'), (n) => (clock.now = n))
    expect(rowsOf(db, 'week_before').find((r) => r.rsvp_id === B)).toMatchObject({ id: 'stuck-4', status: 'failed' })
    expect(mails().filter((m) => m.to === 'b@example.com')).toHaveLength(0)
  })

  it('a claim that cannot be written is `unavailable`, sends nothing, and is picked up on a later tick', async () => {
    const { rsvps } = guests()
    db = await liveDb({ rsvps })
    db.errors.push({ table: 'evite_sends', op: 'insert', times: 1000 })
    const [r1] = await runTicks(db, ticks('2026-11-07T15:00:00Z', '2026-11-07T15:00:00Z'), (n) => (clock.now = n))
    expect(mailMock).not.toHaveBeenCalled()
    expect(r1.ok).toBe(false)
    expect(r1.failedSteps).toContain('step7')
    // The step stops after a handful of "could not claim" answers rather than hammering a database that is down.
    expect(r1.step7.weekBefore.unavailable).toBeLessThanOrEqual(5)
    db.errors.length = 0
    await runTicks(db, ticks('2026-11-07T15:15:00Z', '2026-11-07T15:15:00Z'), (n) => (clock.now = n))
    expect(rowsOf(db, 'week_before')).toHaveLength(2)
  })

  it('an unreadable scan stops the sends (503 in the route) rather than guessing', async () => {
    const { rsvps } = guests()
    db = await liveDb({ rsvps })
    db.errors.push({ table: 'evites', op: 'select', times: 1000 })
    const [r] = await runTicks(db, [new Date('2026-11-07T15:00:00Z')], (n) => (clock.now = n))
    expect(r.scan.unavailable).toBe(true)
    expect(mailMock).not.toHaveBeenCalled()
  })
})

// ============================================================================================
describe('the flags', () => {
  const live = async () => {
    const old = { created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z' }
    return cronDb({ rsvps: [guestRsvp({ id: uuid(), reminder_email: 'a@example.com', ...old })] })
  }

  it('both off: nothing is read, nothing is written, nothing is sent', async () => {
    process.env.EVITES_PAGES = 'off'
    process.env.EVITES_SENDS = 'off'
    db = await live()
    const [r] = await runTicks(db, ticks('2026-11-07T15:00:00Z', '2026-11-07T18:00:00Z'), (n) => (clock.now = n))
    expect(r.idle).toBe(true)
    expect(db.selects).toHaveLength(0)
    expect(db.updates).toHaveLength(0)
    expect(db.inserts).toHaveLength(0)
    expect(mailMock).not.toHaveBeenCalled()
  })

  it('an unrecognised value is off', async () => {
    process.env.EVITES_PAGES = 'true'
    process.env.EVITES_SENDS = 'yes'
    db = await live()
    const [r] = await runTicks(db, [new Date('2026-11-07T15:00:00Z')])
    expect(r.idle).toBe(true)
    expect(db.selects).toHaveLength(0)
  })

  it('pages on, sends off: the page goes live and the calendar is tracked, but no email and no claim', async () => {
    process.env.EVITES_SENDS = 'off'
    db = await live()
    await freshenRender(db, new Date('2026-11-07T15:00:00Z'))
    await runTicks(db, ticks('2026-11-07T15:00:00Z', '2026-11-07T16:00:00Z'), (n) => (clock.now = n))
    expect(db.tables.evites[0].went_live_at).not.toBeNull()
    expect(db.tables.evites[0].cal_inputs_hash).not.toBeNull()
    expect(db.tables.evite_sends).toHaveLength(0)
    expect(mailMock).not.toHaveBeenCalled()
  })

  it('pages off, sends on: nothing is live, so nothing is sent', async () => {
    process.env.EVITES_PAGES = 'off'
    db = await live()
    await runTicks(db, ticks('2026-11-07T15:00:00Z', '2026-11-07T16:00:00Z'), (n) => (clock.now = n))
    expect(db.tables.evite_sends).toHaveLength(0)
    expect(db.tables.evites[0].went_live_at).toBeNull()
    expect(mailMock).not.toHaveBeenCalled()
  })

  it('pilot: only a booking named in EVITES_PILOT_REFS is stamped and mailed', async () => {
    process.env.EVITES_PAGES = 'pilot'
    process.env.EVITES_SENDS = 'pilot'
    process.env.EVITES_PILOT_REFS = 'HH-SOMEONE-ELSE'
    db = await live()
    await freshenRender(db, new Date('2026-11-07T15:00:00Z'))
    await runTicks(db, ticks('2026-11-07T15:00:00Z', '2026-11-07T16:00:00Z'), (n) => (clock.now = n))
    expect(db.tables.evites[0].went_live_at).toBeNull()
    expect(db.tables.evite_sends).toHaveLength(0)
    expect(mailMock).not.toHaveBeenCalled()

    process.env.EVITES_PILOT_REFS = 'hh-test-1'
    await runTicks(db, ticks('2026-11-07T16:00:00Z', '2026-11-07T16:15:00Z'), (n) => (clock.now = n))
    expect(db.tables.evites[0].went_live_at).not.toBeNull()
    expect(rowsOf(db, 'week_before').length).toBeGreaterThan(0)
  })
})

// ============================================================================================
describe('go-live: the re-slug, the stamp and the calendar baseline', () => {
  it('re-mints the slug before go-live when the name part is stale, keeps the old slug as an alias, then stamps with a baseline', async () => {
    // The lead had no name when the slug was made ("birthday-glow-xxxx"); the name arrived before the party went live.
    db = cronDb({ evite: { slug: 'birthday-glow-7kq2' } })
    await freshenRender(db, new Date('2026-11-01T00:00:00Z'))
    const [r] = await runTicks(db, [new Date('2026-11-01T00:00:00Z')], (n) => (clock.now = n))
    const ev = db.tables.evites[0]
    expect(r.liveStamp.reslugged).toBe(1)
    expect(String(ev.slug)).toMatch(/^mia-/)
    expect(ev.previous_slugs).toEqual(['birthday-glow-7kq2'])
    expect(ev.went_live_at).toBe('2026-11-01T00:00:00.000Z')
    expect(ev.cal_inputs_hash).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/))
    // The baseline did NOT bump the calendar version.
    expect(ev.cal_version).toBe(0)
    expect(r.calChange.bumped).toBe(0)
  })

  it('a stamped party keeps its slug even if the name changes later', async () => {
    db = await liveDb({ evite: { slug: 'birthday-glow-7kq2' } })
    db.tables.bookings[0].child_name = 'Olivia'
    await runTicks(db, [new Date('2026-11-02T00:00:00Z')], (n) => (clock.now = n))
    expect(db.tables.evites[0].slug).toBe('birthday-glow-7kq2')
  })

  it('go-live is stamped once (a conditional write), and not overwritten', async () => {
    db = cronDb()
    await freshenRender(db, new Date('2026-11-01T00:00:00Z'))
    await runTicks(db, ticks('2026-11-01T00:00:00Z', '2026-11-01T01:00:00Z'), (n) => (clock.now = n))
    expect(db.tables.evites[0].went_live_at).toBe('2026-11-01T00:00:00.000Z')
    expect(db.updates.filter((u) => u.table === 'evites' && 'went_live_at' in u.patch)).toHaveLength(1)
  })

  it('a calendar change that does not touch the render still bumps the version (independent of rendering)', async () => {
    db = await liveDb()
    // Move the start time by an hour: the printed date line is unchanged, the calendar entry is not.
    db.tables.bookings[0].party_time = '15:00'
    await runTicks(db, [new Date('2026-11-02T00:00:00Z')], (n) => (clock.now = n))
    expect(db.tables.evites[0].cal_version).toBe(1)
  })

  it('a raced calendar bump (another worker got there first) is counted, not applied twice', async () => {
    db = await liveDb()
    db.tables.bookings[0].party_time = '15:00'
    db.hooks.beforeUpdate = (info, tables) => {
      if (info.table === 'evites' && 'cal_version' in info.patch) tables.evites[0].cal_version = 1
    }
    const [r] = await runTicks(db, [new Date('2026-11-02T00:00:00Z')], (n) => (clock.now = n))
    expect(r.calChange.raced).toBe(1)
    expect(db.tables.evites[0].cal_version).toBe(1)
  })
})

// ============================================================================================
describe('the 50-send budget and the orphan sweep', () => {
  it('step 7 claims at most 50 sends a tick in total; the rest wait for the next tick', async () => {
    const old = { created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z' }
    const rsvps = Array.from({ length: 60 }, (_, i) => guestRsvp({ id: uuid(), reminder_email: `g${i}@example.com`, ...old }))
    db = await liveDb({ rsvps })
    const [t1, t2, t3] = await runTicks(db, ticks('2026-11-07T15:00:00Z', '2026-11-07T15:30:00Z'), (n) => (clock.now = n))
    expect(rowsOf(db, 'week_before')).toHaveLength(60)
    expect(t1.step7.weekBefore.sent).toBe(50)
    expect(t1.step7.used).toBe(50)
    expect(t1.step7.exhausted).toBe(true)
    expect(t2.step7.weekBefore.sent).toBe(10)
    expect(t3.step7.weekBefore.sent).toBe(0)
  })

  it('the sweep recovers an RSVP whose inline notices never reached the ledger, inside the same budget', async () => {
    const R = uuid()
    const now = new Date('2026-11-03T12:00:00Z')
    const at = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString()
    const young = uuid(), ancient = uuid(), done = uuid()
    db = await liveDb({
      rsvps: [
        guestRsvp({ id: R, reminder_email: 'r@example.com', created_at: at(20 * MIN), updated_at: at(20 * MIN) }),
        guestRsvp({ id: young, reminder_email: 'y@example.com', created_at: at(2 * MIN), updated_at: at(2 * MIN) }),
        guestRsvp({ id: ancient, reminder_email: 'o@example.com', created_at: at(3 * DAY), updated_at: at(3 * DAY) }),
        guestRsvp({ id: done, reminder_email: 'd@example.com', created_at: at(HOUR), updated_at: at(HOUR) }),
      ],
      sends: [
        sendRow({ rsvp_id: null, send_type: 'invite_ready', ref_version: 0, status: 'sent' }),
        sendRow({ rsvp_id: done, send_type: 'new_rsvp', ref_version: 1, status: 'sent' }),
        sendRow({ rsvp_id: done, send_type: 'rsvp_confirmed', ref_version: 0, status: 'sent' }),
      ],
    }, now)
    const [r] = await runTicks(db, [now], (n) => (clock.now = n))
    const got = db.tables.evite_sends.filter((s) => s.rsvp_id === R).map((s) => s.send_type).sort()
    expect(got).toEqual(['new_rsvp', 'rsvp_confirmed'])
    // too young (the inline hook may still be running), too old (out of the 48 h look-back), already done
    expect(db.tables.evite_sends.some((s) => s.rsvp_id === young)).toBe(false)
    expect(db.tables.evite_sends.some((s) => s.rsvp_id === ancient)).toBe(false)
    expect(db.tables.evite_sends.filter((s) => s.rsvp_id === done)).toHaveLength(2)
    expect(r.step7.orphans.sent).toBe(2)
    expect(r.step7.used).toBe(2)
    expect(mails().map((m) => m.to).sort()).toEqual(['pat@example.com', 'r@example.com'])
  })

  it('a second tick does not re-send what the sweep recovered', async () => {
    const R = uuid()
    const now = new Date('2026-11-03T12:00:00Z')
    db = await liveDb({
      rsvps: [guestRsvp({ id: R, reminder_email: 'r@example.com', created_at: new Date(now.getTime() - 20 * MIN).toISOString(), updated_at: new Date(now.getTime() - 20 * MIN).toISOString() })],
      sends: [sendRow({ rsvp_id: null, send_type: 'invite_ready', ref_version: 0, status: 'sent' })],
    }, now)
    await runTicks(db, ticks('2026-11-03T12:00:00Z', '2026-11-03T13:00:00Z'), (n) => (clock.now = n))
    expect(mailMock).toHaveBeenCalledTimes(2)
  })

  describe('v1.2: rsvp_confirmed is owed only to an address that was SET inside the look-back', () => {
    const now = new Date('2026-11-03T12:00:00Z')
    const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
    const invited = sendRow({ rsvp_id: null, send_type: 'invite_ready', ref_version: 0, status: 'sent' })
    const types = (id: string) => db.tables.evite_sends.filter((s) => s.rsvp_id === id).map((s) => s.send_type).sort()

    it('an RSVP merely TOUCHED (a name edit) whose address was set ten days ago gets its parent notice but its address is NOT mailed', async () => {
      const R = uuid()
      db = await liveDb({
        rsvps: [guestRsvp({ id: R, reminder_email: 'old@example.com', created_at: ago(10 * DAY), reminder_set_at: ago(10 * DAY), updated_at: ago(HOUR), revision: 2 })],
        sends: [invited],
      }, now)
      await runTicks(db, [now], (n) => (clock.now = n))
      expect(types(R)).toEqual(['rsvp_changed'])
      expect(mails().map((m) => m.to)).not.toContain('old@example.com')
    })

    it('an address SET by a recent PATCH on an old row, never confirmed, is confirmed once (it passed the capped path when it was set)', async () => {
      const R = uuid()
      db = await liveDb({
        rsvps: [guestRsvp({ id: R, reminder_email: 'new@example.com', created_at: ago(10 * DAY), reminder_set_at: ago(HOUR), updated_at: ago(HOUR) })],
        sends: [invited, sendRow({ rsvp_id: R, send_type: 'new_rsvp', ref_version: 1, status: 'sent' })],
      }, now)
      await runTicks(db, ticks('2026-11-03T12:00:00Z', '2026-11-03T12:30:00Z'), (n) => (clock.now = n))
      expect(types(R)).toEqual(['new_rsvp', 'rsvp_confirmed'])
      expect(mails().filter((m) => m.to === 'new@example.com')).toHaveLength(1)
    })

    it('an address set before the look-back is never swept, however recently the row was updated', async () => {
      const R = uuid()
      db = await liveDb({
        rsvps: [guestRsvp({ id: R, reminder_email: 'old@example.com', created_at: ago(5 * DAY), reminder_set_at: ago(3 * DAY), updated_at: ago(HOUR) })],
        sends: [invited, sendRow({ rsvp_id: R, send_type: 'new_rsvp', ref_version: 1, status: 'sent' })],
      }, now)
      await runTicks(db, [now], (n) => (clock.now = n))
      expect(types(R)).toEqual(['new_rsvp'])
    })
  })
})

// ============================================================================================
describe('lead_preview', () => {
  const BOOKED_AT = '2026-11-02T14:00:00Z' // 09:00 ET
  const lead = async (o: { booking?: Row; evite?: Row; contacts?: Row[]; interactions?: Row[] } = {}, at = BOOKED_AT) => {
    const d = cronDb({
      booking: { status: 'awaiting_deposit', created_at: at, updated_at: at, ...o.booking },
      evite: { created_at: new Date(Date.parse(at) + 5 * MIN).toISOString(), ...o.evite },
      payments: [],
      contacts: o.contacts,
      interactions: o.interactions,
    })
    await freshenRender(d, new Date(Date.parse(at) + 2 * HOUR))
    return d
  }
  const at = (iso: string) => new Date(iso)

  it('sends one preview to an intake-created lead inside the window and the hours, with the unsubscribe headers', async () => {
    db = await lead()
    const [r] = await runTicks(db, [at('2026-11-02T16:00:00Z')], (n) => (clock.now = n))
    const rows = rowsOf(db, 'lead_preview')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ rsvp_id: null, ref_version: 0, status: 'sent' })
    expect(r.leadPreview.sent).toBe(1)
    expect(mails()[0].to).toBe('pat@example.com')
    expect((mailMock.mock.calls[0][0] as { headers?: Record<string, string> }).headers?.['List-Unsubscribe']).toContain('/api/unsubscribe')
    // The same lead is not mailed again on later ticks.
    await runTicks(db, ticks('2026-11-02T16:15:00Z', '2026-11-02T18:00:00Z'), (n) => (clock.now = n))
    expect(mailMock).toHaveBeenCalledTimes(1)
  })

  it('waits until the booking is 10 minutes old', async () => {
    db = await lead()
    const [r1] = await runTicks(db, [at('2026-11-02T14:09:00Z')], (n) => (clock.now = n))
    expect(rowsOf(db, 'lead_preview')).toHaveLength(0)
    expect(r1.leadPreview.holds['too-new']).toBe(1)
    await runTicks(db, [at('2026-11-02T14:10:00Z')], (n) => (clock.now = n))
    expect(rowsOf(db, 'lead_preview')).toHaveLength(1)
  })

  it('goes out from 09:00 to before 20:00 Eastern only, and a held one goes the next morning', async () => {
    db = await lead({}, '2026-11-02T00:00:00Z') // 19:00 ET on the 1st
    // 20:00 ET (01:00Z) is outside; 08:59 ET (13:59Z) is outside; 09:00 ET (14:00Z) is in.
    const [late] = await runTicks(db, [at('2026-11-02T01:00:00Z')], (n) => (clock.now = n))
    expect(late.leadPreview.holds['outside-hours']).toBe(1)
    await runTicks(db, [at('2026-11-02T13:59:00Z')], (n) => (clock.now = n))
    expect(rowsOf(db, 'lead_preview')).toHaveLength(0)
    await runTicks(db, [at('2026-11-02T14:00:00Z')], (n) => (clock.now = n))
    expect(rowsOf(db, 'lead_preview')).toHaveLength(1)
  })

  it('19:45 ET is still inside the window', async () => {
    db = await lead({}, '2026-11-02T00:00:00Z')
    await runTicks(db, [at('2026-11-02T00:45:00Z')], (n) => (clock.now = n))
    expect(rowsOf(db, 'lead_preview')).toHaveLength(1)
  })

  it('is not sent for a booking older than 14 days, or for an evite made a long time after the booking (a backfill, not intake)', async () => {
    db = await lead({}, '2026-10-15T14:00:00Z')
    await runTicks(db, [at('2026-11-02T16:00:00Z')], (n) => (clock.now = n))
    expect(rowsOf(db, 'lead_preview')).toHaveLength(0)

    db = await lead({ evite: { created_at: '2026-11-02T15:30:00Z' } })
    const [r] = await runTicks(db, [at('2026-11-02T16:00:00Z')], (n) => (clock.now = n))
    expect(rowsOf(db, 'lead_preview')).toHaveLength(0)
    expect(r.leadPreview.holds['not-intake']).toBe(1)
  })

  it('is not sent for a booked party (that one gets invite_ready), and not while the render is stale', async () => {
    db = await lead({ booking: { status: 'deposit_paid' } })
    db.tables.booking_payments.push({ booking_id: 'bk-1', amount_cents: 25000, payment_type: 'deposit' })
    await runTicks(db, [at('2026-11-02T16:00:00Z')], (n) => (clock.now = n))
    expect(rowsOf(db, 'lead_preview')).toHaveLength(0)

    db = await lead()
    db.tables.evites[0].render_inputs_hash = 'stale'
    renderMock.mockImplementation(async () => ({ kind: 'failed', error: 'no' }))
    const [r] = await runTicks(db, [at('2026-11-02T16:00:00Z')], (n) => (clock.now = n))
    expect(rowsOf(db, 'lead_preview')).toHaveLength(0)
    expect(r.leadPreview.holds['render-stale']).toBe(1)
  })

  it('an unsubscribed or hard-bounced address gets nothing; the refusal is recorded once and never retried', async () => {
    for (const interactions of [
      [{ id: 'i1', contact_id: 'c1', type: 'email_unsubscribed', metadata: {}, created_at: '2026-02-01T00:00:00Z' }],
      [{ id: 'i2', contact_id: 'c1', type: 'email_bounced', metadata: { bounce_type: 'hard' }, created_at: '2026-02-01T00:00:00Z' }],
    ]) {
      mailMock.mockClear()
      db = await lead({ contacts: [{ id: 'c1', email: 'pat@example.com', email_opt_in: false, status: 'lead', created_at: '2026-01-01T00:00:00Z' }], interactions })
      await runTicks(db, ticks('2026-11-02T16:00:00Z', '2026-11-02T17:00:00Z'), (n) => (clock.now = n))
      expect(mailMock).not.toHaveBeenCalled()
      const rows = rowsOf(db, 'lead_preview')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ status: 'skipped', outcome: 'suppressed', attempts: 1 })
    }
  })

  it('an unreadable suppression list DEFERS: no claim, no attempt spent, and it sends on the next tick', async () => {
    db = await lead({ contacts: [] })
    db.errors.push({ table: 'contacts', op: 'select', times: 1000 })
    const [r1] = await runTicks(db, [at('2026-11-02T16:00:00Z')], (n) => (clock.now = n))
    expect(r1.leadPreview.deferred).toBe(1)
    expect(rowsOf(db, 'lead_preview')).toHaveLength(0)
    expect(mailMock).not.toHaveBeenCalled()
    db.errors.length = 0
    await runTicks(db, [at('2026-11-02T16:15:00Z')], (n) => (clock.now = n))
    const rows = rowsOf(db, 'lead_preview')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'sent', attempts: 1 })
  })

  it('the Reserve button is omitted when the link cannot be minted, and the preview still goes', async () => {
    db = await lead()
    db.errors.push({ table: 'portal_tokens', op: 'insert', times: 1000 })
    await runTicks(db, [at('2026-11-02T16:00:00Z')], (n) => (clock.now = n))
    expect(rowsOf(db, 'lead_preview')[0].status).toBe('sent')
    const m = mailMock.mock.calls[0][0] as { html: string }
    expect(m.html).not.toContain('Reserve your date')
    expect(m.html).toContain('See the invitation')
  })
})

// ============================================================================================
describe('invite_ready', () => {
  it('is not sent inside 2 days of the party, and not to a suppressed parent', async () => {
    db = await liveDb({}, new Date('2026-11-12T20:00:00Z'))
    await runTicks(db, [new Date('2026-11-12T20:00:00Z')], (n) => (clock.now = n)) // start - 2d = 12 Nov 19:00Z
    expect(rowsOf(db, 'invite_ready')).toHaveLength(0)

    db = await liveDb({
      contacts: [{ id: 'c1', email: 'pat@example.com', email_opt_in: false, status: 'lead', created_at: '2026-01-01T00:00:00Z' }],
      interactions: [{ id: 'i1', contact_id: 'c1', type: 'email_unsubscribed', metadata: {}, created_at: '2026-02-01T00:00:00Z' }],
    })
    await runTicks(db, [new Date('2026-11-02T12:00:00Z')], (n) => (clock.now = n))
    expect(rowsOf(db, 'invite_ready')[0]).toMatchObject({ status: 'skipped', outcome: 'suppressed' })
    expect(mailMock).not.toHaveBeenCalled()
  })

  it('waits for a render that is fresh for the live facts', async () => {
    db = await liveDb()
    db.tables.evites[0].render_inputs_hash = 'stale'
    renderMock.mockImplementation(async () => ({ kind: 'failed', error: 'no' }))
    const [r1] = await runTicks(db, [new Date('2026-11-02T12:00:00Z')], (n) => (clock.now = n))
    expect(rowsOf(db, 'invite_ready')).toHaveLength(0)
    expect(r1.inviteReady.holds['render-stale']).toBe(1)
    renderMock.mockImplementation(fakeRenderer(() => db, clock))
    await runTicks(db, [new Date('2026-11-02T12:15:00Z'), new Date('2026-11-02T12:30:00Z')], (n) => (clock.now = n))
    expect(rowsOf(db, 'invite_ready')).toHaveLength(1)
  })
})

// ============================================================================================
describe('day_before is not blocked on the unworded studio arrival note', () => {
  it('goes out with no placeholder text in it', async () => {
    const A = uuid()
    db = await liveDb({ rsvps: [guestRsvp({ id: A, reminder_email: 'a@example.com', created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z' })] })
    await runTicks(db, [new Date('2026-11-13T21:00:00Z')], (n) => (clock.now = n))
    expect(rowsOf(db, 'day_before')).toHaveLength(1)
    const m = mails().find((x) => x.to === 'a@example.com')
    expect(m).toBeDefined()
    expect(m?.text).not.toContain('TODO')
  })
})

// ============================================================================================
describe('v1.2 finding 9: the scan window cannot be filled by finished parties', () => {
  const FILLER_ID = (i: number) => `f0000000-0000-4000-8000-${String(i).padStart(12, '0')}`
  /** `n` invitations for parties that finished in June, and so have nothing left to do. */
  const addFillers = (d: SendDb, n: number, when: { created_at: string; updated_at: string }) => {
    for (let i = 0; i < n; i++) {
      d.tables.bookings.push({
        id: `fb-${i}`,
        booking_ref: `HH-FILL-${i}`,
        status: 'deposit_paid',
        party_type: 'in_studio_theme',
        party_date: '2026-06-06',
        party_time: '14:00',
        package_type: 'Glow Party',
        child_name: `Kid${i}`,
        contact_email: `f${i}@example.com`,
        party_tags: {},
        created_at: when.created_at,
        updated_at: when.updated_at,
      })
      d.tables.evites.push({
        id: FILLER_ID(i),
        booking_id: `fb-${i}`,
        slug: `kid-glow-${String(i).padStart(4, '0')}`,
        archived_at: null,
        went_live_at: '2026-05-01T00:00:00Z',
        cancelled_notice_at: null,
        cal_version: 0,
        previous_slugs: [],
        ...when,
      })
    }
  }
  const guestsFor = () => {
    const old = { created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z' }
    return [guestRsvp({ id: uuid(), reminder_email: 'a@example.com', ...old }), guestRsvp({ id: uuid(), reminder_email: 'b@example.com', ...old })]
  }

  it('200 finished parties that nothing ever writes to (oldest updated_at) do not stop a LIVE party from getting its week_before', async () => {
    db = await liveDb({ rsvps: guestsFor() })
    addFillers(db, 200, { created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' })
    const [r] = await runTicks(db, [new Date('2026-11-07T15:00:00Z')], (n) => (clock.now = n))
    expect(r.scan.truncated).toBe(true) // rotation is in effect, and says so
    expect(r.scan.evites).toBeLessThanOrEqual(150)
    expect(r.scan.active).toBe(1)
    expect(rowsOf(db, 'week_before')).toHaveLength(2)
  })

  it('a party NEWER than 200 finished ones (so it sits behind the newest 60) is still reached within two ticks by the rotation', async () => {
    db = await liveDb({ rsvps: guestsFor() })
    addFillers(db, 200, { created_at: '2026-10-25T00:00:00Z', updated_at: '2026-10-25T00:00:00Z' })
    const seen: number[] = []
    const reports = await runTicks(db, ticks('2026-11-07T15:00:00Z', '2026-11-07T15:15:00Z'), (n) => (clock.now = n))
    for (const r of reports) {
      seen.push(r.scan.active)
      expect(r.scan.evites).toBeLessThanOrEqual(150)
    }
    expect(seen.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1)
    expect(rowsOf(db, 'week_before')).toHaveLength(2)
  })

  it('scanRanges: always the newest 60, plus a slice that advances; every index is covered within ceil(rest/90) consecutive ticks, for any list size', () => {
    for (const total of [151, 200, 241, 300, 301, 1000, 1234]) {
      const rest = total - SCAN_NEWEST
      const need = Math.ceil(rest / (SCAN_LIMIT - SCAN_NEWEST))
      for (const start of [0, 1, 7, 12345]) {
        const covered = new Set<number>()
        for (let t = start; t < start + need; t++) {
          const ranges = scanRanges(total, t)
          let size = 0
          for (const [from, to] of ranges) {
            expect(from).toBeGreaterThanOrEqual(0)
            expect(to).toBeLessThanOrEqual(total - 1)
            for (let i = from; i <= to; i++) covered.add(i)
            size += to - from + 1
          }
          expect(size).toBe(SCAN_LIMIT) // a full window every tick
          expect(ranges[0]).toEqual([0, SCAN_NEWEST - 1]) // the newest are never rotated out
        }
        expect(covered.size).toBe(total)
      }
    }
    expect(scanRanges(150, 99)).toEqual([[0, 149]])
    expect(scanRanges(0, 99)).toEqual([])
  })

  it('with 150 or fewer invitations nothing rotates and nothing is skipped', async () => {
    db = await liveDb({ rsvps: guestsFor() })
    addFillers(db, 100, { created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' })
    const [r] = await runTicks(db, [new Date('2026-11-07T15:00:00Z')], (n) => (clock.now = n))
    expect(r.scan.truncated).toBe(false)
    expect(r.scan.evites).toBe(101)
    expect(r.scan.past).toBe(100)
  })

  it('an unreadable count is "could not read", never "nothing to do"', async () => {
    db = await liveDb({ rsvps: guestsFor() })
    db.errors.push({ table: 'evites', op: 'select', times: 1000 })
    const [r] = await runTicks(db, [new Date('2026-11-07T15:00:00Z')], (n) => (clock.now = n))
    expect(r.scan.unavailable).toBe(true)
    expect(rowsOf(db, 'week_before')).toHaveLength(0)
  })
})

// ============================================================================================
describe('the launch cutoff EVITES_AUTOSEND_SINCE (Adam, 2026-10-11: booked clients are not emailed unless we ask)', () => {
  const T = new Date('2026-11-02T16:00:00Z') // 11:00 ET: inside the lead_preview hours
  const LIVE_AT = new Date('2026-11-02T00:00:00Z')

  /** A live, booked party whose booking was created at `createdAt`. */
  const booked = (createdAt: string) => liveDb({ booking: { created_at: createdAt } }, LIVE_AT)
  /** An intake lead (evite made 5 minutes after the booking) created at `createdAt`. */
  const leadAt = async (createdAt: string) => {
    const d = cronDb({
      booking: { status: 'awaiting_deposit', created_at: createdAt, updated_at: createdAt },
      evite: { created_at: new Date(Date.parse(createdAt) + 5 * MIN).toISOString() },
      payments: [],
    })
    await freshenRender(d, T)
    return d
  }

  it('unset: invite_ready is never sent automatically (fail closed), and the hold is counted', async () => {
    delete process.env.EVITES_AUTOSEND_SINCE
    db = await booked('2026-10-25T12:00:00Z')
    const [r] = await runTicks(db, [T], (n) => (clock.now = n))
    expect(rowsOf(db, 'invite_ready')).toHaveLength(0)
    expect(mailMock).not.toHaveBeenCalled()
    expect(r.inviteReady.holds['before-launch']).toBe(1)
  })

  it.each(['', '   ', '2026', '2026-10', '2026-10-12', '2026-10-12T00:00:00', 'yesterday', '2026-13-01T00:00:00Z', '2026-10-12T25:00:00Z', 'true'])(
    'malformed (%j): treated as unset, nothing is sent',
    async (bad) => {
      process.env.EVITES_AUTOSEND_SINCE = bad
      db = await booked('2026-10-25T12:00:00Z')
      await runTicks(db, [T], (n) => (clock.now = n))
      expect(rowsOf(db, 'invite_ready')).toHaveLength(0)
      expect(mailMock).not.toHaveBeenCalled()
    },
  )

  it('a booking created BEFORE the cutoff is not emailed; its invitation still exists and is live', async () => {
    process.env.EVITES_AUTOSEND_SINCE = '2026-10-20T00:00:00Z'
    db = await booked('2026-10-19T23:59:59Z')
    await runTicks(db, ticks('2026-11-02T12:00:00Z', '2026-11-02T14:00:00Z'), (n) => (clock.now = n))
    expect(rowsOf(db, 'invite_ready')).toHaveLength(0)
    expect(mailMock).not.toHaveBeenCalled()
    expect(db.tables.evites).toHaveLength(1)
  })

  it('a booking created at or AFTER the cutoff is emailed exactly once', async () => {
    process.env.EVITES_AUTOSEND_SINCE = '2026-10-20T00:00:00Z'
    db = await booked('2026-10-20T00:00:00Z') // exactly at the cutoff: allowed
    await runTicks(db, ticks('2026-11-02T12:00:00Z', '2026-11-02T14:00:00Z'), (n) => (clock.now = n))
    expect(rowsOf(db, 'invite_ready')).toHaveLength(1)
    expect(mails().filter((m) => /invitation/i.test(m.subject))).toHaveLength(1)
  })

  it('a cutoff with an offset is read as the instant it names', async () => {
    process.env.EVITES_AUTOSEND_SINCE = '2026-10-20T08:00:00-04:00' // = 12:00Z
    db = await booked('2026-10-20T11:59:00Z')
    await runTicks(db, [T], (n) => (clock.now = n))
    expect(rowsOf(db, 'invite_ready')).toHaveLength(0)
    db = await booked('2026-10-20T12:00:00Z')
    await runTicks(db, [T], (n) => (clock.now = n))
    expect(rowsOf(db, 'invite_ready')).toHaveLength(1)
  })

  it('lead_preview respects the cutoff too: before it, or unset, no preview', async () => {
    process.env.EVITES_AUTOSEND_SINCE = '2026-11-03T00:00:00Z'
    db = await leadAt('2026-11-02T14:00:00Z')
    await runTicks(db, [T], (n) => (clock.now = n))
    expect(rowsOf(db, 'lead_preview')).toHaveLength(0)

    delete process.env.EVITES_AUTOSEND_SINCE
    db = await leadAt('2026-11-02T14:00:00Z')
    await runTicks(db, [T], (n) => (clock.now = n))
    expect(rowsOf(db, 'lead_preview')).toHaveLength(0)
    expect(mailMock).not.toHaveBeenCalled()

    process.env.EVITES_AUTOSEND_SINCE = '2026-11-02T14:00:00Z'
    db = await leadAt('2026-11-02T14:00:00Z')
    await runTicks(db, [T], (n) => (clock.now = n))
    expect(rowsOf(db, 'lead_preview')).toHaveLength(1)
  })

  it('does not hold the guest-facing mail: a held booking whose guest RSVPed still gets the week_before reminder', async () => {
    process.env.EVITES_AUTOSEND_SINCE = '2026-12-01T00:00:00Z'
    const A = uuid()
    db = await liveDb({ rsvps: [guestRsvp({ id: A, reminder_email: 'a@example.com', created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z' })] })
    await runTicks(db, [new Date('2026-11-07T15:00:00Z')], (n) => (clock.now = n))
    expect(rowsOf(db, 'invite_ready')).toHaveLength(0)
    expect(rowsOf(db, 'week_before')).toHaveLength(1)
  })
})
