/**
 * What a stranger is allowed to put in a row.
 *
 * The public intake routes are the only unauthenticated write surface this
 * business has. Every other subsystem — the sequencer, the Stripe webhook, the
 * customer portal, the admin panel, the reminder crons, the booking agent —
 * acts on rows these routes create, from input somebody typed into a web form.
 *
 * The sharpest thing that was wrong: **the money was accepted from the client.**
 * `lineItems[].unit_price_cents` arrived in the request body and went straight
 * into `booking_line_items`, and `buildPlanSnapshot()` computed
 * `bookings.total_cents` / `deposit_amount` / `balance_due_cents` from those same
 * numbers. `loadPlanInvoice()` then RE-derives the invoice from the line items —
 * correctly, and that is the point: "the total is computed server-side" was true
 * of the arithmetic and false of the inputs. Measured consequences, all reachable
 * with one unauthenticated POST before this module existed:
 *
 *   - `/api/studio-rental/edit` with an add-on priced `-1000000` makes
 *     `calculateLineItemTotal` negative, `Math.max(0, total - paid)` zero, and the
 *     route then writes `status = 'paid_in_full'` and `paid_in_full_at` on a real
 *     studio rental. A customer could mark their own booking settled.
 *   - `/api/studio-rental/checkout` derives the Stripe charge from
 *     `getDepositCents(totalCents)`, so a negative add-on lowers what is charged.
 *   - `/api/party-builder/save` and `/api/party-checkout` write whatever total
 *     the browser sends, which is what the Parties tab and the portal then show.
 *
 * Why this is a SCREEN and not a re-price. The obvious fix — look each item up by
 * `pricing_item_id` and use the catalogue price — is wrong here, measured against
 * the live table: 47 of 206 `booking_line_items` rows carry no `pricing_item_id`
 * at all, and of those that do, nine groups legitimately disagree with the
 * catalogue because the planner's product IS a bundle calculus ("Spa Party"
 * $650 against a catalogue $850; "Manicure (1st premium — +$100 upgrade)" $100
 * against a catalogue $0). Re-pricing from `pricing_items` would have rewritten
 * real quotes. So the boundary is bounded and validated instead, against the
 * shapes the live table actually holds.
 *
 * NEGATIVE PRICES ARE ADMIN-ONLY. Eight live rows have one, every one in
 * category `discount`, every one hand-entered by Adam. That facility stays; a
 * public caller cannot use it, because a discount a customer grants themselves
 * is not a discount.
 *
 * Rule 19's second half: a refusal says WHICH item and WHY. A screen that
 * answers a bare 400 over a real customer's plan is a lost sale nobody can debug.
 */

import type { BookingLineItem } from '@/types/booking-flow'

// ───────────────────────────────────────────────────────────────────────────
// Bounds, measured against production on 2026-09-13
// ───────────────────────────────────────────────────────────────────────────

/** `price_type` values the live table holds. Both are real; nothing else is. */
export const ALLOWED_PRICE_TYPES = ['flat', 'per_person'] as const

/** Live max name length is 50; 120 is headroom for a longer composed label. */
export const MAX_ITEM_NAME_CHARS = 120
export const MAX_ITEM_CATEGORY_CHARS = 40
export const MAX_ITEM_DESCRIPTION_CHARS = 500

/** Live max quantity is 25. */
export const MAX_ITEM_QUANTITY = 100

/** Live max unit price is $975.00. $10,000 per unit is generous headroom. */
export const MAX_PUBLIC_UNIT_PRICE_CENTS = 1_000_000

/** A real plan tops out around $2,000. $100,000 stops a nonsense row. */
export const MAX_PUBLIC_TOTAL_CENTS = 10_000_000

/** The planner sends at most a couple of dozen selections. */
export const MAX_PUBLIC_LINE_ITEMS = 60

/** Guest counts on the live table run 1–60; 500 is far beyond any real party. */
export const MAX_PUBLIC_GUEST_COUNT = 500

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CATEGORY_RE = /^[a-z0-9][a-z0-9_-]*$/

// ───────────────────────────────────────────────────────────────────────────
// Line items
// ───────────────────────────────────────────────────────────────────────────

export type ScreenedLineItems =
  | { ok: true; lineItems: BookingLineItem[] }
  | { ok: false; reason: string }

/**
 * An integer, and only an integer.
 *
 * `unit_price_cents` and `quantity` are `integer NOT NULL`. A float or a NaN is
 * refused by Postgres — but `buildPlanSnapshot()` runs BEFORE the line-item
 * insert and writes `bookings.total_cents` from the same numbers, so a value the
 * DB would reject produces a booking carrying a total with no items beneath it,
 * and `loadPlanInvoice` then renders that plan as $0. The boundary has to be
 * here, not at the column.
 */
