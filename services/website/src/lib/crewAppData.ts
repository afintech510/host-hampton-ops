import type { NextRequest } from 'next/server'
import type { getSupabase } from '@/lib/supabase'
import { GET as bookedGet, type BookedParty } from '@/app/api/admin/booked/route'
import { etDateString, shiftEtDate } from '@/lib/partyTime'
import { clock12 } from '@/lib/assistant/timeFormat'
import { monthKeys, daysInMonth } from '@/lib/bookingWeeks'
import {
  backlog, bookingsMade, leadVelocity, openLeads, upcomingEvents, ytdSales, VELOCITY_WEEKS,
  type BookedRow, type EventSummaryRow, type LedgerRow,
} from '@/lib/dashboardMetrics'
import { loadLeadCards } from '@/lib/leadCards'

/**
 * What the crew-management app's screens read. Read only.
 *
 * The booked list comes from the Booked tab's own route (called with the request that
 * is already authorised), so "who is booked" has ONE definition: money has landed, or
 * a legacy booked status, never a guess from the status column alone.
 */

type Supa = ReturnType<typeof getSupabase>

const IN_CHUNK = 150

export async function fetchBooked(req: NextRequest): Promise<{ ok: true; parties: BookedParty[] } | { ok: false; error: string }> {
  const res = await bookedGet(req)
  const json = (await res.json().catch(() => ({}))) as { parties?: BookedParty[]; error?: string }
  if (!res.ok || !json.parties) return { ok: false, error: json.error || 'Could not read the bookings.' }
  return { ok: true, parties: json.parties }
}

/* ── Bookings (the tiles) ─────────────────────────────────────────────────── */

export interface CrewPerson {
  firstName: string
  role: 'lead' | 'crew'
  confirmed: boolean
}

export interface BookingTile {
  id: string
  ref: string
  name: string
  childName: string | null
  childAge: number | null
  partyType: string | null
  partyDate: string | null
  /** "2:00 PM" or null. */
  partyTime: string | null
  guests: number | null
  stage: string
  paymentStatus: string
  packageType: string | null
  totalCents: number
  paidCents: number
  balanceCents: number
  /** The crew party behind it, if one has been made. */
  crew: { partyId: string; status: string; needed: number; staffed: number; people: CrewPerson[] } | null
}

/** First day of the current month through the last day of the third month. */
export function bookingsWindow(today: string): { from: string; to: string } {
  const keys = monthKeys(today, 3)
  return { from: `${keys[0]}-01`, to: `${keys[2]}-${String(daysInMonth(keys[2])).padStart(2, '0')}` }
}

/**
 * The tiles for the Bookings screen: booked / completed parties in the three-month window.
 * `includeId` adds one more booking whatever its date or stage (a link from the Payments
 * screen to a past or cancelled party that still has money on it).
 */
export function inBookingsWindow(t: Pick<BookingTile, 'stage' | 'partyDate'>, today: string): boolean {
  const { from, to } = bookingsWindow(today)
  return (t.stage === 'booked' || t.stage === 'completed') && !!t.partyDate && t.partyDate >= from && t.partyDate <= to
}

export async function loadBookingTiles(
  sb: Supa,
  parties: BookedParty[],
  today: string,
  includeId?: string,
): Promise<{ ok: true; tiles: BookingTile[] } | { ok: false; error: string }> {
  const { from, to } = bookingsWindow(today)
  const inWindow = parties.filter(
    p =>
      p.id === includeId ||
      ((p.stage === 'booked' || p.stage === 'completed') && p.party_date && p.party_date >= from && p.party_date <= to),
  )

  // The crew parties behind these bookings, with who is on each spot.
  const byBooking = new Map<string, BookingTile['crew']>()
  const ids = inWindow.map(p => p.id)
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const cps = await sb.from('crew_parties').select('id, booking_id, status').in('booking_id', ids.slice(i, i + IN_CHUNK))
    if (cps.error) return { ok: false, error: 'Could not read the crew parties.' }
    const rows = (cps.data ?? []) as Array<{ id: string; booking_id: string; status: string }>
    if (rows.length === 0) continue
    const slots = await sb
      .from('crew_slots')
      .select('party_id, role, status, member_id, confirmed_at')
      .in('party_id', rows.map(r => r.id))
      .neq('status', 'cancelled')
    if (slots.error) return { ok: false, error: 'Could not read the crew spots.' }
    const slotRows = (slots.data ?? []) as Array<{ party_id: string; role: 'lead' | 'crew'; status: string; member_id: string | null; confirmed_at: string | null }>
    const memberIds = Array.from(new Set(slotRows.map(s => s.member_id).filter((x): x is string => !!x)))
    const names = new Map<string, string>()
    if (memberIds.length) {
      const ms = await sb.from('crew_members').select('id, first_name').in('id', memberIds)
      if (ms.error) return { ok: false, error: 'Could not read the crew.' }
      for (const m of (ms.data ?? []) as Array<{ id: string; first_name: string }>) names.set(m.id, m.first_name)
    }
    for (const cp of rows) {
      const mine = slotRows.filter(s => s.party_id === cp.id)
      const held = mine.filter(s => s.member_id && s.status !== 'open')
      byBooking.set(cp.booking_id, {
        partyId: cp.id,
        status: cp.status,
        needed: mine.length,
        staffed: held.length,
        people: held.map(s => ({ firstName: names.get(s.member_id as string) ?? 'Someone', role: s.role, confirmed: !!s.confirmed_at })),
      })
    }
  }

  const tiles: BookingTile[] = inWindow.map(p => ({
    id: p.id,
    ref: p.booking_ref,
    name: p.contact_name ?? 'Unknown',
    childName: p.child_name,
    childAge: p.child_age,
    partyType: p.party_type,
    partyDate: p.party_date,
    partyTime: clock12(p.party_time),
    guests: p.guest_count_approx,
    stage: p.stage,
    paymentStatus: p.payment_status,
    packageType: p.package_type,
    totalCents: p.total_cents ?? 0,
    paidCents: p.paid_cents,
    balanceCents: p.balance_cents,
    crew: byBooking.get(p.id) ?? null,
  }))
  tiles.sort((a, b) => `${a.partyDate} ${a.partyTime ?? ''}`.localeCompare(`${b.partyDate} ${b.partyTime ?? ''}`) || a.ref.localeCompare(b.ref))
  return { ok: true, tiles }
}

