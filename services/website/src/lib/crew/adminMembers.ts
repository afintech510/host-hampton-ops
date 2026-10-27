/**
 * The roster, from Allie's side (prompt 04 §4). Server code only; every caller
 * has passed `isAdminAuthorized` and passes `adminActorId(req)` as `actor`.
 *
 * Adam enters the real roster through this form. No roster file exists, and
 * none ever should: this repository is public.
 *
 * Steps move in exactly two ways here, and both go through
 * `crew_admin_set_steps` (a compare-and-swap that writes the ledger row):
 * a new member's STARTING step, recorded with the reason "Starting step", and
 * the override, whose reason is required. The insert itself always writes 0.
 *
 * The owner row (Allie) cannot be removed, paused, paid, given steps, or given
 * an email or phone — she is never notified. `screenMemberInput` refuses those
 * fields for her and `crew_admin_set_steps` answers 'owner'.
 */

import type { getSupabase } from '@/lib/supabase'
import { adminSetSteps, getMember, insertNotification, listMembers, type CrewMemberRow, type Read } from '@/lib/crew/db'
import { ratesFor, type CrewSettings } from '@/lib/crew/rules'
import { screenMemberInput } from '@/lib/crew/adminForms'
import { templates } from '@/lib/crew/templates'
import { sendCrewEmail } from '@/lib/crew/mail'
import { crewEnabled } from '@/lib/crew/settings'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { etDateString } from '@/lib/partyTime'
import type { ActionResult } from '@/lib/crew/adminActions'

type Supa = ReturnType<typeof getSupabase>

const refuse = (status: number, error: string): ActionResult<never> => ({ ok: false, status, error })

export interface RosterRow {
  id: string
  firstName: string
  lastName: string | null
  email: string | null
  phone: string | null
  steps: number
  crewRateCents: number
  leadRateCents: number
  canLead: boolean
  isOwner: boolean
  isTest: boolean
  skills: string[]
  status: CrewMemberRow['status']
  needsReview: boolean
  emailOptIn: boolean
  smsOptIn: boolean
  adminNotes: string | null
  jobApplicationId: string | null
  joinedOn: string
  partiesWorked: number
  noShows: number
  lateCancelsUncovered: number
  upcomingSpots: number
}

export interface HiredApplication { id: string; ref: string; name: string; email: string; phone: string; roleInterest: string }

export interface Roster { members: RosterRow[]; hired: HiredApplication[] }

export async function loadRoster(sb: Supa, s: CrewSettings, now: Date): Promise<Read<Roster>> {
  const members = await listMembers(sb, { includeRemoved: true })
  if (members.kind !== 'ok') return members
  const [slots, events, apps] = await Promise.all([
    sb.from('crew_slots').select('member_id, status, party_id').not('member_id', 'is', null).in('status', ['assigned', 'completed', 'no_show']),
    sb.from('crew_events').select('member_id').eq('type', 'late_cancel_uncovered').eq('waived_grace', false),
    sb.from('job_applications').select('id, application_ref, name, email, phone, role_interest').eq('status', 'hired'),
  ])
  if (slots.error) return { kind: 'unavailable', error: slots.error.message }
  if (events.error) return { kind: 'unavailable', error: events.error.message }
  if (apps.error) return { kind: 'unavailable', error: apps.error.message }

  const slotRows = (slots.data ?? []) as { member_id: string; status: string; party_id: string }[]
  const assignedPartyIds = Array.from(new Set(slotRows.filter(r => r.status === 'assigned').map(r => r.party_id)))
  const upcomingParty = new Set<string>()
  for (let i = 0; i < assignedPartyIds.length; i += 150) {
    const { data, error } = await sb.from('crew_parties').select('id').in('id', assignedPartyIds.slice(i, i + 150))
      .gt('starts_at', now.toISOString()).in('status', ['draft', 'published'])
    if (error) return { kind: 'unavailable', error: error.message }
    for (const r of (data ?? []) as { id: string }[]) upcomingParty.add(r.id)
  }

  const count = (pred: (r: { member_id: string; status: string; party_id: string }) => boolean) => {
    const m = new Map<string, number>()
    for (const r of slotRows) if (pred(r)) m.set(r.member_id, (m.get(r.member_id) ?? 0) + 1)
    return m
  }
  const worked = count(r => r.status === 'completed')
  const noShows = count(r => r.status === 'no_show')
  const upcoming = count(r => r.status === 'assigned' && upcomingParty.has(r.party_id))
  const uncovered = new Map<string, number>()
  for (const e of (events.data ?? []) as { member_id: string }[]) uncovered.set(e.member_id, (uncovered.get(e.member_id) ?? 0) + 1)

  const linked = new Set(members.data.map(m => m.job_application_id).filter(Boolean))
  return {
    kind: 'ok',
    data: {
      members: members.data.map(m => {
        const r = ratesFor(m.steps, s)
        return {
          id: m.id, firstName: m.first_name, lastName: m.last_name, email: m.email, phone: m.phone, steps: m.steps,
          crewRateCents: m.is_owner ? 0 : r.crewCents, leadRateCents: m.is_owner ? 0 : r.leadCents,
          canLead: m.can_lead, isOwner: m.is_owner, isTest: m.is_test, skills: m.skills ?? [], status: m.status,
          needsReview: m.needs_review, emailOptIn: m.email_opt_in, smsOptIn: m.sms_opt_in, adminNotes: m.admin_notes,
          jobApplicationId: m.job_application_id, joinedOn: m.joined_on,
          partiesWorked: worked.get(m.id) ?? 0, noShows: noShows.get(m.id) ?? 0,
          lateCancelsUncovered: uncovered.get(m.id) ?? 0, upcomingSpots: upcoming.get(m.id) ?? 0,
        }
      }).sort((a, b) => (a.isOwner === b.isOwner ? (a.status === b.status ? a.firstName.localeCompare(b.firstName) : a.status === 'active' ? -1 : 1) : a.isOwner ? -1 : 1)),
      hired: ((apps.data ?? []) as { id: string; application_ref: string; name: string; email: string; phone: string; role_interest: string }[])
        .filter(a => !linked.has(a.id))
        .map(a => ({ id: a.id, ref: a.application_ref, name: a.name, email: a.email, phone: a.phone, roleInterest: a.role_interest })),
    },
  }
}

