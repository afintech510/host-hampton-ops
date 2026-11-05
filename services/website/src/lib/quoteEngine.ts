/**
 * The party quote engine: ONE implementation of "what does this party cost, and
 * what are its line items".
 *
 * It was inline in `app/party-builder/PartyBuilderContent.tsx` (`activityCost`,
 * `mobileActivityCost`, `total`, `getLineItems` and the constants beside them).
 * The builder now imports it, which is the point: anything else that quotes —
 * the MCP `get_quote` tool, the website Host Assistant, the admin overlay —
 * calls the same functions, so the bot and the planner cannot disagree, and
 * the model never supplies a number. Prices come from `pricing_items` /
 * `PricingCatalog`; nothing here is a literal price except the three activity
 * rates below, which are the planner's published rules.
 *
 * Pure: no I/O, no React. `loadQuoteItems` is the only part that reads the DB,
 * and it reads exactly what the planner's server page reads.
 */

import { mobileBaseCentsFor, type PricingCatalog } from '@/lib/pricingCatalog'
import type { PricingItem } from '@/components/QuoteBuilder/types'

/* ── Activity rules (the planner's published pricing) ──
   Themes >= $950 include 1 premium activity. Themes < $950 (e.g. $850) include
   0; the first premium then costs a flat $100 (the same effective price as
   picking the $950 theme outright). A second premium, with any theme, is
   +$25/person × (guests+1). Standard: 1st & 2nd included, 3rd = $5/person ×
   (guests+1), max 3. Mobile parties bill every activity per person. */
export const PREMIUM_EXTRA_CENTS = 2500
export const PREMIUM_UPGRADE_FLAT_CENTS = 10000
export const THEME_PREMIUM_INCLUDED_THRESHOLD = 95000
export const STANDARD_EXTRA_CENTS = 500
export const MAX_PREMIUM_ACTIVITIES = 2
export const MAX_STANDARD_ACTIVITIES = 3

export interface CustomItem {
  id?: string
  name: string
  price_cents: number
  quantity: number
  guest_multiplied: boolean
  is_discount?: boolean
}

export interface QuoteItems {
  byId: Map<string, PricingItem>
  premiumIds: Set<string>
  standardIds: Set<string>
}

export interface QuoteSelection {
  locationType: 'studio' | 'mobile'
  guestCount: number
  isMiniParty: boolean
  themeId: string | null
  /** In the order the customer picked them: "the first premium" is order-dependent. */
  activityIds: string[]
  foodIds: string[]
  dessertIds: string[]
  beverageIds: string[]
  decorIds: string[]
  entertainmentIds: string[]
  partyAddOnIds: string[]
  foodQty?: Record<string, number>
  decorQty?: Record<string, number>
  customItems?: CustomItem[]
  /** Mobile only: the travel fee from the mileage lookup. */
  travelFeeCents?: number
}

export interface QuoteLineItem {
  name: string
  category: string
  quantity: number
  unit_price_cents: number
  price_type: string
  guest_multiplied: boolean
  pricing_item_id?: string
}

export interface Quote {
  totalCents: number
  lineItems: QuoteLineItem[]
  effectiveGuestCount: number
  extraGuests: number
  /** Studio: the theme's price after any mini discount. Mobile: the package (base + travel). */
  basePriceCents: number
  activityCostCents: number
}

const qtyOf = (m: Record<string, number> | undefined, id: string) => m?.[id] ?? 1

export function buildQuoteItems(groups: {
  themes: PricingItem[]; premiumActivities: PricingItem[]; standardActivities: PricingItem[]; food: PricingItem[]; desserts: PricingItem[]
  beverages: PricingItem[]; decor: PricingItem[]; entertainment: PricingItem[]; partyAddOns: PricingItem[]
}): QuoteItems {
  const byId = new Map<string, PricingItem>()
  for (const list of Object.values(groups)) for (const i of list) byId.set(i.id, i)
  return {
    byId,
    premiumIds: new Set(groups.premiumActivities.map(a => a.id)),
    standardIds: new Set(groups.standardActivities.map(a => a.id)),
  }
}

