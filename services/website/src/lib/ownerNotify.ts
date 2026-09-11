/**
 * Owner / reviewer notification helpers.
 *
 * Replaces the literal `hosthampton295@gmail.com` that was hardcoded in every
 * API route, and gives every lead-generating route one call to text the
 * reviewers (Adam now, Allie and/or a group later) so leads are seen within
 * minutes instead of whenever the inbox is checked.
 *
 * Env:
 *   OWNER_NOTIFY_EMAIL  — where owner emails go (default hosthampton295@gmail.com)
 *   REVIEWER_PHONES     — comma-separated E.164 numbers that receive owner SMS.
 *                         Empty/unset = no SMS (safe default for tests/local).
 *
 * Both are read at call time so tests can set process.env in beforeEach.
 */

import { sendSMSVia, normalizePhone } from './sms'

export const DEFAULT_OWNER_EMAIL = 'hosthampton295@gmail.com'

/** Email address that receives owner notifications. */
export function ownerEmail(): string {
  const v = process.env.OWNER_NOTIFY_EMAIL?.trim()
  return v || DEFAULT_OWNER_EMAIL
}

/** Phones that receive owner/reviewer SMS. Empty when not configured. */
export function reviewerPhones(): string[] {
  const raw = process.env.REVIEWER_PHONES || ''
  return raw
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(p => normalizePhone(p))
}

/**
 * Text every reviewer. Non-fatal: never throws, never blocks the caller's
 * response beyond the send itself. Always goes through Quo (the Host Hampton
 * number) regardless of SMS_PROVIDER, so the thread lives in the HH inbox
 * where replies are received by /api/webhooks/quo.
 *
 * Returns the number of sends attempted (0 when REVIEWER_PHONES is unset).
 */
export async function notifyOwnerSms(body: string): Promise<number> {
  const phones = reviewerPhones()
  if (phones.length === 0) return 0
  const text = body.length > 1500 ? body.slice(0, 1497) + '…' : body
  await Promise.allSettled(
    phones.map(p =>
      sendSMSVia('quo', p, text).catch(err =>
        console.error('notifyOwnerSms failed (non-fatal):', p, err),
      ),
    ),
  )
  return phones.length
}

/** One-line lead summary for an owner SMS. Keeps only the fields present. */
export function leadSmsLine(parts: {
  kind: string
  name?: string | null
  phone?: string | null
  email?: string | null
  date?: string | null
  guests?: number | string | null
  extra?: string | null
}): string {
  const bits: string[] = [`New ${parts.kind}: ${parts.name || 'no name'}`]
  if (parts.date) bits.push(`date ${parts.date}`)
  if (parts.guests) bits.push(`${parts.guests} guests`)
  if (parts.phone) bits.push(parts.phone)
  if (parts.email) bits.push(parts.email)
  if (parts.extra) bits.push(parts.extra)
  return bits.join(' · ')
}
