/**
 * "Is this inbound message really from the provider it claims to be from?"
 *
 * One module for the whole inbound message surface, for the reason
 * `lib/signwellWebhook.ts` exists for the SignWell routes (rule 11): the two
 * SMS webhooks each answered this question their own way, and one of them did
 * not answer it at all.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS, MEASURED
 *
 * **Quo.** `/api/webhooks/quo` verified a Standard Webhooks signature —
 * `webhook-id` / `webhook-timestamp` / `webhook-signature`, over
 * `id.timestamp.body`. Quo does not sign that way. Quo is OpenPhone-compatible
 * and signs with ONE header:
 *
 *     openphone-signature: hmac;1;1639710054089;mw1K4fvh5m9XzsGon4C5N3KvL0bkmPZSAyb/9Vms2Qo=
 *                          ^scheme ^ver ^ms-timestamp ^base64(HMAC-SHA256)
 *
 * over `` `${timestamp}.${rawBody}` `` keyed by the BASE64-DECODED signing key.
 * (https://support.quo.com/core-concepts/integrations/webhooks — the same page
 * OpenPhone published at /hc/en-us/articles/4690754298903.)
 *
 * So every real delivery arrived with none of the three headers the verifier
 * looked for, and was rejected. Measured in the nginx log on 2026-09-13:
 * **every POST to `/api/webhooks/quo` from 2026-09-11 12:00 UTC onward answered
 * 401** — 38 of them across 2.5 days, and 200 on every delivery before that.
 * While it was down: no reviewer SEND/CANCEL reply could arrive (16 drafts were
 * sitting in `sent_for_review`), no inbound customer SMS was recorded, and no
 * customer STOP could reach `contacts.sms_opt_in`.
 *
 * **How it passed review.** `docs/quo-webhook-setup.md` §4 verifies the endpoint
 * by signing a payload the way the verifier checks it. That test can only ever
 * prove the verifier agrees with itself. Hard-won rule 8, and rule 17's
 * "ASK THE PROVIDER" half: the provider's own documentation was the evidence
 * nobody had read.
 *
 * **Twilio.** `/api/webhooks/twilio` verified NOTHING — no `X-Twilio-Signature`
 * check of any kind — while `TWILIO_AUTH_TOKEN` sat in the container the whole
 * time. It is a public URL, and the things it does are write
 * `contacts.sms_opt_in = false` for **every row holding a number** and cancel
 * that contact's pending SMS reminders. Anyone who knew the URL and a customer's
 * number could silence us to that customer and write a false `sms_unsubscribed`
 * statement about a real person.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RULES THIS MODULE KEEPS
 *
 *   - **Both schemes are accepted for Quo, and the caller is told which one
 *     verified.** Not a weakening: each is an HMAC over the raw body keyed by
 *     the same secret. It is what stops a provider changing its header names
 *     from taking the edge down for days again, and it keeps the runbook's
 *     self-signed harness working as a liveness check.
 *   - **The failure REASON is specific, and names the headers that were
 *     present** (names only, never values). For 2.5 days the only evidence was
 *     `signature verification FAILED — rejecting`, which cannot tell a wrong key
 *     from a wrong scheme. Rule 10: a guardrail that stops something must say
 *     what it stopped and why.
 *   - **Fail closed when unconfigured — in production only**, on the
 *     `portalSigningSecret()` pattern: a build is not a request.
 *   - **The age bound is deliberately generous** (24h, like SignWell's). The
 *     defect this module repairs was an over-strict check nobody had tested
 *     against a real delivery; replay is already inert because
 *     `ingested_messages.external_id` is UNIQUE.
 */

import crypto from 'crypto'
// `HeaderBag` is imported rather than restated: "a thing you can ask for a
// header" is one concept and `publicOrigin` already owns it (rule 11).
import { publicOrigin, type HeaderBag } from '@/lib/publicOrigin'

export type { HeaderBag }

/** How stale a signed delivery may be before it is refused. */
export const INBOUND_EVENT_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Header names we read, so a caller can report which were present. */
export const QUO_SIGNATURE_HEADERS = [
  'openphone-signature',
  'quo-signature',
  'webhook-id',
  'webhook-timestamp',
  'webhook-signature',
] as const

