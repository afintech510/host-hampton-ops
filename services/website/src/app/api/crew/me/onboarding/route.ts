import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { requireCrewMember } from '@/lib/crew/auth'
import { crewAgreementVersion } from '@/lib/crew/settings'
import { ensureProfileRow, onboardingStateFrom, ownProfileView, readOwnProfile } from '@/lib/crew/profile'

export const dynamic = 'force-dynamic'

/**
 * The member's own onboarding state and profile. An allow-list response
 * (`ownProfileView`): the agreement document id and the audit columns are not in it.
 */
export async function GET(req: NextRequest) {
  const limited = guardRate(req, plannerRule('crew/me'))
  if (limited) return limited
  const gate = await requireCrewMember(req, 'onboarding')
  if (!gate.ok) return gate.response
  const m = gate.member

  const sb = getSupabase()
  const started = await ensureProfileRow(sb, m.id)
  if (started.kind !== 'ok') return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })
  const read = await readOwnProfile(sb, m.id)
  if (read.kind !== 'ok') {
    console.error('crew/me/onboarding: profile read failed:', read.error)
    return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })
  }
  const state = onboardingStateFrom(m, read.data)
  return NextResponse.json({
    firstName: m.first_name,
    phone: m.phone,
    email: m.email,
    smsOptIn: m.sms_opt_in,
    agreementVersion: crewAgreementVersion(),
    state: {
      required: state.required, profileDone: state.profileDone, agreementSigned: state.agreementCurrent, incomplete: state.incomplete,
    },
    profile: ownProfileView(read.data),
  })
}
