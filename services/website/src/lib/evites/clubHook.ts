/**
 * The Birthday Club side effects of an RSVP PATCH, as INJECTABLE functions (spec §10). The RSVP PATCH stores
 * the consent on the RSVP row (`club_opt_in_at`, `opt_in_text_version`, `consent_ip`, `club_email`) and then
 * calls these. The defaults are `recordClubOptIn` / `recordClubOptOut` from `lib/evites/club.ts` (contact
 * link, Brevo list); tests replace them.
 *
 * Same contract as `rsvpHooks`: fired without awaiting, never throws. The consent record is the RSVP row,
 * so a failure here loses nothing the cron cannot retry
 * (`club_opt_in_at IS NOT NULL AND contact_id IS NULL`, `retryClubLinks`).
 */

import type { getSupabase } from '@/lib/supabase'
import { recordClubOptIn, recordClubOptOut, type ClubOptInInput, type ClubOptOutInput } from '@/lib/evites/club'

export type { ClubOptInInput, ClubOptOutInput }

type Supa = ReturnType<typeof getSupabase>

export const clubHooks: {
  recordClubOptIn: (supabase: Supa, input: ClubOptInInput) => void | Promise<void>
  recordClubOptOut: (supabase: Supa, input: ClubOptOutInput) => void | Promise<void>
} = {
  recordClubOptIn: async (supabase, input) => {
    await recordClubOptIn(supabase, input)
  },
  recordClubOptOut: async (supabase, input) => {
    await recordClubOptOut(supabase, input)
  },
}

function swallow(name: string, out: void | Promise<void>): void {
  if (out && typeof (out as Promise<void>).catch === 'function') {
    ;(out as Promise<void>).catch((e) => console.error(`evites/clubHook: ${name} failed: ${e instanceof Error ? e.message : String(e)}`))
  }
}

export function fireClubOptIn(supabase: Supa, input: ClubOptInInput): void {
  try {
    swallow('recordClubOptIn', clubHooks.recordClubOptIn(supabase, input))
  } catch (e) {
    console.error(`evites/clubHook: recordClubOptIn failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export function fireClubOptOut(supabase: Supa, input: ClubOptOutInput): void {
  try {
    swallow('recordClubOptOut', clubHooks.recordClubOptOut(supabase, input))
  } catch (e) {
    console.error(`evites/clubHook: recordClubOptOut failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}
