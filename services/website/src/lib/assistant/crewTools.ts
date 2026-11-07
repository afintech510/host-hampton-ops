import type Anthropic from '@anthropic-ai/sdk'
import type { getSupabase } from '@/lib/supabase'
import { loadCrewSettings, crewEnabled, crewSmsEnabled, crewPickFlowEnabled } from '@/lib/crew/settings'
import type { CrewSettings } from '@/lib/crew/rules'
import { flagText, loadAdminOverview, loadAdminParty, shiftForAdmin, type AdminMemberChoice, type AdminPartyDetail, type AdminSlotView } from '@/lib/crew/admin'
import { loadRoster } from '@/lib/crew/adminMembers'
import { reconcileCrewParties } from '@/lib/crew/sync'
import { loadPickPanel, partiesNeedingPicks } from '@/lib/crew/pick'
import { WORK_KINDS, WORK_TYPES, isWorkKind, workTypeOf } from '@/lib/crew/workTypes'
import { partyDayLabel, partyTimeLabel } from '@/lib/crew/view'
import { etToUtc } from '@/lib/partyTime'
import { STUDIO_ADDRESS_LINE } from '@/lib/studioLocation'
import { mintProposal, type Proposal } from './proposals'
import { clock12 } from './timeFormat'
import type { ToolContext, ToolOutcome } from './tools'

/**
 * Run the crew app from the chat: look at the schedule, make a task or import a
 * booked party, publish it, put people on it, move the shift.
 *
 * Reads here return the schedule and who is on what. They NEVER return pay (a
 * rate, a step, an extra, a tip), a phone number or an email address: the chat
 * shows the roster by name and by what each person can do, which is all a
 * scheduling question needs. The propose_* tools write nothing; each draws a card
 * and Confirm replays the crew admin route the Crew page itself calls
 * (lib/assistant/crewExecute.ts), so every guard those routes have still applies.
 *
 * What the crew app does NOT have, and so neither does this: a way to cancel a
 * crew party (a booking's party cancels itself when the booking does) and a way
 * for an admin to tick a member's own "I'm in" confirmation (they do that
 * themselves). "Confirm staff" here is putting them on a spot, or approving the
 * recommended picks.
 */

type Supa = ReturnType<typeof getSupabase>
type Ctx = ToolContext & { supabase: Supa }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_LISTED = 25

const KIND_LABELS: Record<string, string> = {
  in_studio_theme: 'Studio party',
  mobile_party: 'Mobile party',
  studio_rental: 'Studio rental',
  manual: 'Party (made by hand)',
}
export const crewKindLabel = (k: string) => workTypeOf(k)?.label ?? KIND_LABELS[k] ?? k

const taskKinds = [...WORK_KINDS, 'party'] as const

