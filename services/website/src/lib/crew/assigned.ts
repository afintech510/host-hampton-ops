/**
 * "You've been put on this": the message to a crew member the manager assigned,
 * by hand or from the ranked list. It names the whole shift, says to open the app
 * and tap Accept Assignment, and carries the link that adds the shift to a phone
 * calendar. Server code only.
 *
 * It goes through `notifyMember`, the one place that decides who may be messaged
 * (never the owner; a real member only once the crew app is on; quiet hours and
 * STOP honoured), and its dedupe key names the assignment (`slot:member:when`),
 * so a retry sends nothing twice while a spot that is later taken and given again
 * is a new assignment and is told again.
 */

import { getMember, getSlot, partiesByIds } from '@/lib/crew/db'
import type { CrewSettings } from '@/lib/crew/rules'
import { templates } from '@/lib/crew/templates'
import { notifyMember, partyRefFor, type NotifyCtx } from '@/lib/crew/notify'
import { withCalendar } from '@/lib/crew/calendar'

export type AssignedOutcome = 'sent' | 'held' | 'unavailable'

export async function notifyAssigned(ctx: NotifyCtx, s: CrewSettings, slotId: string): Promise<AssignedOutcome> {
  const slot = await getSlot(ctx.sb, slotId)
  if (slot.kind !== 'ok') return 'unavailable'
  if (!slot.data || slot.data.status !== 'assigned' || !slot.data.member_id) return 'held'
  const [member, parties] = await Promise.all([getMember(ctx.sb, slot.data.member_id), partiesByIds(ctx.sb, [slot.data.party_id])])
  if (member.kind !== 'ok' || parties.kind !== 'ok') return 'unavailable'
  const party = parties.data[0]
  if (!member.data || !party || party.status !== 'published') return 'held'
  const ref = withCalendar(partyRefFor(party, s, undefined, slot.data.role), party, slot.data, s)
  const r = await notifyMember(ctx, member.data, 'assigned', templates.assignedByManager(ref),
    `assigned:${slot.data.id}:${slot.data.member_id}:${slot.data.assigned_at ?? 'x'}`, { payload: { party_id: party.id, slot_id: slot.data.id } })
  return r.kind === 'done' && r.channels.in_app === 'sent' ? 'sent' : 'held'
}
