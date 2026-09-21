/**
 * What happens to a payment AFTER it succeeds — and the two events that mean
 * money is going back out.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * `/api/webhook` has branches for four Stripe events, and every one of them is
 * a payment arriving. Measured against the live account on 2026-09-21, the
 * handler contains no occurrence of the words `refund`, `dispute` or
 * `payment_failed`, and the endpoint is subscribed to none of those events. So:
 *
 *  - **A refund was invisible to the books.** Four admin refunds — 3 tickets and
 *    1 booking, **$312.01** — had already been issued when link 18 measured the
 *    admin surface, and none reached `financial_transactions`. The Financials
 *    tab therefore overstates revenue by every dollar ever sent back, and a
 *    refund issued from the Stripe dashboard (which is how Adam issues them) was
 *    recorded in no table at all.
 *  - **A chargeback was invisible, and a chargeback has a CLOCK.** Stripe gives
 *    roughly ten days to submit evidence, withdraws the money immediately, and
 *    the case is lost by default if nobody answers. Every other alert on this
 *    surface can wait for someone to read a log; this one cannot.
 *  - **A declined card was invisible.** A customer trying to pay a balance whose
 *    card fails is a customer who believes they have paid and a booking that
 *    stays unpaid.
 *
 * ── The two rules this file is built on ─────────────────────────────────────
 *
 * **1. Money out is a negative ledger row, not a deletion.** `amount_cents` is a
 * plain integer with no CHECK and `lib/financialLedger.ts` already documents
 * negatives as the refund representation. Reversing by subtracting keeps the
 * original payment row — which is what reconciling against Stripe needs — and
 * `(source, reference)`'s unique index makes a redelivery a no-op.
 *
 * **2. The idempotency key is the REFUND, never the charge.** A charge can be
 * refunded several times (two partials, then the rest). `charge.refunded` fires
 * on each one and carries the *cumulative* `amount_refunded`, so keying on the
 * charge would record the first refund and silently swallow every later one —
 * the same shape as the `pb-<ref>-partial` reference link 16 had to change
 * because a customer's *second* partial payment produced the same string as the
 * first. Each `re_…` id gets its own row.
 *
 * ── What this file deliberately does NOT do ─────────────────────────────────
 *
 * It does not touch `booking_payments`, and therefore does not move any
 * booking's balance. A refund arguably should raise the balance due again, but
 * `booking_payments` is the multiplier behind every live invoice and portal
 * balance (`lib/planBalance.ts`), and silently re-opening a settled invoice from
 * a webhook is a customer-facing change, not a bookkeeping one. The books are
 * corrected here and Adam is told; what the invoice should say is his call.
 */

import type Stripe from 'stripe'
import { Resend } from 'resend'
import { recordLedgerEntry, type FinancialWrite } from './financialLedger'
import { money } from './planInvoice'
import { ownerEmail, notifyOwnerSms } from './ownerNotify'
import { escapeHtml } from './escapeHtml'

type MinimalClient = { from: (table: string) => any }

/**
 * The events this file handles, in ONE list — the same convention
 * `HANDLED_SESSION_TYPES` established, and for the same reason: the endpoint's
 * subscription at Stripe and the handler's branches are two halves of one fact,
 * and link 16 found them disagreeing for six months with $3,596.50 in the gap.
 * `/api/cron/stripe-reconcile` compares this list against the live endpoint.
 */
export const AFTERMATH_EVENT_TYPES = [
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
  'payment_intent.payment_failed',
] as const

export type AftermathEventType = (typeof AFTERMATH_EVENT_TYPES)[number]

/**
 * Events that arrive as a payment SUCCEEDING. These four were the endpoint's
 * whole subscription before link 21.
 */
export const SUCCESS_EVENT_TYPES = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'payment_intent.succeeded',
] as const

