/**
 * One crew party, for Allie (prompt 04 §3).
 *
 *   GET    facts, the booking link, spots with who holds them and any live
 *          cover request (with its reason — Allie only), the standby list, and
 *          every active member with their conflicts for a crew and a Lead spot.
 *   PATCH  { action, … }:
 *            publish | unpublish
 *            assign { slotId, memberId, force? }   via crew_admin_assign; Allie as Lead included
 *            approve_picks { picks: [{ slotId, memberId }], force? }   equitable scheduling: approve from the ranked list
 *            unassign { slotId }
 *            add_spot | remove_spot { slotId }
 *            set_count { value: 1..10 | null }
 *            fields { extra_flat_cents?, notes_for_crew? }
 *            shift { crew_start?, end?, lead_start? }  "HH:MM" Eastern, or null for the default
 *            clear_flag { flag }
 *
 * Every write records `adminActorId(req)`. Attendance is Phase 5.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { loadCrewSettings } from '@/lib/crew/settings'
import { loadAdminParty, shiftForAdmin } from '@/lib/crew/admin'
import { approvePicks, loadPickPanel, notifyPickRound } from '@/lib/crew/pick'
import { notifyAssigned } from '@/lib/crew/assigned'
import {
  addSpot, assignMember, clearPartyFlag, publishParty, removeSpot, setPartyFields, setSlotsOverride, unassignMember,
  setPartyShift, unpublishParty, type ActionResult,
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
  // A party the manager picks also carries who asked, ranked, and what the system recommends.
  let pick = null
  if (r.data.party.selection_mode === 'pick') {
    const panel = await loadPickPanel(sb, params.id, settings.settings)
    if (panel.kind !== 'ok') return NextResponse.json({ error: `Could not read who asked: ${panel.error}` }, { status: 503 })
    pick = panel.data
  }
  return NextResponse.json({ ...r.data, pick, shift: shiftForAdmin(r.data.party, settings.settings), settings: { extraMaxCents: 100_000 } })
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

  // Approve people from the ranked list: the same assignments as `assign`, plus the log, the standby
  // list for everyone else who asked, and one round of messages.
  if (body?.action === 'approve_picks') {
    const picks = Array.isArray(body.picks) ? (body.picks as { slotId?: unknown; memberId?: unknown }[]) : []
    if (picks.length === 0) return NextResponse.json({ error: 'Pick at least one person.' }, { status: 400 })
    const out = await approvePicks(sb, params.id, picks, { actor, s, now, force: body.force === true })
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
    const told = await notifyPickRound({ sb, now }, s, [out.result])
    return NextResponse.json({
      ok: true, assigned: out.result.assigned.length, flagged: out.result.flagged, failed: out.result.failed,
      standby: out.result.standbyMemberIds.length, dropped: out.result.dropped, told,
    })
  }

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
    case 'shift': r = await setPartyShift(sb, params.id, { crew_start: body.crew_start, end: body.end, lead_start: body.lead_start }, actor); break
    case 'clear_flag': r = await clearPartyFlag(sb, params.id, body.flag, actor); break
    default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
  if (!r.ok) return NextResponse.json({ error: r.error, warnings: r.warnings ?? [] }, { status: r.status })
  // Put on a spot by hand: tell them, with the whole shift, how to accept it and where to add it to a calendar.
  if (body?.action === 'assign' && typeof body.slotId === 'string') {
    try { await notifyAssigned({ sb, now }, s, body.slotId) } catch (e) { console.error('crew/assign: notice not sent:', e instanceof Error ? e.message : e) }
  }
  return NextResponse.json(r)
}
