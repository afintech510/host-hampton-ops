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
import { gsm7Sanitize, smsSegmentInfo } from './smsSegments'

export const DEFAULT_OWNER_EMAIL = 'hosthampton295@gmail.com'

/**
 * Segment count above which a body is logged as an error (plan §21.2).
 *
 * The 1500-character truncation below is a LENGTH guard, not a COST guard, and
 * the two are not the same thing: 1500 UCS-2 characters is 23 segments, which
 * at Quo's $0.01/segment is $0.23 a text with nothing anywhere saying so. Rule
 * 17 applies to money as much as to cron — "cost a cent" and "cost a quarter"
 * look identical from outside unless something counts and says.
 */
const SEGMENT_WARN_DEFAULT = 3

function segmentWarnThreshold(): number {
  const n = Number(process.env.SMS_SEGMENT_WARN)
  return Number.isFinite(n) && n > 0 ? n : SEGMENT_WARN_DEFAULT
}

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
 * Returns the number of sends that the provider actually ACCEPTED (0 when
 * REVIEWER_PHONES is unset).
 *
 * It used to return `phones.length` — the number ATTEMPTED — and discard every
 * per-send result. `sendSMSVia` resolves `null` on a provider rejection rather
 * than throwing, so a caller checking this number was told a text had gone out
 * when Quo had refused it. That is the same defect as the campaign sender's
 * `total_recipients` (`docs/phase-4-campaign-automation.md` §11) and the reminder
 * engine's `status='sent'`: a counter is only as good as what it is told.
 */
export async function notifyOwnerSms(body: string): Promise<number> {
  const phones = reviewerPhones()
  if (phones.length === 0) return 0
  const text = prepareOwnerSms(body, phones.length)
  const results = await Promise.allSettled(
    phones.map(p =>
      sendSMSVia('quo', p, text).catch(err => {
        console.error('notifyOwnerSms failed (non-fatal):', p, err)
        return null
      }),
    ),
  )
  let delivered = 0
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) delivered++
    else console.error('notifyOwnerSms: NOT delivered to', phones[i])
  })
  return delivered
}

/**
 * Sanitise, truncate, and cost the body of an owner SMS. Exported for tests —
 * the guarantee this phase claims is "an owner SMS is GSM-7", and a guarantee
 * that is not exercised is a comment.
 *
 * Order matters: sanitise BEFORE truncating, because sanitising changes the
 * length (both ways — '…' becomes '...'), and truncating a UCS-2 string at 1500
 * then converting would leave the cut in the wrong place.
 *
 * The truncation marker is '...' rather than the '…' it used to be, because a
 * single ellipsis character was enough to force the whole message to UCS-2 —
 * the truncation guard was itself doubling the bill on the messages it fired on.
 */
export function prepareOwnerSms(body: string, recipients = 1): string {
  const clean = gsm7Sanitize(body ?? '')
  const text = clean.length > 1500 ? clean.slice(0, 1497) + '...' : clean
  const info = smsSegmentInfo(text)
  const line =
    `[sms-cost] ${info.segments} seg x ${recipients} recipient(s), ` +
    `${info.encoding}, ${info.units} units: ${text.slice(0, 60).replace(/\n/g, ' ')}`
  if (info.segments > segmentWarnThreshold()) console.error(line)
  else console.log(line)
  return text
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
  // ' - ', not the ' · ' this used to be. U+00B7 is outside GSM-03.38, so that
  // one separator flipped EVERY lead ping in the system to 67 characters per
  // segment — sixteen call sites, all of them, since the day it was written.
  return bits.join(' - ')
}
