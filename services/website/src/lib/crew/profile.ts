/**
 * Crew onboarding profile (migration 082). Server code only.
 *
 * `crew_member_profiles` holds what a crew member tells us about themselves
 * (legal name, birthday, home address, emergency contact) and the record of
 * the subcontractor agreement. It is a separate table from `crew_members` on
 * purpose: every crew-facing route selects from `crew_members`, and none of
 * them may ever hand out a profile column. The ONLY readers are:
 *
 *   - `readOwnProfile`    — a member's own row, as the allow-listed `ownProfileView`;
 *   - `readProfileForAdmin` — the audited admin read (the route writes the
 *     `crew_events` row that records who looked);
 *   - `getOnboardingState` — three non-PII columns, for the gate.
 *
 * There are NO tax-id columns and there never will be: W-9s are handled at
 * year end, outside the app.
 *
 * A read has three outcomes (the house rule): `unavailable` is never folded
 * into "nothing there".
 */

import type { getSupabase } from '@/lib/supabase'
import { crewAgreementVersion } from '@/lib/crew/settings'
import type { CrewMemberRow, Read } from '@/lib/crew/db'
import { normalizePhoneKey } from '@/lib/contactLookup'
import { etDateString } from '@/lib/partyTime'

type Supa = ReturnType<typeof getSupabase>

export const MIN_AGE_YEARS = 18

const PROFILE_COLUMNS =
  'member_id, legal_first_name, legal_last_name, preferred_name, date_of_birth, address_line1, address_line2, city, state, zip, ' +
  'emergency_name, emergency_relationship, emergency_phone, onboarding_completed_at, agreement_document_id, agreement_version, ' +
  'agreement_sent_at, agreement_signed_at, created_at, updated_at'

export interface ProfileRow {
  member_id: string
  legal_first_name: string | null
  legal_last_name: string | null
  preferred_name: string | null
  date_of_birth: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip: string | null
  emergency_name: string | null
  emergency_relationship: string | null
  emergency_phone: string | null
  onboarding_completed_at: string | null
  agreement_document_id: string | null
  agreement_version: string | null
  agreement_sent_at: string | null
  agreement_signed_at: string | null
  created_at: string
  updated_at: string
}

/* ── Who has to onboard ─────────────────────────────────────────────────── */

/**
 * Does this member have to finish onboarding before the board opens?
 * Everyone but the owner — except the invented test members, who have no phone
 * (that is how they are told apart from a real person exercising the path: a
 * test member with a phone is a test of the real flow).
 */
export function onboardingRequired(m: Pick<CrewMemberRow, 'is_owner' | 'is_test' | 'phone'>): boolean {
  if (m.is_owner) return false
  if (m.is_test && !m.phone) return false
  return true
}

export interface OnboardingState {
  required: boolean
  /** Profile row exists: they have signed in and opened the form. */
  started: boolean
  profileDone: boolean
  agreementSigned: boolean
  /** Agreement signed AND it is the current version. */
  agreementCurrent: boolean
  /** Required and not yet fully done. */
  incomplete: boolean
}

export function onboardingStateFrom(
  m: Pick<CrewMemberRow, 'is_owner' | 'is_test' | 'phone'>,
  p: Pick<ProfileRow, 'onboarding_completed_at' | 'agreement_signed_at' | 'agreement_version'> | null,
  currentVersion = crewAgreementVersion(),
): OnboardingState {
  const required = onboardingRequired(m)
  const profileDone = !!p?.onboarding_completed_at
  const agreementSigned = !!p?.agreement_signed_at
  const agreementCurrent = agreementSigned && p?.agreement_version === currentVersion
  return {
    required,
    started: !!p,
    profileDone,
    agreementSigned,
    agreementCurrent,
    incomplete: required && !(profileDone && agreementCurrent),
  }
}