/**
 * Every event `/api/webhook` has a branch for — the list the LIVE endpoint's
 * `enabled_events` is expected to equal.
 *
 * This exists because the gap between those two lists is the most expensive bug
 * this surface has produced. The endpoint was created on 2026-03-05 subscribed
 * to `checkout.session.completed` alone, while the handler's first branch — 390
 * lines of it — was `payment_intent.succeeded`. Stripe never sent one for six
 * months, and **$3,596.50** of real card payments landed in no
 * `financial_transactions` row. Nothing anywhere compared the two, and nothing
 * could have: the subscription lives at Stripe and the branches live in git.
 *
 * `/api/cron/stripe-reconcile` now compares them on every run, which is the
 * check that would have caught it in a day instead of six months.
 */
export const EXPECTED_WEBHOOK_EVENTS: readonly string[] = [
  ...SUCCESS_EVENT_TYPES,
  ...AFTERMATH_EVENT_TYPES,
]

/** The category a refund lands in, so it is filterable in the admin Financials tab. */
export const REFUND_CATEGORY = 'Refund'

/**
 * The ledger reference for one Stripe refund — defined ONCE, because two
 * different writers produce it.
 *
 * A refund issued from the admin panel goes through `lib/adminRefund.ts`, which
 * records its own ledger row; Stripe then fires `charge.refunded` and this
 * webhook would record a SECOND one. Two negative rows for one refund is a
 * double-count in the direction that understates revenue, and it is invisible —
 * both rows look correct on their own.
 *
 * So both writers use this reference and `source: 'stripe'`, and
 * `idx_fin_txn_source_ref` makes whichever arrives second a no-op. The admin
 * path used `source: 'other'` and an `admin-refund-…` reference, which is the
 * right answer for a books-only reversal with no Stripe charge behind it — it
 * still does that when there is no refund id. What changed is that a refund
 * which really went through Stripe now lives in Stripe's reference space, where
 * the webhook's copy of it can collide with it on purpose.
 */
export function stripeRefundReference(refundId: string): string {
  return `stripe-refund-${refundId}`
}

/** The category a lost dispute lands in. Kept apart from an ordinary refund because it is not one. */
export const DISPUTE_CATEGORY = 'Chargeback'

// ── Refunds ─────────────────────────────────────────────────────────────────

export type RefundRecord = {
  refundId: string
  amountCents: number
  outcome: FinancialWrite
}

export type RefundOutcome =
  | { ok: true; records: RefundRecord[]; written: number; duplicates: number }
  | { ok: false; message: string }

/**
 * Put every refund on a charge into the books as a negative row.
 *
 * `refunds` is passed in rather than read off `charge.refunds`, because a
 * webhook payload does not reliably expand that list — the caller fetches it
 * from the API so "this charge has no refunds" can never be a serialisation
 * artefact read as fact. (Hard-won rule 12: a lookup that can fail has three
 * outcomes, and an absent list is not an empty one.)
 *
 * A single `failed` write fails the WHOLE call, so the caller can 500 and let
 * Stripe redeliver. Recording three of four refunds and answering 200 would
 * leave the fourth permanently missing, which is the shape of the original bug.
 */
export async function recordChargeRefunds(
  supabase: MinimalClient,
  charge: Pick<Stripe.Charge, 'id' | 'currency' | 'billing_details' | 'payment_intent'>,
  refunds: Array<Pick<Stripe.Refund, 'id' | 'amount' | 'created' | 'reason' | 'status'>>,
): Promise<RefundOutcome> {
  const customerName = charge.billing_details?.name ?? null
  const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null
  const records: RefundRecord[] = []

  for (const refund of refunds) {
    // A refund that has not succeeded is not money out. `pending` becomes
    // `succeeded` (or `failed`) later and fires its own event; recording it now
    // would subtract money that may never leave.
    if (refund.status !== 'succeeded') {
      console.log(`stripe refund ${refund.id} status=${String(refund.status)} — not recording, not money out yet`)
      continue
    }

    const amountCents = Math.abs(Number(refund.amount) || 0)
    if (amountCents <= 0) continue

    const outcome = await recordLedgerEntry(supabase, {
      date: refundDate(refund.created),
      description:
        `Refund — Stripe${customerName ? ` (${customerName})` : ''}` +
        `${refund.reason ? ` · ${refund.reason}` : ''}`,
      // Negative: money OUT. See the file header.
      amountCents: -amountCents,
      source: 'stripe',
      category: REFUND_CATEGORY,
      customerName,
      reference: stripeRefundReference(refund.id),
      notes: [`charge ${charge.id}`, piId ? `payment_intent ${piId}` : null, `refund ${refund.id}`]
        .filter(Boolean)
        .join(' · '),
    })

    if (outcome === 'failed') {
      return { ok: false, message: `could not record refund ${refund.id} (${amountCents}c) for charge ${charge.id}` }
    }
    records.push({ refundId: refund.id, amountCents, outcome })
  }

  return {
    ok: true,
    records,
    written: records.filter(r => r.outcome === 'written').length,
    duplicates: records.filter(r => r.outcome === 'duplicate').length,
  }
}

