/**
 * "Can't make it" and cover (spec §3.7, prompt 05 §3). Server code only.
 *
 * Every state change here is one of two things, never a read-then-write:
 *   - a migration 077 SQL function (`crew_release_slot`, `crew_claim_swap`,
 *     `crew_drop_uncovered`), which locks the row, decides and writes; or
 *   - ONE conditional UPDATE naming the state it expects, read back with
 *     `.select()` — withdraw, escalate, "offer to everyone". Zero rows back
 *     means somebody else moved it first, and that is reported, not retried.
 *
 * The person cancelling STAYS ON THE PARTY until somebody claims. Steps move
 * only inside the SQL functions, by compare-and-swap, from `rules.ts`.
 *
 * Who is asked: the live standbys on the party who could actually work it —
 * active, not the owner, not the person cancelling, not already on it, no
 * overlapping party, not blocked that day, and `can_lead` for a Lead spot
 * (`memberFit`, the admin's own §3.6 judgment). Invented `is_test` members are
 * asked only about booking-less parties, as the admin counts do.
 */

import type { getSupabase } from '@/lib/supabase'
import {
  claimSwap, dropUncovered, getMember, getPartyWithSlots, getSlot, insertNotification, listLiveStandbys,
  listMembers, listPartiesInRange, releaseSlot,
  type ClaimSwapResult, type CrewMemberRow, type CrewPartyRow, type CrewSlotRow, type CrewSwapRow, type PartyWithSlots, type Read,
} from '@/lib/crew/db'
import { loadAvailability, memberFit, type Conflict } from '@/lib/crew/admin'
import {
  formatCents, localParts, partyPayCents, partyRateCents, standbyEscalateAt, type CrewSettings, type PartyWindow, type SlotRole,
} from '@/lib/crew/rules'
import { adminTemplates, templates } from '@/lib/crew/templates'
import { crewLink, isTestParty, notifyAdmin, notifyMember, partyRefFor, type NotifyCtx } from '@/lib/crew/notify'

type Supa = ReturnType<typeof getSupabase>

const DAY_MS = 86_400_000
export const LIVE_SWAP_STATUSES = ['open', 'escalated'] as const
export const CANCEL_REASONS = ['sick', 'family', 'school', 'other'] as const
export type CancelReason = (typeof CANCEL_REASONS)[number]

export function isCancelReason(v: unknown): v is CancelReason {
  return typeof v === 'string' && (CANCEL_REASONS as readonly string[]).includes(v)
}

/** The cover request's dedupe keys: one per assignment, so a spot taken twice is two tenures. */
export const tenure = (slot: Pick<CrewSlotRow, 'id' | 'assigned_at'>) => `${slot.id}:${slot.assigned_at ?? 'none'}`

const adminUrl = (partyId: string) => crewLink(`/admin/crew/parties/${partyId}`)
const coverPath = (swapId: string) => `/crew/cover/${swapId}`
const rateLabel = (steps: number, s: CrewSettings) => formatCents(partyRateCents('crew', steps, s))

// ── Reads ───────────────────────────────────────────────────────────────────

export interface CoverContext {
  swap: CrewSwapRow
  slot: CrewSlotRow
  pws: PartyWithSlots
}

export async function loadCover(sb: Supa, swapId: string): Promise<Read<CoverContext | null>> {
  const { data, error } = await sb.from('crew_swap_requests').select('*').eq('id', swapId).maybeSingle()
  if (error) return { kind: 'unavailable', error: error.message }
  if (!data) return { kind: 'ok', data: null }
  const swap = data as CrewSwapRow
  const slot = await getSlot(sb, swap.slot_id)
  if (slot.kind !== 'ok') return slot
  if (!slot.data) return { kind: 'ok', data: null }
  const pws = await getPartyWithSlots(sb, slot.data.party_id)
  if (pws.kind !== 'ok') return pws
  if (!pws.data) return { kind: 'ok', data: null }
  return { kind: 'ok', data: { swap, slot: slot.data, pws: pws.data } }
}

