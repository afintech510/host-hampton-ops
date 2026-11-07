import { TENANT } from '@/tenant'

/**
 * Every time the Manager assistant shows is New York time on a 12-hour clock.
 *
 * Done in the TOOLS, not left to the model: Quo returns text timestamps in UTC,
 * and a model handed `2026-11-05T20:42:00Z` will print it as it is. So a tool never
 * returns a raw timestamp for the model to convert - it returns "Nov 5, 3:42 PM".
 * The zone is the tenant's (`TENANT.location.timeZone`), the format is fixed.
 */

const ZONE = TENANT.location.timeZone

/** "Nov 5, 3:42 PM" (adds the year when it is not this year). Unparseable input comes back unchanged. */
export function etDateTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  const year = (x: Date) => new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric' }).format(x)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    month: 'short',
    day: 'numeric',
    ...(year(d) === year(now) ? {} : { year: 'numeric' as const }),
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d)
}

/** A wall-clock `HH:mm` (a party's start time, which is already New York time) as "2:00 PM". Anything else is returned unchanged. */
export function clock12(hhmm: string | null | undefined): string | null {
  if (hhmm == null || hhmm === '') return null
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(hhmm).trim())
  if (!m) return String(hhmm)
  const h = Number(m[1])
  if (h > 23) return String(hhmm)
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`
}
