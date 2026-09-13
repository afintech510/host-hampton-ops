/**
 * What a customer holding their own portal cookie is allowed to change.
 *
 * Link 14 audited what `/api/portal/*` AUTHENTICATES and said in its own
 * write-up that it did not audit what those routes WRITE. This module is that
 * second half: the screens the customer side of the business needs before it
 * touches its own booking, its own money and its own consent.
 *
 * ── The sharpest thing that was wrong ──────────────────────────────────────
 *
 * **`/my-booking`'s "Pay Deposit" button charged the card and recorded $0.**
 *
 * `/api/portal/pay` takes `paymentType` from the request body — the UI really
 * does send it — and copies it into the PaymentIntent's `metadata.payment_type`.
 * The webhook's `payment_intent.succeeded` / `party_builder` branch then reads
 *
 *     const amountCents = paymentType === 'deposit'
 *       ? parseInt(m.depositCents || '0', 10)      // ← portal/pay never set this
 *       : parseInt(m.amountCents  || '0', 10)
 *
 * and `/api/portal/pay` sets `amountCents` and has never set `depositCents`. So
 * on the one branch the UI selects **by default** for an `awaiting_deposit`
 * booking (`MyBookingContent.tsx:323`), the customer's card is charged for real
 * and `booking_payments.amount_cents` is written as **0**. Measured consequences:
 *
 *   - the balance is recomputed as `total - paidSum` with this payment worth
 *     nothing, so the customer pays and still owes the whole amount;
 *   - `status` is forced to `pending_review` and `party_tags.date_locked` set;
 *   - the customer is emailed *"Deposit Received … $0.00"*;
 *   - Adam is emailed *"Deposit paid"*.
 *
 * Rule 17, asked properly and answered in the harmless direction: it has never
 * fired. `booking_payments` holds no `amount_cents = 0` row, and the only two
 * `deposit` rows are $238 (through `/api/checkout`, which DOES set
 * `depositCents`) and $250 (hand-entered). But **8 live `awaiting_deposit`
 * bookings carry a positive balance** and the button is on the page today.
 *
 * ── And the shape underneath it ────────────────────────────────────────────
 *
 * `paymentType` was never validated at all. `booking_payments` carries
 *
 *     booking_payments_payment_type_check
 *       CHECK (payment_type = ANY (ARRAY['deposit','partial','final','refund']))
 *
 * (read from `pg_constraint` on 2026-09-13 — rule 13, not from a comment), so a
 * body of `{"paymentType":"x"}` charges the card and then makes the webhook's
 * insert fail 23514 → 500 → Stripe retries forever → **money collected and
 * recorded nowhere**, which is rule 14's invisible loss rather than an
 * unattributable one. And `"refund"` is a spelling the CHECK *accepts*, whose
 * row `sumPayments()` SUBTRACTS — a customer could pay and raise their own
 * balance.
 *
 * So the vocabulary lives here once, derived from the constraint, and the
 * customer-choosable subset deliberately excludes `refund`.
 */

/**
 * Every value `booking_payments_payment_type_check` accepts.
 *
 * Exported so a test can assert this list against the constraint text rather
 * than against another copy of the list.
 */
export const BOOKING_PAYMENT_TYPES = ['deposit', 'partial', 'final', 'refund'] as const
export type BookingPaymentType = (typeof BOOKING_PAYMENT_TYPES)[number]

/**
 * The subset a CUSTOMER may name. `refund` is a thing the business does to a
 * customer, never a thing a customer does to themselves.
 */
export const PORTAL_PAYMENT_TYPES = ['deposit', 'partial', 'final'] as const
export type PortalPaymentType = (typeof PORTAL_PAYMENT_TYPES)[number]

/**
 * The payment type this request names, or null if it named something else.
 *
 * `undefined` is NOT an error — the route falls back to deriving the type from
 * the amount, which is what every caller that omits it expects. A present but
 * unrecognised value is an error, because the alternative is a charge whose
 * ledger row Postgres will refuse.
 */
