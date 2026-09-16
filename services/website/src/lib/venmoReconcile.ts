/**
 * The Venmo half of "no payment is invisible" — the I/O around `venmoReceipt`.
 *
 * `lib/venmoReceipt.ts` decides what a receipt says and which event it looks
 * like. This module is what the agent calls while it is reading the mailbox:
 * it writes the proposal row, and it tells Adam the first time it sees one.
 *
 * Three things it deliberately does NOT do:
 *
 *  1. **It never issues a ticket.** See the comment at the top of
 *     `venmoReceipt.ts` — a Venmo note can be retracted in the payment's own
 *     comment thread minutes later, and it was, for real, in September.
 *  2. **It never fails the poll.** gmail-sync's contract is that a message is
 *     either ingested or left for the next run; a reconciliation problem must
 *     not be what strands the mailbox. Every error here is logged and swallowed.
 *  3. **It does not decide what is "an event payment".** A parsed receipt is
 *     recorded whatever it is — a party deposit, a tip, a $10 bin of slime —
 *     because the alternative is a filter that silently drops the one we needed.
 *     `status='ignored'` is a human saying so, and it is one click.
 */

import { Resend } from 'resend'
import { getSupabase } from '@/lib/supabase'
import { ownerEmail } from '@/lib/ownerNotify'
import { escapeHtml } from '@/lib/escapeHtml'
import { money } from '@/lib/planInvoice'
import { isUniqueViolation } from '@/lib/planPayment'
import {
  isVenmoSender,
  matchEvent,
  parseVenmoReceipt,
  type EventMatch,
  type MatchableEvent,
  type VenmoReceipt,
} from '@/lib/venmoReceipt'

type Supa = ReturnType<typeof getSupabase>

export type VenmoRecordResult =
  | { outcome: 'recorded'; id: string; match: EventMatch }
  | { outcome: 'duplicate' }
  | { outcome: 'not_a_receipt' }
  | { outcome: 'failed'; error: string }

/** One proposal row, as the queue and the writer read it. */
export interface VenmoPaymentRow {
  id: string
  gmail_message_id: string
  transaction_id: string | null
  paid_at: string
  payer_name: string
  amount_cents: number
  note: string
  subject: string | null
  status: 'pending' | 'recorded' | 'ignored'
  suggested_event_id: string | null
  match_confidence: 'title' | 'amount' | 'none'
  suggested_seats: import('@/lib/venmoReceipt').SeatLine[] | null
  match_reason: string | null
  resolved_at: string | null
  resolved_by: string | null
  resolution_note: string | null
  ticket_refs: string[] | null
  created_at: string
}

/** The columns the admin queue and the writer both need. */
export const VENMO_PAYMENT_COLUMNS =
  'id, gmail_message_id, transaction_id, paid_at, payer_name, amount_cents, note, subject, ' +
  'status, suggested_event_id, match_confidence, suggested_seats, match_reason, ' +
  'resolved_at, resolved_by, resolution_note, ticket_refs, created_at'

/**
 * Events a receipt could plausibly be for.
 *
 * Bounded to what has not happened yet plus a week of slack: people pay for
 * Friday's party on Thursday, and occasionally the morning after. An unbounded
 * read would match this month's $45 against a $45 event from March.
 */
export async function matchableEvents(supabase: Supa, today = new Date()): Promise<MatchableEvent[]> {
  const from = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('events')
    .select('id, title, event_date, price_cents, sibling_price_cents, variants')
    .eq('is_active', true)
    .gte('event_date', from)
    .order('event_date', { ascending: true })
  if (error) {
    // Rule 12: "could not read the events" is not "there are no events". Say so
    // and let the proposal land unmatched rather than claiming `none`.
    console.error('venmo reconcile: events read failed —', error.message)
    return []
  }
  return (data ?? []) as MatchableEvent[]
}

