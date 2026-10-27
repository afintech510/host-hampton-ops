/**
 * Crew data access. Server code only, on the service-role client
 * (`getSupabase()`); the crew tables have RLS on and no policies (migration 077).
 *
 * Two rules every function here keeps:
 *
 *   1. A read has three outcomes. `{ kind: 'unavailable' }` is never folded
 *      into "nothing there" — an empty roster and an unreadable roster are
 *      different facts, and a cron that cannot tell them apart texts nobody or
 *      everybody.
 *
 *   2. Anything that moves `steps` is computed by `rules.ts` and applied by a
 *      SQL function as a compare-and-swap: we pass the steps we READ and the
 *      steps we COMPUTED. 'stale' means somebody else moved them in between;
 *      we re-read and try exactly once more, then report it. No step change is
 *      ever a read-then-write in this file.
 */

import type { getSupabase } from '@/lib/supabase'
import { normalizePhoneKey } from '@/lib/contactLookup'
import {
  classifyDrop, isInGracePeriod, stepAfter, type CrewSettings, type DayPart, type SlotRole,
} from '@/lib/crew/rules'

type Supa = ReturnType<typeof getSupabase>

export type Read<T> = { kind: 'ok'; data: T } | { kind: 'unavailable'; error: string }

// ── Row shapes (migration 077) ──────────────────────────────────────────────

export type MemberStatus = 'active' | 'paused' | 'removed'
export type SlotStatus = 'open' | 'assigned' | 'completed' | 'no_show' | 'cancelled'
export type PartyStatus = 'draft' | 'published' | 'completed' | 'cancelled'
export type SwapStatus = 'open' | 'claimed' | 'cancelled' | 'dropped_uncovered' | 'escalated' | 'expired'
export type PartyKind = 'in_studio_theme' | 'mobile_party' | 'studio_rental' | 'manual'
export type PaidMethod = 'venmo' | 'zelle' | 'cash' | 'check' | 'other'

export interface CrewMemberRow {
  id: string
  first_name: string
  last_name: string | null
  email: string | null
  phone: string | null
  steps: number
  can_lead: boolean
  is_owner: boolean
  /** Migration 079: an invented member for testing. The only kind the password-free test picker may act as. */
  is_test: boolean
  skills: string[]
  status: MemberStatus
  needs_review: boolean
  sms_opt_in: boolean
  sms_opt_in_at: string | null
  email_opt_in: boolean
  admin_notes: string | null
  job_application_id: string | null
  joined_on: string
  created_at: string
  updated_at: string
}

export interface CrewPartyRow {
  id: string
  booking_id: string | null
  party_kind: PartyKind
  title: string
  theme: string | null
  starts_at: string
  ends_at: string
  guest_count: number | null
  location: string
  notes_for_crew: string | null
  slots_override: number | null
  extra_flat_cents: number
  status: PartyStatus
  published_at: string | null
  attendance_marked_at: string | null
  cancelled_at: string | null
  sync_flags: string[]
  created_at: string
  updated_at: string
}

export interface CrewSlotRow {
  id: string
  party_id: string
  role: SlotRole
  status: SlotStatus
  member_id: string | null
  assigned_at: string | null
  assigned_via: 'claim' | 'admin' | 'cover' | null
  assigned_by: string | null
  confirmed_at: string | null
  covered_swap_id: string | null
  pay_cents: number | null
  step_at_pay: number | null
  extra_cents: number | null
  tip_cents: number | null
  tip_topup_cents: number | null
  paid_method: PaidMethod | null
  paid_note: string | null
  paid_at: string | null
  shift_started_at: string | null
  shift_ended_at: string | null
  hours_worked: number | null
  created_at: string
  updated_at: string
}

export interface CrewSwapRow {
  id: string
  slot_id: string
  requester_id: string
  slot_role: SlotRole
  reason: 'sick' | 'family' | 'school' | 'other'
  reason_note: string | null
  status: SwapStatus
  notice_hours: number
  standbys_notified_at: string | null
  escalated_at: string | null
  offered_to_all_at: string | null
  warned_at: string | null
  claimed_by: string | null
  claimed_at: string | null
  resolved_at: string | null
  created_at: string
}

