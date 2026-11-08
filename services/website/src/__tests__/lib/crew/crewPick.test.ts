/**
 * Equitable scheduling (migration 090): the crew say what they want, the system
 * ranks who asked by who worked least recently, the manager approves, everyone
 * else who asked is a standby. Being quick decides nothing, and nothing locks
 * until the manager approves.
 */
import fs from 'fs'
import path from 'path'
import { DEFAULT_SETTINGS, type CrewSettings } from '@/lib/crew/rules'
import {
  approveAllRecommended, approvePicks, loadPickPanel, moveToStandby, notifyPickRound, rankVolunteers, recommendPicks, saveResponse,
  type PickCandidate, type RankedVolunteer,
} from '@/lib/crew/pick'
import { assignMember, publishParty } from '@/lib/crew/adminActions'
import { crewPickAutoApproveEnabled } from '@/lib/crew/settings'
import { templates } from '@/lib/crew/templates'
import { runCrewAsks, runPickAutoApprove, runPickDigest, type JobsCtx } from '@/lib/crew/jobs'
import type { CrewSenders } from '@/lib/crew/notify'
import { fakeAdminAssign, fakeCrewDb, type FakeCrewDb } from '../../helpers/fakeCrewDb'

const H = 3_600_000
const DAY = 24 * H
const NOW = new Date('2026-11-02T15:00:00Z')
const S: CrewSettings = DEFAULT_SETTINGS
const ACTOR = 'admin:allie@example.test'
const iso = (ms: number) => new Date(ms).toISOString()
const inDays = (d: number) => iso(NOW.getTime() + d * DAY)

// ── The ranking, pure ───────────────────────────────────────────────────────

const cand = (id: string, history: string[], over: Partial<PickCandidate> = {}): PickCandidate => ({
  memberId: id, firstName: id.toUpperCase(), lastName: null, canLead: false, joinedOn: '2026-10-01',
  history: history.map(startsAt => ({ startsAt })), ...over,
})
const T = new Date('2026-11-20T18:00:00Z')

describe('rankVolunteers: who worked least recently goes first', () => {
  it('someone who has never worked comes first, then the oldest last-worked date', () => {
    const r = rankVolunteers(T, [cand('a', ['2026-11-15T18:00:00Z']), cand('b', ['2026-10-01T18:00:00Z']), cand('c', [])])
    expect(r.map(v => v.memberId)).toEqual(['c', 'b', 'a'])
    expect(r.map(v => v.rank)).toEqual([1, 2, 3])
    expect(r[0].lastWorkedAt).toBeNull()
  })

  it('ties on the last party go to whoever has fewer parties in the 30 days around this one', () => {
    const last = '2026-11-10T18:00:00Z'
    const r = rankVolunteers(T, [cand('busy', ['2026-11-01T18:00:00Z', '2026-11-05T18:00:00Z', last]), cand('light', [last])])
    expect(r.map(v => v.memberId)).toEqual(['light', 'busy'])
    expect(r.find(v => v.memberId === 'busy')!.recent).toBe(3)
  })

  it('a party someone is approved for but has not worked yet counts as recent', () => {
    // A is approved for the 18th (two days before this one); B last worked a month ago.
    const r = rankVolunteers(T, [cand('a', ['2026-11-18T18:00:00Z']), cand('b', ['2026-10-18T18:00:00Z'])])
    expect(r.map(v => v.memberId)).toEqual(['b', 'a'])
  })

  it('a party AFTER this one never makes someone look as if they worked recently, but it does count toward load', () => {
    const r = rankVolunteers(T, [cand('later', ['2026-11-25T18:00:00Z', '2026-11-26T18:00:00Z']), cand('earlier', ['2026-11-19T18:00:00Z'])])
    // `later` has no party at or before this one, so they have not "worked" yet: they rank first.
    expect(r[0].memberId).toBe('later')
    expect(r[0].lastWorkedAt).toBeNull()
    expect(r[0].recent).toBe(2)
  })

  it('then who joined first, then name: and the order of the input never matters', () => {
    const a = cand('a', [], { joinedOn: '2026-09-01' })
    const b = cand('b', [], { joinedOn: '2026-10-01' })
    const c = cand('c', [], { joinedOn: '2026-10-01', firstName: 'Zed' })
    const want = ['a', 'b', 'c']
    expect(rankVolunteers(T, [a, b, c]).map(v => v.memberId)).toEqual(want)
    expect(rankVolunteers(T, [c, b, a]).map(v => v.memberId)).toEqual(want)
    expect(rankVolunteers(T, [b, c, a]).map(v => v.memberId)).toEqual(want)
  })

  it('has no input that could be how fast someone answered', () => {
    expect(Object.keys(cand('a', []))).toEqual(['memberId', 'firstName', 'lastName', 'canLead', 'joinedOn', 'history'])
  })
})

describe('recommendPicks', () => {
  const v = (id: string, rank: number, canLead = false): RankedVolunteer => ({ memberId: id, firstName: id, lastName: null, canLead, lastWorkedAt: null, recent: 0, rank })
  it('gives the Lead spot to the best-ranked person who may lead, then crew spots down the list', () => {
    const rec = recommendPicks([{ slotId: 'l', role: 'lead' }, { slotId: 'c1', role: 'crew' }, { slotId: 'c2', role: 'crew' }],
      [v('a', 1), v('b', 2, true), v('c', 3), v('d', 4, true)])
    expect(rec).toEqual([
      { slotId: 'l', role: 'lead', memberId: 'b' },
      { slotId: 'c1', role: 'crew', memberId: 'a' },
      { slotId: 'c2', role: 'crew', memberId: 'c' },
    ])
  })
  it('never picks anyone twice and leaves a spot open rather than filling it wrongly', () => {
    const rec = recommendPicks([{ slotId: 'l', role: 'lead' }, { slotId: 'c1', role: 'crew' }], [v('a', 1)])
    expect(rec).toEqual([{ slotId: 'c1', role: 'crew', memberId: 'a' }])
  })
})

// ── The world: a published pick-mode party and a roster ────────────────────

