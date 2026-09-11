/**
 * Pricing catalog — the one loader for every price that used to be a hardcoded
 * TypeScript constant (Phase 4 item 4 of docs/booking-agent-plan.md).
 *
 * Migration 036 moved three separate constant blocks into `pricing_items`:
 *
 *   lib/mobilePricing.ts            → category 'mobile-package'
 *   lib/studioRental.ts             → category 'studio-rental-rate'
 *   PartyBuilderContent.tsx:17-40   → 'mobile-package' + 'guest-overage'
 *   SKILL.md's curated station list → category 'mobile-station'
 *
 * Rows are identified by `metadata->>'catalog_key'`, never by name: the name is
 * display copy and Adam may re-word it, the key is the contract.
 *
 * ── Two design rules, both deliberate ───────────────────────────────────────
 *
 * 1. **The fallback is the old constant, not zero.** Every value has a compiled
 *    default equal to what shipped before this module existed. A DB hiccup, an
 *    unapplied migration or a deleted row therefore renders *exactly today's
 *    prices* rather than a $0 studio rental or an empty pricing page. A stale
 *    price is a business annoyance; a wrong one is a refund. `fromDb` says
 *    which happened, so a caller (or a test) can tell them apart.
 *
 * 2. **Computation is pure and parameterised.** `studioRentalRateWith()` takes
 *    the rates as an argument. That keeps the rate engine synchronous and
 *    usable from a client component, which matters because
 *    `StudioRentalContent` and `PartyBuilderContent` price interactively as the
 *    user drags a time or a guest count — they cannot await a query per
 *    keystroke. Server components load the catalog once and pass it down.
 */

import { getSupabase } from '@/lib/supabase'

type Supa = ReturnType<typeof getSupabase>

/** The catalog's four categories. */
export const CATALOG_CATEGORIES = [
  'mobile-package',
  'mobile-station',
  'studio-rental-rate',
  'guest-overage',
] as const

/** The subset of a `pricing_items` row this module reads. */
export interface CatalogRow {
  name: string
  description?: string | null
  category: string
  price_cents: number
  price_label?: string | null
  price_type?: string | null
  sort_order?: number | null
  emoji?: string | null
  metadata?: Record<string, unknown> | null
}

export const CATALOG_ROW_COLUMNS =
  'name, description, category, price_cents, price_label, price_type, sort_order, emoji, metadata'

// ───────────────────────────────────────────────────────────────────────────
// Shapes
// ───────────────────────────────────────────────────────────────────────────

/** A published mobile tier, as rendered on /mobile-party and the town pages. */
export interface MobileTier {
  name: string
  /** Whole dollars — the marketing block prints `${tier.price}`. */
  price: number
  minutes: number
  /** Kids included, NOT counting the birthday child (who is free). */
  kids: number
  tagline: string
  includes: string[]
  popular?: boolean
}

/** The planner's own mobile ladder: a flat base plus guest-band surcharges. */
export interface MobileBands {
  baseCents: number
  tier2SurchargeCents: number
  tier3SurchargeCents: number
  /** Guests ABOVE this get tier 2. */
  tier2GuestThreshold: number
  /** Guests ABOVE this get tier 3 as well. */
  tier3GuestThreshold: number
}

/** Mobile policy numbers that appear in the published fine print. */
export interface MobilePolicy {
  minGuests: number
  extraChildCents: number
  freeTravelMiles: number
}

/** One chip in the invoice's Full Mobile Party Menu appendix. */
export interface MobileStation {
  name: string
  emoji: string | null
  /** 'Ask' for every station today — none has a published price. */
  priceLabel: string | null
  priceCents: number
}

export interface StudioRates {
  weekendBaseCents: number
  weekdayBaseCents: number
  weekendAddlHourCents: number
  weekdayAddlHourCents: number
  weekendFullDayCents: number
  weekdayFullDayCents: number
  minHours: number
  securityDepositCents: number
}

export interface GuestRules {
  includedGuests: number
  extraGuestCents: number
  /** Positive magnitude; subtract it. Stored positive in the DB on purpose. */
  miniPartyDiscountCents: number
  miniPartyMaxGuests: number
}