export async function getOnboardingState(sb: Supa, m: CrewMemberRow): Promise<Read<OnboardingState>> {
  if (!onboardingRequired(m)) return { kind: 'ok', data: onboardingStateFrom(m, null) }
  const { data, error } = await sb
    .from('crew_member_profiles')
    .select('onboarding_completed_at, agreement_signed_at, agreement_version')
    .eq('member_id', m.id)
    .maybeSingle()
  if (error) return { kind: 'unavailable', error: error.message }
  return { kind: 'ok', data: onboardingStateFrom(m, (data ?? null) as Pick<ProfileRow, 'onboarding_completed_at' | 'agreement_signed_at' | 'agreement_version'> | null) }
}

/* ── Reads ──────────────────────────────────────────────────────────────── */

export async function readOwnProfile(sb: Supa, memberId: string): Promise<Read<ProfileRow | null>> {
  const { data, error } = await sb.from('crew_member_profiles').select(PROFILE_COLUMNS).eq('member_id', memberId).maybeSingle()
  if (error) return { kind: 'unavailable', error: error.message }
  return { kind: 'ok', data: (data ?? null) as unknown as ProfileRow | null }
}

/** The audited admin read. The route that calls this writes the `crew_events` row. */
export async function readProfileForAdmin(sb: Supa, memberId: string): Promise<Read<ProfileRow | null>> {
  return readOwnProfile(sb, memberId)
}

/** Create the row on first sign-in so "signed in" is a fact the admin view can show. */
export async function ensureProfileRow(sb: Supa, memberId: string): Promise<Read<null>> {
  const { error } = await sb.from('crew_member_profiles').upsert({ member_id: memberId }, { onConflict: 'member_id', ignoreDuplicates: true })
  if (error) return { kind: 'unavailable', error: error.message }
  return { kind: 'ok', data: null }
}

/**
 * What the member's own browser may see of their profile — an ALLOW-LIST, so a
 * column added later is private until someone decides otherwise. The agreement
 * document id is NOT here (the signed PDF is fetched on demand by an admin).
 */
export function ownProfileView(p: ProfileRow | null) {
  return {
    legalFirstName: p?.legal_first_name ?? '',
    legalLastName: p?.legal_last_name ?? '',
    preferredName: p?.preferred_name ?? '',
    dateOfBirth: p?.date_of_birth ?? '',
    addressLine1: p?.address_line1 ?? '',
    addressLine2: p?.address_line2 ?? '',
    city: p?.city ?? '',
    state: p?.state ?? '',
    zip: p?.zip ?? '',
    emergencyName: p?.emergency_name ?? '',
    emergencyRelationship: p?.emergency_relationship ?? '',
    emergencyPhone: p?.emergency_phone ?? '',
    profileDone: !!p?.onboarding_completed_at,
    agreementSigned: !!p?.agreement_signed_at,
  }
}

/* ── Screening ──────────────────────────────────────────────────────────── */

export type Screened<T> = { ok: true; value: T } | { ok: false; error: string }

