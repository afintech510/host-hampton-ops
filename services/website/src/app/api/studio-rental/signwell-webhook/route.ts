import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { fetchSignedPdfUrl } from '@/lib/signwell'

/**
 * SignWell webhook — marks a Studio Rental booking's agreement as signed.
 *
 * Configure the endpoint in the SignWell dashboard (Settings → API → Webhooks):
 *   https://www.hosthampton.com/api/studio-rental/signwell-webhook
 *
 * We act on the `document_completed` event (all signers done). The booking is
 * matched by stored signwell_document_id, falling back to metadata.booking_ref.
 * Verification is best-effort and the handler is idempotent.
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

    // Document object can arrive under a few shapes depending on event.
    const dataObj = (payload.data as Record<string, unknown> | undefined)?.object as Record<string, unknown> | undefined
    const doc = dataObj || (payload.data as Record<string, unknown> | undefined) || (payload.document as Record<string, unknown> | undefined) || {}

    const documentId = doc.id as string | undefined
    const status = doc.status as string | undefined
    const metadata = (doc.metadata as Record<string, unknown> | undefined) || {}
    const bookingRef = metadata.booking_ref as string | undefined

    const isCompleted = eventType === 'document_completed' || status === 'completed'
    if (!isCompleted) {
      return NextResponse.json({ received: true, ignored: eventType || 'non-completion' })
    }
    if (!documentId && !bookingRef) {
      return NextResponse.json({ received: true, ignored: 'no document id or booking ref' })
    }

    const supabase = getSupabase()

    // Best-effort completed-PDF URL: from the payload, else fetch from the API.
    const files = (doc.files as { pdf_url?: string }[] | undefined) || []
    let pdfUrl = files.find(f => f.pdf_url)?.pdf_url || null
    if (!pdfUrl && documentId) {
      pdfUrl = await fetchSignedPdfUrl(documentId)
    }

    const update = {
      agreement_signed_at: new Date().toISOString(),
      agreement_pdf_url: pdfUrl,
    }

    let query = supabase.from('bookings').update(update)
    query = documentId
      ? query.eq('signwell_document_id', documentId)
      : query.eq('booking_ref', bookingRef!)

    const { error } = await query
    if (error) {
      console.error('SignWell webhook booking update error:', error)
      return NextResponse.json({ error: 'update failed' }, { status: 500 })
    }

    console.log('Studio rental agreement signed:', documentId || bookingRef)
    return NextResponse.json({ received: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'signwell webhook failed'
    console.error('SignWell webhook error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
