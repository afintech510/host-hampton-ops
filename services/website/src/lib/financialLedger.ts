/**
 * The one writer of `financial_transactions` — the table the admin Financials
 * tab reads, and therefore the table that decides what this business believes
 * about its own revenue.
 *
 * ── Why this file exists (link 18) ───────────────────────────────────────
 *
 * There was already a correct implementation of "record money in the books".
 * It was a PRIVATE function inside `src/app/api/webhook/route.ts`, so the only
 * surface that could reach it was the Stripe webhook. Every other way money
 * arrives at Host Hampton — a customer handing Allie cash at the party, a Venmo
 * transfer, a Zelle, a cheque, a card the webhook missed — is entered by a human
 * at the admin panel, and that path had no way to call it.
 *
 * Measured on the live database before anything was changed:
 *
 *   booking_payments recorded_by='admin' : 12 rows, $2,652.00
 *   …of those with NO financial row      :  8 rows, $2,256.00
 *   …of THAT which is not a card         :  5 rows, $1,608.00  (cash/venmo/zelle)
 *   financial_transactions rows with
 *     source in ('cash','other')         :  0, ever
 *
 * The `source` CHECK has allowed `'cash'` and `'other'` since the table was
 * created and there is no trigger on it, so the table would always have accepted
 * these rows (hard-won rule 17's second half: "never ran" and "could not have
 * run" look identical from outside — here it is neither, the code path simply
 * never existed). Four admin refunds have also been issued — 3 tickets and 1
 * booking, $312.01 — and none of those reached the books either, so the tab
 * overstates as well as understates.
 *
 * ── The duplicate problem, which is the reason this is not a one-liner ──
 *
 * Four of the twelve admin rows are a human RE-TYPING a Stripe deposit the
 * webhook had already recorded (`reference = 'stripe-bk-<booking_ref>'`, all
 * $99, notes like "Paid via Stripe Aug 19"). Blindly recording every admin
 * payment would put those in the books twice. So `recordAdminPayment` looks for
 * a ledger row that already covers this booking AT THE SAME AMOUNT and declines
 * with `already-in-books` rather than double-counting.
 *
 * That check is deliberately by REFERENCE (which contains the booking ref) and
 * exact cents — not by the amount+date proximity heuristic the handover brief
 * used. Measured why: an amount+date window matched TWO rows for two of the four
 * $99 payments, because $99 is the default deposit and several land in the same
 * week. A heuristic that is right by coincidence is not a reconciliation.
 */

import { isUniqueViolation } from './planPayment'

/** Sources `financial_transactions_source_check` permits. */
export const FINANCIAL_SOURCES = ['stripe', 'godaddy', 'squarespace', 'honeybook', 'cash', 'other'] as const
export type FinancialSource = (typeof FINANCIAL_SOURCES)[number]

/**
 * Three outcomes, not two. `duplicate` means this exact entry is already in the
 * books and is a SUCCESS (the unique index on `(source, reference)` is what
 * makes a retry safe); `failed` means the money is NOT in the books and a human
 * has to know.
 */
export type FinancialWrite = 'written' | 'duplicate' | 'failed'

type MinimalClient = {
  from: (table: string) => any
}

export type LedgerEntry = {
  /** `YYYY-MM-DD`. */
  date: string
  description: string
  /** Negative for a refund — the column is a plain integer with no CHECK. */
  amountCents: number
  source: FinancialSource
  category: string
  customerName: string | null
  /**
   * Unique per real-world event WITHIN its source. `(source, reference)` carries
   * `idx_fin_txn_source_ref`, so this is the idempotency key and it must be
   * stable across retries of the same event and different between two genuinely
   * different payments.
   */
  reference: string
  notes?: string | null
}

/**
 * Insert one row into the books.
 *
 * A duplicate is success. Anything else is logged loudly and reported as
 * `failed`, because the caller's next act is usually to tell a customer their
 * payment was received (hard-won rule 10: a guardrail must not say it did
 * something it did not).
 */
export async function recordLedgerEntry(
  supabase: MinimalClient,
  entry: LedgerEntry,
): Promise<FinancialWrite> {
  const { error } = await supabase.from('financial_transactions').insert({
    date: entry.date,
    description: entry.description,
    amount_cents: entry.amountCents,
    source: entry.source,
    category: entry.category,
    customer_name: entry.customerName,
    reference: entry.reference,
    notes: entry.notes || null,
  })
  if (!error) return 'written'
  if (isUniqueViolation(error)) return 'duplicate'
  console.error(
    `FINANCIAL ROW NOT WRITTEN for ${entry.source}/${entry.reference} ` +
      `(${entry.amountCents}c, ${entry.category}):`,
    error.message,
    '— this money will be missing from the Financials tab.',
  )
  return 'failed'
}