export type VerifyFailReason =
  | 'unconfigured'
  | 'no-signature-header'
  | 'malformed-header'
  | 'bad-signature'
  | 'stale'

export type InboundVerifyResult =
  | { ok: true; scheme: 'openphone' | 'standard-webhooks' | 'twilio'; unverified?: false }
  /** Verification is genuinely disabled (non-production, or a build). */
  | { ok: true; scheme: 'skipped'; unverified: true }
  | {
      ok: false
      reason: VerifyFailReason
      headersSeen: string[]
      /**
       * Enough to tell WHICH delivery this was and what differed, with nothing
       * in it that is worth keeping secret: the signed timestamp, the body
       * length, and SHA-256 fingerprints of the body and of the two digests.
       *
       * `bad-signature` on its own cannot distinguish "the key is wrong" from
       * "we are hashing the wrong bytes", and that distinction is the whole
       * reason this edge stayed down for 2.5 days. It is also how the surviving
       * anomaly was diagnosed: Quo delivers every message TWICE, and comparing
       * these fields across the pair is the only way to see what differs.
       */
      detail?: string
    }

/**
 * Is "no secret configured" allowed to mean "skip verification"?
 *
 * Only outside production. The BUILD is not a request, so a prerender with no
 * `.env` is exempt and every real request is not — the same shape as
 * `portalSigningSecret()`.
 */
export function unsignedRequestsAllowed(): boolean {
  const isBuild = process.env.NEXT_PHASE === 'phase-production-build'
  return process.env.NODE_ENV !== 'production' || isBuild
}

/**
 * Read one header without ever throwing.
 *
 * Same reasoning `callerKey` states for the rate limiter: this function sits in
 * front of every inbound write, and a verifier that throws on a request shape it
 * did not expect answers **500**, not 401 — a crash where a refusal belongs. It
 * also keeps the module callable from a test with a bare `{ text }` request.
 */
function header(headers: HeaderBag | undefined, name: string): string {
  try {
    return headers?.get?.(name) ?? ''
  } catch {
    return ''
  }
}

function headersPresent(headers: HeaderBag | undefined, names: readonly string[]): string[] {
  return names.filter(n => header(headers, n).length > 0)
}

/** Constant-time compare of two strings that are already the same encoding. */
function sameDigest(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}

/**
 * The signing key as BYTES.
 *
 * Quo hands out a 44-character base64 string (32 bytes). `Buffer.from(x,
 * 'base64')` never throws on bad input — it silently drops the characters it
 * cannot read — so "try base64, catch, fall back to utf8" is dead code that
 * hides a mis-set secret behind a wrong key. Decode, and only treat the result
 * as the key when it round-trips; otherwise use the raw bytes.
 */
export function decodeSigningKey(secret: string): Buffer {
  const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret
  const decoded = Buffer.from(raw, 'base64')
  if (decoded.length > 0 && decoded.toString('base64').replace(/=+$/, '') === raw.replace(/=+$/, '')) {
    return decoded
  }
  return Buffer.from(raw, 'utf8')
}

/** A short, non-secret fingerprint. Never a digest, never a key. */
function fp(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 8)
}

/**
 * The evidence a human needs to tell one failing delivery from another.
 *
 * Deliberately fingerprints rather than prefixes: a prefix of a real HMAC is a
 * piece of a real HMAC, and nothing here needs to be. A SHA-256 fingerprint is
 * enough to say "these two deliveries carried the same body" or "the signature
 * we computed is not the one they sent", which is the whole question.
 */
function failureDetail(input: {
  scheme: string
  timestamp: string
  rawBody: string
  signature: string
  expected: string
}): string {
  return (
    `scheme=${input.scheme} ts=${input.timestamp} bodyLen=${input.rawBody.length} ` +
    `bodyFp=${fp(input.rawBody)} theirSigFp=${fp(input.signature)} ourSigFp=${fp(input.expected)} ` +
    `${describeRefusedEnvelope(input.rawBody)}`
  )
}

