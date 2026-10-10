/**
 * Everything one evite email needs, read in one place (spec §9.1, §9.3 "re-read state and consent").
 *
 *   loadSendContext(supabase, eviteId, rsvpId | null, now) -> { kind:'ok', ctx } | { kind:'absent', what } | { kind:'unavailable', error }
 *   loadHeadcountRsvps(supabase, eviteId)                  -> { kind:'ok', rsvps } | { kind:'unavailable', error }
 *   sendsEnabledFor(bookingRef)                            -> the `EVITES_SENDS` flag (off | pilot | on), applied
 *
 * It is NOT `resolveEviteBySlug`: that is the PUBLIC door and answers "not found" for a cancelled,
 * archived or switched-off party, which is exactly the party a cancellation notice is about. This
 * reads by id, server-side, and reports the state as it is.
 *
 * THREE OUTCOMES. A failed read of any of the five tables is `unavailable`, never "no payments"
 * (which `inviteState` would read as `preview`) and never "no RSVP". The sender turns `unavailable`
 * into a retriable `failed`, and `absent` into a terminal `skipped`.
 *
 * THE FACTS' STATE. `facts` is built with the real state, except for a party that is no longer
 * available (cancelled, lost, archived) or whose pages are switched off: a cancellation notice
 * still has to say WHICH party on WHICH date, so those get the state their window implies (`live`
 * with a window, `needs_time` without). The REAL state is on `ctx.state`; every send except
 * `party_cancelled` checks it.
 */

import type { getSupabase } from '@/lib/supabase'
import { evitePagesMode, eviteSendsMode, isPilotBooking } from '@/lib/evites/config'
import { inviteFacts, type InviteFacts } from '@/lib/evites/facts'
import { isRenderFresh } from '@/lib/evites/hostView'
import { partyWindow } from '@/lib/evites/partyWindow'
import { inviteState, type InviteState } from '@/lib/evites/state'
import { readThemeInputs } from '@/lib/evites/themeInputs'
import type { EviteBookingRow, EvitePaymentRow, EviteRow, EviteRsvpRow } from '@/lib/evites/types'
import { EVITE_BOOKING_COLUMNS, EVITE_PAYMENT_COLUMNS, EVITE_SEND_COLUMNS, EVITE_SEND_RSVP_COLUMNS } from '@/lib/evites/views'

type Supa = ReturnType<typeof getSupabase>

export type SendEviteRow = Pick<EviteRow, (typeof EVITE_SEND_COLUMNS)[number]>
export type SendRsvpRow = Pick<EviteRsvpRow, (typeof EVITE_SEND_RSVP_COLUMNS)[number]>

export interface SendContext {
  evite: SendEviteRow
  booking: EviteBookingRow
  /** The REAL state (`disabled` and `unavailable` included). */
  state: InviteState
  facts: InviteFacts
  /** The RSVP the send is about, or null for a party-level send. */
  rsvp: SendRsvpRow | null
  /** Both stored images exist AND were drawn from what the invitation says now. */
  renderFresh: boolean
  now: Date
}

export type SendContextRead =
  | { kind: 'ok'; ctx: SendContext }
  | { kind: 'absent'; what: 'evite' | 'booking' | 'rsvp' }
  | { kind: 'unavailable'; error: string }

const unavailable = (what: string, message: string): SendContextRead => ({ kind: 'unavailable', error: `${what} read failed: ${message}` })

