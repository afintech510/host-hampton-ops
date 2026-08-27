/**
 * SMS provider router.
 *
 * Exposes the same send surface as ./twilio.ts (sendSMS / sendMMS / sendBulkSMS)
 * but delegates to a provider chosen by the SMS_PROVIDER env var:
 *   - 'twilio' (default) — current live path, unchanged behavior
 *   - 'quo'             — send via Quo (./quo.ts)
 *
 * Migration path: all app call sites import from here instead of ./twilio, so
 * flipping transactional (then marketing) SMS to Quo is a single env change.
 * Until SMS_PROVIDER is set to 'quo', every send goes through Twilio exactly
 * as before.
 *
 * MMS is ALWAYS sent via Twilio — Quo's message API has no media support.
 */

import {
  sendSMS as sendSMSViaTwilio,
  sendMMS as sendMMSViaTwilio,
  normalizePhone,
} from './twilio'
import { sendSMSViaQuo } from './quo'

export { normalizePhone }

export type SmsProvider = 'twilio' | 'quo'

export function getSmsProvider(): SmsProvider {
  return process.env.SMS_PROVIDER === 'quo' ? 'quo' : 'twilio'
}

/**
 * Send a single SMS via a specific provider (bypasses SMS_PROVIDER).
 * Used by the test endpoint to exercise Quo without changing the global default.
 */
export async function sendSMSVia(
  provider: SmsProvider,
  to: string,
  body: string
): Promise<string | null> {
  return provider === 'quo' ? sendSMSViaQuo(to, body) : sendSMSViaTwilio(to, body)
}

/** Send a single SMS via the configured provider. */
export async function sendSMS(to: string, body: string): Promise<string | null> {
  return sendSMSVia(getSmsProvider(), to, body)
}

/**
 * Send an MMS. Always uses Twilio — Quo has no media/MMS API.
 * Kept here so call sites have one import surface for all messaging.
 */
export async function sendMMS(
  to: string,
  body: string,
  mediaUrls: string | string[]
): Promise<string | null> {
  if (getSmsProvider() === 'quo') {
    console.warn('sms:sendMMS — SMS_PROVIDER=quo but Quo has no MMS; sending via Twilio')
  }
  return sendMMSViaTwilio(to, body, mediaUrls)
}

/**
 * Send SMS/MMS to multiple contacts in sequence.
 * - If mediaUrls are provided → MMS → Twilio (per contact).
 * - Otherwise → SMS via the configured provider (per contact).
 * Returns per-contact results (message id or null) in input order.
 */
export async function sendBulkSMS(
  contacts: { phone: string; body: string }[],
  batchDelayMs = 1000,
  mediaUrls?: string[],
  providerOverride?: SmsProvider
): Promise<(string | null)[]> {
  const results: (string | null)[] = []
  const provider = providerOverride ?? getSmsProvider()
  const isMms = !!(mediaUrls && mediaUrls.length > 0)

  for (let i = 0; i < contacts.length; i++) {
    const { phone, body } = contacts[i]
    const id = isMms
      ? await sendMMSViaTwilio(phone, body, mediaUrls!) // MMS → Twilio always
      : await sendSMSVia(provider, phone, body)
    results.push(id)

    if (i < contacts.length - 1) {
      await new Promise<void>(resolve => setTimeout(resolve, batchDelayMs))
    }
  }

  return results
}
