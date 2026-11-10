/**
 * Equitable scheduling (Adam, 2026-11-06; migration 090). Server code only.
 *
 * A party published in PICK mode is not claimed first-come: each crew member
 * answers `work` ("Available to work") or `unavailable` ("Not available"), neither of
 * which puts them on it (`standby` is the third stored answer, but since 2026-11-07
 * only the MANAGER sets it). The people who are available are RANKED by who worked
 * least recently, and the manager finalizes: each person goes on a spot or into the
 * standby pool (`approvePicks` / `moveToStandby`), and being put on a spot is the
 * confirmation. This file is that whole flow except the screens and the cron tick:
 *
 *   - `rankVolunteers` / `recommendPicks`   pure: the order and the recommendation;
 *   - `loadPickPanel`                       what the manager sees for one party;
 *   - `saveResponse`                        a crew member's answer (the one writer);
 *   - `approvePicks`                        the manager's decision, and what it changes;
 *   - `notifyPickRound`                     the messages, one round at a time.
 *
 * THE RANKING. Least recently worked first; ties go to whoever has fewer parties
 * within 30 days of this one; then who joined first. "Worked" is a party the
 * person is approved for or has worked (assigned or completed, not cancelled),
 * INCLUDING parties still ahead of them: someone approved for three parties this
 * weekend must not look like the person who has been resting, so approved-but-
 * upcoming counts. Someone who has never worked comes first. Speed of response
 * is not an input anywhere.
 *
 * Nothing here sends to a real member while CREW_ENABLED is off: every message
 * goes through `notifyMember`, which is the one place that decides that.
 */

import { createHash } from 'crypto'
import { TENANT } from '@/tenant'
import type { getSupabase } from '@/lib/supabase'
import {
  getAvailability, getPartyWithSlots, listLiveStandbys, listMembers, partiesByIds, responseCounts,
  type CrewMemberRow, type CrewPartyRow, type CrewSlotRow, type PartyWithSlots, type Read,
} from '@/lib/crew/db'
import { claimRefusal, localParts, shiftsOverlap, type CrewSettings, type SlotRole } from '@/lib/crew/rules'
import { myLiveWindows } from '@/lib/crew/board'
import { claimRefusalText } from '@/lib/crew/view'
import { eligibleFor } from '@/lib/crew/cover'
import { assignMember } from '@/lib/crew/adminActions'
import { crewLink, isTestParty, notifyMember, type NotifyCtx } from '@/lib/crew/notify'
import { notifyAssigned } from '@/lib/crew/assigned'
import { templates } from '@/lib/crew/templates'
import { shiftEtDate } from '@/lib/partyTime'
import { loadHistories, PICK_WINDOW_DAYS, rankVolunteers, type PickCandidate, type RankedVolunteer } from '@/lib/crew/ranking'

export { PICK_WINDOW_DAYS, rankVolunteers, type PickCandidate, type RankedVolunteer }

type Supa = ReturnType<typeof getSupabase>

const DAY_MS = 86_400_000
const HELD = ['assigned', 'completed']

/** How long people have to answer before a party where everyone who asked fits is approved without the manager. */
export const PICK_RESPONSE_HOURS = 48

export const RESPONSES = ['work', 'unavailable', 'standby'] as const
export type PickResponse = (typeof RESPONSES)[number]
export const isPickResponse = (v: unknown): v is PickResponse => typeof v === 'string' && (RESPONSES as readonly string[]).includes(v)

// ── The ranking (pure) ──────────────────────────────────────────────────────

export interface OpenSpot { slotId: string; role: SlotRole }
export interface Recommended { slotId: string; role: SlotRole; memberId: string }