export function screenPortalPaymentType(value: unknown): PortalPaymentType | null | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  return (PORTAL_PAYMENT_TYPES as readonly string[]).includes(v) ? (v as PortalPaymentType) : null
}

// ───────────────────────────────────────────────────────────────────────────
// May this booking still take money, and may this customer still change it
// ───────────────────────────────────────────────────────────────────────────

/**
 * Statuses on which a customer may not start a payment.
 *
 * Measured 2026-09-13: **four real `cancelled` bookings carry a positive
 * `balance_due_cents`, $47,470 between them** (HH-PTY-47WQF, -29FN9, -AH4AW,
 * -N6L8Q). `/api/portal/pay` selected `status` and never looked at it, so a
 * customer holding a cookie for any of them could be charged for a party that
 * is not happening — and the webhook's party_builder branch, unlike
 * `recordPlanPayment`, does not even log that it happened.
 *
 * `completed` is here for the same reason in the other direction: a party that
 * is over is reconciled by hand, not by a self-service charge.
 */
export const UNPAYABLE_STATUSES = ['cancelled', 'completed'] as const

export function isPayableStatus(status: unknown): boolean {
  if (typeof status !== 'string') return true // unknown shape: the balance check still gates it
  return !(UNPAYABLE_STATUSES as readonly string[]).includes(status.trim().toLowerCase())
}

/**
 * Statuses on which a customer may not edit their booking.
 *
 * Only `cancelled`. A `modifications_locked` booking is already refused by the
 * date cutoff that put it there (`/api/cron/booking-locks` flips at T-14 and
 * `isModificationAllowed` locks at T-14), and re-checking the label as well
 * would be a second definition of one rule — AGENTS.md §11 notes that
 * `modifications_locked` is a label no route enforces, and the honest answer is
 * that the DATE enforces it and the label records it.
 */
export const UNEDITABLE_STATUSES = ['cancelled'] as const

export function isEditableStatus(status: unknown): boolean {
  if (typeof status !== 'string') return true
  return !(UNEDITABLE_STATUSES as readonly string[]).includes(status.trim().toLowerCase())
}

// ───────────────────────────────────────────────────────────────────────────
// "May this customer still change this" — with a date that can be absent
// ───────────────────────────────────────────────────────────────────────────

/**
 * `isModificationAllowed` takes `partyDateStr: string` and immediately does
 * `partyDateStr.split('-')`. `bookings.party_date` is nullable and three rows
 * are null today (one of them a live `lead`), and `/api/portal/booking` passed
 * the column straight in behind an `as string` cast — so both the GET and the
 * PATCH threw a TypeError and answered **500** for a customer whose plan has no
 * date yet. Rule 8: the cast said the value was a string; the column said
 * otherwise.
 *
 * A plan with no date has no cutoff to be past, so it is open. Returned here
 * rather than inside `isModificationAllowed` because that function is shared
 * with the planner, which relies on its current signature.
 */
export function partyDateIsSet(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value.trim())
}

// ───────────────────────────────────────────────────────────────────────────
// A pledge is a claim about money, so it is bounded like one
// ───────────────────────────────────────────────────────────────────────────

/**
 * Ceiling on a self-reported Venmo/Zelle/cash/check pledge.
 *
 * `/api/portal/notify-payment` read `body.amount_cents as number` and checked
 * only `> 0`, then put the figure through `formatMoney()` into an email to Adam
 * and into `booking_modifications.new_data`. `1e308` formats as
 * `$10,000,000,...`; `0.5` formats as `$0.01`. Neither is a payment, and the
 * row is the record Adam reconciles a real transfer against.
 *
 * $100,000 is 34× the largest booking total in the database ($2,919, measured
 * 2026-09-13) and cannot refuse a real pledge.
 */
export const MAX_PLEDGE_CENTS = 10_000_000

export function screenPledgeCents(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isInteger(n) || n <= 0 || n > MAX_PLEDGE_CENTS) return null
  return n
}
