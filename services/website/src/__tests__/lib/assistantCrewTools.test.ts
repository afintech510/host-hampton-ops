/**
 * Running the crew app from the Manager chat.
 *
 * What they pin: the reads never carry pay, a phone number or an email; every
 * change is a propose_* card that writes nothing; a conflict is shown on the card
 * and `force` is bound only when the card showed it; a member who is already on
 * the party, cannot lead or is paused is refused outright; the import card lists
 * exactly what the dry run would do; and Confirm replays the Crew page's own
 * admin route with the bound body.
 */
import fs from 'fs'
import path from 'path'
import { NextRequest } from 'next/server'
import { decomment } from '../helpers/sourceScan'

const mockCreate = jest.fn()
const mockPatch = jest.fn()
const mockSync = jest.fn()
const mockPicks = jest.fn()
jest.mock('@/app/api/admin/crew/parties/route', () => ({ POST: (...a: unknown[]) => mockCreate(...a) }))
jest.mock('@/app/api/admin/crew/parties/[id]/route', () => ({ PATCH: (...a: unknown[]) => mockPatch(...a), GET: jest.fn() }))
jest.mock('@/app/api/admin/crew/sync/route', () => ({ POST: (...a: unknown[]) => mockSync(...a) }))
jest.mock('@/app/api/admin/crew/picks/route', () => ({ POST: (...a: unknown[]) => mockPicks(...a), GET: jest.fn() }))
jest.mock('@/app/api/admin/parties/create/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/admin/parties/[id]/route', () => ({ POST: jest.fn(), PATCH: jest.fn() }))
jest.mock('@/app/api/plan/[ref]/pay-link/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/admin/sequences/enroll/route', () => ({ POST: jest.fn() }))

import { DEFAULT_SETTINGS } from '@/lib/crew/rules'
jest.mock('@/lib/crew/settings', () => ({
  ...jest.requireActual('@/lib/crew/settings'),
  loadCrewSettings: async () => ({ kind: 'ok', settings: jest.requireActual('@/lib/crew/rules').DEFAULT_SETTINGS }),
}))

const PARTY_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const SLOT_OPEN = 'cccccccc-0000-4000-8000-000000000001'
const SLOT_LEAD = 'cccccccc-0000-4000-8000-000000000002'
const SLOT_HELD = 'cccccccc-0000-4000-8000-000000000003'
const startsAt = '2026-12-12T19:00:00.000Z' // 2:00 PM ET
const endsAt = '2026-12-12T22:00:00.000Z' // 5:00 PM ET

