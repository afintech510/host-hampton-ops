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
  // Rule 19: this write is the ONLY link between the live SignWell document and
  // our row. If it is lost, the customer signs and the webhook has nothing to
  // match — the release stays 'pending' forever and the publishing gate never
  // opens, with no error anywhere. It used to be an unchecked `await`.
  const { data: linked, error: linkErr } = await supabase
    .from('consent_releases')
    .update({ signwell_document_id: doc.documentId, status: 'sent' })
    .eq('id', release.id)
    .select('id')

  if (linkErr || (linked?.length ?? 0) === 0) {
    console.error(
      'createConsentRelease: FAILED to link SignWell document', doc.documentId,
      'to release', release.id, '—', linkErr?.message ?? 'update matched no rows'
    )
    throw new Error(
      `createConsentRelease: the SignWell document was created but could not be linked to release ${release.id}. ` +
        `Do not send this signing link — the signature would not be recorded.`
    )
  }

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
 * Outcome of marking a release signed.
 *
 * Rule 12: FOUR outcomes, not a boolean. The old signature returned `false` for
 * "no such release", "already signed" and "the database was unreachable"
 * alike, so the webhook answered 200 `{signed:false}` to a Supabase blip and
 * SignWell never redelivered — a real signature on a real child's consent
 * release, dropped, with the gate left closed and nothing saying why.
 */
export type MarkReleaseResult =
  | { kind: 'signed' }
  | { kind: 'already-signed' }
  | { kind: 'not-found' }
  | { kind: 'unavailable'; error: string }

/**
 * Webhook handler core: mark the release for a SignWell document as 'signed'.
 * Idempotent — re-delivered webhooks are no-ops.
 *
 * NOTE: this function does NOT authenticate anything. The caller must have
 * verified the event and confirmed completion with SignWell first — see
 * lib/signwellWebhook.ts. `documentId` reaching here is a claim, not a fact.
 */
export async function markReleaseSigned(
  supabase: Supa,
  documentId: string,
  opts: { actor?: string } = {}
): Promise<MarkReleaseResult> {
  const { data: release, error: lookupErr } = await supabase
    .from('consent_releases')
    .select('id, status')
    .eq('signwell_document_id', documentId)
    .maybeSingle()

  if (lookupErr) return { kind: 'unavailable', error: lookupErr.message }
  if (!release) return { kind: 'not-found' }
  if (release.status === 'signed') return { kind: 'already-signed' } // idempotent

  const pdfUrl = await fetchSignedPdfUrl(documentId)
  if (!pdfUrl) {
    // The signed release is the artifact that justifies publishing a child's
    // photograph. Recording 'signed' without it is worth saying out loud.
    console.warn('markReleaseSigned: no completed PDF URL for document', documentId)
  }

  const { data: updated, error } = await supabase
    .from('consent_releases')
    .update({ status: 'signed', signed_at: new Date().toISOString(), signed_pdf_url: pdfUrl })
    .eq('id', release.id)
    .select('id')

  if (error) {
    console.error('markReleaseSigned update error:', error.message)
    return { kind: 'unavailable', error: error.message }
  }
  if ((updated?.length ?? 0) === 0) {
    // Rule 10: a zero-row update is not a success.
    return { kind: 'unavailable', error: 'update matched no rows' }
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

  return { kind: 'signed' }
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