/* ── Dashboard ────────────────────────────────────────────────────────────── */

async function ledgerRows(sb: Supa, today: string): Promise<LedgerRow[] | null> {
  const out: LedgerRow[] = []
  const CHUNK = 1000
  for (let offset = 0; ; offset += CHUNK) {
    const { data, error } = await sb
      .from('financial_transactions')
      .select('date, amount_cents, category')
      .gte('date', `${today.slice(0, 4)}-01-01`)
      .lte('date', today)
      .order('date', { ascending: true })
      .range(offset, offset + CHUNK - 1)
    if (error) return null
    const rows = (data ?? []) as LedgerRow[]
    out.push(...rows)
    if (rows.length < CHUNK) return out
  }
}

async function eventRows(sb: Supa, today: string): Promise<EventSummaryRow[] | null> {
  const ev = await sb.from('events').select('id, title, event_date, max_tickets').eq('is_active', true).gte('event_date', today).order('event_date', { ascending: true }).limit(60)
  if (ev.error) return null
  const events = (ev.data ?? []) as Array<{ id: string; title: string; event_date: string; max_tickets: number | null }>
  const signups = new Map<string, { qty: number; cents: number }>()
  for (let i = 0; i < events.length; i += IN_CHUNK) {
    const t = await sb
      .from('event_tickets')
      .select('event_id, quantity, total_cents, refund_amount_cents, status')
      .in('event_id', events.slice(i, i + IN_CHUNK).map(e => e.id))
      .eq('status', 'confirmed')
    if (t.error) return null
    for (const r of (t.data ?? []) as Array<{ event_id: string; quantity: number | null; total_cents: number | null; refund_amount_cents: number | null }>) {
      const cur = signups.get(r.event_id) ?? { qty: 0, cents: 0 }
      cur.qty += Number(r.quantity) || 0
      cur.cents += (Number(r.total_cents) || 0) - (Number(r.refund_amount_cents) || 0)
      signups.set(r.event_id, cur)
    }
  }
  return events.map(e => ({
    id: e.id, title: e.title, date: e.event_date, capacity: e.max_tickets,
    signups: signups.get(e.id)?.qty ?? 0, revenueCents: signups.get(e.id)?.cents ?? 0,
  }))
}

async function inquiryStamps(sb: Supa, today: string): Promise<Array<{ createdAt: string }> | null> {
  const since = `${shiftEtDate(today, -7 * VELOCITY_WEEKS - 7)}T00:00:00Z`
  const out: Array<{ createdAt: string }> = []
  const CHUNK = 1000
  for (let offset = 0; ; offset += CHUNK) {
    const { data, error } = await sb
      .from('bookings')
      .select('created_at')
      .gte('created_at', since)
      .not('event_type', 'in', '(vendor_registration)')
      .order('created_at', { ascending: true })
      .range(offset, offset + CHUNK - 1)
    if (error) return null
    const rows = (data ?? []) as Array<{ created_at: string }>
    out.push(...rows.map(r => ({ createdAt: r.created_at })))
    if (rows.length < CHUNK) return out
  }
}

export async function loadDashboard(sb: Supa, parties: BookedParty[], now: Date = new Date()) {
  const today = etDateString(now)
  const errors: string[] = []
  const [ledger, events, stamps, leads] = await Promise.all([
    ledgerRows(sb, today),
    eventRows(sb, today),
    inquiryStamps(sb, today),
    loadLeadCards(sb, now),
  ])
  const rows: BookedRow[] = parties.map(p => ({
    partyType: p.party_type,
    partyDate: p.party_date,
    stage: p.stage,
    totalCents: p.total_cents ?? 0,
    paidCents: p.paid_cents,
    balanceCents: p.balance_cents,
    bookedAt: p.first_paid_at ?? p.created_at,
  }))
  if (!ledger) errors.push('Could not read the books, so year-to-date sales are missing.')
  if (!events) errors.push('Could not read the events.')
  if (!stamps) errors.push('Could not read the inquiries, so lead velocity is missing.')
  if (leads.kind !== 'ok') errors.push('Could not read the open leads.')
  return {
    asOf: now.toISOString(),
    today,
    errors,
    ytd: ledger ? ytdSales(ledger, today) : null,
    backlog: backlog(rows, today),
    bookingsMade: bookingsMade(rows, today),
    events: events ? upcomingEvents(events, today) : null,
    leads:
      stamps && leads.kind === 'ok'
        ? { ...openLeads(leads.leads.map(l => ({ totalCents: l.totalCents }))), velocity: leadVelocity(stamps, today) }
        : null,
  }
}
