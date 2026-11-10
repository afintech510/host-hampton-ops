/**
 * Equitable scheduling, the whole board (migration 090).
 *
 *   GET   the parties that need a decision (picked by the manager, still ahead, a
 *         spot open, at least one person asking to work it), earliest first, each
 *         with who asked ranked by who worked least recently and the recommendation;
 *   POST  { action: 'approve_all' } approve the recommendation for every one of
 *         them, earliest first (so somebody approved for one is already "recent"
 *         when the next is ranked), and send ONE round of messages.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { loadCrewSettings } from '@/lib/crew/settings'
import { approveAllRecommended, loadPickPanel, notifyPickRound, partiesNeedingPicks } from '@/lib/crew/pick'
import { partyDayLabel, partyTimeLabel } from '@/lib/crew/view'

export const dynamic = 'force-dynamic'

const MAX_LISTED = 40

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return NextResponse.json({ error: `Could not read the crew rules: ${settings.error}` }, { status: 503 })
  const need = await partiesNeedingPicks(sb, new Date(), settings.settings)
  if (need.kind !== 'ok') return NextResponse.json({ error: `Could not read the parties: ${need.error}` }, { status: 503 })

  const parties = []
  for (const { party } of need.data.slice(0, MAX_LISTED)) {
    const panel = await loadPickPanel(sb, party.id, settings.settings)
    if (panel.kind !== 'ok' || !panel.data) continue
    parties.push({
      id: party.id,
      title: party.title,
      when: `${partyDayLabel(party.starts_at)}, ${partyTimeLabel(party.starts_at, party.ends_at)}`,
      startsAt: party.starts_at,
      open: panel.data.openSpots.length,
      asked: panel.data.volunteers.length + panel.data.conflicted.length,
      recommendation: panel.data.recommendation.map(r => ({ role: r.role, name: r.name })),
      conflicted: panel.data.conflicted.map(c => c.name),
    })
  }
  return NextResponse.json({ parties, total: need.data.length })
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const body = await req.json().catch(() => ({}))
  if (body?.action !== 'approve_all') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  const sb = getSupabase()
  const now = new Date()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return NextResponse.json({ error: `Could not read the crew rules: ${settings.error}` }, { status: 503 })
  const out = await approveAllRecommended(sb, { actor: adminActorId(req), s: settings.settings, now })
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
  const told = await notifyPickRound({ sb, now }, settings.settings, out.results)
  return NextResponse.json({
    ok: true,
    parties: out.parties,
    approved: out.results.reduce((n, r) => n + r.assigned.length, 0),
    standby: out.results.reduce((n, r) => n + r.standbyMemberIds.length, 0),
    dropped: out.results.flatMap(r => r.dropped),
    held: out.results.flatMap(r => r.flagged.map(f => `${f.name}: ${f.warnings.join(' ')}`)),
    told,
  })
}
