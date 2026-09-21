/**
 * Refunding, once.
 *
 * ── Why this file exists (link 18) ───────────────────────────────────────
 *
 * There were TWO ticket-refund implementations, near-identical and both wrong in
 * the same way:
 *
 *   /api/admin/orders/[id]/refund                       (order_type: 'ticket')
 *   /api/admin/events/[id]/tickets/[ticketId]/refund
 *
 * Hard-won rule 11, with a card number attached — and this is the fourth money
 * concept in this codebase found written out more than once, after gift-card
 * redemption (four copies), the plan balance (four branches) and "is this the
 * same person" (five callers).
 *
 * ── The defect that could spend real money twice ─────────────────────────
 *
 * Both routes did:
 *
 *   if (ticket.status === 'refunded') return 400        // the guard
 *   await stripe.refunds.create(…)                      // real money leaves
 *   await supabase.from('event_tickets').update({ status: 'refunded' … })  // UNCHECKED
 *
 * The guard depends on a write whose failure was discarded. If that UPDATE was
 * refused — or simply matched nothing — the ticket stayed `confirmed`, the guard
 * stayed open, and the next click issued **a second real Stripe refund**. Stripe
 * refuses a second FULL refund of the same charge, so the blast radius is
 * partial refunds: two $50 refunds against a $200 ticket both succeed.
 *
 * So the claim is taken FIRST, conditionally, and the Stripe call happens only
 * for the caller that won it. If Stripe then declines, the claim is released. A
 * refund is the one direction where doing nothing is recoverable and doing it
 * twice is not.
 *
 * ── And the cross-object defect ──────────────────────────────────────────
 *
 * `/api/admin/events/[id]/tickets/[ticketId]/refund` incremented inventory for
 * the event named in the URL (`params.id`) rather than the ticket's own
 * `event_id`, and never checked the two agreed. Refunding ticket B through event
 * A's URL gave event A a free seat and left event B oversold. The ticket's own
 * `event_id` is the only correct answer, and `assertTicketBelongsToEvent` makes
 * the mismatch a 404 rather than a silent inventory corruption.
 */

import { recordAdminRefund, describeLedgerOutcome, type AdminLedgerOutcome } from './adminMoney'

type MinimalClient = {
  from: (table: string) => any
  rpc: (fn: string, args: Record<string, unknown>) => any
}

export type TicketRow = {
  id: string
  event_id: string | null
  session_id: string | null
  quantity: number
  total_cents: number
  status: string
  ticket_ref: string | null
  customer_name: string | null
  customer_email: string | null
  stripe_payment_intent_id: string | null
}

/**
 * Clamp a caller-supplied refund amount.
 *
 * An admin naming an amount is by design — this is the panel — but it must not
 * exceed what was actually paid, and it must be a real number. Stripe would
 * refuse an over-refund on a Stripe-backed charge, but a ticket with no
 * PaymentIntent (a comp, a cash sale) has no Stripe backstop at all and the
 * ledger row would simply be wrong.
 */
export function cappedRefundAmount(
  requested: unknown,
  maxCents: number | null | undefined,
): { ok: true; cents: number } | { ok: false; error: string } {
  const max = typeof maxCents === 'number' && Number.isFinite(maxCents) ? maxCents : 0
  if (max <= 0) return { ok: false, error: 'This order has no recorded amount to refund.' }
  if (requested === undefined || requested === null || requested === '') return { ok: true, cents: max }
  if (!Number.isSafeInteger(requested) || (requested as number) <= 0) {
    return { ok: false, error: 'amountCents must be a positive whole number of cents' }
  }
  const cents = requested as number
  if (cents > max) {
    return { ok: false, error: `Refund of ${cents}c exceeds the ${max}c paid for this order.` }
  }
  return { ok: true, cents }
}

/** A ticket may only be refunded through its own event's URL. */
export function assertTicketBelongsToEvent(
  ticket: { event_id: string | null },
  urlEventId: string,
): boolean {
  return ticket.event_id === urlEventId
}

export type RefundOutcome =
  | { ok: true; ledger: AdminLedgerOutcome; inventoryRestored: boolean }
  | { ok: false; status: number; error: string }

/**
 * Returns the `re_…` id Stripe assigned, so the ledger row can be written under
 * the SAME reference the `charge.refunded` webhook will use. Without it the two
 * writers produce two negative rows for one refund — see
 * `stripeRefundReference` in `lib/stripeAftermath.ts`. It used to return
 * `Promise<void>`, discarding the one identifier that makes them agree.
 */
export type StripeRefunder = (paymentIntentId: string, amountCents: number) => Promise<string | null>