/** Lead spots first, to the best-ranked person who may lead; then crew spots down the list. */
export function recommendPicks(openSpots: ReadonlyArray<OpenSpot>, ranked: ReadonlyArray<RankedVolunteer>): Recommended[] {
  const taken = new Set<string>()
  const out: Recommended[] = []
  for (const spot of openSpots.filter(s => s.role === 'lead')) {
    const pick = ranked.find(v => v.canLead && !taken.has(v.memberId))
    if (pick) { taken.add(pick.memberId); out.push({ slotId: spot.slotId, role: 'lead', memberId: pick.memberId }) }
  }
  for (const spot of openSpots.filter(s => s.role === 'crew')) {
    const pick = ranked.find(v => !taken.has(v.memberId))
    if (pick) { taken.add(pick.memberId); out.push({ slotId: spot.slotId, role: 'crew', memberId: pick.memberId }) }
  }
  return out
}

// ── Reads ───────────────────────────────────────────────────────────────────

export interface ResponseRow { id: string; party_id: string; member_id: string; response: PickResponse; created_at: string; updated_at: string }

export async function partyResponses(sb: Supa, partyId: string): Promise<Read<ResponseRow[]>> {
  const { data, error } = await sb.from('crew_party_responses').select('*').eq('party_id', partyId)
  if (error) return { kind: 'unavailable', error: error.message }
  return { kind: 'ok', data: (data ?? []) as ResponseRow[] }
}

const fullName = (m: Pick<CrewMemberRow, 'first_name' | 'last_name'>) => [m.first_name, m.last_name].filter(Boolean).join(' ')

export interface PickPanel {
  partyId: string
  mode: 'pick' | 'first_come'
  /** Spots still open. */
  openSpots: OpenSpot[]
  /** Everyone who asked to work and is free for it, best-ranked first. */
  volunteers: (RankedVolunteer & { name: string })[]
  /** Asked to work but now conflict (another party, or marked unavailable since). Never recommended. */
  conflicted: { memberId: string; name: string }[]
  standbys: { memberId: string; name: string }[]
  unavailable: { memberId: string; name: string }[]
  /** Active crew who have not answered yet and do not hold a spot. */
  noResponse: { memberId: string; name: string }[]
  recommendation: (Recommended & { name: string })[]
}

function inPartyScope(m: Pick<CrewMemberRow, 'is_test'>, party: Pick<CrewPartyRow, 'booking_id' | 'title'>): boolean {
  if (m.is_test && party.booking_id) return false
  if (!m.is_test && isTestParty(party)) return false
  return true
}