/** How many crew a cover request went to: its own in-app rows, so the count is what was actually sent. */
export async function askedCount(sb: Supa, swapId: string): Promise<Read<number>> {
  const { data, error } = await sb.from('crew_notifications').select('id')
    .like('dedupe_key', `cover:${swapId}:%`).eq('channel', 'in_app')
  if (error) return { kind: 'unavailable', error: error.message }
  return { kind: 'ok', data: (data ?? []).length }
}

/**
 * Members who could work this spot. `candidates` = 'all' (Allie's "offer to
 * everyone") or a set of member ids (the standbys). One read per table.
 */
export async function eligibleFor(
  sb: Supa, s: CrewSettings, pws: PartyWithSlots, role: SlotRole, candidates: 'all' | Set<string>, excludeIds: string[],
): Promise<Read<CrewMemberRow[]>> {
  const party = pws.party
  const startsAt = new Date(party.starts_at)
  const endsAt = new Date(party.ends_at)
  const day = localParts(startsAt).dateKey
  const [members, avail, near] = await Promise.all([
    listMembers(sb),
    loadAvailability(sb, day, day),
    listPartiesInRange(sb, new Date(startsAt.getTime() - DAY_MS).toISOString(), new Date(endsAt.getTime() + DAY_MS).toISOString(), { statuses: ['draft', 'published'] }),
  ])
  if (members.kind !== 'ok') return members
  if (avail.kind !== 'ok') return avail
  if (near.kind !== 'ok') return near

  const windows = new Map<string, { partyId: string; title: string; window: PartyWindow }[]>()
  for (const p of near.data) {
    for (const sl of p.slots) {
      if (sl.status !== 'assigned' || !sl.member_id) continue
      const l = windows.get(sl.member_id) ?? []
      l.push({ partyId: p.party.id, title: p.party.title, window: { startsAt: new Date(p.party.starts_at), endsAt: new Date(p.party.ends_at) } })
      windows.set(sl.member_id, l)
    }
  }
  const live = pws.slots.filter(sl => sl.status !== 'cancelled')
  return {
    kind: 'ok',
    data: members.data.filter(m => {
      if (m.is_owner || m.status !== 'active') return false
      if (excludeIds.includes(m.id)) return false
      if (candidates !== 'all' && !candidates.has(m.id)) return false
      if (m.is_test && party.booking_id) return false
      return memberFit(m, { id: party.id, startsAt, endsAt }, live, windows.get(m.id) ?? [], avail.data, s, role).conflicts.length === 0
    }),
  }
}

// ── Opening a cover request ─────────────────────────────────────────────────

export async function escalateSwap(
  ctx: NotifyCtx, s: CrewSettings, swap: Pick<CrewSwapRow, 'id' | 'requester_id'>, party: CrewPartyRow,
): Promise<'escalated' | 'not_open' | 'unavailable'> {
  const { data, error } = await ctx.sb.from('crew_swap_requests')
    .update({ status: 'escalated', escalated_at: ctx.now.toISOString() })
    .eq('id', swap.id).eq('status', 'open')
    .select('id')
  if (error) return 'unavailable'
  if ((data ?? []).length === 0) return 'not_open'
  const who = await getMember(ctx.sb, swap.requester_id)
  const first = who.kind === 'ok' && who.data ? who.data.first_name : 'A crew member'
  const ref = partyRefFor(party, s)
  await notifyAdmin(ctx, 'coverEscalated', adminTemplates.coverEscalated(first, ref, adminUrl(party.id)), `cover_escalated:${swap.id}`,
    { test: isTestParty(party), payload: { swap_id: swap.id, party_id: party.id } })
  return 'escalated'
}

/**
 * Text every eligible live standby, tell Allie, and escalate at once when
 * nobody could be asked. Re-running it asks nobody twice (`cover:{swap}:{member}`).
 */
