/**
 * The four things every non-plan branch of `/api/webhook` got wrong, in one place.
 *
 * Link 16 audited the legacy `checkout.session.completed` branches — event
 * tickets, the multi-session bundle, the cart, gift cards, the vendor
 * registration and the party-booking tail. All of them have really run (77 ticket
 * payments, 11 carts, 10 bundles, 2 vendors, 1 gift card), and none of them had:
 *
 *  1. a settlement gate — `checkout.session.completed` does NOT mean paid. The
 *     handler's own comment said so and only the plan branch acted on it, while
 *     Klarna, Cash App Pay and Amazon Pay are enabled on ~two thirds of our
 *     sessions and are exactly the methods that complete `unpaid`;
 *  2. a claim — Stripe redelivers, and nothing stopped a second delivery issuing
 *     a second ticket, a second gift card code, a second inventory decrement and
 *     a second "You're in!" email;
 *  3. a ticket ref that cannot collide — `HH-EVT-${Date.now().slice(-4)}` against
 *     a UNIQUE column repeats every ten seconds, and the sequence the rest of the
 *     codebase already calls (`nextval_event_ticket_seq`) had never been created;
 *  4. an answer it could act on from the gift-card and inventory writes — both
 *     were read-modify-write with the error discarded.
 *
 * Everything here returns THREE outcomes, not two, because "the database was
 * unreachable" is not "no" (hard-won rule 12) and a 200 to Stripe over a failed
 * write means no redelivery ever comes (rule 19).
 */

import type Stripe from 'stripe'
import type { getSupabase } from '@/lib/supabase'

type Supa = ReturnType<typeof getSupabase>

/**
 * Every `metadata.type` the handler knows how to deal with, in ONE list.
 *
 * The handler used to key on `m.type` with a chain of `if`s and then decide
 * "nothing claimed this" from a DIFFERENT question — whether the legacy booking
 * tail happened to have a `contactEmail` to work with. So a session naming a type
 * nobody handles, but carrying a customer email, fell THROUGH the net into the
 * legacy tail and silently became a phantom `deposit_paid` kids-party booking
 * with a "You're booked! 🎉" email attached.
 *
 * That is hard-won rule 14 and it is not hypothetical here: a real $250 payment
 * on 2026-07-22 carried `type: "invoice_deposit"`, a value nothing in this
 * codebase writes, and it was recorded in no table at all — the second lost
 * payment on this surface, two months before the $927 one that got a net built
 * for it.
 */
export const HANDLED_SESSION_TYPES = [
  'plan_pay_link',
  'event_ticket',
  'event_ticket_multi',
  'cart_checkout',
  'vendor_registration',
  'party_builder',
  'pay_link',
  'gift_card',
] as const

export type HandledSessionType = (typeof HANDLED_SESSION_TYPES)[number]

/**
 * And the types that arrive on a PaymentIntent instead of a Checkout Session —
 * the in-page Payment Element flow, which is every party-planner payment and
 * every studio-rental deposit.
 *
 * They are listed separately rather than merged because the two events carry
 * different objects and different branches, and a session that turned up naming
 * `studio_rental` would NOT be handled — it belongs in the net.
 */
export const HANDLED_PAYMENT_INTENT_TYPES = ['party_builder', 'studio_rental'] as const

/** Does the handler have a branch for this session's `metadata.type`? */
export function isHandledSessionType(type: string | null | undefined): type is HandledSessionType {
  return !!type && (HANDLED_SESSION_TYPES as readonly string[]).includes(type)
}

/** Every `metadata.type` this app writes into Stripe, whichever object carries it. */
export const ALL_HANDLED_STRIPE_TYPES: readonly string[] = [
  ...HANDLED_SESSION_TYPES,
  ...HANDLED_PAYMENT_INTENT_TYPES,
]

/**
 * The LEGACY tail (a booking insert built from bare metadata) is reachable only
 * for a session that names no type at all. A session naming an UNKNOWN type is
 * not a legacy party booking — it is a payment nobody wrote a branch for, and it
 * belongs in the unclaimed net where a human sees it.
 */
export function isLegacyBookingSession(metadata: Stripe.Metadata | null | undefined): boolean {
  const t = (metadata ?? {}).type
  return !t
}

// ── 1. Settlement ───────────────────────────────────────────────────────────

export type Settlement =
  | { settled: true; reason: 'paid' | 'no_payment_required' }
  | { settled: false; reason: string }