/** What the manager needs to decide one party. `null` when there is no such party. */
export async function loadPickPanel(sb: Supa, partyId: string, s: CrewSettings): Promise<Read<PickPanel | null>> {
  const pws = await getPartyWithSlots(sb, partyId)
  if (pws.kind !== 'ok') return pws
  if (!pws.data) return { kind: 'ok', data: null }
  const { party, slots } = pws.data
  const [members, responses, standbys] = await Promise.all([listMembers(sb), partyResponses(sb, partyId), listLiveStandbys(sb, partyId)])
  if (members.kind !== 'ok') return members
  if (responses.kind !== 'ok') return responses
  if (standbys.kind !== 'ok') return standbys

  const byId = new Map(members.data.map(m => [m.id, m]))
  const nameOf = (id: string) => { const m = byId.get(id); return m ? fullName(m) : 'Removed member' }
  const live = slots.filter(sl => sl.status !== 'cancelled')
  const openSpots: OpenSpot[] = live.filter(sl => sl.status === 'open').map(sl => ({ slotId: sl.id, role: sl.role }))
  const holding = new Set(live.filter(sl => sl.member_id && ['assigned', 'completed', 'no_show'].includes(sl.status)).map(sl => sl.member_id as string))

  const answered = new Map(responses.data.map(r => [r.member_id, r.response]))
  const asked = responses.data.filter(r => r.response === 'work' && !holding.has(r.member_id) && byId.get(r.member_id)?.status === 'active')
  const askedIds = asked.map(r => r.member_id)

  let volunteers: PickPanel['volunteers'] = []
  let conflicted: PickPanel['conflicted'] = []
  if (askedIds.length > 0 && party.status === 'published') {
    const set = new Set(askedIds)
    const [crewOk, leadOk, hist] = await Promise.all([
      eligibleFor(sb, s, { party, slots }, 'crew', set, []),
      eligibleFor(sb, s, { party, slots }, 'lead', set, []),
      loadHistories(sb, askedIds, partyId),
    ])
    if (crewOk.kind !== 'ok') return crewOk
    if (leadOk.kind !== 'ok') return leadOk
    if (hist.kind !== 'ok') return hist
    const free = new Set(crewOk.data.map(m => m.id))
    const lead = new Set(leadOk.data.map(m => m.id))
    const candidates: PickCandidate[] = crewOk.data.map(m => ({
      memberId: m.id, firstName: m.first_name, lastName: m.last_name ?? null, canLead: lead.has(m.id), joinedOn: m.joined_on,
      history: hist.data.get(m.id) ?? [],
    }))
    volunteers = rankVolunteers(new Date(party.starts_at), candidates).map(v => ({ ...v, name: nameOf(v.memberId) }))
    conflicted = askedIds.filter(id => !free.has(id)).map(id => ({ memberId: id, name: nameOf(id) }))
  }

  const recommendation = recommendPicks(openSpots, volunteers).map(r => ({ ...r, name: nameOf(r.memberId) }))
  return {
    kind: 'ok',
    data: {
      partyId,
      mode: party.selection_mode === 'pick' ? 'pick' : 'first_come',
      openSpots,
      volunteers,
      conflicted,
      // Said "standby" (the answer) or is on the live standby list (which the cover flow reads); the two are kept together.
      standbys: Array.from(new Set([
        ...responses.data.filter(r => r.response === 'standby').map(r => r.member_id),
        ...standbys.data.map(r => r.member_id),
      ])).filter(id => !holding.has(id)).map(id => ({ memberId: id, name: nameOf(id) })),
      unavailable: responses.data.filter(r => r.response === 'unavailable').map(r => ({ memberId: r.member_id, name: nameOf(r.member_id) })),
      noResponse: members.data
        .filter(m => m.status === 'active' && !m.is_owner && inPartyScope(m, party) && !holding.has(m.id) && !answered.has(m.id))
        .map(m => ({ memberId: m.id, name: fullName(m) })),
      recommendation,
    },
  }
}

/** Published, still ahead, picked by the manager: the parties the pick flow acts on. */
export async function listPickParties(sb: Supa, now: Date): Promise<Read<PartyWithSlots[]>> {
  const { data, error } = await sb.from('crew_parties').select('*')
    .eq('status', 'published').eq('selection_mode', 'pick').gt('starts_at', now.toISOString()).order('starts_at', { ascending: true })
  if (error) return { kind: 'unavailable', error: error.message }
  const rows = (data ?? []) as CrewPartyRow[]
  if (rows.length === 0) return { kind: 'ok', data: [] }
  const { data: sl, error: sErr } = await sb.from('crew_slots').select('*').in('party_id', rows.map(p => p.id))
  if (sErr) return { kind: 'unavailable', error: sErr.message }
  const slots = (sl ?? []) as CrewSlotRow[]
  return { kind: 'ok', data: rows.map(party => ({ party, slots: slots.filter(x => x.party_id === party.id) })) }
}

// ── A crew member's answer ──────────────────────────────────────────────────

export type RespondOutcome =
  | { kind: 'ok'; response: PickResponse | null }
  | { kind: 'refused'; status: number; error: string }
  | { kind: 'unavailable' }

const refused = (status: number, error: string): RespondOutcome => ({ kind: 'refused', status, error })

/**
 * Record (or clear, with `null`) a member's answer for a party. It locks nothing:
 * `work` is a request, and the only thing it checks is that the person COULD work
 * it (a spot they may hold is open, no other party then, not marked unavailable).
 * `standby` is mirrored into `crew_standbys`, which the cover flow already reads.
 */
