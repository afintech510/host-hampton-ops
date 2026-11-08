/**
 * A month of studio availability, shaped for an AI assistant: which dates are
 * open for a party and at what start times.
 *
 * Pure. The input is the `GET /api/availability?month=…&bookingType=kids-party`
 * response — the same slots the website's booking calendar shows — and the
 * rule it keeps is the one `propose_booking` keeps (`dateIsOpen`): a date with
 * ANYTHING on the studio calendar is not offered, even when part of the day is
 * free, because a person decides whether two things fit in one day. Saying a
 * date is open and then refusing to book it is the failure this avoids.
 */

export interface AvailabilitySlot { start: string; end: string; status: 'open' | 'blocked' }
export interface AvailabilityResponse {
  blockedDates?: string[]
  configured?: boolean
  /** Set by the route when the calendar exists but could not be read. Nothing here may be read as open. */
  calendarFailed?: boolean
  slots?: Record<string, AvailabilitySlot[]>
  bookingType?: { slotDurationMin?: number }
}

export interface MonthAvailability {
  month: string
  open_dates: { date: string; weekday: string; start_times: string[] }[]
  booked_dates: string[]
  /** Dates in the month that are too close to book online (the planner needs notice). */
  too_soon_to_book_online: string[]
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function weekdayOf(date: string): string {
  return WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const toHhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** 24-hour "13:00" → "1:00 PM". */
export function twelveHour(hhmm: string): string {
  const m = toMin(hhmm)
  const h = Math.floor(m / 60)
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** Start times at which `partyMinutes` of back-to-back open slots fit. */
export function startTimes(slots: AvailabilitySlot[], partyMinutes: number): string[] {
  const open = slots.filter(s => s.status === 'open').map(s => ({ a: toMin(s.start), b: toMin(s.end) })).sort((x, y) => x.a - y.a)
  const out: string[] = []
  for (let i = 0; i < open.length; i++) {
    let end = open[i].b
    for (let j = i + 1; j < open.length && end - open[i].a < partyMinutes && open[j].a === end; j++) end = open[j].b
    if (end - open[i].a >= partyMinutes) out.push(toHhmm(open[i].a))
  }
  return out
}

export function summarizeMonth(month: string, res: AvailabilityResponse, today: string, partyMinutes = 120): MonthAvailability {
  const blocked = new Set((res.blockedDates ?? []).filter(d => d.startsWith(month)))
  const slots = res.slots ?? {}
  const [y, m] = month.split('-').map(Number)
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const out: MonthAvailability = { month, open_dates: [], booked_dates: [], too_soon_to_book_online: [] }
  for (let d = 1; d <= days; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`
    if (date <= today) continue
    if (blocked.has(date)) { out.booked_dates.push(date); continue }
    const day = slots[date]
    if (!day) { out.too_soon_to_book_online.push(date); continue }
    const starts = startTimes(day, partyMinutes)
    if (starts.length) out.open_dates.push({ date, weekday: weekdayOf(date), start_times: starts.map(twelveHour) })
    else out.booked_dates.push(date)
  }
  // A date with no slots AFTER the first bookable one is a day the studio does not take parties, not "too soon".
  const firstBookable = Object.keys(slots).sort()[0]
  if (firstBookable) out.too_soon_to_book_online = out.too_soon_to_book_online.filter(d => d < firstBookable)
  return out
}
