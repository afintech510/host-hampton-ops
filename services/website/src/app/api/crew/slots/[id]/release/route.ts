import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { isUuid, requireCrewMember } from '@/lib/crew/auth'
import { loadCrewSettings } from '@/lib/crew/settings'
import { isCancelReason, releaseMySpot } from '@/lib/crew/cover'

export const dynamic = 'force-dynamic'

/**
 * "Find Cover" (spec §3.7, changed 2026-11-05). Always a cover request to the
 * waitlist, however far off the party is; the member stays on the party until
 * one of them takes it. With nobody on the waitlist who could work the spot it
 * is a 409 and nothing is written. `crew_release_slot` re-checks the start
 * under a row lock. A reason is required; only Allie ever sees it.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = guardRate(req, plannerRule('crew'))
  if (limited) return limited
  const gate = await requireCrewMember(req)
  if (!gate.ok) return gate.response
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Pick a spot.' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  if (!isCancelReason(body?.reason)) return NextResponse.json({ error: 'Pick a reason.' }, { status: 400 })
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) || null : null

  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })

  const out = await releaseMySpot({ sb, now: new Date() }, settings.settings, gate.member, params.id, body.reason, note)
  switch (out.kind) {
    case 'requested': return NextResponse.json({ ok: true, kind: 'requested', asked: out.asked })
    case 'already_requested': return NextResponse.json({ ok: true, kind: 'already_requested' })
    case 'refused': return NextResponse.json({ error: out.error }, { status: out.status })
    default: return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })
  }
}
