/**
 * The Birthday Club side effects of an RSVP PATCH, as INJECTED functions
 * (spec §10). P06 stores the consent on the RSVP row (`club_opt_in_at`,
 * `opt_in_text_version`, `consent_ip`, `club_email`) and then calls these. They are
 * no-ops until P10 replaces them with `recordClubOptIn` / `recordClubOptOut` from
 * `lib/evites/club.ts` (contact link, Brevo list).
 *
 * Same contract as `rsvpHooks`: fired without awaiting, never throws. The consent
 * record is the RSVP row, so a failure here loses nothing the cron cannot retry
 * (`club_opt_in_at IS NOT NULL AND contact_id IS NULL`).
 */

import type { getSupabase } from '@/lib/supabase'

type Supa = ReturnType<typeof getSupabase>

export interface ClubOptInInput {
  email: string
  parentName: string
  birthdayMonth: number | null
  slug: string
  consentVersion: string
  rsvpId: string
}

export interface ClubOptOutInput {
  email: string | null
  rsvpId: string
}

export const clubHooks: {
  recordClubOptIn: (supabase: Supa, input: ClubOptInInput) => void | Promise<void>
  recordClubOptOut: (supabase: Supa, input: ClubOptOutInput) => void | Promise<void>
} = {
  recordClubOptIn: () => undefined,
  recordClubOptOut: () => undefined,
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
