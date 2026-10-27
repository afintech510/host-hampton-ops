import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { isUuid, requireCrewMember } from '@/lib/crew/auth'
import { loadCrewSettings } from '@/lib/crew/settings'
import { claimSlot, getAvailability, getPartyWithSlots, getSlot } from '@/lib/crew/db'
import { myLiveWindows } from '@/lib/crew/board'
import { claimRefusal, localParts } from '@/lib/crew/rules'
import { claimRefusalText } from '@/lib/crew/view'
import { shiftEtDate } from '@/lib/partyTime'

export const dynamic = 'force-dynamic'

/**
 * Claim an open spot (spec §3.6). Every condition is re-checked here with
 * `claimRefusal` — including overlap and availability, which the database
 * cannot see — and then `crew_claim_slot` takes the row lock and re-checks the
 * ones it can. First claim wins.
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
  if (!slot.data) return NextResponse.json({ error: claimRefusalText('unavailable') }, { status: 404 })
  const pws = await getPartyWithSlots(sb, slot.data.party_id)
  if (pws.kind !== 'ok') return unavailable()
  if (!pws.data) return NextResponse.json({ error: claimRefusalText('unavailable') }, { status: 404 })

  const party = pws.data.party
  const startsAt = new Date(party.starts_at)
  const endsAt = new Date(party.ends_at)
  const day = localParts(startsAt).dateKey
  const [windows, avail] = await Promise.all([
    myLiveWindows(sb, member.id),
    getAvailability(sb, member.id, shiftEtDate(day, -1), shiftEtDate(day, 1)),
  ])
  if (windows.kind !== 'ok' || avail.kind !== 'ok') return unavailable()

  const refusal = claimRefusal({
    party: { status: party.status, startsAt, endsAt },
    slot: { role: slot.data.role, status: slot.data.status },
    member: { status: member.status, canLead: member.can_lead, isOwner: member.is_owner },
    alreadyOnParty: pws.data.slots.some(s => s.member_id === member.id && ['assigned', 'completed', 'no_show'].includes(s.status)),
    otherParties: windows.data.filter(w => w.partyId !== party.id).map(w => w.window),
    blocks: avail.data.blocks,
    recurring: avail.data.recurring,
    now: new Date(),
  }, settings.settings)
  if (refusal) return NextResponse.json({ error: claimRefusalText(refusal), reason: refusal }, { status: 409 })

  const res = await claimSlot(sb, slotId, member.id)
  if (res.kind !== 'ok') {
    console.error('crew/claim: rpc failed:', res.error)
    return unavailable()
  }
  if (res.result !== 'assigned') {
    return NextResponse.json({ error: claimRefusalText(res.result), reason: res.result }, { status: 409 })
  }
  return NextResponse.json({ ok: true })
}