function asInteger(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    const n = Number(value.trim())
    return Number.isSafeInteger(n) ? n : null
  }
  return null
}

function asBoundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (!s.length || s.length > max) return null
  return s
}

/**
 * Screen the `lineItems` array a public route was handed.
 *
 * Refuses the WHOLE batch rather than dropping the bad rows: a plan quietly
 * missing the item a customer chose is worse than a plan that failed to save,
 * because only one of the two gets retried.
 */
export function screenPublicLineItems(raw: unknown, guestCount?: unknown): ScreenedLineItems {
  if (raw === undefined || raw === null) return { ok: true, lineItems: [] }
  if (!Array.isArray(raw)) return { ok: false, reason: 'lineItems must be an array' }
  if (raw.length > MAX_PUBLIC_LINE_ITEMS) {
    return { ok: false, reason: `too many line items (${raw.length}, max ${MAX_PUBLIC_LINE_ITEMS})` }
  }

  const out: BookingLineItem[] = []

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as Record<string, unknown>
    const where = `line item ${i + 1}`
    if (!item || typeof item !== 'object') return { ok: false, reason: `${where}: not an object` }

    const name = asBoundedString(item.name, MAX_ITEM_NAME_CHARS)
    if (!name) return { ok: false, reason: `${where}: name must be 1–${MAX_ITEM_NAME_CHARS} characters` }

    const category = asBoundedString(item.category, MAX_ITEM_CATEGORY_CHARS)
    if (!category || !CATEGORY_RE.test(category)) {
      return { ok: false, reason: `${where} (${name}): category must be a short slug` }
    }

    const quantity = asInteger(item.quantity)
    if (quantity === null || quantity < 1 || quantity > MAX_ITEM_QUANTITY) {
      return { ok: false, reason: `${where} (${name}): quantity must be a whole number 1–${MAX_ITEM_QUANTITY}` }
    }

    const unitPriceCents = asInteger(item.unit_price_cents)
    if (unitPriceCents === null) {
      return { ok: false, reason: `${where} (${name}): unit_price_cents must be a whole number of cents` }
    }
    // The one rule this module exists for.
    if (unitPriceCents < 0) {
      return { ok: false, reason: `${where} (${name}): a negative price can only be entered by Host Hampton` }
    }
    if (unitPriceCents > MAX_PUBLIC_UNIT_PRICE_CENTS) {
      return { ok: false, reason: `${where} (${name}): unit price above the accepted maximum` }
    }

    const priceType = typeof item.price_type === 'string' ? item.price_type.trim() : ''
    if (!(ALLOWED_PRICE_TYPES as readonly string[]).includes(priceType)) {
      return { ok: false, reason: `${where} (${name}): price_type must be one of ${ALLOWED_PRICE_TYPES.join(', ')}` }
    }

    const pricingItemId = item.pricing_item_id
    if (pricingItemId !== undefined && pricingItemId !== null && pricingItemId !== '') {
      if (typeof pricingItemId !== 'string' || !UUID_RE.test(pricingItemId)) {
        return { ok: false, reason: `${where} (${name}): pricing_item_id is not a uuid` }
      }
    }

    const sortOrder = item.sort_order === undefined || item.sort_order === null ? i : asInteger(item.sort_order)
    if (sortOrder === null || sortOrder < 0 || sortOrder > 10_000) {
      return { ok: false, reason: `${where} (${name}): sort_order out of range` }
    }

    const rawDescription = (item as { description?: unknown }).description
    let description: string | null = null
    if (rawDescription !== undefined && rawDescription !== null && rawDescription !== '') {
      description = asBoundedString(rawDescription, MAX_ITEM_DESCRIPTION_CHARS)
      if (!description) {
        return { ok: false, reason: `${where} (${name}): description longer than ${MAX_ITEM_DESCRIPTION_CHARS} characters` }
      }
    }

    out.push({
      pricing_item_id: (pricingItemId as string) || null,
      name,
      category,
      quantity,
      unit_price_cents: unitPriceCents,
      price_type: priceType,
      guest_multiplied: item.guest_multiplied === true,
      sort_order: sortOrder,
      description,
      is_featured: (item as { is_featured?: unknown }).is_featured === true,
      is_optional: (item as { is_optional?: unknown }).is_optional === true,
    } as unknown as BookingLineItem)
  }

  // The ceiling is checked on the TOTAL as well as per item, because the
  // multiplier is `unit × quantity × guests` and all three are attacker-chosen.
  const guests = screenPublicGuestCount(guestCount) ?? 1
  let total = 0
  for (const item of out) {
    const line = item.unit_price_cents * item.quantity
    total += item.guest_multiplied ? line * guests : line
  }
  if (total > MAX_PUBLIC_TOTAL_CENTS) {
    return { ok: false, reason: `quote total above the accepted maximum — please call us` }
  }

  return { ok: true, lineItems: out }
}

