/**
 * Allie's writes from /admin/crew (prompt 04 §3). Server code only; every
 * caller has already passed `isAdminAuthorized` and passes `adminActorId(req)`
 * as `actor`, which lands in `updated_by` (migration 080), `crew_slots.assigned_by`
 * or `crew_events.created_by`.
 *
 * Every write is CONDITIONAL on the state it was decided from, and reads its
 * result: an UPDATE that matched nothing is a refusal ("somebody changed it"),
 * never a success. Assigning goes through `crew_admin_assign`, whose row lock
 * is the only thing that can make "first claim wins" true against a crew
 * member claiming the same spot at the same moment.
 *
 * Nothing here sends anything. A message to crew is Phase 4.
 */

import type { getSupabase } from '@/lib/supabase'
import { adminAssign, getPartyWithSlots, hasActiveSwap, listMembers, type CrewPartyRow, type PartyWithSlots } from '@/lib/crew/db'
import { localParts, slotRolesFor, slotsForParty, type CrewSettings, type SlotRole } from '@/lib/crew/rules'
import { MAX_PARTY_SLOTS, rolesToAdd, STICKY_FLAGS } from '@/lib/crew/sync'
import { loadAvailability, memberFit, type Conflict } from '@/lib/crew/admin'
import { etToUtc } from '@/lib/partyTime'
import { isCalendarDate } from '@/lib/crew/adminForms'

type Supa = ReturnType<typeof getSupabase>

export type ActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; status: number; error: string; warnings?: string[] }

const refuse = (status: number, error: string, warnings?: string[]): ActionResult<never> => ({ ok: false, status, error, warnings })

const LIVE_HELD = ['assigned', 'completed', 'no_show']

type PartyRead = { error: ActionResult<never> } | { pws: PartyWithSlots }

async function readParty(sb: Supa, partyId: string): Promise<PartyRead> {
  const r = await getPartyWithSlots(sb, partyId)
  if (r.kind !== 'ok') return { error: refuse(503, `Could not read the party: ${r.error}`) }
  if (!r.data) return { error: refuse(404, 'Unknown party.') }
  return { pws: r.data }
}

// ── Publish / unpublish ─────────────────────────────────────────────────────

export async function publishParty(sb: Supa, partyId: string, actor: string, now: Date): Promise<ActionResult> {
  const read = await readParty(sb, partyId)
  if ('error' in read) return read.error
  const { party, slots } = read.pws
  if (party.status !== 'draft') return refuse(409, 'Only a draft can be published.')
  if (new Date(party.starts_at).getTime() <= now.getTime()) return refuse(409, 'This party has already started.')
  if (!slots.some(sl => sl.status !== 'cancelled')) return refuse(409, 'Add at least one spot first.')
  const { data, error } = await sb.from('crew_parties')
    .update({ status: 'published', published_at: now.toISOString(), updated_by: actor })
    .eq('id', partyId).eq('status', 'draft').select('id')
  if (error) return refuse(500, error.message)
  if ((data ?? []).length === 0) return refuse(409, 'Somebody changed this party. Reload.')
  return { ok: true }
}

/**
 * Back to draft, only while nobody holds a spot: a draft is invisible to crew,
 * and a member must never be on a party they cannot see. A crew claim can land
 * between the check and the write, so the spots are read AGAIN after it, and a
 * claim that slipped in puts the party straight back.
 */
export async function unpublishParty(sb: Supa, partyId: string, actor: string): Promise<ActionResult> {
  const read = await readParty(sb, partyId)
  if ('error' in read) return read.error
  const { party, slots } = read.pws
  if (party.status !== 'published') return refuse(409, 'Only a published party can go back to draft.')
  if (slots.some(sl => sl.member_id && LIVE_HELD.includes(sl.status))) return refuse(409, 'Someone is on this party. Unassign them first.')
  const { data, error } = await sb.from('crew_parties')
    .update({ status: 'draft', published_at: null, updated_by: actor })
    .eq('id', partyId).eq('status', 'published').select('id')
  if (error) return refuse(500, error.message)
  if ((data ?? []).length === 0) return refuse(409, 'Somebody changed this party. Reload.')

  const again = await getPartyWithSlots(sb, partyId)
  const slipped = again.kind !== 'ok' || !again.data || again.data.slots.some(sl => sl.member_id && LIVE_HELD.includes(sl.status))
  if (slipped) {
    // Unreadable counts as "maybe": put it back rather than strand a member on a draft.
    await sb.from('crew_parties').update({ status: 'published', published_at: party.published_at ?? new Date().toISOString(), updated_by: actor })
      .eq('id', partyId).eq('status', 'draft').select('id')
    return refuse(409, 'Someone claimed a spot just now, so it stays published.')
  }
  return { ok: true }
}