export interface CrewStandbyRow { id: string; party_id: string; member_id: string; created_at: string; withdrawn_at: string | null }

export interface CrewEventRow {
  id: string
  member_id: string
  type: 'worked' | 'no_show' | 'early_release' | 'late_cancel_covered' | 'late_cancel_uncovered' | 'cover_claimed' | 'admin_adjustment'
  step_before: number
  step_delta: number
  step_after: number
  waived_grace: boolean
  party_id: string | null
  slot_id: string | null
  swap_id: string | null
  attendance_seq: number | null
  voids_event_id: string | null
  metadata: Record<string, unknown>
  created_by: string
  occurred_at: string
}

export interface PartyWithSlots { party: CrewPartyRow; slots: CrewSlotRow[] }

const MEMBER_COLUMNS =
  'id, first_name, last_name, email, phone, steps, can_lead, is_owner, is_test, skills, status, needs_review, sms_opt_in, sms_opt_in_at, email_opt_in, admin_notes, job_application_id, joined_on, created_at, updated_at'

// ── Reads ───────────────────────────────────────────────────────────────────

export async function getMember(sb: Supa, id: string): Promise<Read<CrewMemberRow | null>> {
  const { data, error } = await sb.from('crew_members').select(MEMBER_COLUMNS).eq('id', id).maybeSingle()
  if (error) return { kind: 'unavailable', error: error.message }
  return { kind: 'ok', data: (data as unknown as CrewMemberRow) ?? null }
}

export async function listMembers(sb: Supa, opts: { includeRemoved?: boolean } = {}): Promise<Read<CrewMemberRow[]>> {
  let q = sb.from('crew_members').select(MEMBER_COLUMNS).order('first_name', { ascending: true })
  if (!opts.includeRemoved) q = q.neq('status', 'removed')
  const { data, error } = await q
  if (error) return { kind: 'unavailable', error: error.message }
  return { kind: 'ok', data: (data ?? []) as unknown as CrewMemberRow[] }
}

export async function getPartyWithSlots(sb: Supa, partyId: string): Promise<Read<PartyWithSlots | null>> {
  const { data: party, error } = await sb.from('crew_parties').select('*').eq('id', partyId).maybeSingle()
  if (error) return { kind: 'unavailable', error: error.message }
  if (!party) return { kind: 'ok', data: null }
  const { data: slots, error: sErr } = await sb.from('crew_slots').select('*').eq('party_id', partyId)
    .order('role', { ascending: true }).order('created_at', { ascending: true })
  if (sErr) return { kind: 'unavailable', error: sErr.message }
  return { kind: 'ok', data: { party: party as CrewPartyRow, slots: (slots ?? []) as CrewSlotRow[] } }
}

/** Parties starting in [fromIso, toIso), with their slots. One read per table, never one per party. */
export async function listPartiesInRange(
  sb: Supa, fromIso: string, toIso: string, opts: { statuses?: PartyStatus[] } = {},
): Promise<Read<PartyWithSlots[]>> {
  let q = sb.from('crew_parties').select('*').gte('starts_at', fromIso).lt('starts_at', toIso)
    .order('starts_at', { ascending: true })
  if (opts.statuses?.length) q = q.in('status', opts.statuses)
  const { data: parties, error } = await q
  if (error) return { kind: 'unavailable', error: error.message }
  const rows = (parties ?? []) as CrewPartyRow[]
  if (rows.length === 0) return { kind: 'ok', data: [] }
  const slots = await slotsForParties(sb, rows.map(p => p.id))
  if (slots.kind !== 'ok') return slots
  return { kind: 'ok', data: rows.map(party => ({ party, slots: slots.data.filter(s => s.party_id === party.id) })) }
}

/**
 * Slots for many parties. Chunked: PostgREST refuses an `.in()` past a few
 * hundred uuids, and one failed chunk fails the whole read — a partial list of
 * slots would show a staffed party as open.
 */