const person = (id: string, over: Record<string, unknown> = {}) => ({
  id, first_name: id.toUpperCase(), last_name: null, email: `${id}@example.test`, phone: null, steps: 3, can_lead: false,
  is_owner: false, is_test: false, skills: [], status: 'active', needs_review: false, sms_opt_in: false, sms_opt_in_at: null,
  email_opt_in: true, admin_notes: null, job_application_id: null, joined_on: '2026-10-01', created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z', ...over,
})

function party(id: string, startDays: number, over: Record<string, unknown> = {}) {
  const starts_at = inDays(startDays)
  return {
    id, booking_id: `b-${id}`, party_kind: 'in_studio_theme', title: `Party ${id}`, theme: `Theme ${id}`, starts_at, ends_at: iso(new Date(starts_at).getTime() + 3 * H),
    guest_count: 12, location: '295 Montauk Hwy', notes_for_crew: null, slots_override: null, extra_flat_cents: 0, status: 'published',
    published_at: iso(NOW.getTime() - H), attendance_marked_at: null, cancelled_at: null, sync_flags: [], selection_mode: 'pick',
    created_at: '2026-11-01T12:00:00Z', updated_at: '2026-11-01T12:00:00Z', ...over,
  }
}

const slot = (id: string, partyId: string, member: string | null, role: 'lead' | 'crew' = 'crew', over: Record<string, unknown> = {}) => ({
  id, party_id: partyId, role, status: member ? 'assigned' : 'open', member_id: member, assigned_at: member ? '2026-10-20T00:00:00Z' : null,
  assigned_via: member ? 'admin' : null, assigned_by: null, confirmed_at: null, covered_swap_id: null, created_at: `2026-10-20T00:00:0${id.length}Z`, ...over,
})

const answer = (partyId: string, memberId: string, response: string) => ({ id: `r-${partyId}-${memberId}`, party_id: partyId, member_id: memberId, response, created_at: iso(NOW.getTime() - H), updated_at: iso(NOW.getTime() - H) })

function world(extra: Partial<Record<string, any[]>> = {}): FakeCrewDb {
  return fakeCrewDb({
    crew_members: [
      person('owner', { is_owner: true, can_lead: true, email: null }),
      person('a', { can_lead: true }), person('b'), person('c'), person('d'), person('e'),
      ...(extra.members ?? []),
    ],
    crew_parties: [party('p1', 10), ...(extra.parties ?? [])],
    crew_slots: [slot('p1-lead', 'p1', 'owner', 'lead'), slot('p1-c1', 'p1', null), slot('p1-c2', 'p1', null), ...(extra.slots ?? [])],
    crew_party_responses: [...(extra.responses ?? [])],
    crew_pick_log: [],
    crew_standbys: [...(extra.standbys ?? [])],
    crew_unavailability: [...(extra.unavail ?? [])],
    crew_recurring_blocks: [],
    crew_swap_requests: [],
    crew_events: [],
    crew_notifications: [],
    crew_settings: [],
  }, { rpc: fakeAdminAssign })
}

/** A finished party someone worked `daysAgo` days ago. */
const worked = (id: string, member: string, daysAgo: number) => ({
  parties: [party(`past-${id}`, -daysAgo, { status: 'completed', selection_mode: 'first_come' })],
  slots: [slot(`s-${id}`, `past-${id}`, member, 'crew', { status: 'completed' })],
})
const merge = (...ws: { parties?: any[]; slots?: any[]; responses?: any[]; unavail?: any[]; standbys?: any[] }[]) => ({
  parties: ws.flatMap(w => w.parties ?? []), slots: ws.flatMap(w => w.slots ?? []), responses: ws.flatMap(w => w.responses ?? []),
  unavail: ws.flatMap(w => w.unavail ?? []), standbys: ws.flatMap(w => w.standbys ?? []),
})

// ── The manager's panel ─────────────────────────────────────────────────────

describe('loadPickPanel', () => {
  it('ranks who asked by who worked least recently, from the real history', async () => {
    const db = world(merge(
      worked('a', 'a', 5), worked('b', 'b', 40),
      { responses: [answer('p1', 'a', 'work'), answer('p1', 'b', 'work'), answer('p1', 'c', 'work'), answer('p1', 'd', 'standby'), answer('p1', 'e', 'unavailable')] },
    ))
    const r = await loadPickPanel(db.sb, 'p1', S)
    if (r.kind !== 'ok' || !r.data) throw new Error('no panel')
    expect(r.data.mode).toBe('pick')
    expect(r.data.volunteers.map(v => v.memberId)).toEqual(['c', 'b', 'a'])
    expect(r.data.volunteers[0]).toMatchObject({ rank: 1, lastWorkedAt: null, recent: 0 })
    expect(r.data.standbys.map(x => x.memberId)).toEqual(['d'])
    expect(r.data.unavailable.map(x => x.memberId)).toEqual(['e'])
  })

  it('recommends the top two for the two crew spots, and the Lead spot to a lead if one asked', async () => {
    const db = world(merge(worked('a', 'a', 5), worked('b', 'b', 40), { responses: [answer('p1', 'a', 'work'), answer('p1', 'b', 'work'), answer('p1', 'c', 'work')] }))
    const r = await loadPickPanel(db.sb, 'p1', S)
    if (r.kind !== 'ok' || !r.data) throw new Error('no panel')
    expect(r.data.openSpots.map(o => o.slotId).sort()).toEqual(['p1-c1', 'p1-c2'])
    expect(r.data.recommendation.map(x => x.memberId)).toEqual(['c', 'b'])
  })

  it('does not recommend someone who has since become busy or marked themselves unavailable, and says so', async () => {
    const day = inDays(10).slice(0, 10)
    const db = world({ responses: [answer('p1', 'b', 'work'), answer('p1', 'c', 'work')], unavail: [{ member_id: 'b', day, part: 'all_day' }] })
    const r = await loadPickPanel(db.sb, 'p1', S)
    if (r.kind !== 'ok' || !r.data) throw new Error('no panel')
    expect(r.data.volunteers.map(v => v.memberId)).toEqual(['c'])
    expect(r.data.conflicted.map(v => v.memberId)).toEqual(['b'])
    expect(r.data.recommendation.map(x => x.memberId)).toEqual(['c'])
  })

  it('lists the crew who have not answered', async () => {
    const db = world({ responses: [answer('p1', 'a', 'work')] })
    const r = await loadPickPanel(db.sb, 'p1', S)
    if (r.kind !== 'ok' || !r.data) throw new Error('no panel')
    expect(r.data.noResponse.map(x => x.memberId).sort()).toEqual(['b', 'c', 'd', 'e'])
  })
})

