/**
 * One crew party, for Allie (prompt 04 §3).
 *
 *   GET    facts, the booking link, spots with who holds them and any live
 *          cover request (with its reason — Allie only), the standby list, and
 *          every active member with their conflicts for a crew and a Lead spot.
 *   PATCH  { action, … }:
 *            publish | unpublish
 *            assign { slotId, memberId, force? }   via crew_admin_assign; Allie as Lead included
 *            unassign { slotId }
 *            add_spot | remove_spot { slotId }
 *            set_count { value: 1..10 | null }
 *            fields { extra_flat_cents?, notes_for_crew? }
 *            clear_flag { flag }
 *
 * Every write records `adminActorId(req)`. Attendance is Phase 5.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { loadCrewSettings } from '@/lib/crew/settings'
import { loadAdminParty } from '@/lib/crew/admin'
import {
  addSpot, assignMember, clearPartyFlag, publishParty, removeSpot, setPartyFields, setSlotsOverride, unassignMember,
  unpublishParty, type ActionResult,
} from '@/lib/crew/adminActions'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Unknown party' }, { status: 404 })
  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return NextResponse.json({ error: `Could not read the crew rules: ${settings.error}` }, { status: 503 })
  const r = await loadAdminParty(sb, params.id, settings.settings)
  if (r.kind !== 'ok') return NextResponse.json({ error: `Could not read the party: ${r.error}` }, { status: 503 })
  if (!r.data) return NextResponse.json({ error: 'Unknown party' }, { status: 404 })
  return NextResponse.json({ ...r.data, settings: { extraMaxCents: 100_000 } })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Unknown party' }, { status: 404 })
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const sb = getSupabase()
  const actor = adminActorId(req)
  const now = new Date()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return NextResponse.json({ error: `Could not read the crew rules: ${settings.error}` }, { status: 503 })
  const s = settings.settings

  let r: ActionResult
  switch (body?.action) {
    case 'publish': r = await publishParty(sb, params.id, actor, now); break
    case 'unpublish': r = await unpublishParty(sb, params.id, actor); break
    case 'assign': r = await assignMember(sb, params.id, { slotId: body.slotId, memberId: body.memberId, force: body.force }, actor, s); break
    case 'unassign': r = await unassignMember(sb, params.id, body.slotId, actor); break
    case 'add_spot': r = await addSpot(sb, params.id, actor); break
    case 'remove_spot': r = await removeSpot(sb, params.id, body.slotId, actor); break
    case 'set_count': r = await setSlotsOverride(sb, params.id, body.value, actor, s); break
    case 'fields': r = await setPartyFields(sb, params.id, { extra_flat_cents: body.extra_flat_cents, notes_for_crew: body.notes_for_crew }, actor); break
    case 'clear_flag': r = await clearPartyFlag(sb, params.id, body.flag, actor); break
    default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
  if (!r.ok) return NextResponse.json({ error: r.error, warnings: r.warnings ?? [] }, { status: r.status })
  return NextResponse.json(r)
}
