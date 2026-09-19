/**
 * "What does this party cost, and what has been paid" — ONE answer (link 23).
 *
 * Hard-won rule 11's sharpest instance in this codebase. Before this file,
 * "what does this booking owe" was answered seven ways (link 20 counted them),
 * link 18 extracted `computeBalance` for the admin panel, link 21 found a THIRD
 * copy of `(total_cents || 0) - paidSum` in the webhook — and the plan surface
 * had two more of its own that disagreed with each other **in front of the
 * customer**:
 *
 *   * `/plan/[ref]/summary` printed `total - the NOTIONAL deposit`, a figure
 *     computed at quote time that never moved again. It did not subtract a
 *     single payment. Measured in production 2026-09-13 across the 35 live
 *     priced bookings: it disagreed with what was actually outstanding on 27 of
 *     them — overstating by $3,569.50 on five and understating by $4,071.00 on
 *     twenty-two. Two real customers who had paid IN FULL ($1,725.00 and
 *     $1,810.00) were shown **"Balance Due: $1,475.00"** and **"$1,560.00"**.
 *     The same number goes out in the emailed/SMS'd summary (lib/planShare.ts),
 *     so it is a sentence a customer repeats — hard-won rule 10.
 *   * `bookings.balance_due_cents`, which `/api/portal/pay` clamps its charge
 *     to, holds `total - deposit_amount` on a plan nobody has paid and
 *     `total - paid` on one somebody has. Two concepts in one column.
 *
 * ── needs-Adam 41, RULED 2026-09-16 ─────────────────────────────────────────
 *
 * `STUDIO_DEPOSIT_IS_SEPARATE` below was the whole of the open accounting
 * question, deliberately reduced to one boolean so the ruling would be a
 * one-line change rather than a session's work. Adam ruled it `false`:
 *
 *   a studio rental's $250 is a RESERVATION payment like every other product's.
 *   It books the date and it comes off the total, so Balance Due is
 *   `total - deposit`. The customer pays $475 in all, not $475 + $250.
 *
 * The refundable damage hold is a genuinely separate thing and always was — a
 * card AUTHORISATION placed before the event and released afterwards, never a
 * charge and never a line on the invoice. It is the catalog key
 * `studio_security_hold` (see `lib/pricingCatalog.ts`), and conflating the two
 * $250s is exactly what this boolean existed to stop.
 *
 * The flip made the document AGREE with the column rather than move any money:
 * `bookings.balance_due_cents` on every live studio rental was already written
 * as `total - deposit`, while `planInvoice.ts` printed the full total. Measured
 * on the four priced studio rentals at ruling time, Balance Due falls by exactly
 * the $250 deposit on each and lands on the stored column —
 * HH-STU-ZVM4U $225.00, HH-PTY-FSQU9 $425.00, HH-STU-2CTJ3 $850.00,
 * HH-PTY-73LGZ $50.00. Nobody is charged more; HH-PTY-FSQU9 (`deposit_paid`)
 * stops being shown $250 MORE than she owes.
 *
 * ── Why `is_optional` lives here ────────────────────────────────────────────
 *
 * An optional line item is quoted and NOT charged — `loadPlanInvoice` has always
 * honoured that and was the only one of five totals that did. `billedTotalCents`
 * is the shared answer so `recalcTotals`, `buildPlanSnapshot` and the studio
 * routes stop writing a `total_cents` the invoice would not agree with.
 */

/** The columns of `booking_payments` every figure below depends on. */
export interface PaymentRow {
  amount_cents: number
  payment_type: string
}

/** The subset of a line item that decides money. */
export interface BilledItem {
  unit_price_cents: number
  quantity: number
  guest_multiplied: boolean
  is_optional?: boolean | null
}

/**
 * Is a studio rental's $250 held separately from the total? See the header —
 * this was needs-Adam 41, and Adam ruled `false` on 2026-09-16: the $250 is a
 * reservation payment and comes off the total, the same as every other product.
 *
 * Kept as a named constant rather than deleted along with the branches it
 * selects, because it is the one place the ruling is written down and because
 * the opposite reading is the one four customer-facing surfaces used to hold.
 */
export const STUDIO_DEPOSIT_IS_SEPARATE = false

