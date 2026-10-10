/**
 * The state of an invitation, derived at read time (spec §4).
 *
 *   inviteState(booking, payments, evite, now, flags)
 *     -> 'disabled' | 'unavailable' | 'closed' | 'live' | 'needs_time' | 'preview'
 *
 * Nothing is stored and no money writer is touched. Evaluated in the spec's
 * order, first hit wins:
 *
 *   disabled     pages flag `off`, or `pilot` and this is not a pilot booking
 *   unavailable  `archived_at`, or status cancelled / lost
 *   closed       booked, window known, `now > endUtc`
 *   live         booked, window known
 *   needs_time   booked, window unknown
 *   preview      anything else
 *
 * "BOOKED" COMES ONLY FROM `bookingStage()` (lib/bookingStatus.ts), fed the net
 * of `sumPayments()` over the rows the caller read. The two rules that follow
 * from that are pinned by tests, not re-derived here:
 *   - a legacy status (`deposit_paid`, `confirmed`, `paid_in_full`...) is booked
 *     whatever the money says, so a Stripe refund (which writes a negative LEDGER
 *     row and never touches `booking_payments`) leaves a `deposit_paid` party
 *     live until it is cancelled;
 *   - an admin-recorded refund that brings the net to 0 on a non-legacy status
 *     (`awaiting_deposit`, `pending_review`) leaves the booked stage: `preview`.
 *
 * Pure. Env reads belong to the caller (`flags`), and so does a payments READ
 * ERROR: it throws to the page's error boundary and never reaches this function
 * as an empty array, which would be mis-stated as `preview`.
 *
 * One reading the spec table does not spell out: a booked party whose DATE has
 * already passed (bookingStage 'completed') but whose time never parsed has no
 * window, so `closed` (which needs one) cannot fire and it would read
 * `needs_time` - "Time coming soon" on a party that happened last month. It is
 * `closed`.
 */

import { bookingStage } from '@/lib/bookingStatus'
import { sumPayments } from '@/lib/bookingBalance'
import { etDateString } from '@/lib/partyTime'
import { partyWindow, type PartyWindowInput } from '@/lib/evites/partyWindow'
import type { EviteMode } from '@/lib/evites/config'
import type { EvitePaymentRow } from '@/lib/evites/types'

export type InviteState = 'disabled' | 'unavailable' | 'closed' | 'live' | 'needs_time' | 'preview'

export interface InviteStateFlags {
  /** `evitePagesMode()`. */
  pagesMode: EviteMode
  /** `isPilotBooking(booking.booking_ref)`. Only read when `pagesMode === 'pilot'`. */
  isPilot: boolean
}

export interface InviteStateBooking extends PartyWindowInput {
  status?: string | null
}

export function inviteState(
  booking: InviteStateBooking,
  payments: readonly EvitePaymentRow[],
  evite: { archived_at?: string | null },
  now: Date,
  flags: InviteStateFlags,
): InviteState {
  if (flags.pagesMode === 'off') return 'disabled'
  if (flags.pagesMode === 'pilot' && !flags.isPilot) return 'disabled'

  if (evite.archived_at) return 'unavailable'
  if (booking.status === 'cancelled' || booking.status === 'lost') return 'unavailable'

  const stage = bookingStage({
    status: booking.status,
    paidCents: sumPayments([...payments]),
    partyDate: booking.party_date ?? null,
    today: etDateString(now),
  })
  if (stage === 'cancelled' || stage === 'lost') return 'unavailable'

  const booked = stage === 'booked' || stage === 'completed'
  if (!booked) return 'preview'

  const win = partyWindow(booking)
  if (!win) return stage === 'completed' ? 'closed' : 'needs_time'
  return now.getTime() > win.endUtc.getTime() ? 'closed' : 'live'
}