const fit = (conflicts: string[] = [], overlapWith: string[] = []) => ({ conflicts, overlapWith })
const member = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, canLead: false, isOwner: false, isTest: false, fitCrew: fit(), fitLead: fit(['not_lead']), ...over,
})
let members = [
  member('m1', 'Jordan Sample'),
  member('m2', 'Riley Sample', { canLead: true, fitLead: fit() }),
  member('m3', 'Jordan Other'),
  member('m4', 'Casey Busy', { fitCrew: fit(['overlap'], ['Other Party']) }),
  member('m5', 'Sam Already', { fitCrew: fit(['on_party']) }),
  member('m6', 'Test Person', { isTest: true }),
]
let slots: Array<Record<string, unknown>> = []
let partyOver: Record<string, unknown> = {}
const detail = () => ({
  party: {
    id: PARTY_ID, booking_id: null, party_kind: 'in_studio_theme', title: 'Glow Party', theme: 'Glow', starts_at: startsAt, ends_at: endsAt, guest_count: 12,
    location: '295 Montauk Hwy', notes_for_crew: 'Bring the blue bin', slots_override: null, extra_flat_cents: 5000, status: 'draft', published_at: null,
    sync_flags: [], shift_starts_at: null, shift_ends_at: null, lead_starts_at: null, selection_mode: 'first_come', updated_at: 'x', created_at: 'x', ...partyOver,
  },
  booking: { id: 'b1', ref: 'HH-PTY-CREW1', status: 'approved' },
  about: null, slots, standbys: [], members, needed: slots.filter(s => s.status !== 'cancelled').length,
  staffed: slots.filter(s => s.memberId).length,
})
let overviewParties: Array<Record<string, unknown>> = []
jest.mock('@/lib/crew/admin', () => ({
  ...jest.requireActual('@/lib/crew/admin'),
  loadAdminParty: async (_sb: unknown, id: string) => ({ kind: 'ok', data: id === PARTY_ID ? detail() : null }),
  loadAdminOverview: async () => ({ kind: 'ok', data: { now: 'x', parties: overviewParties, alerts: [{ kind: 'understaffed', severity: 'warn', text: 'Glow Party needs 1 more', partyId: PARTY_ID }], sync: null, syncError: null, counts: { members: 5, canLead: 1, needsReview: 0 } } }),
}))
jest.mock('@/lib/crew/adminMembers', () => ({
  loadRoster: async () => ({
    kind: 'ok',
    data: {
      hired: [],
      members: [
        { id: 'm1', firstName: 'Jordan', lastName: 'Sample', email: 'jordan@example.com', phone: '6315550101', hasHourlyRate: true, canLead: false, isOwner: false, isTest: false, skills: ['balloons'], status: 'active', needsReview: false, emailOptIn: true, smsOptIn: true, adminNotes: 'secret note', jobApplicationId: null, joinedOn: '2026-01-01', partiesWorked: 4, noShows: 0, lateCancelsUncovered: 0, upcomingSpots: 1, onboarding: 'agreement_signed' },
        { id: 'm9', firstName: 'Paused', lastName: 'One', email: null, phone: null, hasHourlyRate: false, canLead: false, isOwner: false, isTest: false, skills: [], status: 'paused', needsReview: false, emailOptIn: false, smsOptIn: false, adminNotes: null, jobApplicationId: null, joinedOn: '2026-01-01', partiesWorked: 0, noShows: 0, lateCancelsUncovered: 0, upcomingSpots: 0, onboarding: 'added' },
      ],
    },
  }),
}))
let plan: Record<string, unknown> = {}
jest.mock('@/lib/crew/sync', () => ({
  ...jest.requireActual('@/lib/crew/sync'),
  reconcileCrewParties: async (a: { onlyBookingRef?: string }) => ({ kind: 'ok', plan: { ...plan, _asked: a.onlyBookingRef }, summary: {} }),
}))
let picksNeeded: Array<{ party: Record<string, unknown> }> = []
jest.mock('@/lib/crew/pick', () => ({
  ...jest.requireActual('@/lib/crew/pick'),
  partiesNeedingPicks: async () => ({ kind: 'ok', data: picksNeeded }),
  loadPickPanel: async () => ({ kind: 'ok', data: { recommendation: [{ role: 'crew', name: 'Jordan Sample' }] } }),
}))
jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({}) }))

import { runAssistantTool, ASSISTANT_TOOLS } from '@/lib/assistant/tools'
import { executeProposal } from '@/lib/assistant/execute'
import { CREW_TOOLS } from '@/lib/assistant/crewTools'

const NOW = new Date('2026-11-07T17:00:00Z')
const ctx = { actor: 'admin:test@example.com', now: NOW }

beforeAll(() => {
  process.env.ADMIN_SESSION_SECRET = 'crew-tools-secret'
  process.env.PORTAL_LINK_SIGNING_SECRET = 'crew-tools-portal'
})
beforeEach(() => {
  for (const m of [mockCreate, mockPatch, mockSync, mockPicks]) m.mockReset()
  delete process.env.CREW_ENABLED
  delete process.env.CREW_SMS_ENABLED
  partyOver = {}
  slots = [
    { id: SLOT_LEAD, role: 'lead', status: 'open', memberId: null, memberName: null, isOwner: false, confirmed: false, assignedVia: null, assignedBy: null, activeCover: null },
    { id: SLOT_OPEN, role: 'crew', status: 'open', memberId: null, memberName: null, isOwner: false, confirmed: false, assignedVia: null, assignedBy: null, activeCover: null },
    { id: SLOT_HELD, role: 'crew', status: 'assigned', memberId: 'm5', memberName: 'Sam Already', isOwner: false, confirmed: true, assignedVia: 'admin', assignedBy: 'x', activeCover: null },
  ]
  overviewParties = [{
    id: PARTY_ID, title: 'Glow Party', theme: 'Glow', kind: 'in_studio_theme', booked: true, childName: 'Kid', childAge: 7, parentName: 'Parent', food: 'pizza', cupcake: null,
    pick: null, startsAt, endsAt, guestCount: 12, status: 'draft', flags: ['needs_address'], needed: 3, staffed: 1, leadFilled: false, unconfirmed: 0, available: 3,
    crew: [{ firstName: 'Sam', role: 'crew', confirmed: true, isOwner: false }],
  }]
  plan = { creates: [], updates: [], cancels: [], needsTime: [], unclassified: [], rentalsWithoutHelper: [], reactivated: [], flagged: [] }
  picksNeeded = []
})

