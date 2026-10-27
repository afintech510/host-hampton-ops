/**
 * Crew settings and switches.
 *
 * `loadCrewSettings` has THREE outcomes on purpose. A failed read of
 * `crew_settings` is not "use the defaults": the defaults are the launch
 * numbers, and a member's pay, a step reset and the launch grace are all
 * decided from this read. Rule 12 — "could not read it" is not "it says the
 * default" — so a caller that cannot read the settings stands down and says so.
 */

import type { getSupabase } from '@/lib/supabase'
import { ownerEmail } from '@/lib/ownerNotify'
import { settingsFromRows, type CrewSettings } from '@/lib/crew/rules'

type Supa = ReturnType<typeof getSupabase>

export type CrewSettingsLoad =
  | { kind: 'ok'; settings: CrewSettings; rows: { key: string; value: unknown; description: string | null }[] }
  | { kind: 'unavailable'; error: string }

export async function loadCrewSettings(supabase: Supa): Promise<CrewSettingsLoad> {
  const { data, error } = await supabase.from('crew_settings').select('key, value, description')
  if (error) return { kind: 'unavailable', error: error.message }
  const rows = (data ?? []) as { key: string; value: unknown; description: string | null }[]
  // Zero rows is not a configuration, it is a missing seed (migration 077 writes ten).
  if (rows.length === 0) return { kind: 'unavailable', error: 'crew_settings is empty' }
  return { kind: 'ok', settings: settingsFromRows(rows), rows }
}

/**
 * The crew side — `/crew`, crew login, every crew message — is OFF unless this
 * is exactly `true`. The admin pages and the booking reconcile are deliberately
 * NOT behind it, so Allie can set the roster up before anybody is invited.
 */
export function crewEnabled(): boolean {
  return process.env.CREW_ENABLED === 'true'
}

/**
 * The password-free test picker on `/crew/login`. OFF unless exactly `true`.
 *
 * The site is public, so this switch can never be a way to become a REAL crew
 * member: the picker lists, and `/api/crew/auth/test-login` signs in, only rows
 * with `is_test` (migration 079), and while this is on without `CREW_ENABLED`
 * the whole crew app admits test members only (`crewMemberMayEnter`).
 */
export function crewTestLoginEnabled(): boolean {
  return process.env.CREW_TEST_LOGIN === 'true'
}

/**
 * Is `/crew` reachable at all? With CREW_ENABLED it is open to the crew; with
 * only CREW_TEST_LOGIN it is open to the invented test members and nobody else.
 */
export function crewAppOpen(): boolean {
  return crewEnabled() || crewTestLoginEnabled()
}

/**
 * May this member use the crew app right now? The ONE answer, used by the
 * session check, both logins and the code mailer.
 *
 *   - active only: paused and removed members are out;
 *   - never the owner: Allie is a crew row so she can lead, not a login;
 *   - test-only mode (CREW_TEST_LOGIN without CREW_ENABLED): `is_test` only, so
 *     real crew stay out until Adam launches.
 */
export function crewMemberMayEnter(m: { status: string; is_owner: boolean; is_test: boolean }): boolean {
  if (!crewAppOpen()) return false
  if (m.status !== 'active' || m.is_owner) return false
  if (!crewEnabled() && !m.is_test) return false
  return true
}

/** Crew texts on the Quo line. Off unless exactly `true`; also needs the member's `sms_opt_in`. */
export function crewSmsEnabled(): boolean {
  return process.env.CREW_SMS_ENABLED === 'true'
}

/** Where Allie's crew alerts go. */
export function crewAdminEmail(): string {
  const v = (process.env.CREW_ADMIN_EMAIL || '').trim()
  return v || ownerEmail()
}
