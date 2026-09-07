import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { fetchSignedPdfUrl } from '@/lib/signwell'
import { cancelCheckinReminders } from '@/lib/checkinReminders'
import { CHECKIN_DOC_TYPE } from '@/lib/checkinLink'

export const dynamic = 'force-dynamic'

/**
 * SignWell webhook — records a signed check-in rental agreement / waiver.
 *
 * Configure in the SignWell dashboard (Settings → API → Webhooks):
 *   https://www.hosthampton.com/api/webhooks/signwell-checkin
 *
 * SignWell webhooks are account-wide, so this endpoint also receives studio
 * rental and consent-release events. It filters on metadata.type and no-ops on
 * anything that isn't ours.
 *
 * Idempotent: signing twice just rewrites the same timestamps.
 */



export async function POST(req: NextRequest) {
  try {
    const raw = await req.text()
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: 'invalid json' }, { status: 400 })
    }

    const event = (payload.event as Record<string, unknown> | undefined) || {}
    const eventType = (event.type as string) || (payload.type as string) || ''

    // The document object arrives under a few shapes depending on the event.
    const dataObj = (payload.data as Record<string, unknown> | undefined)?.object as Record<string, unknown> | undefined
    const doc = dataObj || (payload.data as Record<string, unknown> | undefined) || (payload.document as Record<string, unknown> | undefined) || {}

    const documentId = doc.id as string | undefined
    const status = doc.status as string | undefined
    const metadata = (doc.metadata as Record<string, unknown> | undefined) || {}
    const bookingRef = metadata.booking_ref as string | undefined

    // Not ours — the studio-rental and consent handlers own their own types.
    if (metadata.type !== CHECKIN_DOC_TYPE) {
      return NextResponse.json({ received: true, ignored: 'other document type' })
    }

    const isCompleted = eventType === 'document_completed' || status === 'completed'
    if (!isCompleted) {
      return NextResponse.json({ received: true, ignored: eventType || 'non-completion' })
    }
    if (!documentId && !bookingRef) {
      return NextResponse.json({ received: true, ignored: 'no document id or booking ref' })
    }

    const supabase = getSupabase()

    // Best-effort completed-PDF URL: from the payload, else fetch it.
    const files = (doc.files as { pdf_url?: string }[] | undefined) || []
    let pdfUrl = files.find(f => f.pdf_url)?.pdf_url || null
    if (!pdfUrl && documentId) pdfUrl = await fetchSignedPdfUrl(documentId)

    // Find the booking first — we need its ref and current state to decide
    // whether this completes the check-in and which reminders to suppress.
    let lookup = supabase.from('bookings').select('id, booking_ref, checkin_status, contact_name')
    lookup = documentId
      ? lookup.eq('checkin_signwell_document_id', documentId)
      : lookup.eq('booking_ref', bookingRef!)

    const { data: booking } = await lookup.maybeSingle()
    if (!booking) {
      console.warn('signwell-checkin: no booking for', documentId || bookingRef)
      return NextResponse.json({ received: true, ignored: 'no matching booking' })
    }

    const now = new Date().toISOString()
    const update: Record<string, unknown> = {
      checkin_agreement_signed_at: now,
      checkin_agreement_pdf_url: pdfUrl,
      updated_at: now,
    }

    // Signing is the last step, so this is what completes the check-in. Guard
    // on 'started' so a signature that somehow lands before the details form
    // doesn't mark the booking complete with no contact details captured.
    const completes = booking.checkin_status === 'started'
    if (completes) {
      update.checkin_status = 'complete'
      update.checkin_completed_at = now
    }

    const { error } = await supabase.from('bookings').update(update).eq('id', booking.id)
    if (error) {
      console.error('signwell-checkin booking update error:', error)
      return NextResponse.json({ error: 'update failed' }, { status: 500 })
    }

    // Stop the 36hr / 6am texts — nobody should be nagged about something they
    // have already finished.
    if (completes) await cancelCheckinReminders(booking.booking_ref)

    console.log('Check-in agreement signed:', booking.booking_ref, completes ? '(check-in complete)' : '')
    return NextResponse.json({ received: true, completed: completes })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'signwell checkin webhook failed'
    console.error('signwell-checkin webhook error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
