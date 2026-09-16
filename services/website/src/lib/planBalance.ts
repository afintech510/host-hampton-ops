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
 * ── The switch Adam has to throw (needs-Adam 41, recorded for the THIRD time) ─
 *
 * `STUDIO_DEPOSIT_IS_SEPARATE` below is the whole of the open accounting
 * question, deliberately reduced to one boolean so the ruling is a one-line
 * change rather than a session's work. It is NOT a technical choice and must not
 * be flipped without Adam:
 *
 *   `true`  (today, and what `planInvoice.ts` has always said) — a studio
 *           rental's $250 is a SECURITY deposit held against damage and
 *           refunded afterwards. It is not a part payment, so Balance Due is the
 *           full total. The customer pays $475 rental + $250 refundable.
 *   `false` — the $250 is a reservation payment like every other product's, and
 *           comes off the total. The customer pays $475 in all.
 *
 * `bookings.balance_due_cents` on both live studio rentals was written as if it
 * were `false`; every line of `planInvoice.ts` says `true`. That is $250 per
 * booking, on HH-STU-ZVM4U (party 2026-09-30) and HH-STU-2CTJ3.
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
 * this is needs-Adam 41 and the only thing that has to change to settle it.
 */
export const STUDIO_DEPOSIT_IS_SEPARATE = true

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
 *   `false` (today) — the quote-time balance is `total - deposit` for every
 *           product, studio included. That is what wrote $225.00 into
 *           HH-STU-ZVM4U's column against a $475.00 invoice.
 *   `true`  — the column is written with the invoice's own semantics, so the
 *           two stop disagreeing.
 *
 * Set BOTH to the same reading of the deposit and the plan surface agrees with
 * itself end to end. That is the whole of the change Adam's ruling needs.
 */
export const COLUMN_FOLLOWS_INVOICE = false

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
    // A studio security deposit is not a part payment, so it does not reduce the
    // total. Counting it would make the balance $250 short on every studio
    // rental. Governed by STUDIO_DEPOSIT_IS_SEPARATE via the caller's flag.
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

export interface PlanMoney {
  /** Everything billed. Optional items excluded. */
  totalCents: number
  /** The full deposit for this plan, whether or not any of it is paid. */
  depositCents: number
  depositIsSeparate: boolean
  /** Credited against the total (a studio security deposit is not). */
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
   * A SEPARATE studio security deposit is deliberately NOT capped: it is not
   * part of the total, so it stays owed even on a fully-paid rental. That is the
   * behaviour `STUDIO_DEPOSIT_IS_SEPARATE` selects.
   */
  depositOwedCents: number
  /**
   * What the document prints beside "Balance Due" — everything outstanding that
   * is not the deposit shown in its own callout, so
   * `depositOwedCents + balanceDueCents === outstandingCents` for every product
   * whose deposit comes off the total. For a studio rental the deposit is
   * separate by design and Balance Due is the whole outstanding total.
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

  const paidAsDeposit = paidAsDepositCents(payments)
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
