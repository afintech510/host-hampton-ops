/**
 * A late cancel nobody has taken, for Allie (spec §3.7, prompt 05 §3).
 *
 *   PATCH { action: 'offer_all' }
 *           sets `offered_to_all_at` (once) and texts every active member free
 *           that day who could work the spot — after which any of them may claim.
 *   PATCH { action: 'assign', memberId }
 *           puts someone on it (Allie included) through `crew_claim_swap` as
 *           admin. NOT `crew_admin_assign`: that function takes an OPEN spot, and
 *           a late cancel's spot is still held by the person cancelling until
 *           someone replaces them. Once a spot is open again (a drop anyway) it is
 *           assigned the ordinary way, on the party page.
 *
 * The messages go through lib/crew/cover.ts → lib/crew/notify.ts, the one crew
 * send path. Every write records `adminActorId(req)`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { loadCrewSettings } from '@/lib/crew/settings'
import { assignCover, offerToEveryone } from '@/lib/crew/cover'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Unknown cover request' }, { status: 404 })
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const sb = getSupabase()
  const actor = adminActorId(req)
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return NextResponse.json({ error: `Could not read the crew rules: ${settings.error}` }, { status: 503 })
  const ctx = { sb, now: new Date() }

  if (body.action === 'offer_all') {
    const r = await offerToEveryone(ctx, settings.settings, params.id, actor)
    if (r.kind === 'ok') return NextResponse.json({ ok: true, asked: r.asked })
    if (r.kind === 'refused') return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ error: 'Could not reach the database. Try again.' }, { status: 503 })
  }
  if (body.action === 'assign') {
    const memberId = typeof body.memberId === 'string' && UUID_RE.test(body.memberId) ? body.memberId : null
    if (!memberId) return NextResponse.json({ error: 'Pick someone.' }, { status: 400 })
    const r = await assignCover(ctx, settings.settings, params.id, memberId, actor)
    if (r.kind === 'ok') return NextResponse.json({ ok: true })
    if (r.kind === 'refused') return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ error: 'Could not reach the database. Try again.' }, { status: 503 })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
