/**
 * Standalone patch pricing for the ESM Sharks storefront.
 *
 * Patches are sold two ways now, and only ONE of them is tiered:
 *
 *  - As the decoration on a hat, tote or pouch. Every product is a colour AND a
 *    patch, so a hat line is "Navy Trucker Hat — Circle Patch" at the flat
 *    product price. The patch costs nothing extra; it is part of what the item
 *    IS.
 *  - Loose, on their own, at $8 — or 3 for $20, and by Adam's rule (2026-09-16)
 *    that three MIX AND MATCH: two circles and a script is three patches and
 *    therefore $20.
 *
 * That mixing is the whole reason this file exists. The page used to tier each
 * patch card on its OWN quantity, so 2 circle + 1 script rang up as $24 while
 * both cards advertised "3 for $20" — the page disagreeing with itself, and
 * since the server takes `line_total` from the browser, the wrong number is the
 * one that gets banked. The tier is a property of the GROUP, so the group is
 * what this module prices.
 *
 * It also emits the group as a SINGLE order line. Splitting $20 across two
 * design lines would mean inventing per-line prices that do not exist ($13.33 /
 * $6.67), and those are the numbers a PTO volunteer would have to reconcile. One
 * line that names its own composition — "Patches (2x Circle, 1x Script)" — is
 * both the honest arithmetic and a packing instruction.
 *
 * Everything is computed in whole CENTS. `6.65 * 3` in floating point is
 * 19.949999999999996, and this figure is compared for equality against the
 * server's own sum in `screenCmCheerTotals`; a hundredth of a cent of drift
 * there writes a spurious "did not match the items" note onto a real order.
 *
 * NOTE: CM Cheer is NOT a caller. That page has its own `el.id === 'qty-patch'`
 * literal and one patch design, and it has 21 real orders priced under it. This
 * module must not be wired into it without pricing those against it first.
 */

/** List price of a single loose patch. */
export const PATCH_UNIT_PRICE_CENTS = 800
/** Buy this many (across any mix of designs) and the tier price applies. */
export const PATCH_TIER_QTY = 3
/** What those first three cost together. */
export const PATCH_TIER_PRICE_CENTS = 2000
/** Each patch beyond the third, at the tier's implied unit rate. */
export const PATCH_EXTRA_PRICE_CENTS = 665
/** What a patch costs us, the same for either design. */
export const PATCH_COST_CENTS = 500

/** One design's share of a loose-patch order. */
export interface PatchSelection {
  /** The design as a human reads it on the page — "Circle", "Script". */
  design: string
  qty: number
}

/** An entry in the order's `itemsData`, in dollars, as the API expects it. */
export interface FundraiserLine {
  name: string
  qty: number
  unit_price: number
  line_total: number
  cost_per_unit: number
}

/**
 * What `qty` loose patches cost, in cents, regardless of how they are split
 * across designs. Below the tier they are simply $8 each.
 */
export function patchPriceCents(qty: number): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0
  const n = Math.floor(qty)
  if (n >= PATCH_TIER_QTY) {
    return PATCH_TIER_PRICE_CENTS + (n - PATCH_TIER_QTY) * PATCH_EXTRA_PRICE_CENTS
  }
  return n * PATCH_UNIT_PRICE_CENTS
}

/** The same figure in dollars, for the page's running total. */
export function patchPriceDollars(qty: number): number {
  return patchPriceCents(qty) / 100
}

/** Total loose patches across every design. */
export function totalPatchQty(selections: PatchSelection[]): number {
  return selections.reduce(
    (n, s) => n + (Number.isFinite(s.qty) && s.qty > 0 ? Math.floor(s.qty) : 0),
    0,
  )
}

/**
 * What the one loose-patch line is called.
 *
 * One design keeps its own name, because "2x Circle Patch" is already complete.
 * A mix has to spell itself out, since "3x Patches" alone would not tell anyone
 * which three to put in the envelope.
 */
export function patchLineName(selections: PatchSelection[]): string {
  const picked = selections.filter((s) => Number.isFinite(s.qty) && s.qty > 0)
  if (picked.length === 0) return ''
  if (picked.length === 1) return `${picked[0].design} Patch`
  return `Patches (${picked.map((s) => `${Math.floor(s.qty)}x ${s.design}`).join(', ')})`
}

/**
 * The single order line for every loose patch in the order, or null if none
 * were selected.
 *
 * `unit_price` is the LIST price, not `line_total / qty`: at the tier those
 * differ, and the order book shows both. Reporting $6.67 as the unit price of a
 * patch we advertise at $8 would make the discount invisible.
 */
export function patchOrderLine(selections: PatchSelection[]): FundraiserLine | null {
  const qty = totalPatchQty(selections)
  if (qty <= 0) return null
  return {
    name: patchLineName(selections),
    qty,
    unit_price: PATCH_UNIT_PRICE_CENTS / 100,
    line_total: patchPriceCents(qty) / 100,
    cost_per_unit: PATCH_COST_CENTS / 100,
  }
}

/**
 * Whether a quantity input is a LOOSE patch, and so belongs to the tier.
 *
 * This is an explicit opt-in marker (`data-tier="patch"`), not a test on the
 * element's id. It used to be `id.startsWith('qty-patch')`, and now that every
 * product carries a patch there are ids like `qty-hat-navy-circle` in the same
 * page — an id-prefix rule is one unlucky rename away from charging a $25 hat
 * at a $6.65 patch tier. A product row has to ASK for the tier to get it, and
 * no product row does.
 */
export function isLoosePatchInput(el: { dataset?: Record<string, string | undefined> }): boolean {
  return el.dataset?.tier === 'patch'
}