// ── Party fields ────────────────────────────────────────────────────────────

export interface PartyFieldsInput { extra_flat_cents?: unknown; notes_for_crew?: unknown }

export async function setPartyFields(sb: Supa, partyId: string, input: PartyFieldsInput, actor: string): Promise<ActionResult> {
  const patch: Record<string, unknown> = {}
  if (input.extra_flat_cents !== undefined) {
    const n = input.extra_flat_cents
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 100_000) return refuse(400, 'Extra pay: whole cents from 0 to $1,000.')
    patch.extra_flat_cents = n
  }
  if (input.notes_for_crew !== undefined) {
    if (input.notes_for_crew !== null && typeof input.notes_for_crew !== 'string') return refuse(400, 'Notes must be text.')
    const t = typeof input.notes_for_crew === 'string' ? input.notes_for_crew.trim() : ''
    if (t.length > 2000) return refuse(400, 'Keep notes under 2,000 characters.')
    patch.notes_for_crew = t || null
  }
  if (Object.keys(patch).length === 0) return refuse(400, 'Nothing to change.')
  const { data, error } = await sb.from('crew_parties').update({ ...patch, updated_by: actor })
    .eq('id', partyId).in('status', ['draft', 'published']).select('id')
  if (error) return refuse(500, error.message)
  if ((data ?? []).length === 0) return refuse(409, 'This party can no longer be changed.')
  return { ok: true }
}

/** Clear a flag only Allie can clear (the reconcile re-derives the others). */
export async function clearPartyFlag(sb: Supa, partyId: string, flag: unknown, actor: string): Promise<ActionResult> {
  if (typeof flag !== 'string' || !(STICKY_FLAGS as readonly string[]).includes(flag)) return refuse(400, 'That flag clears itself when the booking is fixed.')
  const read = await readParty(sb, partyId)
  if ('error' in read) return read.error
  const p = read.pws.party
  const { data, error } = await sb.from('crew_parties')
    .update({ sync_flags: (p.sync_flags ?? []).filter(f => f !== flag), updated_by: actor })
    .eq('id', partyId).eq('updated_at', p.updated_at).select('id')
  if (error) return refuse(500, error.message)
  if ((data ?? []).length === 0) return refuse(409, 'Somebody changed this party. Reload.')
  return { ok: true }
}

// ── Spots ───────────────────────────────────────────────────────────────────

export async function addSpot(sb: Supa, partyId: string, actor: string): Promise<ActionResult> {
  const read = await readParty(sb, partyId)
  if ('error' in read) return read.error
  const { party, slots } = read.pws
  if (party.status !== 'draft' && party.status !== 'published') return refuse(409, 'This party can no longer be changed.')
  const live = slots.filter(sl => sl.status !== 'cancelled')
  if (live.length >= MAX_PARTY_SLOTS) return refuse(409, `A party has ${MAX_PARTY_SLOTS} spots at most.`)
  // A studio rental has no Lead spot (Adam, 2026-10-27); everything else gets its Lead back first.
  const role: SlotRole = party.party_kind === 'studio_rental' || live.some(sl => sl.role === 'lead') ? 'crew' : 'lead'
  const { data, error } = await sb.from('crew_slots').insert({ party_id: partyId, role }).select('id').maybeSingle()
  if (error) return refuse((error as { code?: string }).code === '23505' ? 409 : 500, error.message)
  if (!data) return refuse(500, 'The spot was not created.')
  await sb.from('crew_parties').update({ updated_by: actor }).eq('id', partyId).select('id')
  return { ok: true, role }
}

