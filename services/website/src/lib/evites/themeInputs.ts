/**
 * Read what `resolveTheme()` needs: the booking's line items and the
 * `party_themes` catalogue. The only place evite code reads those two tables.
 *
 * Three outcomes, never a bare array: a failed read is `unavailable`, not
 * "no line items" and not "no themes". Resolving a theme from an empty list
 * after a Supabase blip would stamp the `plain` template and a `birthday` slug
 * on a Glow party. The caller decides what `unavailable` means (ensure: do not
 * create yet; the intake that triggered it is never failed by this).
 *
 * `party_themes` is read WITHOUT an `is_active` filter on purpose: a booking made
 * for a theme that has since been retired must still resolve to it.
 */

import type { getSupabase } from '@/lib/supabase'
import type { EviteLineItemRow, PartyThemeRow } from '@/lib/evites/types'
import { EVITE_LINE_ITEM_COLUMNS, EVITE_PARTY_THEME_COLUMNS } from '@/lib/evites/views'

type Supa = ReturnType<typeof getSupabase>

export type ThemeInputs =
  | { kind: 'ok'; lineItems: EviteLineItemRow[]; partyThemes: PartyThemeRow[] }
  | { kind: 'unavailable'; reason: string }

export async function readThemeInputs(supabase: Supa, bookingId: string): Promise<ThemeInputs> {
  const items = await supabase
    .from('booking_line_items')
    .select(EVITE_LINE_ITEM_COLUMNS.join(', '))
    .eq('booking_id', bookingId)
  if (items.error) return { kind: 'unavailable', reason: `line items read failed: ${items.error.message}` }

  const themes = await supabase.from('party_themes').select(EVITE_PARTY_THEME_COLUMNS.join(', '))
  if (themes.error) return { kind: 'unavailable', reason: `party_themes read failed: ${themes.error.message}` }

  return {
    kind: 'ok',
    lineItems: (items.data ?? []) as unknown as EviteLineItemRow[],
    partyThemes: (themes.data ?? []) as unknown as PartyThemeRow[],
  }
}