export async function startCoverRequest(
  ctx: NotifyCtx, s: CrewSettings, swap: CrewSwapRow, pws: PartyWithSlots, requester: CrewMemberRow,
): Promise<Read<{ asked: number; escalated: boolean }>> {
  const standbys = await listLiveStandbys(ctx.sb, pws.party.id)
  if (standbys.kind !== 'ok') return standbys
  const eligible = await eligibleFor(ctx.sb, s, pws, swap.slot_role, new Set(standbys.data.map(r => r.member_id)), [requester.id])
  if (eligible.kind !== 'ok') return eligible

  const ref = partyRefFor(pws.party, s, coverPath(swap.id))
  let asked = 0
  for (const m of eligible.data) {
    const pay = formatCents(partyPayCents(swap.slot_role, m.steps, pws.party.extra_flat_cents, s))
    const r = await notifyMember(ctx, m, 'coverOffer', templates.coverOffer(requester.first_name, ref, swap.slot_role, pay),
      `cover:${swap.id}:${m.id}`, { payload: { swap_id: swap.id, party_id: pws.party.id } })
    if (r.kind === 'done') asked++
  }
  const { error } = await ctx.sb.from('crew_swap_requests').update({ standbys_notified_at: ctx.now.toISOString() })
    .eq('id', swap.id).is('standbys_notified_at', null).select('id')
  if (error) console.error(`crew/cover: standbys_notified_at not written for ${swap.id}: ${error.message}`)

  const reason = swap.reason_note ? `${swap.reason}: ${swap.reason_note}` : swap.reason
  await notifyAdmin(ctx, 'coverRequested',
    adminTemplates.coverRequested(requester.first_name, reason, asked, partyRefFor(pws.party, s), adminUrl(pws.party.id)),
    `cover_requested:${swap.id}`, { test: isTestParty(pws.party), payload: { swap_id: swap.id, party_id: pws.party.id } })

  // Nobody asked = escalate NOW, without consulting a clock: `created_at` is the
  // database's now(), a few milliseconds after this request's `now`, so comparing
  // the two left a zero-standby request open until the next tick (found in the
  // production probe, 2026-10-27).
  let escalated = false
  if (asked === 0 || ctx.now.getTime() >= standbyEscalateAt(new Date(swap.created_at), asked, s).getTime()) {
    escalated = (await escalateSwap(ctx, s, swap, pws.party)) === 'escalated'
  }
  return { kind: 'ok', data: { asked, escalated } }
}

// ── The crew member's side ──────────────────────────────────────────────────

export type ReleaseOutcome =
  | { kind: 'released'; rateCents: number; waived: boolean }
  | { kind: 'requested'; swapId: string; asked: number; escalated: boolean }
  | { kind: 'already_requested'; swapId: string | null }
  | { kind: 'refused'; status: number; error: string }
  | { kind: 'unavailable' }

async function liveSwapFor(sb: Supa, slotId: string, requesterId: string): Promise<Read<CrewSwapRow | null>> {
  const { data, error } = await sb.from('crew_swap_requests').select('*').eq('slot_id', slotId).eq('requester_id', requesterId)
    .in('status', [...LIVE_SWAP_STATUSES]).order('created_at', { ascending: false }).limit(1)
  if (error) return { kind: 'unavailable', error: error.message }
  return { kind: 'ok', data: ((data ?? []) as CrewSwapRow[])[0] ?? null }
}

