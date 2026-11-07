import { etDateString, shiftEtDate } from '@/lib/partyTime'

/**
 * The numbers on the crew-management Dashboard, worked out from rows already read.
 * Pure: no database, no clock (callers pass `today`), so every figure can be
 * pinned by a test.
 *
 * Where each number comes from, because a dashboard that does not say is a
 * dashboard nobody trusts:
 *
 *   YTD gross sales   the books ledger (`financial_transactions`) for the year, which
 *                     already holds the last bookkeeping session's imports AND every
 *                     Stripe / cash / hand-entered payment since (lib/ledgerCapture,
 *                     lib/financialLedger). Gross = money in (the positive rows);
 *                     refunds are shown beside it, not netted into it. Fundraiser
 *                     orders live in their own table and are never in the ledger,
 *                     so they are not in this.
 *   Backlog           what future booked parties are worth: total, already collected,
 *                     still to collect.
 *   Bookings made     a party counts on the day its FIRST payment landed (the day it
 *                     became a booking), or the day it was created when there is no
 *                     payment row. Each window is compared with the one before it.
 *   Leads             new inquiries per week (every booking row starts as one), and the
 *                     open ones (inquiry / quoted, not yet happened) with their quoted value.
 */

export interface LedgerRow {
  date: string
  amount_cents: number
  category: string | null
}

export interface BookedRow {
  partyType: string | null
  partyDate: string | null
  stage: string
  totalCents: number
  paidCents: number
  balanceCents: number
  /** ISO. When it became a booking: first payment, else created. */
  bookedAt: string | null
}

export interface EventSummaryRow {
  id: string
  title: string
  date: string
  capacity: number | null
  signups: number
  revenueCents: number
}

export interface LeadStampRow {
  createdAt: string
}

export interface OpenLead {
  totalCents: number | null
}

const addDays = (d: string, n: number) => shiftEtDate(d, n)
const dayOf = (iso: string) => etDateString(new Date(iso))

/** Days from a to b, inclusive of both ends. */
function spanDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000) + 1
}

/** The Sunday on or before a date. */
export function sundayOf(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay()
  return addDays(date, -dow)
}

/* ── YTD gross ───────────────────────────────────────────────────────────── */

export type SalesGroup = 'Parties' | 'Mobile parties' | 'Room rentals' | 'Events' | 'Other sales'

const GROUP_OF: Record<string, SalesGroup> = {
  'Party Booking': 'Parties',
  Deposit: 'Parties',
  'Mobile Party': 'Mobile parties',
  'Room Rental': 'Room rentals',
  'Event Ticket': 'Events',
}
export const SALES_GROUPS: SalesGroup[] = ['Parties', 'Mobile parties', 'Room rentals', 'Events', 'Other sales']

export function ytdSales(rows: LedgerRow[], today: string) {
  const year = today.slice(0, 4)
  const byGroup = new Map<SalesGroup, number>(SALES_GROUPS.map(g => [g, 0]))
  let gross = 0
  let refunds = 0
  let lastRowDate: string | null = null
  for (const r of rows) {
    if (!r.date || r.date.slice(0, 4) !== year || r.date > today) continue
    const c = Number(r.amount_cents) || 0
    if (!lastRowDate || r.date > lastRowDate) lastRowDate = r.date
    if (c < 0) {
      refunds += -c
      continue
    }
    gross += c
    const g = GROUP_OF[r.category ?? ''] ?? 'Other sales'
    byGroup.set(g, (byGroup.get(g) ?? 0) + c)
  }
  return {
    year: Number(year),
    grossCents: gross,
    refundsCents: refunds,
    netCents: gross - refunds,
    byGroup: SALES_GROUPS.map(g => ({ group: g, cents: byGroup.get(g) ?? 0 })),
    /** The newest ledger row counted; says how fresh the books are. */
    throughDate: lastRowDate,
  }
}

/* ── Gross sales by period: year, quarter, month to date ─────────────────── */