/**
 * The real Stripe refunder, shared by both routes so neither can drift into a
 * different API version or a different error shape. Returns `undefined` when no
 * Stripe key is configured, which `refundTicket` reads as "books-only reversal"
 * rather than silently pretending money moved.
 */
export function stripeRefunder(): StripeRefunder | undefined {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return undefined
  return async (paymentIntentId: string, amountCents: number) => {
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(key, { apiVersion: '2024-06-20' })
    const refund = await stripe.refunds.create({ payment_intent: paymentIntentId, amount: amountCents })
    return refund?.id ?? null
  }
}

/**
 * Refund one ticket: claim → Stripe → inventory → books.
 *
 * `refundViaStripe` is injected so the two routes share this logic and the tests
 * can drive every ordering without a Stripe client.
 */
export async function refundTicket(
  supabase: MinimalClient,
  opts: {
    ticket: TicketRow
    refundAmountCents: number
    reason: string | null
    eventId: string | null
    eventTitle: string
    refundViaStripe?: StripeRefunder
  },
): Promise<RefundOutcome> {
  const { ticket, refundAmountCents } = opts

  // Captured BEFORE the claim. `ticket` may be the same object the claim is
  // about to write through — reading `ticket.status` after the UPDATE to
  // restore it would put back the value the UPDATE just set. (The fake caught
  // this; in production the row is a detached JSON copy and it would have
  // worked by luck, which is not a property worth depending on.)
  const priorStatus = ticket.status

  // 1. CLAIM. Conditional on the ticket not already being refunded, and read
  //    back, so exactly one concurrent caller proceeds to spend money.
  const { data: claimed, error: claimErr } = await supabase
    .from('event_tickets')
    .update({
      status: 'refunded',
      refund_amount_cents: refundAmountCents,
      refund_reason: opts.reason,
    })
    .eq('id', ticket.id)
    .neq('status', 'refunded')
    .select('id')

  if (claimErr) {
    return { ok: false, status: 503, error: `Could not claim this refund: ${claimErr.message}. Nothing was refunded.` }
  }
  if (!claimed || claimed.length === 0) {
    return { ok: false, status: 400, error: 'Already refunded.' }
  }

  // 2. Stripe. Only the winner of the claim gets here.
  let stripeRefundId: string | null = null
  if (ticket.stripe_payment_intent_id && opts.refundViaStripe) {
    try {
      stripeRefundId = await opts.refundViaStripe(ticket.stripe_payment_intent_id, refundAmountCents)
    } catch (err: any) {
      // Release the claim, so a corrected retry is possible and the ticket does
      // not read as refunded when no money moved.
      const { error: relErr } = await supabase
        .from('event_tickets')
        .update({ status: priorStatus, refund_amount_cents: null, refund_reason: null })
        .eq('id', ticket.id)
        .select('id')
      if (relErr) {
        console.error(
          `REFUND CLAIM NOT RELEASED for ticket ${ticket.ticket_ref}: ${relErr.message} — ` +
            'the ticket reads as refunded but Stripe declined and no money moved.',
        )
      }
      return { ok: false, status: 500, error: `Stripe refund failed: ${err?.message || 'unknown error'}` }
    }
  }

  // 3. Inventory — against the TICKET's own event, never a URL parameter.
  let inventoryRestored = true
  if (ticket.session_id) {
    const { error } = await supabase.rpc('increment_session_tickets', {
      sid: ticket.session_id, qty: ticket.quantity,
    })
    if (error) { inventoryRestored = false; console.error(`refund: session inventory NOT restored for ${ticket.ticket_ref}:`, error.message) }
  } else if (ticket.event_id) {
    const { error } = await supabase.rpc('increment_event_tickets', {
      eid: ticket.event_id, qty: ticket.quantity,
    })
    if (error) { inventoryRestored = false; console.error(`refund: event inventory NOT restored for ${ticket.ticket_ref}:`, error.message) }
  } else {
    inventoryRestored = false
    console.error(`refund: ticket ${ticket.ticket_ref} names neither a session nor an event — inventory NOT restored.`)
  }

  // 4. The books.
  const ledger = await recordAdminRefund(supabase, {
    kind: 'ticket',
    objectId: ticket.id,
    amountCents: refundAmountCents,
    refundedAt: new Date().toISOString(),
    label: `${opts.eventTitle} (${ticket.ticket_ref || ticket.id})`,
    customerName: ticket.customer_name,
    category: 'Event Ticket',
    notes: opts.reason,
    viaStripe: Boolean(ticket.stripe_payment_intent_id && opts.refundViaStripe),
    // Makes this row and the `charge.refunded` webhook's row the same row.
    stripeRefundId,
  })

  return { ok: true, ledger, inventoryRestored }
}

export { describeLedgerOutcome }