type Out = Awaited<ReturnType<typeof runAssistantTool>>
const detailOf = (o: Out, label: string) => o.proposal?.proposal.details.find(d => d.startsWith(`${label}: `))?.slice(label.length + 2)
const inputOf = (o: Out) => o.proposal!.proposal.input as Record<string, unknown>
const FUTURE = '2026-12-12'

describe('the reads never carry pay or contact details', () => {
  it('list_crew_parties shows the schedule and nothing private', async () => {
    const out = await runAssistantTool('list_crew_parties', { days: 42 }, ctx)
    const json = JSON.stringify(out.result)
    expect(json).toContain('Glow Party')
    expect(json).toContain(PARTY_ID)
    expect(json).toMatch(/1 of 3 filled/)
    expect(json).toContain('Glow Party needs 1 more')
    for (const bad of ['"Parent"', '"Kid"', 'extra_flat', 'hourly', 'phone', 'email']) expect(json).not.toContain(bad)
  })

  it('get_crew_party hides the party-level extra pay and every contact detail', async () => {
    const out = await runAssistantTool('get_crew_party', { party_id: PARTY_ID }, ctx)
    const json = JSON.stringify(out.result)
    expect(json).toContain('Bring the blue bin')
    expect(json).toContain('Sam Already')
    expect(json).not.toContain('Test Person')
    expect(json).not.toMatch(/extra_flat|5000|hourly|@|\b\d{3}[-. ]?\d{3}[-. ]?\d{4}\b/)
    expect(json).toMatch(/2:00 PM/)
  })

  it('list_crew_members returns names and capability, with no pay, notes, phone or email', async () => {
    const out = await runAssistantTool('list_crew_members', {}, ctx)
    const json = JSON.stringify(out.result)
    expect(json).toContain('Jordan Sample')
    expect(json).not.toContain('Paused One')
    for (const bad of ['jordan@example.com', '6315550101', 'secret note', 'hasHourlyRate', 'hourly', '"steps"']) expect(json).not.toContain(bad)
    expect(JSON.stringify((await runAssistantTool('list_crew_members', { include_inactive: true }, ctx)).result)).toContain('Paused One')
  })

  it('refuses a party id that is not a uuid or does not exist', async () => {
    expect((await runAssistantTool('get_crew_party', { party_id: 'glow' }, ctx)).isError).toBe(true)
    expect((await runAssistantTool('get_crew_party', { party_id: 'aaaaaaaa-0000-4000-8000-0000000000ff' }, ctx)).isError).toBe(true)
  })
})

