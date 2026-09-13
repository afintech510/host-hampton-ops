/**
 * Recording an inbound STOP.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ONE FUNCTION AND NOT TWO. `/api/webhooks/quo` and
 * `/api/webhooks/twilio` each carried their own copy, and both did the same two
 * things wrong (rule 11: a concept defined twice is a concept nothing is
 * checking):
 *
 *   1. They matched the number with a RAW PostgREST `.or()` expression built
 *      from the provider's `From` field — `phone.eq.${n},phone.eq.+1${n}` — an
 *      allow-list of three spellings against a column that in production holds
 *      `6314008080`, `+16314008080`, `631-400-8080`, `16318338149` and
 *      `(631) 400-8080`. AGENTS.md §11 bans `.or()` from a template literal for
 *      the reason link 15 found; here it was also simply incomplete.
 *   2. They then wrote `sms_opt_in = false` to **one** row. Measured on
 *      2026-09-12, **21 normalised numbers carry more than one contact row**,
 *      seven of those groups DISAGREE about `sms_opt_in` today, and one number
 *      has six rows. So a STOP stopped one row and left the others saying we
 *      may text — and the reminder engine reads `sms_opt_in`, not the carrier.
 *
 * **A STOP is a statement about the NUMBER.** Two of the 21 groups are two
 * different people sharing a household phone, so a number is not a person — but
 * that cuts the same way: we would text *that number* for either of them, so
 * every row holding it has to stop. Over-recording an opt-out is never the
 * expensive direction.
 *
 * Everything here reads its own result (rule 19) and says what it did in both
 * directions (rule 10).
 */

import { findContactsByPhone, normalizePhoneKey } from '@/lib/contactLookup'
import type { getSupabase } from '@/lib/supabase'

type Supa = ReturnType<typeof getSupabase>

/* ── What the customer typed ──────────────────────────────────────────── */

/**
 * THE keyword set, written down once.
 *
 * It was written down twice — an inline array literal inside
 * `/api/webhooks/quo/route.ts` and an identical one inside
 * `/api/webhooks/twilio/route.ts` — which is rule 11 on the one surface where
 * getting it wrong is a carrier-compliance matter. Both copies were missing
 * `STOPALL`, which is on Twilio's own documented list
 * (https://help.twilio.com/articles/223134027), and neither recognised the
 * opt-IN words at all.
 *
 * `CANCEL` really is an opt-out keyword at the carrier — a customer who texts
 * it meaning "cancel my party" is unsubscribed by the carrier whatever we do,
 * so matching it here keeps our record of their state true rather than
 * inventing one. (On the Quo number `CANCEL` from a REVIEWER phone is also a
 * draft-cancel command; `/api/webhooks/quo` records the message either way.)
 */
export const SMS_STOP_KEYWORDS = [
  'STOP',
  'STOPALL',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
  'OPTOUT',
  'OPT-OUT',
  'REVOKE',
] as const

/** The carrier's resume words. See `smsKeywordIntent` for what we do with them. */
export const SMS_START_KEYWORDS = ['START', 'UNSTOP', 'YES', 'RESUME'] as const

export const SMS_HELP_KEYWORDS = ['HELP', 'INFO'] as const

export type SmsKeywordIntent = 'stop' | 'start' | 'help' | null

/**
 * Read one inbound SMS body as a carrier keyword, or as nothing.
 *
 * EXACT match on the trimmed, upper-cased body, deliberately — the same rule
 * `parseReviewerReply` follows. "Please don't stop sending me these" contains
 * STOP and is not an opt-out, and a "contains" test on this surface writes a
 * false statement about somebody's consent.
 */
export function smsKeywordIntent(body: string | null | undefined): SmsKeywordIntent {
  const key = String(body ?? '')
    .trim()
    .toUpperCase()
    .replace(/[.!]+$/, '')
  if (!key) return null
  if ((SMS_STOP_KEYWORDS as readonly string[]).includes(key)) return 'stop'
  if ((SMS_START_KEYWORDS as readonly string[]).includes(key)) return 'start'
  if ((SMS_HELP_KEYWORDS as readonly string[]).includes(key)) return 'help'
  return null
}

export type SmsOptOutResult =
  | { kind: 'recorded'; contactIds: string[]; remindersCancelled: number }
  /** The number belongs to nobody we hold. Nothing to opt out of. */
  | { kind: 'unknown-number' }
  /** A read or write failed. The provider should retry. */
  | { kind: 'unavailable'; error: string }

