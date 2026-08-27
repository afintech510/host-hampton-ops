import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { sendSMSVia, normalizePhone } from '@/lib/sms'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/quo-test — send a test SMS explicitly via Quo.
 *
 * Bypasses SMS_PROVIDER so Quo can be validated end-to-end without changing the
 * live default (which stays Twilio). Admin-only.
 *
 * Body: { body_text: string, recipients: string[] }
 *
 * Notes:
 *  - Requires QUO_API_KEY + QUO_PHONE_NUMBER set in the environment.
 *  - US delivery only works once the Quo workspace's A2P 10DLC registration is
 *    approved; before that, Quo returns 400 and sends come back success:false.
 *  - With E2E_FAKE_SENDERS=1 the send is faked (returns a fake id), which still
 *    proves the request path without contacting Quo.
 */
export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const { body_text, recipients } = await req.json()

  if (!body_text) {
    return NextResponse.json({ error: 'body_text is required' }, { status: 400 })
  }
  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    return NextResponse.json({ error: 'At least one recipient is required' }, { status: 400 })
  }
  if (recipients.length > 10) {
    return NextResponse.json({ error: 'Maximum 10 test recipients allowed' }, { status: 400 })
  }

  const config = {
    apiKeySet: !!process.env.QUO_API_KEY,
    fromSet: !!process.env.QUO_PHONE_NUMBER,
    fakeSenders: process.env.E2E_FAKE_SENDERS === '1',
  }
  if (!config.apiKeySet || !config.fromSet) {
    return NextResponse.json(
      { error: 'Quo not configured', detail: 'QUO_API_KEY and QUO_PHONE_NUMBER must be set', config },
      { status: 500 }
    )
  }

  const results: { recipient: string; success: boolean; id?: string | null }[] = []
  for (const phone of recipients) {
    const to = normalizePhone(String(phone).trim())
    const id = await sendSMSVia('quo', to, body_text)
    results.push({ recipient: to, success: !!id, id })
  }

  const successCount = results.filter(r => r.success).length
  return NextResponse.json({
    message: `${successCount}/${results.length} Quo test messages sent`,
    provider: 'quo',
    config,
    results,
  })
}
