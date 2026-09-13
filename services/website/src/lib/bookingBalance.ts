/**
 * "What has this booking been paid, and what does it still owe" — one answer.
 *
 * Extracted by link 18 from `src/app/api/webhook/route.ts`, where the Phase 5
 * review and link 16 had already got it right, so that the ADMIN panel's
 * "record a payment" button can stop getting it wrong in the way link 16 fixed
 * on the webhook. Hard-won rule 11: a concept defined twice is a concept nothing
 * is checking, and this one decides whether a customer is told they have paid.
 *
 * The shape that was live in `/api/admin/parties/[id]`:
 *
 *   const { data: payments } = await supabase.from('booking_payments')…   // error discarded
 *   const newBalance = Math.max(0, (booking.total_cents || 0) - paid)
 *   if (newBalance === 0) { status = 'paid_in_full'; paid_in_full_at = now }
 *
 * Two defects in four lines. A failed `booking_payments` read makes `paid` zero,
 * which silently asks the customer for the whole total again; and a booking with
 * no total yet — every LEAD, which is most of the pipeline since Phase 4 — has
 * `total_cents` null, so `(null || 0) - anything` clamps to 0 and recording a
 * $100 deposit against an unquoted lead marked it **paid in full**. Hard-won
 * rule 12 in its money form, and rule 19's: an error you do not read is an error
 * that did not happen.
 */

type MinimalClient = {
  from: (table: string) => any
}

export type BalanceInputs =
  | { ok: true; paidSum: number; row: Record<string, unknown> }
  | { ok: false; message: string }

/**
 * Sum what has actually been paid, and read the booking's own columns.
 *
 * Three outcomes collapse to two here deliberately: both "the read failed" and
 * "there is no such booking" are `ok: false` with a message, because neither is
 * a number the caller may use. What the caller must never do is treat either as
 * zero.
 */
export async function readBalanceInputs(
  supabase: MinimalClient,
  bookingId: string,
  columns: string,
): Promise<BalanceInputs> {
  const { data: payRows, error: payErr } = await supabase
    .from('booking_payments')
    .select('amount_cents, payment_type')
    .eq('booking_id', bookingId)
  if (payErr) return { ok: false, message: `booking_payments read failed: ${payErr.message}` }

  const { data: bkRow, error: bkErr } = await supabase
    .from('bookings')
    .select(columns)
    .eq('id', bookingId)
    .maybeSingle()
  if (bkErr) return { ok: false, message: `bookings read failed: ${bkErr.message}` }
  if (!bkRow) return { ok: false, message: `no booking row for id ${bookingId}` }

  return { ok: true, paidSum: sumPayments(payRows), row: bkRow as Record<string, unknown> }
}

/** A refund subtracts; everything else adds. */
export function sumPayments(
  rows: { amount_cents: number; payment_type: string }[] | null | undefined,
): number {
  let paid = 0
  for (const p of rows || []) {
    if (p.payment_type === 'refund') paid -= p.amount_cents
    else paid += p.amount_cents
  }
  return paid
}

export type BalanceOutcome = {
  balanceCents: number
  /**
   * Whether this booking is now settled. False when the total is absent or zero:
   * a lead that has never been quoted is not "paid in full" just because
   * `0 - 0 === 0`, and saying so stamps `paid_in_full_at` on a party nobody has
   * priced yet.
   */
  paidInFull: boolean
  /** Paid MORE than the total. The webhook flags this; so should the panel. */
  overpaidCents: number
}

/**
 * Derive the balance from a total and what has been paid.
 *
 * `totalCents` must be the real column value including `null` — do NOT pass
 * `total_cents || 0`, because the whole point of this function is that it can
 * tell an unpriced lead from a settled booking.
 */
export function computeBalance(totalCents: number | null | undefined, paidSum: number): BalanceOutcome {
  const total = typeof totalCents === 'number' && Number.isFinite(totalCents) ? totalCents : null
  if (total === null || total <= 0) {
    return { balanceCents: 0, paidInFull: false, overpaidCents: 0 }
  }
  const remaining = total - paidSum
  return {
    balanceCents: Math.max(0, remaining),
    paidInFull: remaining <= 0,
    overpaidCents: remaining < 0 ? -remaining : 0,
  }
}