export async function saveResponse(
  sb: Supa, s: CrewSettings, member: CrewMemberRow, partyId: string, response: PickResponse | null, now: Date,
): Promise<RespondOutcome> {
  const pws = await getPartyWithSlots(sb, partyId)
  if (pws.kind !== 'ok') return { kind: 'unavailable' }
  if (!pws.data) return refused(404, 'That party is not open.')
  const { party, slots } = pws.data
  const startsAt = new Date(party.starts_at)
  const endsAt = new Date(party.ends_at)
  if (party.status !== 'published' || startsAt.getTime() <= now.getTime()) return refused(409, claimRefusalText('party_closed'))
  if (party.selection_mode !== 'pick') return refused(409, `This one isn't picked by ${TENANT.people.customerSignoff}. Take a spot from the party page.`)
  if (member.status !== 'active' || member.is_owner) return refused(409, claimRefusalText('inactive'))
  if (slots.some(sl => sl.member_id === member.id && ['assigned', 'completed', 'no_show'].includes(sl.status))) {
    return refused(409, claimRefusalText('already_on_party'))
  }

  if (response === 'work') {
    const claimable = slots.filter(sl => sl.status === 'open' && (sl.role === 'crew' || member.can_lead))
    if (claimable.length === 0) return refused(409, 'Every spot you could take is already filled.')
    const day = localParts(startsAt).dateKey
    const [windows, avail] = await Promise.all([
      myLiveWindows(sb, member.id),
      getAvailability(sb, member.id, shiftEtDate(day, -1), shiftEtDate(day, 1)),
    ])
    if (windows.kind !== 'ok' || avail.kind !== 'ok') return { kind: 'unavailable' }
    const refusal = claimRefusal({
      party: { status: party.status, startsAt, endsAt },
      slot: { role: claimable[0].role, status: 'open' },
      member: { status: member.status, canLead: member.can_lead, isOwner: member.is_owner },
      alreadyOnParty: false,
      otherParties: windows.data.filter(w => w.partyId !== party.id).map(w => w.window),
      blocks: avail.data.blocks,
      recurring: avail.data.recurring,
      now,
    }, s)
    if (refusal) return refused(409, claimRefusalText(refusal))
  }

  if (await recordResponse(sb, partyId, member.id, response, now) === 'unavailable') return { kind: 'unavailable' }
  return { kind: 'ok', response }
}

/**
 * Write (or clear, with `null`) one answer and keep `crew_standbys` in step with it:
 * `standby` is mirrored into the live standby list the cover flow reads, anything else
 * withdraws it. The one writer for a crew member's own answer AND the manager's
 * "move to standby", so the two cannot drift.
 */
async function recordResponse(sb: Supa, partyId: string, memberId: string, response: PickResponse | null, now: Date): Promise<'ok' | 'unavailable'> {
  const found = await sb.from('crew_party_responses').select('id').eq('party_id', partyId).eq('member_id', memberId)
  if (found.error) return 'unavailable'
  const existing = ((found.data ?? []) as { id: string }[])[0] ?? null
  if (response === null) {
    if (existing) {
      const { error } = await sb.from('crew_party_responses').delete().eq('id', existing.id).select('id')
      if (error) return 'unavailable'
    }
  } else if (existing) {
    const { error } = await sb.from('crew_party_responses').update({ response, updated_at: now.toISOString() }).eq('id', existing.id).select('id')
    if (error) return 'unavailable'
  } else {
    const { error } = await sb.from('crew_party_responses').insert({ party_id: partyId, member_id: memberId, response }).select('id').maybeSingle()
    // A double tap races its own insert: the unique pair says "already answered", which is fine.
    if (error && (error as { code?: string }).code !== '23505') return 'unavailable'
  }

  if (response === 'standby') {
    const { error } = await sb.from('crew_standbys').insert({ party_id: partyId, member_id: memberId }).select('id').maybeSingle()
    if (error && (error as { code?: string }).code !== '23505') return 'unavailable'
  } else {
    const { error } = await sb.from('crew_standbys').update({ withdrawn_at: now.toISOString() })
      .eq('party_id', partyId).eq('member_id', memberId).is('withdrawn_at', null).select('id')
    if (error) return 'unavailable'
  }
  return 'ok'
}