export interface PricingCatalog {
  mobileTiers: MobileTier[]
  mobileBands: MobileBands
  mobilePolicy: MobilePolicy
  mobileStations: MobileStation[]
  studioRates: StudioRates
  guestRules: GuestRules
  /** False when any part of this came from the compiled fallback. */
  fromDb: boolean
  /**
   * Catalog keys whose row EXISTS but whose price was overridden by the compiled
   * fallback (see `cents`). Empty on a healthy read. Non-empty means the page is
   * showing a number that is not what the table says — which is exactly the
   * state worth being able to see, because a per-field fallback renders
   * plausibly either way.
   */
  fallbackFields: string[]
}

// ───────────────────────────────────────────────────────────────────────────
// Fallbacks — byte-for-byte the values that shipped before migration 036
// ───────────────────────────────────────────────────────────────────────────

/**
 * The published mobile anchor, owner-confirmed 2026-09-05 (formerly
 * `lib/mobilePricing.ts`, deleted by migration 036).
 *
 * Both tiers work out to the same $62.50/child: the Signature tier buys more
 * time and more stations, not a higher per-head rate. Worth keeping true if
 * these numbers ever move — `perChild()` exists to check it.
 *
 * Competitive context (docs/marketing/mobile-pricing-analysis.md): Emily's
 * Slime Party is $499 for 12 (60 min, one craft); The Slime Machine is $675 for
 * 11 but adds tax + a 20% MANDATORY gratuity (~$810 real). We add neither,
 * which is why "what we quote is what you pay" belongs next to the price.
 */
export const FALLBACK_MOBILE_TIERS: MobileTier[] = [
  {
    name: 'Entry',
    price: 500,
    minutes: 60,
    kids: 8,
    tagline: 'One craft, start to finish',
    includes: [
      'One craft station of your choice',
      'A dedicated host who runs the whole activity',
      'All supplies, aprons and surface covers brought in',
      'A finished keepsake for every child',
      'Full setup and cleanup — we leave it as we found it',
    ],
  },
  {
    name: 'Signature',
    price: 750,
    minutes: 90,
    kids: 12,
    tagline: 'Our most-booked mobile party',
    popular: true,
    includes: [
      'Hair tinsel for every guest',
      'Glitter tattoos',
      'Your choice of craft station',
      'A dedicated host running every station',
      'All supplies, aprons and surface covers brought in',
      'A finished keepsake for every child',
      'Full setup and cleanup — we leave it as we found it',
    ],
  },
]

export const FALLBACK_MOBILE_BANDS: MobileBands = {
  baseCents: 40000,
  tier2SurchargeCents: 15000,
  tier3SurchargeCents: 15000,
  tier2GuestThreshold: 18,
  tier3GuestThreshold: 27,
}

export const FALLBACK_MOBILE_POLICY: MobilePolicy = {
  minGuests: 6,
  extraChildCents: 3500,
  freeTravelMiles: 20,
}

export const FALLBACK_STUDIO_RATES: StudioRates = {
  weekendBaseCents: 60000,
  weekdayBaseCents: 47500,
  weekendAddlHourCents: 15000,
  weekdayAddlHourCents: 10000,
  weekendFullDayCents: 97500,
  weekdayFullDayCents: 70000,
  minHours: 3,
  securityDepositCents: 50000,
}

export const FALLBACK_GUEST_RULES: GuestRules = {
  includedGuests: 10,
  extraGuestCents: 3500,
  miniPartyDiscountCents: 20000,
  miniPartyMaxGuests: 6,
}

/**
 * The curated station list from `.claude/skills/party-quote-invoice/SKILL.md`.
 * Deliberately NOT a mirror of /mobile-party's menu — Construction Hat Craft
 * and Life Size Barbie Box are on the website but were cut from this list.
 */