export const CREW_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'list_crew_parties',
    description:
      'The crew schedule: upcoming crew parties and work, earliest first, each with its id, kind, when, status (draft = not visible to crew yet, published = crew can claim it), how many spots are filled, who is on it and whether they have confirmed, plus anything needing attention (understaffed, unconfirmed, cover requests). Defaults to the next 14 days. Read-only; no pay, phone numbers or emails.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: 'How many days ahead, 1-42. Default 14.' },
        include_past_days: { type: 'integer', description: 'Also include this many days back, 0-14. Default 0.' },
        only_unstaffed: { type: 'boolean', description: 'Only parties with an open spot.' },
      },
    },
  },
  {
    name: 'get_crew_party',
    description:
      'One crew party in full: kind, when, where, status, notes for the crew, every spot (open or who holds it, and whether they confirmed), the shift times (crew arrive / shift ends / Party Lead arrives, with the defaults), and which crew members are free for it or have a conflict. Use the party_id from list_crew_parties. Read-only; no pay.',
    input_schema: { type: 'object', properties: { party_id: { type: 'string' } }, required: ['party_id'] },
  },
  {
    name: 'list_crew_members',
    description:
      'The crew roster by name: who can lead, who is active, skills, how many parties each worked and has coming up, and onboarding stage. Read-only. It never includes pay, steps, phone numbers or emails.',
    input_schema: { type: 'object', properties: { include_inactive: { type: 'boolean' } } },
  },
  {
    name: 'propose_crew_task',
    description:
      `PROPOSE a new crew task or party for the crew app, created as a DRAFT (crew cannot see it until it is published). Kinds: ${WORK_TYPES.map(t => `${t.kind} = ${t.label} (default ${t.defaultSpots} spot${t.defaultSpots === 1 ? '' : 's'}, ${t.defaultStart}-${t.defaultEnd})`).join('; ')}; or "party" for a party by hand that has a Party Lead (give guest_count). For things like "general clean / organize session", "drop-off" or "party server" pick the nearest kind and put the specifics in title and notes_for_crew. Start and end default to the kind's usual hours; spots default to the kind's usual number; location defaults to the studio. Nothing is created until the manager clicks Confirm; no crew is told.`,
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...taskKinds] },
        title: { type: 'string', description: 'Up to 80 characters. Defaults to the kind\'s name.' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        start: { type: 'string', description: 'HH:mm, 24-hour' },
        end: { type: 'string', description: 'HH:mm, 24-hour' },
        spots: { type: 'integer', description: '1-10 people (work kinds only).' },
        guest_count: { type: 'integer', description: 'Kids, for kind "party".' },
        location: { type: 'string', description: 'Defaults to the studio.' },
        notes_for_crew: { type: 'string', description: 'Seen by the crew. No pay, phone numbers or emails.' },
      },
      required: ['kind', 'date'],
    },
  },
  {
    name: 'propose_crew_import',
    description:
      'PROPOSE bringing a BOOKED party into the crew app as a draft crew party (only parties with money landed that are not already there; a studio rental needs a Party Helper line). Give booking_ref to import one party, or leave it out to import every booked party that is missing. The card lists exactly what would be created. Also cancels crew parties of cancelled bookings and queues (never sends) their notices. Nothing happens until the manager clicks Confirm.',
    input_schema: { type: 'object', properties: { booking_ref: { type: 'string' } } },
  },
  {
    name: 'propose_crew_publish',
    description:
      'PROPOSE publishing a draft crew party (crew can then see and claim it) or taking a published one back to draft (only while nobody holds a spot). The card says what will happen and whether it would be refused now. Nothing happens until the manager clicks Confirm.',
    input_schema: {
      type: 'object',
      properties: { party_id: { type: 'string' }, action: { type: 'string', enum: ['publish', 'unpublish'] } },
      required: ['party_id', 'action'],
    },
  },
  {
    name: 'propose_crew_staff',
    description:
      'PROPOSE putting a crew member on a spot (assign) or taking them off (unassign). Name the member as the roster does (first name is enough if unique). For assign, role "lead" puts them on the Party Lead spot (they must be able to lead); the default is a crew spot. The card shows any conflict (another party that overlaps, a day they blocked) and says assigning will go ahead anyway only if the manager confirms. A member already on the party, or not able to lead, is refused outright. Whether they are told depends on the party being published and crew messaging being on; the card says which. Nothing happens until Confirm.',
    input_schema: {
      type: 'object',
      properties: {
        party_id: { type: 'string' },
        action: { type: 'string', enum: ['assign', 'unassign'] },
        member: { type: 'string', description: 'Name from list_crew_members / get_crew_party.' },
        role: { type: 'string', enum: ['lead', 'crew'] },
      },
      required: ['party_id', 'action', 'member'],
    },
  },
  {
    name: 'propose_crew_shift',
    description:
      'PROPOSE changing the shift times of a crew party: when the crew arrive (crew_start), when the shift ends (end), and when the Party Lead arrives (lead_start). Times are Eastern, HH:mm 24-hour, or "default" to go back to the usual. A start cannot be after the party starts and the end cannot be before it ends. The card shows the current and new times. Nothing happens until Confirm.',
    input_schema: {
      type: 'object',
      properties: {
        party_id: { type: 'string' },
        crew_start: { type: 'string' },
        end: { type: 'string' },
        lead_start: { type: 'string' },
      },
      required: ['party_id'],
    },
  },
  {
    name: 'propose_crew_spots',
    description:
      'PROPOSE changing how many spots a crew party has: add one, remove an OPEN crew spot (never a held one or the Lead), or set the total head count. Nothing happens until Confirm.',
    input_schema: {
      type: 'object',
      properties: {
        party_id: { type: 'string' },
        action: { type: 'string', enum: ['add', 'remove', 'set_total'] },
        total: { type: 'integer', description: 'For set_total: 1-10.' },
      },
      required: ['party_id', 'action'],
    },
  },
  {
    name: 'propose_crew_notes',
    description:
      'PROPOSE setting the notes the CREW see on a crew party (empty text clears them). Every crew member can read them: no pay, phone numbers or email addresses. The card shows the old and new text. Nothing happens until Confirm.',
    input_schema: { type: 'object', properties: { party_id: { type: 'string' }, notes: { type: 'string' } }, required: ['party_id', 'notes'] },
  },
  {
    name: 'propose_crew_approve_picks',
    description:
      'PROPOSE approving the recommended people for every crew party that is waiting on a pick (parties where crew said they can work and the manager chooses). The card lists each party and who would be approved, so the manager sees it before one round of messages goes out. Nothing happens until Confirm.',
    input_schema: { type: 'object', properties: {} },
  },
]

