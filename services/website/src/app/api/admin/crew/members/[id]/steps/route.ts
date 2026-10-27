/**
 * The step override (spec §3.2): `{ steps, reason }`. The reason is required;
 * `crew_admin_set_steps` applies it as a compare-and-swap and writes the
 * `admin_adjustment` ledger row with this admin as `created_by`. The owner row
 * answers 400: Allie is never given steps.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { loadCrewSettings } from '@/lib/crew/settings'
import { overrideSteps } from '@/lib/crew/adminMembers'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Unknown crew member' }, { status: 404 })
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return NextResponse.json({ error: `Could not read the crew rules: ${settings.error}` }, { status: 503 })
  const r = await overrideSteps(sb, params.id, body ?? {}, adminActorId(req), settings.settings)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r)
}