/** An OPEN crew spot only. The Lead spot is never removed: every party has exactly one. */
export async function removeSpot(sb: Supa, partyId: string, slotId: unknown, actor: string): Promise<ActionResult> {
  if (typeof slotId !== 'string') return refuse(400, 'Which spot?')
  const { data, error } = await sb.from('crew_slots').update({ status: 'cancelled' })
    .eq('id', slotId).eq('party_id', partyId).eq('status', 'open').eq('role', 'crew').select('id')
  if (error) return refuse(500, error.message)
  if ((data ?? []).length === 0) return refuse(409, 'Only an open crew spot can be removed (never the Lead, never a taken spot).')
  await sb.from('crew_parties').update({ updated_by: actor }).eq('id', partyId).select('id')
  return { ok: true }
}

/**
 * Override the count (1–10, or null to go back to the formula). Missing spots
 * are added at once, under the same `updated_at` claim the reconcile takes, so
 * a Sync running at the same moment cannot add them a second time. A count
 * BELOW the spots there are removes nothing: Allie removes open spots herself.
 */
export async function setSlotsOverride(sb: Supa, partyId: string, value: unknown, actor: string, s: CrewSettings): Promise<ActionResult> {
  if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_PARTY_SLOTS)) {
    return refuse(400, `Spots: a whole number from 1 to ${MAX_PARTY_SLOTS}, or blank for the formula.`)
  }
  const read = await readParty(sb, partyId)
  if ('error' in read) return read.error
  const { party, slots } = read.pws
  if (party.status !== 'draft' && party.status !== 'published') return refuse(409, 'This party can no longer be changed.')
  const { data, error } = await sb.from('crew_parties').update({ slots_override: value, updated_by: actor })
    .eq('id', partyId).eq('updated_at', party.updated_at).select('id')
  if (error) return refuse(500, error.message)
  if ((data ?? []).length === 0) return refuse(409, 'Somebody changed this party. Reload.')
  const needed = value ?? (party.booking_id ? null : slotsForParty({ guestCount: party.guest_count }, s))
  // A booking party with the override cleared: the next Sync decides from the booking.
  if (needed == null) return { ok: true, added: 0 }
  const roles = rolesToAdd(slots, needed, party.party_kind)
  if (roles.length === 0) return { ok: true, added: 0 }
  const { data: made, error: iErr } = await sb.from('crew_slots').insert(roles.map(role => ({ party_id: partyId, role }))).select('id')
  if (iErr) return refuse(500, `Count saved, but the spots were not added: ${iErr.message}`)
  return { ok: true, added: (made ?? []).length }
}

// ── Assign / unassign ───────────────────────────────────────────────────────

const CONFLICT_TEXT: Record<Conflict, string> = {
  on_party: 'is already on this party',
  overlap: 'is working another party at that time',
  blocked: 'marked themselves unavailable then',
  not_lead: 'is not a Party Lead',
  inactive: 'is paused or removed',
}

/**
 * Put a member (Allie included, as Lead) on an open spot. An overlap or an
 * availability block is a WARNING: Allie knows things the calendar does not,
 * so she may assign anyway with `force`. Not-a-Lead, already-on-it and
 * inactive are refusals — `crew_admin_assign` and the Lead trigger refuse them
 * whatever this says.
 */