/**
 * Record one Venmo notification as a proposed payment.
 *
 * Keyed on the Gmail message id, so re-reading the message — which gmail-sync
 * does whenever a batch fails and the checkpoint stays put — is a no-op.
 */
export async function recordVenmoReceipt(input: {
  supabase: Supa
  gmailMessageId: string
  fromEmail: string | null
  subject: string | null
  body: string | null
  sentAt: string | null
  events?: MatchableEvent[]
}): Promise<VenmoRecordResult> {
  const { supabase, gmailMessageId, fromEmail, subject, body, sentAt } = input
  if (!isVenmoSender(fromEmail)) return { outcome: 'not_a_receipt' }

  const receipt = parseVenmoReceipt(subject, body)
  if (!receipt) return { outcome: 'not_a_receipt' }

  const events = input.events ?? (await matchableEvents(supabase))
  const match = matchEvent(receipt, events)

  const { data, error } = await supabase
    .from('venmo_payments')
    .insert({
      gmail_message_id: gmailMessageId,
      transaction_id: receipt.transactionId,
      // The RECEIPT's date, not the moment we read it. A backfill or a stalled
      // poll would otherwise stamp a week of payments with today and the books
      // would be dated wrong on every one.
      paid_at: sentAt || new Date().toISOString(),
      payer_name: receipt.payerName,
      amount_cents: receipt.amountCents,
      note: receipt.note,
      subject: subject || null,
      suggested_event_id: match.eventId,
      match_confidence: match.confidence,
      suggested_seats: match.seats,
      match_reason: match.reason,
    })
    .select('id')
    .single()

  if (error) {
    if (isUniqueViolation(error)) return { outcome: 'duplicate' }
    console.error(`venmo reconcile: could not record ${gmailMessageId}:`, error.message)
    return { outcome: 'failed', error: error.message }
  }

  console.log(
    `VENMO RECEIPT: ${money(receipt.amountCents)} from ${receipt.payerName}` +
      `${receipt.note ? ` — "${receipt.note}"` : ' (no note)'} → ${match.confidence} (${match.reason})`,
  )

  // Only the ones that look like a ticket are worth an email. A tip, a pizza
  // split and Adam paying himself back are all real rows in this table, and an
  // email for each is how a notification becomes wallpaper.
  if (match.eventId) await notifyOwner(receipt, match).catch(() => {})

  return { outcome: 'recorded', id: String(data.id), match }
}

async function notifyOwner(receipt: VenmoReceipt, match: EventMatch): Promise<void> {
  if (!process.env.RESEND_API_KEY) return
  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
  const seats = match.seats
    ? match.seats.map(s => `${s.quantity} × ${escapeHtml(s.variantLabel || 'ticket')} @ ${money(s.unitPriceCents)}`).join('<br>')
    : '<em>the amount does not divide into seats — needs a look</em>'

  try {
    await resend.emails.send({
      from,
      to: ownerEmail(),
      subject: `Venmo: ${money(receipt.amountCents)} from ${receipt.payerName} — looks like ${match.title}`,
      html:
        `<p style="font-family:sans-serif;font-size:15px">` +
        `<strong>${money(receipt.amountCents)}</strong> arrived on Venmo from <strong>${escapeHtml(receipt.payerName)}</strong>.<br><br>` +
        `Note: ${receipt.note ? `"${escapeHtml(receipt.note)}"` : '<em>none</em>'}<br>` +
        `Looks like: <strong>${escapeHtml(match.title || '—')}</strong> (${escapeHtml(match.reason)})<br>` +
        `Seats: ${seats}<br><br>` +
        `<strong>Nothing has been booked.</strong> Venmo money is not a ticket until someone says it is — ` +
        `one customer paid and cancelled in the payment comments two minutes later. ` +
        `Accept or dismiss it in the admin, and the roster, the books and the ticket count all move together.` +
        `</p>`,
    })
  } catch (err) {
    console.error('venmo reconcile owner notify (non-fatal):', err instanceof Error ? err.message : err)
  }
}
