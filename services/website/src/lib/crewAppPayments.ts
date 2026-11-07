import type { getSupabase } from '@/lib/supabase'
import { computeBalance, sumPayments } from '@/lib/bookingBalance'

/**
 * Every payment, for the crew-management app's $ screen: party deposits and balances
 * (card, Venmo, Zelle, cash, other) and event-ticket sales, newest first, each with who
 * paid, what for, and - for a party - what the booking STILL owes.
 *
 * Read only. The balance is the Booked tab's own arithmetic (bookingBalance: the total
 * less everything paid, a refund subtracting), computed from ALL of that booking's
 * payments, not just the rows on screen. A failed read is an error, never an empty list.
 */

type Supa = ReturnType<typeof getSupabase>

export type PayMethod = 'card' | 'venmo' | 'zelle' | 'cash' | 'other'

export interface PaymentRow {
  id: string
  kind: 'booking' | 'event'
  method: PayMethod
  /** deposit / partial / final / refund for a party; 'tickets' for an event. */
  type: string
  /** Signed: a refund is negative. */
  amountCents: number
  tipCents: number
  /** ISO. */
  at: string
  person: string
  /** The party ("Sam's Party") or the event title. */
  what: string
  partyDate: string | null
  partyType: string | null
  bookingId: string | null
  bookingRef: string | null
  totalCents: number | null
  /** What the booking still owes after everything paid; null for an event ticket. */
  balanceCents: number | null
  paidInFull: boolean | null
  bookingStatus: string | null
  refunded: boolean
}

const BOOKING_PAYMENT_LIMIT = 600
const TICKET_LIMIT = 300
const IN_CHUNK = 150

export function methodOfBookingPayment(m: string | null | undefined): PayMethod {
  const v = (m ?? '').toLowerCase()
  if (v === 'card' || v === 'stripe') return 'card'
  if (v === 'venmo' || v === 'zelle' || v === 'cash') return v
  return 'other'
}

/** A ticket paid through Stripe has a Stripe id; one entered by hand carries the method in its note ("Venmo 50.00 from …"). */
export function methodOfTicket(hasStripe: boolean, notes: string | null | undefined): PayMethod {
  if (hasStripe) return 'card'
  const n = (notes ?? '').trim().toLowerCase()
  if (n.startsWith('venmo')) return 'venmo'
  if (n.startsWith('zelle')) return 'zelle'
  if (n.startsWith('cash')) return 'cash'
  return 'other'
}

const possessive = (n: string) => (/s$/i.test(n) ? `${n}' Party` : `${n}'s Party`)

async function chunked<T>(ids: string[], read: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[] | null> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await read(ids.slice(i, i + IN_CHUNK))
    if (error) return null
    out.push(...(data ?? []))
  }
  return out
}