export async function recordSmsOptOut(
  supabase: Supa,
  phone: string,
  provider: 'quo' | 'twilio',
  meta: Record<string, unknown> = {}
): Promise<SmsOptOutResult> {
  const key = normalizePhoneKey(phone)
  if (!key) return { kind: 'unknown-number' }

  const lookup = await findContactsByPhone(supabase, phone, 'id, phone, sms_opt_in')
  if (lookup.kind === 'unavailable') {
    console.error(`${provider}:webhook STOP — contact lookup FAILED, opt-out NOT recorded:`, lookup.error)
    return { kind: 'unavailable', error: lookup.error }
  }
  if (lookup.kind === 'absent') {
    console.warn(`${provider}:webhook STOP from a number with no contact row (…${key.slice(-4)})`)
    return { kind: 'unknown-number' }
  }

  const ids = lookup.contacts.map(c => c.id)

  // By id, never by the phone filter — `ilike` fetched candidates and the exact
  // re-compare is what decided these rows.
  const { data: updated, error: updErr } = await supabase
    .from('contacts')
    .update({ sms_opt_in: false })
    .in('id', ids)
    .select('id')
  if (updErr) {
    console.error(`${provider}:webhook STOP — opt-out write FAILED:`, updErr.message)
    return { kind: 'unavailable', error: updErr.message }
  }
  if (!updated || updated.length === 0) {
    console.error(`${provider}:webhook STOP — opt-out write matched NO rows for …${key.slice(-4)}`)
    return { kind: 'unavailable', error: 'opt-out update matched no rows' }
  }

  const { data: cancelled, error: remErr } = await supabase
    .from('scheduled_reminders')
    .update({ status: 'cancelled' })
    .in('contact_id', ids)
    .eq('channel', 'sms')
    .eq('status', 'pending')
    .select('id')
  if (remErr) {
    console.error(
      `${provider}:webhook STOP recorded, but pending SMS reminders were NOT cancelled:`,
      remErr.message
    )
  }

  for (const id of ids) {
    const { error: logErr } = await supabase.from('contact_interactions').insert({
      contact_id: id,
      type: 'sms_unsubscribed',
      metadata: { ...meta, provider, phone_last4: key.slice(-4) },
    })
    if (logErr) console.error(`${provider}:webhook STOP — interaction log refused:`, logErr.message)
  }

  console.log(
    `${provider}:webhook SMS opt-out recorded for …${key.slice(-4)} — ` +
      `${updated.length} contact row(s), ${cancelled?.length ?? 0} pending SMS reminder(s) cancelled`
  )
  return { kind: 'recorded', contactIds: ids, remindersCancelled: cancelled?.length ?? 0 }
}

/* ── START ────────────────────────────────────────────────────────────── */

export type SmsOptInResult =
  | { kind: 'recorded'; contactIds: string[] }
  | { kind: 'unknown-number' }
  | { kind: 'unavailable'; error: string }

/**
 * Record an inbound START / UNSTOP.
 *
 * **It deliberately does NOT write `sms_opt_in = true`, and that is the whole
 * point of the function.** A STOP is a statement about the NUMBER, so it is
 * applied to every row holding it — over-recording an opt-out is never the
 * expensive direction. Re-granting consent is the opposite in every respect:
 *
 *   - Two of the 21 duplicated phone groups in production are two DIFFERENT
 *     people sharing a household phone (`docs/contact-identity-review.md` §1).
 *     Opting "every row holding this number" back in hands one person's consent
 *     to another.
 *   - `contact_interactions` holds **zero** `sms_unsubscribed` rows, so there is
 *     no record anywhere of which rows a past STOP turned off. Even for one
 *     person we could not restore the prior state; we could only guess at it.
 *   - The carrier resumes delivery on START by itself. Nothing is blocked by us
 *     staying quiet; the only thing at stake is our marketing consent flag,
 *     which is a business decision (needs-Adam) and not a webhook's to make.
 *
 * So the message is RECORDED and SAID OUT LOUD, and a human decides. Rule 10 in
 * its other half: not claiming to have done something we did not do.
 */
export async function recordSmsOptIn(
  supabase: Supa,
  phone: string,
  provider: 'quo' | 'twilio',
  meta: Record<string, unknown> = {}
): Promise<SmsOptInResult> {
  const key = normalizePhoneKey(phone)
  if (!key) return { kind: 'unknown-number' }

  const lookup = await findContactsByPhone(supabase, phone, 'id, phone, sms_opt_in')
  if (lookup.kind === 'unavailable') {
    console.error(`${provider}:webhook START — contact lookup FAILED, nothing recorded:`, lookup.error)
    return { kind: 'unavailable', error: lookup.error }
  }
  if (lookup.kind === 'absent') {
    console.warn(`${provider}:webhook START from a number with no contact row (…${key.slice(-4)})`)
    return { kind: 'unknown-number' }
  }

  const ids = lookup.contacts.map(c => c.id)
  const alreadyIn = lookup.contacts.filter(c => c.sms_opt_in === true).length
  for (const id of ids) {
    const { error: logErr } = await supabase.from('contact_interactions').insert({
      contact_id: id,
      type: 'sms_received',
      metadata: { ...meta, provider, phone_last4: key.slice(-4), carrier_keyword: 'START', consent_written: false },
    })
    if (logErr) console.error(`${provider}:webhook START — interaction log refused:`, logErr.message)
  }

  console.log(
    `${provider}:webhook SMS START from …${key.slice(-4)} — ${ids.length} contact row(s), ` +
      `${alreadyIn} already opted in. sms_opt_in was NOT changed: re-granting consent across every row ` +
      `holding a number is a decision a human makes (needs-Adam). Admin → Contacts.`
  )
  return { kind: 'recorded', contactIds: ids }
}
