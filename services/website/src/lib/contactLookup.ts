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
