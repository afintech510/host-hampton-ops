/**
 * Plan pay links — minting the thing a customer clicks to pay (Phase 5 item 2).
 *
 * `booking_pay_links` has existed since migration 035, unused. This is the
 * wiring, and the order it was built in is the point: persistence and the
 * webhook match first, the panel afterwards. Plan §17 — *"the panel is only
 * safe once the webhook records what it charges. Half of it is worse than none
 * of it."*
 *
 * ── The one rule everything else here serves ────────────────────────────────
 *
 * **The amount is computed from the plan, server-side, and is never read from
 * the request.** A pay link whose amount comes from a request body is a discount
 * coupon for anyone who can edit a request. Every figure below is derived from
 * `loadPlanInvoice()`, which is also what renders the invoice the customer is
 * looking at, so the link and the document can never disagree.
 *
 * The single exception is an admin `custom` amount, and it is capped at what the
 * plan could possibly owe (`remaining + depositOwed`). An admin who needs to
 * charge more than the plan says adds the line item to the plan first — which is
 * the correct workflow anyway, because the invoice should say what the money was
 * for.
 *
 * ── The studio rule is imported, never restated ─────────────────────────────
 *
 * `planInvoice.ts` owns `depositIsSeparate`: for a studio rental the $250 is
 * held against damage, so Balance Due is the FULL total and the deposit is not
 * deducted. Everywhere else the deposit is a reservation payment and does come
 * off. This file takes that flag off the invoice and never re-derives it from
 * `party_type` — a constant declared in two files is a constant nothing is
 * checking, and this particular one decides whether we undercharge by $250 or
 * double-charge by $250.
 *
 * ── Why a Payment Link and not a Checkout Session ───────────────────────────
 *
 * Checkout Sessions expire 24h after creation with no way to extend. An invoice
 * link sits in an inbox for a week. Payment Links do not expire — and they carry
 * `restrictions.completed_sessions.limit`, which is how the same link is stopped
 * from being paid twice at the source rather than only reconciled afterwards.
 */

import crypto from 'crypto'
import type Stripe from 'stripe'
import { calculateCardFee } from '@/lib/partyPricing'
import { money, type PlanInvoice } from '@/lib/planInvoice'
import { getSupabase } from '@/lib/supabase'
import { writeLedger } from '@/lib/marketing/graph'

type Supa = ReturnType<typeof getSupabase>

/** Matches `booking_pay_links_purpose_check` (migration 035). */
export type PayPurpose = 'deposit' | 'balance' | 'custom'

export const PAY_PURPOSES: PayPurpose[] = ['deposit', 'balance', 'custom']

export function isPayPurpose(v: unknown): v is PayPurpose {
  return typeof v === 'string' && (PAY_PURPOSES as string[]).includes(v)
}

/** The columns of `booking_payments` this file's arithmetic depends on. */
export interface PaymentRow {
  amount_cents: number
  payment_type: string
}

export interface PayQuote {
  purpose: PayPurpose
  /** Credited against the plan. Derived from the invoice, never from a request. */
  amountCents: number
  /** The 3% card fee the invoice page already promises. Not credited. */
  feeCents: number
  /** What Stripe will actually collect: `amountCents + feeCents`. */
  chargeCents: number
  /** Customer-facing description; becomes the Stripe line item name. */
  label: string
}

export type QuoteResult = { ok: true; quote: PayQuote } | { ok: false; reason: string }

/** Stripe's own floor for a card charge. Below this the link cannot be created. */
export const MIN_CHARGE_CENTS = 100

/**
 * How much of what has been paid counts against the TOTAL.
 *
 * For a studio rental the security deposit does not, which is the whole of
 * `depositIsSeparate` expressed as arithmetic: counting it would make the
 * balance $250 short and we would undercharge every studio rental.
 *
 * A `refund` row always subtracts. Known limitation, stated rather than guessed
 * at: `booking_payments` does not record WHICH payment a refund reverses, so
 * refunding a studio security deposit subtracts $250 that was never added, and
 * the remaining balance reads $250 high. That errs towards asking for more, not
 * less, and it is a manual admin row either way — see PLAN.md "needs Adam".
 */
