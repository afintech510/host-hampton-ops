/**
 * Recording a plan payment (Phase 5 item 3) — the half that had to exist first.
 *
 * Plan §17 deferred the whole pay path on one sentence: *"the panel is only safe
 * once the webhook records what it charges. Half of it is worse than none of
 * it."* This is that half. Nothing here initiates a payment; it only records one
 * Stripe has already confirmed.
 *
 * ── The five rules this file is built out of ────────────────────────────────
 *
 * 1. **Only the webhook records.** The panel mints a link and nothing else. No
 *    other code path in the app writes a `booking_payments` row for a plan link,
 *    so there is exactly one place a payment can come into existence and it is
 *    downstream of a verified Stripe signature.
 *
 * 2. **Idempotency is mandatory, and it is the DB's job.**
 *    `idx_bp_stripe_session` is UNIQUE on `stripe_session_id`. A redelivered
 *    event hits it and comes back as 23505, which is handled as
 *    *already-recorded* — a success — not as an error. Stripe redelivers as a
 *    matter of course; a double-record is a phantom second payment in Adam's
 *    books.
 *
 * 3. **Never credit more than Stripe collected.** The amount is taken from
 *    `session.amount_total`, not from what we hoped to charge. If a link was
 *    minted before the plan's total changed, the customer paid the old figure and
 *    the remaining balance simply stays higher — which is correct, and strictly
 *    better than crediting an amount no money backs.
 *
 * 4. **A lookup has three outcomes, not two** (hard-won rule 12). "No such pay
 *    link" and "could not tell" are different answers, and collapsing them here
 *    would silently discard a real payment: a 200 tells Stripe never to retry.
 *    A read failure returns `retryable` and the route answers 500 so the event
 *    comes back.
 *
 * 5. **A payment for a cancelled plan is still recorded.** The money is real.
 *    Dropping it because the plan was cancelled would leave a charge with no row
 *    anywhere. It is recorded, flagged loudly, and the status is left alone —
 *    whether to refund is Adam's call, not this function's.
 */

import type Stripe from 'stripe'
import { Resend } from 'resend'
import { getSupabase } from '@/lib/supabase'
import { ownerEmail } from '@/lib/ownerNotify'
import { writeLedger } from '@/lib/marketing/graph'
import { loadPlanInvoice, money, type PlanInvoice } from '@/lib/planInvoice'
import {
  isPayPurpose,
  paidTowardTotalCents,
  remainingBalanceCents,
  PAY_LINK_COLUMNS,
  type PayPurpose,
  type PaymentRow,
  type PayLinkRow,
} from '@/lib/planPayLinks'

type Supa = ReturnType<typeof getSupabase>

/** What a matched session is a payment FOR. */
export interface PlanPayTarget {
  /** The `booking_pay_links` row, or null when only the Stripe metadata survived. */
  payLinkId: string | null
  bookingRef: string
  purpose: PayPurpose
  /** What the link was minted for. Used to separate the fee, never to credit. */
  expectedAmountCents: number
  feeCents: number
  /** True when the pay-link row was missing and metadata was the only source. */
  fromMetadataOnly: boolean
}

export type PlanPayMatch =
  | { outcome: 'unmatched' }
  /** Could not tell. The caller must NOT acknowledge the event. */
  | { outcome: 'error'; message: string }
  | { outcome: 'matched'; target: PlanPayTarget }

