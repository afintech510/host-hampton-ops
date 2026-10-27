import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { isUuid, requireCrewMember } from '@/lib/crew/auth'
import { getPartyWithSlots } from '@/lib/crew/db'

export const dynamic = 'force-dynamic'

/**
 * "I can cover" (spec §3.7): be a standby on an upcoming published party I am
 * not working, or stop being one. Unlimited and no obligation. The unique index
 * `uq_crew_standbys_live` is what keeps it to one live row per pair, so a
 * double tap is a 23505 and reads as "already on".
 */
export async function POST(req: NextRequest) {
  const limited = guardRate(req, plannerRule('crew'))
  if (limited) return limited
  const gate = await requireCrewMember(req)
  if (!gate.ok) return gate.response
  const member = gate.member

  const body = await req.json().catch(() => ({}))
  const partyId = body?.partyId
  const on = body?.on
  if (!isUuid(partyId) || typeof on !== 'boolean') return NextResponse.json({ error: 'Pick a party.' }, { status: 400 })

  const sb = getSupabase()
  const unavailable = () => NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })

  if (!on) {
    const { error } = await sb
      .from('crew_standbys')
      .update({ withdrawn_at: new Date().toISOString() })
      .eq('party_id', partyId)
      .eq('member_id', member.id)
      .is('withdrawn_at', null)
      .select('id')
    if (error) {
      console.error('crew/standby: withdraw failed:', error.message)
      return unavailable()
    }
    return NextResponse.json({ ok: true, standby: false })
  }

  const pws = await getPartyWithSlots(sb, partyId)
  if (pws.kind !== 'ok') return unavailable()
  const party = pws.data?.party
  if (!party || party.status !== 'published' || new Date(party.starts_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: 'This party is no longer open.' }, { status: 409 })
  }
  if (pws.data!.slots.some(s => s.member_id === member.id && ['assigned', 'completed', 'no_show'].includes(s.status))) {
    return NextResponse.json({ error: "You're already working this party." }, { status: 409 })
  }

  const { error } = await sb.from('crew_standbys').insert({ party_id: partyId, member_id: member.id }).select('id').maybeSingle()
  if (error && (error as { code?: string }).code !== '23505') {
    console.error('crew/standby: insert failed:', error.message)
    return unavailable()
  }
  return NextResponse.json({ ok: true, standby: true })
}
