/**
 * The Birthday Club (spec §10): what happens after a guest ticks the club box on screen 3.
 *
 * THE CONSENT RECORD IS THE RSVP ROW (`club_opt_in_at`, `opt_in_text_version`, `consent_ip`, `club_email`),
 * written by the RSVP PATCH before this module runs. Everything here is a side effect that can be retried.
 *
 * `recordClubOptIn`
 *   1. `findContactsByEmail` -> found (primary = OLDEST) / absent / unavailable.
 *   2. found       link `evite_rsvps.contact_id` and write NOTHING to the contact: no name, no source,
 *                  no opt-in. ZERO `contacts` updates.
 *   3. absent      INSERT { email as typed, first/last name from the parent's name, source 'evite',
 *                  source_detail 'evite:<slug>', status 'lead', email_opt_in false, sms_opt_in false }.
 *                  A 23505 means another writer got there first: re-find and take branch 2.
 *   4. unavailable leave it. The RSVP is saved, `contact_id` stays NULL, and `retryClubLinks` (cron)
 *                  picks it up.
 *   5. Brevo       POST /v3/contacts { email: lowercased, updateEnabled: true, listIds: [club list] }.
 *                  Unset list id: skip and log. NEVER list 3 (the promotional list). NEVER Quo.
 *                  NEVER `emailBlacklisted`: an address that unsubscribed at Brevo stays blacklisted.
 *
 * WHY NOT `upsertContact`: it renames a real person, sets opt-ins, mirrors into Brevo/Quo and enrols a
 * sequence. A club member must not be swept into promotional sequences or list-3 campaigns that read
 * `optedOutReason` (`contacts.email_opt_in` stays false). Tripwire E4 fails the suite if this file imports it.
 *
 * `recordClubOptOut` removes the address from the club list (lowercased). `club_opted_out_at` is written by
 * the RSVP PATCH itself, in the same UPDATE that records the request.
 *
 * Never throws: a failure is a returned outcome and a log line with no address in it.
 */

import type { getSupabase } from '@/lib/supabase'
import { removeFromList, upsertListMember } from '@/lib/brevo'
import { findContactsByEmail, isPlausibleEmailAddress } from '@/lib/contactLookup'
import { DAY_MS } from '@/lib/rateLimit'

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

/** The Brevo list that is the promotional list. The club must never touch it. */
export const PROMOTIONAL_LIST_ID = 3

export type ClubContactOutcome = 'linked' | 'created' | 'unavailable' | 'invalid'
export type ClubBrevoOutcome = 'listed' | 'skipped' | 'failed' | 'not-attempted'

export interface ClubOptInResult {
  contact: ClubContactOutcome
  brevo: ClubBrevoOutcome
}

/** `BREVO_BIRTHDAY_CLUB_LIST_ID` as a usable list id, or null (unset, junk, or the promotional list). */
export function clubListId(): number | null {
  const raw = (process.env.BREVO_BIRTHDAY_CLUB_LIST_ID ?? '').trim()
  if (!/^[0-9]+$/.test(raw)) return null
  const id = Number(raw)
  if (!Number.isSafeInteger(id) || id <= 0) return null
  if (id === PROMOTIONAL_LIST_ID) {
    console.error('evites/club: BREVO_BIRTHDAY_CLUB_LIST_ID is the promotional list; refusing to use it')
    return null
  }
  return id
}

/** "Mia's Mom Jones" -> first 'Mia's', last 'Mom Jones'. One word -> last is null. */
export function splitParentName(parentName: string): { first_name: string | null; last_name: string | null } {
  const parts = String(parentName ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first_name: null, last_name: null }
  return { first_name: parts[0], last_name: parts.length > 1 ? parts.slice(1).join(' ') : null }
}

type LinkedContact = { kind: 'linked' | 'created'; contactId: string } | { kind: 'unavailable' }

/** Steps 1-3 and 4: resolve the contact row for this address, creating it only when it is truly absent. */
async function resolveContact(supabase: Supa, email: string, parentName: string, slug: string): Promise<LinkedContact> {
  const first = await findContactsByEmail(supabase, email, 'id, email')
  if (first.kind === 'found') return { kind: 'linked', contactId: first.primary.id }
  if (first.kind === 'unavailable') {
    console.error(`evites/club: contact lookup unavailable: ${first.error}`)
    return { kind: 'unavailable' }
  }

  const { data, error } = await supabase
    .from('contacts')
    .insert({
      email,
      ...splitParentName(parentName),
      source: 'evite',
      source_detail: `evite:${slug}`,
      status: 'lead',
      email_opt_in: false,
      sms_opt_in: false,
    })
    .select('id')
    .single()
  if (!error && data && typeof (data as { id?: unknown }).id === 'string') {
    return { kind: 'created', contactId: (data as { id: string }).id }
  }
  if (error && error.code === '23505') {
    // Another writer inserted this person between our read and our write: they ARE the contact now.
    const again = await findContactsByEmail(supabase, email, 'id, email')
    if (again.kind === 'found') return { kind: 'linked', contactId: again.primary.id }
    console.error('evites/club: 23505 on insert but the re-find did not find the contact')
    return { kind: 'unavailable' }
  }
  console.error(`evites/club: contact insert failed: ${error?.message ?? 'no row returned'}`)
  return { kind: 'unavailable' }
}