/** "Can't make it": an early release, or a cover request to the standbys. */
export async function releaseMySpot(
  ctx: NotifyCtx, s: CrewSettings, member: CrewMemberRow, slotId: string, reason: CancelReason, note: string | null,
): Promise<ReleaseOutcome> {
  const slot = await getSlot(ctx.sb, slotId)
  if (slot.kind !== 'ok') return { kind: 'unavailable' }
  if (!slot.data || slot.data.member_id !== member.id || slot.data.status !== 'assigned') {
    return { kind: 'refused', status: 404, error: "That isn't your spot." }
  }
  const pws = await getPartyWithSlots(ctx.sb, slot.data.party_id)
  if (pws.kind !== 'ok') return { kind: 'unavailable' }
  if (!pws.data || pws.data.party.status !== 'published') return { kind: 'refused', status: 409, error: 'This party is no longer open.' }
  const party = pws.data.party
  const before = slot.data
  // Read before the write: whether the change was waived is "after vs. before".
  const stepsBefore = member.steps

  const res = await releaseSlot(ctx.sb, {
    slotId, memberId: member.id, partyStartsAt: new Date(party.starts_at), reason, note, now: ctx.now, settings: s,
  })
  if (res.kind !== 'ok') { console.error(`crew/cover: release failed for ${slotId}: ${res.error}`); return { kind: 'unavailable' } }

  switch (res.result) {
    case 'released': {
      const after = await getMember(ctx.sb, member.id)
      const steps = after.kind === 'ok' && after.data ? after.data.steps : stepsBefore
      const waived = steps >= stepsBefore
      const ref = partyRefFor(party, s)
      await notifyMember(ctx, member, 'earlyReleased',
        templates.earlyReleased(ref, rateLabel(steps, s), waived, formatCents(s.pay.stepCents)),
        `early_release:${tenure(before)}`, { payload: { party_id: party.id } })
      const noticeDays = Math.floor((new Date(party.starts_at).getTime() - ctx.now.getTime()) / DAY_MS)
      await notifyAdmin(ctx, 'spotReleased', adminTemplates.spotReleased(member.first_name, ref, noticeDays, adminUrl(party.id)),
        `spot_released:${tenure(before)}`, { test: isTestParty(party), payload: { party_id: party.id, reason } })
      return { kind: 'released', rateCents: partyRateCents('crew', steps, s), waived }
    }
    case 'requested': {
      const swap = await liveSwapFor(ctx.sb, slotId, member.id)
      if (swap.kind !== 'ok' || !swap.data) return { kind: 'unavailable' }
      const started = await startCoverRequest(ctx, s, swap.data, pws.data, member)
      if (started.kind !== 'ok') {
        // The request exists; the cron re-asks and escalates. Say so rather than pretend.
        console.error(`crew/cover: cover request ${swap.data.id} opened but the standbys could not be read: ${started.error}`)
        return { kind: 'requested', swapId: swap.data.id, asked: 0, escalated: false }
      }
      return { kind: 'requested', swapId: swap.data.id, ...started.data }
    }
    case 'already_requested': {
      const swap = await liveSwapFor(ctx.sb, slotId, member.id)
      return { kind: 'already_requested', swapId: swap.kind === 'ok' && swap.data ? swap.data.id : null }
    }
    case 'started': return { kind: 'refused', status: 409, error: 'The party already started. Call Allie.' }
    case 'not_yours': return { kind: 'refused', status: 404, error: "That isn't your spot." }
    case 'invalid': return { kind: 'refused', status: 400, error: 'Pick a reason.' }
    case 'stale': return { kind: 'unavailable' }
    default: return { kind: 'unavailable' }
  }
}

export type SwapActionOutcome =
  | { kind: 'ok' }
  | { kind: 'refused'; status: number; error: string }
  | { kind: 'unavailable' }

/** Withdraw: "I can make it after all". One conditional UPDATE. */
export async function withdrawCover(ctx: NotifyCtx, s: CrewSettings, member: CrewMemberRow, swapId: string): Promise<SwapActionOutcome> {
  const { data, error } = await ctx.sb.from('crew_swap_requests')
    .update({ status: 'cancelled', resolved_at: ctx.now.toISOString() })
    .eq('id', swapId).eq('requester_id', member.id).in('status', [...LIVE_SWAP_STATUSES])
    .select('id, slot_id')
  if (error) return { kind: 'unavailable' }
  const row = ((data ?? []) as { id: string; slot_id: string }[])[0]
  if (!row) return { kind: 'refused', status: 409, error: 'That request already closed. Refresh to see where it stands.' }
  const cover = await loadCover(ctx.sb, swapId)
  if (cover.kind === 'ok' && cover.data) {
    const party = cover.data.pws.party
    await notifyAdmin(ctx, 'coverWithdrawn', adminTemplates.coverWithdrawn(member.first_name, partyRefFor(party, s), adminUrl(party.id)),
      `cover_withdrawn:${swapId}`, { test: isTestParty(party), payload: { swap_id: swapId, party_id: party.id } })
  }
  return { kind: 'ok' }
}

