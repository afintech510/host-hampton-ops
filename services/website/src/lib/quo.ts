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
