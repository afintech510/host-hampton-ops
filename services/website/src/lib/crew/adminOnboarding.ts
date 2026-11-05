/**
 * Admin side of onboarding: send the link, view a profile, fetch the signed
 * agreement. Server code only; every caller has passed `isAdminAuthorized` and
 * passes `adminActorId(req)` as `actor`.
 *
 * Looking at a profile is AUDITED and the audit is the gate: the `crew_events`
 * row (an `admin_adjustment` with zero step change and `metadata.kind`, the same
 * shape `admin_unassign` uses) is written FIRST, and if it cannot be written the
 * profile is not returned. A read nobody can later account for is the thing
 * the separate table exists to prevent.
 */

import type { getSupabase } from '@/lib/supabase'
import { getMember } from '@/lib/crew/db'
import { sendOnboardingInvite } from '@/lib/crew/notify'
import { readProfileForAdmin, type ProfileRow } from '@/lib/crew/profile'
import { fetchSignedPdfUrl } from '@/lib/signwell'
import { TENANT } from '@/tenant'
import type { ActionResult } from '@/lib/crew/adminActions'

type Supa = ReturnType<typeof getSupabase>

const refuse = (status: number, error: string): ActionResult<never> => ({ ok: false, status, error })

export async function sendOnboardingLink(sb: Supa, id: string, now: Date, actor: string): Promise<ActionResult> {
  const read = await getMember(sb, id)
  if (read.kind !== 'ok') return refuse(503, `Could not read the member: ${read.error}`)
  const m = read.data
  if (!m) return refuse(404, 'Unknown crew member.')

  const r = await sendOnboardingInvite({ sb, now }, m, actor)
  switch (r.kind) {
    case 'sent': return { ok: true }
    case 'duplicate': return refuse(409, `${m.first_name} was already sent the link today.`)
    case 'disabled': return refuse(409, 'Onboarding is not switched on yet (CREW_ONBOARDING_ENABLED is off). Nothing was sent.')
    case 'ineligible':
      return refuse(400, r.reason === 'owner' ? `${TENANT.people.customerSignoff} is never sent crew messages.` : r.reason === 'inactive' ? `${m.first_name} is not active.` : `${m.first_name} has no phone number.`)
    case 'quiet': return refuse(409, 'Texts only go out between 8am and 9pm Eastern. Try again after 8am. Nothing was sent.')
    default: return refuse(502, `The text did not send: ${r.error}`)
  }
}

/** What an admin sees: the profile minus the SignWell document id. */
export function adminProfileView(p: ProfileRow) {
  return {
    legalFirstName: p.legal_first_name, legalLastName: p.legal_last_name, preferredName: p.preferred_name,
    dateOfBirth: p.date_of_birth, addressLine1: p.address_line1, addressLine2: p.address_line2, city: p.city, state: p.state, zip: p.zip,
    emergencyName: p.emergency_name, emergencyRelationship: p.emergency_relationship, emergencyPhone: p.emergency_phone,
    onboardingCompletedAt: p.onboarding_completed_at, agreementVersion: p.agreement_version,
    agreementSentAt: p.agreement_sent_at, agreementSignedAt: p.agreement_signed_at,
    hasSignedAgreement: !!p.agreement_signed_at && !!p.agreement_document_id,
  }
}

async function audit(sb: Supa, memberId: string, kind: 'profile_viewed' | 'agreement_downloaded', actor: string): Promise<string | null> {
  const { data: m, error: mErr } = await sb.from('crew_members').select('steps').eq('id', memberId).maybeSingle()
  if (mErr) return mErr.message
  const steps = Number((m as { steps?: number } | null)?.steps ?? 0)
  const { error } = await sb.from('crew_events').insert({
    member_id: memberId, type: 'admin_adjustment', step_before: steps, step_delta: 0, step_after: steps,
    metadata: { kind }, created_by: actor,
  }).select('id')
  return error ? error.message : null
}

export async function viewProfile(sb: Supa, id: string, actor: string): Promise<ActionResult<{ profile: ReturnType<typeof adminProfileView> | null }>> {
  const auditError = await audit(sb, id, 'profile_viewed', actor)
  if (auditError) return refuse(503, `Could not record the view, so the profile was not shown: ${auditError}`)
  const read = await readProfileForAdmin(sb, id)
  if (read.kind !== 'ok') return refuse(503, `Could not read the profile: ${read.error}`)
  return { ok: true, profile: read.data ? adminProfileView(read.data) : null }
}

/** A fresh link to the signed PDF. Audited like a profile view; never stored. */
export async function signedAgreementUrl(sb: Supa, id: string, actor: string): Promise<ActionResult<{ url: string }>> {
  const read = await readProfileForAdmin(sb, id)
  if (read.kind !== 'ok') return refuse(503, `Could not read the profile: ${read.error}`)
  const p = read.data
  if (!p?.agreement_signed_at || !p.agreement_document_id) return refuse(404, 'No signed agreement yet.')
  const auditError = await audit(sb, id, 'agreement_downloaded', actor)
  if (auditError) return refuse(503, `Could not record the download: ${auditError}`)
  const url = await fetchSignedPdfUrl(p.agreement_document_id)
  if (!url) return refuse(502, 'SignWell has no completed PDF for it yet.')
  return { ok: true, url }
}
