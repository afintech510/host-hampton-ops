/**
 * Keeps the Google Calendar in step with the bookings table.
 *
 * The calendar is not a log, it is the room's availability: `/api/availability`
 * blocks a planner slot only when Google Calendar has an event over it. So an
 * event for a party nobody paid for turns real customers away, and a booked
 * party with no event lets the planner sell its slot twice.
 *
 * Before this file there were seven writers (four in the webhook and plan
 * payment paths, three in the admin route), each with its own idea of when a
 * party belongs on the calendar, and NOTHING removed or moved an event. Measured
 * 2026-11-04 over upcoming events: cancelled and lost bookings still holding
 * their slot (HH-2026-9024 Natalie Intrieri, $0 paid, cancelled), a party moved
 * from 11-28 12:00 to 11-29 13:00 whose event never moved, duplicate events for
 * one booking, and five paid parties (deposits entered by hand, or via a Payment
 * Link) with no event at all.
 *
 * The rule, in one place: a booking is on the calendar exactly when
 * `bookingStage()` says it is BOOKED (money has landed, or a status only a
 * booked party carries) — the same definition the Booked tab uses. Approving a
 * quote does not hold the room; the deposit does. Past parties are never
 * touched, and an event is only ever recognised as a booking's by the
 * `Ref: <booking_ref>` line every writer puts in its description.
 */

import { getSupabase } from '@/lib/supabase'
import {
  addMinutes, createCalendarEvent, deleteCalendarEvent, etParts, getCalendarEvent,
  listCalendarEvents, to24hr, updateCalendarEvent, type ListedCalendarEvent,
} from '@/lib/googleCalendar'
import { bookingStage, etToday, type BookingStage } from '@/lib/bookingStatus'
import { sumPayments } from '@/lib/bookingBalance'
import { etToUtc } from '@/lib/partyTime'
import { DURATION_MINI_MIN, DURATION_THEME_MIN } from '@/lib/evites/partyWindow'

type Supa = ReturnType<typeof getSupabase>

export const CALENDAR_BOOKING_COLUMNS =
  'id, booking_ref, status, party_type, event_type, party_date, party_time, party_tags, contact_name, contact_email, package_type, guest_count_approx, child_name, google_calendar_event_id, quote_snapshot'

export interface CalendarBooking {
  id: string
  booking_ref: string
  status: string | null
  party_type: string | null
  event_type: string | null
  party_date: string | null
  party_time: string | null
  party_tags: Record<string, unknown> | null
  contact_name: string | null
  contact_email: string | null
  package_type: string | null
  guest_count_approx: number | null
  child_name: string | null
  google_calendar_event_id: string | null
  quote_snapshot: Record<string, unknown> | null
}

/** A calendar event reduced to what the sync compares. Times are Eastern. */
export interface BookingEvent {
  id: string
  ref: string | null
  date: string
  start: string
  end: string
  allDay: boolean
  summary: string
}

export interface PartyWindow { date: string; start: string; end: string }

/**
 * A party blocks two hours, a MINI party 90 minutes — the same flag and length
 * the invitation uses (`lib/evites/partyWindow.ts`), so the calendar and the
 * invite cannot disagree about when a mini ends. A studio rental blocks its
 * rented window. Mobile parties deliberately keep two hours here (travel), not
 * the invite's 90.
 */
const PARTY_MINUTES = DURATION_THEME_MIN

function partyMinutes(quoteSnapshot: Record<string, unknown> | null | undefined): number {
  return quoteSnapshot?.isMiniParty === true ? DURATION_MINI_MIN : PARTY_MINUTES
}

/** The booking ref named by an event's `Ref: …` description line, or null. */
export function refOf(description: string | null | undefined): string | null {
  const m = String(description ?? '').match(/^Ref:\s*(\S+)\s*$/m)
  return m ? m[1] : null
}

export function toBookingEvent(ev: ListedCalendarEvent): BookingEvent {
  const ref = refOf(ev.description)
  if (ev.start.date) {
    return { id: ev.id, ref, date: ev.start.date, start: '00:00', end: '23:59', allDay: true, summary: ev.summary || '' }
  }
  const s = etParts(ev.start.dateTime!)
  const e = etParts(ev.end.dateTime || ev.start.dateTime!)
  return { id: ev.id, ref, date: s.date, start: s.time, end: e.time, allDay: false, summary: ev.summary || '' }
}

/**
 * `party_time` is free text: `11:00`, `9:30`, `12:00 PM`, `Evening`, null. A
 * clock time comes back as zero-padded `HH:mm`; anything else is null, because
 * "Evening" cannot be put on a calendar and guessing would block a real slot.
 */
