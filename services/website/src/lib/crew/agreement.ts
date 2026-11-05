/**
 * Issuing the crew agreement to a member.
 *
 * Preconditions, all re-checked here rather than trusted from the page: the
 * About-you steps are done, an email is on file (SignWell needs one, and it is
 * the address the signed copy goes to), and the agreement they hold is not
 * already the current version.
 *
 * The document id is written to the member's profile row at creation. That id
 * is what the SignWell webhook later binds its write to
 * (`writeCrewAgreementSigned`), so a signed document we did not issue to this
 * member writes nothing.
 *
 * The signed PDF is never stored as a link here; the admin fetches it on demand.
 */

import type { getSupabase } from '@/lib/supabase'
import { createDocumentFromFile, fetchEmbeddedSigningUrl } from '@/lib/signwell'
import { CREW_AGREEMENT_DOC_TYPE } from '@/lib/crew/agreementText'
import { crewAgreementVersion } from '@/lib/crew/settings'
import { agreementIsCurrent, readOwnProfile, profileIsFilled } from '@/lib/crew/profile'
import { renderAgreementPdf } from '@/lib/crew/agreementPdf'
import type { CrewMemberRow } from '@/lib/crew/db'

type Supa = ReturnType<typeof getSupabase>

export type StartAgreementResult =
  | { kind: 'ready'; signingUrl: string; reused: boolean }
  | { kind: 'already_signed' }
  | { kind: 'not_ready'; missing: 'profile' | 'email' }
  | { kind: 'unavailable'; error: string }

/** SignWell test mode for crew agreements: on while CREW_AGREEMENT_TEST_MODE is exactly `true`. */
export function crewAgreementTestMode(): boolean | undefined {
  return process.env.CREW_AGREEMENT_TEST_MODE === 'true' ? true : undefined
}

export async function startAgreement(sb: Supa, member: Pick<CrewMemberRow, 'id' | 'email'>): Promise<StartAgreementResult> {
  const read = await readOwnProfile(sb, member.id)
  if (read.kind !== 'ok') return { kind: 'unavailable', error: read.error }
  const p = read.data
  if (!p || !profileIsFilled(p) || !p.onboarding_completed_at) return { kind: 'not_ready', missing: 'profile' }
  if (!member.email) return { kind: 'not_ready', missing: 'email' }

  const version = crewAgreementVersion()
  if (agreementIsCurrent(p, version)) return { kind: 'already_signed' }

  // A document already issued, still open, and for THIS version: reuse it.
  // (`fetchEmbeddedSigningUrl` is null for a completed or missing document.)
  if (p.agreement_document_id) {
    const open = await fetchEmbeddedSigningUrl(p.agreement_document_id)
    if (open && open.version === version) return { kind: 'ready', signingUrl: open.url, reused: true }
  }

  const legalName = `${p.legal_first_name} ${p.legal_last_name}`
  let doc: { documentId: string; embeddedSigningUrl: string }
  try {
    const pdf = await renderAgreementPdf({
      legalName, addressLine1: p.address_line1!, addressLine2: p.address_line2, city: p.city!, state: p.state!, zip: p.zip!,
      email: member.email,
    })
    doc = await createDocumentFromFile({
      documentName: `Crew agreement ${version} — ${legalName}`,
      pdf, fileName: `crew-agreement-${version}.pdf`,
      signerName: legalName, signerEmail: member.email,
      metadata: { type: CREW_AGREEMENT_DOC_TYPE, member_id: member.id, version },
      testMode: crewAgreementTestMode(),
    })
  } catch (e) {
    return { kind: 'unavailable', error: e instanceof Error ? e.message : 'could not create the agreement' }
  }

  const now = new Date().toISOString()
  // Only the document id and when it was sent: the signature and the version
  // signed are recorded by the SignWell webhook writer and nowhere else.
  const { error } = await sb.from('crew_member_profiles').update({
    agreement_document_id: doc.documentId, agreement_sent_at: now, updated_at: now,
  }).eq('member_id', member.id).select('member_id')
  if (error) {
    // The document exists at SignWell but we cannot bind it: the webhook would write nothing.
    console.error('crew/agreement: created', doc.documentId, 'but could not record it:', error.message)
    return { kind: 'unavailable', error: 'could not record the agreement' }
  }
  return { kind: 'ready', signingUrl: doc.embeddedSigningUrl, reused: false }
}