export function effectiveGuests(cat: PricingCatalog, sel: Pick<QuoteSelection, 'guestCount' | 'isMiniParty'>): number {
  return sel.isMiniParty ? Math.min(sel.guestCount, cat.guestRules.miniPartyMaxGuests) : sel.guestCount
}

function pickedActivities(items: QuoteItems, sel: QuoteSelection) {
  return {
    premium: sel.activityIds.filter(id => items.premiumIds.has(id)),
    standard: sel.activityIds.filter(id => items.standardIds.has(id)),
  }
}

/** How many premium activities the selected theme includes for free (computed from its price, so admin can move the threshold in the DB). */
export function includedPremiumCount(items: QuoteItems, themeId: string | null): number {
  const theme = themeId ? items.byId.get(themeId) : null
  return theme && theme.price_cents >= THEME_PREMIUM_INCLUDED_THRESHOLD ? 1 : 0
}

/** Studio activity surcharges. */
export function activityCostCents(cat: PricingCatalog, items: QuoteItems, sel: QuoteSelection): number {
  const eff = effectiveGuests(cat, sel)
  const { premium, standard } = pickedActivities(items, sel)
  const multiplier = eff + 1 // includes the birthday child
  let cost = 0
  if (premium.length >= 1 && includedPremiumCount(items, sel.themeId) < 1) cost += PREMIUM_UPGRADE_FLAT_CENTS
  if (premium.length >= 2) cost += PREMIUM_EXTRA_CENTS * multiplier
  if (standard.length >= 3) cost += STANDARD_EXTRA_CENTS * multiplier
  return cost
}

/** Mobile: the per-person rate of one activity (a priced item bills its own price; an "included" one bills the category rate). */
export function mobileActivityRate(items: QuoteItems, id: string): number {
  const item = items.byId.get(id)
  if (!item) return 0
  let rate = item.price_cents
  if (rate <= 0) {
    if (items.premiumIds.has(id)) rate = PREMIUM_EXTRA_CENTS
    else if (items.standardIds.has(id)) rate = STANDARD_EXTRA_CENTS
  }
  return rate
}

export function mobileActivityCostCents(cat: PricingCatalog, items: QuoteItems, sel: QuoteSelection): number {
  const eff = effectiveGuests(cat, sel)
  let sum = 0
  for (const id of sel.activityIds) {
    if (!items.byId.has(id)) continue
    sum += mobileActivityRate(items, id) * eff
  }
  return sum
}

export function mobilePackageCents(cat: PricingCatalog, sel: QuoteSelection): number {
  return mobileBaseCentsFor(cat.mobileBands, effectiveGuests(cat, sel)) + (sel.travelFeeCents ?? 0)
}

const perPersonOrFlat = (item: PricingItem, eff: number, qty = 1) =>
  item.price_type === 'per_person' ? item.price_cents * eff * qty : item.price_cents * qty

