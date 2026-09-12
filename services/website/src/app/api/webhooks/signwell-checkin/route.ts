import { NextRequest, NextResponse } from 'next/server'
import { handleSignwellWebhook } from '@/lib/signwellHandlers'
import { CHECKIN_DOC_TYPE } from '@/lib/checkinLink'

export const dynamic = 'force-dynamic'

/**
 * SignWell webhook — pre-arrival check-in rental agreement / waiver only.
 *
 * Prefer the canonical dispatcher /api/webhooks/signwell. Kept and hardened for
 * the same reason as the studio-rental route: this handler previously performed
 * no verification and would mark a waiver signed for an anonymous POST.
 *
 * Idempotent: signing twice rewrites the same timestamps.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleSignwellWebhook(req, { accept: [CHECKIN_DOC_TYPE], label: 'checkin' })
}
