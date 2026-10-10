import { freshenRender, makeSendDb, EVITE_ID, SLUG, type SendDb, type SendDbOptions } from './sendFixtures'
import { runEviteSendsTick, type TickReport } from '@/lib/evites/cronTick'

/**
 * Fixtures for the evite scheduler (P09b): the P09a send database (Mia's Glow party, Saturday 14 Nov 2026
 * at 2 PM ET, booked) with the columns the tick additionally reads (`bookings.updated_at`, `evites.updated_at`,
 * `evites.cal_inputs_hash`), and a clock that steps in 15-minute ticks.
 *
 * Eastern time in this window: DST ended Sunday 1 Nov 2026, so every instant from 1 Nov is UTC-5 (EST).
 *   week_before   Sat 7 Nov  10:00 ET = 15:00Z
 *   day_before    Fri 13 Nov 16:00 ET = 21:00Z      sendable until Fri 23:59 ET = Sat 14 Nov 04:59Z
 *   final_headcnt Fri 13 Nov 16:30 ET = 21:30Z
 *   party         Sat 14 Nov 14:00 ET = 19:00Z
 */

export { EVITE_ID, SLUG, freshenRender }
export const MIN = 60_000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR

type Row = Record<string, unknown>

export function cronDb(o: SendDbOptions = {}): SendDb {
  return makeSendDb({
    ...o,
    evite: { cal_inputs_hash: null, updated_at: '2026-10-01T12:05:00Z', ...o.evite },
    booking: { updated_at: '2026-10-01T12:00:00Z', ...o.booking },
  })
}

/** Every 15-minute tick in [from, to]. */
export function ticks(from: string, to: string, stepMs: number = 15 * MIN): Date[] {
  const out: Date[] = []
  for (let t = Date.parse(from); t <= Date.parse(to); t += stepMs) out.push(new Date(t))
  return out
}

/** The ledger rows of one send type, in claim order. */
export const rowsOf = (db: SendDb, type: string): Row[] => db.tables.evite_sends.filter((r) => r.send_type === type)

/** Stable summary of a ledger row for assertions: `<rsvp>:<ref_version>:<status>`. */
export const brief = (r: Row): string => `${String(r.rsvp_id ?? '-')}:${String(r.ref_version)}:${String(r.status)}`

/**
 * Run the scheduler over `times`. `before(now)` runs first at each tick: it is where a test changes the world
 * (an RSVP arrives, the date moves, the booking is cancelled) at an exact instant. Returns every report.
 */
export async function runTicks(db: SendDb, times: Date[], before?: (now: Date) => void): Promise<TickReport[]> {
  const reports: TickReport[] = []
  for (const now of times) {
    before?.(now)
    reports.push(await runEviteSendsTick(db.supabase, { now }))
  }
  return reports
}

/** A `renderEvite` stand-in that makes the stored render FRESH for the facts as they are at `clock.now`. */
export function fakeRenderer(db: () => SendDb, clock: { now: Date }) {
  return async () => {
    await freshenRender(db(), clock.now)
    return { kind: 'rendered', version: 1, inviteObject: 'invite-v1-9f2c.jpg', ogObject: 'og-v1-9f2c.jpg', inviteBytes: 1, ogBytes: 1, ms: 1 }
  }
}
