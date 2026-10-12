/**
 * One batch read behind the Booked page's per-party invitation button.
 *
 *   loadEviteSummaries(supabase, bookingIds, now)  ->  ok { summaries } | unavailable { reason }
 *
 * The Booked list shows a button on every row, and must not make one request per row. This reads the
 * `evites`, `bookings`, `booking_payments`, `booking_line_items` and `evite_sends` rows for a whole page of
 * ids in a handful of `.in()` reads (chunked, because PostgREST refuses a long one) and derives each
 * party's state with the SAME helpers the admin card uses: `inviteState` (so "booked" is `bookingStage()` and
 * nothing else), `inviteFacts` + `renderInputsHash` for freshness, `isEviteEligible` for who may have one.
 *
 * THREE outcomes, never an empty answer: a failed read of ANY table in ANY chunk is `unavailable` for the
 * whole batch. "Could not read it" must not render as "no invitation" (which would offer a Create button
 * over a party that has one) and must not render as "preview" (a payments read that failed is not a party
 * with no payments). A booking id that does not exist is `null` in the map.
 *
 * No `select('*')`: every read names its columns.
 */

import type { getSupabase } from '@/lib/supabase'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { isPlausibleEmailAddress } from '@/lib/contactLookup'
import { evitePagesMode, isPilotBooking } from '@/lib/evites/config'
import { isEviteEligible } from '@/lib/evites/eligibility'
import { inviteFacts } from '@/lib/evites/facts'
import { renderInputsHash } from '@/lib/evites/hash'
import { inviteState, type InviteState } from '@/lib/evites/state'
import { ADMIN_EVITE_COLUMNS } from '@/lib/evites/adminView'
import { EVITE_BOOKING_COLUMNS, EVITE_LINE_ITEM_COLUMNS, EVITE_PARTY_THEME_COLUMNS, EVITE_PAYMENT_COLUMNS } from '@/lib/evites/views'
import type { EviteBookingRow, EviteLineItemRow, EvitePaymentRow, EviteRow, PartyThemeRow } from '@/lib/evites/types'

type Supa = ReturnType<typeof getSupabase>

/** PostgREST refuses a `.in()` filter past roughly 390 uuids; stay well under it. */
export const SUMMARY_IN_CHUNK = 300
/** The most ids one request may name. */
export const SUMMARY_MAX_IDS = 300

export interface EviteSummary {
  /** Could this booking have an invitation at all (never a studio rental, never cancelled / lost)? */
  eligible: boolean
  /** Would "Create invitation" be accepted right now (the pages flag, the pilot list)? */
  canEnsure: boolean
  /** No usable parent email: "Send to parent" cannot work. */
  noParentEmail: boolean
  evite: null | {
    slug: string
    publicUrl: string
    state: InviteState
    /** null = not drawn at all (switched off or withdrawn). */
    renderFresh: boolean | null
    /** A `sent` invite_ready email is on the ledger. */
    inviteReadySent: boolean
  }
}

export type SummaryRead =
  | { kind: 'ok'; summaries: Record<string, EviteSummary | null> }
  | { kind: 'unavailable'; reason: string }

type AdminEvite = Pick<EviteRow, (typeof ADMIN_EVITE_COLUMNS)[number]>
type LineItemWithBooking = EviteLineItemRow & { booking_id: string }
type PaymentWithBooking = EvitePaymentRow & { booking_id: string }

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const list = m.get(k)
    if (list) list.push(r)
    else m.set(k, [r])
  }
  return m
}

