import { cronDb } from '../../helpers/cronFixtures'
import { bookingRow } from '../../helpers/eviteFixtures'
import { uuid, type SendDb } from '../../helpers/sendFixtures'
import { ensureEviteForBooking } from '@/lib/evites/ensure'
import { queueRender } from '@/lib/evites/render'
import { runEviteSendsTick, BACKFILL_PER_TICK } from '@/lib/evites/cronTick'

/** Step 1 of the scheduler: backfill (spec §9.3, §2.1). `ensure` is replaced so only the SELECTION is under test. */

jest.mock('@/lib/evites/mail')
jest.mock('@/lib/evites/render', () => ({ queueRender: jest.fn(), renderEvite: jest.fn(), renderViaQueue: jest.fn() }))
jest.mock('@/lib/evites/ensure', () => ({ ensureEviteForBooking: jest.fn() }))
let db: SendDb
jest.mock('@/lib/supabase', () => ({ getSupabase: () => db.supabase }))

const ensureMock = ensureEviteForBooking as jest.Mock
const ENV = ['EVITES_PAGES', 'EVITES_SENDS', 'EVITES_PILOT_REFS'] as const
const saved: Record<string, string | undefined> = {}
const NOW = new Date('2026-11-01T15:00:00Z')

type Row = Record<string, unknown>
const booking = (over: Row = {}): Row => bookingRow({ id: uuid(), booking_ref: `HH-B-${Math.floor(Math.random() * 1e9)}`, ...over })

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  process.env.EVITES_PAGES = 'on'
  process.env.EVITES_SENDS = 'off'
  delete process.env.EVITES_PILOT_REFS
  ensureMock.mockReset()
  ensureMock.mockImplementation(async (_s: unknown, id: string) => ({ kind: 'created', eviteId: `ev-${id}`, slug: 'x' }))
  ;(queueRender as jest.Mock).mockReset()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  db = cronDb()
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  jest.restoreAllMocks()
})

const ensured = () => ensureMock.mock.calls.map((c) => c[1] as string)

describe('backfill', () => {
  it('creates at most 25 invitations a tick, and fires a render for each created', async () => {
    const extra = Array.from({ length: 40 }, () => booking())
    db.tables.bookings.push(...extra)
    const rep = await runEviteSendsTick(db.supabase, { now: NOW })
    expect(ensureMock).toHaveBeenCalledTimes(BACKFILL_PER_TICK)
    expect(rep.backfill.created).toBe(25)
    expect(rep.backfill.considered).toBe(40)
    expect(queueRender).toHaveBeenCalledTimes(25)
  })

  it('takes upcoming parties and bookings made in the last 14 days; not an old booking for a past party', async () => {
    const upcoming = booking({ party_date: '2026-12-05', created_at: '2026-03-01T00:00:00Z' })
    const recent = booking({ party_date: '2026-10-20', created_at: '2026-10-25T00:00:00Z' }) // date gone by, but new
    const old = booking({ party_date: '2026-10-20', created_at: '2026-06-01T00:00:00Z' })
    db.tables.bookings.push(upcoming, recent, old)
    await runEviteSendsTick(db.supabase, { now: NOW })
    expect(ensured().sort()).toEqual([upcoming.id as string, recent.id as string].sort())
  })

  it('skips a booking that already has an invitation, ARCHIVED ones included', async () => {
    const withArchived = booking()
    db.tables.evites.push({ id: 'ev-arch', booking_id: withArchived.id, slug: 'a-b-1234', archived_at: '2026-10-30T00:00:00Z', went_live_at: null, cancelled_notice_at: null, updated_at: '2026-10-30T00:00:00Z' })
    const fresh = booking()
    db.tables.bookings.push(withArchived, fresh)
    await runEviteSendsTick(db.supabase, { now: NOW })
    expect(ensured()).toEqual([fresh.id])
  })

  it('does not even ask ensure about a studio rental or a cancelled booking', async () => {
    db.tables.bookings.push(booking({ party_type: 'studio_rental' }), booking({ status: 'cancelled' }), booking({ status: 'lost' }))
    await runEviteSendsTick(db.supabase, { now: NOW })
    expect(ensureMock).not.toHaveBeenCalled()
  })

  it('pilot: only the named bookings', async () => {
    process.env.EVITES_PAGES = 'pilot'
    process.env.EVITES_PILOT_REFS = 'HH-PILOT-1'
    const pilot = booking({ booking_ref: 'HH-PILOT-1' })
    db.tables.bookings.push(pilot, booking())
    await runEviteSendsTick(db.supabase, { now: NOW })
    expect(ensured()).toEqual([pilot.id])
  })

  it('pages off: no backfill, and nothing is read', async () => {
    process.env.EVITES_PAGES = 'off'
    db.tables.bookings.push(booking())
    await runEviteSendsTick(db.supabase, { now: NOW })
    expect(ensureMock).not.toHaveBeenCalled()
    expect(db.selects).toHaveLength(0)
  })

  it('a backfill that cannot read is an error in the answer, and the rest of the tick still runs', async () => {
    db.errors.push({ table: 'bookings', op: 'select', times: 2, when: ({ filters }) => (filters ?? []).some((f) => f.col === 'party_date') })
    const rep = await runEviteSendsTick(db.supabase, { now: NOW })
    expect(rep.ok).toBe(false)
    expect(rep.failedSteps).toContain('backfill')
    expect(rep.scan.unavailable).toBe(false)
  })

  it('an unavailable ensure is counted and flagged, never counted as created', async () => {
    db.tables.bookings.push(booking())
    ensureMock.mockResolvedValue({ kind: 'unavailable', reason: 'booking read failed' })
    const rep = await runEviteSendsTick(db.supabase, { now: NOW })
    expect(rep.backfill.unavailable).toBe(1)
    expect(rep.backfill.created).toBe(0)
    expect(queueRender).not.toHaveBeenCalled()
    expect(rep.ok).toBe(false)
  })

  it('a booking in the scan that ensure says exists/ineligible is counted as such', async () => {
    db.tables.bookings.push(booking(), booking())
    ensureMock.mockResolvedValueOnce({ kind: 'exists', eviteId: 'e', slug: 's' }).mockResolvedValueOnce({ kind: 'ineligible', reason: 'x' })
    const rep = await runEviteSendsTick(db.supabase, { now: NOW })
    expect(rep.backfill).toMatchObject({ exists: 1, ineligible: 1, created: 0 })
  })
})
