import type { getSupabase } from '@/lib/supabase'
import { bookingStage, etToday, type BookingStage } from '@/lib/bookingStatus'
import { sumPayments } from '@/lib/bookingBalance'
import { touchesFor, type LeadBooking, type Touch } from '@/lib/assistant/leadView'
import { clock12 } from '@/lib/assistant/timeFormat'

/**
 * The open leads, as cards, most recently in touch first - the Leads screen of the
 * crew-management app (`/admin/crew/leads`).
 *
 * "Open" means the DERIVED stage is inquiry or quoted (from money and dates, never
 * the raw status) and the party has not already happened. A lead's "last contact" is
 * the newest of: something they sent us, something we sent them, or - if neither is
 * on record - when they first asked.
 *
 * This feeds an ADMIN screen, so the phone number and email are returned as they are
 * (the card has a tap-to-call). The Manager assistant's own lead tools mask them;
 * this is not that path. Read-only.
 */

type Supa = ReturnType<typeof getSupabase>

const COLUMNS =
  'id, booking_ref, status, contact_id, contact_name, contact_email, contact_phone, party_type, event_type, party_date, party_time, guest_count_approx, child_name, child_age, package_type, total_cents, created_at'
const SCAN = 200
const WINDOW_DAYS = 365
const SNIPPET_CHARS = 140

export interface LeadCard {
  id: string
  ref: string
  name: string
  childName: string | null
  childAge: number | null
  partyType: string | null
  partyDate: string | null
  /** "2:00 PM" or null. */
  partyTime: string | null
  guests: number | null
  stage: BookingStage
  packageType: string | null
  totalCents: number | null
  paidCents: number
  phone: string | null
  email: string | null
  createdAt: string
  /** ISO. The sort key. */
  lastContactAt: string
  /** Who spoke last. null when there is no message on record at all. */
  lastFrom: 'them' | 'us' | null
  lastChannel: string | null
  /** What they last wrote (their words, trimmed), if they ever wrote. */
  lastTheirs: { text: string; at: string } | null
  /** The customer wrote last and nothing from us is on record after it. */
  waitingOnUs: boolean
}

export type LeadCardsResult =
  | { kind: 'ok'; leads: LeadCard[]; truncated: boolean }
  | { kind: 'unavailable'; error: string }

const ms = (iso: string) => new Date(iso).getTime()

export async function loadLeadCards(sb: Supa, now: Date = new Date()): Promise<LeadCardsResult> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString()
  const { data, error } = await sb
    .from('bookings')
    .select(COLUMNS)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(SCAN)
  if (error) return { kind: 'unavailable', error: 'Could not read the bookings.' }
  type Row = LeadBooking & { contact_email: string | null; party_time: string | null; child_age: number | null; package_type: string | null }
  const rows = (data ?? []) as unknown as Row[]
  if (rows.length === 0) return { kind: 'ok', leads: [], truncated: false }

  const ids = rows.map(r => r.id)
  const pay = await sb.from('booking_payments').select('booking_id, amount_cents, payment_type').in('booking_id', ids)
  if (pay.error) return { kind: 'unavailable', error: 'Could not read the payments, so stages cannot be worked out.' }
  const byBooking = new Map<string, Array<{ amount_cents: number; payment_type: string }>>()
  for (const p of (pay.data ?? []) as Array<{ booking_id: string; amount_cents: number; payment_type: string }>) {
    byBooking.set(p.booking_id, [...(byBooking.get(p.booking_id) ?? []), p])
  }

  const today = etToday(now)
  const open = rows
    .map(r => {
      const paid = sumPayments((byBooking.get(r.id) ?? []) as never)
      return { r, paid, stage: bookingStage({ status: r.status, paidCents: paid, partyDate: r.party_date, today }) }
    })
    // A party that has already happened and never booked is not a lead to chase.
    .filter(x => (x.stage === 'inquiry' || x.stage === 'quoted') && (!x.r.party_date || x.r.party_date >= today))
  if (open.length === 0) return { kind: 'ok', leads: [], truncated: rows.length >= SCAN }

  const touches = await touchesFor(sb, open.map(x => x.r))
  if (!touches.ok) return { kind: 'unavailable', error: 'Could not read the message history.' }

  // What each lead last WROTE: the newest inbound message body per booking.
  const msgs = await sb
    .from('ingested_messages')
    .select('booking_id, body, sent_at, created_at')
    .in('booking_id', open.map(x => x.r.id))
    .eq('direction', 'in')
    .order('created_at', { ascending: false })
    .limit(600)
  if (msgs.error) return { kind: 'unavailable', error: 'Could not read the messages.' }
  const theirs = new Map<string, { text: string; at: string }>()
  for (const m of (msgs.data ?? []) as Array<{ booking_id: string; body: string | null; sent_at: string | null; created_at: string }>) {
    const text = (m.body ?? '').replace(/\s+/g, ' ').trim()
    if (text && !theirs.has(m.booking_id)) theirs.set(m.booking_id, { text: text.slice(0, SNIPPET_CHARS), at: m.sent_at ?? m.created_at })
  }

  const leads: LeadCard[] = open.map(({ r, paid, stage }) => {
    const inb: Touch | undefined = touches.inbound.get(r.id)
    const out: Touch | undefined = touches.outbound.get(r.id)
    const newest = [inb && { t: inb, from: 'them' as const }, out && { t: out, from: 'us' as const }]
      .filter((x): x is { t: Touch; from: 'them' | 'us' } => !!x)
      .sort((a, b) => ms(b.t.at) - ms(a.t.at))[0]
    return {
      id: r.id,
      ref: r.booking_ref,
      name: r.contact_name ?? 'Unknown',
      childName: r.child_name,
      childAge: r.child_age,
      partyType: r.party_type,
      partyDate: r.party_date,
      partyTime: clock12(r.party_time),
      guests: r.guest_count_approx,
      stage,
      packageType: r.package_type,
      totalCents: r.total_cents,
      paidCents: paid,
      phone: r.contact_phone,
      email: r.contact_email,
      createdAt: r.created_at,
      lastContactAt: newest ? newest.t.at : r.created_at,
      lastFrom: newest ? newest.from : null,
      lastChannel: newest ? newest.t.channel : null,
      lastTheirs: theirs.get(r.id) ?? null,
      waitingOnUs: !!newest && newest.from === 'them',
    }
  })

  leads.sort((a, b) => ms(b.lastContactAt) - ms(a.lastContactAt))
  return { kind: 'ok', leads, truncated: rows.length >= SCAN }
}
