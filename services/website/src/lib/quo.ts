/**
 * Quo (formerly Grasshopper / OpenPhone) SMS wrapper.
 * Uses REST API directly — no SDK dependency.
 * Base URL: https://api.quo.com/v1
 * Auth: raw API key in the Authorization header (NOT a Bearer token).
 *
 * Mirrors the send surface of ./twilio.ts so it can sit behind ./sms.ts.
 * NOTE: Quo's message API is SMS-only — there is no media/MMS field, so MMS
 * always stays on Twilio (see ./sms.ts).
 *
 * Requirements before live US delivery works:
 *  - QUO_API_KEY, QUO_PHONE_NUMBER (phone-number id "PN..." or E.164) set.
 *  - The workspace's US Carrier Registration (A2P 10DLC) approved, or sends 400.
 *  - A positive Quo prepaid credit balance, or sends error.
 */

import { normalizePhone } from './twilio'

const QUO_BASE = 'https://api.quo.com/v1'

function quoAuthHeader(): string {
  const key = process.env.QUO_API_KEY
  if (!key) throw new Error('QUO_API_KEY is not set')
  return key // Quo does NOT use a Bearer prefix
}

function quoFrom(): string {
  const from = process.env.QUO_PHONE_NUMBER
  if (!from) throw new Error('QUO_PHONE_NUMBER is not set')
  return from
}

interface QuoMessageResponse {
  // Quo/OpenPhone returns the created message under `data`.
  data?: { id?: string; status?: string }
  id?: string
  status?: string
}

/**
 * Send an SMS message via Quo.
 * POST /v1/messages with a JSON body. Responds 202 Accepted.
 * Returns the Quo message id on success, null on error.
 */
export async function sendSMSViaQuo(to: string, body: string): Promise<string | null> {
  // E2E: don't hit Quo. Log and return a fake id so flows complete.
  if (process.env.E2E_FAKE_SENDERS === '1') {
    console.log('[E2E_FAKE_SENDERS] sendSMSViaQuo', { to, body })
    return 'QUOfake0000000000000000000000000000'
  }
  try {
    const payload: Record<string, unknown> = {
      content: body,
      from: quoFrom(),
      to: [normalizePhone(to)],
    }
    if (process.env.QUO_USER_ID) payload.userId = process.env.QUO_USER_ID

    const res = await fetch(`${QUO_BASE}/messages`, {
      method: 'POST',
      headers: {
        Authorization: quoAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const text = await res.text()
      // 400 = A2P not approved, 402 = subscription/credit issue — surface clearly.
      console.error('quo:sendSMS error:', res.status, text)
      return null
    }

    const data = (await res.json()) as QuoMessageResponse
    return data.data?.id ?? data.id ?? null
  } catch (err) {
    console.error('quo:sendSMS exception:', err)
    return null
  }
}

/* ── Reading a text thread ───────────────────────────────────────────────
 *
 * Our own database has every INBOUND text (the webhook records it) but not the
 * ones sent from the Quo app by hand, so the only complete two-way thread is
 * Quo's. `GET /v1/messages?phoneNumberId=…&participants=<number>` returns
 * `{ data: [{ id, text, direction: 'incoming'|'outgoing', createdAt, status,
 * media }], totalItems, nextPageToken }` (shape measured against the live
 * workspace 2026-11-05). READ ONLY: nothing here sends or marks anything.
 */

export interface QuoThreadMessage {
  id: string
  /** ISO timestamp. */
  at: string
  direction: 'in' | 'out'
  text: string
  hasMedia: boolean
  status: string | null
}

export type QuoThread =
  | { kind: 'ok'; messages: QuoThreadMessage[] }
  | { kind: 'unconfigured' }
  | { kind: 'unavailable'; reason: string }

let cachedPhoneNumberId: string | null = null

/** `QUO_PHONE_NUMBER` is either the `PN…` id or the E.164 number; the messages API wants the id. */
async function quoPhoneNumberId(signal: AbortSignal): Promise<string | null> {
  const configured = process.env.QUO_PHONE_NUMBER
  if (!configured) return null
  if (/^PN/i.test(configured)) return configured
  if (cachedPhoneNumberId) return cachedPhoneNumberId
  const res = await fetch(`${QUO_BASE}/phone-numbers`, { headers: { Authorization: quoAuthHeader() }, signal })
  if (!res.ok) return null
  const json = (await res.json().catch(() => null)) as { data?: Array<{ id?: string; number?: string }> } | null
  const want = normalizePhone(configured)
  const hit = json?.data?.find(p => p.number && normalizePhone(p.number) === want)
  cachedPhoneNumberId = hit?.id ?? null
  return cachedPhoneNumberId
}

/**
 * The most recent messages exchanged with one number, oldest first. Three
 * outcomes: a failed read is `unavailable`, never an empty thread.
 */
export async function fetchQuoThread(phone: string, opts: { limit?: number } = {}): Promise<QuoThread> {
  if (!process.env.QUO_API_KEY || !process.env.QUO_PHONE_NUMBER) return { kind: 'unconfigured' }
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? 30), 1), 50)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 8000)
  try {
    const phoneNumberId = await quoPhoneNumberId(ctl.signal)
    if (!phoneNumberId) return { kind: 'unavailable', reason: 'Could not resolve the studio number in Quo.' }
    const qs = new URLSearchParams({ phoneNumberId, maxResults: String(limit) })
    qs.append('participants', normalizePhone(phone))
    const res = await fetch(`${QUO_BASE}/messages?${qs}`, { headers: { Authorization: quoAuthHeader() }, signal: ctl.signal })
    if (!res.ok) return { kind: 'unavailable', reason: `Quo answered ${res.status}.` }
    const json = (await res.json().catch(() => null)) as {
      data?: Array<{ id?: string; text?: string; direction?: string; createdAt?: string; status?: string; media?: unknown[] }>
    } | null
    if (!json || !Array.isArray(json.data)) return { kind: 'unavailable', reason: 'Quo returned something unreadable.' }
    const messages: QuoThreadMessage[] = json.data
      .filter(m => typeof m.createdAt === 'string')
      .map(m => ({
        id: String(m.id ?? ''),
        at: m.createdAt as string,
        direction: m.direction === 'outgoing' ? ('out' as const) : ('in' as const),
        text: typeof m.text === 'string' ? m.text : '',
        hasMedia: Array.isArray(m.media) && m.media.length > 0,
        status: typeof m.status === 'string' ? m.status : null,
      }))
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    return { kind: 'ok', messages }
  } catch (err) {
    console.error('quo:fetchThread exception:', err instanceof Error ? err.message : err)
    return { kind: 'unavailable', reason: 'Could not reach Quo.' }
  } finally {
    clearTimeout(timer)
  }
}