describe('propose_crew_task', () => {
  it('uses the kind\'s usual hours, spots and the studio when only a date is given', async () => {
    const out = await runAssistantTool('propose_crew_task', { kind: 'clean_floor', date: FUTURE }, ctx)
    expect(out.proposal?.proposal.kind).toBe('crew_task')
    expect(inputOf(out)).toMatchObject({ kind: 'clean_floor', title: 'Clean Floor', date: FUTURE, start: '09:00', end: '11:00', spots: 1 })
    expect(detailOf(out, 'When')).toMatch(/9:00 AM/)
    expect(detailOf(out, 'Where')).toMatch(/Montauk/)
    expect(out.proposal?.proposal.details.join(' ')).toMatch(/DRAFT/)
  })

  it('takes a title, spots, hours and notes, and a party by hand keeps its kids count', async () => {
    const task = await runAssistantTool('propose_crew_task', { kind: 'party_setup', title: 'Organize the supply closet', date: FUTURE, start: '13:00', end: '15:30', spots: 3, notes_for_crew: 'Label the bins' }, ctx)
    expect(inputOf(task)).toMatchObject({ kind: 'party_setup', title: 'Organize the supply closet', spots: 3, notes_for_crew: 'Label the bins' })
    const party = await runAssistantTool('propose_crew_task', { kind: 'party', title: 'Pop-up party', date: FUTURE, start: '12:00', end: '14:00', guest_count: 14, location: '1 Example Rd' }, ctx)
    expect(inputOf(party)).toMatchObject({ kind: 'manual', guest_count: 14, location: '1 Example Rd' })
    expect(inputOf(party).spots).toBeUndefined()
  })

  it('refuses a bad kind, a past time, a backwards window, too many spots, and contact details in the notes', async () => {
    for (const patch of [
      { kind: 'mow_lawn' }, { date: '2026-11-01' }, { date: '2026-02-31' }, { start: '15:00', end: '14:00' }, { spots: 11 },
      { notes_for_crew: 'call 631-555-0100' }, { notes_for_crew: 'email me@example.com' }, { start: '9am' },
    ]) {
      const out = await runAssistantTool('propose_crew_task', { kind: 'clean_floor', date: FUTURE, ...patch }, ctx)
      expect(out.isError).toBe(true)
      expect(out.proposal).toBeUndefined()
    }
    expect((await runAssistantTool('propose_crew_task', { kind: 'party', date: FUTURE }, ctx)).isError).toBe(true) // no times, no title
  })
})

describe('propose_crew_import', () => {
  it('lists exactly what the dry run would create, update and cancel', async () => {
    plan = {
      ...plan,
      creates: [{ bookingRef: 'HH-PTY-IMP01', row: { title: 'Glow Party', party_kind: 'in_studio_theme', starts_at: startsAt, ends_at: endsAt }, roles: ['lead', 'crew'] }],
      updates: [{ bookingRef: 'HH-PTY-UPD01' }],
      cancels: [{ bookingRef: 'HH-PTY-CAN01' }],
    }
    const out = await runAssistantTool('propose_crew_import', {}, ctx)
    expect(out.proposal?.proposal.kind).toBe('crew_import')
    expect(detailOf(out, 'New drafts')).toMatch(/1 - Glow Party.*2 spots/)
    expect(detailOf(out, 'Updates')).toMatch(/^1/)
    expect(detailOf(out, 'Cancels')).toMatch(/queued, not sent/)
    expect(inputOf(out)).toEqual({})
  })

  it('narrows to one booking and says why when there is nothing to import', async () => {
    plan = { ...plan, creates: [{ bookingRef: 'HH-PTY-IMP01', row: { title: 'Glow', party_kind: 'mobile_party', starts_at: startsAt, ends_at: endsAt }, roles: ['lead'] }] }
    const one = await runAssistantTool('propose_crew_import', { booking_ref: 'HH-PTY-IMP01' }, ctx)
    expect(inputOf(one)).toEqual({ bookingRef: 'HH-PTY-IMP01' })
    plan = { ...plan, creates: [], needsTime: ['HH-PTY-NOTIME'] }
    const none = await runAssistantTool('propose_crew_import', { booking_ref: 'HH-PTY-NOTIME' }, ctx)
    expect(none.isError).toBe(true)
    expect(JSON.stringify(none.result)).toMatch(/no usable time/)
    expect((await runAssistantTool('propose_crew_import', { booking_ref: 'x; drop' }, ctx)).isError).toBe(true)
  })
})

