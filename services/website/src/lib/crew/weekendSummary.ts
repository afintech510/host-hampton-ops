/**
 * The upcoming-weekend prep list for the crew manager (Adam, 2026-11-05: "a spot
 * for upcoming weekend summary = pizza for the kids and any extra food, add-ons,
 * drinks, activities"). Server code only, for ADMIN callers.
 *
 * "The upcoming weekend" is the next Saturday and Sunday in Eastern time (this
 * weekend, if it is one). Every crew party that is not cancelled and starts then
 * is listed with what has to be on hand for it, read from its booking:
 *
 *   - the main food and the cupcake flavor the host picked (in-studio parties),
 *     or the cupcakes a mobile host added;
 *   - food, dessert and drink add-ons;
 *   - activities and stations;
 *   - everything else booked (decor, entertainment, services, custom add-ons).
 *
 * Quoted-but-not-booked (optional) lines and discounts are left out. The totals
 * answer the shopping question: how many kids get pizza, how many get bagels, and
 * how many of each extra are needed across the weekend.
 */

import type { getSupabase } from '@/lib/supabase'
import { foodSelectionsFromColumns } from '@/lib/partyFood'
import { etToUtc, shiftEtDate } from '@/lib/partyTime'
import { localParts } from '@/lib/crew/rules'
import { CREW_DETAIL_COLUMNS } from '@/lib/crew/partyDetails'
import type { CrewPartyRow, Read } from '@/lib/crew/db'

type Supa = ReturnType<typeof getSupabase>

export interface WeekendItem { name: string; quantity: number }

export interface WeekendParty {
  partyId: string
  title: string
  kind: CrewPartyRow['party_kind']
  status: CrewPartyRow['status']
  startsAt: string
  endsAt: string
  kids: number | null
  child: string | null
  parent: string | null
  theme: string | null
  /** "Pizza", "Bagels" or null; and the cupcake flavor ("Vanilla"). */
  main: string | null
  cupcakes: string | null
  food: WeekendItem[]
  drinks: WeekendItem[]
  addOns: WeekendItem[]
  activities: WeekendItem[]
}

export interface WeekendTotals {
  parties: number
  kids: number
  pizzaKids: number
  bagelKids: number
  cupcakes: { label: string; parties: number }[]
  food: WeekendItem[]
  drinks: WeekendItem[]
  addOns: WeekendItem[]
  activities: { name: string; parties: number }[]
}

export interface WeekendSummary { from: string; to: string; parties: WeekendParty[]; totals: WeekendTotals }

const FOOD = new Set(['food-add-on', 'dessert-add-on'])
const DRINKS = new Set(['beverage-add-on'])
const ACTIVITIES = new Set(['activity-add-on', 'activity-standard', 'activity-premium', 'station'])
// Everything else a customer can book that is not the package itself, a rental rate, or a credit.
const ADD_ONS = new Set(['decor-add-on', 'party-add-on', 'entertainment-add-on', 'service-add-on', 'extra', 'add-on', 'custom'])

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

interface LineRow { name: string | null; category: string | null; quantity: number | null; is_optional: boolean | null; guest_multiplied: boolean | null }

/** Same name twice (two lines, or ×2) adds up; a per-head line counts once. */
function tally(lines: ReadonlyArray<LineRow>, cats: Set<string>): WeekendItem[] {
  const out = new Map<string, number>()
  for (const l of lines) {
    if (l.is_optional || !cats.has(String(l.category ?? '')) || !str(l.name)) continue
    const q = !l.guest_multiplied && Number.isInteger(l.quantity) && (l.quantity as number) > 0 ? (l.quantity as number) : 1
    const name = str(l.name) as string
    out.set(name, (out.get(name) ?? 0) + q)
  }
  return Array.from(out, ([name, quantity]) => ({ name, quantity }))
}

/** Pure: one crew party, its booking row and its line items → what the manager preps. */
export function buildWeekendParty(party: CrewPartyRow, row: Record<string, unknown> | null, lines: ReadonlyArray<LineRow>): WeekendParty {
  const partyType = row && typeof row.party_type === 'string' ? row.party_type : null
  const rental = party.party_kind === 'studio_rental' || partyType === 'studio_rental'
  const tags = (row?.party_tags && typeof row.party_tags === 'object' ? row.party_tags : {}) as Record<string, unknown>
  let main: string | null = null
  let cupcakes: string | null = null
  if (row && !rental) {
    const sel = foodSelectionsFromColumns(str(row.sel_pizza_or_bagels), str(row.sel_cupcake_flavor), str(row.sel_add_mobile_cupcakes))
    if (partyType === 'mobile_party') {
      // A mobile party has no pizza from us; the host may have added cupcakes.
      if (sel.mobileCupcakes) cupcakes = sel.cupcake?.label ?? 'Cupcakes'
    } else {
      main = sel.main?.label ?? null
      cupcakes = sel.cupcake?.label ?? null
    }
  }
  return {
    partyId: party.id,
    title: party.title,
    kind: party.party_kind,
    status: party.status,
    startsAt: party.starts_at,
    endsAt: party.ends_at,
    kids: party.guest_count ?? null,
    child: row ? str(row.child_name) : null,
    parent: row ? str(row.contact_name) : null,
    theme: row ? (str(row.sel_theme_name) ?? str(tags.theme) ?? str(tags.party_theme) ?? str(row.package_type)) : party.theme,
    main,
    cupcakes,
    food: tally(lines, FOOD),
    drinks: tally(lines, DRINKS),
    addOns: tally(lines, ADD_ONS),
    activities: tally(lines, ACTIVITIES),
  }
}

