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
  return { kind: 'ok', settings: settingsFromRows(rows, { ladderEnabled: crewPayLadderEnabled(), showPay: crewShowPayEnabled() }), rows }
}

/**
 * The pay "game" — steps going up with every party worked and down or back to
 * the start on a cancel or no-show. OFF unless exactly `true` (Adam, 2026-11-04:
 * "initial launch just staff scheduling"). With it off no step ever moves and the
 * crew app says nothing about rates changing; the code and the ledger stay.
 */
export function crewPayLadderEnabled(): boolean {
  return process.env.CREW_PAY_LADDER === 'true'
}

/** Dollar figures anywhere in the crew app or a crew message. OFF unless exactly `true` (or the ladder is on). */
export function crewShowPayEnabled(): boolean {
  return process.env.CREW_SHOW_PAY === 'true'
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
 * Onboarding-only door. OFF unless exactly `true`. With it on, REAL members can
 * sign in (phone or email code) but land ONLY on `/crew/onboarding` and
 * `/crew/profile`: the board, parties and pay stay closed until CREW_ENABLED.
 * That keeps the unpublished draft parties and test mode safe while the roster
 * is set up and the agreements are signed.
 */
export function crewOnboardingEnabled(): boolean {
  return process.env.CREW_ONBOARDING_ENABLED === 'true'
}

/**
 * Is `/crew` reachable at all? With CREW_ENABLED it is open to the crew; with
 * only CREW_TEST_LOGIN it is open to the invented test members; with only
 * CREW_ONBOARDING_ENABLED it is open to real members for onboarding pages only.
 */
export function crewAppOpen(): boolean {
  return crewEnabled() || crewTestLoginEnabled() || crewOnboardingEnabled()
}

/** Which part of the crew app: the board and everything on it, or only the onboarding + profile pages. */
export type CrewScope = 'app' | 'onboarding'

/**
 * May this member use the crew app right now? The ONE answer, used by the
 * session check, both logins and the code mailer.
 *
 *   - active only: paused and removed members are out;
 *   - never the owner: Allie is a crew row so she can lead, not a login;
 *   - scope 'app' in test-only mode (CREW_TEST_LOGIN without CREW_ENABLED):
 *     `is_test` only, so real crew stay out until Adam launches;
 *   - scope 'onboarding' also admits real members while CREW_ONBOARDING_ENABLED.
 */
export function crewMemberMayEnter(m: { status: string; is_owner: boolean; is_test: boolean }, scope: CrewScope = 'app'): boolean {
  if (!crewAppOpen()) return false
  if (m.status !== 'active' || m.is_owner) return false
  if (scope === 'onboarding' && crewOnboardingEnabled()) return true
  if (!crewEnabled() && !m.is_test) return false
  return true
}

/**
 * Is signing the subcontractor agreement part of onboarding? OFF unless exactly
 * `true` (Adam, 2026-11-05: tabled until after the MVP launch). While off,
 * onboarding is finished when the details, a confirmed email and the text
 * choice are done; the agreement step is hidden and `/api/crew/me/agreement`
 * answers 404 without creating a SignWell document. Everything else about the
 * agreement (text, PDF, webhook writer, version) stays built and tested.
 */
export function crewAgreementRequired(): boolean {
  return process.env.CREW_AGREEMENT_REQUIRED === 'true'
}

/** The agreement version a member must have signed. Raising it sends everyone back through the agreement step. */
export function crewAgreementVersion(): string {
  const v = (process.env.CREW_AGREEMENT_VERSION || '').trim()
  return v || 'v1'
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