// ── A crew member's answer ──────────────────────────────────────────────────

const member = (db: FakeCrewDb, id: string) => db.tables.crew_members.find(m => m.id === id) as any
const rows = (db: FakeCrewDb, table: string) => db.tables[table] ?? []

describe('saveResponse: nothing locks', () => {
  it('records "I want to work this" without taking a spot', async () => {
    const db = world()
    expect(await saveResponse(db.sb, S, member(db, 'b'), 'p1', 'work', NOW)).toEqual({ kind: 'ok', response: 'work' })
    expect(rows(db, 'crew_party_responses')).toHaveLength(1)
    expect(rows(db, 'crew_party_responses')[0]).toMatchObject({ party_id: 'p1', member_id: 'b', response: 'work' })
    expect(rows(db, 'crew_slots').filter(s => s.member_id === 'b')).toHaveLength(0)
    expect(db.rpcCalls).toEqual([])
  })

  it('"add me as standby" is mirrored into the standby list the cover flow reads; changing it withdraws it', async () => {
    const db = world()
    await saveResponse(db.sb, S, member(db, 'b'), 'p1', 'standby', NOW)
    expect(rows(db, 'crew_standbys').filter(r => !r.withdrawn_at).map(r => r.member_id)).toEqual(['b'])
    await saveResponse(db.sb, S, member(db, 'b'), 'p1', 'unavailable', NOW)
    expect(rows(db, 'crew_standbys').filter(r => !r.withdrawn_at)).toHaveLength(0)
    expect(rows(db, 'crew_party_responses')[0].response).toBe('unavailable')
  })

  it('can be changed any number of times and taken back, and a double tap is harmless', async () => {
    const db = world()
    await saveResponse(db.sb, S, member(db, 'b'), 'p1', 'work', NOW)
    await saveResponse(db.sb, S, member(db, 'b'), 'p1', 'work', NOW)
    expect(rows(db, 'crew_party_responses')).toHaveLength(1)
    await saveResponse(db.sb, S, member(db, 'b'), 'p1', 'standby', NOW)
    expect(rows(db, 'crew_party_responses')[0].response).toBe('standby')
    expect(await saveResponse(db.sb, S, member(db, 'b'), 'p1', null, NOW)).toEqual({ kind: 'ok', response: null })
    expect(rows(db, 'crew_party_responses')).toHaveLength(0)
    expect(rows(db, 'crew_standbys').filter(r => !r.withdrawn_at)).toHaveLength(0)
  })

  it('refuses a party that is first come, closed, started, or one they are already on', async () => {
    const db = world({ parties: [party('fc', 12, { selection_mode: 'first_come' }), party('draft', 12, { status: 'draft' }), party('gone', -1)], slots: [slot('fc-c', 'fc', null), slot('draft-c', 'draft', null), slot('gone-c', 'gone', null)] })
    for (const id of ['fc', 'draft', 'gone']) expect((await saveResponse(db.sb, S, member(db, 'b'), id, 'work', NOW)).kind).toBe('refused')
    db.tables.crew_slots.find(s => s.id === 'p1-c1')!.member_id = 'b'
    db.tables.crew_slots.find(s => s.id === 'p1-c1')!.status = 'assigned'
    expect(await saveResponse(db.sb, S, member(db, 'b'), 'p1', 'work', NOW)).toMatchObject({ kind: 'refused', status: 409 })
    expect(rows(db, 'crew_party_responses')).toHaveLength(0)
  })

  it('"work" needs a spot they could take: none open, or only a Lead spot and they cannot lead', async () => {
    const db = world({ slots: [] })
    db.tables.crew_slots = [slot('l', 'p1', null, 'lead')]
    expect(await saveResponse(db.sb, S, member(db, 'b'), 'p1', 'work', NOW)).toMatchObject({ kind: 'refused', error: expect.stringMatching(/already filled/) })
    expect(await saveResponse(db.sb, S, member(db, 'a'), 'p1', 'work', NOW)).toEqual({ kind: 'ok', response: 'work' })
    // Standby (the manager's answer now, still accepted by the writer) and unavailable are allowed on a full party.
    db.tables.crew_slots = [slot('x', 'p1', 'c', 'crew')]
    expect(await saveResponse(db.sb, S, member(db, 'b'), 'p1', 'standby', NOW)).toEqual({ kind: 'ok', response: 'standby' })
  })

  it('"work" is refused for someone marked unavailable that day or working another party then, with the plain reason', async () => {
    const day = inDays(10).slice(0, 10)
    const blocked = world({ unavail: [{ member_id: 'b', day, part: 'all_day' }] })
    expect(await saveResponse(blocked.sb, S, member(blocked, 'b'), 'p1', 'work', NOW)).toMatchObject({ kind: 'refused', error: expect.stringMatching(/unavailable/i) })
    const busy = world({ parties: [party('p2', 10)], slots: [slot('p2-c', 'p2', 'b')] })
    expect(await saveResponse(busy.sb, S, member(busy, 'b'), 'p1', 'work', NOW)).toMatchObject({ kind: 'refused', error: expect.stringMatching(/another party/i) })
    // …but they can still say they are unavailable or on standby.
    expect((await saveResponse(busy.sb, S, member(busy, 'b'), 'p1', 'unavailable', NOW)).kind).toBe('ok')
  })

  it('the owner and a paused member cannot answer', async () => {
    const db = world({ members: [person('p', { status: 'paused' })] })
    expect((await saveResponse(db.sb, S, member(db, 'owner'), 'p1', 'work', NOW)).kind).toBe('refused')
    expect((await saveResponse(db.sb, S, member(db, 'p'), 'p1', 'work', NOW)).kind).toBe('refused')
  })
})

