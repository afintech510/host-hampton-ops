import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { isUuid, requireCrewMember } from '@/lib/crew/auth'
import { getPartyWithSlots, getSlot } from '@/lib/crew/db'

export const dynamic = 'force-dynamic'

/**
 * "I'll be there" (spec §3.7). Sets `confirmed_at` on the member's own assigned
 * spot on an upcoming party, once. One conditional UPDATE, read back.
 */
export async function POST(req: NextRequest) {
  const limited = guardRate(req, plannerRule('crew'))
  if (limited) return limited
  const gate = await requireCrewMember(req)
  if (!gate.ok) return gate.response
  const member = gate.member

  const body = await req.json().catch(() => ({}))
  const slotId = body?.slotId
  if (!isUuid(slotId)) return NextResponse.json({ error: 'Pick a party.' }, { status: 400 })

  const sb = getSupabase()
  const unavailable = () => NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })
  const slot = await getSlot(sb, slotId)
  if (slot.kind !== 'ok') return unavailable()
  if (!slot.data || slot.data.member_id !== member.id || slot.data.status !== 'assigned') {
    return NextResponse.json({ error: "That isn't your spot." }, { status: 404 })
  }
  if (slot.data.confirmed_at) return NextResponse.json({ ok: true })
  const pws = await getPartyWithSlots(sb, slot.data.party_id)
  if (pws.kind !== 'ok') return unavailable()
  if (!pws.data || pws.data.party.status !== 'published' || new Date(pws.data.party.starts_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: 'This party is no longer open.' }, { status: 409 })
  }

  const { data: done, error } = await sb
    .from('crew_slots')
    .update({ confirmed_at: new Date().toISOString() })
    .eq('id', slotId)
    .eq('member_id', member.id)
    .eq('status', 'assigned')
    .is('confirmed_at', null)
    .select('id')
    .maybeSingle()
  if (error) {
    console.error('crew/confirm: update failed:', error.message)
    return unavailable()
  }
  if (!done) return NextResponse.json({ error: 'That spot changed. Refresh and try again.' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
