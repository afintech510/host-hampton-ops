/**
 * Read everything the admin card derives state and facts from, with THREE
 * outcomes (AGENTS.md §11): `ok`, `noBooking`, `unavailable`. A failed read is
 * never "no payments" (which `inviteState` would call `preview`) and never
 * "no line items" (which would stamp the plain theme on a Glow party).
 *
 * The derivation is the public page's own (`inviteState` with the flags from
 * `config.ts`, then `inviteFacts`), so the admin sees exactly the state a guest
 * would be shown, except that `disabled` / `unavailable` are reported rather
 * than collapsed into a 404.
 */

import type { getSupabase } from '@/lib/supabase'
import { evitePagesMode, isPilotBooking } from '@/lib/evites/config'
import { inviteFacts, type InviteFacts, type InviteFactsEvite } from '@/lib/evites/facts'
import { inviteState, type InviteState } from '@/lib/evites/state'
import { readThemeInputs } from '@/lib/evites/themeInputs'
import type { EviteBookingRow, EvitePaymentRow } from '@/lib/evites/types'
import { EVITE_BOOKING_COLUMNS, EVITE_PAYMENT_COLUMNS } from '@/lib/evites/views'

type Supa = ReturnType<typeof getSupabase>

export type FactsContext =
  | { kind: 'ok'; booking: EviteBookingRow; payments: EvitePaymentRow[]; state: InviteState; facts: InviteFacts }
  | { kind: 'noBooking' }
  | { kind: 'unavailable'; reason: string }

export async function loadFactsContext(
  supabase: Supa,
  evite: InviteFactsEvite & { booking_id: string; archived_at: string | null },
  now: Date,
): Promise<FactsContext> {
  const bk = await supabase.from('bookings').select(EVITE_BOOKING_COLUMNS.join(', ')).eq('id', evite.booking_id).maybeSingle<EviteBookingRow>()
  if (bk.error) return { kind: 'unavailable', reason: `booking read failed: ${bk.error.message}` }
  const booking = bk.data
  if (!booking) return { kind: 'noBooking' }

  const pay = await supabase.from('booking_payments').select(EVITE_PAYMENT_COLUMNS.join(', ')).eq('booking_id', booking.id)
  if (pay.error) return { kind: 'unavailable', reason: `booking_payments read failed: ${pay.error.message}` }
  const payments = (pay.data ?? []) as unknown as EvitePaymentRow[]

  const themes = await readThemeInputs(supabase, booking.id)
  if (themes.kind === 'unavailable') return { kind: 'unavailable', reason: themes.reason }

  const state = inviteState(booking, payments, evite, now, {
    pagesMode: evitePagesMode(),
    isPilot: isPilotBooking(booking.booking_ref),
  })
  const facts = inviteFacts(booking, evite, themes.lineItems, themes.partyThemes, state)
  return { kind: 'ok', booking, payments, state, facts }
}
