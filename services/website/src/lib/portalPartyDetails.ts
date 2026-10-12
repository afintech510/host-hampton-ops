/**
 * What `/my-booking` shows a customer about their own party — every detail,
 * shaped per product, derived on the server.
 *
 * Adam, 2026-10-11: "List all details. It should support room rentals, mobile
 * parties, in-studio parties. All party details, notes, date, time, selections
 * (pizza or bagel, cupcake flavor, activities, discounts, custom add-ons, food
 * etc.)". The page used to show four facts and an undifferentiated list of line
 * items, so a studio rental's hours, a mobile party's address and an in-studio
 * party's food choices were nowhere on the customer's own booking page.
 *
 * ── Why this is a module and not more columns on the route ─────────────────
 *
 * The food choices are not columns. They live inside `bookings.quote_snapshot`
 * (see lib/partyFood.ts), and the snapshot as a whole must never reach a
 * customer: it carries the full planner state, contact fields and whatever an
 * admin pasted into it. So `PORTAL_SELECTION_COLUMNS` names individual SCALAR
 * keys with `->>`, each one aliased, and the route never selects the snapshot
 * itself. `portalPartyDetailsSurface.test.ts` holds that line: every snapshot
 * read in this file is a `->>` of a key on the allow-list below.
 *
 * ── What it deliberately does NOT show ─────────────────────────────────────
 *
 * `bookings.notes`. It reads like "the customer's notes" and is not: measured
 * 2026-10-11, the newest 25 non-empty rows include "Created by admin … NOTHING
 * SENT TO THE CUSTOMER", "no Venmo/Stripe receipt found — confirm before
 * chasing" and "Confirm with Maggie: final head count". It is a shared scratch
 * column. The customer's OWN words are the planner's `partyPreferences` and
 * `characterRequest`, and those are what "Your notes" renders.
 *
 * Likewise `party_tags` is read here for the handful of keys a customer should
 * see (rental window, address, theme) and is not passed through whole: it also
 * holds `custom_rate_reason`, pledge bookkeeping and `created_by`.
 *
 * ── Money ───────────────────────────────────────────────────────────────────
 *
 * Each line's amount is `lineAmountCents` from lib/planBalance.ts — the same
 * function the plan total is summed from — so the itemised list cannot print a
 * figure the total was not built from. Nothing here derives a balance.
 */

import { canEditPlanInBuilder, formatClockTime, formatEventDateTime, isHeldAtStudio } from '@/lib/planInvoice'
import { lineAmountCents, type BilledItem } from '@/lib/planBalance'
import { foodSelectionsFromColumns } from '@/lib/partyFood'
import { shouldAskForPartyAddress } from '@/lib/partyAddress'
import { STUDIO_ADDRESS_LINE, STUDIO_MAPS_URL } from '@/lib/studioLocation'

/**
 * The planner keys a customer may see, each read as ONE scalar. The alias is
 * what the row carries; the route spreads none of them into its response.
 */
export const PORTAL_SNAPSHOT_KEYS = {
  sel_pizza_or_bagels: 'pizzaOrBagels',
  sel_cupcake_flavor: 'cupcakeFlavor',
  sel_add_mobile_cupcakes: 'addMobileCupcakes',
  sel_character_request: 'characterRequest',
  sel_party_preferences: 'partyPreferences',
  sel_catchy_party_name: 'catchyPartyName',
  sel_theme_name: 'themeName',
  sel_is_mini_party: 'isMiniParty',
  sel_event_type: 'eventType',
} as const

export type SnapshotAlias = keyof typeof PORTAL_SNAPSHOT_KEYS

/** `alias:quote_snapshot->>key, …` — appended to the route's column list. */
export const PORTAL_SELECTION_COLUMNS = (Object.keys(PORTAL_SNAPSHOT_KEYS) as SnapshotAlias[])
  .map(alias => `${alias}:quote_snapshot->>${PORTAL_SNAPSHOT_KEYS[alias]}`)
  .join(', ')

/** Everything the route must strip from the row before it reaches the browser. */
export const PORTAL_INTERNAL_ROW_KEYS: readonly string[] = [
  'party_tags',
  ...Object.keys(PORTAL_SNAPSHOT_KEYS),
]

export type PartyKind = 'in_studio' | 'mobile' | 'studio_rental' | 'other'

export interface DetailFact {
  label: string
  value: string
}

export interface DetailLine {
  name: string
  description: string | null
  /** Shown as "×N" only when it says something (more than one, not per-head). */
  quantityLabel: string | null
  amountCents: number
  /** Quoted, not charged — never in the total. */
  optional: boolean
}

export interface DetailSection {
  key: string
  title: string
  lines: DetailLine[]
}

