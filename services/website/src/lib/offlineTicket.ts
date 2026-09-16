/**
 * Issuing a ticket for money that did not come through Stripe.
 *
 * Until this file existed there was no way to do it. `/api/webhook` and the
 * cart checkout were the only writers of `event_tickets`, both keyed on a
 * Stripe session — so a customer who handed over cash or sent a Venmo could be
 * put on the roster only by someone typing INSERT, which in practice meant they
 * were not put on the roster at all.
 *
 * ── The four things, or none of them ────────────────────────────────────────
 *
 * A manual ticket writer that does part of the job is worse than not having
 * one, because the halves it skips are the ones nobody checks:
 *
 *   1. the `event_tickets` row      — the roster Allie reads at the door
 *   2. the `financial_transactions` row — the books
 *   3. `available_tickets`          — or the event oversells
 *   4. the confirmation email       — or the customer has no reference
 *
 * Every one of those has been the missing half of a real incident in this
 * codebase. So this function does all four, reports on each of them
 * individually (rule 10 — a step that did not happen says so), and orders them
 * so that the failure modes are survivable: tickets first (the thing the
 * customer paid for), then money, then inventory, then the email last, because
 * an email is the one step that cannot be undone.
 */

import { Resend } from 'resend'
import { getSupabase } from '@/lib/supabase'
import { decrementInventory, nextTicketRef } from '@/lib/stripeSettlement'
import { recordLedgerEntry } from '@/lib/financialLedger'
import { ticketConfirmationHtml } from '@/lib/emailTemplates'
import { money } from '@/lib/planInvoice'
import type { SeatLine } from '@/lib/venmoReceipt'

type Supa = ReturnType<typeof getSupabase>

/** How the money actually arrived. */
export type OfflineMethod = 'venmo' | 'zelle' | 'cash' | 'card' | 'other'

/**
 * `financial_transactions.source` is a CHECK, not a free-text field:
 * stripe | godaddy | squarespace | honeybook | cash | other. Hand-entered money
 * is `cash` — that is what `/api/admin/financials` has always written — and the
 * real method is spelled out in the description and notes so the books do not
 * quietly claim someone paid in dollar bills.
 */
function ledgerSource(method: OfflineMethod): 'cash' | 'other' {
  return method === 'card' || method === 'other' ? 'other' : 'cash'
}

export interface OfflineTicketInput {
  eventId: string
  customerName: string
  customerEmail: string
  customerPhone?: string | null
  seats: SeatLine[]
  method: OfflineMethod
  /** The date the money arrived, `YYYY-MM-DD`. NOT today, unless it is. */
  paidOn: string
  /** Groups the rows of one payment together, and is the duplicate guard. */
  groupRef: string
  notes?: string | null
  sendConfirmation?: boolean
}

export interface OfflineTicketResult {
  ok: boolean
  ticketRefs: string[]
  /** Each step, separately — including the ones that did not happen. */
  steps: {
    tickets: 'written' | 'already_present' | 'failed'
    /** `duplicate` is a success: this payment was already in the books. */
    books: 'written' | 'duplicate' | 'skipped' | 'failed'
    inventory: 'decremented' | 'oversold' | 'unavailable' | 'skipped'
    email: 'sent' | 'not_requested' | 'unconfigured' | 'failed'
  }
  remaining?: number
  totalCents: number
  error?: string
}

export function seatTotalCents(seats: SeatLine[]): number {
  return seats.reduce((sum, s) => sum + s.unitPriceCents * s.quantity, 0)
}

function seatCount(seats: SeatLine[]): number {
  return seats.reduce((sum, s) => sum + s.quantity, 0)
}

/**
 * Put a paying customer on the roster, into the books and out of inventory.
 *
 * `groupRef` is the idempotency key. There is no unique index on it — adding
 * one would break the legitimate case of a cart split across two group refs —
 * so this reads first. That is check-then-act, and it is deliberate: the caller
 * is a human clicking a button in the admin, not a webhook being retried by a
 * machine twelve times a second, and the consequence of the narrow race (two
 * admins accepting the same Venmo receipt in the same second) is a duplicate
 * row a person can see and delete, not silent money loss.
 */