export function totalCents(cat: PricingCatalog, items: QuoteItems, sel: QuoteSelection): number {
  const eff = effectiveGuests(cat, sel)
  const customs = sel.customItems ?? []
  let sum = 0

  if (sel.locationType === 'mobile') {
    // Composite package (base tier + travel) + every activity per person +
    // entertainment + party extras + admin custom items. Theme, food, drinks,
    // desserts and decor are hidden in mobile mode.
    sum += mobilePackageCents(cat, sel)
    sum += mobileActivityCostCents(cat, items, sel)
    for (const id of sel.entertainmentIds) { const i = items.byId.get(id); if (i) sum += perPersonOrFlat(i, eff) }
    for (const id of sel.partyAddOnIds) { const i = items.byId.get(id); if (i) sum += perPersonOrFlat(i, eff) }
    for (const ci of customs) {
      if (ci.id === 'mobile-cupcakes') continue // the legacy auto-item
      sum += ci.guest_multiplied ? ci.price_cents * ci.quantity * eff : ci.price_cents * ci.quantity
    }
    return Math.max(0, sum)
  }

  const { included, extra } = { included: cat.guestRules.includedGuests, extra: cat.guestRules.extraGuestCents }
  const extraGuests = Math.max(0, eff - included)
  const theme = sel.themeId ? items.byId.get(sel.themeId) : null
  if (theme) sum += theme.price_cents
  if (sel.isMiniParty && sel.themeId) sum -= cat.guestRules.miniPartyDiscountCents
  sum += extraGuests * extra
  sum += activityCostCents(cat, items, sel)
  for (const id of sel.foodIds) { const i = items.byId.get(id); if (i) sum += perPersonOrFlat(i, eff, qtyOf(sel.foodQty, id)) }
  for (const id of [...sel.dessertIds, ...sel.beverageIds, ...sel.entertainmentIds, ...sel.partyAddOnIds]) {
    const i = items.byId.get(id); if (i) sum += perPersonOrFlat(i, eff)
  }
  for (const id of sel.decorIds) {
    const i = items.byId.get(id); if (!i) continue
    // Decor: a per-person item ignores the quantity (as the planner always has).
    sum += i.price_type === 'per_person' ? i.price_cents * eff : i.price_cents * qtyOf(sel.decorQty, id)
  }
  for (const ci of customs) sum += ci.guest_multiplied ? ci.price_cents * ci.quantity * eff : ci.price_cents * ci.quantity
  return Math.max(0, sum)
}

/** The tier label printed on the mobile package line (it ends up on the customer's invoice). */
export function mobileTierLabel(cat: PricingCatalog, eff: number): string {
  const b = cat.mobileBands
  return eff > b.tier3GuestThreshold
    ? ` (${b.tier3GuestThreshold + 1}+ guests)`
    : eff > b.tier2GuestThreshold
      ? ` (${b.tier2GuestThreshold + 1}–${b.tier3GuestThreshold} guests)`
      : ` (up to ${b.tier2GuestThreshold} guests)`
}

