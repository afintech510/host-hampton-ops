/**
 * Quiet hours for outbound SMS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS. The TCPA permits telephone solicitations only between 8am and
 * 9pm in the RECIPIENT'S local time, and the CTIA's messaging principles apply
 * the same window to SMS. Nothing in this codebase enforced it. Two separate
 * paths could put a text outside the window:
 *
 *   1. `lib/reminders.ts` scheduled every reminder with `setHours()` on a UTC
 *      box, so `event_sms_1day` landed at 6am Eastern (5am in EST) and
 *      `booking_sms_1day` at 7am in EST. Fixed at the source — those now go
 *      through `etToUtc` — but a fix at the enqueue end only protects rows
 *      enqueued after the fix.
 *
 *   2. `/api/cron/event-reminders` enqueues `scheduled_for: nowIso`, i.e. "send
 *      immediately". Its send time is therefore whatever time of day that cron
 *      is scheduled at cron-job.org, which is a setting in a web console and not
 *      a thing this repository can see or test. Schedule it at 02:00 UTC — a
 *      perfectly reasonable-looking choice — and it texts ticket holders at 10pm
 *      Eastern the night before.
 *
 * So the check belongs at the SEND, where every path converges, and it is the
 * only place that can be sure. This is the same reasoning that put the consent
 * re-read at send time rather than enqueue time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT DO.
 *
 * A quiet-hours hit DEFERS; it never cancels. A "your party is tomorrow" text
 * held from 6am to 8am is still true at 8am — dropping it would turn a timing
 * bug into a missed reminder, and link 24's rule applies here directly: a
 * throttle that drops a real delivery is the same outage as a check that is too
 * strict. The deferral must also not consume the retry budget, because a row
 * queued at 2am would otherwise burn all four attempts before the window opens
 * and land in `failed` having never been tried. `finishReminder` therefore has a
 * `deferred` outcome that moves `scheduled_for` and leaves `attempts` alone.
 *
 * EMAIL IS NOT GATED. Quiet hours are a telephone rule; a 6am email is a
 * nuisance, not a violation, and holding mail would delay the balance-chase and
 * thank-you paths for no legal benefit.
 */

import { PARTY_TZ } from '@/lib/partyTime'

/** Texts may go out at or after this hour, local to the recipient. */
export const SMS_WINDOW_OPEN_HOUR = 8

/** Texts must stop before this hour, local to the recipient. */
export const SMS_WINDOW_CLOSE_HOUR = 21

/**
 * The hour (0–23) and minute an instant falls on in PARTY_TZ.
 *
 * Every customer this business texts is on Long Island — the bookings are for a
 * venue in Speonk NY and the mobile parties travel from it — so PARTY_TZ is the
 * recipient's local time, not an approximation of it. If that ever stops being
 * true the fix is a per-contact timezone, and this function is where it lands.
 */
export function etHourMinute(at: Date): { hour: number; minute: number } | null {
  if (!Number.isFinite(at.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PARTY_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value)
  // Some ICU versions render midnight as hour 24.
  const hour = get('hour') % 24
  const minute = get('minute')
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return { hour, minute }
}

export type QuietHoursVerdict =
  | { kind: 'open' }
  | { kind: 'quiet'; reason: string; until: Date }
  /**
   * The instant could not be read. Rule 12: this is not "the window is open".
   * The caller treats it as quiet — refusing to text at an hour we cannot
   * determine is the only safe direction.
   */
  | { kind: 'unreadable'; reason: string }

/**
 * May an SMS go out at `at`?
 *
 * `until` is the next instant the window opens, in UTC, and is what the caller
 * writes back to `scheduled_for`.
 */
export function checkSmsQuietHours(at: Date): QuietHoursVerdict {
  const hm = etHourMinute(at)
  if (!hm) {
    return { kind: 'unreadable', reason: `could not resolve "${String(at)}" to a local hour — not texting` }
  }

  if (hm.hour >= SMS_WINDOW_OPEN_HOUR && hm.hour < SMS_WINDOW_CLOSE_HOUR) {
    return { kind: 'open' }
  }

  const until = nextWindowOpen(at)
  const clock = `${String(hm.hour).padStart(2, '0')}:${String(hm.minute).padStart(2, '0')}`
  return {
    kind: 'quiet',
    reason:
      `quiet_hours: ${clock} local is outside the ${SMS_WINDOW_OPEN_HOUR}:00–${SMS_WINDOW_CLOSE_HOUR}:00 ` +
      `window texts are permitted in — held until ${until.toISOString()}`,
    until,
  }
}

/**
 * The next instant at which SMS_WINDOW_OPEN_HOUR local begins, at or after `at`.
 *
 * Walks forward in one-hour steps and re-resolves the local hour each time
 * rather than doing offset arithmetic, so it cannot be wrong across a DST
 * change — the case where an offset computed once is an hour out. Bounded at 48
 * steps so a pathological input terminates instead of spinning; two days is far
 * more than the eleven hours the widest gap (9pm → 8am) actually needs.
 */
export function nextWindowOpen(at: Date): Date {
  const cursor = new Date(at.getTime())
  for (let i = 0; i < 48; i++) {
    const hm = etHourMinute(cursor)
    if (hm && hm.hour === SMS_WINDOW_OPEN_HOUR) {
      // Land on the top of the hour rather than wherever the walk happened to
      // stop, so a deferral is not scheduled at 08:37 because that is when the
      // original row was due.
      return new Date(cursor.getTime() - hm.minute * 60_000 - (cursor.getSeconds() * 1000 + cursor.getMilliseconds()))
    }
    cursor.setTime(cursor.getTime() + 60 * 60 * 1000)
  }
  // Unreachable for any real date. Returning `at` means "send now" rather than
  // "never", which is the right failure direction for a message that is already
  // due — but it is also a bug, so it says so.
  console.error('quietHours: could not find the next 8am within 48 hours of', at.toISOString())
  return at
}