describe('propose_crew_publish', () => {
  it('shows what publishing does and when it would be refused', async () => {
    const ok = await runAssistantTool('propose_crew_publish', { party_id: PARTY_ID, action: 'publish' }, ctx)
    expect(ok.proposal?.proposal.kind).toBe('crew_publish')
    expect(detailOf(ok, 'Result')).toMatch(/crew can see it/)
    expect(ok.proposal?.proposal.details.join(' ')).not.toMatch(/Would be refused/)
    partyOver = { status: 'published' }
    const again = await runAssistantTool('propose_crew_publish', { party_id: PARTY_ID, action: 'publish' }, ctx)
    expect(detailOf(again, 'Would be refused now')).toMatch(/only a draft/)
    const held = await runAssistantTool('propose_crew_publish', { party_id: PARTY_ID, action: 'unpublish' }, ctx)
    expect(detailOf(held, 'Would be refused now')).toMatch(/Sam Already/)
  })
})

describe('propose_crew_staff', () => {
  it('puts a free member on an open crew spot, bound to that spot, and says nobody is told on a draft', async () => {
    const out = await runAssistantTool('propose_crew_staff', { party_id: PARTY_ID, action: 'assign', member: 'Riley' }, ctx)
    expect(inputOf(out)).toMatchObject({ partyId: PARTY_ID, action: 'assign', slotId: SLOT_OPEN, memberId: 'm2', force: false })
    expect(detailOf(out, 'Conflicts')).toBe('none')
    expect(detailOf(out, 'Notice')).toMatch(/still a draft/)
  })

  it('a Lead goes on the Lead spot and only a member who can lead', async () => {
    const out = await runAssistantTool('propose_crew_staff', { party_id: PARTY_ID, action: 'assign', member: 'Riley Sample', role: 'lead' }, ctx)
    expect(inputOf(out).slotId).toBe(SLOT_LEAD)
    const no = await runAssistantTool('propose_crew_staff', { party_id: PARTY_ID, action: 'assign', member: 'Jordan Sample', role: 'lead' }, ctx)
    expect(no.isError).toBe(true)
    expect(JSON.stringify(no.result)).toMatch(/not a Party Lead/)
  })

  it('shows a conflict on the card and binds force only then', async () => {
    const out = await runAssistantTool('propose_crew_staff', { party_id: PARTY_ID, action: 'assign', member: 'Casey' }, ctx)
    expect(inputOf(out).force).toBe(true)
    expect(detailOf(out, 'Conflict')).toMatch(/another party at the same time.*Other Party.*anyway/)
  })

  it('refuses someone already on it, an unknown name and an ambiguous first name — drawing no card', async () => {
    for (const member of ['Sam Already', 'Nobody', 'Jordan', 'Test Person']) {
      const out = await runAssistantTool('propose_crew_staff', { party_id: PARTY_ID, action: 'assign', member }, ctx)
      expect(out.isError).toBe(true)
      expect(out.proposal).toBeUndefined()
    }
    expect(JSON.stringify((await runAssistantTool('propose_crew_staff', { party_id: PARTY_ID, action: 'assign', member: 'Jordan' }, ctx)).result)).toMatch(/Jordan Sample.*Jordan Other|Jordan Other.*Jordan Sample/)
  })

  it('refuses when there is no open spot of that kind', async () => {
    slots = slots.filter(s => s.id !== SLOT_OPEN)
    expect((await runAssistantTool('propose_crew_staff', { party_id: PARTY_ID, action: 'assign', member: 'Riley' }, ctx)).isError).toBe(true)
  })

  it('says what a published party does about messaging, following the switches', async () => {
    partyOver = { status: 'published' }
    const off = await runAssistantTool('propose_crew_staff', { party_id: PARTY_ID, action: 'assign', member: 'Riley' }, ctx)
    expect(detailOf(off, 'Notice')).toMatch(/switched OFF/)
    process.env.CREW_ENABLED = 'true'
    const on = await runAssistantTool('propose_crew_staff', { party_id: PARTY_ID, action: 'assign', member: 'Riley' }, ctx)
    expect(detailOf(on, 'Notice')).toMatch(/told by email.*texts are OFF/)
    process.env.CREW_SMS_ENABLED = 'true'
    expect(detailOf(await runAssistantTool('propose_crew_staff', { party_id: PARTY_ID, action: 'assign', member: 'Riley' }, ctx), 'Notice')).toMatch(/email and text/)
  })

  it('unassign finds the member\'s own spot, and warns about an open cover request', async () => {
    const out = await runAssistantTool('propose_crew_staff', { party_id: PARTY_ID, action: 'unassign', member: 'Sam' }, ctx)
    expect(inputOf(out)).toMatchObject({ action: 'unassign', slotId: SLOT_HELD, memberId: 'm5' })
    slots = slots.map(s => (s.id === SLOT_HELD ? { ...s, activeCover: { id: 'c1', status: 'open', reason: 'x', note: null, offeredToAllAt: null } } : s))
    const warned = await runAssistantTool('propose_crew_staff', { party_id: PARTY_ID, action: 'unassign', member: 'Sam' }, ctx)
    expect(detailOf(warned, 'Would be refused now')).toMatch(/cover request/)
    expect((await runAssistantTool('propose_crew_staff', { party_id: PARTY_ID, action: 'unassign', member: 'Riley' }, ctx)).isError).toBe(true)
  })
})