function uniqueViolationText(message: string): string {
  if (/phone/i.test(message)) return 'Another crew member already has that phone number.'
  if (/email/i.test(message)) return 'Another crew member already has that email address.'
  return 'That would duplicate another crew member.'
}

export async function createMember(sb: Supa, body: Record<string, unknown>, actor: string, s: CrewSettings): Promise<ActionResult<{ id: string; warning?: string }>> {
  const screen = screenMemberInput(body, { kind: 'create' }, s.pay.maxSteps)
  if (!screen.ok) return refuse(400, screen.error)
  const row: Record<string, unknown> = { ...screen.row, steps: 0, is_owner: false, updated_by: actor }

  if (typeof row.job_application_id === 'string') {
    const { data: app, error } = await sb.from('job_applications').select('id, status').eq('id', row.job_application_id).maybeSingle()
    if (error) return refuse(503, `Could not read the application: ${error.message}`)
    if (!app) return refuse(404, 'Unknown application.')
    const { data: already, error: lErr } = await sb.from('crew_members').select('id').eq('job_application_id', row.job_application_id).limit(1)
    if (lErr) return refuse(503, lErr.message)
    if ((already ?? []).length > 0) return refuse(409, 'That applicant is already on the crew.')
  }

  const { data, error } = await sb.from('crew_members').insert(row).select('id').maybeSingle()
  if (error) {
    if ((error as { code?: string }).code === '23505') return refuse(409, uniqueViolationText(error.message))
    return refuse(500, error.message)
  }
  const id = (data as { id: string } | null)?.id
  if (!id) return refuse(500, 'The member was not created.')

  if (screen.startingSteps && screen.startingSteps > 0) {
    const r = await adminSetSteps(sb, { memberId: id, steps: screen.startingSteps, reason: 'Starting step', actor })
    if (r.kind !== 'ok' || r.result !== 'set') {
      return { ok: true, id, warning: `Added at the starting rate; setting the starting step failed (${r.kind === 'ok' ? r.result : r.error}). Use the step override.` }
    }
  }
  return { ok: true, id }
}

