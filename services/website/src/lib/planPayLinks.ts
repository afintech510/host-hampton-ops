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
 * `planInvoice.ts` owns `depositIsSeparate`, and since needs-Adam 41 was ruled
 * (2026-09-16) it is false for every product: the deposit is a reservation
 * payment and comes off the total. This file takes that flag off the invoice and
 * never re-derives it from `party_type` — a constant declared in two files is a
 * constant nothing is checking, and this particular one decides whether we
 * undercharge by $250 or double-charge by $250.
 *
 * That discipline is why the ruling needed no edit here: `labelFor` and the
 * quote arithmetic read the flag and changed with it.
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
import { calculateCardFee, screenTipCents } from '@/lib/partyPricing'
import { money, type PlanInvoice } from '@/lib/planInvoice'
import { getSupabase } from '@/lib/supabase'
import { writeLedger } from '@/lib/marketing/graph'
import type { PaymentRow } from '@/lib/planBalance'

type Supa = ReturnType<typeof getSupabase>

/** Matches `booking_pay_links_purpose_check` (migration 035). */
export type PayPurpose = 'deposit' | 'balance' | 'custom'

export const PAY_PURPOSES: PayPurpose[] = ['deposit', 'balance', 'custom']

export function isPayPurpose(v: unknown): v is PayPurpose {
  return typeof v === 'string' && (PAY_PURPOSES as string[]).includes(v)
}

/**
 * Re-exported for the callers that have always imported it from here. The type
 * — and every figure derived from it — now lives in lib/planBalance.ts.
 */
export type { PaymentRow }

export interface PayQuote {
  purpose: PayPurpose
  /** Credited against the plan. Derived from the invoice, never from a request. */
  amountCents: number
  /**
   * Gratuity for the party team. The ONE figure here that comes from the
   * customer — see `screenTipCents`. Charged, never credited.
   */
  tipCents: number
  /** The 3% card fee the invoice page already promises. Not credited. */
  feeCents: number
  /** What Stripe will actually collect: `amountCents + tipCents + feeCents`. */
  chargeCents: number
  /** Customer-facing description; becomes the Stripe line item name. */
  label: string
}

/**
 * Which purposes may carry a tip.
 *
 * Only the balance. Adam's instruction was "a mechanism to add tip to the FINAL
 * payment", and it is the right shape independently: a reservation deposit is
 * paid months before anyone has run a party, so asking for a gratuity there
 * tips a service that has not happened yet. A tip sent on any other purpose is
 * dropped silently rather than refused — it is an upsell we declined to take,
 * not an error the customer should see.
 */
export function purposeAcceptsTip(purpose: PayPurpose): boolean {
  return purpose === 'balance'
}

export type QuoteResult = { ok: true; quote: PayQuote } | { ok: false; reason: string }

/** Stripe's own floor for a card charge. Below this the link cannot be created. */
export const MIN_CHARGE_CENTS = 100

/*
 * `paidTowardTotalCents`, `remainingBalanceCents` and `depositOwedCents` used to
 * live here. They are now lib/planBalance.ts's `planMoney()`, computed once by
 * `loadPlanInvoice` and carried on the invoice as `outstandingCents` /
 * `depositOwedCents` — so the figure this file quotes and the figure the
 * document prints are the same object, not two agreeing implementations.
 *
 * A `refund` row always subtracts. Known limitation, stated rather than guessed
 * at: `booking_payments` does not record WHICH payment a refund reverses. This
 * used to read $250 high when a studio SECURITY deposit was refunded, because
 * that money had never been added to the total in the first place; needs-Adam 41
 * (ruled 2026-09-16) makes every recorded deposit a part payment, so a refund of
 * one now reverses something that was genuinely counted. The captured damage
 * hold is not a `booking_payments` row at all, so it cannot reach this path.
 */

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
 *
 * It no longer takes a `payments` array. It used to, and the array it was given
 * was read separately from the one the invoice was built from — two reads of the
 * same rows, either of which could be stale or fail on its own. Every figure now
 * comes off the invoice, which is the same object the document was rendered
 * from, so the button and the page cannot quote different money.
 */
