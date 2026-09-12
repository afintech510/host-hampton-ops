import { NextRequest, NextResponse } from 'next/server'
import { handleSignwellWebhook, CONSENT_DOC_TYPE } from '@/lib/signwellHandlers'

export const dynamic = 'force-dynamic'

/**
 * SignWell webhook — photo/video consent release only.
 *
 * Flips a consent_release to 'signed', which is what "opens" the child-media
 * gate: the DB trigger on website_content (migration_022) only lets flagged
 * content publish once every attached release row is 'signed'.
 *
 * Prefer the canonical dispatcher /api/webhooks/signwell.
 *
 * SECURITY, rewritten 2026-09-12: this handler previously performed no
 * verification. A consent release is a legal statement that a named child's
 * photograph may be published, and it is the only thing standing between
 * flagged content and the public site. An unverified webhook that can set it is
 * worse than having no consent record at all, because the flag is then
 * believed. See lib/signwellWebhook.ts.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleSignwellWebhook(req, { accept: [CONSENT_DOC_TYPE], label: 'consent' })
}