export async function issueOfflineTickets(
  supabase: Supa,
  input: OfflineTicketInput,
): Promise<OfflineTicketResult> {
  const totalCents = seatTotalCents(input.seats)
  const base: OfflineTicketResult = {
    ok: false,
    ticketRefs: [],
    steps: { tickets: 'failed', books: 'skipped', inventory: 'skipped', email: 'not_requested' },
    totalCents,
  }

  if (!input.seats.length || seatCount(input.seats) < 1) {
    return { ...base, error: 'no seats to issue' }
  }

  const { data: existing, error: existingErr } = await supabase
    .from('event_tickets')
    .select('ticket_ref')
    .eq('group_ref', input.groupRef)
  if (existingErr) {
    // Rule 12 again: an unreadable table is not an empty one. Proceeding here
    // would be how the same payment becomes two sets of tickets.
    return { ...base, error: `could not check for existing tickets: ${existingErr.message}` }
  }
  if (existing && existing.length > 0) {
    return {
      ...base,
      ok: true,
      ticketRefs: existing.map(r => String(r.ticket_ref)),
      steps: { ...base.steps, tickets: 'already_present' },
    }
  }

  const { data: evt, error: evtErr } = await supabase
    .from('events')
    .select('title, event_date, event_time, location')
    .eq('id', input.eventId)
    .maybeSingle()
  if (evtErr) return { ...base, error: `events read failed: ${evtErr.message}` }
  if (!evt) return { ...base, error: `event ${input.eventId} does not exist` }

  // ── 1. The roster ─────────────────────────────────────────────────
  const refs: string[] = []
  for (const line of input.seats) {
    for (let i = 0; i < line.quantity; i++) {
      const ref = await nextTicketRef(supabase, input.eventId)
      if (!ref.ok) return { ...base, ticketRefs: refs, error: `could not allocate a ticket ref: ${ref.message}` }
      const { error } = await supabase.from('event_tickets').insert({
        ticket_ref: ref.ref,
        event_id: input.eventId,
        group_ref: input.groupRef,
        customer_name: input.customerName,
        customer_email: input.customerEmail,
        customer_phone: input.customerPhone || null,
        quantity: 1,
        variant_label: line.variantLabel,
        unit_price_cents: line.unitPriceCents,
        total_cents: line.unitPriceCents,
        status: 'confirmed',
        notes: input.notes || null,
      })
      if (error) {
        // Partial: some seats exist. Say which — the caller can re-run, and the
        // group_ref guard above will then report `already_present` rather than
        // doubling what landed.
        return { ...base, ticketRefs: refs, error: `ticket insert failed after ${refs.length} seat(s): ${error.message}` }
      }
      refs.push(ref.ref)
    }
  }

  const result: OfflineTicketResult = {
    ...base,
    ok: true,
    ticketRefs: refs,
    steps: { ...base.steps, tickets: 'written' },
  }

  // ── 2. The books ──────────────────────────────────────────────────
  const methodLabel = input.method.charAt(0).toUpperCase() + input.method.slice(1)
  // Through the ONE ledger writer, not a second copy of the insert. `lib/
  // financialLedger.ts` exists because "record money in the books" used to be a
  // private function inside the Stripe webhook, which is precisely why no
  // hand-entered payment ever reached the Financials tab.
  //
  // Non-fatal by design: the customer has their seats. A missing books row is a
  // bookkeeping problem with a loud log line, not a reason to refuse a ticket
  // that is already issued — and `duplicate` is a success, because the unique
  // index on (source, reference) is what makes a re-run safe.
  result.steps.books = await recordLedgerEntry(supabase, {
    date: input.paidOn,
    description: `${evt.title} — ${seatCount(input.seats)} ticket(s) (${methodLabel})`,
    amountCents: totalCents,
    source: ledgerSource(input.method),
    category: 'Event Ticket',
    customerName: input.customerName,
    reference: `${input.method}-tk-${input.groupRef}`,
    notes: [methodLabel, input.notes, refs.join(' · ')].filter(Boolean).join(' · '),
  })

  // ── 3. Inventory ──────────────────────────────────────────────────
  const dec = await decrementInventory(supabase, 'event', input.eventId, seatCount(input.seats))
  if (dec.outcome === 'decremented') {
    result.steps.inventory = 'decremented'
    result.remaining = dec.remaining
  } else if (dec.outcome === 'oversold') {
    // The seats are issued and the event is now over capacity. That is a real
    // operational fact and it must be said out loud, not swallowed.
    console.error(`OVERSOLD: ${refs.join(', ')} issued for event ${input.eventId} — inventory NOT decremented.`)
    result.steps.inventory = 'oversold'
  } else {
    console.error(`offline ticket ${input.groupRef}: inventory decrement failed —`, dec.message)
    result.steps.inventory = 'unavailable'
  }

  // ── 4. The confirmation ───────────────────────────────────────────
  if (!input.sendConfirmation) return result
  if (!process.env.RESEND_API_KEY) {
    result.steps.email = 'unconfigured'
    return result
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const dateDisplay = evt.event_date
      ? new Date(String(evt.event_date) + 'T12:00:00').toLocaleDateString('en-US', {
          timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
        })
      : 'TBA'
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com',
      to: input.customerEmail,
      subject: `You're in! ${evt.title}`,
      html: ticketConfirmationHtml({
        customerName: input.customerName,
        eventTitle: String(evt.title),
        eventDate: dateDisplay,
        eventTime: String(evt.event_time || 'TBA'),
        location: String(evt.location || '295 Montauk Highway, Suite 7, Speonk, NY 11972'),
        quantity: seatCount(input.seats),
        variantLabel: input.seats.length === 1 ? input.seats[0].variantLabel || undefined : undefined,
        totalFormatted: money(totalCents),
        // The refs are one per seat; the email names the first and the customer
        // quotes it back. Listing four refs to a parent of two is noise.
        ticketRef: refs[0],
        isFree: totalCents === 0,
      }),
    })
    result.steps.email = error ? 'failed' : 'sent'
    if (error) console.error(`offline ticket ${input.groupRef}: confirmation email failed —`, error.message)
  } catch (err) {
    result.steps.email = 'failed'
    console.error(`offline ticket ${input.groupRef}: confirmation email threw —`, err instanceof Error ? err.message : err)
  }

  return result
}
