/**
 * The sort orders offered on the Leads and Bookings screens. Pure, so every order is pinned
 * by a test. A sort never drops a row, and it is stable: rows that tie keep a fixed
 * second order (Leads: most recent contact first; Bookings: soonest date first).
 */

export interface SortOption<K extends string> {
  key: K
  label: string
}

/* ── Leads ───────────────────────────────────────────────────────────────── */

export type LeadSortKey = 'contact_desc' | 'contact_asc' | 'event_asc' | 'event_desc' | 'value_desc' | 'value_asc'

export const LEAD_SORTS: SortOption<LeadSortKey>[] = [
  { key: 'contact_desc', label: 'Most recent contact' },
  { key: 'contact_asc', label: 'Oldest contact first' },
  { key: 'event_asc', label: 'Event date: earliest' },
  { key: 'event_desc', label: 'Event date: latest' },
  { key: 'value_desc', label: 'Value: high to low' },
  { key: 'value_asc', label: 'Value: low to high' },
]

interface LeadLike {
  lastContactAt: string
  partyDate: string | null
  totalCents: number | null
}

const valueOf = (cents: number | null | undefined) => (typeof cents === 'number' && cents > 0 ? cents : null)

/** Compare two nullable keys with the missing ones always LAST, whichever way the rest run. */
function nullsLast<T>(a: T | null, b: T | null, cmp: (x: T, y: T) => number): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return cmp(a, b)
}

export function sortLeads<T extends LeadLike>(leads: readonly T[], key: LeadSortKey): T[] {
  const recent = (a: T, b: T) => b.lastContactAt.localeCompare(a.lastContactAt)
  const by: Record<LeadSortKey, (a: T, b: T) => number> = {
    contact_desc: recent,
    contact_asc: (a, b) => a.lastContactAt.localeCompare(b.lastContactAt),
    // Undated and unpriced leads go to the bottom either way: they are the ones with nothing to sort on.
    event_asc: (a, b) => nullsLast(a.partyDate, b.partyDate, (x, y) => x.localeCompare(y)) || recent(a, b),
    event_desc: (a, b) => nullsLast(a.partyDate, b.partyDate, (x, y) => y.localeCompare(x)) || recent(a, b),
    value_desc: (a, b) => nullsLast(valueOf(a.totalCents), valueOf(b.totalCents), (x, y) => y - x) || recent(a, b),
    value_asc: (a, b) => nullsLast(valueOf(a.totalCents), valueOf(b.totalCents), (x, y) => x - y) || recent(a, b),
  }
  return [...leads].sort(by[key])
}

/* ── Bookings ────────────────────────────────────────────────────────────── */

export type BookingSortKey = 'date_asc' | 'date_desc' | 'value_desc' | 'value_asc'

export const BOOKING_SORTS: SortOption<BookingSortKey>[] = [
  { key: 'date_asc', label: 'Date: soonest first' },
  { key: 'date_desc', label: 'Date: latest first' },
  { key: 'value_desc', label: 'Value: high to low' },
  { key: 'value_asc', label: 'Value: low to high' },
]

interface BookingLike {
  partyDate: string | null
  partyTime: string | null
  totalCents: number
  ref: string
}

export function sortBookings<T extends BookingLike>(rows: readonly T[], key: BookingSortKey): T[] {
  const soonest = (a: T, b: T) =>
    nullsLast(a.partyDate, b.partyDate, (x, y) => x.localeCompare(y)) || `${a.partyTime ?? ''}`.localeCompare(`${b.partyTime ?? ''}`) || a.ref.localeCompare(b.ref)
  const by: Record<BookingSortKey, (a: T, b: T) => number> = {
    date_asc: soonest,
    date_desc: (a, b) => nullsLast(a.partyDate, b.partyDate, (x, y) => y.localeCompare(x)) || `${b.partyTime ?? ''}`.localeCompare(`${a.partyTime ?? ''}`) || a.ref.localeCompare(b.ref),
    value_desc: (a, b) => b.totalCents - a.totalCents || soonest(a, b),
    value_asc: (a, b) => a.totalCents - b.totalCents || soonest(a, b),
  }
  return [...rows].sort(by[key])
}
