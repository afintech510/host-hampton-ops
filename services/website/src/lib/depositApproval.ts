/**
 * A deposit that lands approves the booking — Adam, 2026-10-12.
 *
 * Until now a card deposit left a booking at `pending_review` (the in-page paths)
 * or `deposit_paid` (the Payment Link path), and a human pressed "Approve
 * Booking" in the Parties tab to move it to `approved`. That button is the only
 * thing that ever wrote `approved`, so two things hung off a person remembering
 * to press it: the T-14 lock (`/api/cron/booking-locks` moves `approved` and only
 * `approved` to `modifications_locked`, so an unapproved booking never locked),
 * and the Parties tab's own filter. The ruling is that taking the deposit IS the
 * approval.
 *
 * ── What this does, and deliberately does not ──────────────────────────────
 *
 * It writes the SAME three columns the admin button writes — `status`,
 * `approved_at`, `approved_by` — with an actor that says a machine did it
 * (`system:deposit`), so a reader of the Parties tab can tell a human approval
 * from an automatic one.
 *
 * It does NOT send "Your Party is Confirmed!". The customer has just been sent a
 * receipt by the same webhook ("Deposit Received" / "Payment received") and a
 * second email within the same minute saying the same thing is noise. The
 * calendar event is the other side effect of the button; the card paths already
 * create it on the first deposit, and the Payment Link path now does too
 * (`lib/planPayment.ts`).
 *
 * `paid_in_full` always wins over `approved`: a deposit that settles the whole
 * balance leaves the booking `paid_in_full`, exactly as before.
 *
 * A function that returns fields rather than one that writes them, so each
 * payment path keeps its single UPDATE — splitting it would put a window between
 * the balance and the status in which the booking reads wrongly.
 */

/** Written to `bookings.approved_by` when the deposit, not a person, approved it. */
export const DEPOSIT_APPROVER = 'system:deposit'

export function depositApprovalFields(now: Date = new Date()): {
  status: 'approved'
  approved_at: string
  approved_by: string
} {
  return { status: 'approved', approved_at: now.toISOString(), approved_by: DEPOSIT_APPROVER }
}