/**
 * The event TYPE of a body we just refused — and nothing else from it.
 *
 * Parsing an unverified body is safe precisely because of what is taken from
 * it: two enum-shaped fields, each truncated, into a log line. Not the sender,
 * not the text. The request is still refused.
 *
 * It earns its place because of what it found. Every inbound Quo message
 * arrives at this route TWICE, from two Cloudflare edges seconds apart, with
 * DIFFERENT bodies (604 bytes vs 518 for the same 44-character text) — and only
 * one of the pair verifies against `QUO_WEBHOOK_SECRET`. `GET /v1/webhooks`
 * lists exactly one subscription and its key fingerprint matches ours, so the
 * other stream is signed with a key the API does not expose: a second
 * subscription created in the Quo app rather than through the API. It is the
 * one that delivered the 30 real customer messages of 2026-08-27..09-10, back
 * when this route had no secret set and accepted everything. See needs-Adam.
 */
function describeRefusedEnvelope(rawBody: string): string {
  try {
    const parsed = JSON.parse(rawBody) as { type?: unknown; data?: { object?: { direction?: unknown } } }
    const type = typeof parsed?.type === 'string' ? parsed.type.slice(0, 40) : 'unknown'
    const dir = typeof parsed?.data?.object?.direction === 'string'
      ? parsed.data.object.direction.slice(0, 16)
      : 'unknown'
    return `refusedType=${type} refusedDirection=${dir}`
  } catch {
    return 'refusedType=unparseable'
  }
}

/**
 * Verify one inbound Quo (OpenPhone) webhook delivery.
 *
 * `rawBody` must be the EXACT bytes received. Quo signs what it sent; a
 * re-serialised object is a different string and will not match.
 */
export function verifyQuoWebhook(
  headers: HeaderBag,
  rawBody: string,
  now: number = Date.now(),
): InboundVerifyResult {
  const secret = process.env.QUO_WEBHOOK_SECRET
  const seen = headersPresent(headers, QUO_SIGNATURE_HEADERS)
  if (!secret) {
    return unsignedRequestsAllowed()
      ? { ok: true, scheme: 'skipped', unverified: true }
      : { ok: false, reason: 'unconfigured', headersSeen: seen }
  }
  const key = decodeSigningKey(secret)

  // ── Scheme 1: OpenPhone/Quo. `hmac;1;<ms>;<base64>` over `<ms>.<rawBody>`.
  const openphone = header(headers, 'openphone-signature') || header(headers, 'quo-signature')
  if (openphone) {
    const parts = openphone.split(';')
    if (parts.length < 4) return { ok: false, reason: 'malformed-header', headersSeen: seen }
    const [, , timestamp, signature] = parts
    if (!timestamp || !signature) return { ok: false, reason: 'malformed-header', headersSeen: seen }

    const expected = crypto.createHmac('sha256', key).update(`${timestamp}.${rawBody}`).digest('base64')
    if (!sameDigest(signature, expected)) {
      return {
        ok: false,
        reason: 'bad-signature',
        headersSeen: seen,
        detail: failureDetail({ scheme: 'openphone', timestamp, rawBody, signature, expected }),
      }
    }
    if (!withinAge(timestamp, now)) return { ok: false, reason: 'stale', headersSeen: seen }
    return { ok: true, scheme: 'openphone' }
  }

  // ── Scheme 2: Standard Webhooks. Kept because the runbook's harness uses it
  // and because a provider that migrates to it must not take this edge down.
  const id = header(headers, 'webhook-id')
  const ts = header(headers, 'webhook-timestamp')
  const sigHeader = header(headers, 'webhook-signature')
  if (!id || !ts || !sigHeader) return { ok: false, reason: 'no-signature-header', headersSeen: seen }

  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest('base64')
  // Space-delimited "v1,<sig> v1,<sig2>".
  const matched = sigHeader.split(' ').some(part => {
    const sig = part.includes(',') ? part.split(',')[1] : part
    return sameDigest(sig, expected)
  })
  if (!matched) return { ok: false, reason: 'bad-signature', headersSeen: seen }
  if (!withinAge(ts, now)) return { ok: false, reason: 'stale', headersSeen: seen }
  return { ok: true, scheme: 'standard-webhooks' }
}

