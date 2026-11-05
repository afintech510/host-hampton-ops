/**
 * View one member's private onboarding profile. AUDITED: a `crew_events` row
 * naming the admin is written first, and without it nothing is returned.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { viewProfile } from '@/lib/crew/adminOnboarding'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Unknown crew member' }, { status: 404 })
  const r = await viewProfile(getSupabase(), params.id, adminActorId(req))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r)
}
