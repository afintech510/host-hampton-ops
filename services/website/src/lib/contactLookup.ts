/**
 * Finding a contact by email address, the way every caller actually means it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS. `contacts.email` is plain `text` with a unique index on the
 * raw value, and the rows in it are whatever the customer typed. Measured in
 * production on 2026-09-12: **1216 contacts have an email address and 21 of them
 * are not lowercase** — `BON…@GMAIL.COM`, `Kel…@yahoo.com`, `Nit…@gmail.com`.
 * **Seven of those 21 are on an ACTIVE sequence enrollment**, which is to say
 * they are exactly the people the sequencer will mail the moment its cron is
 * rescheduled.
 *
 * Every system that tells us about an opt-out hands back a LOWERCASED address:
 *
 *   - `lib/unsubscribeLink.ts` signs `email.trim().toLowerCase()`, deliberately,
 *     so `Foo@Bar.com` and `foo@bar.com` cannot be two tokens for one person;
 *   - Brevo normalises addresses and posts them back lowercase.
 *
 * Both then looked the address up with `.eq('email', …)`, which is
 * case-SENSITIVE in Postgres. For those 21 people the row was never found:
 *
 *   - the one-click unsubscribe answered **200 with a cheerful confirmation**
 *     and wrote nothing at all — a guardrail that says it stopped something it
 *     did not stop, which is the other half of hard-won rule 10, on the one
 *     surface where getting it wrong is a CAN-SPAM complaint;
 *   - a Brevo `unsubscribed` or `hardBounce` event updated zero rows, so
 *     `contacts.email_opt_in` — the first thing `optedOutReason()` reads —
 *     never learned about it either.
 *
 * The fix is a case-insensitive lookup and NOT a rewrite of the stored data:
 * lowercasing 21 rows risks a collision against `contacts_email_key` and does
 * nothing about the 22nd address somebody types tomorrow.
 *
 * `ilike` is used to get the candidates cheaply and is NOT trusted to be the
 * answer: PostgREST passes the pattern straight to LIKE, where `_` matches any
 * single character and `*` is rewritten to `%`. `first_last@gmail.com` would
 * therefore also match `firstXlast@gmail.com` — a stranger. Every candidate is
 * re-compared in JS, and callers update by `id`, never by the email filter.
 */

import type { getSupabase } from '@/lib/supabase'
import { orIlikeFilter } from '@/lib/postgrestFilter'

type Supa = ReturnType<typeof getSupabase>

/**
 * Is this string shaped like an email address at all?
 *
 * Written down once because it was written down three times — `/api/checkin`
 * carried this exact regex, `/api/portal/email-auth/request` accepted anything
 * containing an `@` that was five characters long, and `/verify` accepted
 * anything containing an `@`. The loosest of the three is the one that decided
 * what went into a session cookie, and `%@gmail.com` passed it (rule 11: a
 * concept defined three times is a concept nothing is checking).
 *
 * Deliberately NOT an attempt at RFC 5322. It refuses whitespace, refuses the
 * LIKE metacharacters `%` and `_` **in the domain**, requires a dot in the
 * domain, and bounds the length. `_` is legal and common in a local part
 * (`first_last@gmail.com`), so it is allowed there and the exact re-compare in
 * the lookups below is what makes that safe.
 */
export function isPlausibleEmailAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const email = value.trim()
  if (email.length < 5 || email.length > 254) return false
  if (/[\s%]/.test(email)) return false
  const at = email.indexOf('@')
  if (at <= 0 || at !== email.lastIndexOf('@')) return false
  const domain = email.slice(at + 1)
  if (!/^[A-Za-z0-9.-]+$/.test(domain)) return false
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return false
  return true
}

export interface ContactByEmail {
  id: string
  email: string | null
  email_opt_in?: boolean | null
  status?: string | null
  created_at?: string | null
}

export type ContactEmailLookup =
  | {
      kind: 'found'
      /** Oldest row first. See `CANONICAL_ROW_RULE`. */
      contacts: ContactByEmail[]
      /**
       * The one row that IS this person, for a caller that can only hold one.
       * Always `contacts[0]`; named so a caller cannot accidentally mean
       * "whichever row Postgres happened to return".
       */
      primary: ContactByEmail
    }
  | { kind: 'absent' }
  /** Rule 12: "could not read" is not "there is nobody by that name". */
  | { kind: 'unavailable'; error: string }

/**
 * WHICH ROW IS THE PERSON, when there is more than one.
 *
 * `contacts_email_key` is unique on the RAW value, so `Foo@x.com` and
 * `foo@x.com` are two rows, and on 2026-09-12 **eight real people had exactly
 * that** (`docs/contact-identity-review.md` §1). A caller that takes
 * `contacts[0]` off an unordered PostgREST read is taking whichever row
 * happened to be earlier in the heap — measured live, that is the lowercase row
 * for `jeberhardt517@` (ctid 16,5 before 17,19) and the MIXED-case row for
 * `haleybelmonte94@` (9,12 before 10,9). Two callers can therefore disagree
 * about who somebody is, in the same request, for no reason anybody can see.
 *
 * **Oldest row wins.** It is deterministic, it is what `lib/reminders.ts` had
 * already decided for itself (rule 11 — that decision now lives here, once),
 * and measured against the eight real pairs it picks the row carrying the
 * history in seven of eight cases: the `customer` row with the lifetime value,
 * the row the bookings' `contact_id` points at, the row holding the
 * `contact_interactions`.
 *
 * It is a tie-break, NOT a merge. Merging the eight pairs touches eighteen
 * foreign keys and is needs-Adam 31.
 */
