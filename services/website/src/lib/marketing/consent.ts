/**
 * Consent releases — the child-media capability gate, app side.
 *
 * A `consent_releases` row (migration_020) is created per child, a SignWell
 * document is issued from the consent template, and the webhook flips the row
 * to 'signed'. The STRUCTURAL enforcement is the DB trigger on website_content
 * (migration_022): content flagged references_child_media cannot reach
 * approved/published unless every attached release is 'signed'. The helpers
 * here are the friendly app-layer pre-check (layer 2) plus release creation.
 */

import { getSupabase } from '@/lib/supabase'
import { createEmbeddedDocument, fetchSignedPdfUrl } from '@/lib/signwell'
import { writeLedger } from '@/lib/marketing/graph'

type Supa = ReturnType<typeof getSupabase>

export function isConsentConfigured(): boolean {
  return !!(process.env.SIGNWELL_API_KEY && process.env.SIGNWELL_CONSENT_TEMPLATE_ID)
}

export interface CreateReleaseInput {
  bookingId?: string | null
  contactId?: string | null
  childName?: string | null
  signerName: string
  signerEmail: string
  actor?: string
  supabase?: Supa
}

export interface CreateReleaseResult {
  id: string
  signwellDocumentId: string
  embeddedSigningUrl: string
}

/**
 * Create a consent release: insert the row (status 'pending'), issue the
 * SignWell document, store the document id, and move the row to 'sent'.
 * Returns the release id + embedded signing URL.
 */
export async function createConsentRelease(input: CreateReleaseInput): Promise<CreateReleaseResult> {
  if (!isConsentConfigured()) {
    throw new Error('Consent is not configured (missing SIGNWELL_API_KEY or SIGNWELL_CONSENT_TEMPLATE_ID)')
  }
  const supabase = input.supabase ?? getSupabase()

  // 1. Insert pending release.
  const { data: release, error: insErr } = await supabase
    .from('consent_releases')
    .insert({
      booking_id: input.bookingId ?? null,
      contact_id: input.contactId ?? null,
      child_name: input.childName ?? null,
      status: 'pending',
    })
    .select('id')
    .single()

  if (insErr || !release) {
    throw new Error(`createConsentRelease: insert failed${insErr ? ` (${insErr.message})` : ''}`)
  }

  // 2. Issue the SignWell document from the consent template.
  const doc = await createEmbeddedDocument({
    templateId: process.env.SIGNWELL_CONSENT_TEMPLATE_ID as string,
    documentName: `Photo/Video Consent Release${input.childName ? ` — ${input.childName}` : ''}`,
    signerName: input.signerName,
    signerEmail: input.signerEmail,
    metadata: { release_id: release.id, type: 'consent_release' },
    fields: {
      child_name: input.childName ?? '',
      guardian_name: input.signerName,
    },
  })

  // 3. Store doc id + move to 'sent'. (Not via advance(): consent_release
  //    transitions are SignWell-driven, so we set status directly here and
  //    ledger the send.)
  await supabase
    .from('consent_releases')
    .update({ signwell_document_id: doc.documentId, status: 'sent' })
    .eq('id', release.id)

  await writeLedger(supabase, {
    entityType: 'consent_release',
    entityId: release.id,
    action: 'send',
    actor: input.actor ?? 'admin',
    fromStatus: 'pending',
    toStatus: 'sent',
    meta: { signwell_document_id: doc.documentId, child_name: input.childName ?? null },
  })

  return { id: release.id, signwellDocumentId: doc.documentId, embeddedSigningUrl: doc.embeddedSigningUrl }
}

/**
 * Webhook handler core: mark the release for a SignWell document as 'signed'.
 * Idempotent — re-delivered webhooks are no-ops. Returns true if a row moved
 * to signed on this call.
 */
export async function markReleaseSigned(
  supabase: Supa,
  documentId: string,
  opts: { actor?: string } = {}
): Promise<boolean> {
  const { data: release } = await supabase
    .from('consent_releases')
    .select('id, status')
    .eq('signwell_document_id', documentId)
    .maybeSingle()

  if (!release) return false
  if (release.status === 'signed') return false // idempotent

  const pdfUrl = await fetchSignedPdfUrl(documentId)

  const { error } = await supabase
    .from('consent_releases')
    .update({ status: 'signed', signed_at: new Date().toISOString(), signed_pdf_url: pdfUrl })
    .eq('id', release.id)

  if (error) {
    console.error('markReleaseSigned update error:', error.message)
    return false
  }

  await writeLedger(supabase, {
    entityType: 'consent_release',
    entityId: release.id,
    action: 'transition',
    actor: opts.actor ?? 'signwell_webhook',
    fromStatus: release.status,
    toStatus: 'signed',
    meta: { signwell_document_id: documentId, signed_pdf_url: pdfUrl },
  })

  return true
}

/**
 * Gate query helper (layer 2, app-side): are ALL of these releases signed?
 * An empty/absent list is NOT satisfied (default-deny). Mirrors the DB trigger
 * so the admin UI can show a friendly error before attempting a publish.
 */
export async function releasesAllSigned(supabase: Supa, ids: string[] | null | undefined): Promise<boolean> {
  if (!ids || ids.length === 0) return false
  const { data, error } = await supabase
    .from('consent_releases')
    .select('id, status')
    .in('id', ids)
  if (error || !data) return false
  if (data.length !== ids.length) return false // some id missing
  return data.every(r => r.status === 'signed')
}
