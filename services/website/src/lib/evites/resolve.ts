/**
 * `resolveEviteBySlug` - the one door from a URL slug to everything a public
 * invitation needs (spec §7.4).
 *
 *   resolveEviteBySlug(supabase, slug, { now?, followAlias? })
 *     -> { kind: 'ok', evite, booking, payments, lineItems, partyThemes, state, facts }
 *      | { kind: 'redirect', slug }      a re-minted slug: send the visitor to the current one (308)
 *      | { kind: 'notFound' }            unknown, archived, cancelled, lost, switched off: ALL the same answer
 *
 * THROWS on any read error. A Supabase blip must not be mis-stated as "this
 * invitation does not exist" (a 404 a guest would take for a cancelled party), and
 * it must not be mis-stated as `preview` either (an empty payments list reads as
 * "not booked"). The page's `error.tsx` renders it as a 500 "try again".
 *
 * What it will NOT do:
 *   - read the database for a string that is not a slug (`isSlugShape` first), or
 *     at all while the pages flag is `off`;
 *   - tell an unavailable invitation from an unknown one. `disabled` and
 *     `unavailable` are both `notFound`;
 *   - reveal that an OLD slug once existed for a party that is no longer
 *     available: an alias is followed only when the party it points to resolves
 *     to `ok`, otherwise it is `notFound` like any other stranger's guess;
 *   - serialise anything. It returns server-side rows; the caller picks fields.
 *
 * The alias lookup is PostgREST `.contains('previous_slugs', [slug])`, which is
 * parameter-encoded. Never a template literal in `.or()` (AGENTS.md §11).
 */

import type { getSupabase } from '@/lib/supabase'
import { evitePagesMode, isPilotBooking } from '@/lib/evites/config'
import { inviteFacts, type InviteFacts } from '@/lib/evites/facts'
import { isSlugShape } from '@/lib/evites/slug'
import { inviteState, type InviteState } from '@/lib/evites/state'
import { readThemeInputs } from '@/lib/evites/themeInputs'
import type { EviteBookingRow, EviteLineItemRow, EvitePaymentRow, EviteRow, PartyThemeRow } from '@/lib/evites/types'
import { EVITE_BOOKING_COLUMNS, EVITE_PAGE_COLUMNS, EVITE_PAYMENT_COLUMNS } from '@/lib/evites/views'

type Supa = ReturnType<typeof getSupabase>

/** The `evites` columns the public page reads (`EVITE_PAGE_COLUMNS`). */
export type EvitePageRow = Pick<EviteRow, (typeof EVITE_PAGE_COLUMNS)[number]>

/** The states a visitor can actually be shown a page for. */
export type VisibleInviteState = Exclude<InviteState, 'disabled' | 'unavailable'>

export type ResolveOutcome =
  | {
      kind: 'ok'
      evite: EvitePageRow
      booking: EviteBookingRow
      payments: EvitePaymentRow[]
      lineItems: EviteLineItemRow[]
      partyThemes: PartyThemeRow[]
      state: VisibleInviteState
      facts: InviteFacts
    }
  | { kind: 'redirect'; slug: string }
  | { kind: 'notFound' }

export interface ResolveOptions {
  now?: Date
}

const NOT_FOUND: ResolveOutcome = { kind: 'notFound' }

function fail(what: string, message: string): never {
  throw new Error(`evites/resolve: ${what} read failed: ${message}`)
}

/** Steps 2-3 for a slug that is known to be the evite's CURRENT slug. */
async function resolveCurrent(supabase: Supa, slug: string, now: Date): Promise<ResolveOutcome> {
  const ev = await supabase.from('evites').select(EVITE_PAGE_COLUMNS.join(', ')).eq('slug', slug).maybeSingle<EvitePageRow>()
  if (ev.error) fail('evites', ev.error.message)
  const evite = ev.data
  if (!evite) return NOT_FOUND
  // Withdrawn: no need to read anything else to say what `inviteState` would.
  if (evite.archived_at) return NOT_FOUND

  const bk = await supabase.from('bookings').select(EVITE_BOOKING_COLUMNS.join(', ')).eq('id', evite.booking_id).maybeSingle<EviteBookingRow>()
  if (bk.error) fail('bookings', bk.error.message)
  const booking = bk.data
  if (!booking) return NOT_FOUND

  // A failed payments read must not become "no payments", which `inviteState` reads as preview.
  const pay = await supabase.from('booking_payments').select(EVITE_PAYMENT_COLUMNS.join(', ')).eq('booking_id', booking.id)
  if (pay.error) fail('booking_payments', pay.error.message)
  const payments = (pay.data ?? []) as unknown as EvitePaymentRow[]

  const themes = await readThemeInputs(supabase, booking.id)
  if (themes.kind === 'unavailable') throw new Error(`evites/resolve: ${themes.reason}`)

  const state = inviteState(booking, payments, evite, now, {
    pagesMode: evitePagesMode(),
    isPilot: isPilotBooking(booking.booking_ref),
  })
  if (state === 'disabled' || state === 'unavailable') return NOT_FOUND

  const facts = inviteFacts(booking, evite, themes.lineItems, themes.partyThemes, state)
  return { kind: 'ok', evite, booking, payments, lineItems: themes.lineItems, partyThemes: themes.partyThemes, state, facts }
}

export async function resolveEviteBySlug(supabase: Supa, slug: string, opts: ResolveOptions = {}): Promise<ResolveOutcome> {
  const now = opts.now ?? new Date()

  // 1. Not a slug (or the feature is off): no database read at all.
  if (!isSlugShape(slug)) return NOT_FOUND
  if (evitePagesMode() === 'off') return NOT_FOUND

  // 2. Exact match on the current slug.
  const exact = await resolveCurrent(supabase, slug, now)
  if (exact.kind !== 'notFound') return exact

  // 2b. A slug that was re-minted before go-live (spec §7.4 "Re-slug"). Newest first, one row.
  const alias = await supabase
    .from('evites')
    .select('slug')
    .contains('previous_slugs', [slug])
    .order('created_at', { ascending: false })
    .limit(1)
  if (alias.error) fail('evites alias', alias.error.message)
  const target = ((alias.data ?? []) as unknown as Array<{ slug: string }>)[0]?.slug
  if (typeof target !== 'string' || target === slug || !isSlugShape(target)) return NOT_FOUND

  // Follow it only to a party that is itself visible. A redirect to an
  // unavailable invitation would answer "that old slug WAS real" - an oracle the
  // identical-404 rule exists to close.
  const next = await resolveCurrent(supabase, target, now)
  return next.kind === 'ok' ? { kind: 'redirect', slug: target } : NOT_FOUND
}