export const CANONICAL_ROW_RULE = 'oldest created_at wins' as const

/**
 * Every contact row whose email equals `email`, compared case-insensitively,
 * **oldest first**.
 *
 * `columns` lets a caller ask for more than the defaults; `email` and
 * `created_at` are appended if absent, because the exact re-compare needs the
 * first and the canonical-row rule needs the second — a caller that omitted
 * either would silently get an unordered list, which is the defect this
 * function exists to remove.
 */
export async function findContactsByEmail(
  supabase: Supa,
  email: string,
  columns = 'id, email, email_opt_in, status'
): Promise<ContactEmailLookup> {
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized) return { kind: 'absent' }

  const select = withColumns(columns, ['email', 'created_at'])
  const { data, error } = await supabase.from('contacts').select(select).ilike('email', normalized)

  if (error) return { kind: 'unavailable', error: error.message }

  const rows = ((data ?? []) as unknown as ContactByEmail[]).filter(
    c => String(c.email ?? '').trim().toLowerCase() === normalized
  )
  if (rows.length === 0) return { kind: 'absent' }
  const ordered = orderCanonically(rows)
  return { kind: 'found', contacts: ordered, primary: ordered[0] }
}

/** Append any of `needed` that `columns` does not already name. */
function withColumns(columns: string, needed: string[]): string {
  let out = columns
  for (const col of needed) {
    if (!new RegExp(`(^|[\\s,])${col}([\\s,]|$)`).test(out)) out = `${out}, ${col}`
  }
  return out
}

/** `CANONICAL_ROW_RULE`, applied. A row with no readable clock sorts LAST. */
function orderCanonically<T extends { created_at?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ta = Date.parse(String(a.created_at ?? ''))
    const tb = Date.parse(String(b.created_at ?? ''))
    const va = Number.isFinite(ta)
    const vb = Number.isFinite(tb)
    if (va && vb) return ta - tb
    if (va) return -1
    if (vb) return 1
    return 0
  })
}

/**
 * The `contact_status` enum, read out of `pg_enum` on 2026-09-12 rather than
 * remembered (rule 13). Two labels are load-bearing: `customer` (429 rows) and
 * `unsubscribed`, which is half of what `optedOutReason()` reads before every
 * marketing send. Live distribution: 791 `lead`, 429 `customer`, **0 of
 * everything else** — including `unsubscribed`, which nothing has ever written.
 */
export const CONTACT_STATUSES = [
  'lead',
  'warm_lead',
  'hot_lead',
  'customer',
  'vip',
  'inactive',
  'unsubscribed',
] as const

/**
 * A PostgREST `or=` group for the admin Contacts search box, built so the term
 * cannot escape its own filter.
 *
 * `.or()` takes a RAW PostgREST filter expression: a comma starts a new
 * disjunct and `)` closes the group, so interpolating a search term into
 * `first_name.ilike.%${term}%,…` let the box rewrite the query. It is
 * admin-only, which bounds the damage without making it correct — and `%`/`_`
 * were silently wildcards either way. Everything structural is REMOVED rather
 * than escaped: a search term is free text typed into a box, not a filter, and
 * no character in that set belongs in a name or a phone number. Same family as
 * link 15's `.or()` finding (AGENTS.md §11).
 */
export const CONTACT_SEARCH_COLUMNS = ['first_name', 'last_name', 'email', 'phone']

export function contactSearchFilter(term: string): string {
  return orIlikeFilter(CONTACT_SEARCH_COLUMNS, term)
}

/* ── The same question, asked of a PHONE NUMBER ───────────────────────────── */

/**
 * WHY A PHONE NUMBER NEEDS THIS TOO. `contacts.phone` is plain `text` holding
 * whatever was typed or whatever a provider sent, and the live table holds the
 * same number as `6314008080`, `+16314008080`, `631-400-8080`, `16318338149`
 * and `(631) 400-8080`. `.eq('phone', phone)` therefore misses, which is how
 * `upsertContactByPhone` created a SECOND row for a number it already had:
 * measured 2026-09-12, **21 normalised numbers have more than one contact row**,
 * one of them six.
 *
 * Two things this must get right, and they pull in opposite directions:
 *
 *   - A number is not a person. Two of those 21 groups are two DIFFERENT people
 *     sharing a phone (a household), so a lookup by number may legitimately
 *     return several rows and a caller must not assume they are one human.
 *   - An inbound STOP is a statement about the NUMBER, so it must reach every
 *     row holding it. Opting out one row and leaving the other is how a carrier
 *     STOP becomes a database that still thinks it may text.
 *
 * Candidates are fetched on the last FOUR digits, which are contiguous in every
 * format observed in the live table, and are digits so they carry no LIKE
 * metacharacter. The answer is then an exact re-compare on the normalised
 * number — never the pattern (the `.ilike()` lesson), and never a RAW
 * PostgREST `.or()` built from the provider's own `From` field, which is what
 * both SMS webhooks used to do.
 */