/**
 * Has this plan been priced at all?
 *
 * The distinction this function exists to make is the whole of the
 * reservation-deposit change (2026-09-16). `outstandingCents === 0` has TWO
 * causes and they are opposites:
 *
 *   * the plan is priced and has been paid → settled, nothing more is owed;
 *   * the plan has **no priced items yet** → we have not quoted it, so
 *     "outstanding" is unknown rather than zero.
 *
 * Every pay surface collapsed those two into "no button", which is why a real
 * customer (HH-PTY-B7T6W, an Instagram inquiry with a date and nothing else)
 * could not leave a deposit. `/plan/[ref]/summary` already drew this line for
 * its "Paid in Full" banner — `settled = askCents <= 0 && totalCents > 0` — so
 * this is that existing test, named and shared rather than respelled.
 */
export function isUnpricedPlan(totalCents: number): boolean {
  return !(Number.isFinite(totalCents) && totalCents > 0)
}

/** The one derivation. Never re-spell `party_type === 'studio_rental'` inline. */
export function depositIsSeparateFor(partyType: string | null | undefined): boolean {
  return STUDIO_DEPOSIT_IS_SEPARATE && partyType === 'studio_rental'
}

/**
 * Does this product carry the refundable damage hold?
 *
 * Studio rentals, and only studio rentals — it is the room being held against
 * damage, so there is nothing to hold on a party we bring to your house.
 *
 * This is a SECOND question about the same party type, and it has to be asked
 * separately. `loadPlanInvoice` used to gate the hold on `depositIsSeparate`,
 * which was a safe shorthand only while that flag meant "is a studio rental".
 * The moment needs-Adam 41 was ruled and the flag went false, the shorthand
 * would have silently dropped the security-hold note off every studio rental
 * quote — the customer's only written warning that a card authorisation is
 * coming. Two meanings, two functions.
 */
export function hasSecurityHold(partyType: string | null | undefined): boolean {
  return partyType === 'studio_rental'
}

/**
 * Does `bookings.balance_due_cents` follow the invoice, or keep its own answer?
 *
 * This is the OTHER half of needs-Adam 41, and the reason it is a second
 * constant rather than a branch of the first: flipping
 * `STUDIO_DEPOSIT_IS_SEPARATE` changes what the customer's document SAYS, while
 * flipping this changes what the column a charge is clamped to HOLDS. They are
 * the same ruling, and they have to be able to move together — but the column
 * has to keep today's value until Adam has ruled, because changing it silently
 * would charge two real studio customers $250 more than they have been quoted.
 *
 *   `false` — the quote-time balance is `total - deposit` for every product,
 *           studio included. That is what wrote $225.00 into HH-STU-ZVM4U's
 *           column against a $475.00 invoice.
 *   `true`  (today) — the column is written with the invoice's own semantics,
 *           so the two stop disagreeing.
 *
 * Both are now the SAME arithmetic: with `STUDIO_DEPOSIT_IS_SEPARATE = false`,
 * `depositIsSeparateFor` answers false for every product, and `planMoney` with
 * no payments reduces to `max(0, total - deposit)` — which is the other branch
 * verbatim. Flipping this to `true` was therefore a no-op on every row, and it
 * is set that way because the invoice is now the single definition of the
 * balance and the column should be seen to follow it rather than to agree by
 * coincidence.
 */
export const COLUMN_FOLLOWS_INVOICE = true

/**
 * The balance to STORE on a plan nobody has paid yet — `bookings.balance_due_cents`
 * as the checkout and planner writers set it.
 *
 * It exists so those writers stop each spelling `Math.max(0, total - deposit)`
 * for themselves, which is how the column came to mean `total - deposit_amount`
 * on some rows and `total - paid` on others.
 */
export function quoteTimeBalanceCents(input: {
  totalCents: number
  depositCents: number
  partyType: string | null | undefined
}): number {
  const { totalCents, depositCents, partyType } = input
  if (!COLUMN_FOLLOWS_INVOICE) return Math.max(0, totalCents - depositCents)
  return planMoney({
    totalCents,
    depositCents,
    depositIsSeparate: depositIsSeparateFor(partyType),
    payments: [],
  }).balanceDueCents
}

/**
 * The guest multiplier, spelled once.
 *
 * `guest_count_approx` is nullable, has been zero, and link 21 found it
 * unbounded; a non-positive count multiplies by 1 rather than by 0, because a
 * per-head item priced at zero is an invoice that silently loses a line.
 */