/**
 * The manager puts someone who said they are available into the STANDBY POOL instead of a
 * spot (Adam, 2026-11-07: she finalizes the staffing, each person either on the party or on
 * standby). Their answer becomes `standby`, which is what the cover flow asks first when
 * somebody cancels. Refused for someone already on the party (take them off first) and for
 * a party that is over; it moves nobody off a spot and changes no spot.
 */
export async function moveToStandby(
  sb: Supa, partyId: string, memberId: unknown, now: Date,
): Promise<{ ok: true; result: ApproveResult } | { ok: false; status: number; error: string }> {
  if (typeof memberId !== 'string') return { ok: false, status: 400, error: 'Who should go on standby?' }
  const pws = await getPartyWithSlots(sb, partyId)
  if (pws.kind !== 'ok') return { ok: false, status: 503, error: 'Could not read the party.' }
  if (!pws.data) return { ok: false, status: 404, error: 'Unknown party.' }
  const { party, slots } = pws.data
  if (party.status !== 'published' || new Date(party.starts_at).getTime() <= now.getTime()) {
    return { ok: false, status: 409, error: 'This party is not open any more.' }
  }
  if (slots.some(sl => sl.member_id === memberId && HELD.includes(sl.status))) {
    return { ok: false, status: 409, error: 'They are on this party. Take them off first.' }
  }
  const members = await listMembers(sb)
  if (members.kind !== 'ok') return { ok: false, status: 503, error: 'Could not read the roster.' }
  const member = members.data.find(m => m.id === memberId)
  if (!member || member.is_owner) return { ok: false, status: 404, error: 'Unknown crew member.' }
  if (member.status !== 'active') return { ok: false, status: 409, error: `${member.first_name} is paused or removed.` }
  if (await recordResponse(sb, partyId, memberId, 'standby', now) === 'unavailable') {
    return { ok: false, status: 503, error: 'Could not save that. Try again.' }
  }
  return { ok: true, result: { partyId, assigned: [], flagged: [], failed: [], standbyMemberIds: [memberId], dropped: [] } }
}

// ── The manager's decision ──────────────────────────────────────────────────

export interface ApproveResult {
  partyId: string
  assigned: { slotId: string; memberId: string; assignedAt: string | null }[]
  /** Picks the server held back for a conflict the manager has not confirmed. */
  flagged: { slotId: string; memberId: string; name: string; warnings: string[] }[]
  failed: string[]
  /** Asked to work, not picked, now standby: told once per round. */
  standbyMemberIds: string[]
  /** Requests for other parties that were dropped because they overlap the one just approved. */
  dropped: { memberName: string; partyTitle: string }[]
}

/**
 * Approve people into spots, as the manager decided. Each pick is the ordinary
 * `assignMember` (so a conflict is a warning to confirm, never a silent
 * double-booking). Then: the choice is logged next to what the system had
 * recommended; once the party has no open spot left, everyone else who asked to
 * work becomes a standby; and each approved person's requests for OTHER parties
 * that overlap this one are dropped.
 */