/**
 * The date a refund belongs to in the books — the day STRIPE says it happened,
 * not the day we processed the event.
 *
 * It matters because a redelivery three days later must produce the same row,
 * and because the box runs UTC: link 20 found `setHours()` scheduling every
 * reminder 4–5 hours early for exactly this reason. `toISOString()` on a
 * Stripe-supplied epoch is UTC on both sides, which is the one thing that
 * reconciles against Stripe's own reporting.
 */
export function refundDate(created: number | null | undefined): string {
  const ms = Number(created) * 1000
  const d = Number.isFinite(ms) && ms > 0 ? new Date(ms) : new Date()
  return d.toISOString().split('T')[0]
}

// ── Disputes ────────────────────────────────────────────────────────────────

export type DisputeSummary = {
  id: string
  amountCents: number
  reason: string
  status: string
  /** `YYYY-MM-DD` Stripe stops accepting evidence, or null when it did not say. */
  dueBy: string | null
  /** Whole days from now until `dueBy`, or null. Negative means it has passed. */
  daysLeft: number | null
  customerName: string | null
  chargeId: string | null
}

/**
 * Flatten a dispute into the handful of facts an alert needs.
 *
 * `evidence_details.due_by` is the field that makes this event different from
 * every other one on this surface: it is a deadline, and missing it loses the
 * money automatically with no further notice.
 */
export function summarizeDispute(dispute: Stripe.Dispute, now: Date = new Date()): DisputeSummary {
  const dueEpoch = Number(dispute.evidence_details?.due_by) || 0
  const dueDate = dueEpoch > 0 ? new Date(dueEpoch * 1000) : null
  const daysLeft = dueDate ? Math.floor((dueDate.getTime() - now.getTime()) / 86_400_000) : null
  return {
    id: dispute.id,
    amountCents: Math.abs(Number(dispute.amount) || 0),
    reason: String(dispute.reason ?? 'unknown'),
    status: String(dispute.status ?? 'unknown'),
    dueBy: dueDate ? dueDate.toISOString().split('T')[0] : null,
    daysLeft,
    customerName: null,
    chargeId: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id ?? null,
  }
}

/**
 * Is this closed dispute one we LOST — i.e. did the money actually leave?
 *
 * `charge.dispute.closed` fires for every terminal status. Only `lost` moves
 * money permanently; `won` returns it and `warning_closed` never took it. This
 * predicate is the whole reason the closed event is handled at all, and it is
 * stated once so the route cannot reinvent it (rule 11).
 */
export function disputeWasLost(dispute: Pick<Stripe.Dispute, 'status'>): boolean {
  return dispute.status === 'lost'
}

/**
 * Record a LOST dispute as money out.
 *
 * Deliberately on `closed/lost` rather than on `created`: Stripe withdraws the
 * funds when the dispute opens, but it returns them if we win, and a ledger that
 * books every chargeback as a loss would understate revenue by every dispute
 * ever successfully contested. The books move once, when the outcome is final.
 */