export interface PortalPartyDetails {
  kind: PartyKind
  kindLabel: string
  title: string
  /** The customer's own party name from the planner, if they gave one. */
  subtitle: string | null
  facts: DetailFact[]
  location:
    | { kind: 'studio'; line: string; mapsUrl: string }
    | { kind: 'home'; address: string | null; needsAddress: boolean }
    | null
  /** In-studio food and cake choices, plus a mobile party's cupcake add-on. */
  choices: DetailFact[]
  /** The customer's own words — never `bookings.notes`. See the header. */
  notes: DetailFact[]
  sections: DetailSection[]
  /** Where this customer can change their party, if anywhere. */
  editLink: { href: string; label: string } | null
}

const KIND_LABELS: Record<PartyKind, string> = {
  in_studio: 'In-studio party',
  mobile: 'Mobile party',
  studio_rental: 'Studio rental',
  other: 'Party',
}

export function partyKindOf(partyType: unknown): PartyKind {
  if (partyType === 'in_studio_theme') return 'in_studio'
  if (partyType === 'mobile_party') return 'mobile'
  if (partyType === 'studio_rental') return 'studio_rental'
  return 'other'
}

/**
 * `booking_line_items.category` → the section a customer reads it under.
 *
 * Measured 2026-10-11 across all live rows. An unknown category falls into
 * "Add-ons" rather than vanishing, and a negative price is a discount whatever
 * its category says — the planner's "activity included" credit is filed under
 * `discount`, but an admin-typed one could be filed anywhere.
 */
const SECTION_OF: Record<string, string> = {
  theme: 'package',
  package: 'package',
  rental: 'package',
  'studio-rental-rate': 'package',
  'activity-add-on': 'activities',
  'activity-standard': 'activities',
  'activity-premium': 'activities',
  station: 'activities',
  'food-add-on': 'food',
  'beverage-add-on': 'food',
  'dessert-add-on': 'food',
  'decor-add-on': 'decor',
  'entertainment-add-on': 'extras',
  'party-add-on': 'extras',
  'service-add-on': 'extras',
  extra: 'extras',
  'add-on': 'extras',
  custom: 'custom',
  discount: 'discounts',
}

const SECTION_ORDER: { key: string; title: string; studioTitle?: string; mobileTitle?: string }[] = [
  { key: 'package', title: 'Party package', studioTitle: 'Your rental', mobileTitle: 'Package' },
  { key: 'activities', title: 'Activities', mobileTitle: 'Stations & activities' },
  { key: 'food', title: 'Food & drinks' },
  { key: 'decor', title: 'Decor' },
  { key: 'extras', title: 'Extras & services' },
  { key: 'custom', title: 'Custom add-ons' },
  { key: 'discounts', title: 'Discounts' },
]

export interface PortalLineItem extends BilledItem {
  name: string
  category?: string | null
  description?: string | null
}