// ── Approving ───────────────────────────────────────────────────────────────

const opts = { actor: ACTOR, s: S, now: NOW }
const asked = (...ids: string[]) => ids.map(id => answer('p1', id, 'work'))

describe('approvePicks', () => {
  it('approves the recommendation, logs it as followed, and turns everyone else who asked into a standby once the party is full', async () => {
    const db = world(merge(worked('a', 'a', 5), worked('b', 'b', 40), { responses: asked('a', 'b', 'c', 'd') }))
    const panel = await loadPickPanel(db.sb, 'p1', S)
    if (panel.kind !== 'ok' || !panel.data) throw new Error('no panel')
    // c and d never worked, b worked 40 days ago, a worked 5 days ago.
    expect(panel.data.recommendation.map(r => r.memberId)).toEqual(['c', 'd'])
    const r = await approvePicks(db.sb, 'p1', panel.data.recommendation, opts)
    if (!r.ok) throw new Error(r.error)
    expect(r.result.assigned.map(a => a.memberId).sort()).toEqual(['c', 'd'])
    expect(rows(db, 'crew_slots').filter(s => s.party_id === 'p1' && s.status === 'assigned' && s.member_id !== 'owner').map(s => s.member_id).sort()).toEqual(['c', 'd'])
    expect(r.result.standbyMemberIds.sort()).toEqual(['a', 'b'])
    expect(rows(db, 'crew_party_responses').filter(x => x.response === 'standby').map(x => x.member_id).sort()).toEqual(['a', 'b'])
    expect(rows(db, 'crew_standbys').filter(x => !x.withdrawn_at).map(x => x.member_id).sort()).toEqual(['a', 'b'])
    expect(rows(db, 'crew_pick_log')).toHaveLength(2)
    expect(rows(db, 'crew_pick_log').every(l => l.overridden === false && l.decided_by === ACTOR)).toBe(true)
  })

  it('the manager can pick someone else; that is logged as an override with what was recommended', async () => {
    const db = world(merge(worked('a', 'a', 5), { responses: asked('a', 'c', 'd') }))
    const r = await approvePicks(db.sb, 'p1', [{ slotId: 'p1-c1', memberId: 'a' }, { slotId: 'p1-c2', memberId: 'd' }], opts)
    if (!r.ok) throw new Error(r.error)
    const log = rows(db, 'crew_pick_log')
    const forA = log.find(l => l.member_id === 'a')!
    expect(forA.overridden).toBe(true)
    expect(forA.recommended_member_id).toBe('c')
    expect(log.find(l => l.member_id === 'd')!.overridden).toBe(false)
    expect(r.result.standbyMemberIds).toEqual(['c'])
  })

  it('does NOT move people to standby while a spot is still open', async () => {
    const db = world({ responses: asked('a', 'b', 'c') })
    const r = await approvePicks(db.sb, 'p1', [{ slotId: 'p1-c1', memberId: 'b' }], opts)
    if (!r.ok) throw new Error(r.error)
    expect(r.result.assigned).toHaveLength(1)
    expect(r.result.standbyMemberIds).toEqual([])
    // a and c are still waiting on the open spot: nobody was turned into a standby (b keeps their own answer, and now holds the spot).
    expect(rows(db, 'crew_party_responses').filter(x => x.response === 'standby')).toHaveLength(0)
    expect(rows(db, 'crew_party_responses').filter(x => x.response === 'work').map(x => x.member_id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('a conflict is held for the manager to confirm, never silently double-booked, and nothing else moves', async () => {
    const day = inDays(10).slice(0, 10)
    const db = world({ responses: asked('b', 'c'), unavail: [{ member_id: 'b', day, part: 'all_day' }] })
    const r = await approvePicks(db.sb, 'p1', [{ slotId: 'p1-c1', memberId: 'b' }, { slotId: 'p1-c2', memberId: 'c' }], opts)
    if (!r.ok) throw new Error(r.error)
    expect(r.result.assigned.map(a => a.memberId)).toEqual(['c'])
    expect(r.result.flagged).toHaveLength(1)
    expect(r.result.flagged[0]).toMatchObject({ memberId: 'b', slotId: 'p1-c1' })
    expect(r.result.standbyMemberIds).toEqual([])
    // Confirmed, it goes through.
    const again = await approvePicks(db.sb, 'p1', [{ slotId: 'p1-c1', memberId: 'b' }], { ...opts, force: true })
    if (!again.ok) throw new Error(again.error)
    expect(again.result.assigned.map(a => a.memberId)).toEqual(['b'])
  })

  it("drops the approved person's requests for other parties that overlap, and says which", async () => {
    const db = world({
      parties: [party('p2', 10)], slots: [slot('p2-c', 'p2', null)],
      responses: [...asked('b'), answer('p2', 'b', 'work')],
    })
    const r = await approvePicks(db.sb, 'p1', [{ slotId: 'p1-c1', memberId: 'b' }], opts)
    if (!r.ok) throw new Error(r.error)
    expect(r.result.dropped).toEqual([{ memberName: 'B', partyTitle: 'Party p2' }])
    expect(rows(db, 'crew_party_responses').some(x => x.party_id === 'p2' && x.member_id === 'b')).toBe(false)
  })

  it("leaves a request for a party on another day alone", async () => {
    const db = world({ parties: [party('p3', 12)], slots: [slot('p3-c', 'p3', null)], responses: [...asked('b'), answer('p3', 'b', 'work')] })
    const r = await approvePicks(db.sb, 'p1', [{ slotId: 'p1-c1', memberId: 'b' }], opts)
    if (!r.ok) throw new Error(r.error)
    expect(r.result.dropped).toEqual([])
    expect(rows(db, 'crew_party_responses').some(x => x.party_id === 'p3' && x.member_id === 'b')).toBe(true)
  })

  it('refuses a pick missing its spot or person, and an unknown party', async () => {
    const db = world({ responses: asked('b') })
    const r = await approvePicks(db.sb, 'p1', [{ slotId: 'p1-c1' }], opts)
    if (!r.ok) throw new Error(r.error)
    expect(r.result.assigned).toEqual([])
    expect(r.result.failed).toHaveLength(1)
    expect(await approvePicks(db.sb, 'nope', [{ slotId: 'x', memberId: 'b' }], opts)).toMatchObject({ ok: false, status: 404 })
  })
})

describe('approveAllRecommended: one round, earliest first', () => {
  it('rotates within the batch: a person approved for the first party is "recent" when the second is ranked', async () => {
    // Two parties, a day apart, one crew spot each. b and c asked for both. They are tied, so b (joined first by name) gets the first;
    // for the second, c must now rank above b because b already holds the day before.
    const db = world({
      parties: [party('q1', 20), party('q2', 21)],
      slots: [slot('q1-c', 'q1', null), slot('q2-c', 'q2', null)],
      responses: [answer('q1', 'b', 'work'), answer('q1', 'c', 'work'), answer('q2', 'b', 'work'), answer('q2', 'c', 'work')],
    })
    // p1 (in 10 days) has no volunteers, so it is not part of the round.
    const out = await approveAllRecommended(db.sb, opts)
    if (!out.ok) throw new Error(out.error)
    expect(out.results).toHaveLength(2)
    const holder = (partyId: string) => rows(db, 'crew_slots').find(s => s.party_id === partyId && s.status === 'assigned')!.member_id
    expect(holder('q1')).toBe('b')
    expect(holder('q2')).toBe('c')
  })
})

// ── The messages ────────────────────────────────────────────────────────────

function tx(): CrewSenders & { sms: jest.Mock; email: jest.Mock } {
  return { sms: jest.fn(async () => 'quo-1'), email: jest.fn(async () => ({ kind: 'sent' as const, providerId: 're-1' })) } as any
}

describe('notifyPickRound', () => {
  const ENV = { ...process.env }
  beforeEach(() => { process.env = { ...ENV, CREW_ENABLED: 'true', CREW_SMS_ENABLED: 'false', CREW_ADMIN_EMAIL: 'alerts@example.test' } })
  afterAll(() => { process.env = ENV })

  it('tells each approved person their party, and each standby ONE message for the whole round', async () => {
    const db = world({
      parties: [party('q1', 20), party('q2', 21)], slots: [slot('q1-c', 'q1', null), slot('q2-c', 'q2', null)],
      responses: [answer('q1', 'b', 'work'), answer('q1', 'c', 'work'), answer('q2', 'b', 'work'), answer('q2', 'c', 'work'), answer('q2', 'd', 'work')],
    })
    const out = await approveAllRecommended(db.sb, opts)
    if (!out.ok) throw new Error(out.error)
    const t = tx()
    const told = await notifyPickRound({ sb: db.sb, now: NOW, senders: t }, S, out.results)
    expect(told.approved).toBe(2)
    const notes = rows(db, 'crew_notifications').filter(n => n.channel === 'in_app')
    expect(notes.filter(n => n.template === 'assigned')).toHaveLength(2)
    // c asked for both and was approved for neither... or one: whichever, a standby gets exactly one digest per round.
    const digests = notes.filter(n => n.template === 'pickStandby')
    const perMember = new Map<string, number>()
    for (const d of digests) perMember.set(d.member_id, (perMember.get(d.member_id) ?? 0) + 1)
    expect(Array.from(perMember.values()).every(n => n === 1)).toBe(true)
    expect(digests.length).toBeGreaterThan(0)
    // Never the owner.
    expect(notes.some(n => n.member_id === 'owner')).toBe(false)
  })

  it('says nothing to a real member while the crew app is off', async () => {
    process.env.CREW_ENABLED = 'false'
    const db = world({ responses: asked('b', 'c', 'd') })
    const r = await approvePicks(db.sb, 'p1', [{ slotId: 'p1-c1', memberId: 'b' }, { slotId: 'p1-c2', memberId: 'c' }], opts)
    if (!r.ok) throw new Error(r.error)
    await notifyPickRound({ sb: db.sb, now: NOW, senders: tx() }, S, [r.result])
    expect(rows(db, 'crew_notifications')).toHaveLength(0)
  })

  it('does not tell anyone twice if the round is replayed', async () => {
    const db = world({ responses: asked('b', 'c', 'd') })
    const r = await approvePicks(db.sb, 'p1', [{ slotId: 'p1-c1', memberId: 'b' }, { slotId: 'p1-c2', memberId: 'c' }], opts)
    if (!r.ok) throw new Error(r.error)
    const ctx = { sb: db.sb, now: NOW, senders: tx() }
    await notifyPickRound(ctx, S, [r.result])
    const n = rows(db, 'crew_notifications').length
    await notifyPickRound(ctx, S, [r.result])
    expect(rows(db, 'crew_notifications')).toHaveLength(n)
  })
})

// ── Approved without the manager ────────────────────────────────────────────

describe('runPickAutoApprove: nothing to choose between', () => {
  const ENV = { ...process.env }
  beforeEach(() => { process.env = { ...ENV, CREW_ENABLED: 'true', CREW_SMS_ENABLED: 'false', CREW_ADMIN_EMAIL: 'alerts@example.test' } })
  afterAll(() => { process.env = ENV })
  const jobs = (db: FakeCrewDb, now = NOW): JobsCtx => ({ sb: db.sb, now, senders: tx(), settings: S, scope: 'all' })
  const everyoneAnswered = (...extra: any[]) => [...['a', 'b', 'c', 'd', 'e'].map(id => answer('p1', id, 'unavailable')).filter(r => !extra.some(x => x.member_id === r.member_id)), ...extra]

  it('approves everyone who asked, once everyone has answered, when they all fit the open spots', async () => {
    const db = world({ responses: everyoneAnswered(answer('p1', 'b', 'work'), answer('p1', 'c', 'work')) })
    const out = await runPickAutoApprove(jobs(db))
    expect(out).toMatchObject({ approved: 2, unavailable: false })
    expect(rows(db, 'crew_slots').filter(s => s.party_id === 'p1' && s.status === 'assigned' && s.member_id !== 'owner').map(s => s.member_id).sort()).toEqual(['b', 'c'])
    expect(rows(db, 'crew_pick_log')).toHaveLength(2)
    // The manager hears in-app only (never an email), and the approved people are told.
    expect(rows(db, 'crew_notifications').filter(n => n.member_id === null).every(n => n.channel === 'in_app')).toBe(true)
    expect(rows(db, 'crew_notifications').some(n => n.template === 'assigned')).toBe(true)
  })

  it('does NOT approve at the first answer: somebody better placed might still ask', async () => {
    const db = world({ responses: [answer('p1', 'a', 'work')] })
    expect((await runPickAutoApprove(jobs(db))).approved).toBe(0)
    expect(rows(db, 'crew_slots').filter(s => s.member_id === 'a')).toHaveLength(0)
  })

  it('waits for the response window, and then approves even if some have not answered', async () => {
    const db = world({ responses: [answer('p1', 'a', 'work')] })
    db.tables.crew_parties[0].published_at = iso(NOW.getTime() - 47 * H)
    expect((await runPickAutoApprove(jobs(db))).approved).toBe(0)
    db.tables.crew_parties[0].published_at = iso(NOW.getTime() - 49 * H)
    expect((await runPickAutoApprove(jobs(db))).approved).toBe(1)
  })

  it('leaves it to the manager when more people asked than there are spots', async () => {
    const db = world({ responses: everyoneAnswered(answer('p1', 'b', 'work'), answer('p1', 'c', 'work'), answer('p1', 'd', 'work')) })
    expect((await runPickAutoApprove(jobs(db))).approved).toBe(0)
    expect(rows(db, 'crew_pick_log')).toHaveLength(0)
  })

  it('leaves it to the manager when the recommendation cannot cover everyone who asked (nobody who asked can take the open Lead spot)', async () => {
    const db = world({ slots: [] })
    db.tables.crew_slots = [slot('l', 'p1', null, 'lead')]
    db.tables.crew_party_responses.push(...everyoneAnswered(answer('p1', 'b', 'work')))
    expect((await runPickAutoApprove(jobs(db))).approved).toBe(0)
  })

  it('only acts on parties that are picked by the manager, published and ahead', async () => {
    const db = world({ responses: everyoneAnswered(answer('p1', 'b', 'work')) })
    db.tables.crew_parties[0].selection_mode = 'first_come'
    expect((await runPickAutoApprove(jobs(db))).approved).toBe(0)
    db.tables.crew_parties[0].selection_mode = 'pick'
    db.tables.crew_parties[0].status = 'draft'
    expect((await runPickAutoApprove(jobs(db))).approved).toBe(0)
  })
})

// ── What people are asked ───────────────────────────────────────────────────

describe('the asks on a picked party', () => {
  const ENV = { ...process.env }
  beforeEach(() => { process.env = { ...ENV, CREW_ENABLED: 'true', CREW_SMS_ENABLED: 'false', CREW_ADMIN_EMAIL: 'alerts@example.test' } })
  afterAll(() => { process.env = ENV })

  it('ask for an answer, not a claim: "tell us if you want to work it", never "claim a spot"', async () => {
    const db = world({ members: [] })
    db.tables.crew_party_responses = []
    const pws = [{ party: db.tables.crew_parties[0] as any, slots: db.tables.crew_slots as any[] }]
    const t = tx()
    const out = await runCrewAsks({ sb: db.sb, now: NOW, senders: t, settings: S, scope: 'all' }, pws)
    expect(out.newParty).toBeGreaterThan(0)
    const bodies = rows(db, 'crew_notifications').filter(n => n.channel === 'in_app').map(n => String(n.payload?.text ?? ''))
    expect(bodies.length).toBeGreaterThan(0)
    for (const b of bodies) {
      expect(b).toMatch(/available to work/i)
      expect(b).not.toMatch(/claim|take a spot|take the ones/i)
    }
  })
})

// ── The switch, and what it does not touch ──────────────────────────────────

describe('the switch', () => {
  const ENV = { ...process.env }
  afterEach(() => { process.env = ENV })

  it('a party is published as picked unless CREW_PICK_FLOW is explicitly false (every party works one way, 2026-11-07)', async () => {
    for (const [flag, want] of [['true', 'pick'], [undefined, 'pick'], ['TRUE', 'pick'], ['false', 'first_come']] as const) {
      process.env = { ...ENV }
      if (flag === undefined) delete process.env.CREW_PICK_FLOW
      else process.env.CREW_PICK_FLOW = flag
      const db = world()
      db.tables.crew_parties.push({ ...party('d1', 15, { status: 'draft', published_at: null, selection_mode: 'first_come' }) })
      db.tables.crew_slots.push(slot('d1-c', 'd1', null))
      expect(await publishParty(db.sb, 'd1', ACTOR, NOW)).toEqual({ ok: true })
      expect(db.tables.crew_parties.find(p => p.id === 'd1')!.selection_mode).toBe(want)
    }
  })

  it('first-come claiming is closed on a picked party, so nobody can beat the process', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'api', 'crew', 'claim', 'route.ts'), 'utf8')
    expect(src).toMatch(/party\.selection_mode === 'pick'[\s\S]{0,260}status: 409/)
    expect(src.indexOf("selection_mode === 'pick'")).toBeLessThan(src.indexOf('claimSlot(sb, slotId'))
    const standby = fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'api', 'crew', 'standby', 'route.ts'), 'utf8')
    expect(standby).toMatch(/selection_mode === 'pick'/)
  })
})

