/**
 * The one place that decides whether a SignWell webhook is genuine.
 *
 * Rule 11: there are three SignWell webhook routes (studio rental, check-in,
 * consent release) plus the canonical dispatcher. "Is this event really from
 * SignWell?" is ONE concept, so it is answered here once and imported, never
 * re-implemented per route.
 *
 * ## Why this file exists
 *
 * Measured in production on 2026-09-12, before any of this was written: all
 * three routes accepted an unauthenticated POST and wrote `agreement_signed_at`.
 * A forged body sent from a laptop, carrying the string 'totally-made-up-hash',
 * marked a liability waiver signed and the endpoint answered `{"received":true}`.
 * Anyone on the internet could mark any booking's waiver signed, or — via the
 * metadata.booking_ref fallback — mark the WRONG booking's waiver signed.
 *
 * ## SignWell's signing scheme, and its limit
 *
 * SignWell signs `"${event.type}@${event.time}"` with HMAC-SHA256, keyed by the
 * WEBHOOK ID (the uuid returned by POST /hooks), and puts the hex digest in
 * `event.hash`. See https://developers.signwell.com/reference/event-hash-verification
 *
 * Note carefully what that covers: the type and the timestamp, and NOTHING
 * ELSE. The document id, the status and the metadata — every field that decides
 * which booking we write to — are OUTSIDE the signature. So a valid hash proves
 * "SignWell emitted an event of this type at this time". It does NOT prove the
 * body describes that event. Anyone who ever observes one genuine
 * (type, time, hash) triple can replay it with a body of their choosing.
 *
 * Verifying the hash is therefore necessary but NOT sufficient, which is why
 * `confirmCompletedAtSignwell()` below exists and why the routes call it before
 * writing. The authoritative status is re-read from SignWell's own API over TLS
 * with our API key; the webhook body is treated purely as a hint about which
 * document to go and ask about. That makes a forged or replayed body inert
 * regardless of the hash scheme's weakness.
 */

import crypto from 'crypto'

/** How stale a signed event may be before we refuse it (bounds replay of an
 *  observed triple). Generous enough for SignWell's own delivery retries. */
export const SIGNWELL_EVENT_MAX_AGE_MS = 24 * 60 * 60 * 1000

export type SignwellVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'unconfigured' | 'missing-hash' | 'bad-hash' | 'stale' | 'malformed' }

/**
 * Verify `event.hash`.
 *
 * FAILS CLOSED when SIGNWELL_WEBHOOK_ID is unset.
 *
 * This used to say it "deliberately differs from /api/webhooks/quo, which skips
 * verification when its secret is missing". That stopped being true when link 22
 * closed the unset-secret hole there, and the whole inbound edge now fails closed
 * in production through `lib/inboundWebhookVerify.ts` — so the rule is uniform
 * rather than special to this surface. A comment describing ANOTHER module's
 * behaviour is a fact nothing is checking (rule 11's shape, rule 8's failure
 * mode); this one was stale for a day and was found by the next person to read
 * it, which is exactly how long it takes.
 */
export function verifySignwellEvent(
  payload: unknown,
  now: number = Date.now()
): SignwellVerifyResult {
  const webhookId = process.env.SIGNWELL_WEBHOOK_ID
  if (!webhookId) return { ok: false, reason: 'unconfigured' }

  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'malformed' }
  const event = (payload as Record<string, unknown>).event
  if (!event || typeof event !== 'object') return { ok: false, reason: 'malformed' }

  const { type, time, hash } = event as Record<string, unknown>
  if (typeof type !== 'string' || !type) return { ok: false, reason: 'malformed' }
  if (typeof hash !== 'string' || !hash) return { ok: false, reason: 'missing-hash' }
  if (typeof time !== 'number' && typeof time !== 'string') return { ok: false, reason: 'malformed' }

  // SignWell concatenates the RAW time exactly as it serialises it, so sign the
  // string form we received rather than a reparsed number.
  const timeStr = String(time)
  const data = `${type}@${timeStr}`
  const expected = crypto.createHmac('sha256', webhookId).update(data).digest('hex')

  const a = Buffer.from(hash.toLowerCase(), 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad-hash' }
  }

  // Bound replay of a genuine triple. event.time is unix SECONDS.
  const seconds = Number(timeStr)
  if (!Number.isFinite(seconds)) return { ok: false, reason: 'malformed' }
  const ageMs = now - seconds * 1000
  if (ageMs > SIGNWELL_EVENT_MAX_AGE_MS || ageMs < -SIGNWELL_EVENT_MAX_AGE_MS) {
    return { ok: false, reason: 'stale' }
  }

  return { ok: true }
}