/**
 * Is the money actually there?
 *
 * `checkout.session.completed` fires as soon as the customer finishes the
 * Checkout page. For a delayed-notification method it arrives with
 * `payment_status: 'unpaid'` and the payment can still fail — which is why
 * `checkout.session.async_payment_succeeded` exists. Issuing a ticket or a gift
 * card on an unsettled session hands over goods for money that may never arrive,
 * and nothing in this handler reverses it.
 */
export function sessionSettlement(session: Pick<Stripe.Checkout.Session, 'payment_status' | 'amount_total'>): Settlement {
  const ps = session.payment_status
  if (ps === 'paid') return { settled: true, reason: 'paid' }
  if (ps === 'no_payment_required') return { settled: true, reason: 'no_payment_required' }
  return { settled: false, reason: `payment_status=${String(ps)}` }
}

// ── 2. The claim ────────────────────────────────────────────────────────────

export type Claim =
  | { outcome: 'fresh' }
  | { outcome: 'already'; rows: number }
  | { outcome: 'unavailable'; message: string }

/**
 * Has this Checkout Session already been turned into rows?
 *
 * The unique indexes from migration 046 stop a concurrent double-insert; this
 * stops the SIDE EFFECTS — the second confirmation email, the second inventory
 * decrement, the second contact upsert (which mirrors into Brevo and Quo and
 * enrols a sequence), the second financial row under a freshly generated
 * reference the unique index therefore cannot catch.
 *
 * An unreadable table is NOT "fresh": proceeding would risk the double-issue
 * this exists to prevent, so the caller must 500 and let Stripe come back.
 */
export async function claimBySessionId(
  supabase: Supa,
  table: 'event_tickets' | 'gift_cards' | 'bookings',
  sessionId: string | null | undefined,
): Promise<Claim> {
  if (!sessionId) return { outcome: 'fresh' }
  const { data, error } = await supabase
    .from(table)
    .select('id')
    .eq('stripe_session_id', sessionId)
    .limit(1)
  if (error) return { outcome: 'unavailable', message: error.message }
  if (data && data.length > 0) return { outcome: 'already', rows: data.length }
  return { outcome: 'fresh' }
}

// ── 3. Ticket references ────────────────────────────────────────────────────

export type TicketRef = { ok: true; ref: string } | { ok: false; message: string }

/**
 * A ticket reference that cannot collide with another customer's.
 *
 * `HH-EVT-${Date.now().toString().slice(-4)}` is a 10-second-wide space against
 * `event_tickets_ticket_ref_key`. Two purchases landing on the same
 * millisecond-mod-10000 make the second insert fail — and the old code sent the
 * confirmation email anyway, so the loser was told "You're in!" for a ticket that
 * does not exist.
 *
 * Migration 046 sets `event_ticket_seq` to 10000, so every ref from here on is
 * five digits and the legacy four-digit space (max 9932) can never be hit again.
 * The suffix keeps one cart/bundle's rows distinguishable at a glance.
 */
export async function nextTicketRef(supabase: Supa, suffix?: string | null): Promise<TicketRef> {
  const { data, error } = await supabase.rpc('nextval_event_ticket_seq')
  if (error) return { ok: false, message: error.message }
  const n = typeof data === 'number' ? data : parseInt(String(data ?? ''), 10)
  if (!Number.isFinite(n)) return { ok: false, message: `sequence returned ${JSON.stringify(data)}` }
  const tail = suffix ? `-${String(suffix).slice(0, 4)}` : ''
  return { ok: true, ref: `HH-EVT-${n}${tail}` }
}

// ── 4. Inventory ────────────────────────────────────────────────────────────

export type Decrement =
  | { outcome: 'decremented'; remaining: number }
  | { outcome: 'oversold' }
  | { outcome: 'unavailable'; message: string }

/**
 * Take the tickets out of stock, and say when it could not.
 *
 * The SQL has always been `WHERE available_tickets >= qty`, so an oversold event
 * silently matched zero rows while the money was already taken and the ticket
 * already issued. Migration 046 makes both functions return the new count (NULL
 * when they declined) so the caller can say so out loud (rule 10).
 */