/**
 * A guest count a public caller may write.
 *
 * `guest_count_approx` is `integer`, so `1e20` is refused by Postgres — after
 * `bookings` has already been written with a total derived from it. Returns null
 * for "absent or unusable", which every caller already treats as "use the
 * default", rather than throwing.
 */
export function screenPublicGuestCount(value: unknown): number | null {
  const n = asInteger(value)
  if (n === null || n < 1 || n > MAX_PUBLIC_GUEST_COUNT) return null
  return n
}

/**
 * A whole-number count a public caller may write (ticket quantities, party
 * sizes). Distinct from a line-item quantity because the ceiling differs and the
 * caller wants a hard refusal, not a fallback.
 */
export function screenPublicCount(value: unknown, max: number): number | null {
  const n = asInteger(value)
  if (n === null || n < 1 || n > max) return null
  return n
}

// ───────────────────────────────────────────────────────────────────────────
// Free text
// ───────────────────────────────────────────────────────────────────────────

/**
 * Bound a free-text field from a public form.
 *
 * These strings reach a `bookings.notes` column, an email to Adam, an SMS to
 * Adam's phone (billed per segment) and — through `ingested_messages.body` —
 * the booking agent's prompt. A field is hostile because of who can WRITE it,
 * not which block it prints in (rule 5), and the bound is the cheap half of
 * that: nothing here needs to accept a megabyte.
 */
export const MAX_INTAKE_TEXT_CHARS = 4000
export const MAX_INTAKE_NAME_CHARS = 200

export function boundedIntakeText(value: unknown, max = MAX_INTAKE_TEXT_CHARS): string | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (!s.length) return null
  return s.length > max ? s.slice(0, max) : s
}

// ───────────────────────────────────────────────────────────────────────────
// What actually got recorded
// ───────────────────────────────────────────────────────────────────────────

/**
 * An intake route's own account of what it managed to store.
 *
 * Every one of these routes used to end `return NextResponse.json({ success: true })`
 * regardless: `upsertContact` could return null, `ensureLeadPlan` could return
 * `NOT_CREATED`, `recordInboundEvent` could fail and the `contact_interactions`
 * insert could be refused, and the customer was still told "we got your message".
 * That is hard-won rule 10's expensive half on the revenue surface — the shape
 * that lost 21 people's unsubscribes, except here the thing lost is a LEAD.
 *
 * `landedSomewhere` is the question worth asking, and it deliberately counts the
 * owner notification: a lead in Adam's inbox with no database row is damaged, not
 * lost. Nothing at all is lost, and says so.
 */
export interface IntakeRecord {
  contact: boolean
  plan: boolean
  event: boolean
  interaction: boolean
  ownerNotified: boolean
}

export function emptyIntakeRecord(): IntakeRecord {
  return { contact: false, plan: false, event: false, interaction: false, ownerNotified: false }
}

export function landedSomewhere(r: IntakeRecord): boolean {
  return r.contact || r.plan || r.event || r.interaction || r.ownerNotified
}

/**
 * Did a `Promise.allSettled` entry for a Resend send actually send?
 *
 * Two failure modes, and the intake routes were blind to both: the promise can
 * reject, and it can RESOLVE carrying `{ error }`. `Promise.allSettled(...)` with
 * the result discarded treats a bounced admin notification as a delivered one,
 * which is what makes "the lead is at least in Adam's inbox" an assumption rather
 * than a fact.
 */
export function settledOk(result: PromiseSettledResult<unknown> | undefined): boolean {
  if (!result || result.status !== 'fulfilled') return false
  const value = result.value as { error?: unknown } | null | undefined
  return !(value && value.error)
}

/** The subsystems that did NOT record this inquiry, for the log line. */
export function missingFrom(r: IntakeRecord): string[] {
  const missing: string[] = []
  if (!r.contact) missing.push('contact')
  if (!r.plan) missing.push('plan')
  if (!r.event) missing.push('event')
  if (!r.interaction) missing.push('interaction')
  if (!r.ownerNotified) missing.push('owner-notify')
  return missing
}