export async function assignMember(
  sb: Supa, partyId: string, input: { slotId?: unknown; memberId?: unknown; force?: unknown }, actor: string, s: CrewSettings,
): Promise<ActionResult> {
  if (typeof input.slotId !== 'string' || typeof input.memberId !== 'string') return refuse(400, 'Which spot, and who?')
  const read = await readParty(sb, partyId)
  if ('error' in read) return read.error
  const { party, slots } = read.pws
  const slot = slots.find(sl => sl.id === input.slotId)
  if (!slot) return refuse(404, 'Unknown spot.')
  if (slot.status !== 'open') return refuse(409, 'That spot is not open.')

  const members = await listMembers(sb)
  if (members.kind !== 'ok') return refuse(503, `Could not read the roster: ${members.error}`)
  const member = members.data.find(m => m.id === input.memberId)
  if (!member) return refuse(404, 'Unknown crew member.')

  const startsAt = new Date(party.starts_at)
  const endsAt = new Date(party.ends_at)
  const others = await memberWindows(sb, member.id, partyId)
  if ('error' in others) return others.error
  const day = localParts(startsAt).dateKey
  const avail = await loadAvailability(sb, day, day)
  if (avail.kind !== 'ok') return refuse(503, `Could not read availability: ${avail.error}`)

  const fit = memberFit(member, { id: partyId, startsAt, endsAt }, slots, others.windows, avail.data, s, slot.role)
  const hard = fit.conflicts.filter(c => c === 'on_party' || c === 'not_lead' || c === 'inactive')
  if (hard.length) return refuse(409, `${member.first_name} ${CONFLICT_TEXT[hard[0]]}.`)
  const soft = fit.conflicts.filter(c => c === 'overlap' || c === 'blocked')
  if (soft.length && input.force !== true) {
    const warnings = soft.map(c => c === 'overlap'
      ? `${member.first_name} ${CONFLICT_TEXT.overlap} (${fit.overlapWith.join(', ')}).`
      : `${member.first_name} ${CONFLICT_TEXT.blocked}.`)
    return refuse(409, 'Conflicts: assign anyway?', warnings)
  }

  const r = await adminAssign(sb, slot.id, member.id, actor)
  if (r.kind !== 'ok') return refuse(500, r.error)
  switch (r.result) {
    case 'assigned': return { ok: true }
    case 'not_lead': return refuse(409, `${member.first_name} is not a Party Lead.`)
    case 'already_on_party': return refuse(409, `${member.first_name} is already on this party.`)
    case 'inactive': return refuse(409, `${member.first_name} is paused or removed.`)
    case 'party_closed': return refuse(409, 'This party is cancelled or finished.')
    default: return refuse(409, 'Someone just took that spot.')
  }
}

/** A member's live party windows (other than this one), read from their own spots. */
type WindowsRead = { error: ActionResult<never> } | { windows: { partyId: string; title: string; window: { startsAt: Date; endsAt: Date } }[] }

async function memberWindows(sb: Supa, memberId: string, exceptPartyId: string): Promise<WindowsRead> {
  const { data: mine, error } = await sb.from('crew_slots').select('party_id').eq('member_id', memberId).eq('status', 'assigned')
  if (error) return { error: refuse(503, `Could not read their parties: ${error.message}`) }
  const ids = Array.from(new Set(((mine ?? []) as { party_id: string }[]).map(r => r.party_id).filter(id => id !== exceptPartyId)))
  if (ids.length === 0) return { windows: [] }
  const { data: ps, error: pErr } = await sb.from('crew_parties').select('id, title, starts_at, ends_at, status').in('id', ids)
  if (pErr) return { error: refuse(503, `Could not read their parties: ${pErr.message}`) }
  return {
    windows: ((ps ?? []) as Pick<CrewPartyRow, 'id' | 'title' | 'starts_at' | 'ends_at' | 'status'>[])
      .filter(p => p.status === 'draft' || p.status === 'published')
      .map(p => ({ partyId: p.id, title: p.title, window: { startsAt: new Date(p.starts_at), endsAt: new Date(p.ends_at) } })),
  }
}

/**
 * Take a member off a spot; the spot reopens. No step change — Allie taking
 * someone off is not the member cancelling. A spot with a live cover request
 * is refused: that request belongs to the member, and Phase 4's flow settles it.
 * The ledger gets a zero-change `admin_adjustment` naming who did it, because a
 * crew member silently vanishing from a party is exactly the thing to be able
 * to explain later.
 */
