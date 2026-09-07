import { getSupabase } from '@/lib/supabase'
import { sendSMSVia, normalizePhone } from '@/lib/sms'
import {
  generateCheckinToken,
  buildCheckinUrl,
  getCheckinSecret,
  hashCheckinToken,
  isExpiredForParty,
} from '@/lib/checkinAuth'

/**
 * Minting and texting the pre-arrival check-in link.
 *
 * Shared by the admin "Send check-in link" button and the two scheduled sends,
 * so the wording and the token lifetime can't drift between them.
 */

/**
 * Marks a SignWell document as belonging to the check-in flow. SignWell
 * webhooks are account-wide, so every handler filters on metadata.type.
 */
export const CHECKIN_DOC_TYPE = 'party_checkin'

/** Mint a fresh token for a booking and persist only its hash. */
export async function mintCheckinLink(bookingId: string): Promise<string> {
  const supabase = getSupabase()
  const { token, hash, expiresAt } = generateCheckinToken(getCheckinSecret())

  const { error } = await supabase.from('checkin_tokens').insert({
    booking_id: bookingId,
    token_hash: hash,
    expires_at: expiresAt.toISOString(),
  })
  if (error) throw new Error(`Failed to store check-in token: ${error.message}`)

  return buildCheckinUrl(token)
}

export type CheckinResolution =
  | { ok: true; booking: Record<string, unknown> }
  | { ok: false; reason: 'invalid' | 'expired' }

/**
 * Resolve a raw check-in token to its booking.
 *
 * Looks the row up BY HASH — the raw token is never stored, so a database read
 * cannot be replayed as a working link. Returns a flat 'invalid' for anything
 * that doesn't resolve, so the caller cannot distinguish "no such token" from
 * "wrong token" and nothing about the booking leaks before validation.
 */
export async function resolveCheckinToken(rawToken: string): Promise<CheckinResolution> {
  if (!rawToken || rawToken.length < 32) return { ok: false, reason: 'invalid' }

  const supabase = getSupabase()
  const hash = hashCheckinToken(rawToken, getCheckinSecret())

  const { data: tokenRow } = await supabase
    .from('checkin_tokens')
    .select('id, booking_id, expires_at')
    .eq('token_hash', hash)
    .maybeSingle()

  if (!tokenRow) return { ok: false, reason: 'invalid' }

  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' }
  }

  const { data: booking } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', tokenRow.booking_id)
    .single()

  if (!booking) return { ok: false, reason: 'invalid' }

  // The party is the real deadline: once it's over there is nothing left to
  // collect, and the link should stop showing anyone's details.
  if (isExpiredForParty(booking.party_date as string | null)) {
    return { ok: false, reason: 'expired' }
  }

  return { ok: true, booking }
}

export function buildCheckinSmsBody(contactName: string | null, url: string): string {
  const firstName = (contactName || '').trim().split(/\s+/)[0] || 'there'
  return `Hi ${firstName}! Before your Host Hampton party, please complete your quick check-in — contact details and your rental agreement: ${url} Reply STOP to opt out`
}

/**
 * Has this contact explicitly opted out of SMS?
 *
 * The `sms_opt_in` boolean conflates "never opted in to marketing" with "texted
 * STOP", and the check-in link is transactional — it is about a party the
 * customer has already booked and paid a deposit on. So we do NOT gate it on
 * marketing consent, but we absolutely must honour a real STOP.
 *
 * The STOP handlers (webhooks/twilio, webhooks/quo) record an
 * `sms_unsubscribed` contact_interaction, which is the only durable signal that
 * distinguishes the two. Errs toward "opted out" if the lookup fails.
 */
export async function hasExplicitSmsOptOut(contactId: string): Promise<boolean> {
  try {
    const supabase = getSupabase()

    const { data: contact, error: contactErr } = await supabase
      .from('contacts')
      .select('sms_opt_in, sms_opt_in_at')
      .eq('id', contactId)
      .maybeSingle()

    if (contactErr || !contact) {
      console.error('checkin:optout lookup error — treating as opted out:', contactErr)
      return true
    }

    // Signal 1: they opted in at some point and the flag is now false. Only a
    // STOP does that, so this is a genuine opt-out. A contact who simply never
    // ticked the marketing box has sms_opt_in_at NULL and is NOT opted out.
    if (contact.sms_opt_in === false && contact.sms_opt_in_at) return true

    // Signal 2: an explicit opt-out audit row. Historically these inserts
    // failed a CHECK constraint (fixed in migration 031), so this catches
    // opt-outs going forward and cannot be relied on for older ones — hence
    // signal 1 above.
    const { data: optOut } = await supabase
      .from('contact_interactions')
      .select('id')
      .eq('contact_id', contactId)
      .eq('type', 'sms_unsubscribed')
      .limit(1)

    return (optOut?.length ?? 0) > 0
  } catch (err) {
    console.error('checkin:optout error — treating as opted out:', err)
    return true
  }
}

/**
 * Mint a link and text it. Returns the provider message id, or null if it
 * couldn't be sent. Transactional → pinned to Quo, matching the portal link.
 */
export async function sendCheckinLinkSms(
  booking: { id: string; contact_name: string | null; contact_phone: string | null }
): Promise<{ sent: boolean; url: string | null; reason?: string }> {
  if (!booking.contact_phone) {
    return { sent: false, url: null, reason: 'no phone number on file' }
  }

  const url = await mintCheckinLink(booking.id)
  const body = buildCheckinSmsBody(booking.contact_name, url)
  const sid = await sendSMSVia('quo', normalizePhone(booking.contact_phone), body)

  return sid
    ? { sent: true, url }
    : { sent: false, url, reason: 'SMS provider rejected the send' }
}