// ── The daily "you haven't answered" digest ─────────────────────────────────

describe('runPickDigest: one message a day for the parties someone has not answered', () => {
  const ENV = { ...process.env }
  beforeEach(() => { process.env = { ...ENV, CREW_ENABLED: 'true', CREW_SMS_ENABLED: 'false', CREW_ADMIN_EMAIL: 'alerts@example.test' } })
  afterAll(() => { process.env = ENV })
  const jobs = (db: FakeCrewDb, now = NOW): JobsCtx => ({ sb: db.sb, now, senders: tx(), settings: S, scope: 'all' })
  const OLD = iso(NOW.getTime() - 2 * DAY)
  const digests = (db: FakeCrewDb) => rows(db, 'crew_notifications').filter(n => n.template === 'pickDigest' && n.channel === 'in_app')
  const aged = (id: string, days: number, over: Record<string, unknown> = {}) => party(id, days, { published_at: OLD, ...over })

  it('texts each undecided person ONE message covering every party, soonest first, and never the owner', async () => {
    const db = world({ parties: [aged('q1', 12), aged('q2', 11)], slots: [slot('q1-c', 'q1', null), slot('q2-c', 'q2', null)] })
    db.tables.crew_parties[0].published_at = OLD            // p1
    const out = await runPickDigest(jobs(db))
    expect(out.unavailable).toBe(false)
    // a, b, c, d, e are all free and unanswered: five people, one message each, however many parties.
    expect(out.sent).toBe(5)
    expect(digests(db)).toHaveLength(5)
    expect(digests(db).some(n => n.member_id === 'owner')).toBe(false)
    const text = JSON.stringify(digests(db)[0])
    expect(text).toMatch(/3 parties/)
    expect(text.indexOf('Theme q2')).toBeLessThan(text.indexOf('Theme q1'))
  })

  it('sends once per day: a second tick the same day sends nothing, the next day sends again', async () => {
    const db = world({ parties: [aged('q1', 12)], slots: [slot('q1-c', 'q1', null)] })
    db.tables.crew_parties[0].published_at = OLD
    await runPickDigest(jobs(db))
    const n = digests(db).length
    expect(n).toBeGreaterThan(0)
    expect((await runPickDigest(jobs(db, new Date(NOW.getTime() + 2 * H)))).sent).toBe(0)
    expect(digests(db)).toHaveLength(n)
    expect((await runPickDigest(jobs(db, new Date(NOW.getTime() + DAY)))).sent).toBe(n)
  })

  it('leaves out anyone who has answered, anyone who holds a spot, and a party with nothing open', async () => {
    const db = world({
      parties: [aged('q1', 12), aged('q2', 11)], slots: [slot('q1-c', 'q1', null), slot('q2-c', 'q2', 'e')],
      responses: [answer('q1', 'b', 'work'), answer('q1', 'c', 'unavailable'), answer('q1', 'd', 'standby')],
    })
    db.tables.crew_parties.find(p => p.id === 'p1')!.published_at = OLD
    await runPickDigest(jobs(db))
    const who = digests(db).map(n => n.member_id).sort()
    // p1 still has open spots, q1 too: b, c, d answered q1 but not p1, so they hear about p1 only. e holds q2 (not eligible for it) and is asked about the rest.
    expect(who).toEqual(['a', 'b', 'c', 'd', 'e'])
    const forB = JSON.stringify(digests(db).find(n => n.member_id === 'b'))
    expect(forB).toMatch(/1 party/)
    expect(forB).not.toMatch(/Theme q1/)
  })

  it('waits for a new party to have been up a while, and for the morning', async () => {
    const fresh = world({ parties: [], slots: [] })                    // p1 went up an hour ago
    expect((await runPickDigest(jobs(fresh))).sent).toBe(0)
    const db = world({ parties: [aged('q1', 12)], slots: [slot('q1-c', 'q1', null)] })
    db.tables.crew_parties[0].published_at = OLD
    expect((await runPickDigest(jobs(db, new Date('2026-11-02T11:00:00Z')))).sent).toBe(0)   // 6 AM
    expect((await runPickDigest(jobs(db, new Date('2026-11-03T02:00:00Z')))).sent).toBe(0)   // 9 PM
  })

  it('does nothing for a first-come party, and sends nothing while the crew app is off', async () => {
    const db = world({ parties: [aged('q1', 12, { selection_mode: 'first_come' })], slots: [slot('q1-c', 'q1', null)] })
    db.tables.crew_parties[0].selection_mode = 'first_come'
    expect((await runPickDigest(jobs(db))).sent).toBe(0)
    process.env.CREW_ENABLED = 'false'
    const off = world({ parties: [aged('q1', 12)], slots: [slot('q1-c', 'q1', null)] })
    off.tables.crew_parties[0].published_at = OLD
    await runPickDigest(jobs(off))
    expect(rows(off, 'crew_notifications')).toHaveLength(0)
  })

  it('assigns nobody and changes no answer', async () => {
    const db = world({ parties: [aged('q1', 12)], slots: [slot('q1-c', 'q1', null)] })
    db.tables.crew_parties[0].published_at = OLD
    const before = JSON.stringify([rows(db, 'crew_slots'), rows(db, 'crew_party_responses')])
    await runPickDigest(jobs(db))
    expect(JSON.stringify([rows(db, 'crew_slots'), rows(db, 'crew_party_responses')])).toBe(before)
  })
})

