/**
 * What a crew member's browser may receive. THE ONLY SHAPES a `/crew` page or
 * `/api/crew/*` route returns (spec §5, prompt 00 "Authorization").
 *
 * Every function here is an ALLOW-list: it builds a new object field by field
 * from the rows, so a column the next migration adds is private until somebody
 * decides otherwise — the `select('*')`-on-bookings lesson (AGENTS.md §11).
 *
 * About OTHER members, a crew member learns exactly two things: a first name
 * and whether they have confirmed. Never their phone, email, pay, tips, step,
 * notes, cancel reason, or even their id. About THEMSELVES they see their own
 * rate, step-free in wording, and their own pay records.
 *
 * `view.test.ts` seeds every private field with a sentinel and asserts none
 * of them survives `JSON.stringify` of any projection.
 */

import {
  clampSteps, formatCents, isInGracePeriod, nextStepLabel, partyPayCents, partyRateCents, ratesFor, TIME_ZONE,
  type CrewSettings, type SlotRole,
} from '@/lib/crew/rules'
import { shiftEtDate } from '@/lib/partyTime'
import type { CrewMemberRow, CrewPartyRow, CrewSlotRow, SlotStatus } from '@/lib/crew/db'

export interface CrewMeView {
  id: string
  firstName: string
  lastName: string | null
  email: string | null      // their OWN address, on their own profile
  phone: string | null      // their OWN number
  canLead: boolean
  skills: string[]
  smsOptIn: boolean
  emailOptIn: boolean
  crewRateCents: number
  leadRateCents: number | null
  atTopRate: boolean
  rateLine: string          // "You're at $58.50 a party ($77.50 leading). One more party makes it $61.00."
}

export function meView(m: CrewMemberRow, s: CrewSettings): CrewMeView {
  const r = ratesFor(m.steps, s)
  return {
    id: m.id,
    firstName: m.first_name,
    lastName: m.last_name ?? null,
    email: m.email ?? null,
    phone: m.phone ?? null,
    canLead: !!m.can_lead,
    skills: Array.isArray(m.skills) ? m.skills.map(String) : [],
    smsOptIn: !!m.sms_opt_in,
    emailOptIn: !!m.email_opt_in,
    crewRateCents: r.crewCents,
    leadRateCents: m.can_lead ? r.leadCents : null,
    atTopRate: r.atMax,
    rateLine: nextStepLabel(m.steps, !!m.can_lead, s),
  }
}

export interface TeammateView {
  firstName: string
  role: SlotRole
  confirmed: boolean
  isMe: boolean
}

export interface OpenSpotView {
  slotId: string
  role: SlotRole
  /** What THIS member would be paid for this spot, at their step. */
  payCents: number
  /** A Lead spot is offered only to a member who may hold it. */
  canClaim: boolean
}

export interface MySlotView {
  slotId: string
  role: SlotRole
  status: SlotStatus
  confirmed: boolean
  payCents: number
}

export interface CrewPartyView {
  id: string
  title: string
  theme: string | null
  startsAt: string
  endsAt: string
  /** The full address only for a member who is ON the party; others see where in general terms. */
  location: string
  guestCount: number | null
  /** Notes from Allie are for the people working it. */
  notesForCrew: string | null
  status: 'published' | 'completed' | 'cancelled'
  needed: number
  staffed: number
  mySlot: MySlotView | null
  openSpots: OpenSpotView[]
  team: TeammateView[]
  iAmStandby: boolean
}

const LIVE: SlotStatus[] = ['assigned', 'completed', 'no_show']

/**
 * One party as `viewer` may see it. Returns null for a party a crew member
 * must not see at all: a draft, or a cancelled/completed party they were not
 * on. `firstNames` maps member id → first name for teammates (and nothing else).
 */
