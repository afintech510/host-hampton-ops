import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { isUuid, requireCrewMember } from '@/lib/crew/auth'
import { loadCrewSettings } from '@/lib/crew/settings'
import { isPickResponse, saveResponse } from '@/lib/crew/pick'

export const dynamic = 'force-dynamic'

/**
 * "Tell us what you want" (equitable scheduling, migration 090). On a party
 * the manager picks, a crew member answers `work` ("I want to work this"),
 * `unavailable` or `standby` ("add me as standby"), or `null` to take the answer
 * back. NOTHING IS LOCKED: a `work` answer is a request, and the manager approves from
 * a ranked list, so how quickly someone answers decides nothing. The only
 * refusals are the ones that say the person could not work it anyway.
 */
export async function POST(req: NextRequest) {
  const limited = guardRate(req, plannerRule('crew'))
  if (limited) return limited
  const gate = await requireCrewMember(req)
  if (!gate.ok) return gate.response

  const body = await req.json().catch(() => ({}))
  const partyId = body?.partyId
  const response = body?.response ?? null
  if (!isUuid(partyId)) return NextResponse.json({ error: 'Pick a party.' }, { status: 400 })
  if (response !== null && !isPickResponse(response)) return NextResponse.json({ error: 'Pick one of the three answers.' }, { status: 400 })

  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })

  const out = await saveResponse(sb, settings.settings, gate.member, partyId, response, new Date())
  switch (out.kind) {
    case 'ok': return NextResponse.json({ ok: true, response: out.response })
    case 'refused': return NextResponse.json({ error: out.error }, { status: out.status })
    default: return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })
  }
}