function metaString(m: Stripe.Metadata | null | undefined, key: string): string | null {
  const v = m?.[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * Is this completed Checkout Session a payment against a plan, and if so which?
 *
 * Three ways in, in descending order of trust:
 *   1. `pay_link_row_id` in the metadata — our own id, minted by
 *      `createPlanPayLink`. An exact row lookup.
 *   2. `session.payment_link` — Stripe's link id, matched against
 *      `stripe_payment_link_id`. This is the belt to (1)'s braces: it still
 *      works if metadata is ever lost in transit.
 *   3. The metadata alone. Only reached if the row has been deleted, and it
 *      exists so that a real payment is recorded even then.
 *
 * A session that is none of these returns `unmatched` and the caller falls
 * through to the pre-existing handlers — which is how the legacy admin
 * `/api/admin/pay-link` flow (also Payment Links, also `session.payment_link`)
 * keeps working untouched.
 */
export async function matchPlanPayLink(
  session: Stripe.Checkout.Session,
  db?: Supa,
): Promise<PlanPayMatch> {
  const supabase = db ?? getSupabase()
  const m = session.metadata
  const rowId = metaString(m, 'pay_link_row_id')
  const isPlanMeta = metaString(m, 'type') === 'plan_pay_link'
  const stripeLinkId =
    typeof session.payment_link === 'string'
      ? session.payment_link
      : session.payment_link?.id ?? null

  if (!rowId && !stripeLinkId && !isPlanMeta) return { outcome: 'unmatched' }

  let row: PayLinkRow | null = null

  if (rowId) {
    const { data, error } = await supabase
      .from('booking_pay_links')
      .select(PAY_LINK_COLUMNS)
      .eq('id', rowId)
      .maybeSingle()
    if (error) return { outcome: 'error', message: `pay link read failed: ${error.message}` }
    row = (data as PayLinkRow | null) ?? null
  }

  if (!row && stripeLinkId) {
    const { data, error } = await supabase
      .from('booking_pay_links')
      .select(PAY_LINK_COLUMNS)
      .eq('stripe_payment_link_id', stripeLinkId)
      .maybeSingle()
    if (error) return { outcome: 'error', message: `pay link read failed: ${error.message}` }
    row = (data as PayLinkRow | null) ?? null
  }

  if (row) {
    if (!isPayPurpose(row.purpose)) {
      return { outcome: 'error', message: `pay link ${row.id} has unknown purpose ${row.purpose}` }
    }
    const { data: bk, error: bkErr } = await supabase
      .from('bookings')
      .select('booking_ref')
      .eq('id', row.booking_id)
      .maybeSingle()
    if (bkErr) return { outcome: 'error', message: `booking read failed: ${bkErr.message}` }
    const bookingRef = (bk as { booking_ref: string } | null)?.booking_ref ?? null
    if (!bookingRef) {
      // The FK is ON DELETE CASCADE, so a link row without its booking should be
      // impossible. Treat it as an error rather than a miss: this needs a human,
      // and Stripe retrying keeps the event visible until one looks.
      return { outcome: 'error', message: `pay link ${row.id} has no booking` }
    }
    return {
      outcome: 'matched',
      target: {
        payLinkId: row.id,
        bookingRef,
        purpose: row.purpose,
        expectedAmountCents: row.amount_cents,
        feeCents: row.fee_cents,
        fromMetadataOnly: false,
      },
    }
  }

  // No row. Fall back to metadata only if the metadata says this was ours.
  const metaRef = metaString(m, 'booking_ref')
  const metaPurpose = metaString(m, 'purpose')
  if (isPlanMeta && metaRef && isPayPurpose(metaPurpose)) {
    console.error(
      `matchPlanPayLink: no booking_pay_links row for session ${session.id} (${metaRef}) — recording from metadata`,
    )
    return {
      outcome: 'matched',
      target: {
        payLinkId: null,
        bookingRef: metaRef,
        purpose: metaPurpose,
        expectedAmountCents: Number(metaString(m, 'amount_cents') ?? 0) || 0,
        feeCents: Number(metaString(m, 'fee_cents') ?? 0) || 0,
        fromMetadataOnly: true,
      },
    }
  }

  return { outcome: 'unmatched' }
}

export type RecordResult =
  | {
      ok: true
      /** True when this session was already recorded — a redelivery, not a new payment. */
      duplicate: boolean
      bookingRef: string
      amountCents: number
      newBalanceCents: number
    }
  | { ok: false; retryable: boolean; message: string }

/** Postgres unique-violation. Checked by CODE; the message text is not a contract. */
function isUniqueViolation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === '23505') return true
  return (err.message || '').toLowerCase().includes('duplicate')
}

/**
 * The payment type that matches what this money does, within
 * `booking_payments_payment_type_check` (`deposit | partial | final | refund`).
 */
function paymentTypeFor(purpose: PayPurpose, creditCents: number, remainingBefore: number): string {
  if (purpose === 'deposit') return 'deposit'
  if (remainingBefore > 0 && creditCents >= remainingBefore) return 'final'
  return 'partial'
}

/** Statuses a payment is allowed to move a plan INTO. */
function nextStatusFor(purpose: PayPurpose, newBalanceCents: number): string | null {
  if (newBalanceCents === 0) return 'paid_in_full'
  if (purpose === 'deposit') return 'deposit_paid'
  return null
}

/**
 * Record a confirmed Stripe payment against a plan.
 *
 * Only ever called from the Stripe webhook, after signature verification.
 */