export interface QuoContactInput {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  phone?: string | null
  /** Our contacts.id — stored as Quo externalId so re-syncs update, not duplicate. */
  externalId: string
  company?: string | null
}

/**
 * Create or update a Quo contact so every number the agent texts is a named
 * contact in the Host Hampton inbox (Quo is OpenPhone-API compatible:
 * POST /v1/contacts, PATCH /v1/contacts/{id}).
 *
 * Returns the Quo contact id, or null on error / when Quo isn't configured.
 * Non-fatal by design — callers must not block on this.
 */
export async function upsertQuoContact(
  input: QuoContactInput,
  existingQuoId?: string | null,
): Promise<string | null> {
  if (!process.env.QUO_API_KEY) return null
  if (process.env.E2E_FAKE_SENDERS === '1') return 'QUOfakecontact'
  if (!input.phone && !input.email) return null

  const defaultFields: Record<string, unknown> = {
    firstName: input.firstName || undefined,
    lastName: input.lastName || undefined,
    company: input.company || undefined,
  }
  if (input.email) defaultFields.emails = [{ name: 'primary', value: input.email }]
  if (input.phone) defaultFields.phoneNumbers = [{ name: 'primary', value: normalizePhone(input.phone) }]

  const payload: Record<string, unknown> = {
    defaultFields,
    source: 'hosthampton.com',
    externalId: input.externalId,
  }

  try {
    const url = existingQuoId ? `${QUO_BASE}/contacts/${existingQuoId}` : `${QUO_BASE}/contacts`
    const res = await fetch(url, {
      method: existingQuoId ? 'PATCH' : 'POST',
      headers: { Authorization: quoAuthHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.status === 409 && !existingQuoId) {
      // "A contact with this externalId already exists." Measured against the
      // live API 2026-09-12: a second POST with the same externalId is 409, not
      // an update — so the comment above ("re-syncs update, not duplicate") was
      // only half true, and this branch is the other half. Reported as an error
      // it was permanent: `quo_contact_id` could never be learned, so every
      // later sync for that contact 409'd again, forever. Recover the id.
      const found = await findQuoContactByExternalId(input.externalId)
      if (found) return found
      console.error('quo:upsertContact 409 but the contact could not be found by externalId')
      return null
    }
    if (!res.ok) {
      const text = await res.text()
      console.error('quo:upsertContact error:', res.status, text)
      return null
    }
    const data = (await res.json()) as { data?: { id?: string }; id?: string }
    return data.data?.id ?? data.id ?? null
  } catch (err) {
    console.error('quo:upsertContact exception:', err)
    return null
  }
}

/**
 * The Quo contact carrying `externalId`, or null.
 *
 * **The query parameter is `externalIds=`, NOT `externalIds[]=`.** Measured
 * against the live API on 2026-09-12 with a real externalId:
 *
 *     GET /v1/contacts?externalIds=<id>     ->  200, 1 row, the right one
 *     GET /v1/contacts?externalIds[]=<id>   ->  200, 10 rows — UNFILTERED
 *
 * Quo ignores the bracketed form rather than refusing it, so the OpenPhone
 * idiom returns a page of strangers while looking like a filter that worked.
 * The id is therefore re-compared here and never trusted to the query — the
 * same rule `lib/contactLookup.ts` applies to `ilike`.
 */
export async function findQuoContactByExternalId(externalId: string): Promise<string | null> {
  if (!process.env.QUO_API_KEY) return null
  try {
    const res = await fetch(
      `${QUO_BASE}/contacts?externalIds=${encodeURIComponent(externalId)}&maxResults=50`,
      { headers: { Authorization: quoAuthHeader() } }
    )
    if (!res.ok) {
      console.error('quo:findByExternalId error:', res.status, (await res.text()).slice(0, 200))
      return null
    }
    const body = (await res.json()) as { data?: { id?: string; externalId?: string }[] }
    const match = (body.data ?? []).find(c => c.externalId === externalId)
    return match?.id ?? null
  } catch (err) {
    console.error('quo:findByExternalId exception:', err)
    return null
  }
}

// ── Conversation status (the dated API) ────────────────────────────────────
//
// Marking a conversation Done lives only in Quo's DATED API: no `/v1` prefix,
// and a `Quo-Api-Version` header instead. Measured 2026-10-08 against the live
// workspace: `POST /conversations/{CN…}/mark-as-done` answers 200 and the thread
// leaves the inbox. Same raw-key Authorization as everything above.

const QUO_DATED_BASE = 'https://api.quo.com'
const QUO_API_VERSION = '2026-03-30'

async function quoDated(method: 'GET' | 'POST', path: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${QUO_DATED_BASE}${path}`, {
    method,
    headers: { Authorization: quoAuthHeader(), 'Quo-Api-Version': QUO_API_VERSION },
  })
  let json: any = null
  try { json = await res.json() } catch { /* empty or non-JSON body */ }
  return { status: res.status, json }
}

export interface QuoMessageRef {
  conversationId: string
  phoneNumberId: string
}

/** The conversation a sent message landed in, or null if it could not be read. */
export async function getQuoMessageRef(messageId: string): Promise<QuoMessageRef | null> {
  try {
    const { status, json } = await quoDated('GET', `/messages/${encodeURIComponent(messageId)}`)
    const d = json?.data
    if (status !== 200 || !d?.conversationId || !d?.phoneNumberId) {
      console.error('quo:getMessage error:', status)
      return null
    }
    return { conversationId: d.conversationId, phoneNumberId: d.phoneNumberId }
  } catch (err) {
    console.error('quo:getMessage exception:', err)
    return null
  }
}

export interface QuoConversation {
  id: string
  lastActivityId: string | null
}

/**
 * Every conversation on one Quo number updated at or after `sinceIso`, keyed by
 * id. Null when ANY page fails — a partial map would read "not listed" for a
 * thread that simply sat on the page that failed.
 */
export async function listQuoConversationsSince(
  phoneNumberId: string,
  sinceIso: string,
): Promise<Map<string, QuoConversation> | null> {
  const out = new Map<string, QuoConversation>()
  let after: string | null = null
  try {
    for (let page = 0; page < 20; page++) {
      const qs = new URLSearchParams({ phoneNumberId, 'updatedAt[gte]': sinceIso, limit: '50' })
      if (after) qs.set('after', after)
      const { status, json } = await quoDated('GET', `/conversations?${qs}`)
      if (status !== 200 || !Array.isArray(json?.data)) {
        console.error('quo:listConversations error:', status)
        return null
      }
      for (const c of json.data) out.set(c.id, { id: c.id, lastActivityId: c.lastActivityId ?? null })
      after = json.nextCursor ?? null
      if (!after) return out
    }
    console.error('quo:listConversations stopped at the 20-page ceiling')
    return null
  } catch (err) {
    console.error('quo:listConversations exception:', err)
    return null
  }
}

/** Move a conversation out of the inbox into Done. Sends nothing to anyone. */
export async function markQuoConversationDone(conversationId: string): Promise<boolean> {
  try {
    const { status } = await quoDated('POST', `/conversations/${encodeURIComponent(conversationId)}/mark-as-done`)
    if (status !== 200) console.error('quo:markDone error:', status)
    return status === 200
  } catch (err) {
    console.error('quo:markDone exception:', err)
    return false
  }
}

/**
 * Send SMS messages to multiple contacts in sequence via Quo.
 *
 * One request per recipient (individual private threads, matching the current
 * marketing behavior). A delay is inserted between sends (default 1100ms) to
 * stay under Quo's 10 requests/second limit.
 *
 * Returns an array of results in the same order as `contacts`:
 *   - message id string on success
 *   - null if that individual send failed
 */
export async function sendBulkSMSViaQuo(
  contacts: { phone: string; body: string }[],
  batchDelayMs = 1100
): Promise<(string | null)[]> {
  const results: (string | null)[] = []

  for (let i = 0; i < contacts.length; i++) {
    const { phone, body } = contacts[i]
    results.push(await sendSMSViaQuo(phone, body))

    // Delay between sends — skip after the final message
    if (i < contacts.length - 1) {
      await new Promise<void>(resolve => setTimeout(resolve, batchDelayMs))
    }
  }

  return results
}