export async function slotsForParties(sb: Supa, partyIds: string[]): Promise<Read<CrewSlotRow[]>> {
  const out: CrewSlotRow[] = []
  for (let i = 0; i < partyIds.length; i += 150) {
    const { data, error } = await sb.from('crew_slots').select('*').in('party_id', partyIds.slice(i, i + 150))
    if (error) return { kind: 'unavailable', error: error.message }
    out.push(...((data ?? []) as CrewSlotRow[]))
  }
  return { kind: 'ok', data: out }
}

export async function getMemberSlots(sb: Supa, memberId: string, opts: { statuses?: SlotStatus[] } = {}): Promise<Read<CrewSlotRow[]>> {
  let q = sb.from('crew_slots').select('*').eq('member_id', memberId)
  if (opts.statuses?.length) q = q.in('status', opts.statuses)
  const { data, error } = await q
  if (error) return { kind: 'unavailable', error: error.message }
  return { kind: 'ok', data: (data ?? []) as CrewSlotRow[] }
}

export async function getMemberEvents(sb: Supa, memberId: string, sinceIso?: string): Promise<Read<CrewEventRow[]>> {
  let q = sb.from('crew_events').select('*').eq('member_id', memberId).order('occurred_at', { ascending: false })
  if (sinceIso) q = q.gte('occurred_at', sinceIso)
  const { data, error } = await q
  if (error) return { kind: 'unavailable', error: error.message }
  return { kind: 'ok', data: (data ?? []) as CrewEventRow[] }
}

export async function getAvailability(
  sb: Supa, memberId: string, fromDay: string, toDay: string,
): Promise<Read<{ blocks: { day: string; part: DayPart }[]; recurring: { dow: number; part: DayPart; active: boolean }[] }>> {
  const [b, r] = await Promise.all([
    sb.from('crew_unavailability').select('day, part').eq('member_id', memberId).gte('day', fromDay).lte('day', toDay),
    sb.from('crew_recurring_blocks').select('dow, part, active').eq('member_id', memberId),
  ])
  if (b.error) return { kind: 'unavailable', error: b.error.message }
  if (r.error) return { kind: 'unavailable', error: r.error.message }
  return {
    kind: 'ok',
    data: {
      blocks: (b.data ?? []) as { day: string; part: DayPart }[],
      recurring: (r.data ?? []) as { dow: number; part: DayPart; active: boolean }[],
    },
  }
}

/** One slot by id. */
export async function getSlot(sb: Supa, slotId: string): Promise<Read<CrewSlotRow | null>> {
  const { data, error } = await sb.from('crew_slots').select('*').eq('id', slotId).maybeSingle()
  if (error) return { kind: 'unavailable', error: error.message }
  return { kind: 'ok', data: (data as CrewSlotRow) ?? null }
}

/** Parties by id. Chunked, and one failed chunk fails the read. */
export async function partiesByIds(sb: Supa, ids: string[]): Promise<Read<CrewPartyRow[]>> {
  const out: CrewPartyRow[] = []
  const unique = Array.from(new Set(ids))
  for (let i = 0; i < unique.length; i += 150) {
    const { data, error } = await sb.from('crew_parties').select('*').in('id', unique.slice(i, i + 150))
    if (error) return { kind: 'unavailable', error: error.message }
    out.push(...((data ?? []) as CrewPartyRow[]))
  }
  return { kind: 'ok', data: out }
}

/**
 * id → FIRST NAME, and nothing else, for teammates. The only read of another
 * member a crew page makes: it selects two columns so nothing more can leak
 * into a projection by accident.
 */
export async function firstNamesFor(sb: Supa, memberIds: string[]): Promise<Read<Map<string, string>>> {
  const map = new Map<string, string>()
  const unique = Array.from(new Set(memberIds))
  for (let i = 0; i < unique.length; i += 150) {
    const { data, error } = await sb.from('crew_members').select('id, first_name').in('id', unique.slice(i, i + 150))
    if (error) return { kind: 'unavailable', error: error.message }
    for (const r of (data ?? []) as { id: string; first_name: string }[]) map.set(r.id, r.first_name)
  }
  return { kind: 'ok', data: map }
}

