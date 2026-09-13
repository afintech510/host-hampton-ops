/**
 * The money on a CM Cheer / LI High fundraiser order, checked rather than trusted.
 *
 * `POST /api/cm-cheer-order` is public and unauthenticated, and it used to write
 * `subtotal_cents`, `cost_cents` and `profit_cents` straight from the request
 * body — three numbers the browser chose, one of which is the business's own
 * margin. The item prices live only in `data-price` / `data-cost` attributes in
 * two page components, so there is no server catalogue to re-derive from.
 *
 * So this bounds them and CROSS-CHECKS the posted total against the sum of the
 * line items. Where they disagree, the ITEMS win (they are itemised and a human
 * can audit them) and the discrepancy is written to `status_note`, which the order
 * book renders — rule 14: a record nobody can see is worse than an unattributable
 * one. Porting the price tables to the server is needs-Adam, because it changes
 * two live order pages.
 */

export interface CmCheerItem {
  name?: unknown
  qty?: unknown
  unit_price?: unknown
  line_total?: unknown
  cost_per_unit?: unknown
}

export type CmCheerTotals =
  | { ok: true; subtotalCents: number; costCents: number; profitCents: number; note: string | null }
  | { ok: false; reason: string }

/** No fundraiser order is plausibly above $10,000. */
export const MAX_CM_CHEER_ORDER_CENTS = 1_000_000
export const MAX_CM_CHEER_ITEM_QTY = 200

/** Dollars (possibly fractional) to whole cents, or null if it is not a number. */
function dollarsToCents(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

export function screenCmCheerTotals(
  total: unknown,
  totalCost: unknown,
  totalProfit: unknown,
  items: unknown[],
): CmCheerTotals {
  const subtotalCents = dollarsToCents(total)
  const costCents = dollarsToCents(totalCost)
  const profitCents = dollarsToCents(totalProfit)

  if (subtotalCents === null) return { ok: false, reason: 'order total is not a number' }
  if (costCents === null) return { ok: false, reason: 'order cost is not a number' }
  if (profitCents === null) return { ok: false, reason: 'order profit is not a number' }

  // Negative money on a fundraiser order is never right, and the ceiling stops a
  // nonsense row landing in the margin report.
  if (subtotalCents <= 0 || subtotalCents > MAX_CM_CHEER_ORDER_CENTS) {
    return { ok: false, reason: 'order total is outside the accepted range' }
  }
  if (costCents < 0 || costCents > MAX_CM_CHEER_ORDER_CENTS) {
    return { ok: false, reason: 'order cost is outside the accepted range' }
  }

  // Sum the line items. `line_total` is what the page computed (the patch tiers
  // make it more than qty × unit_price), so it is the figure to compare against.
  let itemsCents = 0
  let itemCostCents = 0
  let sawEveryLineTotal = true

  for (let i = 0; i < items.length; i++) {
    const item = (items[i] ?? {}) as CmCheerItem
    const qty = typeof item.qty === 'number' ? item.qty : Number(item.qty)
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_CM_CHEER_ITEM_QTY) {
      return { ok: false, reason: `item ${i + 1}: quantity must be a whole number 1–${MAX_CM_CHEER_ITEM_QTY}` }
    }
    const lineCents = dollarsToCents(item.line_total)
    if (lineCents === null || lineCents < 0) {
      sawEveryLineTotal = false
    } else {
      itemsCents += lineCents
    }
    const unitCost = dollarsToCents(item.cost_per_unit)
    if (unitCost !== null && unitCost >= 0) itemCostCents += unitCost * qty
  }

  const notes: string[] = []

  // The items are the audit trail, so they decide. A mismatch is recorded, never
  // silently preferred either way.
  let finalSubtotal = subtotalCents
  if (sawEveryLineTotal && itemsCents > 0 && itemsCents !== subtotalCents) {
    notes.push(
      `Submitted total $${(subtotalCents / 100).toFixed(2)} did not match the items ` +
        `($${(itemsCents / 100).toFixed(2)}); the itemised figure was used.`,
    )
    finalSubtotal = itemsCents
  }

  let finalCost = costCents
  if (itemCostCents > 0 && itemCostCents !== costCents) {
    notes.push(
      `Submitted cost $${(costCents / 100).toFixed(2)} did not match the items ` +
        `($${(itemCostCents / 100).toFixed(2)}); the itemised figure was used.`,
    )
    finalCost = itemCostCents
  }

  // Profit is DERIVED, never accepted: it is the one figure with no independent
  // source, and a posted value that disagrees with total − cost is meaningless.
  const derivedProfit = finalSubtotal - finalCost
  if (derivedProfit !== profitCents) {
    notes.push(`Profit recomputed as $${(derivedProfit / 100).toFixed(2)} from total − cost.`)
  }

  return {
    ok: true,
    subtotalCents: finalSubtotal,
    costCents: finalCost,
    profitCents: derivedProfit,
    note: notes.length ? notes.join(' ') : null,
  }
}

/** `cm_cheer_orders.payment_method`, as the live table holds it. */
export const VALID_PAYMENT_METHODS: string[] = ['cash', 'venmo']
