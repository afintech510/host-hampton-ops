/**
 * Start a READ-ONLY preview of the crew app as one member. AUDITED: a
 * `crew_events` row naming the admin is written first, and without it no cookie
 * is set. The cookie (`hh_crew_view`, two hours) outranks the member's own and
 * `requireCrewMember` refuses every non-GET while it is on. It sends nothing,
 * changes no member and works with CREW_ENABLED off.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { portalSigningSecret } from '@/lib/portalAuth'
import { isLocalRequest } from '@/lib/publicOrigin'
import { getMember } from '@/lib/crew/db'
import { isUuid, setCrewViewCookieHeader } from '@/lib/crew/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Unknown crew member' }, { status: 404 })
  const sb = getSupabase()
  const read = await getMember(sb, params.id)
  if (read.kind !== 'ok') return NextResponse.json({ error: 'Could not read the member. Try again.' }, { status: 503 })
  const m = read.data
  if (!m || m.status === 'removed') return NextResponse.json({ error: 'Unknown crew member' }, { status: 404 })
  if (m.is_owner) return NextResponse.json({ error: 'The owner has no crew view.' }, { status: 409 })

  const steps = Number(m.steps ?? 0)
  const { error } = await sb.from('crew_events').insert({
    member_id: m.id, type: 'admin_adjustment', step_before: steps, step_delta: 0, step_after: steps,
    metadata: { kind: 'view_as_started' }, created_by: adminActorId(req),
  }).select('id')
  if (error) return NextResponse.json({ error: 'Could not record the preview, so it was not started.' }, { status: 503 })

  const res = NextResponse.json({ ok: true, redirect: '/crew' })
  res.headers.set('Set-Cookie', setCrewViewCookieHeader(m.id, portalSigningSecret(), isLocalRequest(req)))
  return res
}