/** The party ids this member is a live standby on. */
export async function memberStandbyPartyIds(sb: Supa, memberId: string): Promise<Read<Set<string>>> {
  const { data, error } = await sb.from('crew_standbys').select('party_id').eq('member_id', memberId).is('withdrawn_at', null)
  if (error) return { kind: 'unavailable', error: error.message }
  return { kind: 'ok', data: new Set(((data ?? []) as { party_id: string }[]).map(r => r.party_id)) }
}

/** Is there a live (open or escalated) cover request on this slot? */
export async function hasActiveSwap(sb: Supa, slotId: string): Promise<Read<boolean>> {
  const { data, error } = await sb.from('crew_swap_requests').select('id').eq('slot_id', slotId).in('status', ['open', 'escalated']).limit(1)
  if (error) return { kind: 'unavailable', error: error.message }
  return { kind: 'ok', data: (data ?? []).length > 0 }
}

/**
 * The test picker's list: active, `is_test`, never the owner. Columns are named,
 * and the email and phone are not among them.
 */
export async function listTestMembers(sb: Supa): Promise<Read<Pick<CrewMemberRow, 'id' | 'first_name' | 'last_name' | 'steps' | 'can_lead'>[]>> {
  const { data, error } = await sb.from('crew_members').select('id, first_name, last_name, steps, can_lead')
    .eq('is_test', true).eq('status', 'active').eq('is_owner', false).order('first_name', { ascending: true })
  if (error) return { kind: 'unavailable', error: error.message }
  return { kind: 'ok', data: (data ?? []) as Pick<CrewMemberRow, 'id' | 'first_name' | 'last_name' | 'steps' | 'can_lead'>[] }
}

export async function listLiveStandbys(sb: Supa, partyId: string): Promise<Read<CrewStandbyRow[]>> {
  const { data, error } = await sb.from('crew_standbys').select('*').eq('party_id', partyId).is('withdrawn_at', null)
  if (error) return { kind: 'unavailable', error: error.message }
  return { kind: 'ok', data: (data ?? []) as CrewStandbyRow[] }
}

/**
 * The crew members a texting number belongs to: never the owner, never a removed
 * member. Matched by `normalizePhoneKey` in JS, never by a raw `phone` filter —
 * the roster stores `+1` + the key, but a phone typed some other way must still
 * match, and AGENTS.md §11 bans comparing a phone number raw. The roster is a
 * dozen rows, so reading every phone is cheap and exact.
 */
export async function crewMembersByPhone(sb: Supa, phone: string): Promise<Read<CrewMemberRow[]>> {
  const key = normalizePhoneKey(phone)
  if (!key) return { kind: 'ok', data: [] }
  const { data, error } = await sb.from('crew_members').select(MEMBER_COLUMNS)
    .not('phone', 'is', null).eq('is_owner', false).neq('status', 'removed')
  if (error) return { kind: 'unavailable', error: error.message }
  const rows = (data ?? []) as unknown as CrewMemberRow[]
  return {
    kind: 'ok',
    data: rows.filter(m => normalizePhoneKey(m.phone) === key).sort((a, b) => a.created_at.localeCompare(b.created_at)),
  }
}

// ── Notifications ───────────────────────────────────────────────────────────

export interface NotificationInsert {
  member_id: string | null
  channel: 'in_app' | 'email' | 'sms'
  template: string
  dedupe_key: string
  payload?: Record<string, unknown>
  /** 'sending' (migration 081) is a claim: the INSERT itself took the row, and the send follows. */
  status?: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped'
  scheduled_for?: string
  error?: string | null
}

export type NotificationInsertResult =
  | { kind: 'inserted'; id: string }
  /** `(dedupe_key, channel)` already exists: this exact message was already handled. Not an error. */
  | { kind: 'duplicate' }
  | { kind: 'failed'; error: string }

export async function insertNotification(sb: Supa, row: NotificationInsert): Promise<NotificationInsertResult> {
  const { data, error } = await sb.from('crew_notifications').insert(row).select('id').maybeSingle()
  if (error) {
    if ((error as { code?: string }).code === '23505') return { kind: 'duplicate' }
    return { kind: 'failed', error: error.message }
  }
  if (!data) return { kind: 'failed', error: 'insert returned no row' }
  return { kind: 'inserted', id: (data as { id: string }).id }
}

