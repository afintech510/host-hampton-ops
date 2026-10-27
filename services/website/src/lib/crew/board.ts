/**
 * What a signed-in crew member's pages are built from. Server code only.
 *
 * Every read here is for ONE viewer, and everything it returns is a
 * `lib/crew/view.ts` projection or a flag about the viewer's own position.
 * Another member contributes a first name (`firstNamesFor`, two columns) and a
 * confirmed flag, and nothing else.
 *
 * A failed read is `unavailable`, never an empty board: "no parties" and "could
 * not read the parties" must look different to the person deciding whether to
 * take a Saturday.
 */

import type { getSupabase } from '@/lib/supabase'
import {
  canUndoClaim, claimRefusal, confirmationSchedule, type ClaimRefusal, type CrewSettings, type DateBlock,
  type PartyWindow, type RecurringBlock,
} from '@/lib/crew/rules'
import {
  firstNamesFor, getAvailability, getMemberSlots, listPartiesInRange, memberStandbyPartyIds, partiesByIds,
  type CrewMemberRow, type PartyWithSlots, type Read,
} from '@/lib/crew/db'
import { partyView, type CrewPartyView } from '@/lib/crew/view'
import { etDateString, shiftEtDate } from '@/lib/partyTime'

type Supa = ReturnType<typeof getSupabase>

const DAY_MS = 86_400_000
export const BOARD_DAYS_AHEAD = 120

export interface BoardParty {
  view: CrewPartyView
  /** Undo is open until the confirmation request goes out (§3.6). */
  canUndo: boolean
  /** The confirmation request has gone out and I have not confirmed. */
  needsConfirm: boolean
  /** Why I could not claim an open spot here, if I could not. */
  claimBlock: Extract<ClaimRefusal, 'overlap' | 'blocked'> | null
  /** Upcoming and published: claimable / standby-able in principle. */
  upcoming: boolean
}

export interface ViewerContext {
  member: CrewMemberRow
  settings: CrewSettings
  now: Date
  /** The windows of every live party I am on, for overlap. */
  myWindows: { partyId: string; window: PartyWindow }[]
  blocks: DateBlock[]
  recurring: RecurringBlock[]
  standbyPartyIds: Set<string>
}

/** My live spots' party windows, from the slots themselves, so a party outside the board's range still counts. */
export async function myLiveWindows(sb: Supa, memberId: string): Promise<Read<{ partyId: string; window: PartyWindow }[]>> {
  const slots = await getMemberSlots(sb, memberId, { statuses: ['assigned'] })
  if (slots.kind !== 'ok') return slots
  if (slots.data.length === 0) return { kind: 'ok', data: [] }
  const parties = await partiesByIds(sb, slots.data.map(s => s.party_id))
  if (parties.kind !== 'ok') return parties
  return {
    kind: 'ok',
    data: parties.data
      .filter(p => p.status === 'published' || p.status === 'draft')
      .map(p => ({ partyId: p.id, window: { startsAt: new Date(p.starts_at), endsAt: new Date(p.ends_at) } })),
  }
}

export async function loadViewerContext(
  sb: Supa, member: CrewMemberRow, settings: CrewSettings, now: Date,
): Promise<Read<ViewerContext>> {
  const today = etDateString(now)
  const [windows, avail, standbys] = await Promise.all([
    myLiveWindows(sb, member.id),
    getAvailability(sb, member.id, shiftEtDate(today, -1), shiftEtDate(today, BOARD_DAYS_AHEAD + 1)),
    memberStandbyPartyIds(sb, member.id),
  ])
  if (windows.kind !== 'ok') return windows
  if (avail.kind !== 'ok') return avail
  if (standbys.kind !== 'ok') return standbys
  return {
    kind: 'ok',
    data: {
      member, settings, now,
      myWindows: windows.data,
      blocks: avail.data.blocks,
      recurring: avail.data.recurring,
      standbyPartyIds: standbys.data,
    },
  }
}

/** Build one party as this viewer sees it, or null if they may not see it. */
export function boardParty(pws: PartyWithSlots, names: ReadonlyMap<string, string>, ctx: ViewerContext): BoardParty | null {
  const { member, settings: s, now } = ctx
  const standbySet = new Set(ctx.standbyPartyIds.has(pws.party.id) ? [member.id] : [])
  const view = partyView({ party: pws.party, slots: pws.slots, viewer: member, firstNames: names, standbyMemberIds: standbySet }, s)
  if (!view) return null
  const startsAt = new Date(view.startsAt)
  const endsAt = new Date(view.endsAt)
  const upcoming = view.status === 'published' && startsAt.getTime() > now.getTime()

  let claimBlock: BoardParty['claimBlock'] = null
  if (!view.mySlot && upcoming && view.openSpots.length > 0) {
    const r = claimRefusal({
      party: { status: pws.party.status, startsAt, endsAt },
      slot: { role: 'crew', status: 'open' },
      member: { status: member.status, canLead: member.can_lead, isOwner: member.is_owner },
      alreadyOnParty: false,
      otherParties: ctx.myWindows.filter(w => w.partyId !== pws.party.id).map(w => w.window),
      blocks: ctx.blocks,
      recurring: ctx.recurring,
      now,
    }, s)
    if (r === 'overlap' || r === 'blocked') claimBlock = r
  }

  const mine = view.mySlot
  const mineRow = mine ? pws.slots.find(sl => sl.id === mine.slotId) : null
  return {
    view,
    canUndo: !!mine && mine.status === 'assigned' && mineRow?.assigned_via === 'claim' && upcoming && canUndoClaim(startsAt, now, s),
    needsConfirm: !!mine && mine.status === 'assigned' && !mine.confirmed && upcoming
      && now.getTime() >= confirmationSchedule(startsAt, s).requestAt.getTime(),
    claimBlock,
    upcoming,
  }
}

/** Every party this viewer may see from yesterday to ~4 months out. */
export async function loadBoard(sb: Supa, ctx: ViewerContext): Promise<Read<BoardParty[]>> {
  const from = new Date(ctx.now.getTime() - DAY_MS).toISOString()
  const to = new Date(ctx.now.getTime() + BOARD_DAYS_AHEAD * DAY_MS).toISOString()
  const parties = await listPartiesInRange(sb, from, to, { statuses: ['published', 'completed', 'cancelled'] })
  if (parties.kind !== 'ok') return parties
  const names = await teamNames(sb, parties.data)
  if (names.kind !== 'ok') return names
  const out: BoardParty[] = []
  for (const pws of parties.data) {
    const b = boardParty(pws, names.data, ctx)
    if (b) out.push(b)
  }
  return { kind: 'ok', data: out }
}

/** First names of everybody holding a live spot on these parties. */
export async function teamNames(sb: Supa, parties: PartyWithSlots[]): Promise<Read<Map<string, string>>> {
  const ids = parties.flatMap(p => p.slots)
    .filter(sl => sl.member_id && ['assigned', 'completed', 'no_show'].includes(sl.status))
    .map(sl => sl.member_id as string)
  if (ids.length === 0) return { kind: 'ok', data: new Map() }
  return firstNamesFor(sb, ids)
}