export function quoteFor(
  invoice: PlanInvoice,
  purpose: PayPurpose,
  customCents?: number,
  rawTipCents?: unknown,
): QuoteResult {
  const remaining = invoice.outstandingCents
  const depositOwed = invoice.depositOwedCents

  let amountCents: number
  if (purpose === 'deposit') {
    // Reads `depositOwedCents`, NOT `depositCents`. On an unpriced plan the
    // latter is 0 (it is derived from the total) while the former carries the
    // flat reservation deposit — that gap is what left a real customer with a
    // date and no way to hold it. `depositOwedCents` is the figure the document
    // prints, so the button and the page still cannot quote different money.
    // `depositOwedCents` is capped by what the plan actually owes (unless the
    // deposit is separate or the plan is unpriced), so a paid-in-full plan
    // lands here rather than minting a live $257.50 Payment Link — which it
    // did, measured in production 2026-09-13. See lib/planBalance.ts.
    if (depositOwed <= 0) {
      return {
        ok: false,
        reason:
          remaining <= 0 && invoice.totalCents > 0
            ? 'This plan is paid in full.'
            : 'The deposit on this plan is already paid.',
      }
    }
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

  // The tip rides on top and is fee-bearing, because Stripe charges us on the
  // whole collection — the same arithmetic the portal's Payment Element does
  // (`subtotal = amount + tip`, then 3%), so the two surfaces quote a customer
  // the same charge for the same tip.
  const tipCents = purposeAcceptsTip(purpose) ? screenTipCents(rawTipCents) : 0
  const feeCents = calculateCardFee(amountCents + tipCents)
  const chargeCents = amountCents + tipCents + feeCents
  if (chargeCents < MIN_CHARGE_CENTS) {
    return { ok: false, reason: `Card payments start at ${money(MIN_CHARGE_CENTS)}.` }
  }

  return {
    ok: true,
    quote: { purpose, amountCents, tipCents, feeCents, chargeCents, label: labelFor(invoice, purpose) },
  }
}

/* ── Minting ───────────────────────────────────────────────────────────── */

/** Statuses on which no new money should be asked for. */
const UNPAYABLE_STATUSES = new Set(['cancelled'])

export interface PayLinkRow {
  id: string
  booking_id: string
  purpose: string
  amount_cents: number
  /** Migration 057. Nullable in the type only so a pre-057 read cannot crash. */
  tip_cents: number | null
  fee_cents: number
  stripe_payment_link_id: string | null
  url: string
  voided_at: string | null
}

export type MintResult =
  | { ok: true; payUrl: string; payLinkId: string; quote: PayQuote }
  | { ok: false; reason: string; retryable: boolean }

export const PAY_LINK_COLUMNS =
  'id, booking_id, purpose, amount_cents, tip_cents, fee_cents, stripe_payment_link_id, url, voided_at'

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
  purpose: PayPurpose
  customCents?: number
  /** Raw, unscreened. `quoteFor` clamps it and drops it on a non-tippable purpose. */
  tipCents?: unknown
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

  const quoted = quoteFor(invoice, purpose, opts.customCents, opts.tipCents)
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
    // Always written, including `0`. The webhook subtracts this from what
    // Stripe collected before crediting the plan, and an absent key there
    // reads as "no tip" — which for a link that DID carry one would credit
    // the gratuity against the balance. Cheap to write, expensive to omit.
    tip_cents: String(quote.tipCents),
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

    // The tip is its own line for the same reason the fee is: the customer
    // chose it on our page and must see it named on Stripe's, rather than
    // discovering a balance line that is larger than the balance. It sits
    // BEFORE the fee because the fee is charged on it.
    if (quote.tipCents > 0) {
      const tipProduct = await stripe.products.create({
        name: 'Gratuity for the party team',
        metadata: { booking_ref: ref, purpose },
      })
      const tipPrice = await stripe.prices.create({
        product: tipProduct.id,
        currency: 'usd',
        unit_amount: quote.tipCents,
      })
      lineItems.push({ price: tipPrice.id, quantity: 1 })
    }

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
    tip_cents: quote.tipCents,
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
    //
    // 23505 here is the ordinary outcome of two people minting at once, now that
    // migration 040's `idx_bpl_one_live_per_purpose` makes the DB the
    // serialisation point this function never had. Before that index, six
    // concurrent mints produced six simultaneously payable links and paying two
    // of them charged the same deposit twice — measured, not imagined. The
    // recovery was already correct; only the message needed to stop telling the
    // loser that something broke.
    const lostTheRace = insErr.code === '23505'
    console.error(
      `createPlanPayLink: row insert failed for ${ref}, deactivating link:`,
      lostTheRace ? `another mint won the race (23505)` : insErr.message,
    )
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
    return {
      ok: false,
      reason: lostTheRace
        ? 'A payment link for this was just created — reload the page and use that one.'
        : 'Could not record the payment link — try again.',
      retryable: true,
    }
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
      tip_cents: quote.tipCents,
      fee_cents: quote.feeCents,
      stripe_payment_link_id: stripeLinkId,
      replaced_links: voided.voided,
    },
  })

  return { ok: true, payUrl, payLinkId, quote }
}
