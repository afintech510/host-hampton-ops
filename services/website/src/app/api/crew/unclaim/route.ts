import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { isUuid, requireCrewMember } from '@/lib/crew/auth'
import { loadCrewSettings } from '@/lib/crew/settings'
import { getPartyWithSlots, getSlot, hasActiveSwap } from '@/lib/crew/db'
import { canUndoClaim } from '@/lib/crew/rules'

export const dynamic = 'force-dynamic'

/**
 * Undo a claim (spec §3.6). Allowed while `now < confirmationSchedule().requestAt`,
 * and then it counts as never claimed: no ledger row, no step change.
 *
 * Only a spot the member CLAIMED (`assigned_via = 'claim'`): one Allie assigned,
 * or one taken as cover, is not theirs to hand back this way. The write is one
 * conditional UPDATE naming the member, the status and the way it was assigned,
 * read back with `.select()`, so a concurrent change makes it match nothing.
 */
export async function POST(req: NextRequest) {
  const limited = guardRate(req, plannerRule('crew'))
  if (limited) return limited
  const gate = await requireCrewMember(req)
  if (!gate.ok) return gate.response
  const member = gate.member

  const body = await req.json().catch(() => ({}))
  const slotId = body?.slotId
  if (!isUuid(slotId)) return NextResponse.json({ error: 'Pick a spot.' }, { status: 400 })

  const sb = getSupabase()
  const unavailable = () => NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return unavailable()
  const slot = await getSlot(sb, slotId)
  if (slot.kind !== 'ok') return unavailable()
  if (!slot.data || slot.data.member_id !== member.id || slot.data.status !== 'assigned') {
    return NextResponse.json({ error: "That isn't your spot." }, { status: 404 })
  }
  if (slot.data.assigned_via !== 'claim') {
    return NextResponse.json({ error: 'Allie put you on this one. Talk to her to change it.' }, { status: 409 })
  }
  const pws = await getPartyWithSlots(sb, slot.data.party_id)
  if (pws.kind !== 'ok') return unavailable()
  if (!pws.data) return NextResponse.json({ error: "That isn't your spot." }, { status: 404 })
  if (!canUndoClaim(new Date(pws.data.party.starts_at), new Date(), settings.settings)) {
    return NextResponse.json({ error: "It's too close to the party to undo. Use Can't make it." }, { status: 409 })
  }
  const swap = await hasActiveSwap(sb, slotId)
  if (swap.kind !== 'ok') return unavailable()
  if (swap.data) return NextResponse.json({ error: 'There is already a cover request on this spot.' }, { status: 409 })

  const { data: undone, error } = await sb
    .from('crew_slots')
    .update({ status: 'open', member_id: null, assigned_at: null, assigned_via: null, assigned_by: null, confirmed_at: null })
    .eq('id', slotId)
    .eq('member_id', member.id)
    .eq('status', 'assigned')
    .eq('assigned_via', 'claim')
    .select('id')
    .maybeSingle()
  if (error) {
    console.error('crew/unclaim: update failed:', error.message)
    return unavailable()
  }
  if (!undone) return NextResponse.json({ error: 'That spot changed. Refresh and try again.' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
