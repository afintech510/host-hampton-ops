/**
 * Minting a portal link, and knowing whether it will work.
 *
 * A portal link is `?ref=…&token=…` where the token is verified against a
 * `portal_tokens` row holding its hash. **If that row is not written, the link
 * does not work** — the customer clicks it and is turned away from their own
 * booking.
 *
 * Seven places in the admin surface did this:
 *
 *   const { token, hash, expiresAt } = generatePortalToken(ref, secret)
 *   await supabase.from('portal_tokens').insert({ … })      // error DISCARDED
 *   const url = buildPortalUrl(ref, token)
 *   await resend.emails.send({ … html with url … })          // sent regardless
 *
 * So a refused insert produced an email, to a real customer, containing a link
 * that cannot work — and nothing anywhere said so. Hard-won rule 19 (an error
 * you do not read did not happen) feeding rule 10's expensive half (a guardrail
 * must not say it did something it did not). Six of the seven were in
 * `/api/admin/parties/[id]`, one per action that emails a customer: approve,
 * request changes, record a payment, send the portal link, send the check-in
 * link, and the line-item edit notification.
 *
 * Three outcomes, so the caller can tell "the link is good" from "do not mail
 * this" — rule 12.
 */

import { generatePortalToken, buildPortalUrl } from './portalAuth'

type MinimalClient = { from: (table: string) => any }

export type MintedLink =
  | { ok: true; url: string; expiresAt: Date }
  | { ok: false; reason: string }

export function portalSigningSecret(): string {
  return process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
}

/**
 * Mint a portal link for a booking, writing its token row first.
 *
 * Returns `ok: false` when the token row could not be stored, which the caller
 * must treat as "there is no link" — not as "carry on and mail it anyway".
 */
export async function mintPortalLink(
  supabase: MinimalClient,
  bookingId: string,
  bookingRef: string,
  /** Destination path, e.g. `/party-planner`. Defaults to the portal itself. */
  destination?: string,
): Promise<MintedLink> {
  const { token, hash, expiresAt } = generatePortalToken(bookingRef, portalSigningSecret())

  const { error } = await supabase
    .from('portal_tokens')
    .insert({ booking_id: bookingId, token_hash: hash, expires_at: expiresAt.toISOString() })

  if (error) {
    console.error(
      `PORTAL LINK NOT MINTED for ${bookingRef}: ${error.message} — ` +
        'no email should be sent containing a link, because it would not work.',
    )
    return { ok: false, reason: error.message }
  }

  return { ok: true, url: buildPortalUrl(bookingRef, token, destination), expiresAt }
}