/** "Drop anyway": off the party with nobody covering. Reset to the start rate (recorded, not applied, in grace). */
export async function dropAnyway(ctx: NotifyCtx, s: CrewSettings, member: CrewMemberRow, swapId: string): Promise<SwapActionOutcome> {
  const cover = await loadCover(ctx.sb, swapId)
  if (cover.kind !== 'ok') return { kind: 'unavailable' }
  if (!cover.data || cover.data.swap.requester_id !== member.id) return { kind: 'refused', status: 404, error: "That isn't your request." }
  const party = cover.data.pws.party
  if (new Date(party.starts_at).getTime() <= ctx.now.getTime()) {
    return { kind: 'refused', status: 409, error: 'The party already started. Call Allie.' }
  }
  const stepsBefore = member.steps
  const res = await dropUncovered(ctx.sb, { swapId, memberId: member.id, now: ctx.now, settings: s })
  if (res.kind !== 'ok' || res.result === 'stale') return { kind: 'unavailable' }
  if (res.result !== 'dropped') return { kind: 'refused', status: 409, error: 'That request already closed. Refresh to see where it stands.' }

  const after = await getMember(ctx.sb, member.id)
  const steps = after.kind === 'ok' && after.data ? after.data.steps : stepsBefore
  const ref = partyRefFor(party, s)
  await notifyMember(ctx, member, 'droppedUncovered',
    templates.droppedUncovered(ref, rateLabel(steps, s), steps >= stepsBefore && stepsBefore > 0, formatCents(s.pay.stepCents)),
    `dropped:${swapId}`, { payload: { swap_id: swapId, party_id: party.id } })
  // Its own key: `(dedupe_key, channel)` is one namespace for crew AND Allie, so
  // sharing the member's key made this alert a "duplicate" that never went
  // (found in the production probe, 2026-10-27; crewNotifySurface N6b).
  await notifyAdmin(ctx, 'droppedUncovered', adminTemplates.droppedUncovered(member.first_name, ref, adminUrl(party.id)),
    `drop_alert:${swapId}`, { test: isTestParty(party), payload: { swap_id: swapId, party_id: party.id } })
  return { kind: 'ok' }
}

/** Both sides of a successful claim are told, and Allie. */
async function afterClaim(ctx: NotifyCtx, s: CrewSettings, cover: CoverContext, claimerId: string): Promise<void> {
  const party = cover.pws.party
  const [req, claimer] = await Promise.all([getMember(ctx.sb, cover.swap.requester_id), getMember(ctx.sb, claimerId)])
  const ref = partyRefFor(party, s)
  const payload = { swap_id: cover.swap.id, party_id: party.id }
  if (req.kind === 'ok' && req.data) {
    await notifyMember(ctx, req.data, 'coveredRequester', templates.coveredRequester(ref), `covered:${cover.swap.id}`, { payload })
  }
  if (claimer.kind === 'ok' && claimer.data) {
    const pay = formatCents(partyPayCents(cover.swap.slot_role, claimer.data.steps, party.extra_flat_cents, s))
    await notifyMember(ctx, claimer.data, 'coverClaimed', templates.coverClaimed(ref, pay), `cover_claimed:${cover.swap.id}`, { payload })
  }
  const reqFirst = req.kind === 'ok' && req.data ? req.data.first_name : 'A crew member'
  const coverFirst = claimer.kind === 'ok' && claimer.data ? claimer.data.first_name : 'Someone'
  await notifyAdmin(ctx, 'coverTaken', adminTemplates.coverTaken(reqFirst, coverFirst, ref, adminUrl(party.id)),
    `cover_taken:${cover.swap.id}`, { test: isTestParty(party), payload })
}