export function buildSections(
  items: PortalLineItem[],
  guestCountApprox: number | null | undefined,
  kind: PartyKind,
): DetailSection[] {
  const buckets = new Map<string, DetailLine[]>()
  for (const item of items) {
    const amountCents = lineAmountCents(item, guestCountApprox)
    const key = amountCents < 0 ? 'discounts' : (SECTION_OF[String(item.category ?? '')] ?? 'extras')
    const qty = Number(item.quantity)
    const line: DetailLine = {
      name: String(item.name ?? '').trim() || 'Item',
      description: typeof item.description === 'string' && item.description.trim() ? item.description.trim() : null,
      quantityLabel: !item.guest_multiplied && Number.isInteger(qty) && qty > 1 ? `×${qty}` : null,
      amountCents,
      optional: item.is_optional === true,
    }
    const list = buckets.get(key) ?? []
    list.push(line)
    buckets.set(key, list)
  }
  return SECTION_ORDER.filter(s => buckets.has(s.key)).map(s => ({
    key: s.key,
    title: (kind === 'studio_rental' && s.studioTitle) || (kind === 'mobile' && s.mobileTitle) || s.title,
    lines: buckets.get(s.key) as DetailLine[],
  }))
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** "13:30" + "16:30" + 3 → "1:30 PM – 4:30 PM (3 hours)". */
function rentalWindow(tags: Record<string, unknown>, fallbackTime: string | null): string | null {
  const start = str(tags.rental_start_time)
  const end = str(tags.rental_end_time)
  const hours = Number(tags.rental_hours)
  const span = Number.isFinite(hours) && hours > 0 ? ` (${hours} hour${hours === 1 ? '' : 's'})` : ''
  if (start && end) return `${formatClockTime(start)} – ${formatClockTime(end)}${span}`
  if (start) return `${formatClockTime(start)}${span}`
  return fallbackTime ? formatClockTime(fallbackTime) : null
}

export function buildPortalPartyDetails(input: {
  row: Record<string, unknown>
  lineItems: PortalLineItem[]
  canEditFull: boolean
  today?: string
}): PortalPartyDetails {
  const { row } = input
  const tags = (row.party_tags && typeof row.party_tags === 'object' ? row.party_tags : {}) as Record<string, unknown>
  const partyType = typeof row.party_type === 'string' ? row.party_type : null
  const kind = partyKindOf(partyType)
  const guestCount = typeof row.guest_count_approx === 'number' ? row.guest_count_approx : null
  const partyDate = str(row.party_date)
  const partyTime = str(row.party_time)
  const childName = str(row.child_name)
  const childAge = typeof row.child_age === 'number' && row.child_age > 0 ? row.child_age : null
  const theme =
    str(row.sel_theme_name) ?? str(tags.theme) ?? str(tags.party_theme) ?? str(row.package_type)
  const eventLabel = str(tags.event_label) ?? str(tags.eventType) ?? str(row.sel_event_type)

  const facts: DetailFact[] = []
  facts.push({ label: 'Date', value: formatEventDateTime(partyDate, null) ?? 'To be confirmed' })
  if (kind === 'studio_rental') {
    facts.push({ label: 'Rental time', value: rentalWindow(tags, partyTime) ?? 'To be confirmed' })
    // The event name is the title ("Studio Rental · 1st Birthday"), so it is not repeated here.
    facts.push({ label: 'Guests', value: guestCount ? String(guestCount) : 'To be confirmed' })
    const seating = Number(tags.seating_needed)
    if (Number.isFinite(seating) && seating > 0) facts.push({ label: 'Seating', value: `${seating} seated` })
  } else {
    facts.push({ label: 'Time', value: partyTime ? formatClockTime(partyTime) : 'To be confirmed' })
    facts.push({ label: 'Guests', value: guestCount ? String(guestCount) : 'To be confirmed' })
    if (childName) facts.push({ label: 'Celebrating', value: childAge ? `${childName}, age ${childAge}` : childName })
    if (theme) facts.push({ label: kind === 'mobile' ? 'Package' : 'Theme', value: theme })
    if (row.sel_is_mini_party === 'true') facts.push({ label: 'Party size', value: 'Mini party' })
  }

  let location: PortalPartyDetails['location'] = null
  if (isHeldAtStudio(partyType)) {
    location = { kind: 'studio', line: STUDIO_ADDRESS_LINE, mapsUrl: STUDIO_MAPS_URL }
  } else if (kind === 'mobile') {
    location = {
      kind: 'home',
      // Shown even when provisional ("Westhampton, NY (address TBC)") — it is
      // what we have; `needsAddress` is what asks for the real one.
      address: str(tags.location_address),
      needsAddress: shouldAskForPartyAddress({
        partyType,
        status: typeof row.status === 'string' ? row.status : null,
        partyDate,
        partyTags: tags,
        today: input.today,
      }),
    }
  }

  // The planner initialises both food selectors and saves whatever is showing,
  // so for an untouched plan these are the defaults (lib/partyFood.ts). To the
  // CUSTOMER that is still the truth — it is what will be served — so the value
  // is shown plainly and the planner link beside it is how they change it.
  const food = foodSelectionsFromColumns(
    str(row.sel_pizza_or_bagels),
    str(row.sel_cupcake_flavor),
    str(row.sel_add_mobile_cupcakes),
  )
  const choices: DetailFact[] = []
  if (kind === 'in_studio') {
    if (food.main) choices.push({ label: 'Pizza or bagels', value: food.main.label })
    if (food.cupcake) choices.push({ label: 'Cupcake flavor', value: food.cupcake.label })
  } else if (kind === 'mobile' && food.mobileCupcakes) {
    choices.push({ label: 'Cupcakes', value: food.cupcake ? `${food.cupcake.label} cupcakes` : 'Added' })
  }

  const notes: DetailFact[] = []
  const character = str(row.sel_character_request)
  const prefs = str(row.sel_party_preferences)
  if (character) notes.push({ label: 'Character request', value: character })
  if (prefs) notes.push({ label: 'Your notes', value: prefs })

  let editLink: PortalPartyDetails['editLink'] = null
  const ref = str(row.booking_ref)
  if (input.canEditFull && ref) {
    if (canEditPlanInBuilder(partyType)) {
      editLink = { href: `/party-planner?ref=${encodeURIComponent(ref)}`, label: 'Change my party plan' }
    } else if (kind === 'studio_rental' && row.event_type === 'studio-rental') {
      // `/studio-rental` opens in manage mode only for `event_type = 'studio-rental'`
      // (see its page) — the older `room-rental` rows would land on a blank
      // booking form, so they get no link rather than a wrong one.
      editLink = { href: '/studio-rental', label: 'Change my rental' }
    }
  }

  const subtitle = str(row.sel_catchy_party_name) ?? str(tags.catchy_party_name)
  const title =
    kind === 'studio_rental'
      ? eventLabel ? `Studio Rental · ${eventLabel}` : 'Studio Rental'
      : childName ? `${childName}'s Party` : theme ?? 'Your Party'

  return {
    kind,
    kindLabel: KIND_LABELS[kind],
    title,
    subtitle,
    facts,
    location,
    choices,
    notes,
    sections: buildSections(input.lineItems, guestCount, kind),
    editLink,
  }
}