export function guestMultiplier(guestCountApprox: number | null | undefined): number {
  const n = Number(guestCountApprox)
  return Number.isFinite(n) && n > 0 ? n : 1
}

/**
 * The total of everything actually BILLED — optional add-ons excluded.
 *
 * This is what `loadPlanInvoice` puts on the document, so it is what every
 * writer of `bookings.total_cents` has to agree with.
 */
export function billedTotalCents(items: BilledItem[], guestCountApprox: number | null | undefined): number {
  const mult = guestMultiplier(guestCountApprox)
  let total = 0
  for (const item of items) {
    if (item.is_optional === true) continue
    const unitTotal = item.unit_price_cents * item.quantity
    total += item.guest_multiplied ? unitTotal * mult : unitTotal
  }
  return total
}

/** How much of what has been paid counts against the TOTAL. A refund subtracts. */
export function paidTowardTotalCents(payments: PaymentRow[], depositIsSeparate: boolean): number {
  let sum = 0
  for (const p of payments) {
    const amount = Number(p.amount_cents) || 0
    if (p.payment_type === 'refund') {
      sum -= amount
      continue
    }
    // A deposit held APART from the total is not a part payment, so it would not
    // reduce it. Inert since needs-Adam 41 was ruled — `depositIsSeparate` is
    // false for every product — and kept so reversing the one boolean reverses
    // the arithmetic with it, rather than leaving a branch to re-derive.
    if (depositIsSeparate && p.payment_type === 'deposit') continue
    sum += amount
  }
  return sum
}

/** What has been paid and recorded AS a deposit. */
export function paidAsDepositCents(payments: PaymentRow[]): number {
  let sum = 0
  for (const p of payments) {
    if (p.payment_type === 'deposit') sum += Number(p.amount_cents) || 0
  }
  return sum
}

/**
 * How much has been paid down ON THE DEPOSIT — which is not the same question as
 * "how much arrived carrying the label `deposit`".
 *
 * Since needs-Adam 41 the deposit is the FIRST PART of the total, not a debt
 * beside it. So any money credited to the total pays it down, whatever the row
 * is typed. Typing it `deposit` is a bookkeeping nicety; the customer's money is
 * the same money either way.
 *
 * Reading only the typed rows is what broke HH-PTY-F47YW in front of a real
 * customer on 2026-09-19. Jessica paid $300 of a $925 party through the portal;
 * `/api/portal/pay` recorded it `partial` (its default for anything short of the
 * full balance), so `paidAsDepositCents` answered $0, the deposit read as unpaid
 * and the invoice printed **"Reservation Deposit — Required to Book $250.00"**
 * under a **"Balance Due $375.00"** — the $250 subtracted from the balance as if
 * it were a second payment AND demanded again in the callout. `/my-booking`, one
 * click away, said $625.00 — the true figure, and the one on the booking row.
 *
 * Not a one-off: only 2 of the 18 real payments in production carry the
 * `deposit` type, so this was every part-paid plan. `/api/portal/pay` already
 * forces the type on the RESERVATION half of the same problem (see
 * `isReservationPayment` there) — this is the priced half, fixed at the source
 * instead of at each writer.
 *
 * A deposit held APART from the total keeps the strict reading: it is not part
 * of the total, so a payment against the total says nothing about it. That is
 * `STUDIO_DEPOSIT_IS_SEPARATE`, false for every product today.
 *
 * `paidTowardTotal` is floored at 0 first: a net refund must not make the
 * deposit read as MORE than fully owed.
 */
export function paidTowardDepositCents(
  payments: PaymentRow[],
  depositIsSeparate: boolean,
  paidTowardTotal: number,
): number {
  const typed = paidAsDepositCents(payments)
  if (depositIsSeparate) return typed
  return Math.max(typed, Math.max(0, paidTowardTotal))
}