const NAMES = new Set(CREW_TOOLS.map(t => t.name))
export const isCrewTool = (name: string) => NAMES.has(name)

export async function runCrewTool(name: string, input: Record<string, unknown>, ctx: Ctx): Promise<ToolOutcome> {
  const sb = ctx.supabase
  const now = ctx.now ?? new Date()
  const s = await loadCrewSettings(sb)
  if (s.kind !== 'ok') return fail('The crew rules could not be read - say so; do not guess.')
  switch (name) {
    case 'list_crew_parties': return listParties(sb, input, s.settings, now)
    case 'get_crew_party': return getParty(sb, input, s.settings)
    case 'list_crew_members': return listMembersTool(sb, input, s.settings, now)
    case 'propose_crew_task': return proposeTask(input, ctx, now)
    case 'propose_crew_import': return proposeImport(sb, input, s.settings, ctx, now)
    case 'propose_crew_publish': return proposePublish(sb, input, s.settings, ctx, now)
    case 'propose_crew_staff': return proposeStaff(sb, input, s.settings, ctx)
    case 'propose_crew_shift': return proposeShift(sb, input, s.settings, ctx)
    case 'propose_crew_spots': return proposeSpots(sb, input, s.settings, ctx)
    case 'propose_crew_notes': return proposeNotes(sb, input, s.settings, ctx)
    case 'propose_crew_approve_picks': return proposePicks(sb, s.settings, ctx, now)
    default: return fail(`Unknown tool: ${name}`)
  }
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

const fail = (error: string): ToolOutcome => ({ result: { error }, isError: true })
const text = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const whenOf = (startsAt: string, endsAt: string) => `${partyDayLabel(startsAt)}, ${partyTimeLabel(startsAt, endsAt)}`

function realDate(v: unknown): string | null {
  if (typeof v !== 'string' || !ISO_DATE.test(v.trim())) return null
  const [y, m, d] = v.trim().split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? v.trim() : null
}

const CONFLICT_WORDS: Record<string, string> = {
  on_party: 'is already on this party',
  overlap: 'has another party at the same time',
  blocked: 'marked that time unavailable',
  not_lead: 'is not a Party Lead',
  inactive: 'is paused or removed',
}

function card(
  kind: Proposal['kind'],
  input: Record<string, unknown>,
  title: string,
  details: string[],
  ctx: ToolContext,
  extra?: Record<string, unknown>,
): ToolOutcome {
  const minted = mintProposal({ kind, input, title, details, actor: ctx.actor })
  return {
    result: {
      status: 'awaiting_manager_confirmation',
      proposal_id: minted.proposal.id,
      shown_to_manager: details,
      ...extra,
      instruction: 'Nothing has changed yet. Tell the manager to review the card and click Confirm.',
    },
    proposal: minted,
  }
}

async function readParty(sb: Supa, input: Record<string, unknown>, s: CrewSettings): Promise<{ ok: true; d: AdminPartyDetail } | { ok: false; out: ToolOutcome }> {
  const id = text(input.party_id, 60)
  if (!id || !UUID.test(id)) return { ok: false, out: fail('party_id must be the id from list_crew_parties.') }
  const r = await loadAdminParty(sb, id, s)
  if (r.kind !== 'ok') return { ok: false, out: fail('The party could not be read - say so.') }
  if (!r.data) return { ok: false, out: fail('No crew party has that id.') }
  return { ok: true, d: r.data }
}

const liveSlots = (d: AdminPartyDetail) => d.slots.filter(sl => sl.status !== 'cancelled')
const nameOf = (m: AdminMemberChoice) => m.name

/** Match what the manager said against the roster choices. Ambiguity is returned, never picked between. */
function findMember(members: AdminMemberChoice[], said: string): { kind: 'one'; m: AdminMemberChoice } | { kind: 'none' } | { kind: 'many'; names: string[] } {
  const w = said.trim().toLowerCase()
  const pool = members.filter(m => !m.isTest)
  const exact = pool.filter(m => m.id === said || m.name.toLowerCase() === w)
  if (exact.length === 1) return { kind: 'one', m: exact[0] }
  const first = pool.filter(m => m.name.toLowerCase().split(/\s+/)[0] === w)
  if (first.length === 1) return { kind: 'one', m: first[0] }
  const hits = exact.length > 1 ? exact : first.length > 1 ? first : pool.filter(m => m.name.toLowerCase().includes(w))
  if (hits.length === 1) return { kind: 'one', m: hits[0] }
  return hits.length ? { kind: 'many', names: hits.map(nameOf) } : { kind: 'none' }
}

const messagingLine = (name: string, published: boolean) =>
  !published
    ? `${name} is not told: the party is still a draft`
    : !crewEnabled()
      ? `${name} is not messaged: crew messaging is switched OFF (an in-app notice is recorded)`
      : `${name} is told by email${crewSmsEnabled() ? ' and text' : ''} (texts are ${crewSmsEnabled() ? 'ON' : 'OFF'})`

/* ── reads ───────────────────────────────────────────────────────────────── */

async function listParties(sb: Supa, input: Record<string, unknown>, s: CrewSettings, now: Date): Promise<ToolOutcome> {
  const days = Math.max(1, Math.min(42, Math.floor(Number(input.days)) || 14))
  const back = Math.max(0, Math.min(14, Math.floor(Number(input.include_past_days)) || 0))
  const ov = await loadAdminOverview(sb, now, s)
  if (ov.kind !== 'ok') return fail('The crew schedule could not be read - say so.')
  const from = now.getTime() - back * 86_400_000
  const to = now.getTime() + days * 86_400_000
  let rows = ov.data.parties.filter(p => new Date(p.endsAt).getTime() >= from && new Date(p.startsAt).getTime() <= to)
  if (input.only_unstaffed === true) rows = rows.filter(p => p.staffed < p.needed)
  return {
    result: {
      window: `next ${days} day${days === 1 ? '' : 's'}${back ? `, plus ${back} back` : ''}`,
      count: rows.length,
      parties: rows.slice(0, MAX_LISTED).map(p => ({
        party_id: p.id,
        title: p.title,
        kind: crewKindLabel(p.kind),
        when: whenOf(p.startsAt, p.endsAt),
        status: p.status,
        spots: `${p.staffed} of ${p.needed} filled`,
        lead_filled: p.leadFilled,
        unconfirmed: p.unconfirmed,
        flags: p.flags.map(flagText),
        crew: p.crew.map(c => ({ name: c.firstName, role: c.role, confirmed: c.confirmed })),
      })),
      more: rows.length > MAX_LISTED ? rows.length - MAX_LISTED : undefined,
      needs_attention: ov.data.alerts.slice(0, 10).map(a => ({ severity: a.severity, text: a.text, party_id: a.partyId })),
      note: 'Pay is not shown here. Say a party is published only if status is "published".',
    },
  }
}

function slotView(sl: AdminSlotView) {
  return {
    slot_id: sl.id,
    role: sl.role,
    status: sl.status,
    who: sl.memberName,
    confirmed: sl.memberId ? sl.confirmed : undefined,
    how: sl.memberId ? sl.assignedVia : undefined,
    cover_request_open: sl.activeCover ? true : undefined,
  }
}

async function getParty(sb: Supa, input: Record<string, unknown>, s: CrewSettings): Promise<ToolOutcome> {
  const r = await readParty(sb, input, s)
  if (!r.ok) return r.out
  const d = r.d
  const p = d.party
  const shift = shiftForAdmin(p, s)
  return {
    result: {
      party_id: p.id,
      title: p.title,
      kind: crewKindLabel(p.party_kind),
      theme: p.theme,
      when: whenOf(p.starts_at, p.ends_at),
      where: p.location,
      kids: p.guest_count,
      status: p.status,
      selection: p.selection_mode,
      booking_ref: d.booking?.ref ?? null,
      flags: (p.sync_flags ?? []).map(flagText),
      notes_for_crew: p.notes_for_crew,
      spots: liveSlots(d).map(slotView),
      filled: `${d.staffed} of ${d.needed}`,
      shift: {
        crew_arrive: clock12(shift.crewStart),
        shift_ends: clock12(shift.end),
        lead_arrives: clock12(shift.leadStart),
        usual: { crew_arrive: clock12(shift.defaults.crewStart), shift_ends: clock12(shift.defaults.end), lead_arrives: clock12(shift.defaults.leadStart) },
      },
      standby: d.standbys.map(x => x.name),
      people: d.members
        .filter(m => !m.isTest)
        .slice(0, 40)
        .map(m => ({
          name: m.name,
          can_lead: m.canLead,
          crew_spot: m.fitCrew.conflicts.map(c => CONFLICT_WORDS[c] ?? c),
          ...(m.canLead ? { lead_spot: m.fitLead.conflicts.map(c => CONFLICT_WORDS[c] ?? c) } : {}),
        })),
      note: 'An empty list under crew_spot / lead_spot means free. Pay is not available here.',
    },
  }
}

async function listMembersTool(sb: Supa, input: Record<string, unknown>, s: CrewSettings, now: Date): Promise<ToolOutcome> {
  const r = await loadRoster(sb, s, now)
  if (r.kind !== 'ok') return fail('The crew roster could not be read - say so.')
  const all = input.include_inactive === true
  const rows = r.data.members.filter(m => !m.isTest && (all || m.status === 'active'))
  return {
    result: {
      count: rows.length,
      members: rows.map(m => ({
        name: `${m.firstName}${m.lastName ? ` ${m.lastName}` : ''}`,
        can_lead: m.canLead,
        owner: m.isOwner || undefined,
        status: m.status,
        skills: m.skills,
        parties_worked: m.partiesWorked,
        upcoming: m.upcomingSpots,
        no_shows: m.noShows || undefined,
        onboarding: m.onboarding,
      })),
      note: 'Pay, steps, phone numbers and emails are never shown in chat.',
    },
  }
}

/* ── proposals ───────────────────────────────────────────────────────────── */

function proposeTask(input: Record<string, unknown>, ctx: ToolContext, now: Date): ToolOutcome {
  const kind = text(input.kind, 30)
  if (!kind || !(taskKinds as readonly string[]).includes(kind)) return fail(`kind must be one of ${taskKinds.join(', ')}`)
  const work = isWorkKind(kind) ? workTypeOf(kind) : null
  const date = realDate(input.date)
  if (!date) return fail('date must be a real date, YYYY-MM-DD')
  const start = text(input.start, 5) ?? work?.defaultStart ?? null
  const end = text(input.end, 5) ?? work?.defaultEnd ?? null
  if (!start || !end) return fail('A party made by hand needs a start and an end time (HH:mm).')
  if (!HHMM.test(start) || !HHMM.test(end)) return fail('start and end must be HH:mm (24-hour)')
  if (end <= start) return fail('end must be after start (a shift past midnight is not supported here).')
  const [sh, sm] = start.split(':').map(Number)
  if (etToUtc(date, sh, sm).getTime() <= now.getTime()) return fail('That time has already passed.')
  const title = text(input.title, 80) ?? work?.label ?? null
  if (!title) return fail('A party made by hand needs a title.')
  const spotsRaw = input.spots
  const spots = spotsRaw === undefined || spotsRaw === null ? null : Math.floor(Number(spotsRaw))
  if (work && spots !== null && !(spots >= 1 && spots <= 10)) return fail('spots must be 1-10')
  const kids = input.guest_count === undefined || input.guest_count === null ? null : Math.floor(Number(input.guest_count))
  if (!work && kids !== null && !(kids >= 0 && kids <= 500)) return fail('guest_count must be a whole number')
  const notes = text(input.notes_for_crew, 2000)
  if (notes && (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(notes) || /\d[\d\s().-]{8,}\d/.test(notes))) {
    return fail('Crew notes are read by every crew member: leave out phone numbers and email addresses.')
  }
  const location = text(input.location, 200) ?? (work ? STUDIO_ADDRESS_LINE : null)
  if (!location) return fail('A party made by hand needs a location.')

  const body: Record<string, unknown> = {
    kind: work ? kind : 'manual',
    title,
    date,
    start,
    end,
    ...(work ? { spots: spots ?? work.defaultSpots } : {}),
    ...(!work && kids !== null ? { guest_count: kids } : {}),
    location,
    ...(notes ? { notes_for_crew: notes } : {}),
  }
  const startsIso = etToUtc(date, sh, sm).toISOString()
  const [eh, em] = end.split(':').map(Number)
  const endsIso = etToUtc(date, eh, em).toISOString()
  const details = [
    `Type: ${work ? `${work.emoji} ${work.label}` : 'Party with a Party Lead'}`,
    `Title: ${title}`,
    `When: ${whenOf(startsIso, endsIso)}`,
    work ? `Spots: ${body.spots} (${work.label} has no Party Lead)` : `Kids: ${kids ?? 'not set'} (spots follow the kids count, Lead included)`,
    `Where: ${location}`,
    `Notes: ${notes ?? 'none'}`,
    'Created as a DRAFT: crew cannot see it until you publish it. Nobody is told.',
  ]
  return card('crew_task', body, `New crew ${work ? 'task' : 'party'}: ${title}`, details, ctx)
}

async function proposeImport(sb: Supa, input: Record<string, unknown>, s: CrewSettings, ctx: ToolContext, now: Date): Promise<ToolOutcome> {
  const ref = text(input.booking_ref, 40)
  if (ref && !/^[A-Za-z0-9-]{3,40}$/.test(ref)) return fail('That is not a booking reference.')
  const r = await reconcileCrewParties({ now, supabase: sb, settings: s, dryRun: true, ...(ref ? { onlyBookingRef: ref } : {}) })
  if (r.kind !== 'ok' || !r.plan) return fail('The bookings could not be read - say so.')
  const plan = r.plan
  const missing = (list: string[]) => (ref ? list.includes(ref) : list.length > 0)

  if (ref && plan.creates.length === 0 && plan.updates.length === 0 && plan.cancels.length === 0) {
    const why = plan.needsTime.includes(ref)
      ? 'it has no usable time yet (set the party time first)'
      : plan.unclassified.includes(ref)
        ? 'its party type is not one the crew staffs'
        : plan.rentalsWithoutHelper.includes(ref)
          ? 'a studio rental with no Party Helper line has no crew'
          : plan.reactivated.includes(ref)
            ? 'its crew party was cancelled and the booking is booked again (never brought back automatically)'
            : 'it is already in the crew app, or it is not booked yet (a party is booked once money has landed, and only future dates are imported)'
    return fail(`Nothing to import for ${ref}: ${why}.`)
  }
  if (!ref && plan.creates.length === 0 && plan.updates.length === 0 && plan.cancels.length === 0) {
    return fail('Nothing to import: every booked party is already in the crew app.')
  }

  const lines = plan.creates.slice(0, 8).map(c => `${c.row.title} (${crewKindLabel(c.row.party_kind)}) · ${whenOf(c.row.starts_at, c.row.ends_at)} · ${c.roles.length} spot${c.roles.length === 1 ? '' : 's'}`)
  const details = [
    `Scope: ${ref ? `only ${ref}` : 'every booked party that is missing'}`,
    `New drafts: ${plan.creates.length}${lines.length ? ` - ${lines.join('; ')}${plan.creates.length > lines.length ? '; ...' : ''}` : ''}`,
    `Updates: ${plan.updates.length} existing crew part${plan.updates.length === 1 ? 'y' : 'ies'} refreshed from their bookings`,
    `Cancels: ${plan.cancels.length}${plan.cancels.length ? ' (their booking was cancelled; crew notices are queued, not sent)' : ''}`,
    ...(missing(plan.needsTime) ? [`Needs a time first: ${ref ? ref : plan.needsTime.slice(0, 5).join(', ')}`] : []),
    'New crew parties are DRAFTS: crew cannot see them until you publish each one.',
  ]
  return card('crew_import', ref ? { bookingRef: ref } : {}, ref ? `Import ${ref} to the crew app` : 'Import booked parties to the crew app', details, ctx)
}

async function proposePublish(sb: Supa, input: Record<string, unknown>, s: CrewSettings, ctx: ToolContext, now: Date): Promise<ToolOutcome> {
  const action = input.action
  if (action !== 'publish' && action !== 'unpublish') return fail('action must be publish or unpublish')
  const r = await readParty(sb, input, s)
  if (!r.ok) return r.out
  const { party: p } = r.d
  const filled = liveSlots(r.d).filter(sl => sl.memberId && sl.status !== 'open')
  let refusal: string | null = null
  if (action === 'publish') {
    if (p.status !== 'draft') refusal = `It is ${p.status}, and only a draft can be published.`
    else if (new Date(p.starts_at).getTime() <= now.getTime()) refusal = 'It has already started.'
    else if (liveSlots(r.d).length === 0) refusal = 'It has no spots yet.'
  } else if (p.status !== 'published') refusal = `It is ${p.status}, and only a published party can go back to draft.`
  else if (filled.length) refusal = `${filled.map(f => f.memberName ?? 'Someone').join(', ')} ${filled.length === 1 ? 'holds' : 'hold'} a spot; take them off first.`

  const details = [
    `Party: ${p.title}`,
    `When: ${whenOf(p.starts_at, p.ends_at)}`,
    `Status now: ${p.status}`,
    `Spots: ${r.d.staffed} of ${r.d.needed} filled`,
    action === 'publish'
      ? `Result: crew can see it and ${crewPickFlowEnabled() ? 'say they can work it (you choose)' : 'claim a spot first-come'}`
      : 'Result: back to draft, hidden from crew',
    ...(refusal ? [`Would be refused now: ${refusal}`] : []),
  ]
  return card('crew_publish', { partyId: p.id, action, title: p.title }, `${action === 'publish' ? 'Publish' : 'Unpublish'}: ${p.title}`, details, ctx, refusal ? { would_be_refused: refusal } : undefined)
}

async function proposeStaff(sb: Supa, input: Record<string, unknown>, s: CrewSettings, ctx: ToolContext): Promise<ToolOutcome> {
  const action = input.action
  if (action !== 'assign' && action !== 'unassign') return fail('action must be assign or unassign')
  const said = text(input.member, 80)
  if (!said) return fail('Which crew member?')
  const r = await readParty(sb, input, s)
  if (!r.ok) return r.out
  const d = r.d
  const found = findMember(d.members, said)
  if (found.kind === 'none') return fail(`No active crew member matches "${said}". Use list_crew_members for the names.`)
  if (found.kind === 'many') return fail(`"${said}" matches more than one person: ${found.names.join(', ')}. Ask which.`)
  const m = found.m
  const published = d.party.status === 'published'
  const head = [`Party: ${d.party.title}`, `When: ${whenOf(d.party.starts_at, d.party.ends_at)}`]

  if (action === 'unassign') {
    const slot = liveSlots(d).find(sl => sl.memberId === m.id)
    if (!slot) return fail(`${m.name} is not on this party.`)
    const refusal = slot.activeCover ? 'They have an open cover request; settle that first.' : new Date(d.party.starts_at).getTime() <= (ctx.now ?? new Date()).getTime() ? 'The party has already started.' : null
    const details = [
      ...head,
      `Who: ${m.name}`,
      `Spot: ${slot.role === 'lead' ? 'Party Lead' : 'Crew'}`,
      'Result: the spot reopens; this is not a cancellation by them, so it does not count against them',
      ...(refusal ? [`Would be refused now: ${refusal}`] : []),
    ]
    return card('crew_staff', { partyId: d.party.id, action, slotId: slot.id, memberId: m.id, memberName: m.name, title: d.party.title }, `Take ${m.name} off: ${d.party.title}`, details, ctx, refusal ? { would_be_refused: refusal } : undefined)
  }

  const wantLead = input.role === 'lead'
  const open = liveSlots(d).filter(sl => sl.status === 'open' && sl.role === (wantLead ? 'lead' : 'crew'))
  if (open.length === 0) return fail(wantLead ? 'There is no open Party Lead spot on this party.' : 'There is no open crew spot on this party. Add one with propose_crew_spots first.')
  const fit = wantLead ? m.fitLead : m.fitCrew
  const hard = fit.conflicts.filter(c => c === 'on_party' || c === 'not_lead' || c === 'inactive')
  if (hard.length) return fail(`${m.name} ${CONFLICT_WORDS[hard[0]]}. Pick someone else.`)
  const soft = fit.conflicts.filter(c => c === 'overlap' || c === 'blocked')
  const slot = open[0]
  const details = [
    ...head,
    `Who: ${m.name}${m.canLead ? ' (can lead)' : ''}`,
    `Spot: ${wantLead ? 'Party Lead' : 'Crew'}`,
    soft.length
      ? `Conflict: ${m.name} ${soft.map(c => CONFLICT_WORDS[c]).join(' and ')}${fit.overlapWith.length ? ` (${fit.overlapWith.join(', ')})` : ''} - confirming puts them on it anyway`
      : 'Conflicts: none',
    `Notice: ${messagingLine(m.name, published)}`,
  ]
  return card(
    'crew_staff',
    { partyId: d.party.id, action, slotId: slot.id, memberId: m.id, memberName: m.name, force: soft.length > 0, title: d.party.title },
    `Put ${m.name} on: ${d.party.title}`,
    details,
    ctx,
  )
}

function readTime(v: unknown, label: string): { ok: true; value: string | null | undefined } | { ok: false; out: ToolOutcome } {
  if (v === undefined || v === null || v === '') return { ok: true, value: undefined }
  if (typeof v === 'string' && v.trim().toLowerCase() === 'default') return { ok: true, value: null }
  if (typeof v === 'string' && HHMM.test(v.trim())) return { ok: true, value: v.trim() }
  return { ok: false, out: fail(`${label} must be HH:mm (24-hour) or "default"`) }
}

async function proposeShift(sb: Supa, input: Record<string, unknown>, s: CrewSettings, ctx: ToolContext): Promise<ToolOutcome> {
  const crew = readTime(input.crew_start, 'crew_start')
  const end = readTime(input.end, 'end')
  const lead = readTime(input.lead_start, 'lead_start')
  for (const t of [crew, end, lead]) if (!t.ok) return t.out
  const vals = { crew_start: (crew as { value: string | null | undefined }).value, end: (end as { value: string | null | undefined }).value, lead_start: (lead as { value: string | null | undefined }).value }
  if (vals.crew_start === undefined && vals.end === undefined && vals.lead_start === undefined) return fail('Give at least one of crew_start, end or lead_start.')
  const r = await readParty(sb, input, s)
  if (!r.ok) return r.out
  const p = r.d.party
  if (p.status !== 'draft' && p.status !== 'published') return fail(`That party is ${p.status} and can no longer be changed.`)
  const cur = shiftForAdmin(p, s)
  const show = (v: string | null | undefined, now: string, usual: string) =>
    v === undefined ? `${clock12(now)} (unchanged)` : `${clock12(now)} → ${v === null ? `${clock12(usual)} (the usual)` : clock12(v)}`
  const details = [
    `Party: ${p.title}`,
    `When: ${whenOf(p.starts_at, p.ends_at)}`,
    `Crew arrive: ${show(vals.crew_start, cur.crewStart, cur.defaults.crewStart)}`,
    `Shift ends: ${show(vals.end, cur.end, cur.defaults.end)}`,
    `Lead arrives: ${show(vals.lead_start, cur.leadStart, cur.defaults.leadStart)}`,
    'Times are Eastern. A start after the party starts, or an end before it ends, is refused.',
    `On it now: ${liveSlots(r.d).filter(sl => sl.memberName).map(sl => sl.memberName).join(', ') || 'nobody'}`,
  ]
  const body: Record<string, unknown> = { partyId: p.id, title: p.title }
  for (const [k, v] of Object.entries(vals)) if (v !== undefined) body[k] = v
  return card('crew_shift', body, `Change shift times: ${p.title}`, details, ctx)
}

async function proposeSpots(sb: Supa, input: Record<string, unknown>, s: CrewSettings, ctx: ToolContext): Promise<ToolOutcome> {
  const action = input.action
  if (action !== 'add' && action !== 'remove' && action !== 'set_total') return fail('action must be add, remove or set_total')
  const r = await readParty(sb, input, s)
  if (!r.ok) return r.out
  const d = r.d
  const live = liveSlots(d)
  const base = [`Party: ${d.party.title}`, `When: ${whenOf(d.party.starts_at, d.party.ends_at)}`, `Spots now: ${live.length} (${d.staffed} filled)`]
  if (action === 'add') {
    if (live.length >= 10) return fail('A party has at most 10 spots.')
    return card('crew_spots', { partyId: d.party.id, action, title: d.party.title }, `Add a spot: ${d.party.title}`, [...base, `Spots after: ${live.length + 1}`], ctx)
  }
  if (action === 'remove') {
    const open = live.filter(sl => sl.status === 'open' && sl.role === 'crew')
    if (open.length === 0) return fail('There is no open crew spot to remove (a held spot and the Party Lead spot cannot be removed).')
    return card('crew_spots', { partyId: d.party.id, action, slotId: open[open.length - 1].id, title: d.party.title }, `Remove a spot: ${d.party.title}`, [...base, `Spots after: ${live.length - 1}`], ctx)
  }
  const total = Math.floor(Number(input.total))
  if (!(total >= 1 && total <= 10)) return fail('total must be a whole number from 1 to 10')
  return card(
    'crew_spots',
    { partyId: d.party.id, action, total, title: d.party.title },
    `Set the head count: ${d.party.title}`,
    [...base, `Total after: ${total}`, 'Adds missing spots; it never removes one, so a lower number than today changes nothing.'],
    ctx,
  )
}

async function proposeNotes(sb: Supa, input: Record<string, unknown>, s: CrewSettings, ctx: ToolContext): Promise<ToolOutcome> {
  if (typeof input.notes !== 'string') return fail('notes must be text (empty clears them)')
  const notes = input.notes.trim().slice(0, 2000)
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(notes) || /\d[\d\s().-]{8,}\d/.test(notes)) {
    return fail('Crew notes are read by every crew member: leave out phone numbers and email addresses.')
  }
  const r = await readParty(sb, input, s)
  if (!r.ok) return r.out
  const p = r.d.party
  const details = [
    `Party: ${p.title}`,
    `Now: ${p.notes_for_crew?.trim() || 'none'}`,
    `New: ${notes || 'none (cleared)'}`,
    'Every crew member who can see this party can read the notes.',
  ]
  return card('crew_notes', { partyId: p.id, notes, title: p.title }, `Crew notes: ${p.title}`, details, ctx)
}

