/**
 * `ensureEviteForBooking` — get-or-create the one evite a booking may ever have
 * (spec §2 `ensure.ts`, §2.1).
 *
 * Outcomes, all returned and none thrown:
 *
 *   created      a new row was inserted (the caller fires `queueRender`)
 *   exists       a row already exists for this booking — ARCHIVED ONES TOO.
 *                `booking_id` is UNIQUE, so an archived evite is never re-created.
 *   ineligible   the booking is not a party we send invitations for (or is gone)
 *   disabled     `EVITES_PAGES` is off, or `pilot` and this is not a pilot booking
 *   unavailable  something we could not read or write. NEVER mistaken for
 *                `created` or `ineligible`: "could not tell" is its own answer.
 *
 * Order matters and mirrors the spec: pages flag -> read booking -> pilot gate ->
 * eligibility -> existing row -> insert. The flag is checked before any read so a
 * switched-off feature costs nothing.
 *
 * Two different unique violations (23505) can come back from the INSERT and they
 * mean opposite things, so they are told apart by constraint NAME, never guessed:
 *   evites_slug_key        another evite took this slug      -> mint again (up to 5)
 *   evites_booking_id_key  another writer got here first     -> `exists`
 * Postgres names the two inline UNIQUEs in migration 068 exactly that; the test
 * pins both strings.
 */

import type { getSupabase } from '@/lib/supabase'
import { evitePagesMode, isPilotBooking } from '@/lib/evites/config'
import { isEviteEligible } from '@/lib/evites/eligibility'
import { makeSlug } from '@/lib/evites/slug'
import { childNameOf } from '@/lib/evites/facts'
import { resolveTheme } from '@/lib/evites/themes'
import { readThemeInputs } from '@/lib/evites/themeInputs'
import { EVITE_BOOKING_COLUMNS, EVITE_LOOKUP_COLUMNS } from '@/lib/evites/views'
import type { EviteBookingRow } from '@/lib/evites/types'

type Supa = ReturnType<typeof getSupabase>

export const SLUG_COLLISION_CONSTRAINT = 'evites_slug_key'
export const BOOKING_COLLISION_CONSTRAINT = 'evites_booking_id_key'
export const MAX_SLUG_ATTEMPTS = 5

export type EnsureEviteOutcome =
  | { kind: 'created'; eviteId: string; slug: string }
  | { kind: 'exists'; eviteId: string; slug: string }
  | { kind: 'ineligible'; reason: string }
  | { kind: 'disabled'; reason: string }
  | { kind: 'unavailable'; reason: string }

interface LookupRow {
  id: string
  booking_id: string
  slug: string
  archived_at: string | null
}

interface PgLikeError {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
}

/** Which unique index did a 23505 come from? By NAME; the details text is the fallback. */
function uniqueViolationOf(err: PgLikeError | null | undefined): 'slug' | 'booking' | 'other' | null {
  if (!err || err.code !== '23505') return null
  const text = `${err.message ?? ''} ${err.details ?? ''}`
  if (text.includes(SLUG_COLLISION_CONSTRAINT)) return 'slug'
  if (text.includes(BOOKING_COLLISION_CONSTRAINT)) return 'booking'
  // PostgREST puts `Key (slug)=(…) already exists.` in details.
  if (/Key \(slug\)=/.test(text)) return 'slug'
  if (/Key \(booking_id\)=/.test(text)) return 'booking'
  return 'other'
}

async function findExisting(
  supabase: Supa,
  bookingId: string,
): Promise<{ kind: 'found'; row: LookupRow } | { kind: 'absent' } | { kind: 'unavailable'; reason: string }> {
  const { data, error } = await supabase
    .from('evites')
    .select(EVITE_LOOKUP_COLUMNS.join(', '))
    .eq('booking_id', bookingId)
    .maybeSingle<LookupRow>()
  if (error) return { kind: 'unavailable', reason: `evite lookup failed: ${error.message}` }
  if (data) return { kind: 'found', row: data }
  return { kind: 'absent' }
}

export async function ensureEviteForBooking(supabase: Supa, bookingId: string): Promise<EnsureEviteOutcome> {
  try {
    const mode = evitePagesMode()
    if (mode === 'off') return { kind: 'disabled', reason: 'EVITES_PAGES is off' }

    const { data: booking, error: bookingErr } = await supabase
      .from('bookings')
      .select(EVITE_BOOKING_COLUMNS.join(', '))
      .eq('id', bookingId)
      .maybeSingle<EviteBookingRow>()
    if (bookingErr) return { kind: 'unavailable', reason: `booking read failed: ${bookingErr.message}` }
    if (!booking) return { kind: 'ineligible', reason: 'booking not found' }

    if (mode === 'pilot' && !isPilotBooking(booking.booking_ref)) {
      return { kind: 'disabled', reason: 'pilot mode and not a pilot booking' }
    }

    if (!isEviteEligible(booking)) return { kind: 'ineligible', reason: 'party type or status not eligible' }

    const existing = await findExisting(supabase, bookingId)
    if (existing.kind === 'unavailable') return existing
    if (existing.kind === 'found') return { kind: 'exists', eviteId: existing.row.id, slug: existing.row.slug }

    // The slug names the theme, so read what the theme resolver needs. A failed read
    // is `unavailable` (the caller retries later), never a guess at the plain template.
    const inputs = await readThemeInputs(supabase, bookingId)
    if (inputs.kind === 'unavailable') return inputs

    const firstName = childNameOf(booking)
    const themeShort = resolveTheme(booking, inputs.lineItems, inputs.partyThemes).short

    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = makeSlug(firstName, themeShort)
      const { data: inserted, error: insertErr } = await supabase
        .from('evites')
        .insert({ booking_id: bookingId, slug })
        .select(EVITE_LOOKUP_COLUMNS.join(', '))
        .single<LookupRow>()

      if (!insertErr && inserted) return { kind: 'created', eviteId: inserted.id, slug: inserted.slug }

      const which = uniqueViolationOf(insertErr)
      if (which === 'slug') continue // another evite has this slug: mint again

      if (which === 'booking') {
        // Someone else created this booking's evite between our read and write.
        const again = await findExisting(supabase, bookingId)
        if (again.kind === 'found') return { kind: 'exists', eviteId: again.row.id, slug: again.row.slug }
        return {
          kind: 'unavailable',
          reason: again.kind === 'unavailable' ? again.reason : 'booking_id collision but no row on re-read',
        }
      }

      return { kind: 'unavailable', reason: `evite insert failed: ${insertErr?.message ?? 'no row returned'}` }
    }

    return { kind: 'unavailable', reason: `slug collided ${MAX_SLUG_ATTEMPTS} times` }
  } catch (e) {
    return { kind: 'unavailable', reason: `unexpected: ${e instanceof Error ? e.message : String(e)}` }
  }
}
