/**
 * What a crew member working a party is told about it (Adam, 2026-11-05: "show
 * more details about the party - child's name, mom's first name, food selection,
 * activities, theme, expected shift"). Server code only.
 *
 * WHO SEES IT: only a member who is ON the party (the page checks `mySlot`), like
 * the address and Allie's notes. The open board never carries a child's or
 * family's name — every crew member sees that list.
 *
 * WHAT IT READS: an allow-list of `bookings` columns, each named, and the
 * planner snapshot's scalar keys one `->>` at a time (the snapshot itself holds
 * contact fields and admin paste, and must never be selected whole — the same rule
 * as `lib/portalPartyDetails.ts`). A customer's phone, email, address, notes,
 * money and payment status are not in the list, so they cannot reach a crew page by accident.
 * Names are FIRST names only.
 */

import type { getSupabase } from '@/lib/supabase'
import { foodSelectionsFromColumns, foodSummary } from '@/lib/partyFood'
import type { Read } from '@/lib/crew/db'

type Supa = ReturnType<typeof getSupabase>

export const CREW_DETAIL_COLUMNS =
  'id, party_type, package_type, child_name, child_age, contact_name, party_tags, ' +
  'sel_theme_name:quote_snapshot->>themeName, sel_pizza_or_bagels:quote_snapshot->>pizzaOrBagels, ' +
  'sel_cupcake_flavor:quote_snapshot->>cupcakeFlavor, sel_add_mobile_cupcakes:quote_snapshot->>addMobileCupcakes'

export interface CrewPartyDetails {
  /** "Ava, turning 7" — a first name and an age, never a surname. */
  child: string | null
  /** The parent's FIRST name, from the booking contact. */
  parent: string | null
  theme: string | null
  /** What we serve: the pizza/bagel and cupcake choices, then food add-ons. */
  food: string[]
  /** Activities and stations that are booked (optional, not-charged items are left out). */
  activities: string[]
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const firstName = (v: unknown): string | null => str(v)?.split(/\s+/)[0] ?? null

const ACTIVITY = new Set(['activity-add-on', 'activity-standard', 'activity-premium', 'station'])
const FOOD = new Set(['food-add-on', 'beverage-add-on', 'dessert-add-on'])

interface LineRow { name: string | null; category: string | null; is_optional: boolean | null }

/** Pure: a booking row (the columns above) and its line items → what the crew read. */
export function buildCrewPartyDetails(row: Record<string, unknown>, lines: ReadonlyArray<LineRow>): CrewPartyDetails {
  const tags = (row.party_tags && typeof row.party_tags === 'object' ? row.party_tags : {}) as Record<string, unknown>
  const partyType = typeof row.party_type === 'string' ? row.party_type : null
  const rental = partyType === 'studio_rental'
  const childFirst = firstName(row.child_name)
  const age = typeof row.child_age === 'number' && row.child_age > 0 ? row.child_age : null
  const theme = str(row.sel_theme_name) ?? str(tags.theme) ?? str(tags.party_theme) ?? str(row.package_type)

  const food: string[] = []
  if (!rental) {
    const sel = foodSelectionsFromColumns(str(row.sel_pizza_or_bagels), str(row.sel_cupcake_flavor), str(row.sel_add_mobile_cupcakes))
    // A mobile party gets cupcakes only if the host added them; an in-studio party always has the two choices.
    const mobile = partyType === 'mobile_party'
    const summary = mobile
      ? (sel.mobileCupcakes ? `${sel.cupcake ? `${sel.cupcake.label} cupcakes` : 'Cupcakes'}` : null)
      : foodSummary(sel)
    if (summary) food.push(summary)
  }
  const unique = (xs: string[]) => Array.from(new Set(xs))
  const named = (cats: Set<string>) => unique(lines
    .filter(l => !l.is_optional && cats.has(String(l.category ?? '')) && str(l.name))
    .map(l => str(l.name) as string))
  food.push(...named(FOOD))

  return {
    child: rental ? null : childFirst ? (age ? `${childFirst}, turning ${age}` : childFirst) : null,
    parent: firstName(row.contact_name),
    theme,
    food,
    activities: named(ACTIVITY),
  }
}

/** The booking behind a crew party, read for a member who is on it. `null` data = no such booking. */
export async function loadCrewPartyDetails(sb: Supa, bookingId: string): Promise<Read<CrewPartyDetails | null>> {
  const { data, error } = await sb.from('bookings').select(CREW_DETAIL_COLUMNS).eq('id', bookingId).maybeSingle()
  if (error) return { kind: 'unavailable', error: error.message }
  if (!data) return { kind: 'ok', data: null }
  const { data: items, error: iErr } = await sb.from('booking_line_items').select('name, category, is_optional').eq('booking_id', bookingId)
  if (iErr) return { kind: 'unavailable', error: iErr.message }
  return { kind: 'ok', data: buildCrewPartyDetails(data as unknown as Record<string, unknown>, (items ?? []) as LineRow[]) }
}