export async function loadPayments(sb: Supa): Promise<{ ok: true; rows: PaymentRow[]; truncated: boolean } | { ok: false; error: string }> {
  const recent = await sb
    .from('booking_payments')
    .select('id, booking_id, payment_type, payment_method, amount_cents, tip_cents, paid_at, created_at')
    .order('paid_at', { ascending: false, nullsFirst: false })
    .limit(BOOKING_PAYMENT_LIMIT)
  if (recent.error) return { ok: false, error: 'Could not read the payments.' }
  const pays = (recent.data ?? []) as Array<{
    id: string; booking_id: string | null; payment_type: string; payment_method: string | null; amount_cents: number; tip_cents: number | null; paid_at: string | null; created_at: string
  }>

  const bookingIds = Array.from(new Set(pays.map(p => p.booking_id).filter((x): x is string => !!x)))
  const bookings = await chunked<{
    id: string; booking_ref: string; contact_name: string | null; child_name: string | null; party_date: string | null; party_type: string | null; status: string | null; total_cents: number | null
  }>(bookingIds, c => sb.from('bookings').select('id, booking_ref, contact_name, child_name, party_date, party_type, status, total_cents').in('id', c))
  // Everything each booking has been paid, for its balance (not only the rows listed).
  const allPays = await chunked<{ booking_id: string; amount_cents: number; payment_type: string }>(
    bookingIds,
    c => sb.from('booking_payments').select('booking_id, amount_cents, payment_type').in('booking_id', c),
  )
  if (!bookings || !allPays) return { ok: false, error: 'Could not read the bookings behind the payments.' }
  const bookingBy = new Map(bookings.map(b => [b.id, b]))
  const paidBy = new Map<string, number>()
  const grouped = new Map<string, Array<{ amount_cents: number; payment_type: string }>>()
  for (const p of allPays) grouped.set(p.booking_id, [...(grouped.get(p.booking_id) ?? []), p])
  for (const [id, list] of Array.from(grouped.entries())) paidBy.set(id, sumPayments(list))

  const rows: PaymentRow[] = pays.map(p => {
    const b = p.booking_id ? bookingBy.get(p.booking_id) : undefined
    const bal = b ? computeBalance(b.total_cents, paidBy.get(b.id) ?? 0) : null
    const refund = p.payment_type === 'refund'
    return {
      id: `bp-${p.id}`,
      kind: 'booking',
      method: methodOfBookingPayment(p.payment_method),
      type: p.payment_type,
      amountCents: refund ? -Math.abs(p.amount_cents) : p.amount_cents,
      tipCents: Number(p.tip_cents) || 0,
      at: p.paid_at ?? p.created_at,
      person: b?.contact_name ?? 'Unknown',
      what: b ? (b.child_name ? possessive(b.child_name) : b.booking_ref) : 'Booking not found',
      partyDate: b?.party_date ?? null,
      partyType: b?.party_type ?? null,
      bookingId: b?.id ?? null,
      bookingRef: b?.booking_ref ?? null,
      totalCents: b?.total_cents ?? null,
      balanceCents: bal ? bal.balanceCents : null,
      paidInFull: bal ? bal.paidInFull : null,
      bookingStatus: b?.status ?? null,
      refunded: false,
    }
  })

  // Event tickets: card (Stripe) and the ones entered by hand.
  const tickets = await sb
    .from('event_tickets')
    .select('id, event_id, customer_name, total_cents, refund_amount_cents, status, notes, stripe_payment_intent_id, stripe_session_id, created_at')
    .order('created_at', { ascending: false })
    .limit(TICKET_LIMIT)
  if (tickets.error) return { ok: false, error: 'Could not read the ticket sales.' }
  const tix = (tickets.data ?? []) as Array<{
    id: string; event_id: string; customer_name: string | null; total_cents: number | null; refund_amount_cents: number | null; status: string; notes: string | null
    stripe_payment_intent_id: string | null; stripe_session_id: string | null; created_at: string
  }>
  const eventIds = Array.from(new Set(tix.map(t => t.event_id)))
  const events = await chunked<{ id: string; title: string; event_date: string | null }>(eventIds, c => sb.from('events').select('id, title, event_date').in('id', c))
  if (!events) return { ok: false, error: 'Could not read the events behind the ticket sales.' }
  const eventBy = new Map(events.map(e => [e.id, e]))
  for (const t of tix) {
    const e = eventBy.get(t.event_id)
    const refunded = t.status === 'refunded' || (Number(t.refund_amount_cents) || 0) > 0
    rows.push({
      id: `et-${t.id}`,
      kind: 'event',
      method: methodOfTicket(!!(t.stripe_payment_intent_id || t.stripe_session_id), t.notes),
      type: 'tickets',
      amountCents: Number(t.total_cents) || 0,
      tipCents: 0,
      at: t.created_at,
      person: t.customer_name ?? 'Unknown',
      what: e?.title ?? 'Event',
      partyDate: e?.event_date ?? null,
      partyType: null,
      bookingId: null,
      bookingRef: null,
      totalCents: null,
      balanceCents: null,
      paidInFull: null,
      bookingStatus: null,
      refunded,
    })
    if (refunded && (Number(t.refund_amount_cents) || 0) > 0) {
      rows.push({ ...rows[rows.length - 1], id: `et-${t.id}-refund`, type: 'refund', amountCents: -(Number(t.refund_amount_cents) || 0) })
    }
  }

  rows.sort((a, b) => b.at.localeCompare(a.at))
  return { ok: true, rows, truncated: pays.length >= BOOKING_PAYMENT_LIMIT || tix.length >= TICKET_LIMIT }
}
