/**
 * Opens a cover request the way `releaseMySpot` does, but WITHOUT its "somebody
 * on the waitlist could work it" check, to reach what happens when the request
 * is open and nobody can be asked: the last standby withdrew (or was blocked) a
 * moment after the check passed. `releaseMySpot` itself refuses that case.
 */
import { getPartyWithSlots, releaseSlot, type CrewMemberRow } from '@/lib/crew/db'
import { startCoverRequest } from '@/lib/crew/cover'
import type { CrewSettings } from '@/lib/crew/rules'
import type { NotifyCtx } from '@/lib/crew/notify'
import type { FakeCrewDb } from './fakeCrewDb'

export async function openCoverNobodyToAsk(
  ctx: NotifyCtx, s: CrewSettings, db: FakeCrewDb, member: CrewMemberRow, slotId: string, reason: 'sick' | 'family' | 'school' | 'other' = 'sick',
) {
  const slot = db.tables.crew_slots.find(r => r.id === slotId)
  const party = db.tables.crew_parties.find(r => r.id === slot.party_id)
  const res = await releaseSlot(db.sb as never, {
    slotId, memberId: member.id, partyStartsAt: new Date(party.starts_at), reason, note: null, now: ctx.now, settings: s,
  })
  if (res.kind !== 'ok' || res.result !== 'requested') throw new Error(`expected a request to open, got ${JSON.stringify(res)}`)
  const swap = db.tables.crew_swap_requests.find(r => r.slot_id === slotId && r.status === 'open')
  const pws = await getPartyWithSlots(db.sb as never, party.id)
  if (pws.kind !== 'ok' || !pws.data) throw new Error('party not readable')
  return startCoverRequest(ctx, s, swap, pws.data, member)
}