export function paidTowardTotalCents(payments: PaymentRow[], depositIsSeparate: boolean): number {
  let sum = 0
  for (const p of payments) {
    const amount = Number(p.amount_cents) || 0
    if (p.payment_type === 'refund') {
      sum -= amount
      continue
    }
    if (depositIsSeparate && p.payment_type === 'deposit') continue
    sum += amount
  }
  return sum
}

/** What is still owed against the total, after everything credited so far. */
export function remainingBalanceCents(invoice: PlanInvoice, payments: PaymentRow[]): number {
  const paid = paidTowardTotalCents(payments, invoice.depositIsSeparate)
  return Math.max(0, invoice.totalCents - paid)
}

/** What is still owed on the deposit itself — 0 once it has been paid. */
export function depositOwedCents(invoice: PlanInvoice, payments: PaymentRow[]): number {
  if (invoice.depositCents <= 0) return 0
  let paidDeposit = 0
  for (const p of payments) {
    if (p.payment_type === 'deposit') paidDeposit += Number(p.amount_cents) || 0
  }
  return Math.max(0, invoice.depositCents - paidDeposit)
}

function labelFor(invoice: PlanInvoice, purpose: PayPurpose): string {
  const doc = invoice.docTitle.replace(/ (Quotation|Invoice)$/, '')
  const ref = invoice.booking.booking_ref
  if (purpose === 'deposit') {
    return invoice.depositIsSeparate
      ? `${doc} security deposit — ${ref}`
      : `${doc} deposit — ${ref}`
  }
  if (purpose === 'balance') return `${doc} balance — ${ref}`
  return `${doc} payment — ${ref}`
}

/**
 * The amount for one purpose, or the reason there is nothing to charge.
 *
 * Pure: no IO, so the arithmetic that decides what a customer is charged is
 * testable without a database or a Stripe key.
 */
export function quoteFor(
  invoice: PlanInvoice,
  payments: PaymentRow[],
  purpose: PayPurpose,
  customCents?: number,
): QuoteResult {
  const remaining = remainingBalanceCents(invoice, payments)
  const depositOwed = depositOwedCents(invoice, payments)

  let amountCents: number
  if (purpose === 'deposit') {
    if (invoice.depositCents <= 0) return { ok: false, reason: 'This plan has no deposit due.' }
    if (depositOwed <= 0) return { ok: false, reason: 'The deposit on this plan is already paid.' }
    amountCents = depositOwed
  } else if (purpose === 'balance') {
    if (invoice.totalCents <= 0) {
      return { ok: false, reason: 'This plan has no priced items yet, so there is no balance to pay.' }
    }
    if (remaining <= 0) return { ok: false, reason: 'This plan is paid in full.' }
    amountCents = remaining
  } else {
    // Admin-only. Still bounded by the plan: the cap is what the plan could
    // possibly owe, so a mistyped figure cannot become a charge the invoice
    // does not justify.
    const cap = remaining + depositOwed
    if (!Number.isFinite(customCents) || !customCents || customCents <= 0) {
      return { ok: false, reason: 'Enter an amount.' }
    }
    const requested = Math.round(customCents)
    if (cap <= 0) return { ok: false, reason: 'This plan has nothing outstanding to charge against.' }
    if (requested > cap) {
      return {
        ok: false,
        reason: `That is more than this plan owes (${money(cap)}). Add the item to the plan first, then charge it.`,
      }
    }
    amountCents = requested
  }

  const feeCents = calculateCardFee(amountCents)
  const chargeCents = amountCents + feeCents
  if (chargeCents < MIN_CHARGE_CENTS) {
    return { ok: false, reason: `Card payments start at ${money(MIN_CHARGE_CENTS)}.` }
  }

  return { ok: true, quote: { purpose, amountCents, feeCents, chargeCents, label: labelFor(invoice, purpose) } }
}

/* ── Minting ───────────────────────────────────────────────────────────── */

/** Statuses on which no new money should be asked for. */
const UNPAYABLE_STATUSES = new Set(['cancelled'])