const CONFLICT_TEXT: Record<Conflict, string> = {
  on_party: "You're already on this party.",
  overlap: "You're working another party at that time.",
  blocked: "You've marked yourself unavailable then. Change it in Availability first.",
  not_lead: 'That spot is for a Party Lead.',
  inactive: 'Your account is paused. Talk to Allie.',
}

const TAKEN = 'Someone just took it.'

/** A crew member takes a cover. Eligibility is re-checked here; the race is settled by `crew_claim_swap`. */
export async function claimCover(ctx: NotifyCtx, s: CrewSettings, member: CrewMemberRow, swapId: string): Promise<SwapActionOutcome> {
  const cover = await loadCover(ctx.sb, swapId)
  if (cover.kind !== 'ok') return { kind: 'unavailable' }
  if (!cover.data) return { kind: 'refused', status: 404, error: TAKEN }
  const { swap, pws } = cover.data
  if (swap.requester_id === member.id) return { kind: 'refused', status: 409, error: "That's your own request." }
  if (!(LIVE_SWAP_STATUSES as readonly string[]).includes(swap.status)) return { kind: 'refused', status: 409, error: TAKEN }

  const fit = await eligibleFor(ctx.sb, s, pws, swap.slot_role, new Set([member.id]), [swap.requester_id])
  if (fit.kind !== 'ok') return { kind: 'unavailable' }
  if (fit.data.length === 0) {
    const why = whyNot(cover.data, member, s)
    return { kind: 'refused', status: 409, error: why }
  }

  const res = await claimSwap(ctx.sb, swapId, member.id)
  if (res.kind !== 'ok') { console.error(`crew/cover: claim failed for ${swapId}: ${res.error}`); return { kind: 'unavailable' } }
  const r: ClaimSwapResult = res.result
  if (r === 'claimed') { await afterClaim(ctx, s, cover.data, member.id); return { kind: 'ok' } }
  if (r === 'not_standby' || r === 'unavailable') return { kind: 'refused', status: 409, error: TAKEN }
  if (r === 'party_closed') return { kind: 'refused', status: 409, error: 'This party is no longer open.' }
  if (r === 'not_lead') return { kind: 'refused', status: 409, error: CONFLICT_TEXT.not_lead }
  if (r === 'already_on_party') return { kind: 'refused', status: 409, error: CONFLICT_TEXT.on_party }
  if (r === 'own_request') return { kind: 'refused', status: 409, error: "That's your own request." }
  return { kind: 'refused', status: 409, error: CONFLICT_TEXT.inactive }
}

/** The first plain-words reason this member cannot take this cover. */
function whyNot(cover: CoverContext, member: CrewMemberRow, s: CrewSettings): string {
  const party = cover.pws.party
  if (member.is_test && party.booking_id) return TAKEN
  const fit = memberFit(member, { id: party.id, startsAt: new Date(party.starts_at), endsAt: new Date(party.ends_at) },
    cover.pws.slots.filter(sl => sl.status !== 'cancelled'), [], { blocks: new Map(), recurring: new Map() }, s, cover.swap.slot_role)
  const first = fit.conflicts[0]
  // Overlap and availability need the reads eligibleFor made; when this quick
  // check finds nothing, those are what refused.
  return first ? CONFLICT_TEXT[first] : "You're working another party then, or you've marked yourself unavailable."
}

// ── Allie's side ────────────────────────────────────────────────────────────

