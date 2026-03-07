/**
 * Twilio SMS/MMS wrapper.
 * Uses REST API directly — no SDK dependency.
 * Base URL: https://api.twilio.com/2010-04-01/Accounts/{SID}
 * Auth: HTTP Basic — AccountSid:AuthToken (lazy-read from env vars).
 */

function twilioBase(): string {
  const sid = process.env.TWILIO_ACCOUNT_SID
  if (!sid) throw new Error('TWILIO_ACCOUNT_SID is not set')
  return `https://api.twilio.com/2010-04-01/Accounts/${sid}`
}

function twilioAuthHeader(): string {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is not set')
  return `Basic ${btoa(`${sid}:${token}`)}`
}

function twilioFrom(): string {
  const from = process.env.TWILIO_PHONE_NUMBER
  if (!from) throw new Error('TWILIO_PHONE_NUMBER is not set')
  return from
}

interface TwilioMessageResponse {
  sid: string
  status: string
  error_code?: string | null
  error_message?: string | null
}

/**
 * Send an SMS message.
 * POST /Messages.json with form-encoded body.
 * Returns the Twilio message SID on success, null on error.
 */
export async function sendSMS(to: string, body: string): Promise<string | null> {
  try {
    const res = await fetch(`${twilioBase()}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: twilioAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: twilioFrom(),
        To: to,
        Body: body,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('twilio:sendSMS error:', res.status, text)
      return null
    }

    const data = (await res.json()) as TwilioMessageResponse

    if (data.error_code) {
      console.error('twilio:sendSMS message error:', data.error_code, data.error_message)
      return null
    }

    return data.sid
  } catch (err) {
    console.error('twilio:sendSMS exception:', err)
    return null
  }
}

/**
 * Send an MMS message with a media attachment.
 * POST /Messages.json with MediaUrl included.
 * Returns the Twilio message SID on success, null on error.
 */
export async function sendMMS(
  to: string,
  body: string,
  mediaUrl: string
): Promise<string | null> {
  try {
    const res = await fetch(`${twilioBase()}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: twilioAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: twilioFrom(),
        To: to,
        Body: body,
        MediaUrl: mediaUrl,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('twilio:sendMMS error:', res.status, text)
      return null
    }

    const data = (await res.json()) as TwilioMessageResponse

    if (data.error_code) {
      console.error('twilio:sendMMS message error:', data.error_code, data.error_message)
      return null
    }

    return data.sid
  } catch (err) {
    console.error('twilio:sendMMS exception:', err)
    return null
  }
}

/**
 * Send SMS messages to multiple contacts in sequence.
 *
 * A delay is inserted between each send (default 1000ms) to avoid hitting
 * Twilio's rate limits. Each message body can be personalized per contact.
 *
 * Returns an array of results in the same order as `contacts`:
 *   - message SID string on success
 *   - null if that individual send failed
 */
export async function sendBulkSMS(
  contacts: { phone: string; body: string }[],
  batchDelayMs = 1000
): Promise<(string | null)[]> {
  const results: (string | null)[] = []

  for (let i = 0; i < contacts.length; i++) {
    const { phone, body } = contacts[i]
    const sid = await sendSMS(phone, body)
    results.push(sid)

    // Delay between sends — skip after the final message
    if (i < contacts.length - 1) {
      await new Promise<void>(resolve => setTimeout(resolve, batchDelayMs))
    }
  }

  return results
}