export async function loadSendContext(supabase: Supa, eviteId: string, rsvpId: string | null, now: Date = new Date()): Promise<SendContextRead> {
  const ev = await supabase.from('evites').select(EVITE_SEND_COLUMNS.join(', ')).eq('id', eviteId).maybeSingle<SendEviteRow>()
  if (ev.error) return unavailable('evites', ev.error.message)
  const evite = ev.data
  if (!evite) return { kind: 'absent', what: 'evite' }

  const bk = await supabase.from('bookings').select(EVITE_BOOKING_COLUMNS.join(', ')).eq('id', evite.booking_id).maybeSingle<EviteBookingRow>()
  if (bk.error) return unavailable('bookings', bk.error.message)
  const booking = bk.data
  if (!booking) return { kind: 'absent', what: 'booking' }

  // A failed payments read must not become "no payments", which inviteState reads as preview.
  const pay = await supabase.from('booking_payments').select(EVITE_PAYMENT_COLUMNS.join(', ')).eq('booking_id', booking.id)
  if (pay.error) return unavailable('booking_payments', pay.error.message)
  const payments = (pay.data ?? []) as unknown as EvitePaymentRow[]

  const themes = await readThemeInputs(supabase, booking.id)
  if (themes.kind === 'unavailable') return { kind: 'unavailable', error: themes.reason }

  let rsvp: SendRsvpRow | null = null
  if (rsvpId !== null) {
    const rs = await supabase
      .from('evite_rsvps')
      .select(EVITE_SEND_RSVP_COLUMNS.join(', '))
      .eq('id', rsvpId)
      .eq('evite_id', evite.id)
      .maybeSingle<SendRsvpRow>()
    if (rs.error) return unavailable('evite_rsvps', rs.error.message)
    if (!rs.data) return { kind: 'absent', what: 'rsvp' }
    rsvp = rs.data
  }

  const state = inviteState(booking, payments, evite, now, {
    pagesMode: evitePagesMode(),
    isPilot: isPilotBooking(booking.booking_ref),
  })
  const factsState: InviteState = state === 'disabled' || state === 'unavailable' ? (partyWindow(booking) ? 'live' : 'needs_time') : state
  const facts = inviteFacts(booking, evite, themes.lineItems, themes.partyThemes, factsState)
  const renderFresh = isRenderFresh(evite, facts, process.env.SUPABASE_URL)

  return { kind: 'ok', ctx: { evite, booking, state, facts, rsvp, renderFresh, now } }
}

export type HeadcountRead = { kind: 'ok'; rsvps: SendRsvpRow[] } | { kind: 'unavailable'; error: string }

/** Every RSVP of an invitation, oldest first, for the parent's final headcount. */
export async function loadHeadcountRsvps(supabase: Supa, eviteId: string): Promise<HeadcountRead> {
  const rs = await supabase
    .from('evite_rsvps')
    .select(EVITE_SEND_RSVP_COLUMNS.join(', '))
    .eq('evite_id', eviteId)
    .order('created_at', { ascending: true })
  if (rs.error) return { kind: 'unavailable', error: `evite_rsvps read failed: ${rs.error.message}` }
  return { kind: 'ok', rsvps: (rs.data ?? []) as unknown as SendRsvpRow[] }
}

/**
 * `EVITES_SENDS` applied to one booking: `off` sends nothing, `pilot` sends only for the refs in
 * `EVITES_PILOT_REFS`, `on` sends for everyone. Read at call time (config.ts).
 */
export function sendsEnabledFor(bookingRef: string | null | undefined): boolean {
  const mode = eviteSendsMode()
  if (mode === 'off') return false
  if (mode === 'pilot') return isPilotBooking(bookingRef)
  return true
}

export type PilotGateRead = { kind: 'ok'; allowed: boolean } | { kind: 'unavailable'; error: string }

/**
 * The cheap pre-claim gate for `pilot` mode: the booking ref of an invitation, two small reads. `off`
 * and `on` need no read at all. An unreadable ref is `unavailable`, never "allowed".
 */
export async function readSendGate(supabase: Supa, eviteId: string): Promise<PilotGateRead> {
  const mode = eviteSendsMode()
  if (mode === 'off') return { kind: 'ok', allowed: false }
  if (mode === 'on') return { kind: 'ok', allowed: true }
  const ev = await supabase.from('evites').select('booking_id').eq('id', eviteId).maybeSingle<{ booking_id: string }>()
  if (ev.error) return { kind: 'unavailable', error: `evites read failed: ${ev.error.message}` }
  if (!ev.data) return { kind: 'ok', allowed: false }
  const bk = await supabase.from('bookings').select('booking_ref').eq('id', ev.data.booking_id).maybeSingle<{ booking_ref: string | null }>()
  if (bk.error) return { kind: 'unavailable', error: `bookings read failed: ${bk.error.message}` }
  return { kind: 'ok', allowed: isPilotBooking(bk.data?.booking_ref) }
}
