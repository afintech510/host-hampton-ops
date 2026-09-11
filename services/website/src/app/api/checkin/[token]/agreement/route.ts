import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { createEmbeddedDocument } from '@/lib/signwell'
import { resolveCheckinToken, requiresRentalAgreement, CHECKIN_DOC_TYPE } from '@/lib/checkinLink'

export const dynamic = 'force-dynamic'

/**
 * Create the embedded SignWell rental agreement + liability waiver for a
 * check-in, and hand back the signing URL for the client to open.
 *
 * Uses its own template (SIGNWELL_CHECKIN_TEMPLATE_ID) rather than the studio
 * rental one: createEmbeddedAgreement hard-codes the document name and
 * metadata.type to studio_rental, and the studio webhook writes to a different
 * set of columns. Sharing it would cross-wire the two flows.
 */

export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const result = await resolveCheckinToken(token)

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.reason === 'expired' ? 410 : 404 })
  }

  const booking = result.booking
  const bookingId = booking.id as string
  const bookingRef = booking.booking_ref as string

  if (booking.checkin_agreement_signed_at) {
    return NextResponse.json({ alreadySigned: true, signingUrl: null })
  }

  // Theme/mobile parties don't carry a rental agreement at all — the UI
  // shouldn't even show this step, but guard server-side too.
  if (!requiresRentalAgreement(booking)) {
    return NextResponse.json({ notRequired: true, signingUrl: null })
  }

  const templateId = process.env.SIGNWELL_CHECKIN_TEMPLATE_ID
  // isSignwellConfigured() checks SIGNWELL_TEMPLATE_ID, which is the studio
  // rental template — not the right guard here.
  if (!process.env.SIGNWELL_API_KEY || !templateId) {
    // Not configured (dev/preview). Best effort: the rest of check-in still works.
    return NextResponse.json({ unavailable: true, signingUrl: null })
  }

  const supabase = getSupabase()

  try {
    const { documentId, embeddedSigningUrl } = await createEmbeddedDocument({
      templateId,
      documentName: `Party Rental Agreement & Liability Waiver — ${bookingRef}`,
      signerName: String(booking.contact_name ?? ''),
      signerEmail: String(booking.contact_email ?? ''),
      metadata: {
        booking_ref: bookingRef,
        booking_id: bookingId,
        type: CHECKIN_DOC_TYPE,
      },
      fields: {
        client_name: String(booking.contact_name ?? ''),
        email: String(booking.contact_email ?? ''),
        phone: String(booking.contact_phone ?? ''),
        // SignWell date fields reject a bare date — full ISO-8601 required.
        event_date: booking.party_date ? `${booking.party_date}T00:00:00Z` : '',
        start_time: String(booking.party_time ?? ''),
        package_type: String(booking.package_type ?? ''),
        headcount: String(booking.guest_count_approx ?? ''),
        address: [
          booking.checkin_address_line1,
          booking.checkin_address_line2,
          booking.checkin_city,
          booking.checkin_state,
          booking.checkin_postal_code,
        ].filter(Boolean).join(', '),
      },
    })

    // Persist the document id BEFORE the customer can finish signing, or the
    // webhook arrives with nothing to match. (metadata.booking_ref is the
    // fallback for that race, mirroring the studio-rental handler.)
    await supabase
      .from('bookings')
      .update({ checkin_signwell_document_id: documentId })
      .eq('id', bookingId)

    return NextResponse.json({ signingUrl: embeddedSigningUrl })
  } catch (err) {
    console.error('checkin:signwell create error:', err)
    return NextResponse.json({ error: 'Could not open the agreement' }, { status: 502 })
  }
}