export async function decrementInventory(
  supabase: Supa,
  scope: 'session' | 'event',
  id: string,
  qty: number,
): Promise<Decrement> {
  const { data, error } =
    scope === 'session'
      ? await supabase.rpc('decrement_session_tickets', { sid: id, qty })
      : await supabase.rpc('decrement_event_tickets', { eid: id, qty })
  if (error) return { outcome: 'unavailable', message: error.message }
  if (data === null || data === undefined) return { outcome: 'oversold' }
  return { outcome: 'decremented', remaining: Number(data) }
}

// ── 5. Gift cards ───────────────────────────────────────────────────────────

export type Redemption =
  | { outcome: 'redeemed'; redeemedCents: number; newBalanceCents: number; status: string }
  | { outcome: 'no_active_card' }
  | { outcome: 'unavailable'; message: string }

/**
 * Spend against a gift card, once.
 *
 * This was read-then-write in TWO places (rule 11), with the read error and the
 * write error both discarded (rule 19): a Supabase blip meant the discount was
 * given and the balance never deducted, and two concurrent redemptions both read
 * the same balance and both "succeeded". It also wrote
 * `redeemed_at: newBal === 0 ? now : null`, which CLEARS the timestamp on a card
 * that had already been fully redeemed.
 *
 * `redeem_gift_card` (migration 046) does the whole thing in one statement under
 * `FOR UPDATE`, clamps the deduction to the balance, and never clears
 * `redeemed_at`.
 */
export async function redeemGiftCard(supabase: Supa, code: string, deductCents: number): Promise<Redemption> {
  const { data, error } = await supabase.rpc('redeem_gift_card', { p_code: code, p_deduct: deductCents })
  if (error) return { outcome: 'unavailable', message: error.message }
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { outcome: 'no_active_card' }
  return {
    outcome: 'redeemed',
    redeemedCents: Number(row.redeemed_cents ?? 0),
    newBalanceCents: Number(row.new_balance_cents ?? 0),
    status: String(row.card_status ?? 'active'),
  }
}

// ── 6. Metadata that arrived as a string ────────────────────────────────────

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }

/**
 * `JSON.parse(m.cartItems)` and `JSON.parse(m.sessionIds)` were bare.
 *
 * A malformed value throws out of the handler, which Stripe sees as a 500 and
 * retries until it gives up — the failure mode that lost $927. And Stripe caps a
 * metadata VALUE at 500 characters (measured against the live API: 500 accepted,
 * 600 refused with an explicit error), so these strings can also arrive truncated
 * if a writer ever stops checking. Parse defensively and say which field failed.
 */
export function parseJsonMetadata<T>(raw: string | undefined | null, field: string): Parsed<T> {
  if (!raw) return { ok: true, value: [] as unknown as T }
  try {
    return { ok: true, value: JSON.parse(raw) as T }
  } catch (err) {
    return { ok: false, message: `metadata.${field} is not valid JSON (${raw.length} chars): ${err instanceof Error ? err.message : 'parse failed'}` }
  }
}

/**
 * Stripe's hard limit on a single metadata value. Measured against the live API
 * rather than taken from the docs: a 500-character value is accepted and a
 * 600-character one is refused with
 * "Metadata values can have up to 500 characters".
 *
 * It matters because `/api/cart-checkout` advertises a 10-item cart and packs
 * every item into `metadata.cartItems` as JSON. Real carts have already reached
 * 303 characters at THREE items, so a six-item cart exceeds the limit and
 * `checkout.sessions.create` throws — with no try/catch around it, that is an
 * unhandled 500 on the checkout button.
 */
export const STRIPE_METADATA_VALUE_LIMIT = 500

// ── 7. Who does the side effects ────────────────────────────────────────────

/**
 * The outcome of writing the financial row, which doubles as this handler's
 * idempotency marker.
 *
 * The in-page Payment Element branches have TWO writers: the browser coming back
 * (`/api/party-builder/confirm-session`, `/api/studio-rental/confirm-session`)
 * and this webhook. Both insert into `booking_payments`, so "my insert was a
 * duplicate" cannot mean "the side effects are done" — the browser does none of
 * them, and both confirm routes carry a comment saying so.
 *
 * So the marker is the `financial_transactions` row instead: only the webhook
 * writes it, `(source, reference)` is unique, and it is a row Adam can see. A
 * fresh insert means "nobody has sent the receipt, blocked the calendar or
 * enqueued the reminders for this Stripe object" — which is the question the
 * emails actually need answered.
 */
export type FinancialWrite = 'written' | 'duplicate' | 'failed'