export async function unassignMember(sb: Supa, partyId: string, slotId: unknown, actor: string): Promise<ActionResult> {
  if (typeof slotId !== 'string') return refuse(400, 'Which spot?')
  const read = await readParty(sb, partyId)
  if ('error' in read) return read.error
  const slot = read.pws.slots.find(sl => sl.id === slotId)
  if (!slot) return refuse(404, 'Unknown spot.')
  if (slot.status !== 'assigned' || !slot.member_id) return refuse(409, 'Nobody is on that spot.')
  if (new Date(read.pws.party.starts_at).getTime() <= Date.now()) return refuse(409, 'The party has started; attendance settles it.')
  const swap = await hasActiveSwap(sb, slot.id)
  if (swap.kind !== 'ok') return refuse(503, `Could not read cover requests: ${swap.error}`)
  if (swap.data) return refuse(409, 'This spot has an open cover request. Settle that first.')

  const { data, error } = await sb.from('crew_slots')
    .update({ status: 'open', member_id: null, assigned_at: null, assigned_via: null, assigned_by: null, confirmed_at: null, covered_swap_id: null })
    .eq('id', slot.id).eq('party_id', partyId).eq('status', 'assigned').eq('member_id', slot.member_id).select('id')
  if (error) return refuse(500, error.message)
  if ((data ?? []).length === 0) return refuse(409, 'That spot changed. Reload.')

  const { data: m } = await sb.from('crew_members').select('steps').eq('id', slot.member_id).maybeSingle()
  const steps = Number((m as { steps?: number } | null)?.steps ?? 0)
  const { error: eErr } = await sb.from('crew_events').insert({
    member_id: slot.member_id, type: 'admin_adjustment', step_before: steps, step_delta: 0, step_after: steps,
    party_id: partyId, slot_id: slot.id, metadata: { kind: 'admin_unassign', role: slot.role }, created_by: actor,
  }).select('id')
  // The spot is already open; a missing audit row is reported, not rolled back over.
  if (eErr) return { ok: true, warning: `Unassigned, but the ledger note failed: ${eErr.message}` }
  return { ok: true }
}

// ── A party by hand ─────────────────────────────────────────────────────────

/**
 * A crew party with no booking behind it (spec §9: "Allie can also create crew
 * parties by hand"): an event, a pop-up, anything the bookings table does not
 * hold. Created as a DRAFT like every other.
 */
export async function createManualParty(sb: Supa, body: Record<string, unknown>, actor: string, s: CrewSettings, now: Date): Promise<ActionResult<{ id: string }>> {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title || title.length > 80) return refuse(400, 'A title, up to 80 characters.')
  if (!isCalendarDate(body.date)) return refuse(400, 'A date like 2026-12-05.')
  const t = (v: unknown) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v.split(':').map(Number) : null)
  const start = t(body.start)
  const end = t(body.end)
  if (!start || !end) return refuse(400, 'Start and end like 13:30.')
  const startsAt = etToUtc(body.date, start[0], start[1])
  const endsAt = etToUtc(body.date, end[0], end[1])
  if (!(endsAt.getTime() > startsAt.getTime())) return refuse(400, 'The end must be after the start.')
  if (startsAt.getTime() <= now.getTime()) return refuse(400, 'That time has passed.')
  let guestCount: number | null = null
  if (body.guest_count !== undefined && body.guest_count !== null && body.guest_count !== '') {
    if (typeof body.guest_count !== 'number' || !Number.isInteger(body.guest_count) || body.guest_count < 0 || body.guest_count > 500) {
      return refuse(400, 'Kids: a whole number.')
    }
    guestCount = body.guest_count
  }
  const location = typeof body.location === 'string' ? body.location.trim() : ''
  if (!location || location.length > 200) return refuse(400, 'A location, up to 200 characters.')
  const notes = typeof body.notes_for_crew === 'string' ? body.notes_for_crew.trim().slice(0, 2000) || null : null

  const { data, error } = await sb.from('crew_parties').insert({
    party_kind: 'manual', booking_id: null, title, theme: null,
    starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), guest_count: guestCount,
    location, notes_for_crew: notes, status: 'draft', updated_by: actor,
  }).select('id').maybeSingle()
  if (error) return refuse(500, error.message)
  const id = (data as { id: string } | null)?.id
  if (!id) return refuse(500, 'The party was not created.')
  const roles = slotRolesFor(slotsForParty({ guestCount }, s))
  const { error: sErr } = await sb.from('crew_slots').insert(roles.map(role => ({ party_id: id, role }))).select('id')
  if (sErr) return refuse(500, `Party created as a draft, but its spots were not: ${sErr.message}`)
  return { ok: true, id }
}
