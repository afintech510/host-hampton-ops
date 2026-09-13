/**
 * Brevo (formerly Sendinblue) email marketing API wrapper.
 * Uses REST API directly — no SDK dependency.
 * Base URL: https://api.brevo.com/v3
 * Auth: api-key header (lazy-read from BREVO_API_KEY).
 */

const BREVO_BASE = 'https://api.brevo.com/v3'

function brevoHeaders(): Record<string, string> {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) throw new Error('BREVO_API_KEY is not set')
  return {
    'api-key': apiKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

export interface BrevoContactAttributes {
  FIRSTNAME: string
  LASTNAME: string
  PHONE?: string
  TAGS?: string
}

/**
 * Create or update a Brevo contact by email.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS USED TO BE `PUT /contacts/{email}`, under a comment reading *"which is
 * idempotent (upsert semantics)"*. It is not. Measured against the live Brevo
 * API on 2026-09-12 with a throwaway address:
 *
 *     PUT /v3/contacts/hh-link17-probe@example.com  ->  404
 *     {"code":"document_not_found","message":"Contact does not exist"}
 *
 * — six times, with and without the PHONE attribute, with and without names.
 * **`PUT` is UPDATE-ONLY.** So this function could never create a contact, and
 * every new lead this business has ever captured failed to reach Brevo and was
 * logged `brevo:upsert` into `contacts.sync_error`, where nothing read it.
 * Measured the same day: Brevo holds **956** contacts, all created in one of two
 * bulk import batches (869 on 2026-03-09, 87 on 2026-08-27), and **253 of the
 * 1209 people in our own table are addresses Brevo has never heard of.**
 *
 * `POST /contacts` with `updateEnabled: true` is the real upsert, and that was
 * measured too: **201** on a fresh address, **204** on a repeat of the same one.
 * Rule 8 — do not trust a stated guarantee, ask the provider.
 *
 * Brevo normalises addresses to lower case (0 of its 956 are mixed), so it is
 * already immune to the duplicate this codebase was creating locally. Nothing
 * here may lowercase on the way out and then write that back to `contacts`.
 */
export type BrevoUpsertResult =
  | { kind: 'synced'; email: string; created: boolean }
  | { kind: 'error'; status: number | null; error: string }

export async function upsertBrevoContact(
  email: string,
  attributes: BrevoContactAttributes
): Promise<BrevoUpsertResult> {
  try {
    const res = await fetch(`${BREVO_BASE}/contacts`, {
      method: 'POST',
      headers: brevoHeaders(),
      body: JSON.stringify({ email, attributes, updateEnabled: true }),
    })

    // 201 Created = new contact, 204 No Content = existing contact updated.
    if (!res.ok && res.status !== 204) {
      const body = await res.text()
      console.error('brevo:upsertContact error:', res.status, body.slice(0, 300))
      return { kind: 'error', status: res.status, error: `${res.status}: ${body.slice(0, 200)}` }
    }

    return { kind: 'synced', email, created: res.status === 201 }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error('brevo:upsertContact exception:', error)
    return { kind: 'error', status: null, error }
  }
}

/**
 * Delete a contact from Brevo by email.
 * Returns true on success (including 404 — already gone), null on error.
 */
export async function removeFromBrevo(email: string): Promise<true | null> {
  try {
    const res = await fetch(
      `${BREVO_BASE}/contacts/${encodeURIComponent(email)}`,
      {
        method: 'DELETE',
        headers: brevoHeaders(),
      }
    )

    if (!res.ok && res.status !== 404) {
      const body = await res.text()
      console.error('brevo:removeContact error:', res.status, body)
      return null
    }

    return true
  } catch (err) {
    console.error('brevo:removeContact exception:', err)
    return null
  }
}

/**
 * Add a contact to a Brevo list by list ID.
 * POST /contacts/lists/{listId}/contacts/add
 * Returns true on success, null on error.
 */
export async function addToList(
  email: string,
  listId: number
): Promise<true | null> {
  try {
    const res = await fetch(
      `${BREVO_BASE}/contacts/lists/${listId}/contacts/add`,
      {
        method: 'POST',
        headers: brevoHeaders(),
        body: JSON.stringify({ emails: [email] }),
      }
    )

    if (!res.ok) {
      const body = await res.text()
      console.error('brevo:addToList error:', res.status, body)
      return null
    }

    return true
  } catch (err) {
    console.error('brevo:addToList exception:', err)
    return null
  }
}

/**
 * Remove a contact from a Brevo list by list ID.
 * POST /contacts/lists/{listId}/contacts/remove
 * Returns true on success, null on error.
 */
export async function removeFromList(
  email: string,
  listId: number
): Promise<true | null> {
  try {
    const res = await fetch(
      `${BREVO_BASE}/contacts/lists/${listId}/contacts/remove`,
      {
        method: 'POST',
        headers: brevoHeaders(),
        body: JSON.stringify({ emails: [email] }),
      }
    )

    if (!res.ok) {
      const body = await res.text()
      console.error('brevo:removeFromList error:', res.status, body)
      return null
    }

    return true
  } catch (err) {
    console.error('brevo:removeFromList exception:', err)
    return null
  }
}

export interface CampaignStats {
  id: number
  name: string
  status: string
  statistics?: {
    globalStats?: {
      uniqueClicks: number
      clickers: number
      complaints: number
      delivered: number
      sent: number
      softBounces: number
      hardBounces: number
      uniqueViews: number
      unsubscriptions: number
    }
  }
}

/**
 * The three things a campaign send can come back as.
 *
 * The old signature was `Promise<number | null>` and the caller read a number as
 * "sent" — but the function returned the id after a FAILED `/sendNow` too, with
 * a comment saying "still return the id so caller can retry or inspect". No
 * caller inspected. `/api/cron/send-campaigns` wrote `status: 'sent'` and a
 * `brevo_campaign_id` for a campaign that exists at Brevo and was never
 * delivered to anybody — the same collapse of two outcomes into one value that
 * hard-won rule 12 is about, on the path that reports to Adam whether 944 people
 * heard from him.
 */
export type CampaignSendResult =
  | { kind: 'sent'; id: number }
  /** Created at Brevo, delivery not confirmed. A human must look. */
  | { kind: 'created_not_sent'; id: number; error: string }
  | { kind: 'failed'; error: string }

/**
 * Create an email campaign and either send it immediately or schedule it.
 *
 * If scheduledAt is provided (ISO 8601 string), the campaign is scheduled
 * via the campaign's scheduledAt field. Otherwise, POST /sendNow is called
 * immediately after creation.
 */
export async function sendCampaign(
  listId: number,
  subject: string,
  htmlContent: string,
  senderName = 'Host Hampton',
  scheduledAt?: string
): Promise<CampaignSendResult> {
  try {
    const headers = brevoHeaders()

    // Step 1 — create the campaign
    const campaignBody: Record<string, unknown> = {
      name: subject,
      subject,
      sender: {
        name: senderName,
        email: process.env.BREVO_SENDER_EMAIL ?? 'hosthampton295@gmail.com',
      },
      type: 'classic',
      htmlContent,
      recipients: { listIds: [listId] },
    }

    if (scheduledAt) {
      campaignBody.scheduledAt = scheduledAt
    }

    const createRes = await fetch(`${BREVO_BASE}/emailCampaigns`, {
      method: 'POST',
      headers,
      body: JSON.stringify(campaignBody),
    })

    if (!createRes.ok) {
      const body = await createRes.text()
      console.error('brevo:sendCampaign create error:', createRes.status, body)
      return { kind: 'failed', error: `create ${createRes.status}: ${body.slice(0, 300)}` }
    }

    const { id } = await createRes.json() as { id: number }

    // Step 2 — send now if no schedule was given
    if (!scheduledAt) {
      const sendRes = await fetch(
        `${BREVO_BASE}/emailCampaigns/${id}/sendNow`,
        { method: 'POST', headers }
      )

      if (!sendRes.ok) {
        const body = await sendRes.text()
        console.error('brevo:sendCampaign sendNow error:', sendRes.status, body)
        // Created but NOT delivered. Naming that distinctly is the whole point:
        // the campaign exists at Brevo and retrying create would make a second.
        return { kind: 'created_not_sent', id, error: `sendNow ${sendRes.status}: ${body.slice(0, 300)}` }
      }
    }

    return { kind: 'sent', id }
  } catch (err) {
    console.error('brevo:sendCampaign exception:', err)
    return { kind: 'failed', error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Send a single transactional email via Brevo (for test sends).
 * POST /smtp/email — does NOT create a campaign.
 * Returns true on success, false on error.
 */
export async function sendTransactionalEmail(
  to: string,
  subject: string,
  htmlContent: string,
  senderName = 'Host Hampton'
): Promise<boolean> {
  try {
    const res = await fetch(`${BREVO_BASE}/smtp/email`, {
      method: 'POST',
      headers: brevoHeaders(),
      body: JSON.stringify({
        to: [{ email: to }],
        subject,
        htmlContent,
        sender: {
          name: senderName,
          email: process.env.BREVO_SENDER_EMAIL ?? 'hosthampton295@gmail.com',
        },
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error('brevo:sendTransactionalEmail error:', res.status, body)
      return false
    }

    return true
  } catch (err) {
    console.error('brevo:sendTransactionalEmail exception:', err)
    return false
  }
}

/**
 * Fetch statistics for an existing campaign.
 * GET /emailCampaigns/{campaignId}
 * Returns the campaign stats object or null on error.
 */
export async function getCampaignStats(
  campaignId: number
): Promise<CampaignStats | null> {
  try {
    const res = await fetch(`${BREVO_BASE}/emailCampaigns/${campaignId}`, {
      headers: brevoHeaders(),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error('brevo:getCampaignStats error:', res.status, body)
      return null
    }

    return (await res.json()) as CampaignStats
  } catch (err) {
    console.error('brevo:getCampaignStats exception:', err)
    return null
  }
}

/**
 * Suspend (cancel) a Brevo campaign that is queued or in progress.
 * PUT /emailCampaigns/{campaignId}/status with { status: "suspended" }
 * Returns true if suspended, false if already completed or error.
 */
export async function cancelCampaign(campaignId: number): Promise<boolean> {
  try {
    const res = await fetch(`${BREVO_BASE}/emailCampaigns/${campaignId}/status`, {
      method: 'PUT',
      headers: brevoHeaders(),
      body: JSON.stringify({ status: 'suspended' }),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error('brevo:cancelCampaign error:', res.status, body)
      return false
    }

    return true
  } catch (err) {
    console.error('brevo:cancelCampaign exception:', err)
    return false
  }
}