/** "Offer to everyone free that day": set `offered_to_all_at`, then ask every eligible member. */
export async function offerToEveryone(
  ctx: NotifyCtx, s: CrewSettings, swapId: string, actor: string,
): Promise<{ kind: 'ok'; asked: number } | { kind: 'refused'; status: number; error: string } | { kind: 'unavailable' }> {
  const { data, error } = await ctx.sb.from('crew_swap_requests')
    .update({ offered_to_all_at: ctx.now.toISOString() })
    .eq('id', swapId).is('offered_to_all_at', null).in('status', [...LIVE_SWAP_STATUSES])
    .select('id')
  if (error) return { kind: 'unavailable' }
  if ((data ?? []).length === 0) return { kind: 'refused', status: 409, error: 'Already offered to everyone, or the request is closed.' }
  const cover = await loadCover(ctx.sb, swapId)
  if (cover.kind !== 'ok' || !cover.data) return { kind: 'unavailable' }
  const { swap, pws } = cover.data
  if (new Date(pws.party.starts_at).getTime() <= ctx.now.getTime()) return { kind: 'refused', status: 409, error: 'The party already started.' }
  const req = await getMember(ctx.sb, swap.requester_id)
  const reqFirst = req.kind === 'ok' && req.data ? req.data.first_name : 'A crew member'
  const eligible = await eligibleFor(ctx.sb, s, pws, swap.slot_role, 'all', [swap.requester_id])
  if (eligible.kind !== 'ok') return { kind: 'unavailable' }
  const ref = partyRefFor(pws.party, s, coverPath(swap.id))
  let asked = 0
  for (const m of eligible.data) {
    const pay = formatCents(partyPayCents(swap.slot_role, m.steps, pws.party.extra_flat_cents, s))
    const r = await notifyMember(ctx, m, 'coverOpen', templates.coverOpen(reqFirst, ref, swap.slot_role, pay), `cover_all:${swap.id}:${m.id}`,
      { payload: { swap_id: swap.id, party_id: pws.party.id } })
    if (r.kind === 'done') asked++
  }
  // Who widened it, on the record (the swap row has no actor column).
  const note = await insertNotification(ctx.sb, {
    member_id: null, channel: 'in_app', template: 'coverOfferedToAll', dedupe_key: `cover_all:${swap.id}`, status: 'sent',
    scheduled_for: ctx.now.toISOString(), payload: { swap_id: swap.id, party_id: pws.party.id, actor, asked },
  })
  if (note.kind === 'failed') console.error(`crew/cover: offer-to-all note not written for ${swap.id}: ${note.error}`)
  return { kind: 'ok', asked }
}

/** Allie puts somebody on a late cancel (herself included): `crew_claim_swap` as admin. */
export async function assignCover(
  ctx: NotifyCtx, s: CrewSettings, swapId: string, memberId: string, actor: string,
): Promise<SwapActionOutcome> {
  const cover = await loadCover(ctx.sb, swapId)
  if (cover.kind !== 'ok') return { kind: 'unavailable' }
  if (!cover.data) return { kind: 'refused', status: 404, error: 'No such cover request.' }
  const res = await claimSwap(ctx.sb, swapId, memberId, { byAdmin: true, actor })
  if (res.kind !== 'ok') return { kind: 'unavailable' }
  if (res.result === 'claimed') { await afterClaim(ctx, s, cover.data, memberId); return { kind: 'ok' } }
  const words: Record<string, string> = {
    unavailable: 'That request already closed.', own_request: "That's the person cancelling.", party_closed: 'The party already started.',
    not_lead: 'That spot needs someone who can lead.', already_on_party: "They're already on this party.", inactive: "They're not active.",
  }
  return { kind: 'refused', status: 409, error: words[res.result] ?? 'That did not work.' }
}

/** The live cover request, or the latest one, that a member raised on a party. */
export async function myCoverOnParty(sb: Supa, memberId: string, slotIds: string[]): Promise<Read<CrewSwapRow | null>> {
  if (slotIds.length === 0) return { kind: 'ok', data: null }
  const { data, error } = await sb.from('crew_swap_requests').select('*').eq('requester_id', memberId).in('slot_id', slotIds)
    .order('created_at', { ascending: false }).limit(1)
  if (error) return { kind: 'unavailable', error: error.message }
  return { kind: 'ok', data: ((data ?? []) as CrewSwapRow[])[0] ?? null }
}