describe('propose_crew_shift, spots and notes', () => {
  it('shows current and new shift times and accepts "default"', async () => {
    const out = await runAssistantTool('propose_crew_shift', { party_id: PARTY_ID, crew_start: '13:15', lead_start: 'default' }, ctx)
    expect(inputOf(out)).toMatchObject({ partyId: PARTY_ID, crew_start: '13:15', lead_start: null })
    expect('end' in inputOf(out)).toBe(false)
    expect(detailOf(out, 'Crew arrive')).toMatch(/→ 1:15 PM/)
    expect(detailOf(out, 'Shift ends')).toMatch(/unchanged/)
    expect(detailOf(out, 'Lead arrives')).toMatch(/the usual/)
  })

  it('refuses nothing to change and a malformed time', async () => {
    expect((await runAssistantTool('propose_crew_shift', { party_id: PARTY_ID }, ctx)).isError).toBe(true)
    expect((await runAssistantTool('propose_crew_shift', { party_id: PARTY_ID, end: '5pm' }, ctx)).isError).toBe(true)
    partyOver = { status: 'cancelled' }
    expect((await runAssistantTool('propose_crew_shift', { party_id: PARTY_ID, end: '18:00' }, ctx)).isError).toBe(true)
  })

  it('spots: add, remove only an open crew spot, set the total', async () => {
    const add = await runAssistantTool('propose_crew_spots', { party_id: PARTY_ID, action: 'add' }, ctx)
    expect(detailOf(add, 'Spots after')).toBe('4')
    const rem = await runAssistantTool('propose_crew_spots', { party_id: PARTY_ID, action: 'remove' }, ctx)
    expect(inputOf(rem).slotId).toBe(SLOT_OPEN)
    slots = slots.filter(s => s.id !== SLOT_OPEN)
    expect((await runAssistantTool('propose_crew_spots', { party_id: PARTY_ID, action: 'remove' }, ctx)).isError).toBe(true)
    expect(inputOf(await runAssistantTool('propose_crew_spots', { party_id: PARTY_ID, action: 'set_total', total: 5 }, ctx)).total).toBe(5)
    expect((await runAssistantTool('propose_crew_spots', { party_id: PARTY_ID, action: 'set_total', total: 11 }, ctx)).isError).toBe(true)
  })

  it('notes show old and new and keep contact details out', async () => {
    const out = await runAssistantTool('propose_crew_notes', { party_id: PARTY_ID, notes: 'Park in the back' }, ctx)
    expect(detailOf(out, 'Now')).toBe('Bring the blue bin')
    expect(detailOf(out, 'New')).toBe('Park in the back')
    expect(detailOf(await runAssistantTool('propose_crew_notes', { party_id: PARTY_ID, notes: '' }, ctx), 'New')).toMatch(/cleared/)
    expect((await runAssistantTool('propose_crew_notes', { party_id: PARTY_ID, notes: 'text 6315550100' }, ctx)).isError).toBe(true)
  })
})