async function proposePicks(sb: Supa, s: CrewSettings, ctx: ToolContext, now: Date): Promise<ToolOutcome> {
  const need = await partiesNeedingPicks(sb, now)
  if (need.kind !== 'ok') return fail('The picks could not be read - say so.')
  if (need.data.length === 0) return fail('No crew party is waiting on a pick.')
  const lines: string[] = []
  for (const { party } of need.data.slice(0, 8)) {
    const panel = await loadPickPanel(sb, party.id, s)
    if (panel.kind !== 'ok' || !panel.data) continue
    const rec = panel.data.recommendation.map(x => x.name).join(', ') || 'nobody free'
    lines.push(`${party.title} · ${whenOf(party.starts_at, party.ends_at)} → ${rec}`)
  }
  const details = [
    `Waiting: ${need.data.length} part${need.data.length === 1 ? 'y' : 'ies'}`,
    ...lines.map((l, i) => `Pick ${i + 1}: ${l}`),
    `Notice: ${crewEnabled() ? `one round of messages goes to everyone who asked (texts ${crewSmsEnabled() ? 'ON' : 'OFF'})` : 'crew messaging is OFF, so nobody is messaged (in-app notices are recorded)'}`,
    'Approves the ranked recommendation for each, earliest first. Anyone it leaves out goes on standby.',
  ]
  return card('crew_picks', {}, 'Approve the recommended crew picks', details, ctx)
}
