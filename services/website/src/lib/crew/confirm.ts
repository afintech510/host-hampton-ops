/**
 * "I'll be there" (spec §3.7): from the app's button, or a Y / YES text.
 *
 * Confirming sets `confirmed_at` on the member's own assigned spot, once — one
 * conditional UPDATE naming the member, the status and `confirmed_at IS NULL`,
 * read back — and sends `confirmed`. It changes no step.
 */

import type { getSupabase } from '@/lib/supabase'
import { getMemberSlots, getSlot, partiesByIds, type CrewMemberRow, type CrewPartyRow, type CrewSlotRow } from '@/lib/crew/db'
import { confirmationSchedule, type CrewSettings } from '@/lib/crew/rules'
import { templates } from '@/lib/crew/templates'
import { notifyMember, partyRefFor, type NotifyCtx } from '@/lib/crew/notify'
import { tenure } from '@/lib/crew/cover'

type Supa = ReturnType<typeof getSupabase>

export type ConfirmOutcome =
  | { kind: 'confirmed'; slotId: string }
  | { kind: 'already'; slotId: string }
  | { kind: 'refused'; status: number; error: string }
  | { kind: 'unavailable' }

async function setConfirmed(sb: Supa, slot: CrewSlotRow, memberId: string, now: Date): Promise<'won' | 'lost' | 'unavailable'> {
  const { data, error } = await sb.from('crew_slots')
    .update({ confirmed_at: now.toISOString() })
    .eq('id', slot.id).eq('member_id', memberId).eq('status', 'assigned').is('confirmed_at', null)
    .select('id')
  if (error) { console.error(`crew/confirm: update failed: ${error.message}`); return 'unavailable' }
  return (data ?? []).length > 0 ? 'won' : 'lost'
}

async function tell(ctx: NotifyCtx, s: CrewSettings, member: CrewMemberRow, slot: CrewSlotRow, party: CrewPartyRow): Promise<void> {
  await notifyMember(ctx, member, 'confirmed', templates.confirmed(partyRefFor(party, s)), `confirmed:${tenure(slot)}`,
    { payload: { party_id: party.id, slot_id: slot.id } })
}

/** The app's button, for one named spot. */
export async function confirmSpot(ctx: NotifyCtx, s: CrewSettings, member: CrewMemberRow, slotId: string): Promise<ConfirmOutcome> {
  const slot = await getSlot(ctx.sb, slotId)
  if (slot.kind !== 'ok') return { kind: 'unavailable' }
  if (!slot.data || slot.data.member_id !== member.id || slot.data.status !== 'assigned') {
    return { kind: 'refused', status: 404, error: "That isn't your spot." }
  }
  if (slot.data.confirmed_at) return { kind: 'already', slotId }
  const parties = await partiesByIds(ctx.sb, [slot.data.party_id])
  if (parties.kind !== 'ok') return { kind: 'unavailable' }
  const party = parties.data[0]
  if (!party || party.status !== 'published' || new Date(party.starts_at).getTime() <= ctx.now.getTime()) {
    return { kind: 'refused', status: 409, error: 'This party is no longer open.' }
  }
  const won = await setConfirmed(ctx.sb, slot.data, member.id, ctx.now)
  if (won === 'unavailable') return { kind: 'unavailable' }
  if (won === 'lost') return { kind: 'refused', status: 409, error: 'That spot changed. Refresh and try again.' }
  await tell(ctx, s, member, slot.data, party)
  return { kind: 'confirmed', slotId }
}

/**
 * A Y / YES text: the member's EARLIEST assigned, unconfirmed spot on an
 * upcoming published party whose confirmation request time has passed.
 * `nothing` when there is none — the reply is "Nothing to confirm right now."
 */
export async function confirmNextDue(
  ctx: NotifyCtx, s: CrewSettings, member: CrewMemberRow,
): Promise<ConfirmOutcome | { kind: 'nothing' }> {
  const slots = await getMemberSlots(ctx.sb, member.id, { statuses: ['assigned'] })
  if (slots.kind !== 'ok') return { kind: 'unavailable' }
  const open = slots.data.filter(sl => !sl.confirmed_at)
  if (open.length === 0) return { kind: 'nothing' }
  const parties = await partiesByIds(ctx.sb, open.map(sl => sl.party_id))
  if (parties.kind !== 'ok') return { kind: 'unavailable' }
  const byId = new Map(parties.data.map(p => [p.id, p]))
  const now = ctx.now.getTime()
  const due = open
    .map(sl => ({ sl, p: byId.get(sl.party_id) }))
    .filter((x): x is { sl: CrewSlotRow; p: CrewPartyRow } => {
      if (!x.p || x.p.status !== 'published') return false
      const startsAt = new Date(x.p.starts_at)
      return startsAt.getTime() > now && now >= confirmationSchedule(startsAt, s).requestAt.getTime()
    })
    .sort((a, b) => a.p.starts_at.localeCompare(b.p.starts_at))
  if (due.length === 0) return { kind: 'nothing' }
  const { sl, p } = due[0]
  const won = await setConfirmed(ctx.sb, sl, member.id, ctx.now)
  if (won === 'unavailable') return { kind: 'unavailable' }
  if (won === 'lost') return { kind: 'already', slotId: sl.id }
  await tell(ctx, s, member, sl, p)
  return { kind: 'confirmed', slotId: sl.id }
}