/**
 * Is this timestamp recent enough? Accepts seconds or milliseconds — Standard
 * Webhooks sends seconds, OpenPhone sends milliseconds.
 *
 * An UNREADABLE timestamp is treated as fresh rather than stale. It is inside
 * the signature, so it cannot be forged independently; refusing on it would
 * mean a provider changing its timestamp format takes this edge down, which is
 * the exact failure this module was written to repair.
 */
function withinAge(timestamp: string, now: number): boolean {
  const n = Number(timestamp)
  if (!Number.isFinite(n) || n <= 0) return true
  const ms = n > 1e11 ? n : n * 1000
  return Math.abs(now - ms) <= INBOUND_EVENT_MAX_AGE_MS
}

/* ── Twilio ──────────────────────────────────────────────────────────── */

/**
 * Verify one inbound Twilio webhook delivery.
 *
 * Twilio signs `url + <every POST param, sorted by name, key and value
 * concatenated>` with HMAC-SHA1 keyed by the AUTH TOKEN, base64, in
 * `X-Twilio-Signature`. https://www.twilio.com/docs/usage/security
 *
 * **The URL must be the one Twilio called**, which is the PUBLIC one — this app
 * sits behind Cloudflare and nginx, so `req.url` inside the container is not it.
 * `publicOrigin()` is the one sanctioned answer to "what is our own origin"
 * (AGENTS.md §11) and it screens the forwarded host, so an attacker cannot pick
 * the string we sign by setting a header.
 *
 * Note what the signature covers: the URL and every POST parameter. Unlike
 * SignWell's `type@time`, a valid Twilio signature really does vouch for `From`
 * and `Body` — which is the whole point here, because `From` decides whose
 * consent we write.
 */
export function verifyTwilioWebhook(
  req: { headers: HeaderBag; url: string },
  params: URLSearchParams,
  now: number = Date.now(),
): InboundVerifyResult {
  void now
  const token = process.env.TWILIO_AUTH_TOKEN
  const seen = headersPresent(req.headers, ['x-twilio-signature'])
  if (!token) {
    return unsignedRequestsAllowed()
      ? { ok: true, scheme: 'skipped', unverified: true }
      : { ok: false, reason: 'unconfigured', headersSeen: seen }
  }

  const provided = header(req.headers, 'x-twilio-signature')
  if (!provided) return { ok: false, reason: 'no-signature-header', headersSeen: seen }

  const keys: string[] = []
  params.forEach((_value, key) => {
    if (!keys.includes(key)) keys.push(key)
  })
  keys.sort()

  for (const url of twilioSignedUrls(req)) {
    let payload = url
    for (const k of keys) {
      for (const v of params.getAll(k)) payload += k + v
    }
    const expected = crypto.createHmac('sha1', token).update(Buffer.from(payload, 'utf8')).digest('base64')
    if (sameDigest(provided, expected)) return { ok: true, scheme: 'twilio' }
  }
  return { ok: false, reason: 'bad-signature', headersSeen: seen }
}

/**
 * The candidate URLs Twilio may have signed.
 *
 * Twilio signs the URL EXACTLY as configured in the console, and a trailing
 * slash or an `http://` scheme there produces a different digest for the same
 * request. Offering both spellings costs one extra HMAC and removes the most
 * common reason a correct implementation rejects a genuine delivery — which is
 * precisely how the Quo edge went down.
 */
function twilioSignedUrls(req: { headers: HeaderBag; url: string }): string[] {
  let pathAndQuery = '/api/webhooks/twilio'
  try {
    const parsed = new URL(req.url)
    pathAndQuery = `${parsed.pathname}${parsed.search}`
  } catch {
    /* keep the default */
  }
  const origin = publicOrigin(req as { headers: HeaderBag })
  const base = `${origin}${pathAndQuery}`
  const withSlash = pathAndQuery.endsWith('/') ? base : `${base}/`
  return [base, withSlash]
}