// ── The tightened flow (Adam, 2026-11-07) ───────────────────────────────────

const srcOf = (...parts: string[]) => fs.readFileSync(path.join(process.cwd(), 'src', ...parts), 'utf8')

describe('the manager finalizes: on the party, or in the standby pool', () => {
  it('moveToStandby records standby as the answer and a live standby row, and takes them off the ranked list', async () => {
    const db = world(merge({ responses: asked('a', 'b') }))
    const r = await moveToStandby(db.sb, 'p1', 'a', NOW)
    expect(r).toMatchObject({ ok: true, result: { standbyMemberIds: ['a'], assigned: [] } })
    expect(rows(db, 'crew_party_responses').find(x => x.member_id === 'a')!.response).toBe('standby')
    expect(rows(db, 'crew_standbys').filter(x => !x.withdrawn_at).map(x => x.member_id)).toEqual(['a'])
    const panel = await loadPickPanel(db.sb, 'p1', S)
    if (panel.kind !== 'ok' || !panel.data) throw new Error('no panel')
    expect(panel.data.volunteers.map(v => v.memberId)).toEqual(['b'])
    expect(panel.data.standbys.map(x => x.memberId)).toEqual(['a'])
  })

  it('it changes no spot, and doing it twice is the same as once', async () => {
    const db = world(merge({ responses: asked('a') }))
    const before = JSON.stringify(rows(db, 'crew_slots'))
    await moveToStandby(db.sb, 'p1', 'a', NOW)
    expect((await moveToStandby(db.sb, 'p1', 'a', NOW)).ok).toBe(true)
    expect(JSON.stringify(rows(db, 'crew_slots'))).toBe(before)
    expect(rows(db, 'crew_standbys').filter(x => !x.withdrawn_at)).toHaveLength(1)
  })

  it('refuses someone already on the party, a party that has started, the owner, a paused member and a stranger', async () => {
    const held = world(merge({ slots: [slot('p1-x', 'p1', 'b')], responses: asked('b') }))
    expect(await moveToStandby(held.sb, 'p1', 'b', NOW)).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/on this party/i) })
    const over = world(merge({ responses: asked('a') }))
    over.tables.crew_parties[0].starts_at = iso(NOW.getTime() - H)
    expect(await moveToStandby(over.sb, 'p1', 'a', NOW)).toMatchObject({ ok: false, status: 409 })
    const db = world({ members: [person('p', { status: 'paused' })] })
    // Allie holds the Lead spot in this world, so she is refused as someone already on it.
    expect(await moveToStandby(db.sb, 'p1', 'owner', NOW)).toMatchObject({ ok: false, status: 409 })
    expect(await moveToStandby(db.sb, 'p1', 'p', NOW)).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/paused/) })
    expect(await moveToStandby(db.sb, 'p1', 'nobody', NOW)).toMatchObject({ ok: false, status: 404 })
    expect(await moveToStandby(db.sb, 'p1', undefined, NOW)).toMatchObject({ ok: false, status: 400 })
    expect(rows(db, 'crew_standbys')).toHaveLength(0)
  })

  it('the admin route has a standby action that sends one round of messages', () => {
    const src = srcOf('app', 'api', 'admin', 'crew', 'parties', '[id]', 'route.ts')
    expect(src).toMatch(/body\?\.action === 'standby'[\s\S]{0,400}moveToStandby\(sb, params\.id, body\.memberId, now\)[\s\S]{0,300}notifyPickRound/)
  })

  it('the ranked list gives each person Put on party and Standby, and the standby pool can be put on the party', () => {
    const page = srcOf('app', 'admin', 'crew', '_components', 'CrewPartyEditor.tsx')
    expect(page).toContain('Put on party')
    expect(page).toMatch(/onStandby\(v\.memberId, v\.name\)/)
    expect(page).toMatch(/action: 'standby', memberId/)
    expect(page).toContain('Standby pool')
    // No "Not confirmed" label with nothing to do about it.
    expect(page).not.toMatch(/Not confirmed/)
  })
})