const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ɏ][A-Za-zÀ-ÖØ-öø-ɏ'’. -]{0,59}$/

function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

export function screenName(v: unknown, label: string, opts: { required?: boolean } = { required: true }): Screened<string> {
  const t = cleanText(v, 60)
  if (!t) return opts.required === false ? { ok: true, value: '' } : { ok: false, error: `${label} is required.` }
  if (!NAME_RE.test(t)) return { ok: false, error: `${label}: letters only, please.` }
  return { ok: true, value: t }
}

/** Whole years between a YYYY-MM-DD birthday and a YYYY-MM-DD "today". */
export function ageOn(dob: string, today: string): number {
  const [by, bm, bd] = dob.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  let age = ty - by
  if (tm < bm || (tm === bm && td < bd)) age -= 1
  return age
}

export function screenDateOfBirth(v: unknown, now = new Date()): Screened<string> {
  const t = typeof v === 'string' ? v.trim() : ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (!m) return { ok: false, error: 'Enter your birthday as a date.' }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const probe = new Date(Date.UTC(y, mo - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return { ok: false, error: 'That birthday is not a real date.' }
  }
  const today = etDateString(now)
  if (t > today) return { ok: false, error: 'That birthday is in the future.' }
  const age = ageOn(t, today)
  if (age > 100) return { ok: false, error: 'Check the year of your birthday.' }
  if (age < MIN_AGE_YEARS) return { ok: false, error: `You need to be ${MIN_AGE_YEARS} or older to join the crew.` }
  return { ok: true, value: t }
}

const STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '))

export function screenPhone(v: unknown, label: string): Screened<string> {
  const key = normalizePhoneKey(v)
  if (!key || !/^[2-9]\d{9}$/.test(key)) return { ok: false, error: `${label}: a 10-digit US phone number.` }
  return { ok: true, value: `+1${key}` }
}

export interface ProfileInput {
  legal_first_name: string
  legal_last_name: string
  preferred_name: string | null
  date_of_birth: string
  address_line1: string
  address_line2: string | null
  city: string
  state: string
  zip: string
  emergency_name: string
  emergency_relationship: string
  emergency_phone: string
}

/** Everything the "About you" and "Emergency contact" steps collect. */
export function screenProfileInput(body: Record<string, unknown>, now = new Date()): Screened<ProfileInput> {
  const first = screenName(body.legalFirstName, 'Legal first name')
  if (!first.ok) return first
  const last = screenName(body.legalLastName, 'Legal last name')
  if (!last.ok) return last
  const pref = screenName(body.preferredName, 'Preferred name', { required: false })
  if (!pref.ok) return pref
  const dob = screenDateOfBirth(body.dateOfBirth, now)
  if (!dob.ok) return dob

  const line1 = cleanText(body.addressLine1, 120)
  if (line1.length < 3) return { ok: false, error: 'Home address is required.' }
  const line2 = cleanText(body.addressLine2, 60)
  const city = cleanText(body.city, 60)
  if (!city) return { ok: false, error: 'City is required.' }
  const state = cleanText(body.state, 2).toUpperCase()
  if (!STATES.has(state)) return { ok: false, error: 'State: a two-letter US state, like NY.' }
  const zip = cleanText(body.zip, 10)
  if (!/^\d{5}$/.test(zip)) return { ok: false, error: 'ZIP: five digits.' }

  const eName = screenName(body.emergencyName, 'Emergency contact name')
  if (!eName.ok) return eName
  const eRel = cleanText(body.emergencyRelationship, 40)
  if (!eRel) return { ok: false, error: 'Emergency contact relationship is required (for example, mom).' }
  const ePhone = screenPhone(body.emergencyPhone, 'Emergency contact phone')
  if (!ePhone.ok) return ePhone

  return {
    ok: true,
    value: {
      legal_first_name: first.value, legal_last_name: last.value, preferred_name: pref.value || null,
      date_of_birth: dob.value, address_line1: line1, address_line2: line2 || null, city, state, zip,
      emergency_name: eName.value, emergency_relationship: eRel, emergency_phone: ePhone.value,
    },
  }
}

/** What `/crew/profile` lets a member change after the agreement is signed: NOT legal name or birthday. */
export function screenProfileEdit(body: Record<string, unknown>): Screened<Partial<ProfileInput>> {
  const line1 = cleanText(body.addressLine1, 120)
  if (line1.length < 3) return { ok: false, error: 'Home address is required.' }
  const city = cleanText(body.city, 60)
  if (!city) return { ok: false, error: 'City is required.' }
  const state = cleanText(body.state, 2).toUpperCase()
  if (!STATES.has(state)) return { ok: false, error: 'State: a two-letter US state, like NY.' }
  const zip = cleanText(body.zip, 10)
  if (!/^\d{5}$/.test(zip)) return { ok: false, error: 'ZIP: five digits.' }
  const eName = screenName(body.emergencyName, 'Emergency contact name')
  if (!eName.ok) return eName
  const eRel = cleanText(body.emergencyRelationship, 40)
  if (!eRel) return { ok: false, error: 'Emergency contact relationship is required.' }
  const ePhone = screenPhone(body.emergencyPhone, 'Emergency contact phone')
  if (!ePhone.ok) return ePhone
  const pref = screenName(body.preferredName, 'Preferred name', { required: false })
  if (!pref.ok) return pref
  return {
    ok: true,
    value: {
      preferred_name: pref.value || null, address_line1: line1, address_line2: cleanText(body.addressLine2, 60) || null,
      city, state, zip, emergency_name: eName.value, emergency_relationship: eRel, emergency_phone: ePhone.value,
    },
  }
}

/* ── Writes ─────────────────────────────────────────────────────────────── */

/**
 * Save the About-you + Emergency steps. Does NOT complete onboarding: that
 * needs a confirmed email too, and is `completeOnboarding`'s call.
 */
export async function saveProfile(sb: Supa, memberId: string, input: ProfileInput): Promise<Read<null>> {
  const row: Record<string, unknown> = { member_id: memberId, ...input, updated_at: new Date().toISOString() }
  const { error } = await sb.from('crew_member_profiles').upsert(row, { onConflict: 'member_id' })
  if (error) return { kind: 'unavailable', error: error.message }
  return { kind: 'ok', data: null }
}

/** Has the member signed the agreement at all (any version)? What locks their legal name and birthday. */
export function agreementIsSigned(p: Pick<ProfileRow, 'agreement_signed_at'> | null): boolean {
  return !!p?.agreement_signed_at
}

/** Signed AND it is the version we require now. */
export function agreementIsCurrent(p: Pick<ProfileRow, 'agreement_signed_at' | 'agreement_version'> | null, version = crewAgreementVersion()): boolean {
  return !!p?.agreement_signed_at && p.agreement_version === version
}

/** Is every About-you / Emergency field present? */
export function profileIsFilled(p: ProfileRow | null): boolean {
  if (!p) return false
  return !!(p.legal_first_name && p.legal_last_name && p.date_of_birth && p.address_line1 && p.city && p.state && p.zip &&
    p.emergency_name && p.emergency_relationship && p.emergency_phone)
}

export type CompleteResult =
  | { kind: 'completed' }
  | { kind: 'incomplete'; missing: 'profile' | 'email' }
  | { kind: 'unavailable'; error: string }

/**
 * Finish the pre-agreement steps: fields filled, an email on file (confirmed by
 * code), and the text choice recorded. The text opt-in is an explicit
 * checkbox; unticked is a recorded "no", not a silent default.
 */
export async function completeOnboarding(
  sb: Supa, member: Pick<CrewMemberRow, 'id' | 'email' | 'phone'>, smsOptIn: boolean,
): Promise<CompleteResult> {
  const read = await readOwnProfile(sb, member.id)
  if (read.kind !== 'ok') return read
  if (!profileIsFilled(read.data)) return { kind: 'incomplete', missing: 'profile' }
  if (!member.email) return { kind: 'incomplete', missing: 'email' }

  const now = new Date().toISOString()
  const { error } = await sb.from('crew_member_profiles')
    .update({ onboarding_completed_at: read.data!.onboarding_completed_at ?? now, updated_at: now })
    .eq('member_id', member.id).select('member_id')
  if (error) return { kind: 'unavailable', error: error.message }

  const optIn = smsOptIn && !!member.phone
  const { error: mErr } = await sb.from('crew_members')
    .update(optIn ? { sms_opt_in: true, sms_opt_in_at: now, updated_by: 'self' } : { sms_opt_in: false, sms_opt_in_at: null, updated_by: 'self' })
    .eq('id', member.id).select('id')
  if (mErr) return { kind: 'unavailable', error: mErr.message }
  return { kind: 'completed' }
}

export async function saveProfileEdit(sb: Supa, memberId: string, patch: Partial<ProfileInput>): Promise<Read<null>> {
  const { data, error } = await sb.from('crew_member_profiles')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('member_id', memberId).select('member_id')
  if (error) return { kind: 'unavailable', error: error.message }
  if ((data ?? []).length === 0) return { kind: 'unavailable', error: 'no profile row' }
  return { kind: 'ok', data: null }
}
