/**
 * The month / week drill-down the Bookings and Leads screens filter by.
 *
 * Three months are offered (this one and the next two). A month is cut into its
 * calendar weeks, Sunday to Saturday, clipped to the month, and numbered from 1:
 * week 1 runs from the 1st to the first Saturday. Everything is a plain
 * `YYYY-MM-DD` string compared as text, so no time zone can move a party to the
 * wrong week.
 */

export interface WeekRange {
  /** 1-based, in the order the weeks fall in the month. */
  n: number
  /** First day, inclusive. */
  start: string
  /** Last day, inclusive. */
  end: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

/** `2026-11` for a `YYYY-MM-DD` (or already a month key). */
export function monthKeyOf(date: string): string {
  return date.slice(0, 7)
}

/** The month keys on offer, starting with today's: ['2026-11', '2026-12', '2027-01']. */
export function monthKeys(today: string, count = 3): string[] {
  const [y, m] = today.split('-').map(Number)
  return Array.from({ length: count }, (_, i) => {
    const idx = (m - 1) + i
    return `${y + Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`
  })
}

export function daysInMonth(key: string): number {
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** The weeks of a month, Sunday-start, clipped to the month. */
export function weeksOfMonth(key: string): WeekRange[] {
  const [y, m] = key.split('-').map(Number)
  const last = daysInMonth(key)
  const weeks: WeekRange[] = []
  let day = 1
  while (day <= last) {
    const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay() // 0 = Sunday
    const end = Math.min(last, day + (6 - dow))
    weeks.push({ n: weeks.length + 1, start: ymd(y, m, day), end: ymd(y, m, end) })
    day = end + 1
  }
  return weeks
}

/** Which week of its month a date falls in (1-based). */
export function weekNumberOf(date: string): number {
  const w = weeksOfMonth(monthKeyOf(date)).find(r => date >= r.start && date <= r.end)
  return w ? w.n : 1
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function monthShort(key: string): string {
  return MONTHS[Number(key.split('-')[1]) - 1] ?? key
}

/** "Nov 1-7", or "Nov 29 - Dec 5" never happens because weeks are clipped to the month. */
export function weekCaption(w: WeekRange): string {
  const [, m, d1] = w.start.split('-').map(Number)
  const d2 = Number(w.end.split('-')[2])
  return d1 === d2 ? `${MONTHS[m - 1]} ${d1}` : `${MONTHS[m - 1]} ${d1}-${d2}`
}

export interface DateFilter {
  /** `2026-11`, or 'none' for rows with no date at all. */
  month: string
  /** Week number within the month, or null for the whole month. */
  week: number | null
}

/** Does a date pass the month / week filter? A missing date passes only the 'none' month. */
export function passesDateFilter(date: string | null | undefined, f: DateFilter): boolean {
  if (!date) return f.month === 'none'
  if (f.month === 'none') return false
  if (monthKeyOf(date) !== f.month) return false
  if (f.week === null) return true
  const w = weeksOfMonth(f.month).find(r => r.n === f.week)
  return !!w && date >= w.start && date <= w.end
}

export type WeekendKey = 'sat' | 'sun'

const WEEKEND_DOW: Record<WeekendKey, number> = { sun: 0, sat: 6 }

/** 0 = Sunday … 6 = Saturday, read off the plain date so no time zone can move it. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** The day of the month: 7 for `2026-11-07`. */
export function dayOfMonth(date: string): number {
  return Number(date.split('-')[2])
}

/** Does a date fall on a lit weekend day? None lit = every day passes; a missing date fails once one is lit. */
export function passesWeekend(date: string | null | undefined, lit: WeekendKey[]): boolean {
  if (lit.length === 0) return true
  if (!date) return false
  return lit.some(k => WEEKEND_DOW[k] === weekdayOf(date))
}

/** "Sat Nov 7": the tooltip on a date button. */
export function dayCaption(date: string): string {
  const [, m] = date.split('-').map(Number)
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekdayOf(date)]} ${MONTHS[m - 1]} ${dayOfMonth(date)}`
}

/** How many dates fall on each day, for the dates that have at least one; sorted by the caller's keys. */
export function countByDate(dates: Array<string | null | undefined>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const d of dates) if (d) out[d] = (out[d] ?? 0) + 1
  return out
}