export async function recordPlanPayment(
  target: PlanPayTarget,
  session: Stripe.Checkout.Session,
  db?: Supa,
): Promise<RecordResult> {
  const supabase = db ?? getSupabase()
  const ref = target.bookingRef

  // The invoice is the single source of truth for the total and for the studio
  // deposit rule — the same function that rendered the document the customer
  // paid from, so the ledger and the invoice cannot disagree.
  const loaded = await loadPlanInvoice(ref, supabase)
  if (!loaded.ok) {
    if (loaded.notFound) {
      // Money arrived for a plan that does not exist. Retrying will not conjure
      // one, so do not ask Stripe to — but this is an alert, not a shrug.
      console.error(`recordPlanPayment: PAYMENT FOR UNKNOWN PLAN ${ref}, session ${session.id}`)
      return { ok: false, retryable: false, message: `no such plan: ${ref}` }
    }
    return { ok: false, retryable: true, message: `invoice load failed: ${loaded.error}` }
  }
  const invoice: PlanInvoice = loaded.invoice
  const bookingId = invoice.booking.id

  const { data: beforeRows, error: payReadErr } = await supabase
    .from('booking_payments')
    .select('amount_cents, payment_type')
    .eq('booking_id', bookingId)
  if (payReadErr) {
    return { ok: false, retryable: true, message: `payments read failed: ${payReadErr.message}` }
  }
  const before = (beforeRows ?? []) as PaymentRow[]
  const remainingBefore = remainingBalanceCents(invoice, before)

  // ── What was actually collected ──────────────────────────────────────────
  // Rule 3 in the header: the truth is Stripe's figure, not ours. The recorded
  // fee is subtracted out so the credited amount is what the plan is owed; it is
  // clamped so a smaller-than-expected charge can never produce a negative
  // credit or a fee larger than the payment.
  const chargedCents = session.amount_total ?? 0
  const feeCents = Math.max(0, Math.min(target.feeCents, chargedCents))
  const creditCents = Math.max(0, chargedCents - feeCents)

  const expectedCharge = target.expectedAmountCents + target.feeCents
  const mismatch = target.expectedAmountCents > 0 && chargedCents !== expectedCharge
  if (mismatch) {
    console.warn(
      `recordPlanPayment: ${ref} charged ${chargedCents}c but link expected ${expectedCharge}c — crediting what was paid`,
    )
  }

  const isCancelled = invoice.booking.status === 'cancelled'
  if (isCancelled) {
    // Rule 10: say that it happened. The money is recorded either way.
    console.error(`recordPlanPayment: payment received on CANCELLED plan ${ref}, session ${session.id}`)
  }

  const notes: string[] = [`Plan pay link (${target.purpose})`]
  if (mismatch) notes.push(`link expected ${money(expectedCharge)}, Stripe collected ${money(chargedCents)}`)
  if (isCancelled) notes.push('PLAN WAS CANCELLED when this payment arrived — review')
  if (target.fromMetadataOnly) notes.push('pay link row missing; recorded from Stripe metadata')

  const paymentType = paymentTypeFor(target.purpose, creditCents, remainingBefore)

  const { error: insErr } = await supabase.from('booking_payments').insert({
    booking_id: bookingId,
    payment_type: paymentType,
    payment_method: 'card',
    amount_cents: creditCents,
    card_fee_cents: feeCents,
    total_charged_cents: chargedCents,
    stripe_payment_intent_id:
      typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null,
    stripe_session_id: session.id,
    recorded_by: 'system',
    notes: notes.join(' · '),
  })

  if (insErr) {
    if (isUniqueViolation(insErr)) {
      // Already recorded. This is the ordinary Stripe redelivery and it is a
      // success: returning an error would make Stripe retry forever.
      console.log(`recordPlanPayment: session ${session.id} already recorded for ${ref} — no-op`)
      const { data: balRow } = await supabase
        .from('bookings')
        .select('balance_due_cents')
        .eq('id', bookingId)
        .maybeSingle()
      return {
        ok: true,
        duplicate: true,
        bookingRef: ref,
        amountCents: creditCents,
        newBalanceCents: (balRow as { balance_due_cents: number | null } | null)?.balance_due_cents ?? 0,
      }
    }
    // The money is real and unrecorded. Ask Stripe to come back.
    console.error(`recordPlanPayment: insert failed for ${ref}:`, insErr.message)
    return { ok: false, retryable: true, message: `payment insert failed: ${insErr.message}` }
  }

  // ── Consume the link ────────────────────────────────────────────────────
  // `restrictions.completed_sessions.limit = 1` is what stops Stripe taking a
  // second payment; this records that it has been used, and is guarded on
  // `voided_at IS NULL` so a redelivery cannot overwrite the first timestamp.
  if (target.payLinkId) {
    await supabase
      .from('booking_pay_links')
      .update({ voided_at: new Date().toISOString() })
      .eq('id', target.payLinkId)
      .is('voided_at', null)
      .then(({ error }) => {
        if (error) console.error('recordPlanPayment: pay link void (non-fatal):', error.message)
      })
  }

  // ── Recompute the balance from authoritative rows ───────────────────────
  const { data: afterRows } = await supabase
    .from('booking_payments')
    .select('amount_cents, payment_type')
    .eq('booking_id', bookingId)
  const after = (afterRows ?? before.concat([{ amount_cents: creditCents, payment_type: paymentType }])) as PaymentRow[]
  const paid = paidTowardTotalCents(after, invoice.depositIsSeparate)
  const newBalanceCents = Math.max(0, invoice.totalCents - paid)

  // Two updates, deliberately. `bookings_scheduled_fields_check` (migration 035)
  // re-imposes date + time + name for every status past lead/quoted, so a status
  // advance on a plan that still has no date will be REFUSED by the constraint.
  // Bundled with the balance, that refusal would also lose the balance write —
  // which is the number the customer and Adam both look at.
  const balancePatch: Record<string, unknown> = { balance_due_cents: newBalanceCents }
  if (newBalanceCents === 0) balancePatch.paid_in_full_at = new Date().toISOString()
  const { error: balErr } = await supabase.from('bookings').update(balancePatch).eq('id', bookingId)
  if (balErr) console.error(`recordPlanPayment: balance update failed for ${ref}:`, balErr.message)

  const nextStatus = isCancelled ? null : nextStatusFor(target.purpose, newBalanceCents)
  if (nextStatus && nextStatus !== invoice.booking.status) {
    const { error: stErr } = await supabase.from('bookings').update({ status: nextStatus }).eq('id', bookingId)
    if (stErr) {
      // Expected and survivable: an unscheduled plan cannot legally be
      // `deposit_paid`. The payment is recorded and the balance is right; the
      // status catches up when the date is filled in. Rule 10 — say it.
      console.warn(
        `recordPlanPayment: ${ref} stays '${invoice.booking.status}' — status → '${nextStatus}' refused: ${stErr.message}`,
      )
    }
  }

  // ── Bookkeeping (all non-fatal; the payment row is the record) ───────────
  await supabase
    .from('booking_modifications')
    .insert({
      booking_id: bookingId,
      modified_by: 'system',
      change_summary:
        `${money(creditCents)} received via card pay link (${target.purpose})` +
        `${feeCents > 0 ? ` + ${money(feeCents)} card fee` : ''}. Balance: ${money(newBalanceCents)}`,
    })
    .then(({ error }) => {
      if (error) console.error('recordPlanPayment: modification log (non-fatal):', error.message)
    })

  await supabase
    .from('financial_transactions')
    .insert({
      date: new Date().toISOString().split('T')[0],
      description: `${invoice.docTitle.replace(/ (Quotation|Invoice)$/, '')} — ${target.purpose} (${ref})`,
      amount_cents: chargedCents,
      source: 'stripe',
      category: invoice.partyType === 'studio_rental' ? 'Room Rental' : 'Party Booking',
      customer_name: invoice.booking.contact_name,
      reference: `stripe-${session.id}`,
      notes: invoice.booking.contact_email,
    })
    .then(({ error }) => {
      if (error && !isUniqueViolation(error)) {
        console.error('recordPlanPayment: financial txn (non-fatal):', error.message)
      }
    })

  await writeLedger(supabase, {
    entityType: 'booking',
    entityId: bookingId,
    action: 'note',
    actor: 'system',
    meta: {
      job: 'plan_payment_recorded',
      purpose: target.purpose,
      pay_link_id: target.payLinkId,
      stripe_session_id: session.id,
      amount_cents: creditCents,
      fee_cents: feeCents,
      charged_cents: chargedCents,
      balance_due_cents: newBalanceCents,
      amount_mismatch: mismatch,
      plan_was_cancelled: isCancelled,
      from_metadata_only: target.fromMetadataOnly,
    },
  })

  console.log(
    `Plan payment recorded: ${ref} ${target.purpose} ${money(creditCents)} (charged ${money(chargedCents)}), balance ${money(newBalanceCents)}`,
  )

  return { ok: true, duplicate: false, bookingRef: ref, amountCents: creditCents, newBalanceCents }
}