export async function recordLostDispute(
  supabase: MinimalClient,
  dispute: Stripe.Dispute,
  customerName: string | null = null,
): Promise<FinancialWrite> {
  const amountCents = Math.abs(Number(dispute.amount) || 0)
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id ?? null
  return recordLedgerEntry(supabase, {
    date: refundDate(dispute.created),
    description: `Chargeback LOST — Stripe${customerName ? ` (${customerName})` : ''} · ${String(dispute.reason ?? 'unknown')}`,
    amountCents: -amountCents,
    source: 'stripe',
    category: DISPUTE_CATEGORY,
    customerName,
    reference: `stripe-dispute-${dispute.id}`,
    notes: [chargeId ? `charge ${chargeId}` : null, `dispute ${dispute.id}`, `reason ${String(dispute.reason ?? 'unknown')}`]
      .filter(Boolean)
      .join(' · '),
  })
}

// ── Failed payments ─────────────────────────────────────────────────────────

export type FailedPayment = {
  paymentIntentId: string
  amountCents: number
  /** Stripe's customer-facing decline message, when it gave one. */
  message: string | null
  /** e.g. `card_declined`, `insufficient_funds`. */
  code: string | null
  bookingRef: string | null
  customerEmail: string | null
}

export function summarizeFailedPayment(pi: Stripe.PaymentIntent): FailedPayment {
  const m = pi.metadata || {}
  const err = pi.last_payment_error
  return {
    paymentIntentId: pi.id,
    amountCents: Math.abs(Number(pi.amount) || 0),
    message: err?.message ?? null,
    code: err?.decline_code ?? err?.code ?? null,
    bookingRef: m.booking_ref || m.bookingRef || null,
    customerEmail: pi.receipt_email || m.contactEmail || null,
  }
}

/**
 * Should a human be told about this decline?
 *
 * Only when we can say WHICH booking it was for. A card declining on an anonymous
 * ticket purchase is routine — the customer sees it instantly and tries another
 * card, and mailing Adam about each one trains him to ignore the category, which
 * is the failure mode `UNCLAIMED_CATEGORY` was careful to avoid. A decline
 * carrying a `booking_ref` is different: that is a real customer paying a real
 * balance, believing it went through, on a booking that will stay unpaid.
 *
 * Every decline is logged either way. This governs the EMAIL, not the record.
 */
export function shouldAlertOnFailedPayment(failed: Pick<FailedPayment, 'bookingRef'>): boolean {
  return !!failed.bookingRef
}

/** One-line log summary, used by the route and asserted by the tripwire. */
export function failedPaymentLogLine(failed: FailedPayment): string {
  return (
    `STRIPE PAYMENT FAILED: ${money(failed.amountCents)} on ${failed.paymentIntentId}` +
    `${failed.bookingRef ? ` for booking ${failed.bookingRef}` : ' (no booking ref)'}` +
    `${failed.code ? ` — ${failed.code}` : ''}${failed.message ? `: ${failed.message}` : ''}`
  )
}

// ── Telling a human ─────────────────────────────────────────────────────────

/**
 * Send one owner email. Never throws: an alert that fails must not turn into a
 * 500 that makes Stripe redeliver an event we already recorded correctly.
 *
 * Returns whether it actually went, because `notifyOwnerSms`' own history is the
 * argument for it — a counter that reports what was ATTEMPTED told this codebase
 * texts had gone out when the provider had refused them.
 */
async function sendOwnerEmail(subject: string, html: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — owner alert not sent:', subject)
    return false
  }
  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
  try {
    await resend.emails.send({ from, to: ownerEmail(), subject, html })
    return true
  } catch (err) {
    console.error('owner alert failed (non-fatal):', subject, err instanceof Error ? err.message : err)
    return false
  }
}

/**
 * A chargeback has been opened. This is the loudest alert on the surface, and
 * the only one that also sends an SMS.
 *
 * The justification for the text is the deadline: every other alert here can
 * wait until someone reads their email, and this one is a fixed number of days
 * after which the money is gone with no second notice. `notifyOwnerSms` is a
 * no-op when `REVIEWER_PHONES` is unset, so this is safe in tests and local.
 */