describe('propose_crew_approve_picks', () => {
  it('lists who each party would approve; refuses when nothing is waiting', async () => {
    expect((await runAssistantTool('propose_crew_approve_picks', {}, ctx)).isError).toBe(true)
    picksNeeded = [{ party: { id: PARTY_ID, title: 'Glow Party', starts_at: startsAt, ends_at: endsAt } }]
    const out = await runAssistantTool('propose_crew_approve_picks', {}, ctx)
    expect(out.proposal?.proposal.kind).toBe('crew_picks')
    expect(detailOf(out, 'Pick 1')).toMatch(/Glow Party.*Jordan Sample/)
    expect(detailOf(out, 'Notice')).toMatch(/OFF/)
  })
})

describe('Confirm replays the Crew page\'s own routes', () => {
  const req = () => new NextRequest('http://localhost/api/admin/assistant/confirm', { method: 'POST', headers: { authorization: 'Bearer x' } })
  const reply = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status })

  it('task → POST /crew/parties with the bound body', async () => {
    const out = await runAssistantTool('propose_crew_task', { kind: 'clean_floor', date: FUTURE }, ctx)
    mockCreate.mockImplementation(async () => reply({ ok: true, id: PARTY_ID }))
    const r = await executeProposal(req(), out.proposal!.proposal)
    expect(r.ok).toBe(true)
    expect(r.message).toMatch(/draft.*nobody has been told/)
    expect(r.links?.[0].url).toContain(`/admin/crew/parties/${PARTY_ID}`)
    expect(await (mockCreate.mock.calls[0][0] as NextRequest).json()).toEqual(inputOf(out))
  })

  it('assign → PATCH assign with force only when the card showed a conflict', async () => {
    mockPatch.mockImplementation(async () => reply({ ok: true }))
    const clean = await runAssistantTool('propose_crew_staff', { party_id: PARTY_ID, action: 'assign', member: 'Riley' }, ctx)
    await executeProposal(req(), clean.proposal!.proposal)
    expect(await (mockPatch.mock.calls[0][0] as NextRequest).json()).toEqual({ action: 'assign', slotId: SLOT_OPEN, memberId: 'm2' })
    const busy = await runAssistantTool('propose_crew_staff', { party_id: PARTY_ID, action: 'assign', member: 'Casey' }, ctx)
    await executeProposal(req(), busy.proposal!.proposal)
    expect(await (mockPatch.mock.calls[1][0] as NextRequest).json()).toMatchObject({ action: 'assign', force: true })
    expect(mockPatch.mock.calls[0][1]).toEqual({ params: { id: PARTY_ID } })
  })

  it('a refusal from the route comes back as the reason, with its warnings', async () => {
    mockPatch.mockImplementation(async () => reply({ error: 'Conflicts: assign anyway?', warnings: ['Casey has another party at the same time.'] }, 409))
    const out = await runAssistantTool('propose_crew_staff', { party_id: PARTY_ID, action: 'assign', member: 'Riley' }, ctx)
    const r = await executeProposal(req(), out.proposal!.proposal)
    expect(r.ok).toBe(false)
    expect(r.status).toBe(409)
    expect(r.message).toMatch(/Conflicts.*Casey has another party/)
  })

  it('publish, shift, spots, notes each send the matching PATCH', async () => {
    mockPatch.mockImplementation(async () => reply({ ok: true }))
    const sent = async (tool: string, input: Record<string, unknown>) => {
      mockPatch.mockClear()
      const out = await runAssistantTool(tool, input, ctx)
      expect((await executeProposal(req(), out.proposal!.proposal)).ok).toBe(true)
      return (mockPatch.mock.calls[0][0] as NextRequest).json()
    }
    expect(await sent('propose_crew_publish', { party_id: PARTY_ID, action: 'publish' })).toEqual({ action: 'publish' })
    expect(await sent('propose_crew_shift', { party_id: PARTY_ID, crew_start: '13:15', lead_start: 'default' })).toEqual({ action: 'shift', crew_start: '13:15', lead_start: null })
    expect(await sent('propose_crew_spots', { party_id: PARTY_ID, action: 'add' })).toEqual({ action: 'add_spot' })
    expect(await sent('propose_crew_spots', { party_id: PARTY_ID, action: 'remove' })).toEqual({ action: 'remove_spot', slotId: SLOT_OPEN })
    expect(await sent('propose_crew_spots', { party_id: PARTY_ID, action: 'set_total', total: 5 })).toEqual({ action: 'set_count', value: 5 })
    expect(await sent('propose_crew_notes', { party_id: PARTY_ID, notes: 'Park in the back' })).toEqual({ action: 'fields', notes_for_crew: 'Park in the back' })
  })

  it('import → POST sync (narrowed by ?booking=), picks → POST picks approve_all', async () => {
    plan = { ...plan, creates: [{ bookingRef: 'HH-PTY-IMP01', row: { title: 'Glow', party_kind: 'mobile_party', starts_at: startsAt, ends_at: endsAt }, roles: ['lead'] }] }
    mockSync.mockResolvedValue(reply({ ok: true, summary: { created: 1, updated: 0, cancelled: 0, alreadyThere: 0, errors: [] } }))
    const imp = await runAssistantTool('propose_crew_import', { booking_ref: 'HH-PTY-IMP01' }, ctx)
    const r = await executeProposal(req(), imp.proposal!.proposal)
    expect(r.ok).toBe(true)
    expect(r.message).toMatch(/1 new draft/)
    expect(new URL((mockSync.mock.calls[0][0] as NextRequest).url).searchParams.get('booking')).toBe('HH-PTY-IMP01')

    picksNeeded = [{ party: { id: PARTY_ID, title: 'Glow Party', starts_at: startsAt, ends_at: endsAt } }]
    mockPicks.mockResolvedValue(reply({ ok: true, parties: 1, approved: 2, standby: 1, held: [], dropped: [], told: 0 }))
    const picks = await runAssistantTool('propose_crew_approve_picks', {}, ctx)
    const p = await executeProposal(req(), picks.proposal!.proposal)
    expect(p.message).toMatch(/Approved 2 across 1 party/)
    expect(await (mockPicks.mock.calls[0][0] as NextRequest).json()).toEqual({ action: 'approve_all' })
  })
})

