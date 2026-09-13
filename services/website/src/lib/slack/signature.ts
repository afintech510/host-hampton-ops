/**
 * Slack request signing (plan §21.4).
 *
 * This is the first line of every Slack handler, before the body is parsed and
 * long before anything is approved. `/api/slack/interactions` is a public URL
 * that can approve a message to a customer; without this, so can anyone who
 * finds it.
 *
 * ── Read the provider's own spec, do not assume ──────────────────────────
 *
 * The SignWell review turned up a webhook whose signature covered only
 * `type@time`, so a valid hash vouched for nothing in the body. Slack is not
 * like that — it signs the RAW BODY — but the way to know that is to implement
 * what Slack documents rather than what a webhook "usually" does:
 *
 *   base string = `v0:${timestamp}:${rawBody}`
 *   signature   = 'v0=' + HMAC_SHA256(signingSecret, baseString)  // hex
 *   headers     = x-slack-signature, x-slack-request-timestamp
 *
 * RAW body. Not a re-serialised JSON object, and not a parsed form — Slack
 * sends interactions as `application/x-www-form-urlencoded` with a `payload`
 * field, and re-encoding that would change the bytes and break every
 * signature. In the App Router that means `await req.text()` FIRST, then parse
 * the string you already hashed.
 *
 * ── Fail closed ─────────────────────────────────────────────────────────
 *
 * An unset `SLACK_SIGNING_SECRET` returns 'unconfigured', and the caller must
 * treat that as a rejection. This is the shape the SignWell work settled on and
 * it is the whole lesson: a verifier that silently passes when it has no key is
 * worse than no verifier, because it reads like protection in code review.
 */

import crypto from 'crypto'

/** How far out of date a request may be. Slack's documented recommendation. */
export const SLACK_MAX_SKEW_SECONDS = 60 * 5

export type SlackVerifyResult =
  | 'ok'
  | 'unconfigured'
  | 'missing_headers'
  | 'bad_timestamp'
  | 'stale'
  | 'bad_signature'

export function slackSigningSecret(): string {
  return process.env.SLACK_SIGNING_SECRET?.trim() || ''
}

/** The exact string Slack signed. Exported so a test can sign like Slack does. */
export function slackBaseString(timestamp: string, rawBody: string): string {
  return `v0:${timestamp}:${rawBody}`
}

/** Produce the `v0=...` header value for a body. Used by tests and by nothing else. */
export function slackSignature(secret: string, timestamp: string, rawBody: string): string {
  return 'v0=' + crypto.createHmac('sha256', secret).update(slackBaseString(timestamp, rawBody)).digest('hex')
}

/**
 * Verify a Slack request. Anything but `'ok'` means reject.
 *
 * The timestamp check is not decoration: without it a signature Slack produced
 * once is valid forever, so a captured "Approve" interaction could be replayed
 * to send a customer message at any later time. The signature proves WHO, the
 * timestamp proves WHEN, and approving a draft needs both.
 */
export function verifySlackRequest(opts: {
  signature: string | null
  timestamp: string | null
  rawBody: string
  secret?: string
  now?: Date
}): SlackVerifyResult {
  const secret = opts.secret ?? slackSigningSecret()
  if (!secret) return 'unconfigured'
  if (!opts.signature || !opts.timestamp) return 'missing_headers'

  const ts = Number(opts.timestamp)
  if (!Number.isFinite(ts) || !/^\d+$/.test(opts.timestamp)) return 'bad_timestamp'

  const nowSec = Math.floor((opts.now ?? new Date()).getTime() / 1000)
  // Absolute difference: a timestamp far in the FUTURE is as suspicious as a
  // stale one, and only checking one direction leaves an open replay window.
  if (Math.abs(nowSec - ts) > SLACK_MAX_SKEW_SECONDS) return 'stale'

  const expected = slackSignature(secret, opts.timestamp, opts.rawBody)
  try {
    const a = Buffer.from(expected)
    const b = Buffer.from(opts.signature)
    if (a.length !== b.length) return 'bad_signature'
    return crypto.timingSafeEqual(a, b) ? 'ok' : 'bad_signature'
  } catch {
    return 'bad_signature'
  }
}

/**
 * Reviewer allowlist — the Slack analogue of `isReviewerPhone`.
 *
 * Checked against the VERIFIED `user.id` from an interaction payload, never
 * against anything in the message text. §4.2's guardrail is "identity by
 * channel-verified sender, never by content", and that does not change because
 * the channel changed.
 *
 * Empty allowlist = nobody may approve. Same direction as REVIEWER_PHONES being
 * unset meaning "text nobody": the safe reading of "not configured" is "no
 * authority", not "all authority".
 */
export function slackReviewerIds(): string[] {
  return (process.env.SLACK_REVIEWER_USER_IDS || '')
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

export function isSlackReviewer(userId: string | null | undefined): boolean {
  if (!userId) return false
  const ids = slackReviewerIds()
  if (ids.length === 0) return false
  return ids.includes(userId)
}