export type SalesPeriodKey = 'ytd' | 'qtd' | 'mtd'

export interface SalesComparison {
  /** "Last quarter", "Same quarter last year". */
  label: string
  /** "Q3 2026", "November 2025". */
  title: string
  start: string
  /** The like-for-like end: the same number of days (or the same day of the month) into that period. */
  end: string
  /** The last day of that whole period. */
  fullEnd: string
  /** Gross over start..end, the figure the current period is held against. null when the books do not reach back that far. */
  grossCents: number | null
  /** Gross over the WHOLE of that period, for reference. null when the books do not reach back that far. */
  fullGrossCents: number | null
  /** (current - grossCents) / grossCents, whole percent; null when there is nothing to divide by. */
  changePct: number | null
}

export interface SalesPeriod {
  key: SalesPeriodKey
  /** "Year", "Quarter", "Month": the button. */
  button: string
  /** "2026 to date", "Q4 2026 to date", "November 2026 to date". */
  title: string
  start: string
  end: string
  grossCents: number
  refundsCents: number
  netCents: number
  byGroup: { group: SalesGroup; cents: number }[]
  comparisons: SalesComparison[]
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
/** A date in a month, held to that month's last day (Feb 29 asked of a common year is Feb 28). */
const clampDay = (y: number, m: number, d: number) => ymd(y, m, Math.min(d, daysIn(y, m)))
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function totalsBetween(rows: LedgerRow[], start: string, end: string) {
  const byGroup = new Map<SalesGroup, number>(SALES_GROUPS.map(g => [g, 0]))
  let gross = 0
  let refunds = 0
  for (const r of rows) {
    if (!r.date || r.date < start || r.date > end) continue
    const c = Number(r.amount_cents) || 0
    if (c < 0) {
      refunds += -c
      continue
    }
    gross += c
    const g = GROUP_OF[r.category ?? ''] ?? 'Other sales'
    byGroup.set(g, (byGroup.get(g) ?? 0) + c)
  }
  return { gross, refunds, byGroup: SALES_GROUPS.map(g => ({ group: g, cents: byGroup.get(g) ?? 0 })) }
}

/**
 * Gross sales for the year, quarter and month to date, each held against the same stretch of the
 * periods before it (the same number of days in, so a half-finished quarter is never compared with
 * a whole one) with the whole earlier period beside it for reference:
 *
 *   year     vs the same point last year
 *   quarter  vs the previous quarter, and vs the same quarter last year
 *   month    vs last month, and vs the same month last year
 *
 * A comparison that starts before the books do is `null`, never a zero that reads as "we sold nothing".
 * Refunds are never netted into gross, as in `ytdSales`.
 */
export function salesPeriods(rows: LedgerRow[], today: string): SalesPeriod[] {
  const [y, m, d] = today.split('-').map(Number)
  const dates = rows.map(r => r.date).filter(Boolean).sort()
  // The books are usable from the first of the month their first row falls in.
  const booksFrom = dates.length ? `${dates[0].slice(0, 7)}-01` : null

  const compare = (label: string, title: string, start: string, end: string, fullEnd: string, current: number): SalesComparison => {
    const covered = booksFrom !== null && start >= booksFrom
    const gross = covered ? totalsBetween(rows, start, end).gross : null
    return {
      label, title, start, end, fullEnd,
      grossCents: gross,
      fullGrossCents: covered ? totalsBetween(rows, start, fullEnd).gross : null,
      changePct: gross !== null && gross > 0 ? Math.round(((current - gross) / gross) * 100) : null,
    }
  }

  const make = (
    key: SalesPeriodKey, button: string, title: string, start: string,
    prior: (current: number) => SalesComparison[],
  ): SalesPeriod => {
    const t = totalsBetween(rows, start, today)
    return {
      key, button, title, start, end: today,
      grossCents: t.gross, refundsCents: t.refunds, netCents: t.gross - t.refunds, byGroup: t.byGroup,
      comparisons: prior(t.gross),
    }
  }

  // Quarter: the 1st of its first month, and how many days of it have gone.
  const q0 = Math.floor((m - 1) / 3)
  const qm = 3 * q0 + 1
  const qStart = ymd(y, qm, 1)
  const qElapsed = spanDays(qStart, today)
  const quarterFrom = (qy: number, qmonth: number, label: string, current: number) => {
    const s = ymd(qy, qmonth, 1)
    const full = ymd(qy, qmonth + 2, daysIn(qy, qmonth + 2))
    const like = addDays(s, qElapsed - 1)
    return compare(label, `Q${Math.floor((qmonth - 1) / 3) + 1} ${qy}`, s, like < full ? like : full, full, current)
  }

  const monthFrom = (my: number, mm: number, label: string, current: number) =>
    compare(label, `${MONTHS[mm - 1]} ${my}`, ymd(my, mm, 1), clampDay(my, mm, d), ymd(my, mm, daysIn(my, mm)), current)

  return [
    make('ytd', 'Year', `${y} to date`, ymd(y, 1, 1), cur => [
      compare('Same point last year', `${y - 1}`, ymd(y - 1, 1, 1), clampDay(y - 1, m, d), ymd(y - 1, 12, 31), cur),
    ]),
    make('qtd', 'Quarter', `Q${q0 + 1} ${y} to date`, qStart, cur => [
      quarterFrom(q0 === 0 ? y - 1 : y, q0 === 0 ? 10 : qm - 3, 'Last quarter', cur),
      quarterFrom(y - 1, qm, 'Same quarter last year', cur),
    ]),
    make('mtd', 'Month', `${MONTHS[m - 1]} ${y} to date`, ymd(y, m, 1), cur => [
      monthFrom(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1, 'Last month', cur),
      monthFrom(y - 1, m, 'Same month last year', cur),
    ]),
  ]
}

/* ── Backlog and what is booked ahead ────────────────────────────────────── */

const TYPE_ORDER = ['in_studio_theme', 'mobile_party', 'studio_rental'] as const
export const TYPE_LABEL: Record<string, string> = {
  in_studio_theme: 'In-studio parties',
  mobile_party: 'Mobile parties',
  studio_rental: 'Room rentals',
  other: 'Other',
}

const isFutureBooked = (b: BookedRow, today: string) => b.stage === 'booked' && !!b.partyDate && b.partyDate >= today

export function backlog(booked: BookedRow[], today: string) {
  const ahead = booked.filter(b => isFutureBooked(b, today))
  const sum = (f: (b: BookedRow) => number) => ahead.reduce((s, b) => s + f(b), 0)
  const byType = [...TYPE_ORDER, 'other'].map(t => {
    const rows = ahead.filter(b => (TYPE_ORDER as readonly string[]).includes(b.partyType ?? '') ? b.partyType === t : t === 'other')
    return { type: t, label: TYPE_LABEL[t], count: rows.length, totalCents: rows.reduce((s, b) => s + b.totalCents, 0) }
  })
  return {
    count: ahead.length,
    totalCents: sum(b => b.totalCents),
    collectedCents: sum(b => b.paidCents),
    toCollectCents: sum(b => b.balanceCents),
    byType: byType.filter(t => t.type !== 'other' || t.count > 0),
  }
}

/* ── Bookings made, by window ────────────────────────────────────────────── */

interface Window {
  key: 'week' | 'month' | 'last30' | 'last60'
  label: string
  start: string
  end: string
  priorStart: string
  priorEnd: string
}

export function bookingWindows(today: string): Window[] {
  const weekStart = sundayOf(today)
  const [y, m] = today.split('-').map(Number)
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`
  const prevMonthStart = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`
  const mk = (key: Window['key'], label: string, start: string, priorStart: string): Window => {
    const len = spanDays(start, today)
    // A shorter prior month (Feb against a 31st) stops at its own last day.
    const sameLength = addDays(priorStart, len - 1)
    const lastOfPriorMonth = key === 'month' ? addDays(monthStart, -1) : sameLength
    return { key, label, start, end: today, priorStart, priorEnd: sameLength < lastOfPriorMonth ? sameLength : lastOfPriorMonth }
  }
  return [
    mk('week', 'This week', weekStart, addDays(weekStart, -7)),
    mk('month', 'This month', monthStart, prevMonthStart),
    mk('last30', 'Last 30 days', addDays(today, -29), addDays(today, -59)),
    mk('last60', 'Last 60 days', addDays(today, -59), addDays(today, -119)),
  ]
}

export function bookingsMade(booked: BookedRow[], today: string) {
  const made = booked
    .filter(b => b.stage === 'booked' || b.stage === 'completed')
    .map(b => ({ day: b.bookedAt ? dayOf(b.bookedAt) : null, cents: b.totalCents }))
    .filter((b): b is { day: string; cents: number } => !!b.day)
  const within = (start: string, end: string) => {
    const rows = made.filter(b => b.day >= start && b.day <= end)
    return { count: rows.length, cents: rows.reduce((s, b) => s + b.cents, 0) }
  }
  return bookingWindows(today).map(w => {
    const now = within(w.start, w.end)
    const before = within(w.priorStart, w.priorEnd)
    return { key: w.key, label: w.label, ...now, prior: before }
  })
}

/* ── Leads ───────────────────────────────────────────────────────────────── */

export const VELOCITY_WEEKS = 12

export function leadVelocity(leads: LeadStampRow[], today: string) {
  const thisWeek = sundayOf(today)
  const starts = Array.from({ length: VELOCITY_WEEKS }, (_, i) => addDays(thisWeek, -7 * (VELOCITY_WEEKS - 1 - i)))
  const days = leads.map(l => dayOf(l.createdAt))
  const series = starts.map((start, i) => {
    const end = i === starts.length - 1 ? today : addDays(start, 6)
    return { weekStart: start, count: days.filter(d => d >= start && d <= end).length, partial: i === starts.length - 1 }
  })
  const complete = series.filter(s => !s.partial)
  const avg = (rows: typeof complete) => (rows.length ? rows.reduce((s, r) => s + r.count, 0) / rows.length : 0)
  const recent = avg(complete.slice(-4))
  const earlier = avg(complete.slice(-8, -4))
  const change = earlier > 0 ? (recent - earlier) / earlier : recent > 0 ? 1 : 0
  const [y, m] = today.split('-').map(Number)
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`
  const prevMonthStart = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`
  const elapsed = spanDays(monthStart, today)
  const inRange = (a: string, b: string) => days.filter(d => d >= a && d <= b).length
  return {
    series,
    thisWeek: series[series.length - 1]?.count ?? 0,
    lastWeek: complete[complete.length - 1]?.count ?? 0,
    thisMonth: inRange(monthStart, today),
    lastMonthSamePoint: inRange(prevMonthStart, addDays(prevMonthStart, elapsed - 1)),
    perWeekRecent: Math.round(recent * 10) / 10,
    perWeekEarlier: Math.round(earlier * 10) / 10,
    changePct: Math.round(change * 100),
    trend: change > 0.1 ? ('up' as const) : change < -0.1 ? ('down' as const) : ('flat' as const),
  }
}

export function openLeads(leads: OpenLead[]) {
  const priced = leads.filter(l => (l.totalCents ?? 0) > 0)
  return {
    count: leads.length,
    valueCents: priced.reduce((s, l) => s + (l.totalCents ?? 0), 0),
    unpriced: leads.length - priced.length,
  }
}

/* ── Events ──────────────────────────────────────────────────────────────── */

export function upcomingEvents(events: EventSummaryRow[], today: string, limit = 8) {
  const ahead = events.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  return {
    count: ahead.length,
    signups: ahead.reduce((s, e) => s + e.signups, 0),
    revenueCents: ahead.reduce((s, e) => s + e.revenueCents, 0),
    events: ahead.slice(0, limit),
  }
}
