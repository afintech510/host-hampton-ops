/**
 * "Send onboarding link": ONE text telling a new crew member where to set up
 * their account (`sendOnboardingInvite`: gated by CREW_ONBOARDING_ENABLED,
 * 8am–9pm Eastern, claimed once a day per member).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { sendOnboardingLink } from '@/lib/crew/adminOnboarding'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Unknown crew member' }, { status: 404 })
  const r = await sendOnboardingLink(getSupabase(), params.id, new Date(), adminActorId(req))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r)
}