export interface PlanMoney {
  /** Everything billed. Optional items excluded. */
  totalCents: number
  /** The full deposit for this plan, whether or not any of it is paid. */
  depositCents: number
  depositIsSeparate: boolean
  /** Credited against the total — every deposit is, since needs-Adam 41. */
  paidCents: number
  /** Everything still owed against the total. Never negative. */
  outstandingCents: number
  /**
   * What is still owed ON THE DEPOSIT — and, for every product where the deposit
   * comes off the total, capped by what the plan actually owes.
   *
   * The cap is the whole of link 23's second finding. `quoteFor('deposit')` was
   * bounded only by "has a `payment_type = 'deposit'` row been recorded", and
   * only 2 of the 18 real payments in production carry that type — every other
   * one was hand-entered as `partial`. So the deposit quote survived on a plan
   * that owed nothing. Proven in production BEFORE this cap existed: a plan
   * paid in full ($600.00 of $600.00) rendered a live
   * **"Pay $250.00 deposit — $250.00 + $7.50 card fee = $257.50 charged"**
   * button, and `POST /api/plan/<ref>/pay-link {"purpose":"deposit"}` answered
   * **200 with a real, chargeable Stripe Payment Link** (deactivated
   * immediately). A deposit is a part of the price, so it can never exceed the
   * price that is left.
   *
   * A deposit held APART from the total would deliberately NOT be capped — it
   * is not part of the total, so it would stay owed even on a fully-paid
   * rental. That is the behaviour `STUDIO_DEPOSIT_IS_SEPARATE` selects, and it
   * selects it for nothing today: the ruling made every deposit a part payment,
   * so every deposit is capped.
   */
  depositOwedCents: number
  /**
   * What the document prints beside "Balance Due" — everything outstanding that
   * is not the deposit shown in its own callout, so
   * `depositOwedCents + balanceDueCents === outstandingCents`. That identity now
   * holds for EVERY product, studio included: needs-Adam 41 removed the one
   * case (a separate studio deposit) where Balance Due was the whole
   * outstanding total instead.
   */
  balanceDueCents: number
  /** Credited MORE than the total. 0 normally; a refund may be due. */
  overpaidCents: number
}

/**
 * Every money figure for one plan, from the total, the deposit and the payments.
 *
 * Pure: no IO, so the arithmetic that decides what a customer is charged is
 * testable without a database or a Stripe key.
 */
export function planMoney(input: {
  totalCents: number
  depositCents: number
  depositIsSeparate: boolean
  payments: PaymentRow[]
  /**
   * The flat deposit that reserves a DATE on a plan that has not been priced
   * yet (`BOOKING_DEPOSIT_CENTS`). Omitted or 0 → today's behaviour exactly.
   *
   * It is a separate input from `depositCents` because `depositCents` is
   * derived from the total (`getDepositCents`) and is therefore 0 on precisely
   * the plans this is for. Only ever applied when `isUnpricedPlan`, so it can
   * never widen what a PRICED plan can be charged.
   */
  reservationDepositCents?: number
}): PlanMoney {
  const { totalCents, depositCents, depositIsSeparate, payments } = input
  const paidCents = paidTowardTotalCents(payments, depositIsSeparate)
  const outstandingCents = Math.max(0, totalCents - paidCents)
  const unpriced = isUnpricedPlan(totalCents)
  // Money on an unpriced plan is not an overpayment — there is no price for it
  // to exceed. Without this a paid reservation deposit would render "a refund
  // may be due" on the customer's own summary page.
  const overpaidCents = unpriced ? 0 : Math.max(0, paidCents - totalCents)

  // Every payment credited to the total pays the deposit down, not just the
  // rows typed `deposit` — see `paidTowardDepositCents` for the invoice this
  // read wrong in front of a customer.
  const paidAsDeposit = paidTowardDepositCents(payments, depositIsSeparate, paidCents)
  // The reservation deposit stands in for `depositCents` only where the total
  // could not produce one. A plan with a priced deposit keeps the priced one.
  const reservationOwed =
    unpriced && depositCents <= 0
      ? Math.max(0, (Number(input.reservationDepositCents) || 0) - paidAsDeposit)
      : 0
  const rawDepositOwed =
    depositCents > 0 ? Math.max(0, depositCents - paidAsDeposit) : reservationOwed
  // The cap is link 23's finding and is NOT relaxed: a deposit can never exceed
  // what a plan still owes. It simply does not apply to an unpriced plan, where
  // `outstandingCents` is 0 for want of a quote rather than for want of a debt.
  const depositOwedCents =
    depositIsSeparate || unpriced ? rawDepositOwed : Math.min(rawDepositOwed, outstandingCents)

  const balanceDueCents = depositIsSeparate ? outstandingCents : Math.max(0, outstandingCents - depositOwedCents)

  return {
    totalCents,
    depositCents,
    depositIsSeparate,
    paidCents,
    outstandingCents,
    depositOwedCents,
    balanceDueCents,
    overpaidCents,
  }
}
