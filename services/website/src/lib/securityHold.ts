/**
 * The refundable $250 damage hold on a studio rental — when to offer it, and
 * what it is NOT.
 *
 * ── What this money is ─────────────────────────────────────────────────────
 *
 * A card AUTHORIZATION, not a charge. Stripe places it with
 * `capture_method: 'manual'`, the customer sees a pending $250 that never
 * settles, and it falls off by itself when the authorization expires (Adam's
 * call, 2026-09-23: no release code, no admin capture button — let Stripe
 * expire it).
 *
 * **It is therefore never a payment.** It is not a `booking_payments` row, it
 * is not a `financial_transactions` row, and it must never reduce
 * `balance_due_cents`. needs-Adam 41 drew that line for the RESERVATION deposit
 * — that one is a real payment and comes off the total — and this is the other
 * side of the same ruling: the hold sits outside the invoice entirely. Booking
 * it as revenue would tell a customer who owes $350 that she owes $100.
 *
 * The webhook branch that records it therefore writes only
 * `security_deposit_pi_id` + `security_deposit_status`, and returns before the
 * settlement check rather than falling through to any revenue path.
 *
 * ── Why a manual-capture auth is "unsettled", and why that is correct ──────
 *
 * `checkout.session.completed` for a manual-capture session arrives with
 * `payment_status: 'unpaid'` and the PaymentIntent in `requires_capture`. So
 * `sessionSettlement()` answers `settled: false` — which is the RIGHT answer to
 * the question it asks ("is the money actually there?") and the wrong place to
 * stop for this branch. Hence the ordering requirement above: the hold is
 * recognised before settlement is consulted, because for a hold "not settled"
 * is the success case.
 *
 * ── The window ─────────────────────────────────────────────────────────────
 *
 * Adam: *"a separate link that activates within 5 days of the rental date …
 * they can also do this in person on the day of."* So the link appears 5 days
 * before and stays up through the rental day itself.
 *
 * Every comparison here is on an Eastern CALENDAR DAY string via
 * `etDateString`/`shiftEtDate`, never on a UTC instant. The box runs UTC, and
 * `new Date().toISOString().slice(0,10)` rolls to tomorrow at 8pm Eastern —
 * which is how every reminder came to be scheduled 4–5 hours early. A window
 * computed that way would open the link a day before Adam asked for it and
 * close it while the customer is still standing in the studio.
 */

import { etDateString, shiftEtDate } from '@/lib/partyTime'
import { hasSecurityHold } from '@/lib/planBalance'

/** How many days before the rental the link becomes live. Adam, 2026-09-23. */
export const SECURITY_HOLD_WINDOW_DAYS = 5

/** `security_deposit_status` once the customer has authorized online. */
export const HOLD_AUTHORIZED = 'authorized'

/** The `metadata.type` this app stamps on the Checkout Session. */
export const HOLD_SESSION_TYPE = 'security_hold'

export type HoldOffer =
  /** Show the button. */
  | { state: 'offer'; amountCents: number; opensOn: string }
  /** Show the date it opens, so the document explains itself rather than hiding. */
  | { state: 'too_early'; amountCents: number; opensOn: string }
  /** Already authorized — say so, and stop asking. */
  | { state: 'done' }
  /** Not a studio rental, undated, cancelled, or the rental is behind us. */
  | { state: 'not_applicable' }

export interface HoldInput {
  partyType: string | null | undefined
  /** `bookings.party_date`, a YYYY-MM-DD calendar day. */
  partyDate: string | null | undefined
  status: string | null | undefined
  securityDepositStatus: string | null | undefined
  /** From the catalog (`studio_security_hold`), never hard-coded at the call site. */
  amountCents: number | null | undefined
}

/**
 * Should this plan offer the hold right now?
 *
 * Pure, and takes `today` so the window is testable without mocking the clock.
 * `today` is an Eastern calendar day string — callers pass `etDateString()`.
 */
export function securityHoldOffer(input: HoldInput, today: string = etDateString()): HoldOffer {
  const { partyType, partyDate, status, securityDepositStatus, amountCents } = input

  if (!hasSecurityHold(partyType)) return { state: 'not_applicable' }
  // A cancelled rental must not ask for a card. Same rule the pay buttons keep.
  if (status === 'cancelled') return { state: 'not_applicable' }
  if (!amountCents || amountCents <= 0) return { state: 'not_applicable' }

  // Already held. Checked BEFORE the date window, so a customer who authorized
  // early is told it is done rather than being asked again on the day.
  if (securityDepositStatus === HOLD_AUTHORIZED) return { state: 'done' }

  // No date means no window to compute. Silent rather than guessing — an
  // unscheduled rental has nothing to count back from.
  if (!partyDate) return { state: 'not_applicable' }

  const opensOn = shiftEtDate(partyDate, -SECURITY_HOLD_WINDOW_DAYS)
  if (!opensOn) return { state: 'not_applicable' }

  // Past the rental day: nothing left to protect, and a link that charges a card
  // for an event that has happened is the wrong thing to leave lying around.
  // String comparison is safe and intended — both sides are YYYY-MM-DD.
  if (today > partyDate) return { state: 'not_applicable' }

  if (today < opensOn) return { state: 'too_early', amountCents, opensOn }
  return { state: 'offer', amountCents, opensOn }
}

/** "September 22, 2026" from a YYYY-MM-DD, for the too-early sentence. */
export function formatHoldDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return dateStr
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}
