/**
 * Who worked least recently: the order used to pick a crew for a party the manager
 * approves, and to decide which standby is asked first when someone needs cover.
 * Pure ranking plus the one read that feeds it. Server code only.
 *
 * Least recently worked first; ties go to whoever has fewer parties within 30 days
 * of the target; then who joined first, then name. "Worked" includes parties the
 * person is approved for but has not yet worked. Speed of response is not an input.
 */

import type { getSupabase } from '@/lib/supabase'
import { partiesByIds, type Read } from '@/lib/crew/db'

type Supa = ReturnType<typeof getSupabase>

const DAY_MS = 86_400_000
const HELD = ['assigned', 'completed']

/** "Recent" for the tie-break: parties within this many days either side of the one being filled. */
export const PICK_WINDOW_DAYS = 30
export interface PickCandidate {
  memberId: string
  firstName: string
  lastName: string | null
  /** May take the Lead spot (already judged for this party). */
  canLead: boolean
  joinedOn: string
  /** Start times of every party they are approved for or have worked, other than this one. */
  history: ReadonlyArray<{ startsAt: string }>
}

export interface RankedVolunteer {
  memberId: string
  firstName: string
  lastName: string | null
  canLead: boolean
  /** The latest party at or before this one that they hold, or null: they have never worked. */
  lastWorkedAt: string | null
  /** Parties they hold within PICK_WINDOW_DAYS either side of this one. */
  recent: number
  rank: number
}

export function rankVolunteers(targetStartsAt: Date, candidates: ReadonlyArray<PickCandidate>): RankedVolunteer[] {
  const t = targetStartsAt.getTime()
  const rows = candidates.map(c => {
    let last: number | null = null
    let recent = 0
    for (const h of c.history) {
      const at = new Date(h.startsAt).getTime()
      if (!Number.isFinite(at)) continue
      if (at <= t && (last === null || at > last)) last = at
      if (Math.abs(at - t) <= PICK_WINDOW_DAYS * DAY_MS) recent++
    }
    return { c, last, recent }
  })
  rows.sort((a, b) => {
    // Never worked first.
    if (a.last === null && b.last !== null) return -1
    if (b.last === null && a.last !== null) return 1
    if (a.last !== null && b.last !== null && a.last !== b.last) return a.last - b.last
    if (a.recent !== b.recent) return a.recent - b.recent
    if (a.c.joinedOn !== b.c.joinedOn) return a.c.joinedOn < b.c.joinedOn ? -1 : 1
    const n = a.c.firstName.localeCompare(b.c.firstName)
    return n !== 0 ? n : a.c.memberId.localeCompare(b.c.memberId)
  })
  return rows.map((r, i) => ({
    memberId: r.c.memberId, firstName: r.c.firstName, lastName: r.c.lastName, canLead: r.c.canLead,
    lastWorkedAt: r.last === null ? null : new Date(r.last).toISOString(), recent: r.recent, rank: i + 1,
  }))
}

/** The parties each member is approved for or has worked (not cancelled), other than `exceptPartyId`. */
export async function loadHistories(sb: Supa, memberIds: string[], exceptPartyId: string): Promise<Read<Map<string, { startsAt: string }[]>>> {
  const out = new Map<string, { startsAt: string }[]>()
  if (memberIds.length === 0) return { kind: 'ok', data: out }
  const { data, error } = await sb.from('crew_slots').select('member_id, party_id, status').in('member_id', memberIds).in('status', HELD)
  if (error) return { kind: 'unavailable', error: error.message }
  const slots = ((data ?? []) as { member_id: string; party_id: string; status: string }[]).filter(r => r.party_id !== exceptPartyId)
  const parties = await partiesByIds(sb, slots.map(r => r.party_id))
  if (parties.kind !== 'ok') return parties
  const startOf = new Map(parties.data.filter(p => p.status !== 'cancelled').map(p => [p.id, p.starts_at]))
  for (const r of slots) {
    const at = startOf.get(r.party_id)
    if (!at) continue
    const l = out.get(r.member_id) ?? []
    l.push({ startsAt: at })
    out.set(r.member_id, l)
  }
  return { kind: 'ok', data: out }
}