export async function updateMember(sb: Supa, id: string, body: Record<string, unknown>, actor: string, now: Date): Promise<ActionResult> {
  const read = await getMember(sb, id)
  if (read.kind !== 'ok') return refuse(503, `Could not read the member: ${read.error}`)
  if (!read.data) return refuse(404, 'Unknown crew member.')
  const m = read.data
  const screen = screenMemberInput(body, { kind: 'edit', isOwner: m.is_owner, hasPhone: !!m.phone })
  if (!screen.ok) return refuse(400, screen.error)

  // Pausing or removing someone who is on an upcoming party would strand that
  // spot: it would look staffed and nobody would come. Unassign first.
  if ((screen.row.status === 'paused' || screen.row.status === 'removed') && m.status === 'active') {
    const { data: held, error } = await sb.from('crew_slots').select('party_id').eq('member_id', id).eq('status', 'assigned')
    if (error) return refuse(503, error.message)
    const partyIds = ((held ?? []) as { party_id: string }[]).map(r => r.party_id)
    if (partyIds.length) {
      const { data: ps, error: pErr } = await sb.from('crew_parties').select('id, title, starts_at').in('id', partyIds)
        .gt('starts_at', now.toISOString()).in('status', ['draft', 'published'])
      if (pErr) return refuse(503, pErr.message)
      const list = (ps ?? []) as { title: string }[]
      if (list.length) return refuse(409, `${m.first_name} is on ${list.length} upcoming ${list.length === 1 ? 'party' : 'parties'} (${list.map(p => p.title).join(', ')}). Take them off first.`)
    }
  }

  const { data, error } = await sb.from('crew_members').update({ ...screen.row, updated_by: actor }).eq('id', id).select('id')
  if (error) {
    if ((error as { code?: string }).code === '23505') return refuse(409, uniqueViolationText(error.message))
    return refuse(500, error.message)
  }
  if ((data ?? []).length === 0) return refuse(404, 'Unknown crew member.')
  return { ok: true }
}

/** The override. A reason is required; the SQL function records it and the actor in `crew_events`. */
export async function overrideSteps(sb: Supa, id: string, body: Record<string, unknown>, actor: string, s: CrewSettings): Promise<ActionResult> {
  const steps = body.steps
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (typeof steps !== 'number' || !Number.isInteger(steps) || steps < 0 || steps > s.pay.maxSteps) {
    return refuse(400, `Steps: a whole number from 0 to ${s.pay.maxSteps}.`)
  }
  if (!reason) return refuse(400, 'A reason is required.')
  if (reason.length > 300) return refuse(400, 'Keep the reason under 300 characters.')
  const r = await adminSetSteps(sb, { memberId: id, steps, reason, actor })
  if (r.kind !== 'ok') return refuse(500, r.error)
  switch (r.result) {
    case 'set': return { ok: true }
    case 'owner': return refuse(400, "Allie's row is never given steps.")
    case 'stale': return refuse(409, 'Their steps changed just now. Reload and try again.')
    default: return refuse(400, 'Unknown member, or a step out of range.')
  }
}

/**
 * Email the member a link to the code login. Only once the crew app is
 * launched (CREW_ENABLED): before that, `/crew/login` admits test members only,
 * so an invite would send a real person to a door that refuses them. The send
 * is CLAIMED first (`invite:<member>:<ET date>`), so a double click mails once.
 */
export async function inviteMember(sb: Supa, id: string, now: Date, actor: string): Promise<ActionResult> {
  if (!crewEnabled()) return refuse(409, 'The crew app is not launched yet (CREW_ENABLED is off), so the login would refuse them. Nothing was sent.')
  const read = await getMember(sb, id)
  if (read.kind !== 'ok') return refuse(503, `Could not read the member: ${read.error}`)
  const m = read.data
  if (!m) return refuse(404, 'Unknown crew member.')
  if (m.is_owner) return refuse(400, 'Allie is never sent crew messages.')
  if (m.status !== 'active') return refuse(409, `${m.first_name} is not active.`)
  if (!m.email) return refuse(400, `${m.first_name} has no email address.`)

  const rendered = templates.invite(m.first_name, `${CANONICAL_ORIGIN}/crew/login`)
  const claim = await insertNotification(sb, {
    member_id: m.id, channel: 'email', template: 'invite', status: 'queued',
    dedupe_key: `invite:${m.id}:${etDateString(now)}`, payload: { sent_by: actor },
  })
  if (claim.kind === 'duplicate') return refuse(409, `${m.first_name} was already invited today.`)
  if (claim.kind === 'failed') return refuse(503, `Could not record the invite: ${claim.error}`)

  const sent = await sendCrewEmail(m.email, rendered)
  const done = sent.kind === 'sent'
    ? { status: 'sent', sent_at: new Date().toISOString(), provider_id: sent.providerId, error: null }
    : { status: 'failed', error: sent.kind === 'failed' ? sent.error : 'email is not configured' }
  await sb.from('crew_notifications').update(done).eq('id', claim.id).select('id')
  if (sent.kind !== 'sent') return refuse(502, `The invite did not send: ${done.error}`)
  return { ok: true }
}
