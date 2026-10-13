/**
 * The ESM Sharks price list, on the SERVER's side of the line.
 *
 * `/esm-sharks` keeps its prices in JSX (`PRODUCTS` in the page) and the public
 * order route audits the browser's own arithmetic rather than re-deriving it —
 * there was no catalogue to derive from. The organizer's paper-order entry has no
 * such excuse: it is an authenticated admin action, so the server prices it from
 * quantities alone and never trusts a price from the client.
 *
 * That makes this a SECOND copy of the list. The drift test
 * (`fundraiserCatalog.test.ts`) reads the page source and fails if a price, a
 * cost, a colour, a patch or an item NAME disagrees, because the order book's
 * "Items Sold" tile groups by name and a paper order spelled differently from an
 * online one would show up as a separate product.
 *
 * Pure and client-safe: the order-book form imports it for its running total, so
 * the figure an organizer sees is computed by the same function the server uses.
 */

import {
  patchOrderLine,
  type FundraiserLine,
  type PatchSelection,
} from '@/lib/fundraiserPatches'

export interface CatalogProduct {
  key: string
  title: string
  priceCents: number
  costCents: number
}

export interface CatalogOption { key: string; label: string }

/** Order and spelling mirror `/esm-sharks`. */
export const ESM_PRODUCTS: CatalogProduct[] = [
  { key: 'hat', title: 'Trucker Hat', priceCents: 2500, costCents: 1875 },
  { key: 'tote', title: 'Canvas Tote', priceCents: 4000, costCents: 3000 },
  { key: 'pouch', title: 'Zip Pouch', priceCents: 2500, costCents: 1875 },
]
export const ESM_COLORS: CatalogOption[] = [
  { key: 'navy', label: 'Navy' },
  { key: 'silver', label: 'Silver' },
]
export const ESM_PATCHES: CatalogOption[] = [
  { key: 'circle', label: 'Circle' },
  { key: 'script', label: 'Script' },
]

/**
 * One quantity per product × colour × patch, keyed `hat-navy-circle`, plus the
 * loose patches under `loose-circle` / `loose-script`.
 */
export type PaperQuantities = Record<string, number>

export const MAX_PAPER_LINE_QTY = 50

export function variantKey(product: string, color: string, patch: string): string {
  return `${product}-${color}-${patch}`
}
export function looseKey(patch: string): string {
  return `loose-${patch}`
}

/** What a human reads in the order book — identical to the online form's. */
export function variantName(p: CatalogProduct, c: CatalogOption, patch: CatalogOption): string {
  return `${c.label} ${p.title} — ${patch.label} Patch`
}

export type PricedPaperOrder =
  | { ok: true; lines: FundraiserLine[]; totalCents: number; costCents: number }
  | { ok: false; reason: string }

const usd = (cents: number) => cents / 100

/**
 * Price a paper order from quantities. Unknown keys are REFUSED, not skipped: a
 * dropped line on a form that is about to be shredded is an order nobody can
 * reconstruct.
 */
export function priceEsmPaperOrder(quantities: unknown): PricedPaperOrder {
  if (typeof quantities !== 'object' || quantities === null || Array.isArray(quantities)) {
    return { ok: false, reason: 'quantities must be an object' }
  }
  const q = quantities as Record<string, unknown>

  const known = new Set<string>()
  for (const p of ESM_PRODUCTS) for (const c of ESM_COLORS) for (const patch of ESM_PATCHES) {
    known.add(variantKey(p.key, c.key, patch.key))
  }
  for (const patch of ESM_PATCHES) known.add(looseKey(patch.key))

  for (const key of Object.keys(q)) {
    if (!known.has(key)) return { ok: false, reason: `"${key}" is not an item we sell` }
  }

  const read = (key: string): number | { error: string } => {
    const v = q[key]
    if (v === undefined || v === null || v === '' || v === 0) return 0
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isInteger(n) || n < 0 || n > MAX_PAPER_LINE_QTY) {
      return { error: `quantity for ${key} must be a whole number 0–${MAX_PAPER_LINE_QTY}` }
    }
    return n
  }

  const lines: FundraiserLine[] = []
  let totalCents = 0
  let costCents = 0

  for (const p of ESM_PRODUCTS) for (const c of ESM_COLORS) for (const patch of ESM_PATCHES) {
    const qty = read(variantKey(p.key, c.key, patch.key))
    if (typeof qty === 'object') return { ok: false, reason: qty.error }
    if (qty <= 0) continue
    lines.push({
      name: variantName(p, c, patch),
      qty,
      unit_price: usd(p.priceCents),
      line_total: usd(p.priceCents * qty),
      cost_per_unit: usd(p.costCents),
    })
    totalCents += p.priceCents * qty
    costCents += p.costCents * qty
  }

  // Loose patches are ONE line across both designs, because the 3-for-$20 tier
  // mixes them — see `lib/fundraiserPatches.ts`.
  const loose: PatchSelection[] = []
  for (const patch of ESM_PATCHES) {
    const qty = read(looseKey(patch.key))
    if (typeof qty === 'object') return { ok: false, reason: qty.error }
    loose.push({ design: patch.label, qty })
  }
  const patchLine = patchOrderLine(loose)
  if (patchLine) {
    lines.push(patchLine)
    totalCents += Math.round(patchLine.line_total * 100)
    costCents += Math.round(patchLine.cost_per_unit * 100) * patchLine.qty
  }

  if (lines.length === 0) return { ok: false, reason: 'no items in order' }
  return { ok: true, lines, totalCents, costCents }
}
