/**
 * The crew app's read-only Bookings and Schedule (migration 100). Server code only.
 *
 * WHO: a member with an enabled row in `crew_booking_view_members` (Lexi at launch). For
 * everyone else the API answers 404 and the tabs do not exist.
 *
 * WHAT: the admin Bookings and Schedule screens, with the business side taken out. Every shape
 * below is an ALLOW-LIST built field by field from the admin data, so a column added to the admin
 * shape tomorrow is private here until somebody decides otherwise. Left out on purpose:
 *   - money of any kind (totals, paid, balance, discounts, line-item prices, tips);
 *   - contact details (phone, email) and every link (invoice, planner, portal, admin, photo album);
 *   - the booking reference (it names the invoice and the planner) and the payment/booking status;
 *   - the booking's admin and customer notes (they hold payment and contact scratch);
 *   - the pick panel, sync flags and alerts (manager-only).
 * Names are FIRST names, the crew-wide rule (`lib/crew/partyDetails.ts`). A mobile party's address
 * is included: the crew who work it are told it, and the person preparing the weekend needs it.
 *
 * Read only: a GET gate, and nothing here writes.
 */

import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { requireCrewMember, type CrewGate } from '@/lib/crew/auth'
import type { Read } from '@/lib/crew/db'
import type { AdminPartyRow } from '@/lib/crew/admin'
import type { WeekendSummary } from '@/lib/crew/weekendSummary'
import type { PartyCardData, PartyCardLine } from '@/lib/assistant/partyCard'
import type { BookingTile } from '@/lib/crewAppData'
import { NextResponse } from 'next/server'

type Supa = ReturnType<typeof getSupabase>

/** Is this member switched on for the Bookings and Schedule tabs? An unreadable row is "unavailable", never "no". */
export async function loadBookingViewer(sb: Supa, memberId: string): Promise<Read<boolean>> {
  const { data, error } = await sb.from('crew_booking_view_members').select('enabled').eq('member_id', memberId).maybeSingle()
  if (error) return { kind: 'unavailable', error: error.message }
  return { kind: 'ok', data: !!data && data.enabled === true }
}

/** The gate for every `/api/crew/bookings*` and `/api/crew/schedule` route: a signed-in crew member who has the view. */
export async function requireBookingViewer(req: NextRequest): Promise<CrewGate> {
  const g = await requireCrewMember(req)
  if (!g.ok) return g
  const v = await loadBookingViewer(getSupabase(), g.member.id)
  if (v.kind !== 'ok') {
    console.error('crew bookings: viewer read failed:', v.error)
    return { ok: false, response: NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 }) }
  }
  if (!v.data) return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return g
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const firstOf = (v: unknown): string | null => str(v)?.split(/\s+/)[0] ?? null

// ── Bookings list ───────────────────────────────────────────────────────────

export interface CrewBookingTile {
  id: string
  parent: string | null
  child: string | null
  childAge: number | null
  partyType: string | null
  partyDate: string | null
  /** "2:00 PM" or null. */
  partyTime: string | null
  guests: number | null
  crew: { status: string; needed: number; staffed: number; people: { firstName: string; role: 'lead' | 'crew' }[] } | null
}

export function crewTileOf(t: BookingTile): CrewBookingTile {
  return {
    id: t.id,
    parent: firstOf(t.name),
    child: firstOf(t.childName),
    childAge: t.childAge,
    partyType: t.partyType,
    partyDate: t.partyDate,
    partyTime: t.partyTime,
    guests: t.guests,
    crew: t.crew
      ? { status: t.crew.status, needed: t.crew.needed, staffed: t.crew.staffed, people: t.crew.people.map(p => ({ firstName: p.firstName, role: p.role })) }
      : null,
  }
}

// ── One booking ─────────────────────────────────────────────────────────────

export interface CrewBookingDetail {
  id: string
  /** "Ava's Party". */
  title: string
  /** "Sat, Dec 12 · 2:00 PM". */
  when: string | null
  type: string
  parent: string | null
  child: string | null
  childAge: number | null
  guests: number | null
  theme: string[]
  activities: string[]
  /** Decor, entertainment, services and every other add-on. */
  addOns: string[]
  /** Food and drinks. */
  food: string[]
  desserts: string[]
  extraGuests: number | null
  /** The address of a mobile party. */
  venue: string | null
  /** The manager's notes to the crew for this party (`crew_parties.notes_for_crew`), if any. */
  notes: string | null
}

/** "Bagel Platter ×2": the name and a quantity when it says something. Never a price. */
const label = (l: PartyCardLine): string => `${l.name}${l.quantity > 1 ? ` ×${l.quantity}` : ''}`
/** What is booked: a quoted-but-not-chosen (optional) line is not part of the party. */
const booked = (lines: PartyCardLine[]): string[] => lines.filter(l => !l.optional).map(label)

export function crewDetailOf(card: PartyCardData, venue: string | null, notes: string | null): CrewBookingDetail {
  const child = firstOf(card.child.name)
  return {
    id: card.bookingId,
    title: child ? (/s$/i.test(child) ? `${child}' Party` : `${child}'s Party`) : 'Party',
    when: card.when,
    type: card.type,
    parent: firstOf(card.contact.name),
    child,
    childAge: card.child.age,
    guests: card.guests,
    theme: booked(card.theme),
    activities: booked(card.activities),
    addOns: booked(card.addOns),
    food: booked(card.food),
    desserts: booked(card.desserts),
    extraGuests: card.extraGuests && card.extraGuests.count > 0 ? card.extraGuests.count : null,
    venue,
    notes,
  }
}

/** A mobile party's address, from the planner's tags. */
export function venueOf(tags: Record<string, unknown> | null): string | null {
  return str(tags?.location_address) ?? str(tags?.address)
}

// ── This weekend ────────────────────────────────────────────────────────────

/** The weekend prep list with first names only (the admin one carries the booking's full names). */
export function crewWeekendOf(s: WeekendSummary): WeekendSummary {
  return { ...s, parties: s.parties.map(p => ({ ...p, child: firstOf(p.child), parent: firstOf(p.parent) })) }
}

// ── Schedule ────────────────────────────────────────────────────────────────

export interface CrewScheduleRow {
  id: string
  title: string
  theme: string | null
  kind: string
  booked: boolean
  child: string | null
  childAge: number | null
  parent: string | null
  food: string | null
  cupcake: string | null
  startsAt: string
  endsAt: string
  guestCount: number | null
  status: string
  needed: number
  staffed: number
  leadFilled: boolean
  crew: { firstName: string; role: 'lead' | 'crew' }[]
}

export function crewScheduleRowOf(p: AdminPartyRow): CrewScheduleRow {
  return {
    id: p.id,
    title: p.title,
    theme: p.theme ?? null,
    kind: p.kind,
    booked: p.booked,
    child: firstOf(p.childName),
    childAge: p.childAge ?? null,
    parent: firstOf(p.parentName),
    food: p.food,
    cupcake: p.cupcake,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    guestCount: p.guestCount,
    status: p.status,
    needed: p.needed,
    staffed: p.staffed,
    leadFilled: p.leadFilled,
    crew: p.crew.map(c => ({ firstName: c.firstName, role: c.role })),
  }
}
