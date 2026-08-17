import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { createConsentRelease, isConsentConfigured } from '@/lib/marketing/consent'

export const dynamic = 'force-dynamic'

/**
 * Create + send a photo/video consent release for a child. Returns the release
 * id and an embedded SignWell signing URL. The webhook flips it to 'signed',
 * which is what unlocks child-media publishing at the DB gate.
 *
 * Body: { bookingId?, contactId?, childName?, signerName, signerEmail }
 */
export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  if (!isConsentConfigured()) {
    return NextResponse.json(
      { error: 'Consent is not configured (SIGNWELL_API_KEY / SIGNWELL_CONSENT_TEMPLATE_ID).' },
      { status: 503 }
    )
  }

  const body = (await req.json()) as {
    bookingId?: string
    contactId?: string
    childName?: string
    signerName?: string
    signerEmail?: string
  }

  if (!body.signerName || !body.signerEmail) {
    return NextResponse.json({ error: 'signerName and signerEmail are required' }, { status: 400 })
  }

  try {
    const result = await createConsentRelease({
      bookingId: body.bookingId ?? null,
      contactId: body.contactId ?? null,
      childName: body.childName ?? null,
      signerName: body.signerName,
      signerEmail: body.signerEmail,
      actor: 'admin',
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'consent release failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
