import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { isUuid, requireCrewMember } from '@/lib/crew/auth'
import { loadCrewSettings } from '@/lib/crew/settings'
import { coverOptions } from '@/lib/crew/cover'

export const dynamic = 'force-dynamic'

/**
 * What "Find Cover" shows before it texts anybody (spec §3.7): the waitlisted
 * people who could work this spot, or, when there are none, who else is free so
 * the member can ask them directly. First names and a last initial only. Read
 * only, and only for the member's own committed spot.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = guardRate(req, plannerRule('crew'))
  if (limited) return limited
  const gate = await requireCrewMember(req)
  if (!gate.ok) return gate.response
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Pick a spot.' }, { status: 400 })

  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })

  const out = await coverOptions(sb, settings.settings, gate.member, params.id)
  if (out.kind !== 'ok') {
    console.error('crew/slots/cover: read failed:', out.error)
    return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })
  }
  if (!out.data) return NextResponse.json({ error: "That isn't your spot." }, { status: 404 })
  return NextResponse.json(out.data, { headers: { 'cache-control': 'no-store' } })
}