// ── SQL functions ───────────────────────────────────────────────────────────

export type RpcResult<R extends string> = { kind: 'ok'; result: R } | { kind: 'error'; error: string }

async function rpcText<R extends string>(sb: Supa, fn: string, args: Record<string, unknown>): Promise<RpcResult<R>> {
  const { data, error } = await sb.rpc(fn, args)
  if (error) return { kind: 'error', error: error.message }
  if (typeof data !== 'string') return { kind: 'error', error: `${fn} returned ${JSON.stringify(data)}` }
  return { kind: 'ok', result: data as R }
}

export type ClaimSlotResult = 'assigned' | 'unavailable' | 'party_closed' | 'not_lead' | 'already_on_party' | 'inactive'

/** First claim wins (FOR UPDATE in SQL). Eligibility the DB cannot see — availability, overlap — is the caller's, BEFORE this. */
export function claimSlot(sb: Supa, slotId: string, memberId: string) {
  return rpcText<ClaimSlotResult>(sb, 'crew_claim_slot', { p_slot_id: slotId, p_member_id: memberId })
}

/** Allie assigns, including herself as Lead. The Lead rule still holds in SQL. */
export function adminAssign(sb: Supa, slotId: string, memberId: string, actor: string) {
  return rpcText<ClaimSlotResult>(sb, 'crew_admin_assign', { p_slot_id: slotId, p_member_id: memberId, p_actor: actor })
}

export type ClaimSwapResult =
  | 'claimed' | 'unavailable' | 'own_request' | 'party_closed' | 'not_lead' | 'not_standby' | 'already_on_party' | 'inactive'

export function claimSwap(sb: Supa, swapId: string, memberId: string, opts: { byAdmin?: boolean; actor?: string } = {}) {
  return rpcText<ClaimSwapResult>(sb, 'crew_claim_swap', {
    p_swap_id: swapId, p_member_id: memberId, p_by_admin: !!opts.byAdmin, p_actor: opts.actor ?? null,
  })
}

/** Read a member's steps for a compare-and-swap. */
async function readSteps(sb: Supa, memberId: string): Promise<Read<{ steps: number; isOwner: boolean }>> {
  const { data, error } = await sb.from('crew_members').select('steps, is_owner').eq('id', memberId).maybeSingle()
  if (error) return { kind: 'unavailable', error: error.message }
  if (!data) return { kind: 'unavailable', error: 'member not found' }
  const row = data as { steps: number; is_owner: boolean }
  return { kind: 'ok', data: { steps: row.steps, isOwner: row.is_owner } }
}

/**
 * Run a compare-and-swap step function, re-reading and retrying ONCE on
 * 'stale'. `attempt` receives the steps just read.
 */
async function withStepCas<R extends string>(
  sb: Supa, memberId: string, attempt: (steps: number) => Promise<RpcResult<R | 'stale'>>,
): Promise<RpcResult<R | 'stale'>> {
  let last: RpcResult<R | 'stale'> = { kind: 'error', error: 'not attempted' }
  for (let i = 0; i < 2; i++) {
    const read = await readSteps(sb, memberId)
    if (read.kind !== 'ok') return { kind: 'error', error: read.error }
    last = await attempt(read.data.steps)
    if (!(last.kind === 'ok' && last.result === 'stale')) return last
  }
  return last
}

export type ReleaseResult =
  | 'released' | 'requested' | 'already_requested' | 'not_yours' | 'started' | 'stale' | 'invalid'

export interface ReleaseInput {
  slotId: string
  memberId: string
  partyStartsAt: Date
  reason: 'sick' | 'family' | 'school' | 'other'
  note?: string | null
  now: Date
  settings: CrewSettings
}

/**
 * "Can't make it". 7+ days out: an early release, the spot reopens and the
 * step change applies (waived in grace). Under 7: a cover request opens and
 * the member stays on. `classifyDrop` decides which; SQL re-checks the start.
 */
