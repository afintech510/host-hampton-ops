/**
 * Party date/time parsing and Eastern↔UTC conversion.
 *
 * Lives in its own module (rather than in lib/reminders.ts, which re-exports it
 * for existing callers) so that both the reminder scheduler and the check-in
 * scheduler can share ONE time-parsing path without importing each other.
 */

/** Parse "7:00 PM" or "19:00" into hours/minutes */
export function parseTime(timeStr: string): { hours: number; minutes: number } | null {
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i)
  if (!match) return null
  let hours = parseInt(match[1])
  const minutes = parseInt(match[2])
  const period = match[3]?.toUpperCase()
  if (period === 'PM' && hours < 12) hours += 12
  if (period === 'AM' && hours === 12) hours = 0
  return { hours, minutes }
}

/** Every party this business runs is on Long Island. */
export const PARTY_TZ = 'America/New_York'

/**
 * How far ahead of UTC the given instant is in PARTY_TZ, in ms.
 * Negative for Eastern (-4h in EDT, -5h in EST).
 */
function tzOffsetMs(instant: Date): number {
  // en-CA gives ISO-ish parts which are trivial to re-assemble.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PARTY_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(instant)

  const get = (t: string) => Number(parts.find(p => p.type === t)?.value)
  // Some ICU versions render midnight as hour 24; normalize it.
  const hour = get('hour') % 24

  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'))
  return asIfUtc - instant.getTime()
}

/**
 * Convert an Eastern wall-clock date + time to the correct UTC instant.
 *
 * This exists because the server runs in UTC (see lib/googleCalendar.ts), so
 * the `new Date(date + 'T12:00:00')` + `setHours()` pattern used elsewhere
 * silently schedules in UTC — "6am" would land at 2am Eastern. Anything that
 * must fire at a specific LOCAL time has to go through here.
 *
 * DST-safe: the offset is resolved at the target instant rather than at "now",
 * and applied twice so a time near a DST boundary converges on the right one.
 */
export function etToUtc(dateStr: string, hours: number, minutes = 0): Date {
  const year = Number(dateStr.slice(0, 4))
  const month = Number(dateStr.slice(5, 7))
  const day = Number(dateStr.slice(8, 10))
  if (!year || !month || !day) return new Date(NaN)

  // Start by pretending the wall clock is UTC, then subtract the real offset.
  const guess = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0))
  let result = new Date(guess.getTime() - tzOffsetMs(guess))
  // Re-resolve once: if the first guess landed on the other side of a DST
  // change, the offset it used was the wrong one.
  result = new Date(guess.getTime() - tzOffsetMs(result))
  return result
}
