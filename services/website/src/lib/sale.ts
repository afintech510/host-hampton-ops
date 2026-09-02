// Shared flash-sale logic used on BOTH the server (checkout routes) and the
// client (ticket form / cards) so the displayed price and the charged price
// can never drift apart.
//
// A fixed sale price overrides an event's BASE ticket price for a bounded
// window. It does NOT touch per-option variant prices or per-session price
// overrides — those carry their own explicit values.

export interface EventSaleFields {
  price_cents: number
  sale_price_cents?: number | null
  sale_ends_at?: string | null
}

/** Is a sale configured and still within its window? */
export function isSaleActive(
  e: Pick<EventSaleFields, 'sale_price_cents' | 'sale_ends_at'>,
  now: Date = new Date()
): boolean {
  if (e.sale_price_cents == null || e.sale_ends_at == null) return false
  const ends = new Date(e.sale_ends_at).getTime()
  if (Number.isNaN(ends)) return false
  return ends > now.getTime()
}

/**
 * The effective base ticket price: the sale price while a sale is live,
 * otherwise the regular base price. Variant/session prices are applied by
 * callers AFTER this, so they always win over a base sale.
 */
export function effectiveBasePriceCents(e: EventSaleFields, now: Date = new Date()): number {
  return isSaleActive(e, now) ? (e.sale_price_cents as number) : e.price_cents
}