export async function loadEviteSummaries(supabase: Supa, bookingIds: readonly string[], now: Date): Promise<SummaryRead> {
  const ids = Array.from(new Set(bookingIds))
  if (ids.length === 0) return { kind: 'ok', summaries: {} }

  const evites: AdminEvite[] = []
  const bookings: EviteBookingRow[] = []
  const payments: PaymentWithBooking[] = []

  for (const chunk of chunks(ids, SUMMARY_IN_CHUNK)) {
    const ev = await supabase.from('evites').select(ADMIN_EVITE_COLUMNS.join(', ')).in('booking_id', chunk)
    if (ev.error) return { kind: 'unavailable', reason: `evite read failed: ${ev.error.message}` }
    evites.push(...((ev.data ?? []) as unknown as AdminEvite[]))

    const bk = await supabase.from('bookings').select(EVITE_BOOKING_COLUMNS.join(', ')).in('id', chunk)
    if (bk.error) return { kind: 'unavailable', reason: `booking read failed: ${bk.error.message}` }
    bookings.push(...((bk.data ?? []) as unknown as EviteBookingRow[]))

    const pay = await supabase.from('booking_payments').select(['booking_id', ...EVITE_PAYMENT_COLUMNS].join(', ')).in('booking_id', chunk)
    if (pay.error) return { kind: 'unavailable', reason: `booking_payments read failed: ${pay.error.message}` }
    payments.push(...((pay.data ?? []) as unknown as PaymentWithBooking[]))
  }

  const eviteByBooking = new Map<string, AdminEvite>()
  for (const e of evites) eviteByBooking.set(e.booking_id, e)

  // Theme inputs and the send ledger only matter for bookings that HAVE an invitation.
  const lineItems: LineItemWithBooking[] = []
  let partyThemes: PartyThemeRow[] = []
  const sentIds = new Set<string>()
  const eviteIds = evites.map((e) => e.id)
  if (evites.length > 0) {
    const themes = await supabase.from('party_themes').select(EVITE_PARTY_THEME_COLUMNS.join(', '))
    if (themes.error) return { kind: 'unavailable', reason: `party_themes read failed: ${themes.error.message}` }
    partyThemes = (themes.data ?? []) as unknown as PartyThemeRow[]

    for (const chunk of chunks(Array.from(eviteByBooking.keys()), SUMMARY_IN_CHUNK)) {
      const li = await supabase.from('booking_line_items').select(['booking_id', ...EVITE_LINE_ITEM_COLUMNS].join(', ')).in('booking_id', chunk)
      if (li.error) return { kind: 'unavailable', reason: `line items read failed: ${li.error.message}` }
      lineItems.push(...((li.data ?? []) as unknown as LineItemWithBooking[]))
    }
    for (const chunk of chunks(eviteIds, SUMMARY_IN_CHUNK)) {
      const sends = await supabase
        .from('evite_sends')
        .select('evite_id, status')
        .in('evite_id', chunk)
        .eq('send_type', 'invite_ready')
        .eq('channel', 'email')
        .is('rsvp_id', null)
      if (sends.error) return { kind: 'unavailable', reason: `evite_sends read failed: ${sends.error.message}` }
      for (const s of (sends.data ?? []) as unknown as Array<{ evite_id: string; status: string }>) {
        if (s.status === 'sent') sentIds.add(s.evite_id)
      }
    }
  }

  const bookingById = new Map<string, EviteBookingRow>()
  for (const b of bookings) bookingById.set(b.id, b)
  const paymentsByBooking = groupBy(payments, (p) => p.booking_id)
  const itemsByBooking = groupBy(lineItems, (l) => l.booking_id)
  const pagesMode = evitePagesMode()

  const summaries: Record<string, EviteSummary | null> = {}
  for (const id of ids) {
    const booking = bookingById.get(id)
    if (!booking) {
      summaries[id] = null
      continue
    }
    const eligible = isEviteEligible(booking)
    const base = {
      eligible,
      canEnsure: eligible && pagesMode !== 'off' && (pagesMode === 'on' || isPilotBooking(booking.booking_ref)),
      noParentEmail: !isPlausibleEmailAddress(booking.contact_email),
    }
    const evite = eviteByBooking.get(id)
    if (!evite) {
      summaries[id] = { ...base, evite: null }
      continue
    }

    const state = inviteState(booking, paymentsByBooking.get(id) ?? [], evite, now, {
      pagesMode,
      isPilot: isPilotBooking(booking.booking_ref),
    })
    const facts = inviteFacts(booking, evite, itemsByBooking.get(id) ?? [], partyThemes, state)
    const rendered = !!evite.invite_object && !!evite.og_object
    // A switched-off or withdrawn invitation is not drawn at all, so "fresh" has no meaning for it.
    const renderFresh = state === 'disabled' || state === 'unavailable' ? null : rendered && renderInputsHash(facts) === evite.render_inputs_hash
    summaries[id] = {
      ...base,
      evite: {
        slug: evite.slug,
        publicUrl: `${CANONICAL_ORIGIN}/i/${evite.slug}`,
        state,
        renderFresh,
        inviteReadySent: sentIds.has(evite.id),
      },
    }
  }
  return { kind: 'ok', summaries }
}