export async function approvePicks(
  sb: Supa, partyId: string, picks: ReadonlyArray<{ slotId?: unknown; memberId?: unknown }>,
  opts: { actor: string; s: CrewSettings; now: Date; force?: boolean },
): Promise<{ ok: true; result: ApproveResult } | { ok: false; status: number; error: string }> {
  const panel = await loadPickPanel(sb, partyId, opts.s)
  if (panel.kind !== 'ok') return { ok: false, status: 503, error: 'Could not read who asked.' }
  if (!panel.data) return { ok: false, status: 404, error: 'Unknown party.' }
  const recommended = new Map(panel.data.recommendation.map(r => [r.slotId, r.memberId]))

  const result: ApproveResult = { partyId, assigned: [], flagged: [], failed: [], standbyMemberIds: [], dropped: [] }
  const members = await listMembers(sb)
  if (members.kind !== 'ok') return { ok: false, status: 503, error: 'Could not read the roster.' }
  const nameOf = (id: string) => { const m = members.data.find(x => x.id === id); return m ? fullName(m) : 'Someone' }

  for (const p of picks) {
    if (typeof p.slotId !== 'string' || typeof p.memberId !== 'string') { result.failed.push('A pick was missing its spot or person.'); continue }
    const r = await assignMember(sb, partyId, { slotId: p.slotId, memberId: p.memberId, force: opts.force === true }, opts.actor, opts.s)
    if (r.ok) result.assigned.push({ slotId: p.slotId, memberId: p.memberId, assignedAt: null })
    else if (r.status === 409 && r.warnings?.length) result.flagged.push({ slotId: p.slotId, memberId: p.memberId, name: nameOf(p.memberId), warnings: r.warnings })
    else result.failed.push(r.error)
  }
  if (result.assigned.length === 0) return { ok: true, result }

  // The audit trail: who was approved, and whether it was what the system recommended.
  const { error: logErr } = await sb.from('crew_pick_log').insert(result.assigned.map(a => ({
    party_id: partyId, slot_id: a.slotId, member_id: a.memberId, recommended_member_id: recommended.get(a.slotId) ?? null,
    overridden: recommended.get(a.slotId) !== a.memberId, decided_by: opts.actor,
  }))).select('id')
  if (logErr) console.error('crew/pick: log not written:', logErr.message)

  const after = await getPartyWithSlots(sb, partyId)
  if (after.kind !== 'ok' || !after.data) return { ok: true, result }
  const slotById = new Map(after.data.slots.map(sl => [sl.id, sl]))
  for (const a of result.assigned) a.assignedAt = slotById.get(a.slotId)?.assigned_at ?? null

  // Nobody left to hold a spot for: everyone else who asked is a standby now.
  const stillOpen = after.data.slots.some(sl => sl.status === 'open')
  if (!stillOpen && result.flagged.length === 0) {
    const holding = new Set(after.data.slots.filter(sl => sl.member_id && HELD.includes(sl.status)).map(sl => sl.member_id as string))
    const responses = await partyResponses(sb, partyId)
    if (responses.kind === 'ok') {
      const left = responses.data.filter(r => r.response === 'work' && !holding.has(r.member_id)).map(r => r.member_id)
      for (const memberId of left) {
        const { error } = await sb.from('crew_party_responses').update({ response: 'standby', updated_at: opts.now.toISOString() })
          .eq('party_id', partyId).eq('member_id', memberId).select('id')
        if (error) continue
        const ins = await sb.from('crew_standbys').insert({ party_id: partyId, member_id: memberId }).select('id').maybeSingle()
        if (ins.error && (ins.error as { code?: string }).code !== '23505') continue
        result.standbyMemberIds.push(memberId)
      }
    }
  }

  // An approved person's other requests that overlap this party can no longer be honoured.
  const thisWindow = { startsAt: new Date(after.data.party.starts_at), endsAt: new Date(after.data.party.ends_at) }
  for (const a of result.assigned) {
    const { data, error } = await sb.from('crew_party_responses').select('id, party_id').eq('member_id', a.memberId).eq('response', 'work').neq('party_id', partyId)
    if (error) continue
    const rows = (data ?? []) as { id: string; party_id: string }[]
    if (rows.length === 0) continue
    const others = await partiesByIds(sb, rows.map(r => r.party_id))
    if (others.kind !== 'ok') continue
    for (const o of others.data) {
      if (o.status !== 'published' || !shiftsOverlap(thisWindow, { startsAt: new Date(o.starts_at), endsAt: new Date(o.ends_at) }, opts.s)) continue
      const row = rows.find(r => r.party_id === o.id)
      if (!row) continue
      const del = await sb.from('crew_party_responses').delete().eq('id', row.id).select('id')
      if (!del.error) result.dropped.push({ memberName: nameOf(a.memberId), partyTitle: o.title })
    }
  }
  return { ok: true, result }
}

// ── The messages ────────────────────────────────────────────────────────────

