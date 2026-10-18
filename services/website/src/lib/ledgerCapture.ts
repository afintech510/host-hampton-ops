/**
 * Which Stripe money did THIS webhook delivery put in the books?
 *
 * Adam asked (2026-10-18) for one email after every Stripe payment. The webhook
 * already knows exactly once per payment that money landed: the
 * `financial_transactions` row is every branch's idempotency marker (a
 * redelivery comes back `duplicate`), so "a new Stripe row was written during
 * this delivery" is the one signal that cannot fire twice for one payment.
 *
 * The rows are written from a dozen branches through two writers
 * (`lib/financialLedger.ts`, `lib/planPayment.ts`), so rather than threading a
 * collector through every call this keeps a
 * per-request list in `AsyncLocalStorage`. Outside a capture (the admin panel,
 * a test) noting a write is a no-op.
 *
 * `lib/unclaimedPayment.ts` writes its own row and is deliberately NOT noted:
 * it already sends the owner a louder "UNCLAIMED STRIPE PAYMENT" email.
 */

import { AsyncLocalStorage } from 'async_hooks'

export type CapturedLedgerWrite = {
  description: string
  amountCents: number
  category: string
  customerName: string | null
  reference: string
  notes?: string | null
}

export type LedgerCapture = { writes: CapturedLedgerWrite[] }

const store = new AsyncLocalStorage<LedgerCapture>()

export function newLedgerCapture(): LedgerCapture {
  return { writes: [] }
}

/** Run `fn` with `capture` collecting every Stripe ledger row it writes. */
export function runWithLedgerCapture<T>(capture: LedgerCapture, fn: () => Promise<T>): Promise<T> {
  return store.run(capture, fn)
}

/** Record that a NEW Stripe row reached the books. Call only on a genuine first write. */
export function noteStripeLedgerWrite(write: CapturedLedgerWrite): void {
  store.getStore()?.writes.push(write)
}
