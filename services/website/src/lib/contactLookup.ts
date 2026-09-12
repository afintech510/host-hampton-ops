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
}

export type ContactEmailLookup =
  | { kind: 'found'; contacts: ContactByEmail[] }
  | { kind: 'absent' }
  /** Rule 12: "could not read" is not "there is nobody by that name". */
  | { kind: 'unavailable'; error: string }

/**
 * Every contact row whose email equals `email`, compared case-insensitively.
 *
 * `columns` lets a caller ask for more than the defaults; `id` and `email` are
 * always included because the exact-match filter below needs the second and
 * every caller needs the first.
 */
export async function findContactsByEmail(
  supabase: Supa,
  email: string,
  columns = 'id, email, email_opt_in, status'
): Promise<ContactEmailLookup> {
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized) return { kind: 'absent' }

  const { data, error } = await supabase.from('contacts').select(columns).ilike('email', normalized)

  if (error) return { kind: 'unavailable', error: error.message }

  const rows = ((data ?? []) as unknown as ContactByEmail[]).filter(
    c => String(c.email ?? '').trim().toLowerCase() === normalized
  )
  if (rows.length === 0) return { kind: 'absent' }
  return { kind: 'found', contacts: rows }
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

  const select = /(^|[\s,])contact_email([\s,]|$)/.test(columns)
    ? columns
    : `${columns}, contact_email`

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
