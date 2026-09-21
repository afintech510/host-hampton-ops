/**
 * Money entered by a human at the admin panel, and how it reaches the books.
 *
 * The admin panel initiates three kinds of money movement that the Stripe
 * webhook never sees:
 *
 *   1. "Record a payment" on a party plan — cash, Venmo, Zelle, a cheque, or a
 *      card charge the webhook missed.  (`/api/admin/parties/[id]`)
 *   2. A ticket refund.                  (`/api/admin/orders/[id]/refund`,
 *                                         `/api/admin/events/[id]/tickets/[ticketId]/refund`)
 *   3. A booking deposit refund.         (`/api/admin/orders/[id]/refund`)
 *
 * None of the three wrote a `financial_transactions` row before link 18, so
 * none of them has ever appeared in the Financials tab. See
 * `lib/financialLedger.ts` for the measurement.
 *
 * ── The rule this file must not break ────────────────────────────────────
 *
 * "Never write a payment row the webhook did not confirm" still stands for CARD
 * money arriving through Stripe: the panel initiates, the webhook records. What
 * this file covers is the money that never goes through Stripe at all, which the
 * webhook cannot possibly confirm and which a human is the only witness to. The
 * ledger row it writes is explicitly sourced `cash`/`other` and referenced to
 * the `booking_payments` row a human created, so it is never mistaken for a
 * Stripe-settled payment.
 */

import { recordLedgerEntry, type FinancialSource, type FinancialWrite } from './financialLedger'
import { stripeRefundReference } from './stripeAftermath'

type MinimalClient = {
  from: (table: string) => any
}

/** The payment methods `booking_payments_payment_method_check` permits. */
export const ADMIN_PAYMENT_METHODS = ['card', 'cash', 'venmo', 'zelle', 'check', 'other'] as const
export type AdminPaymentMethod = (typeof ADMIN_PAYMENT_METHODS)[number]

/** The payment types `booking_payments_payment_type_check` permits. */
export const PAYMENT_TYPES = ['deposit', 'partial', 'final', 'refund'] as const
export type PaymentType = (typeof PAYMENT_TYPES)[number]

/**
 * Which ledger `source` a hand-entered payment belongs under.
 *
 * Only literal cash is `cash`. A card payment typed in by hand is NOT `stripe`:
 * `stripe` means "Stripe told us about this", and the whole reason these rows
 * exist is that it did not. Calling it `stripe` would also collide with the
 * webhook's own `stripe-…` reference space.
 */
export function ledgerSourceForMethod(method: string): FinancialSource {
  return method === 'cash' ? 'cash' : 'other'
}

/** Stable, unique per `booking_payments` row — the idempotency key. */
export function adminPaymentReference(paymentId: string): string {
  return `admin-bp-${paymentId}`
}

/** Stable, unique per refunded object. */
export function adminRefundReference(kind: 'ticket' | 'booking', objectId: string): string {
  return `admin-refund-${kind}-${objectId}`
}

export type CoveringRow = { reference: string; amount_cents: number; description: string; source: string }

export type CoverageLookup =
  | { kind: 'none' }
  | { kind: 'covered'; row: CoveringRow }
  | { kind: 'unavailable'; reason: string }

/**
 * Is this booking's money already in the books under some OTHER reference?
 *
 * Four of the twelve live admin payments are a human re-typing a Stripe deposit
 * the webhook already recorded as `stripe-bk-<booking_ref>`. Recording those
 * again would overstate revenue. So before writing, look for a ledger row whose
 * reference names this booking AND whose amount matches to the cent.
 *
 * Deliberately NOT an amount+date proximity match. Measured on the live table:
 * a ±3-day window at the same amount matched TWO rows for two of those four
 * payments, because $99 is the default deposit and several land in one week. A
 * match that is right by coincidence is not a reconciliation, and on an
 * accounting question the wrong answer is worse than no answer.
 *
 * Three outcomes (rule 12): a read that FAILS is not "nothing covers it", which
 * is the direction that double-counts.
 */
export async function findCoveringLedgerRow(
  supabase: MinimalClient,
  bookingRef: string | null | undefined,
  amountCents: number,
): Promise<CoverageLookup> {
  if (!bookingRef) return { kind: 'none' }
  // `bookingRef` is our own generated identifier (HH-…), not customer input, so
  // it carries no LIKE metacharacters — but escape anyway rather than rely on
  // that staying true, since `_` is a single-character wildcard.
  const escaped = bookingRef.replace(/([\\%_])/g, '\\$1')
  const { data, error } = await supabase
    .from('financial_transactions')
    .select('reference, amount_cents, description, source')
    .like('reference', `%${escaped}%`)
  if (error) return { kind: 'unavailable', reason: error.message }
  for (const row of (data || []) as CoveringRow[]) {
    if (row.amount_cents === amountCents) return { kind: 'covered', row }
  }
  return { kind: 'none' }
}

export type AdminLedgerOutcome =
  | { kind: 'recorded'; reference: string }
  | { kind: 'duplicate'; reference: string }
  | { kind: 'already-in-books'; reference: string; covering: CoveringRow }
  | { kind: 'failed'; reference: string; reason: string }

/** A sentence a human can act on, for the response body and the audit log. */
export function describeLedgerOutcome(o: AdminLedgerOutcome): string {
  switch (o.kind) {
    case 'recorded':
      return 'Recorded in the Financials tab.'
    case 'duplicate':
      return 'Already recorded in the Financials tab (no change).'
    case 'already-in-books':
      return `NOT added to the Financials tab — ${o.covering.source}/${o.covering.reference} ` +
        `already records this amount for this booking ("${o.covering.description}").`
    case 'failed':
      return `NOT recorded in the Financials tab: ${o.reason}. This money will not appear in reporting.`
  }
}

