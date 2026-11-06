import { logBookingChange } from '@/lib/bookingAudit'

/**
 * Sending a client a booking link APPROVES the party - Adam, 2026-11-05.
 *
 * "Approved" is the gate between a REQUEST and a booking: a request that comes in
 * online is not a promise of a date, and the client must not be able to book it
 * online before someone has checked the studio is free. A person who sends the
 * client their planner, invoice or booking-portal link has, by sending it, done that
 * check and invited them to go ahead - so the send itself moves the party to
 * `approved`.
 *
 * What it writes is what the Approve button and a landed deposit write
 * (`status`, `approved_at`, `approved_by`; compare `lib/depositApproval.ts`), with
 * the SENDER's name, so the Parties tab can tell who did it. What it deliberately
 * does NOT do is send "Your Party is Confirmed!": the client has just been sent
 * the link itself, and a second email saying the same thing is noise.
 *
 * Only a party that is still waiting is moved. A cancelled or lost party is never
 * revived by a send, and an approved or later party is left exactly as it is. The
 * update is conditional on the status it read, so a status that changed in the
 * meantime is not overwritten. It runs AFTER the send succeeded (a send that
 * failed approves nothing), and a failure here never undoes or hides the send - it
 * is reported back so the screen can say so.
 */

/** Statuses that are still "waiting for a person to check the date". */
export const APPROVABLE_ON_LINK_SEND = ['lead', 'quoted', 'pending_review', 'awaiting_deposit', 'deposit_paid'] as const

/** The link kinds that let a client go ahead and book. An invitation or photos do not. */
export const BOOKING_LINK_KINDS = ['planner', 'invoice', 'portal'] as const

/**
 * Would a send approve this party? `kinds` is the `send_client_links` selection;
 * omit it for the portal-link actions, which are booking links by definition.
 */
export function linkSendApproves(status: unknown, kinds?: readonly string[]): boolean {
  if (typeof status !== 'string' || !(APPROVABLE_ON_LINK_SEND as readonly string[]).includes(status)) return false
  if (!kinds) return true
  return kinds.some(k => (BOOKING_LINK_KINDS as readonly string[]).includes(k))
}

type MinimalClient = { from: (table: string) => any }

export type LinkApprovalOutcome = 'approved' | 'skipped' | 'failed'

export async function approveOnLinkSend(
  supabase: MinimalClient,
  opts: { bookingId: string; status: string; actor: string; via: string; now?: Date },
): Promise<LinkApprovalOutcome> {
  const at = (opts.now ?? new Date()).toISOString()
  const { data, error } = await supabase
    .from('bookings')
    .update({ status: 'approved', approved_at: at, approved_by: opts.actor, updated_at: at })
    .eq('id', opts.bookingId)
    // Conditional on the status we read: a party that moved meanwhile is left alone.
    .eq('status', opts.status)
    .select('id')
  if (error) {
    console.error(`linkApproval: could not approve ${opts.bookingId} after a link send: ${error.message}`)
    return 'failed'
  }
  if (!Array.isArray(data) || data.length === 0) return 'skipped'

  await logBookingChange(supabase, {
    bookingId: opts.bookingId,
    actor: opts.actor,
    summary: `Approved automatically: booking links were sent to the client (${opts.via}). No confirmation email.`,
    oldData: { status: opts.status },
    newData: { status: 'approved' },
  })
  return 'approved'
}