describe('the shape of the crew tools', () => {
  it('every crew write tool is a PROPOSE tool; the reads are named', () => {
    const writes = CREW_TOOLS.filter(t => t.name.startsWith('propose_'))
    expect(writes).toHaveLength(8)
    for (const t of writes) expect(t.description).toMatch(/^PROPOSE /)
    expect(CREW_TOOLS.filter(t => !t.name.startsWith('propose_')).map(t => t.name).sort()).toEqual(['get_crew_party', 'list_crew_members', 'list_crew_parties'])
    for (const t of CREW_TOOLS) expect(ASSISTANT_TOOLS.some(a => a.name === t.name)).toBe(true)
  })

  it('the crew modules never read pay columns or send anything', () => {
    const root = path.resolve(__dirname, '../..')
    for (const f of ['lib/assistant/crewTools.ts', 'lib/assistant/crewExecute.ts']) {
      const code = decomment(fs.readFileSync(path.join(root, f), 'utf8'))
      expect(code).not.toMatch(/hourly_rate|pay_cents|tip_cents|tip_topup|extra_flat_cents|step_at_pay|paid_method/)
      expect(code).not.toMatch(/\.(insert|update|upsert|delete)\(/)
      expect(code).not.toMatch(/sendCrew|notifyMember|sendEmail|sendSms|resend|twilio/i)
    }
  })

  it('the sync narrowing is by booking reference only and leaves the other lists alone', () => {
    const root = path.resolve(__dirname, '../..')
    const route = fs.readFileSync(path.join(root, 'app/api/admin/crew/sync/route.ts'), 'utf8')
    expect(route).toMatch(/\^\[A-Za-z0-9-\]\{3,40\}\$/)
    const lib = fs.readFileSync(path.join(root, 'lib/crew/sync.ts'), 'utf8')
    expect(lib).toMatch(/creates: full\.creates\.filter\(c => c\.bookingRef === onlyBookingRef\)/)
    expect(lib).toMatch(/cancels: full\.cancels\.filter\(c => c\.bookingRef === onlyBookingRef\)/)
  })

  it('has a default settings object to read shifts against', () => {
    expect(DEFAULT_SETTINGS).toBeTruthy()
  })
})