function fromWrite(write: FinancialWrite, reference: string, reason: string): AdminLedgerOutcome {
  if (write === 'written') return { kind: 'recorded', reference }
  if (write === 'duplicate') return { kind: 'duplicate', reference }
  return { kind: 'failed', reference, reason }
}

/**
 * Put a hand-entered payment in the books.
 *
 * `paymentId` is the `booking_payments` row this describes, so the caller must
 * have read its insert back (`.select()`) before calling — a ledger row for a
 * payment row that was refused is exactly the false statement this whole review
 * is about.
 */
export async function recordAdminPayment(
  supabase: MinimalClient,
  opts: {
    paymentId: string
    bookingRef: string | null
    amountCents: number
    method: string
    paidAt: string
    customerName: string | null
    category: string
    notes?: string | null
    /** Skip the covering-row check — an explicit human override. */
    force?: boolean
  },
): Promise<AdminLedgerOutcome> {
  const reference = adminPaymentReference(opts.paymentId)

  if (!opts.force) {
    const coverage = await findCoveringLedgerRow(supabase, opts.bookingRef, opts.amountCents)
    if (coverage.kind === 'unavailable') {
      return {
        kind: 'failed',
        reference,
        reason: `could not check for an existing ledger row (${coverage.reason}) — not recording, to avoid double-counting`,
      }
    }
    if (coverage.kind === 'covered') {
      return { kind: 'already-in-books', reference, covering: coverage.row }
    }
  }

  const method = opts.method || 'other'
  const write = await recordLedgerEntry(supabase, {
    date: opts.paidAt.slice(0, 10),
    description: `${titleCaseMethod(method)} payment — ${opts.bookingRef || 'booking'}`,
    amountCents: opts.amountCents,
    source: ledgerSourceForMethod(method),
    category: opts.category,
    customerName: opts.customerName,
    reference,
    notes: opts.notes || null,
  })
  return fromWrite(write, reference, 'insert failed')
}

/**
 * Put a refund in the books, as a NEGATIVE row.
 *
 * `amount_cents` is a plain integer with no CHECK, and the Financials summary
 * sums it, so a negative row is how a refund reduces reported revenue. Four
 * refunds totalling $312.01 have been issued from the panel and none of them
 * reached the books, so the tab currently overstates by that much.
 */
export async function recordAdminRefund(
  supabase: MinimalClient,
  opts: {
    kind: 'ticket' | 'booking'
    objectId: string
    /** Positive cents refunded; this function writes it negative. */
    amountCents: number
    refundedAt: string
    label: string
    customerName: string | null
    category: string
    notes?: string | null
    /** True when the money really left Stripe, false for a books-only reversal. */
    viaStripe: boolean
    /**
     * The `re_…` id, when Stripe issued one. Its presence moves this row into
     * Stripe's reference space so the `charge.refunded` webhook's row collides
     * with it instead of doubling it — see `stripeRefundReference`.
     */
    stripeRefundId?: string | null
  },
): Promise<AdminLedgerOutcome> {
  // A refund that really went through Stripe is keyed on the REFUND, because
  // the webhook is about to record the same event and `(source, reference)` is
  // what makes the second one a no-op. Link 21: before the webhook had a
  // `charge.refunded` branch there was only one writer, and `source: 'other'`
  // with an `admin-refund-…` reference was the right answer. Now there are two.
  const reference = opts.stripeRefundId
    ? stripeRefundReference(opts.stripeRefundId)
    : adminRefundReference(opts.kind, opts.objectId)
  const write = await recordLedgerEntry(supabase, {
    date: opts.refundedAt.slice(0, 10),
    description: `Refund — ${opts.label}`,
    amountCents: -Math.abs(opts.amountCents),
    // A books-only reversal stays under `other`: there is no Stripe object
    // behind it, so it does not belong in Stripe's reference space.
    source: opts.stripeRefundId ? 'stripe' : 'other',
    category: opts.category,
    customerName: opts.customerName,
    reference,
    notes: [opts.notes, opts.viaStripe ? 'Refunded via Stripe.' : 'No Stripe charge to reverse.']
      .filter(Boolean)
      .join(' ') || null,
  })
  return fromWrite(write, reference, 'insert failed')
}

/**
 * Which Financials-tab category a booking's money belongs in.
 *
 * The same three labels the Stripe webhook and `lib/planPayment.ts` already use
 * for the same products, so hand-entered money lands in the same bucket as card
 * money for the same party rather than inventing a category the reports do not
 * group on. `planPayment` keys off `partyType === 'studio_rental'`; this also
 * accepts the older `event_type` spellings, because `bookings.event_type` holds
 * ten distinct live values including a row whose value is a whole sentence.
 */
export function ledgerCategoryForBooking(
  partyType: unknown,
  eventType: unknown,
): 'Room Rental' | 'Mobile Party' | 'Party Booking' {
  const pt = typeof partyType === 'string' ? partyType.toLowerCase() : ''
  const et = typeof eventType === 'string' ? eventType.toLowerCase() : ''
  if (pt === 'studio_rental' || et.includes('room') || et.includes('rental')) return 'Room Rental'
  if (pt === 'mobile_party' || et.includes('mobile')) return 'Mobile Party'
  return 'Party Booking'
}

function titleCaseMethod(m: string): string {
  if (m === 'venmo') return 'Venmo'
  if (m === 'zelle') return 'Zelle'
  return m.charAt(0).toUpperCase() + m.slice(1)
}
