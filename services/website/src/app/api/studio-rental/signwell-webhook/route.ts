import { NextRequest, NextResponse } from 'next/server'
import { handleSignwellWebhook, STUDIO_DOC_TYPE } from '@/lib/signwellHandlers'

export const dynamic = 'force-dynamic'

/**
 * SignWell webhook — studio rental agreement only.
 *
 * Prefer the canonical dispatcher /api/webhooks/signwell, which is what is
 * registered on the account. This URL is kept because it is documented in the
 * original build notes and may be pasted into the SignWell dashboard; it now
 * enforces exactly the same checks via the same pipeline.
 *
 * SECURITY, rewritten 2026-09-12. This handler previously performed NO
 * verification of any kind, beneath a comment claiming "verification is
 * best-effort" (rule 8). Driven in production against a throwaway booking: an
 * unauthenticated POST carrying the literal string 'totally-made-up-hash' wrote
 * `agreement_signed_at` and was answered `{"received":true}`. Anyone on the
 * internet could mark any customer's liability waiver signed — or, through the
 * body-supplied metadata.booking_ref fallback, mark the WRONG one signed.
 *
 * `defaultType` accepts a document with no metadata.type because the six
 * June-2026 documents predate that convention.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleSignwellWebhook(req, {
    accept: [STUDIO_DOC_TYPE],
    defaultType: STUDIO_DOC_TYPE,
    label: 'studio',
  })
}