export function buildLineItems(cat: PricingCatalog, items: QuoteItems, sel: QuoteSelection): QuoteLineItem[] {
  const eff = effectiveGuests(cat, sel)
  const lineItems: QuoteLineItem[] = []
  const customs = sel.customItems ?? []
  const customLine = (ci: CustomItem): QuoteLineItem => ({
    name: ci.name, category: ci.is_discount ? 'discount' : 'custom', quantity: ci.quantity, unit_price_cents: ci.price_cents,
    price_type: ci.guest_multiplied ? 'per_person' : 'flat', guest_multiplied: ci.guest_multiplied,
  })
  const priced = (item: PricingItem, category: string, quantity = 1): QuoteLineItem => ({
    name: item.name, category, quantity, unit_price_cents: item.price_cents,
    price_type: item.price_type === 'per_person' ? 'per_person' : 'flat', guest_multiplied: item.price_type === 'per_person', pricing_item_id: item.id,
  })

  if (sel.locationType === 'mobile') {
    lineItems.push({
      name: `Mobile Party Package${mobileTierLabel(cat, eff)}`, category: 'mobile-package', quantity: 1,
      unit_price_cents: mobilePackageCents(cat, sel), price_type: 'flat', guest_multiplied: false,
    })
    for (const id of sel.activityIds) {
      const item = items.byId.get(id); if (!item) continue
      lineItems.push({
        name: item.name, category: 'activity-add-on', quantity: 1, unit_price_cents: mobileActivityRate(items, id),
        price_type: 'per_person', guest_multiplied: true, pricing_item_id: item.id,
      })
    }
    for (const id of sel.entertainmentIds) { const i = items.byId.get(id); if (i) lineItems.push(priced(i, 'entertainment-add-on')) }
    for (const id of sel.partyAddOnIds) { const i = items.byId.get(id); if (i) lineItems.push(priced(i, 'extra')) }
    for (const ci of customs) { if (ci.id !== 'mobile-cupcakes') lineItems.push(customLine(ci)) }
    return lineItems
  }

  const theme = sel.themeId ? items.byId.get(sel.themeId) : null
  const extraGuests = Math.max(0, eff - cat.guestRules.includedGuests)
  if (theme) {
    let themePriceCents = theme.price_cents
    if (sel.isMiniParty) themePriceCents = Math.max(0, themePriceCents - cat.guestRules.miniPartyDiscountCents)
    lineItems.push({ name: theme.name, category: 'theme', quantity: 1, unit_price_cents: themePriceCents, price_type: 'flat', guest_multiplied: false, pricing_item_id: theme.id })
  }
  if (extraGuests > 0) {
    lineItems.push({ name: 'Additional Guests', category: 'theme', quantity: extraGuests, unit_price_cents: cat.guestRules.extraGuestCents, price_type: 'flat', guest_multiplied: false })
  }

  const { premium, standard } = pickedActivities(items, sel)
  const aMult = eff + 1
  const includedPremium = includedPremiumCount(items, sel.themeId)
  premium.forEach((id, idx) => {
    const item = items.byId.get(id); if (!item) return
    let unitPriceCents: number
    let suffix: string
    if (idx === 0) {
      if (includedPremium >= 1) { unitPriceCents = 0; suffix = ' (1st premium — included)' }
      else { unitPriceCents = PREMIUM_UPGRADE_FLAT_CENTS; suffix = ' (1st premium — +$100 upgrade)' }
    } else { unitPriceCents = PREMIUM_EXTRA_CENTS * aMult; suffix = ' (2nd premium — extra)' }
    lineItems.push({ name: item.name + suffix, category: 'activity-add-on', quantity: 1, unit_price_cents: unitPriceCents, price_type: 'flat', guest_multiplied: false, pricing_item_id: item.id })
  })
  standard.forEach((id, idx) => {
    const item = items.byId.get(id); if (!item) return
    lineItems.push({
      name: item.name + (idx < 2 ? ' (included)' : ' (3rd standard — extra)'), category: 'activity-add-on', quantity: 1,
      unit_price_cents: idx < 2 ? 0 : STANDARD_EXTRA_CENTS * aMult, price_type: 'flat', guest_multiplied: false, pricing_item_id: item.id,
    })
  })

  const addFrom = (ids: string[], category: string, qty?: Record<string, number>) => {
    for (const id of ids) { const i = items.byId.get(id); if (i) lineItems.push(priced(i, category, qtyOf(qty, id))) }
  }
  addFrom(sel.foodIds, 'food-add-on', sel.foodQty)
  addFrom(sel.dessertIds, 'dessert-add-on')
  addFrom(sel.beverageIds, 'beverage-add-on')
  addFrom(sel.decorIds, 'decor-add-on', sel.decorQty)
  addFrom(sel.entertainmentIds, 'entertainment-add-on')
  addFrom(sel.partyAddOnIds, 'extra')
  for (const ci of customs) lineItems.push(customLine(ci))
  return lineItems
}

/** Everything at once — what a non-React caller (MCP, chat, overlay) wants. */
export function computeQuote(cat: PricingCatalog, items: QuoteItems, sel: QuoteSelection): Quote {
  const eff = effectiveGuests(cat, sel)
  const theme = sel.themeId ? items.byId.get(sel.themeId) : null
  return {
    totalCents: totalCents(cat, items, sel),
    lineItems: buildLineItems(cat, items, sel),
    effectiveGuestCount: eff,
    extraGuests: Math.max(0, eff - cat.guestRules.includedGuests),
    basePriceCents: sel.locationType === 'mobile'
      ? mobilePackageCents(cat, sel)
      : Math.max(0, (theme?.price_cents ?? 0) - (sel.isMiniParty && theme ? cat.guestRules.miniPartyDiscountCents : 0)),
    activityCostCents: sel.locationType === 'mobile' ? mobileActivityCostCents(cat, items, sel) : activityCostCents(cat, items, sel),
  }
}