export async function alertDisputeOpened(d: DisputeSummary): Promise<void> {
  const deadline = d.dueBy
    ? `${d.dueBy}${d.daysLeft === null ? '' : ` (${d.daysLeft} day${d.daysLeft === 1 ? '' : 's'} from now)`}`
    : 'not stated by Stripe'

  console.error(
    `STRIPE DISPUTE OPENED: ${money(d.amountCents)} on charge ${d.chargeId ?? '—'}` +
      ` (dispute ${d.id}, reason ${d.reason}) — evidence due ${deadline}.`,
  )

  await Promise.allSettled([
    sendOwnerEmail(
      `⚠️ Chargeback: ${money(d.amountCents)} — evidence due ${d.dueBy ?? 'soon'}`,
      `<p style="font-family:sans-serif;font-size:15px">` +
        `A customer has disputed a <strong>${money(d.amountCents)}</strong> payment with their bank.<br><br>` +
        `<strong>Stripe has already taken the money back.</strong> You get it back only if you submit evidence and win.<br><br>` +
        `Reason: <strong>${escapeHtml(d.reason)}</strong><br>` +
        `Evidence due: <strong>${escapeHtml(deadline)}</strong><br>` +
        `Charge: <code>${escapeHtml(d.chargeId ?? '—')}</code><br>` +
        `Dispute: <code>${escapeHtml(d.id)}</code><br><br>` +
        `Respond in the Stripe dashboard under Payments → Disputes. ` +
        `<strong>If nobody responds by the due date the dispute is lost automatically.</strong>` +
        `</p>`,
    ),
    notifyOwnerSms(
      `Host Hampton: CHARGEBACK ${money(d.amountCents)}, reason ${d.reason}. ` +
        `Evidence due ${d.dueBy ?? 'soon'}. Respond in Stripe or it is lost automatically.`,
    ),
  ])
}

/** A refund reached the books. Informational — the money moved on purpose. */
export async function alertRefundRecorded(
  totalCents: number,
  records: RefundRecord[],
  chargeId: string,
  customerName: string | null,
): Promise<void> {
  await sendOwnerEmail(
    `Refund recorded: ${money(totalCents)}${customerName ? ` to ${customerName}` : ''}`,
    `<p style="font-family:sans-serif;font-size:15px">` +
      `<strong>${money(totalCents)}</strong> was refunded on Stripe and has been subtracted from the Financials tab ` +
      `under <strong>${escapeHtml(REFUND_CATEGORY)}</strong>.<br><br>` +
      `Customer: ${escapeHtml(customerName) || '—'}<br>` +
      `Charge: <code>${escapeHtml(chargeId)}</code><br>` +
      `Refunds: ${records.map(r => `<code>${escapeHtml(r.refundId)}</code> ${money(r.amountCents)}`).join(', ')}<br><br>` +
      `<em>Note: this does not change what the customer's invoice or portal says they owe. ` +
      `If this refund should re-open a balance, adjust the party plan directly.</em>` +
      `</p>`,
  )
}

/**
 * A customer's card was declined on a payment against a known booking.
 *
 * Gated by `shouldAlertOnFailedPayment` at the call site, not here, so the
 * predicate has one home and the tripwire can check it is consulted.
 */
export async function alertPaymentFailed(failed: FailedPayment): Promise<void> {
  await sendOwnerEmail(
    `Card declined: ${money(failed.amountCents)} on ${failed.bookingRef ?? 'a booking'}`,
    `<p style="font-family:sans-serif;font-size:15px">` +
      `A payment of <strong>${money(failed.amountCents)}</strong> for booking ` +
      `<strong>${escapeHtml(failed.bookingRef ?? '—')}</strong> was declined.<br><br>` +
      `Reason: ${escapeHtml(failed.code ?? 'not stated')}${failed.message ? ` — ${escapeHtml(failed.message)}` : ''}<br>` +
      `Customer: ${escapeHtml(failed.customerEmail ?? '—')}<br>` +
      `Payment intent: <code>${escapeHtml(failed.paymentIntentId)}</code><br><br>` +
      `<strong>No money was taken and the balance is unchanged.</strong> ` +
      `The customer may believe the payment went through — it is worth reaching out.` +
      `</p>`,
  )
}
