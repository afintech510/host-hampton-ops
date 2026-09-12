import { NextRequest, NextResponse } from 'next/server'
import { handleSignwellWebhook } from '@/lib/signwellHandlers'

export const dynamic = 'force-dynamic'

/**
 * THE SignWell webhook. This is the URL registered on the account.
 *
 * SignWell hooks are account-wide and each hook's id is the HMAC key for the
 * events it delivers, so registering one hook here — rather than three, one per
 * document type — is both the correct configuration and the reason there is a
 * single SIGNWELL_WEBHOOK_ID to verify against.
 *
 * Dispatches on the document's AUTHORITATIVE metadata.type (re-read from
 * SignWell, not taken from the POST body) to the writer for that type:
 *   studio_rental   → bookings.agreement_signed_at
 *   party_checkin   → bookings.checkin_agreement_signed_at
 *   consent_release → consent_releases.status = 'signed'
 *
 * Register with:
 *   POST https://www.signwell.com/api/v1/hooks
 *   { "callback_url": "https://www.hosthampton.com/api/webhooks/signwell" }
 * and put the returned `id` in SIGNWELL_WEBHOOK_ID. `GET /hooks` lists what is
 * actually registered — it returned `[]` on 2026-09-12, which is why none of
 * this code had ever run.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleSignwellWebhook(req, { accept: '*', label: 'dispatch' })
}