export interface ParsedSignwellEvent {
  eventType: string
  documentId: string | null
  status: string | null
  metadata: Record<string, unknown>
  docType: string | null
  bookingRef: string | null
  releaseId: string | null
}

/**
 * Normalise the several shapes a SignWell payload arrives in into one struct.
 * Previously open-coded identically in three routes (rule 11).
 *
 * Every extracted field is type-checked: a non-string `id` used to flow
 * straight into a PostgREST `.eq()` filter.
 */
export function parseSignwellEvent(payload: unknown): ParsedSignwellEvent {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const event = (p.event as Record<string, unknown> | undefined) || {}

  const eventType = str(event.type) ?? str(p.type) ?? ''

  const dataObj = (p.data as Record<string, unknown> | undefined)?.object as
    | Record<string, unknown>
    | undefined
  const doc =
    dataObj ||
    (p.data as Record<string, unknown> | undefined) ||
    (p.document as Record<string, unknown> | undefined) ||
    {}

  const metadata = (doc.metadata as Record<string, unknown> | undefined) || {}

  return {
    eventType,
    documentId: str(doc.id),
    status: str(doc.status),
    metadata,
    docType: str(metadata.type),
    bookingRef: str(metadata.booking_ref),
    releaseId: str(metadata.release_id),
  }
}

/** Only a non-empty string survives; anything else becomes null. */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/** Does this event even claim to be a completion? */
export function claimsCompletion(parsed: ParsedSignwellEvent): boolean {
  return (
    parsed.eventType === 'document_completed' ||
    parsed.eventType === 'document_signed' ||
    parsed.status?.toLowerCase() === 'completed'
  )
}

export type CompletionCheck =
  | { kind: 'completed'; metadata: Record<string, unknown>; bookingRef: string | null; releaseId: string | null }
  | { kind: 'not-completed'; status: string | null }
  | { kind: 'unavailable'; error: string }

/**
 * Ask SignWell directly whether this document really is complete.
 *
 * This is the actual authorization for the write, not the hash — see the file
 * header. The body told us WHICH document; SignWell tells us its TRUE state.
 *
 * Rule 12: three outcomes, not two. A network blip is 'unavailable' and must
 * NOT be collapsed into "not completed" — the caller answers 5xx so SignWell
 * redelivers, rather than silently dropping a real signature.
 */
export async function confirmCompletedAtSignwell(documentId: string): Promise<CompletionCheck> {
  const key = process.env.SIGNWELL_API_KEY
  if (!key) return { kind: 'unavailable', error: 'SIGNWELL_API_KEY not set' }

  let res: Response
  try {
    res = await fetch(
      `https://www.signwell.com/api/v1/documents/${encodeURIComponent(documentId)}/`,
      { headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return { kind: 'unavailable', error: err instanceof Error ? err.message : 'fetch failed' }
  }

  if (res.status === 404) return { kind: 'not-completed', status: 'not-found' }
  if (!res.ok) return { kind: 'unavailable', error: `SignWell GET document ${res.status}` }

  let data: { status?: unknown; metadata?: unknown }
  try {
    data = (await res.json()) as { status?: unknown; metadata?: unknown }
  } catch {
    return { kind: 'unavailable', error: 'SignWell returned unparseable JSON' }
  }

  const status = typeof data.status === 'string' ? data.status : null
  // SignWell reports 'Completed' (capitalised) on the document resource.
  if (status?.toLowerCase() !== 'completed') return { kind: 'not-completed', status }

  // The metadata is taken from SIGNWELL'S OWN RESPONSE, never from the POST
  // body. metadata.booking_ref decides which customer's waiver gets marked
  // signed, so it must come from the authenticated channel — a body-supplied
  // booking_ref was how a forged request could mark the WRONG booking signed.
  const metadata =
    data.metadata && typeof data.metadata === 'object'
      ? (data.metadata as Record<string, unknown>)
      : {}

  return {
    kind: 'completed',
    metadata,
    bookingRef: str(metadata.booking_ref),
    releaseId: str(metadata.release_id),
  }
}