export const FALLBACK_MOBILE_STATIONS: MobileStation[] = [
  ['Mobile Spa Party', '🧖'], ['Hair Tinsel', '✨'], ['Glitter Freckles', '💫'],
  ['Canvas Bag Bar', '👜'], ['Manicures', '💅'], ['Glitter Tattoos', '🦋'],
  ['Slime', '🟢'], ['Bracelet Making', '📿'], ['Drip Paint Balloon Dogs', '🐩'],
  ['Lip-Gloss Charms', '💋'], ['Trucker Hat Bar', '🧢'], ['Sand Art', '🏖️'],
  ['Canvas Painting', '🎨'], ['Photobooth', '📸'], ['Adopt a Puppy', '🐶'],
  ['KPop Backdrop', '🎤'], ['Sunglass Craft', '🕶️'], ['Decoden Crafts', '🎀'],
  ['Seashell Decorating', '🐚'], ['Perfume Making', '🌸'],
  ['Hair Brush Decorating', '💇'], ['Glam Makeup', '💄'],
  ['Jelly Tote Decorating', '👛'], ['Beaded Braids', '🪢'],
  ['Decorate-Your-Own Microphone', '🎙️'], ['Pirate Sword Decorating', '⚔️'],
].map(([name, emoji]) => ({ name, emoji, priceLabel: 'Ask', priceCents: 0 }))

export const FALLBACK_CATALOG: PricingCatalog = {
  mobileTiers: FALLBACK_MOBILE_TIERS,
  mobileBands: FALLBACK_MOBILE_BANDS,
  mobilePolicy: FALLBACK_MOBILE_POLICY,
  mobileStations: FALLBACK_MOBILE_STATIONS,
  studioRates: FALLBACK_STUDIO_RATES,
  guestRules: FALLBACK_GUEST_RULES,
  fromDb: false,
  fallbackFields: [],
}

// ───────────────────────────────────────────────────────────────────────────
// Row → catalog (pure, so the mapping itself is unit-testable)
// ───────────────────────────────────────────────────────────────────────────

function keyOf(row: CatalogRow): string {
  const k = (row.metadata as { catalog_key?: unknown } | null | undefined)?.catalog_key
  return typeof k === 'string' ? k : ''
}