function merge(lists: WeekendItem[][]): WeekendItem[] {
  const m = new Map<string, number>()
  for (const l of lists) for (const i of l) m.set(i.name, (m.get(i.name) ?? 0) + i.quantity)
  return Array.from(m, ([name, quantity]) => ({ name, quantity })).sort((a, b) => a.name.localeCompare(b.name))
}

export function weekendTotals(parties: ReadonlyArray<WeekendParty>): WeekendTotals {
  const isMain = (p: WeekendParty, re: RegExp) => !!p.main && re.test(p.main)
  const cup = new Map<string, number>()
  for (const p of parties) if (p.cupcakes) cup.set(p.cupcakes, (cup.get(p.cupcakes) ?? 0) + 1)
  const act = new Map<string, number>()
  for (const p of parties) for (const a of p.activities) act.set(a.name, (act.get(a.name) ?? 0) + 1)
  return {
    parties: parties.length,
    kids: parties.reduce((n, p) => n + (p.kids ?? 0), 0),
    pizzaKids: parties.filter(p => isMain(p, /pizza/i)).reduce((n, p) => n + (p.kids ?? 0), 0),
    bagelKids: parties.filter(p => isMain(p, /bagel/i)).reduce((n, p) => n + (p.kids ?? 0), 0),
    cupcakes: Array.from(cup, ([label, parties]) => ({ label, parties })).sort((a, b) => a.label.localeCompare(b.label)),
    food: merge(parties.map(p => p.food)),
    drinks: merge(parties.map(p => p.drinks)),
    addOns: merge(parties.map(p => p.addOns)),
    activities: Array.from(act, ([name, parties]) => ({ name, parties })).sort((a, b) => a.name.localeCompare(b.name)),
  }
}

/** The Saturday and Sunday (Eastern dates) of the upcoming weekend: this one, if today is part of it. */
export function upcomingWeekend(now: Date): { saturday: string; sunday: string } {
  const { dateKey, dow } = localParts(now)
  const saturday = dow === 0 ? shiftEtDate(dateKey, -1) : shiftEtDate(dateKey, (6 - dow + 7) % 7)
  return { saturday: saturday as string, sunday: shiftEtDate(saturday as string, 1) as string }
}

export async function loadWeekendSummary(sb: Supa, now: Date): Promise<Read<WeekendSummary>> {
  const { saturday, sunday } = upcomingWeekend(now)
  const from = etToUtc(saturday, 0, 0)
  const to = etToUtc(shiftEtDate(sunday, 1) as string, 0, 0)
  const { data: pRows, error } = await sb.from('crew_parties').select('*')
    .gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString()).in('status', ['draft', 'published'])
    .order('starts_at', { ascending: true })
  if (error) return { kind: 'unavailable', error: error.message }
  const parties = (pRows ?? []) as CrewPartyRow[]
  const bookingIds = Array.from(new Set(parties.map(p => p.booking_id).filter((x): x is string => !!x)))

  const rows = new Map<string, Record<string, unknown>>()
  const lines = new Map<string, LineRow[]>()
  if (bookingIds.length > 0) {
    const [b, l] = await Promise.all([
      sb.from('bookings').select(CREW_DETAIL_COLUMNS).in('id', bookingIds),
      sb.from('booking_line_items').select('booking_id, name, category, quantity, is_optional, guest_multiplied').in('booking_id', bookingIds),
    ])
    if (b.error) return { kind: 'unavailable', error: b.error.message }
    if (l.error) return { kind: 'unavailable', error: l.error.message }
    for (const r of (b.data ?? []) as unknown as Record<string, unknown>[]) rows.set(String(r.id), r)
    for (const r of (l.data ?? []) as unknown as (LineRow & { booking_id: string })[]) {
      const list = lines.get(r.booking_id) ?? []
      list.push(r)
      lines.set(r.booking_id, list)
    }
  }
  const out = parties.map(p => buildWeekendParty(p, p.booking_id ? rows.get(p.booking_id) ?? null : null, p.booking_id ? lines.get(p.booking_id) ?? [] : []))
  return { kind: 'ok', data: { from: saturday, to: sunday, parties: out, totals: weekendTotals(out) } }
}