/* ── Receipts ──────────────────────────────────────────────────────────── */

/**
 * A transactional receipt for a payment the customer themselves just made.
 *
 * This is not the "nothing auto-sends to a customer" rule being bent: that rule
 * governs quotes and drafted messages, which stay behind the gated `approved` /
 * `sent` edges in lib/marketing/graph.ts. A receipt for money the customer has
 * just handed over is the same category as the deposit receipt the webhook has
 * always sent, and a card charge with no confirmation generates a phone call.
 *
 * Non-fatal by construction: the payment row is the record of the payment, and
 * an email failure must never turn into a Stripe retry that re-runs the
 * recording path.
 */
export async function sendPlanPaymentReceipt(opts: {
  bookingRef: string
  customerName: string | null
  customerEmail: string | null
  amountCents: number
  feeCents: number
  newBalanceCents: number
  purpose: PayPurpose
  invoiceUrl: string | null
}): Promise<void> {
  if (!process.env.RESEND_API_KEY || !opts.customerEmail) return
  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
  const first = (opts.customerName || 'there').split(' ')[0]
  const what = opts.purpose === 'deposit' ? 'deposit' : 'payment'

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F6F1EB;">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%);padding:36px 40px;text-align:center;">
    <p style="color:#1a2744;opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton &middot; Speonk, NY</p>
    <h1 style="color:#1a2744;font-size:26px;margin:0;font-weight:normal;">Payment received</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:#1a2744;margin:0 0 20px;">Hi ${first},</p>
    <p style="color:#555;line-height:1.7;margin:0 0 24px;">Thank you &mdash; we&rsquo;ve received your ${what}.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
      <tr style="background:#f9f7f4;"><td style="padding:10px 12px;font-weight:bold;color:#1a2744;">Amount</td><td style="padding:10px 12px;color:#555;">${money(opts.amountCents)}</td></tr>
      ${opts.feeCents > 0 ? `<tr><td style="padding:10px 12px;font-weight:bold;color:#1a2744;">Card fee (3%)</td><td style="padding:10px 12px;color:#555;">${money(opts.feeCents)}</td></tr>` : ''}
      <tr style="background:#f9f7f4;"><td style="padding:10px 12px;font-weight:bold;color:#1a2744;">Balance remaining</td><td style="padding:10px 12px;color:#555;">${money(opts.newBalanceCents)}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;color:#1a2744;">Reference</td><td style="padding:10px 12px;color:#888;font-size:12px;">${opts.bookingRef}</td></tr>
    </table>
    ${opts.invoiceUrl ? `<div style="text-align:center;margin-bottom:24px;"><a href="${opts.invoiceUrl}" style="display:inline-block;background:#1a2744;color:#F6F1EB;padding:14px 40px;border-radius:50px;text-decoration:none;font-size:15px;font-weight:bold;">View your plan</a></div>` : ''}
    <p style="font-size:13px;color:#555;line-height:1.7;margin:0;">Questions? Call or text <strong>(631) 998-9325</strong>.</p>
  </div>
  <div style="background:#BCCDEB;padding:20px 40px;text-align:center;">
    <p style="color:#1a2744;font-size:12px;margin:0;">295 Montauk Highway, Suite 7 &middot; Speonk, NY 11972</p>
  </div>
</div>
</body></html>`

  await Promise.allSettled([
    resend.emails.send({
      from,
      to: opts.customerEmail,
      subject: `Payment received — ${opts.bookingRef} | Host Hampton`,
      html,
    }),
    resend.emails.send({
      from,
      to: ownerEmail(),
      subject: `Paid: ${opts.customerName || opts.customerEmail} — ${money(opts.amountCents)} (${opts.bookingRef})`,
      html:
        `<p style="font-family:sans-serif">` +
        `<strong>${money(opts.amountCents)}</strong> ${what} received for <strong>${opts.bookingRef}</strong>` +
        `${opts.feeCents > 0 ? ` (+ ${money(opts.feeCents)} card fee)` : ''}.<br>` +
        `Balance remaining: <strong>${money(opts.newBalanceCents)}</strong>.<br>` +
        `Customer: ${opts.customerName || '—'} &lt;${opts.customerEmail}&gt;` +
        `</p>`,
    }),
  ]).catch(err => console.error('sendPlanPaymentReceipt (non-fatal):', err))
}
