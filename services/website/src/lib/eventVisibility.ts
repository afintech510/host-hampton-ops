import { etToday } from '@/lib/bookingStatus'

/**
 * Whether a public surface may show an event.
 *
 * `events.is_active` was the only gate, and the only thing that ever flipped it
 * after the date was a side effect inside `/api/cron/draft-newsletter`. When that
 * job stopped being called (last archive: 2026-07-18) finished events stayed
 * listed — Bitchy Bingo Halloween was still on /events two days after it ran.
 * A public listing must not depend on a scheduler to be true, so the date is
 * judged at READ time, in Eastern, and the cron's archive becomes housekeeping.
 *
 * - No `event_date`: kept (open-ended / date-coming-soon events).
 * - `has_sessions`: kept — the sessions list is itself filtered to upcoming
 *   dates, and the parent's `event_date` is only the first session's date.
 * - Otherwise listed through the whole of `event_date` (Eastern), so a 7pm event
 *   does not vanish at midnight UTC mid-afternoon.
 */
export function isEventListable(
  event: { event_date?: string | null; has_sessions?: boolean | null },
  today: string = etToday(),
): boolean {
  if (!event.event_date) return true
  if (event.has_sessions) return true
  // `YYYY-MM-DD` strings compare correctly as strings; screen the shape so a
  // truncated value is kept for a human to fix rather than judged as a date.
  if (!/^\d{4}-\d{2}-\d{2}/.test(event.event_date)) return true
  return event.event_date.slice(0, 10) >= today
}