export interface ContactByPhone {
  id: string
  phone: string | null
  email?: string | null
  sms_opt_in?: boolean | null
  created_at?: string | null
}

export type ContactPhoneLookup =
  | { kind: 'found'; contacts: ContactByPhone[]; primary: ContactByPhone }
  | { kind: 'absent' }
  | { kind: 'unavailable'; error: string }

/** Digits only, last 10 — the comparable form of a US number. */
export function normalizePhoneKey(raw: unknown): string {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.length < 10) return ''
  return digits.slice(-10)
}

export async function findContactsByPhone(
  supabase: Supa,
  phone: string,
  columns = 'id, phone, email, sms_opt_in'
): Promise<ContactPhoneLookup> {
  const key = normalizePhoneKey(phone)
  if (!key) return { kind: 'absent' }

  const select = withColumns(columns, ['phone', 'created_at'])
  const { data, error } = await supabase
    .from('contacts')
    .select(select)
    .ilike('phone', `%${key.slice(-4)}%`)

  if (error) return { kind: 'unavailable', error: error.message }

  const rows = ((data ?? []) as unknown as ContactByPhone[]).filter(
    c => normalizePhoneKey(c.phone) === key
  )
  if (rows.length === 0) return { kind: 'absent' }
  const ordered = orderCanonically(rows)
  return { kind: 'found', contacts: ordered, primary: ordered[0] }
}

/* ── The same question, asked of `bookings.contact_email` ─────────────────── */

/**
 * WHY THIS IS HERE AND NOT IN THE PORTAL. `bookings.contact_email` has exactly
 * the same shape as `contacts.email` — plain `text`, holding whatever the
 * customer typed — and the customer PORTAL is where getting it wrong costs the
 * most. Measured in production on 2026-09-12: **9 of 61 bookings carry a
 * mixed-case address**, two of them `deposit_paid`.
 *
 * Three callers were each answering it their own way, and all three were wrong
 * in a different direction (`docs/portal-auth-review.md` §3):
 *
 *   - `/api/portal/resend-link` used `.eq('contact_email', lower(input))`, which
 *     is case-SENSITIVE, so seven of those nine customers asked for their portal
 *     link, were told *"Check your email!"*, and nothing was sent. That is the
 *     only login the site actually offers.
 *   - `/api/portal/my-bookings` used `.ilike('contact_email', cookieEmail)` as
 *     the **authorization filter** and trusted the pattern to be the answer. A
 *     session cookie whose email is the single character `%` returned **34
 *     bookings** — every kids party in the database, with children's names.
 *     Confirmed live before the fix.
 *   - `/api/portal/email-auth/request` used `.ilike` to decide whether to mail a
 *     login code, so `%@gmail.com` matched 40 bookings and minted a code row.
 *
 * So the rule `findContactsByEmail` already states is the rule here: **`ilike`
 * fetches candidates and is NOT the answer.** `_` matches any single character
 * and `*`/`%` sweep, so every candidate is re-compared exactly in JS, and the
 * comparison is the thing authorization rests on.
 */
export interface BookingByContactEmail {
  id: string
  booking_ref: string
  contact_email: string | null
  [key: string]: unknown
}

export type BookingEmailLookup =
  | { kind: 'found'; bookings: BookingByContactEmail[] }
  | { kind: 'absent' }
  /** Rule 12: "could not read" is not "this customer has no bookings". */
  | { kind: 'unavailable'; error: string }

/**
 * Every booking whose `contact_email` equals `email`, compared
 * case-insensitively and EXACTLY.
 *
 * `columns` must include `contact_email` — the exact re-compare needs it, and a
 * caller that omitted it would silently get an unfiltered list, which is the
 * defect this function exists to remove. It is appended rather than trusted.
 */
export async function findBookingsByContactEmail(
  supabase: Supa,
  email: string,
  columns = 'id, booking_ref, contact_email',
  opts: { excludeCancelled?: boolean; limit?: number } = {}
): Promise<BookingEmailLookup> {
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized) return { kind: 'absent' }

  const select = withColumns(columns, ['contact_email'])

  let query = supabase.from('bookings').select(select).ilike('contact_email', normalized)
  if (opts.excludeCancelled) query = query.not('status', 'eq', 'cancelled')
  // The limit is applied to the CANDIDATES, and candidates can only ever be a
  // superset of the answer, so a limit here can hide a real row. It is
  // deliberately generous and deliberately not the default.
  if (opts.limit) query = query.limit(opts.limit)

  const { data, error } = await query
  if (error) return { kind: 'unavailable', error: error.message }

  const rows = ((data ?? []) as unknown as BookingByContactEmail[]).filter(
    b => String(b.contact_email ?? '').trim().toLowerCase() === normalized
  )
  if (rows.length === 0) return { kind: 'absent' }
  return { kind: 'found', bookings: rows }
}