/** A metadata number, e.g. the guest ceiling on a policy row. */
function metaNum(row: CatalogRow | undefined, field: string): number | null {
  const v = (row?.metadata as Record<string, unknown> | null | undefined)?.[field]
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function metaStrings(row: CatalogRow, field: string): string[] | null {
  const v = (row.metadata as Record<string, unknown> | null | undefined)?.[field]
  if (!Array.isArray(v)) return null
  const out = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
  return out.length ? out : null
}

/**
 * `price_cents` where it is a real figure, else the fallback. A row whose price
 * is 0 is only trusted when 0 is meaningful (a policy/label row); for a rate we
 * would rather show last month's number than free studio hire.
 */
function cents(row: CatalogRow | undefined, fallback: number, overridden?: string[]): number {
  if (!row) return fallback
  const n = Number(row.price_cents)
  if (Number.isFinite(n) && n > 0) return n
  // A row that EXISTS and prices at 0 is ambiguous, and the ambiguity is not
  // resolvable here: `studio_weekend_base = 0` is certainly a broken row, but
  // `mini_party_discount = 0`, `theme_extra_guest = 0` or `mobile_extra_child = 0`
  // are all things Adam could legitimately mean ("we don't charge that any
  // more"), and this function silently restores the old number in every case.
  // Preserving that behaviour on purpose — quietly re-introducing a $200
  // discount is bad, but silently making a studio rental free is worse, and
  // which of the two a given key deserves is Adam's call, not this module's.
  // What it must not do is stay invisible, so the override is recorded: it is
  // reported by `fallbackFields` and it stops the result being cached.
  overridden?.push(keyOf(row) || row.name)
  return fallback
}

/**
 * Build a catalog from `pricing_items` rows. Anything missing or malformed
 * falls back to the compiled constant rather than to zero — see the module
 * header. `fromDb` is true only when every group was fully populated.
 */
export function catalogFromRows(rows: CatalogRow[]): PricingCatalog {
  const byKey = new Map<string, CatalogRow>()
  for (const row of rows) {
    const k = keyOf(row)
    if (k && !byKey.has(k)) byKey.set(k, row)
  }
  const get = (k: string) => byKey.get(k)
  // Keys whose existing row priced at 0 and was overridden by the constant.
  const overridden: string[] = []

  // ── Published tiers. A tier is only usable with a price AND an includes
  // list, so a half-written row falls back rather than rendering a blank card.
  const tiers: MobileTier[] = []
  for (const [key, fallback] of [
    ['mobile_tier_entry', FALLBACK_MOBILE_TIERS[0]],
    ['mobile_tier_signature', FALLBACK_MOBILE_TIERS[1]],
  ] as const) {
    const row = get(key)
    const includes = row ? metaStrings(row, 'includes') : null
    const priceCents = row ? Number(row.price_cents) : NaN
    if (!row || !includes || !Number.isFinite(priceCents) || priceCents <= 0) {
      tiers.push(fallback)
      continue
    }
    const meta = (row.metadata ?? {}) as Record<string, unknown>
    tiers.push({
      name: typeof meta.tier === 'string' ? meta.tier : fallback.name,
      price: Math.round(priceCents / 100),
      minutes: metaNum(row, 'minutes') ?? fallback.minutes,
      kids: metaNum(row, 'kids') ?? fallback.kids,
      tagline: typeof meta.tagline === 'string' ? meta.tagline : row.description || fallback.tagline,
      includes,
      popular: meta.popular === true,
    })
  }

  const bands: MobileBands = {
    baseCents: cents(get('mobile_planner_base'), FALLBACK_MOBILE_BANDS.baseCents, overridden),
    tier2SurchargeCents: cents(get('mobile_planner_tier2'), FALLBACK_MOBILE_BANDS.tier2SurchargeCents),
    tier3SurchargeCents: cents(get('mobile_planner_tier3'), FALLBACK_MOBILE_BANDS.tier3SurchargeCents),
    tier2GuestThreshold:
      metaNum(get('mobile_planner_tier2'), 'guest_threshold') ?? FALLBACK_MOBILE_BANDS.tier2GuestThreshold,
    tier3GuestThreshold:
      metaNum(get('mobile_planner_tier3'), 'guest_threshold') ?? FALLBACK_MOBILE_BANDS.tier3GuestThreshold,
  }

  const mobilePolicy: MobilePolicy = {
    minGuests: metaNum(get('mobile_min_guests'), 'value') ?? FALLBACK_MOBILE_POLICY.minGuests,
    extraChildCents: cents(get('mobile_extra_child'), FALLBACK_MOBILE_POLICY.extraChildCents, overridden),
    freeTravelMiles: metaNum(get('mobile_free_travel_miles'), 'value') ?? FALLBACK_MOBILE_POLICY.freeTravelMiles,
  }

  const studioRates: StudioRates = {
    weekendBaseCents: cents(get('studio_weekend_base'), FALLBACK_STUDIO_RATES.weekendBaseCents, overridden),
    weekdayBaseCents: cents(get('studio_weekday_base'), FALLBACK_STUDIO_RATES.weekdayBaseCents, overridden),
    weekendAddlHourCents: cents(get('studio_weekend_addl_hour'), FALLBACK_STUDIO_RATES.weekendAddlHourCents, overridden),
    weekdayAddlHourCents: cents(get('studio_weekday_addl_hour'), FALLBACK_STUDIO_RATES.weekdayAddlHourCents, overridden),
    weekendFullDayCents: cents(get('studio_weekend_full_day'), FALLBACK_STUDIO_RATES.weekendFullDayCents, overridden),
    weekdayFullDayCents: cents(get('studio_weekday_full_day'), FALLBACK_STUDIO_RATES.weekdayFullDayCents, overridden),
    minHours: metaNum(get('studio_min_hours'), 'value') ?? FALLBACK_STUDIO_RATES.minHours,
    securityDepositCents: cents(get('studio_security_hold'), FALLBACK_STUDIO_RATES.securityDepositCents, overridden),
  }

  const guestRules: GuestRules = {
    includedGuests: metaNum(get('theme_included_guests'), 'value') ?? FALLBACK_GUEST_RULES.includedGuests,
    extraGuestCents: cents(get('theme_extra_guest'), FALLBACK_GUEST_RULES.extraGuestCents, overridden),
    miniPartyDiscountCents: cents(get('mini_party_discount'), FALLBACK_GUEST_RULES.miniPartyDiscountCents, overridden),
    miniPartyMaxGuests: metaNum(get('mini_party_max_guests'), 'value') ?? FALLBACK_GUEST_RULES.miniPartyMaxGuests,
  }

  const stationRows = rows
    .filter(r => r.category === 'mobile-station')
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const mobileStations: MobileStation[] = stationRows.length
    ? stationRows.map(r => ({
        name: r.name,
        emoji: r.emoji ?? null,
        priceLabel: r.price_label ?? null,
        priceCents: Number(r.price_cents) || 0,
      }))
    : FALLBACK_MOBILE_STATIONS

  // Every group has to have come from a row for this to be a DB read. Checked
  // by key so a partially-seeded table is honestly reported as a fallback.
  const REQUIRED_KEYS = [
    'mobile_tier_entry', 'mobile_tier_signature',
    'mobile_planner_base', 'mobile_planner_tier2', 'mobile_planner_tier3',
    'mobile_min_guests', 'mobile_extra_child', 'mobile_free_travel_miles',
    'studio_weekend_base', 'studio_weekday_base',
    'studio_weekend_addl_hour', 'studio_weekday_addl_hour',
    'studio_weekend_full_day', 'studio_weekday_full_day',
    'studio_min_hours', 'studio_security_hold',
    'theme_included_guests', 'theme_extra_guest',
    'mini_party_discount', 'mini_party_max_guests',
  ]
  const fromDb = REQUIRED_KEYS.every(k => byKey.has(k)) && stationRows.length > 0

  return {
    mobileTiers: tiers, mobileBands: bands, mobilePolicy, mobileStations,
    studioRates, guestRules, fromDb, fallbackFields: overridden,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Loader
// ───────────────────────────────────────────────────────────────────────────

/**
 * Short in-process cache. The catalog changes when Adam edits a price, which is
 * a handful of times a year, but it is read on nearly every page render — 26
 * town pages alone. 60s keeps an edit visible within a minute without making a
 * query per request. Per-container, so a deploy clears it.
 */
const CACHE_TTL_MS = 60_000
let cache: { at: number; catalog: PricingCatalog } | null = null

/** Drop the cache. Exported for tests and for an admin price edit. */
export function clearPricingCatalogCache(): void {
  cache = null
}

/**
 * Load the catalog. NEVER throws and never returns zeroed prices: on any
 * failure it logs and returns `FALLBACK_CATALOG`, which is the set of values
 * that was compiled in before migration 036. A marketing page must render a
 * price even when Supabase is unreachable.
 */
export async function loadPricingCatalog(supabase?: Supa): Promise<PricingCatalog> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.catalog

  try {
    const db = supabase ?? getSupabase()
    const { data, error } = await db
      .from('pricing_items')
      .select(CATALOG_ROW_COLUMNS)
      .eq('is_active', true)
      .in('category', CATALOG_CATEGORIES as unknown as string[])
      .order('sort_order', { ascending: true })

    if (error) {
      console.error('loadPricingCatalog error (using fallback):', error.message)
      return FALLBACK_CATALOG
    }

    const catalog = catalogFromRows((data ?? []) as CatalogRow[])
    // Only cache a real read. Caching a fallback would hold the wrong prices
    // for a minute after the DB comes back.
    //
    // `fromDb` alone was not enough to make that true: it asks whether every
    // required KEY was present, so a row that exists and prices at 0 left
    // `fromDb` true while `cents()` quietly served the compiled constant — a
    // fallback, cached for 60s, contradicting the rule this comment states.
    // Both conditions now have to hold.
    if (catalog.fromDb && catalog.fallbackFields.length === 0) {
      cache = { at: Date.now(), catalog }
    } else if (catalog.fallbackFields.length) {
      console.error('loadPricingCatalog: rows priced at 0 overridden by fallback:', catalog.fallbackFields.join(', '))
    }
    return catalog
  } catch (err) {
    console.error('loadPricingCatalog threw (using fallback):', err)
    return FALLBACK_CATALOG
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Derived helpers
// ───────────────────────────────────────────────────────────────────────────

/** Both tiers should price out the same per child — a useful thing to keep honest. */
export function perChild(tier: MobileTier): number {
  return Math.round((tier.price / tier.kids) * 100) / 100
}

/** The planner's mobile base for a guest count, bands applied cumulatively. */
export function mobileBaseCentsFor(bands: MobileBands, guestCount: number): number {
  let base = bands.baseCents
  if (guestCount > bands.tier2GuestThreshold) base += bands.tier2SurchargeCents
  if (guestCount > bands.tier3GuestThreshold) base += bands.tier3SurchargeCents
  return base
}
