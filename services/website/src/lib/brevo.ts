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
 * Uses PUT /contacts/{email} which is idempotent (upsert semantics).
 * Returns the contact email on success, null on error.
 */
export async function syncContactToBrevo(
  email: string,
  attributes: BrevoContactAttributes
): Promise<string | null> {
  try {
    const res = await fetch(
      `${BREVO_BASE}/contacts/${encodeURIComponent(email)}`,
      {
        method: 'PUT',
        headers: brevoHeaders(),
        body: JSON.stringify({ attributes }),
      }
    )

    // 204 No Content = updated, 201 Created = new contact
    if (!res.ok && res.status !== 204) {
      const body = await res.text()
      console.error('brevo:syncContact error:', res.status, body)
      return null
    }

    return email
  } catch (err) {
    console.error('brevo:syncContact exception:', err)
    return null
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
 * Create an email campaign and either send it immediately or schedule it.
 *
 * If scheduledAt is provided (ISO 8601 string), the campaign is scheduled
 * via the campaign's scheduledAt field. Otherwise, POST /sendNow is called
 * immediately after creation.
 *
 * Returns the campaign ID on success, null on error.
 */
export async function sendCampaign(
  listId: number,
  subject: string,
  htmlContent: string,
  senderName = 'Host Hampton',
  scheduledAt?: string
): Promise<number | null> {
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
      return null
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
        // Campaign was created but send failed — still return the id so caller
        // can retry or inspect.
        return id
      }
    }

    return id
  } catch (err) {
    console.error('brevo:sendCampaign exception:', err)
    return null
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