export async function releaseSlot(sb: Supa, input: ReleaseInput): Promise<RpcResult<ReleaseResult>> {
  const { kind, noticeHours } = classifyDrop(input.partyStartsAt, input.now, input.settings)
  if (kind === 'started') return { kind: 'ok', result: 'started' }
  const inGrace = isInGracePeriod(input.now, input.settings)
  return withStepCas<ReleaseResult>(sb, input.memberId, steps => {
    const o = kind === 'early_release'
      ? stepAfter('early_release', steps, input.settings, inGrace)
      : { stepsBefore: steps, stepsAfter: steps, waivedGrace: false, wouldBe: steps, delta: 0 }
    return rpcText<ReleaseResult>(sb, 'crew_release_slot', {
      p_slot_id: input.slotId, p_member_id: input.memberId, p_kind: kind, p_reason: input.reason,
      p_note: input.note ?? null, p_notice_hours: Math.round(noticeHours * 100) / 100,
      p_expected_steps: o.stepsBefore, p_steps_after: o.stepsAfter, p_waived_grace: o.waivedGrace,
      p_meta: { would_be_steps: o.wouldBe },
    })
  })
}

export type DropResult = 'dropped' | 'unavailable' | 'stale'

/** "Drop anyway": reset to 0 (recorded, not applied, in grace). */
export async function dropUncovered(
  sb: Supa, input: { swapId: string; memberId: string; now: Date; settings: CrewSettings },
): Promise<RpcResult<DropResult>> {
  const inGrace = isInGracePeriod(input.now, input.settings)
  return withStepCas<DropResult>(sb, input.memberId, steps => {
    const o = stepAfter('late_cancel_uncovered', steps, input.settings, inGrace)
    return rpcText<DropResult>(sb, 'crew_drop_uncovered', {
      p_swap_id: input.swapId, p_member_id: input.memberId, p_expected_steps: o.stepsBefore,
      p_steps_after: o.stepsAfter, p_waived_grace: o.waivedGrace, p_meta: { would_be_steps: o.wouldBe },
    })
  })
}

export type SetStepsResult = 'set' | 'stale' | 'owner' | 'invalid'

/** Allie sets a step, with a reason. Retries a stale read once; the target is absolute, so a retry is safe. */
export async function adminSetSteps(
  sb: Supa, input: { memberId: string; steps: number; reason: string; actor: string },
): Promise<RpcResult<SetStepsResult>> {
  return withStepCas<SetStepsResult>(sb, input.memberId, steps => rpcText<SetStepsResult>(sb, 'crew_admin_set_steps', {
    p_member_id: input.memberId, p_expected_steps: steps, p_steps_after: input.steps,
    p_reason: input.reason, p_actor: input.actor,
  }))
}

/** One element of `crew_mark_attendance`'s outcomes array. Built from rules.ts in Phase 5. */
export interface AttendanceOutcome {
  slot_id: string
  outcome: 'worked' | 'no_show'
  expected_steps: number
  base_steps: number
  steps_after: number
  waived_grace: boolean
  pay_cents?: number | null
  step_at_pay?: number | null
  extra_cents?: number | null
  tip_cents?: number | null
  tip_topup_cents?: number | null
  paid_method?: PaidMethod | null
  paid_note?: string | null
  paid_at?: string | null
  shift_started_at?: string | null
  shift_ended_at?: string | null
  hours_worked?: number | null
  meta?: Record<string, unknown>
}

export type MarkAttendanceResult =
  | { kind: 'ok'; marked: number; voided: number }
  /** A member's steps moved between our read and the write; nothing was written. Re-read and rebuild. */
  | { kind: 'stale' }
  | { kind: 'error'; error: string }

export async function markAttendance(
  sb: Supa, partyId: string, outcomes: AttendanceOutcome[], actor: string,
): Promise<MarkAttendanceResult> {
  const { data, error } = await sb.rpc('crew_mark_attendance', { p_party_id: partyId, p_outcomes: outcomes, p_actor: actor })
  if (error) {
    if (/crew_stale/.test(error.message)) return { kind: 'stale' }
    return { kind: 'error', error: error.message }
  }
  const d = data as { marked?: number; voided?: number } | null
  return { kind: 'ok', marked: Number(d?.marked ?? 0), voided: Number(d?.voided ?? 0) }
}