export async function recordClubOptIn(supabase: Supa, input: ClubOptInInput): Promise<ClubOptInResult> {
  const email = String(input.email ?? '').trim()
  if (!isPlausibleEmailAddress(email)) {
    console.error('evites/club: refusing an implausible club address')
    return { contact: 'invalid', brevo: 'not-attempted' }
  }

  const resolved = await resolveContact(supabase, email, input.parentName, input.slug)
  if (resolved.kind === 'unavailable') return { contact: 'unavailable', brevo: 'not-attempted' }

  const { error: linkError } = await supabase.from('evite_rsvps').update({ contact_id: resolved.contactId }).eq('id', input.rsvpId)
  if (linkError) {
    console.error(`evites/club: could not link the RSVP to its contact: ${linkError.message}`)
    return { contact: 'unavailable', brevo: 'not-attempted' }
  }

  const listId = clubListId()
  if (listId === null) {
    console.error('evites/club: BREVO_BIRTHDAY_CLUB_LIST_ID is not usable; skipping the Brevo list add')
    return { contact: resolved.kind, brevo: 'skipped' }
  }
  const added = await upsertListMember(email, listId)
  return { contact: resolved.kind, brevo: added.kind === 'listed' ? 'listed' : 'failed' }
}

export async function recordClubOptOut(_supabase: Supa, input: ClubOptOutInput): Promise<{ brevo: ClubBrevoOutcome }> {
  const email = String(input.email ?? '').trim()
  if (!email) return { brevo: 'not-attempted' }
  const listId = clubListId()
  if (listId === null) {
    console.error('evites/club: BREVO_BIRTHDAY_CLUB_LIST_ID is not usable; skipping the Brevo list removal')
    return { brevo: 'skipped' }
  }
  const removed = await removeFromList(email, listId)
  return { brevo: removed === true ? 'listed' : 'failed' }
}

/* ── the cron retry (spec §10 step 1 "unavailable") ───────────── */

/** Opted-in RSVPs retried per tick. Newest first, so one poisoned old row can never starve the rest. */
export const CLUB_RETRY_PER_TICK = 10
/** An RSVP whose club opt-in is older than this is no longer retried. */
export const CLUB_RETRY_LOOKBACK_DAYS = 30

export interface ClubRetryReport {
  candidates: number
  linked: number
  created: number
  unavailable: number
  invalid: number
  brevoFailed: number
  readFailed: boolean
}

export const emptyClubRetryReport = (): ClubRetryReport => ({
  candidates: 0,
  linked: 0,
  created: 0,
  unavailable: 0,
  invalid: 0,
  brevoFailed: 0,
  readFailed: false,
})

interface RetryRow {
  id: string
  evite_id: string
  parent_name: string | null
  club_email: string | null
  birthday_month: number | null
  opt_in_text_version: string | null
}

/**
 * Re-run `recordClubOptIn` for RSVPs that opted in and were never linked:
 * `club_opt_in_at IS NOT NULL AND contact_id IS NULL AND club_opted_out_at IS NULL`.
 * Bounded (`CLUB_RETRY_PER_TICK`, `CLUB_RETRY_LOOKBACK_DAYS`); the report is counts only.
 */
export async function retryClubLinks(supabase: Supa, opts: { now?: Date } = {}): Promise<ClubRetryReport> {
  const rep = emptyClubRetryReport()
  const since = new Date((opts.now ?? new Date()).getTime() - CLUB_RETRY_LOOKBACK_DAYS * DAY_MS).toISOString()
  const r = await supabase
    .from('evite_rsvps')
    .select('id, evite_id, parent_name, club_email, birthday_month, opt_in_text_version')
    .not('club_opt_in_at', 'is', null)
    .is('contact_id', null)
    .is('club_opted_out_at', null)
    .gte('club_opt_in_at', since)
    .order('club_opt_in_at', { ascending: false })
    .limit(CLUB_RETRY_PER_TICK)
  if (r.error) {
    rep.readFailed = true
    console.error(`evites/club: retry read failed: ${r.error.message}`)
    return rep
  }
  const rows = (r.data ?? []) as unknown as RetryRow[]
  rep.candidates = rows.length
  if (rows.length === 0) return rep

  const ids = Array.from(new Set(rows.map((x) => x.evite_id)))
  const ev = await supabase.from('evites').select('id, slug').in('id', ids)
  if (ev.error) {
    rep.readFailed = true
    console.error(`evites/club: retry slug read failed: ${ev.error.message}`)
    return rep
  }
  const slugs = new Map(((ev.data ?? []) as unknown as Array<{ id: string; slug: string }>).map((e) => [e.id, e.slug]))

  for (const row of rows) {
    const slug = slugs.get(row.evite_id)
    if (!slug || !row.club_email || !row.opt_in_text_version) {
      rep.invalid += 1
      continue
    }
    const out = await recordClubOptIn(supabase, {
      email: row.club_email,
      parentName: row.parent_name ?? '',
      birthdayMonth: row.birthday_month,
      slug,
      consentVersion: row.opt_in_text_version,
      rsvpId: row.id,
    })
    if (out.contact === 'linked') rep.linked += 1
    else if (out.contact === 'created') rep.created += 1
    else if (out.contact === 'invalid') rep.invalid += 1
    else rep.unavailable += 1
    if (out.brevo === 'failed') rep.brevoFailed += 1
  }
  return rep
}