export interface PayLinkRow {
  id: string
  booking_id: string
  purpose: string
  amount_cents: number
  fee_cents: number
  stripe_payment_link_id: string | null
  url: string
  voided_at: string | null
}

export type MintResult =
  | { ok: true; payUrl: string; payLinkId: string; quote: PayQuote }
  | { ok: false; reason: string; retryable: boolean }

export const PAY_LINK_COLUMNS =
  'id, booking_id, purpose, amount_cents, fee_cents, stripe_payment_link_id, url, voided_at'

/**
 * Void every live link for this plan+purpose, in the DB and at Stripe.
 *
 * Called BEFORE a new link is created, never after, so there is no window in
 * which two links for the same purpose are both payable. If the new link then
 * fails to create, the customer has no link — which is safe. The other order
 * leaves a stale link live, and a stale link is exactly the "plan whose total
 * changed after the link was minted" problem: it would still take the old
 * amount.
 */
export async function voidLivePayLinks(
  db: Supa,
  stripe: Stripe,
  bookingId: string,
  purpose: PayPurpose,
): Promise<{ ok: boolean; voided: number; error?: string }> {
  const { data, error } = await db
    .from('booking_pay_links')
    .select(PAY_LINK_COLUMNS)
    .eq('booking_id', bookingId)
    .eq('purpose', purpose)
    .is('voided_at', null)
  if (error) return { ok: false, voided: 0, error: error.message }

  const rows = (data ?? []) as PayLinkRow[]
  for (const row of rows) {
    if (row.stripe_payment_link_id) {
      // Deactivating at Stripe is what actually stops the old URL working. A
      // DB-only void would leave a payable link we have merely stopped tracking,
      // which is worse than not voiding it at all.
      try {
        await stripe.paymentLinks.update(row.stripe_payment_link_id, { active: false })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'stripe deactivate failed'
        return { ok: false, voided: 0, error: `could not deactivate previous link: ${msg}` }
      }
    }
    const { error: updErr } = await db
      .from('booking_pay_links')
      .update({ voided_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('voided_at', null)
    if (updErr) return { ok: false, voided: 0, error: updErr.message }
  }
  return { ok: true, voided: rows.length }
}

/**
 * Create a pay link for one plan and one purpose, and record it.
 *
 * `actor` is `admin:<email>` from `adminActorId(req)` for an admin, or
 * `portal:<ref>` when the customer minted it themselves from the invoice.
 */
export async function createPlanPayLink(opts: {
  invoice: PlanInvoice
  payments: PaymentRow[]
  purpose: PayPurpose
  customCents?: number
  actor: string
  stripe: Stripe
  db?: Supa
  /** Absolute origin for the post-payment redirect, e.g. `https://www.hosthampton.com`. */
  origin: string
}): Promise<MintResult> {
  const db = opts.db ?? getSupabase()
  const { invoice, purpose, actor, stripe } = opts
  const booking = invoice.booking
  const ref = booking.booking_ref

  if (UNPAYABLE_STATUSES.has(booking.status ?? '')) {
    // Rule 10: a guardrail that stops something must also say that it stopped
    // it. Silence is what success looks like.
    console.warn(`createPlanPayLink refused: plan ${ref} is ${booking.status}`)
    await writeLedger(db, {
      entityType: 'booking',
      entityId: booking.id,
      action: 'note',
      actor,
      meta: { job: 'pay_link_refused', reason: 'plan_cancelled', purpose, status: booking.status },
    })
    return { ok: false, reason: 'This plan is cancelled. Please contact us before paying.', retryable: false }
  }

  const quoted = quoteFor(invoice, opts.payments, purpose, opts.customCents)
  if (!quoted.ok) return { ok: false, reason: quoted.reason, retryable: false }
  const quote = quoted.quote

  const voided = await voidLivePayLinks(db, stripe, booking.id, purpose)
  if (!voided.ok) {
    console.error(`createPlanPayLink: could not void previous links for ${ref}:`, voided.error)
    return { ok: false, reason: 'Could not replace the previous payment link — try again.', retryable: true }
  }

  // The row id is generated here rather than by the DB default, because it has
  // to be inside the Stripe metadata that the webhook matches on and the link
  // has to exist before the row can name it. Generating it up front breaks that
  // circle without a second UPDATE.
  const payLinkId = crypto.randomUUID()

  const metadata: Record<string, string> = {
    type: 'plan_pay_link',
    booking_ref: ref,
    booking_id: booking.id,
    purpose,
    pay_link_row_id: payLinkId,
    amount_cents: String(quote.amountCents),
    fee_cents: String(quote.feeCents),
    invoice_number: invoice.invoiceNumber ?? '',
  }

  let payUrl: string
  let stripeLinkId: string
  let stripePriceId: string
  try {
    const product = await stripe.products.create({
      name: quote.label,
      metadata: { booking_ref: ref, purpose },
    })
    const price = await stripe.prices.create({
      product: product.id,
      currency: 'usd',
      unit_amount: quote.amountCents,
    })
    stripePriceId = price.id

    const lineItems: Stripe.PaymentLinkCreateParams.LineItem[] = [{ price: price.id, quantity: 1 }]

    // The fee is its own line so the customer sees on Stripe's own page exactly
    // what the invoice page promised them ("a 3% processing fee applies to card
    // payments; Venmo and Zelle avoid it"). Folding it into the amount would
    // make the figure on the link disagree with the figure on the invoice.
    if (quote.feeCents > 0) {
      const feeProduct = await stripe.products.create({
        name: 'Card processing fee (3%)',
        metadata: { booking_ref: ref, purpose },
      })
      const feePrice = await stripe.prices.create({
        product: feeProduct.id,
        currency: 'usd',
        unit_amount: quote.feeCents,
      })
      lineItems.push({ price: feePrice.id, quantity: 1 })
    }

    const link = await stripe.paymentLinks.create({
      line_items: lineItems,
      metadata,
      // Stripe itself refuses a second payment on this link. The unique index on
      // `booking_payments.stripe_session_id` catches a redelivered webhook; this
      // catches a customer clicking an old email twice, which is a different
      // failure and needs its own stop.
      restrictions: { completed_sessions: { limit: 1 } },
      after_completion: {
        type: 'redirect',
        redirect: { url: `${opts.origin}/plan/${encodeURIComponent(ref)}/summary?paid=1` },
      },
    })
    payUrl = link.url
    stripeLinkId = link.id
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'stripe error'
    console.error(`createPlanPayLink: stripe create failed for ${ref}:`, msg)
    return { ok: false, reason: 'Stripe could not create the payment link — try again.', retryable: true }
  }

  const { error: insErr } = await db.from('booking_pay_links').insert({
    id: payLinkId,
    booking_id: booking.id,
    purpose,
    amount_cents: quote.amountCents,
    fee_cents: quote.feeCents,
    stripe_payment_link_id: stripeLinkId,
    stripe_price_id: stripePriceId,
    url: payUrl,
    created_by: actor,
  })

  if (insErr) {
    // A live link we did not record is precisely the gap migration 035 exists to
    // close: money could arrive against nothing. Take the link back down rather
    // than leave it payable and untraceable.
    console.error(`createPlanPayLink: row insert failed for ${ref}, deactivating link:`, insErr.message)
    try {
      await stripe.paymentLinks.update(stripeLinkId, { active: false })
    } catch (err) {
      // Now it IS an untracked live link. Say so loudly — this is the one case
      // here that needs a human.
      console.error(
        `createPlanPayLink: ORPHANED LIVE PAY LINK ${stripeLinkId} for ${ref} — could not deactivate:`,
        err instanceof Error ? err.message : err,
      )
    }
    return { ok: false, reason: 'Could not record the payment link — try again.', retryable: true }
  }

  await writeLedger(db, {
    entityType: 'booking',
    entityId: booking.id,
    action: 'note',
    actor,
    meta: {
      job: 'pay_link_created',
      purpose,
      pay_link_id: payLinkId,
      amount_cents: quote.amountCents,
      fee_cents: quote.feeCents,
      stripe_payment_link_id: stripeLinkId,
      replaced_links: voided.voided,
    },
  })

  return { ok: true, payUrl, payLinkId, quote }
}