/**
 * Tell people what one decision round did. Approved staff each get their party;
 * everyone moved to standby gets ONE message for the whole round, however many
 * parties it covered. All of it goes through `notifyMember`, so a real member
 * hears nothing while the crew app is off, and quiet hours and STOP are honoured.
 */
export async function notifyPickRound(ctx: NotifyCtx, s: CrewSettings, results: ReadonlyArray<ApproveResult>): Promise<{ approved: number; standby: number }> {
  const out = { approved: 0, standby: 0 }
  if (results.length === 0) return out
  const members = await listMembers(ctx.sb)
  const parties = await partiesByIds(ctx.sb, results.map(r => r.partyId))
  if (members.kind !== 'ok' || parties.kind !== 'ok') return out
  const memberOf = new Map(members.data.map(m => [m.id, m]))
  const partyOf = new Map(parties.data.map(p => [p.id, p]))

  const byMember = new Map<string, string[]>()
  for (const res of results) {
    const party = partyOf.get(res.partyId)
    if (!party) continue
    for (const a of res.assigned) {
      const m = memberOf.get(a.memberId)
      if (!m) continue
      // Approved is "assigned": the same message as when the manager puts someone on a spot by hand.
      if (await notifyAssigned(ctx, s, a.slotId) === 'sent') out.approved++
    }
    for (const id of res.standbyMemberIds) byMember.set(id, [...(byMember.get(id) ?? []), res.partyId])
  }
  for (const [memberId, partyIds] of Array.from(byMember.entries())) {
    const m = memberOf.get(memberId)
    if (!m) continue
    const id = createHash('sha1').update([...partyIds].sort().join('|')).digest('hex').slice(0, 12)
    const r = await notifyMember(ctx, m, 'pickStandby', templates.pickStandby(m.first_name, partyIds.length, crewLink('/crew')),
      `pick_standby:${memberId}:${id}`, { payload: { parties: partyIds.length } })
    if (r.kind === 'done' && r.channels.in_app === 'sent') out.standby++
  }
  return out
}

// ── Whole-board decisions ───────────────────────────────────────────────────

/**
 * The parties that need the manager: picked by her, still ahead, with a spot open
 * and at least one person asking to work it. Earliest first, so a person approved
 * for one is already "recent" when the next is ranked.
 */
export async function partiesNeedingPicks(sb: Supa, now: Date, s: CrewSettings): Promise<Read<PartyWithSlots[]>> {
  const parties = await listPickParties(sb, now)
  if (parties.kind !== 'ok') return parties
  const open = parties.data.filter(p => p.slots.some(sl => sl.status === 'open'))
  if (open.length === 0) return { kind: 'ok', data: [] }
  const counts = await responseCounts(sb, open.map(p => p.party.id))
  if (counts.kind !== 'ok') return counts
  const waiting: PartyWithSlots[] = []
  for (const p of open) {
    if ((counts.data.get(p.party.id)?.work ?? 0) === 0) continue
    const panel = await loadPickPanel(sb, p.party.id, s)
    if (panel.kind !== 'ok') return panel
    if (panel.data && panel.data.volunteers.length > 0) waiting.push(p)
  }
  return { kind: 'ok', data: waiting }
}

/** Approve the recommendation for every party that needs one, earliest first. One round of messages. */
export async function approveAllRecommended(
  sb: Supa, opts: { actor: string; s: CrewSettings; now: Date },
): Promise<{ ok: true; results: ApproveResult[]; parties: number } | { ok: false; status: number; error: string }> {
  const need = await partiesNeedingPicks(sb, opts.now, opts.s)
  if (need.kind !== 'ok') return { ok: false, status: 503, error: 'Could not read the parties waiting.' }
  const results: ApproveResult[] = []
  for (const { party } of need.data) {
    const panel = await loadPickPanel(sb, party.id, opts.s)
    if (panel.kind !== 'ok' || !panel.data || panel.data.recommendation.length === 0) continue
    const r = await approvePicks(sb, party.id, panel.data.recommendation, opts)
    if (r.ok && r.result.assigned.length > 0) results.push(r.result)
  }
  return { ok: true, results, parties: need.data.length }
}