export function partyView(
  input: {
    party: CrewPartyRow
    slots: CrewSlotRow[]
    viewer: Pick<CrewMemberRow, 'id' | 'steps' | 'can_lead'>
    firstNames: ReadonlyMap<string, string>
    standbyMemberIds: ReadonlySet<string>
  },
  s: CrewSettings,
): CrewPartyView | null {
  const { party, slots, viewer, firstNames, standbyMemberIds } = input
  const live = slots.filter(sl => sl.status !== 'cancelled')
  const mine = live.find(sl => sl.member_id === viewer.id && LIVE.includes(sl.status)) ?? null

  if (party.status === 'draft') return null
  if ((party.status === 'cancelled' || party.status === 'completed') && !mine) return null

  const extra = party.extra_flat_cents
  const onIt = !!mine
  const openSpots: OpenSpotView[] = party.status === 'published'
    ? live.filter(sl => sl.status === 'open').map(sl => ({
        slotId: sl.id,
        role: sl.role,
        payCents: partyPayCents(sl.role, viewer.steps, extra, s),
        canClaim: !onIt && (sl.role !== 'lead' || !!viewer.can_lead),
      }))
    : []

  const team: TeammateView[] = live
    .filter(sl => sl.member_id && LIVE.includes(sl.status))
    .map(sl => ({
      firstName: firstNames.get(sl.member_id as string) ?? 'Crew',
      role: sl.role,
      confirmed: !!sl.confirmed_at,
      isMe: sl.member_id === viewer.id,
    }))

  return {
    id: party.id,
    title: party.title,
    theme: party.theme ?? null,
    startsAt: party.starts_at,
    endsAt: party.ends_at,
    location: onIt || party.party_kind !== 'mobile_party' ? party.location : 'Mobile party (address once you are on it)',
    guestCount: party.guest_count ?? null,
    notesForCrew: onIt ? party.notes_for_crew ?? null : null,
    status: party.status,
    needed: live.length,
    staffed: team.length,
    mySlot: mine
      ? {
          slotId: mine.id,
          role: mine.role,
          status: mine.status,
          confirmed: !!mine.confirmed_at,
          payCents: partyPayCents(mine.role, viewer.steps, extra, s),
        }
      : null,
    openSpots,
    team,
    iAmStandby: standbyMemberIds.has(viewer.id),
  }
}

/** One of the viewer's OWN pay records. Never built for anybody else's slot. */
export interface MyPayRecordView {
  partyTitle: string
  startsAt: string
  role: SlotRole
  payCents: number | null
  extraCents: number | null
  tipCents: number | null
  tipTopupCents: number | null
  paidMethod: string | null
  paidAt: string | null
}

export function myPayRecords(viewerId: string, rows: { slot: CrewSlotRow; party: CrewPartyRow }[]): MyPayRecordView[] {
  return rows
    .filter(r => r.slot.member_id === viewerId && r.slot.status === 'completed')
    .map(r => ({
      partyTitle: r.party.title,
      startsAt: r.party.starts_at,
      role: r.slot.role,
      payCents: r.slot.pay_cents ?? null,
      extraCents: r.slot.extra_cents ?? null,
      tipCents: r.slot.tip_cents ?? null,
      tipTopupCents: r.slot.tip_topup_cents ?? null,
      paidMethod: r.slot.paid_method ?? null,
      paidAt: r.slot.paid_at ?? null,
    }))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
}

// ── The test picker (CREW_TEST_LOGIN) ───────────────────────────────────────

/** One card in "Testing: pick a crew member". Invented members only; never an email or a phone. */
export interface TestPickView {
  id: string
  firstName: string
  lastName: string | null
  rateCents: number
  canLead: boolean
}

export function testPickView(
  rows: ReadonlyArray<Pick<CrewMemberRow, 'id' | 'first_name' | 'last_name' | 'steps' | 'can_lead'>>,
  s: CrewSettings,
): TestPickView[] {
  return rows.map(m => ({
    id: m.id,
    firstName: m.first_name,
    lastName: m.last_name ?? null,
    rateCents: partyRateCents('crew', m.steps, s),
    canLead: !!m.can_lead,
  }))
}

// ── My pay: the ladder and how cancelling works, in plain words ─────────────

export interface LadderRow {
  /** 0 = the starting rate. Shown as dollars, never as a number to the crew. */
  index: number
  crewCents: number
  leadCents: number | null
  isMine: boolean
}