describe('being assigned is the confirmation', () => {
  it('assignMember stamps confirmed_at from the assignment itself, so nothing is left "needing acceptance"', async () => {
    const db = world()
    expect(await assignMember(db.sb, 'p1', { slotId: 'p1-c1', memberId: 'b' }, ACTOR, S)).toEqual({ ok: true })
    const slotRow = rows(db, 'crew_slots').find(x => x.id === 'p1-c1')!
    expect(slotRow).toMatchObject({ status: 'assigned', member_id: 'b' })
    expect(slotRow.confirmed_at).toBeTruthy()
    expect(slotRow.confirmed_at).toBe(slotRow.assigned_at)
  })

  it('approving from the ranked list confirms them too', async () => {
    const db = world(merge({ responses: asked('b', 'c') }))
    const r = await approvePicks(db.sb, 'p1', [{ slotId: 'p1-c1', memberId: 'b' }, { slotId: 'p1-c2', memberId: 'c' }], opts)
    if (!r.ok) throw new Error(r.error)
    expect(rows(db, 'crew_slots').filter(x => x.status === 'assigned' && x.member_id !== 'owner').every(x => !!x.confirmed_at)).toBe(true)
  })
})

describe('the crew see two answers, and the tick does not staff a party on its own', () => {
  it('Available to work and Not available are the only buttons; Add me as standby and the old wording are gone', () => {
    const src = srcOf('app', 'crew', '_components', 'ResponseButtons.tsx')
    expect(src).toContain("'Available to work'")
    expect(src).toContain("'Not available'")
    expect(src.match(/\bbtn\('/g)).toHaveLength(2)
    expect(src).not.toMatch(/Add me as standby|Add me to the waitlist|I want to work this/)
    expect(srcOf('app', 'crew', '_components', 'PartyCard.tsx')).toMatch(/<ResponseButtons partyId=\{v\.id\}/)
  })

  it('every picked-party text asks "available to work or not", never "stand by"', () => {
    const ref = { theme: 'Glow Party', dayLabel: 'Sat Nov 14', timeLabel: '1-4 PM', url: 'https://www.hosthampton.com/crew/parties/x' }
    const all = [templates.newPartyPick(ref), templates.pickReminder(ref), templates.partiesDigestPick(2, ref.url), templates.pickDigest('Ava', [{ theme: 'Glow', dayLabel: 'Sat' }], 0, ref.url)]
    for (const m of all) {
      for (const body of [m.sms, m.email.text, m.inApp]) {
        expect(body).toMatch(/available/i)
        expect(body).not.toMatch(/stand by|can't, or|want to work it/i)
      }
    }
  })

  it('the tick approving a recommendation by itself is OFF unless CREW_PICK_AUTOAPPROVE is exactly true', () => {
    const ENV = process.env
    try {
      for (const [v, want] of [[undefined, false], ['false', false], ['TRUE', false], ['true', true]] as const) {
        process.env = { ...ENV }
        if (v === undefined) delete process.env.CREW_PICK_AUTOAPPROVE
        else process.env.CREW_PICK_AUTOAPPROVE = v
        expect(crewPickAutoApproveEnabled()).toBe(want)
      }
    } finally { process.env = ENV }
    expect(srcOf('lib', 'crew', 'jobs.ts')).toMatch(/if \(crewPickAutoApproveEnabled\(\)\) \{\s*const pk = await runPickAutoApprove\(ctx\)/)
  })
})