export function clockTime(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = to24hr(raw.trim()).match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

export function partyWindow(b: Pick<CalendarBooking, 'party_date' | 'party_time' | 'party_tags'> & Partial<Pick<CalendarBooking, 'quote_snapshot'>>): PartyWindow | null {
  if (!b.party_date || !/^\d{4}-\d{2}-\d{2}$/.test(b.party_date)) return null
  const tags = b.party_tags || {}
  const rs = clockTime(tags.rental_start_time)
  const re = clockTime(tags.rental_end_time)
  if (rs && re && re > rs) return { date: b.party_date, start: rs, end: re }
  const start = clockTime(b.party_time)
  if (!start) return null
  const end = addMinutes(start, partyMinutes(b.quote_snapshot))
  // A party that would run past midnight is clamped rather than wrapped.
  return { date: b.party_date, start, end: end > '23:59' ? '23:59' : end }
}

function isStudio(b: Pick<CalendarBooking, 'party_type' | 'event_type'>): boolean {
  return b.party_type === 'studio_rental' || b.event_type === 'studio-rental'
}

export function eventSummary(b: CalendarBooking): string {
  const name = (b.contact_name || '').trim() || 'Party'
  if (isStudio(b)) {
    const label = typeof b.party_tags?.event_label === 'string' ? b.party_tags.event_label : 'Event'
    return `[STUDIO RENTAL] ${name} — ${label}`
  }
  return `[PARTY] ${name} - ${b.package_type || 'Party'}`
}

export function eventDescription(b: CalendarBooking): string {
  return [
    `Ref: ${b.booking_ref}`,
    `Contact: ${(b.contact_name || '').trim()}${b.contact_email ? ` (${b.contact_email})` : ''}`,
    `Guests: ~${b.guest_count_approx ?? ''}`,
    ...(b.child_name ? [`Child: ${b.child_name}`] : []),
  ].join('\n')
}

function sameWindow(e: BookingEvent, w: PartyWindow): boolean {
  return !e.allDay && e.date === w.date && e.start === w.start && e.end === w.end
}

export type CalendarOp =
  | { kind: 'create'; window: PartyWindow; summary: string; description: string }
  | { kind: 'move'; eventId: string; from: PartyWindow; window: PartyWindow; summary: string; description: string }
  | { kind: 'delete'; eventId: string; from: PartyWindow; reason: string }

export interface BookingPlan {
  ref: string
  name: string
  stage: BookingStage
  ops: CalendarOp[]
  /** The event id the booking should store once the ops are applied. */
  keepId: string | null
  /** Why nothing could be done, when something should have been. */
  note?: string
}

const fromOf = (e: BookingEvent): PartyWindow => ({ date: e.date, start: e.start, end: e.end })

/**
 * What to do to the calendar for one booking. Pure: `events` must already be
 * this booking's UPCOMING events (Ref matched, ending today or later).
 */
export function planBookingCalendar(
  b: CalendarBooking,
  paidCents: number,
  events: BookingEvent[],
  today: string,
): BookingPlan {
  const stage = bookingStage({ status: b.status, paidCents, partyDate: b.party_date, today })
  const base = { ref: b.booking_ref, name: (b.contact_name || '').trim(), stage }

  // A party that has happened is history; its event is left exactly as it is.
  if (stage === 'completed') return { ...base, ops: [], keepId: b.google_calendar_event_id }

  if (stage !== 'booked') {
    const reason = stage === 'cancelled' ? 'cancelled' : stage === 'lost' ? 'marked lost' : 'nothing paid yet'
    return { ...base, ops: events.map(e => ({ kind: 'delete' as const, eventId: e.id, from: fromOf(e), reason })), keepId: null }
  }

  const window = partyWindow(b)
  if (!window) {
    return {
      ...base, ops: [], keepId: b.google_calendar_event_id,
      note: `booked, but date/time "${b.party_date ?? ''} ${b.party_time ?? ''}" cannot be placed on the calendar — left as is`,
    }
  }

  const summary = eventSummary(b)
  const description = eventDescription(b)
  const keeper =
    events.find(e => e.id === b.google_calendar_event_id) ||
    events.find(e => sameWindow(e, window)) ||
    events[0]

  const ops: CalendarOp[] = []
  if (!keeper) ops.push({ kind: 'create', window, summary, description })
  else if (!sameWindow(keeper, window)) ops.push({ kind: 'move', eventId: keeper.id, from: fromOf(keeper), window, summary, description })
  for (const e of events) {
    if (keeper && e.id !== keeper.id) ops.push({ kind: 'delete', eventId: e.id, from: fromOf(e), reason: 'duplicate' })
  }
  return { ...base, ops, keepId: keeper?.id ?? null }
}

export interface ApplyResult { applied: number; errors: string[] }

/** Carry out a plan, then store the surviving event id on the booking. */
export async function applyBookingPlan(supabase: Supa, b: CalendarBooking, plan: BookingPlan): Promise<ApplyResult> {
  const errors: string[] = []
  let applied = 0
  let keepId = plan.keepId

  for (const op of plan.ops) {
    try {
      if (op.kind === 'create') {
        const id = await createCalendarEvent({
          summary: op.summary, startDate: op.window.date, startTime: op.window.start, endTime: op.window.end, description: op.description,
        })
        if (id) { keepId = id; applied++ } else errors.push(`${plan.ref}: create failed`)
      } else if (op.kind === 'move') {
        const ok = await updateCalendarEvent(op.eventId, {
          startDate: op.window.date, startTime: op.window.start, endTime: op.window.end, summary: op.summary, description: op.description,
        })
        if (ok) applied++; else errors.push(`${plan.ref}: move of ${op.eventId} failed`)
      } else {
        const ok = await deleteCalendarEvent(op.eventId)
        if (ok) applied++; else errors.push(`${plan.ref}: delete of ${op.eventId} failed`)
      }
    } catch (err) {
      errors.push(`${plan.ref}: ${op.kind} threw: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Only clear a stored id when every delete went through; a half-applied plan
  // keeps the id so the next run still knows which event is this booking's.
  const nextId = errors.length && keepId === null ? b.google_calendar_event_id : keepId
  if (nextId !== b.google_calendar_event_id) {
    const { error } = await supabase.from('bookings').update({ google_calendar_event_id: nextId }).eq('id', b.id)
    if (error) errors.push(`${plan.ref}: event id not stored (${error.message})`)
  }
  return { applied, errors }
}

/** Start of today, Eastern, as an ISO instant — the "upcoming" boundary. */
function upcomingFrom(today: string): string {
  return etToUtc(today, 0).toISOString()
}

async function paidByBooking(supabase: Supa, ids: string[]): Promise<{ ok: true; paid: Map<string, number> } | { ok: false; error: string }> {
  const rows: { booking_id: string; amount_cents: number | null; payment_type: string | null }[] = []
  // PostgREST refuses an `.in()` past ~390 uuids; one failed batch fails the read.
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from('booking_payments')
      .select('booking_id, amount_cents, payment_type')
      .in('booking_id', ids.slice(i, i + 200))
    if (error) return { ok: false, error: error.message }
    rows.push(...((data || []) as typeof rows))
  }
  const byId = new Map<string, typeof rows>()
  for (const r of rows) byId.set(r.booking_id, [...(byId.get(r.booking_id) || []), r])
  const paid = new Map<string, number>()
  for (const id of ids) paid.set(id, sumPayments(byId.get(id)))
  return { ok: true, paid }
}

export type SyncOutcome =
  | { ok: true; plan: BookingPlan; applied: number; errors: string[] }
  | { ok: false; error: string }

/**
 * Bring ONE booking's calendar event in line with it. Never throws; called after
 * every admin change that can move a party on or off the calendar.
 */
export async function syncBookingCalendar(supabase: Supa, bookingId: string, today: string = etToday()): Promise<SyncOutcome> {
  try {
    const { data: b, error } = await supabase.from('bookings').select(CALENDAR_BOOKING_COLUMNS).eq('id', bookingId).maybeSingle()
    if (error) return { ok: false, error: `booking unreadable: ${error.message}` }
    if (!b) return { ok: false, error: 'booking not found' }
    const booking = b as unknown as CalendarBooking

    const paid = await paidByBooking(supabase, [booking.id])
    if (!paid.ok) return { ok: false, error: `payments unreadable: ${paid.error}` }

    const from = upcomingFrom(today)
    const listed = await listCalendarEvents({ timeMin: from, q: booking.booking_ref })
    if (!listed.ok) return { ok: false, error: listed.error }
    const events = listed.events.map(toBookingEvent).filter(e => e.ref === booking.booking_ref)

    // Search indexing can lag a just-created event; the stored id cannot.
    const stored = booking.google_calendar_event_id
    if (stored && !events.some(e => e.id === stored)) {
      const got = await getCalendarEvent(stored)
      if (!got.ok) return { ok: false, error: got.error }
      const ev = got.event && toBookingEvent(got.event)
      if (ev && ev.date >= today && (ev.ref === null || ev.ref === booking.booking_ref)) events.push(ev)
    }

    const plan = planBookingCalendar(booking, paid.paid.get(booking.id) || 0, events, today)
    const result = await applyBookingPlan(supabase, booking, plan)
    if (result.errors.length) console.error(`calendarSync ${booking.booking_ref}:`, result.errors.join('; '))
    return { ok: true, plan, ...result }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Delete every upcoming event naming `ref` — for a booking being hard-deleted. */
export async function clearBookingCalendar(
  ref: string, storedId: string | null, today: string = etToday(),
): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  try {
    const listed = await listCalendarEvents({ timeMin: upcomingFrom(today), q: ref })
    if (!listed.ok) return { ok: false, error: listed.error }
    const ids = new Set(listed.events.map(toBookingEvent).filter(e => e.ref === ref).map(e => e.id))
    if (storedId) ids.add(storedId)
    let deleted = 0
    for (const id of Array.from(ids)) if (await deleteCalendarEvent(id)) deleted++
    return deleted === ids.size ? { ok: true, deleted } : { ok: false, error: `${ids.size - deleted} of ${ids.size} not deleted` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface ReconcileReport {
  ok: boolean
  dryRun: boolean
  today: string
  bookingsChecked: number
  eventsChecked: number
  changes: { ref: string; name: string; stage: BookingStage; ops: CalendarOp[] }[]
  notes: string[]
  /** Upcoming events naming a ref no booking has. Reported, never deleted. */
  orphanEvents: { ref: string; eventId: string; date: string; start: string; summary: string }[]
  applied: number
  errors: string[]
}

/** Every upcoming booking and every upcoming event, compared in one pass. */
export async function reconcileCalendar(supabase: Supa, opts: { dryRun: boolean; today?: string }): Promise<ReconcileReport> {
  const today = opts.today ?? etToday()
  const report: ReconcileReport = {
    ok: false, dryRun: opts.dryRun, today, bookingsChecked: 0, eventsChecked: 0,
    changes: [], notes: [], orphanEvents: [], applied: 0, errors: [],
  }

  const listed = await listCalendarEvents({ timeMin: upcomingFrom(today) })
  if (!listed.ok) { report.errors.push(listed.error); return report }
  const events = listed.events.map(toBookingEvent).filter(e => e.ref)
  report.eventsChecked = events.length
  const byRef = new Map<string, BookingEvent[]>()
  for (const e of events) byRef.set(e.ref!, [...(byRef.get(e.ref!) || []), e])

  const { data: upcoming, error } = await supabase
    .from('bookings').select(CALENDAR_BOOKING_COLUMNS).gte('party_date', today)
  if (error) { report.errors.push(`bookings unreadable: ${error.message}`); return report }
  const bookings = new Map<string, CalendarBooking>()
  for (const b of (upcoming || []) as unknown as CalendarBooking[]) bookings.set(b.booking_ref, b)

  // Events can outlive their date: a party moved into the past, or undated.
  const missing = Array.from(byRef.keys()).filter(r => !bookings.has(r))
  for (let i = 0; i < missing.length; i += 200) {
    const { data, error: e2 } = await supabase
      .from('bookings').select(CALENDAR_BOOKING_COLUMNS).in('booking_ref', missing.slice(i, i + 200))
    if (e2) { report.errors.push(`bookings unreadable: ${e2.message}`); return report }
    for (const b of (data || []) as unknown as CalendarBooking[]) bookings.set(b.booking_ref, b)
  }

  const all = Array.from(bookings.values())
  const paid = await paidByBooking(supabase, all.map(b => b.id))
  if (!paid.ok) { report.errors.push(`payments unreadable: ${paid.error}`); return report }
  report.bookingsChecked = all.length

  for (const b of all) {
    const plan = planBookingCalendar(b, paid.paid.get(b.id) || 0, byRef.get(b.booking_ref) || [], today)
    if (plan.note) report.notes.push(`${plan.ref} (${plan.name}): ${plan.note}`)
    const idChanges = plan.keepId !== b.google_calendar_event_id && plan.stage !== 'completed'
    if (!plan.ops.length && !idChanges) continue
    if (plan.ops.length) report.changes.push({ ref: plan.ref, name: plan.name, stage: plan.stage, ops: plan.ops })
    if (!opts.dryRun) {
      const r = await applyBookingPlan(supabase, b, plan)
      report.applied += r.applied
      report.errors.push(...r.errors)
    }
  }

  for (const [ref, evs] of Array.from(byRef.entries())) {
    if (bookings.has(ref)) continue
    for (const e of evs) report.orphanEvents.push({ ref, eventId: e.id, date: e.date, start: e.start, summary: e.summary })
  }

  report.ok = report.errors.length === 0
  return report
}
