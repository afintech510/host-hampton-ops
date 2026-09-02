// Shared flash-sale logic used on BOTH the server (checkout routes) and the
// client (ticket form / cards) so the displayed price and the charged price
// can never drift apart.
//
// A sale subtracts a flat dollar amount (sale_discount_cents) from EVERY price
// point on the event — the base price and each per-option variant / session
// price — clamped so nothing drops below $0.

export interface EventSaleFields {
  price_cents: number
  sale_discount_cents?: number | null
  sale_ends_at?: string | null
}

/** Is a sale configured and still within its window? */
export function isSaleActive(
  e: Pick<EventSaleFields, 'sale_discount_cents' | 'sale_ends_at'>,
  now: Date = new Date()
): boolean {
  if (e.sale_discount_cents == null || e.sale_ends_at == null) return false
  if (e.sale_discount_cents <= 0) return false
  const ends = new Date(e.sale_ends_at).getTime()
  if (Number.isNaN(ends)) return false
  return ends > now.getTime()
}

/**
 * Apply the active sale to ANY price (base or variant/session). While a sale
 * is live this subtracts the flat discount, clamped at $0; otherwise it returns
 * the price unchanged.
 */
export function saleAdjustedCents(
  regularCents: number,
  e: Pick<EventSaleFields, 'sale_discount_cents' | 'sale_ends_at'>,
  now: Date = new Date()
): number {
  if (!isSaleActive(e, now)) return regularCents
  return Math.max(0, regularCents - (e.sale_discount_cents as number))
}

/** Convenience: the base ticket price after any active sale. */
export function effectiveBasePriceCents(e: EventSaleFields, now: Date = new Date()): number {
  return saleAdjustedCents(e.price_cents, e, now)
}