export function payLadder(steps: number, canLead: boolean, s: CrewSettings): LadderRow[] {
  const mine = clampSteps(steps, s)
  return Array.from({ length: s.pay.maxSteps + 1 }, (_, i) => ({
    index: i,
    crewCents: partyRateCents('crew', i, s),
    leadCents: canLead ? partyRateCents('lead', i, s) : null,
    isMine: i === mine,
  }))
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * "How cancelling works", generated from the settings so it cannot drift from
 * what the rules do. Dollars a party only; `crewCopy.test.ts` bans the words.
 */
export function cancellingLines(s: CrewSettings, now: Date): string[] {
  const step = s.pay.stepCents
  const start = formatCents(s.pay.crewStartCents)
  const days = s.drops.lateDropDays
  const lines: string[] = []
  const each = (n: number) => formatCents(Math.abs(n) * step)

  lines.push(`Every party you work raises your rate by ${each(s.steps.worked)} a party, up to ${formatCents(partyRateCents('crew', s.pay.maxSteps, s))}.`)
  if (s.steps.earlyRelease < 0) {
    lines.push(`Can't make it, with ${plural(days, 'day', 'days')} or more notice? Your spot opens up for the rest of the crew and your rate goes down ${each(s.steps.earlyRelease)} a party.`)
  } else {
    lines.push(`Can't make it, with ${plural(days, 'day', 'days')} or more notice? Your spot opens up for the rest of the crew and your rate stays the same.`)
  }
  lines.push(`With less than ${plural(days, 'day', 'days')} notice, we ask the crew who said they can cover. You stay on the party until one of them takes it. If someone covers you, nothing changes for you.`)
  lines.push(`If nobody covers and you drop the party anyway, your rate goes back to the starting ${start}. Not showing up does the same.`)
  if (s.steps.covered > s.steps.worked) {
    lines.push(`Cover someone else's party and work it, and that party raises your rate by ${each(s.steps.covered)} instead of ${each(s.steps.worked)}.`)
  }
  lines.push(`Tips: if your tips for a party come to less than ${formatCents(s.pay.tipFloorCents)}, Host Hampton tops them up to ${formatCents(s.pay.tipFloorCents)}.`)
  if (isInGracePeriod(now, s)) {
    const until = s.launch.launchDate ? shiftEtDate(s.launch.launchDate, Math.floor(s.launch.graceDays)) : null
    lines.push(until
      ? `While we're getting started (until ${dayLabel(until)}), none of this lowers your rate. We just keep a note.`
      : `While we're getting started, none of this lowers your rate. We just keep a note.`)
  }
  return lines
}

// ── Dates, in Eastern time (the box is UTC) ─────────────────────────────────

const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric' })
const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' })

/** "Sat, Oct 31" for an ET calendar date "2026-10-31". */
export function dayLabel(dateKey: string): string {
  return dayFmt.format(new Date(`${dateKey}T12:00:00Z`))
}

/** "Sat, Oct 31" for an instant, in Eastern time. */
export function partyDayLabel(iso: string): string {
  return dayFmt.format(new Date(iso))
}

/** "1:30 PM" in Eastern time. */
export function clockLabel(iso: string | Date): string {
  return timeFmt.format(typeof iso === 'string' ? new Date(iso) : iso)
}

/** "1:30 PM – 4:30 PM" in Eastern time. */
export function partyTimeLabel(startsAt: string, endsAt: string): string {
  return `${clockLabel(startsAt)} – ${clockLabel(endsAt)}`
}

/** What a crew member is told when a claim is refused. Plain words, no rule names. */
export function claimRefusalText(r: string): string {
  switch (r) {
    case 'party_closed': return 'This party is no longer open.'
    case 'inactive': return 'Your account is paused. Talk to Allie.'
    case 'unavailable': return 'Someone just took that spot.'
    case 'not_lead': return 'That spot is for a Party Lead.'
    case 'already_on_party': return "You're already on this party."
    case 'overlap': return "You're working another party at that time."
    case 'blocked': return "You've marked yourself unavailable then. Change it in Availability first."
    default: return "That didn't work. Try again."
  }
}
