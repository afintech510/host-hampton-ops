import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { markReleaseSigned } from '@/lib/marketing/consent'

export const dynamic = 'force-dynamic'

/**
 * SignWell webhook — flips a consent_release to 'signed' when its document is
 * completed. This is what "opens" the child-media consent gate: the DB trigger
 * on website_content (migration_022) only lets flagged content publish once the
 * attached release rows are 'signed'.
 *
 * Configure in SignWell (Settings → API → Webhooks), pointed here, on the
 * consent template:
 *   https://www.hosthampton.com/api/webhooks/signwell-consent
 *
 * We act on document_completed. The release is matched by signwell_document_id
 * (stored at creation), falling back to metadata.release_id. Idempotent.
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

    const dataObj = (payload.data as Record<string, unknown> | undefined)?.object as Record<string, unknown> | undefined
    const doc = dataObj || (payload.data as Record<string, unknown> | undefined) || (payload.document as Record<string, unknown> | undefined) || {}

    const documentId = doc.id as string | undefined
    const status = doc.status as string | undefined
    const metadata = (doc.metadata as Record<string, unknown> | undefined) || {}
    const releaseId = metadata.release_id as string | undefined

    const isCompleted = eventType === 'document_completed' || status === 'completed'
    if (!isCompleted) {
      return NextResponse.json({ received: true, ignored: eventType || 'non-completion' })
    }

    const supabase = getSupabase()

    // Prefer the stored document id; fall back to metadata.release_id.
    let signed = false
    if (documentId) {
      signed = await markReleaseSigned(supabase, documentId, { actor: 'signwell_webhook' })
    }

    if (!signed && releaseId) {
      // Fall back to release_id if the document id wasn't matched.
      const { data: release } = await supabase
        .from('consent_releases')
        .select('signwell_document_id')
        .eq('id', releaseId)
        .maybeSingle()
      if (release?.signwell_document_id) {
        signed = await markReleaseSigned(supabase, release.signwell_document_id, { actor: 'signwell_webhook' })
      }
    }

    if (!documentId && !releaseId) {
      return NextResponse.json({ received: true, ignored: 'no document id or release id' })
    }

    return NextResponse.json({ received: true, signed })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'signwell consent webhook failed'
    console.error('SignWell consent webhook error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
