/**
 * How a fundraiser order reaches the family — ONE definition.
 *
 * Every other item on `/esm-sharks` is priced in a `data-price` attribute in the
 * page and nowhere on the server, which is why `screenCmCheerTotals` can only
 * cross-check the browser's arithmetic against the browser's own line items and
 * has to record a disagreement rather than resolve it (see `lib/cmCheerOrder`).
 *
 * The delivery fee is the one line where that is NOT true: the fee is a rule the PTO
 * set, not a catalogue entry, so the server knows it. That makes this the one
 * charge we can actually PIN rather than merely audit — and pinning it matters,
 * because the fee is the part of the order that goes to the PTO whole. So the
 * route strips whatever delivery line the browser sent and substitutes the
 * canonical one (`deliveryLineItem`). A page that sends $70, or sends a delivery
 * line on a classroom order, gets corrected and the correction is written to
 * `status_note` where an organizer reads it.
 *
 * ── WHY THE FEE IS ALSO A LINE ITEM ──
 *
 * It is stored twice on purpose, and the two copies mean different things:
 *   - `delivery_fee_cents` is the FACT, for the dashboard, the CSV and any
 *     future "how much did delivery raise" question.
 *   - the line item is the fee's place in the MONEY, so it flows through the
 *     existing items-versus-total cross-check with no carve-out, appears in the
 *     confirmation email's item table, and lands in `profit_cents` — which is
 *     what the order book's "Total Raised" tile adds up.
 * `reconcileDeliveryItems` is what keeps them in step; nothing else should
 * construct a delivery line.
 */

/**
 * The upcharge, in cents. 100% of it is the PTO's.
 *
 * THE single source of this number — the order page derives its dollar figure
 * from it, and `screenDelivery` refuses an order that disagrees. Changing it
 * here changes the price on screen, in the confirmation email and in the books
 * together. Was 700; the PTO dropped it to 500 on 2026-09-16.
 */
export const HOME_DELIVERY_FEE_CENTS = 500

/**
 * The line-item name. Matched case-insensitively when stripping a client-sent
 * delivery line, so a page that sends "home delivery" is not left with two.
 */
export const HOME_DELIVERY_ITEM_NAME = 'Home Delivery'

export type DeliveryMethod = 'classroom' | 'home'

/** Mirrors the `cm_cheer_orders_delivery_method_check` constraint (migration 054). */
export const VALID_DELIVERY_METHODS: DeliveryMethod[] = ['classroom', 'home']

/**
 * What an order means when it says nothing.
 *
 * `/cm-cheer` and `/li-high` predate this field and never send it, and their
 * orders have always been handed to the athlete at practice — so absence is
 * "classroom", the same reasoning as `resolveFundraiserTeam`. An UNKNOWN value
 * is refused instead of defaulted: quietly turning a typo into "no delivery"
 * would mean a parent who paid the fee never gets their order brought to the door.
 */
export const DEFAULT_DELIVERY_METHOD: DeliveryMethod = 'classroom'

/** Long enough for a real Long Island address with an apartment and a note. */
export const MAX_DELIVERY_ADDRESS_LENGTH = 300

export type DeliveryScreen =
  | { ok: true; method: DeliveryMethod; address: string | null; feeCents: number }
  | { ok: false; reason: string }

export function isDeliveryMethod(value: unknown): value is DeliveryMethod {
  return typeof value === 'string' && (VALID_DELIVERY_METHODS as string[]).includes(value)
}

/**
 * Resolve a posted delivery choice into the three things the row stores.
 *
 * An address is REQUIRED for a home delivery — an order nobody can deliver is
 * worse than one that was never placed, because the fee has already been paid.
 * It is also DISCARDED for a classroom order: keeping a stray address on a row
 * that is being handed out in class puts a child's home address in a CSV that a
 * parent volunteer downloads, for no purpose the order has.
 */
export function screenDelivery(method: unknown, address: unknown): DeliveryScreen {
  const resolved: DeliveryMethod =
    method === undefined || method === null || method === ''
      ? DEFAULT_DELIVERY_METHOD
      : isDeliveryMethod(method)
        ? method
        : ('' as DeliveryMethod)

  if (!isDeliveryMethod(resolved)) {
    return { ok: false, reason: 'delivery method is not one we offer' }
  }

  if (resolved === 'classroom') {
    return { ok: true, method: 'classroom', address: null, feeCents: 0 }
  }

  if (typeof address !== 'string' || address.trim() === '') {
    return { ok: false, reason: 'a delivery address is required for home delivery' }
  }
  const trimmed = address.trim()
  if (trimmed.length > MAX_DELIVERY_ADDRESS_LENGTH) {
    return { ok: false, reason: `a delivery address must be under ${MAX_DELIVERY_ADDRESS_LENGTH} characters` }
  }

  return { ok: true, method: 'home', address: trimmed, feeCents: HOME_DELIVERY_FEE_CENTS }
}

/** The canonical delivery line. The only place one is constructed. */
export function deliveryLineItem() {
  return {
    name: HOME_DELIVERY_ITEM_NAME,
    qty: 1,
    unit_price: HOME_DELIVERY_FEE_CENTS / 100,
    line_total: HOME_DELIVERY_FEE_CENTS / 100,
    // Zero, because the whole fee is donated to the PTO. `profit_cents` is
    // subtotal − cost, so a zero cost is what makes the fee count as raised.
    cost_per_unit: 0,
  }
}

function looksLikeDeliveryLine(item: unknown): boolean {
  const name = (item as { name?: unknown } | null)?.name
  return typeof name === 'string' && name.trim().toLowerCase() === HOME_DELIVERY_ITEM_NAME.toLowerCase()
}

/**
 * Replace whatever the browser called delivery with what the server knows it is.
 *
 * Returns the items to actually price, plus a note when the browser's version
 * disagreed — the same contract as `screenCmCheerTotals`: correct it, and put
 * the correction somewhere a human sees rather than fixing it in silence.
 */
export function reconcileDeliveryItems(
  items: unknown[],
  method: DeliveryMethod,
): { items: unknown[]; note: string | null } {
  const sent = items.filter(looksLikeDeliveryLine)
  const rest = items.filter(item => !looksLikeDeliveryLine(item))
  const notes: string[] = []

  if (method === 'classroom') {
    if (sent.length > 0) {
      notes.push('A delivery charge was submitted on a classroom order and was removed.')
    }
    return { items: rest, note: notes.length ? notes.join(' ') : null }
  }

  const canonical = deliveryLineItem()
  if (sent.length !== 1) {
    notes.push(
      sent.length === 0
        ? `Home delivery was chosen but no delivery charge was submitted; $${canonical.line_total.toFixed(2)} was added.`
        : `${sent.length} delivery charges were submitted; they were replaced with one at $${canonical.line_total.toFixed(2)}.`,
    )
  } else {
    const submitted = Number((sent[0] as { line_total?: unknown }).line_total)
    if (!Number.isFinite(submitted) || Math.round(submitted * 100) !== HOME_DELIVERY_FEE_CENTS) {
      notes.push(
        `A delivery charge of ${Number.isFinite(submitted) ? `$${submitted.toFixed(2)}` : 'an unreadable amount'} ` +
          `was submitted; the $${canonical.line_total.toFixed(2)} rate was used.`,
      )
    }
  }

  return { items: [...rest, canonical], note: notes.length ? notes.join(' ') : null }
}
