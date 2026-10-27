/**
 * Phase 3 admin: the rules and roster screens, and Allie's writes on a party.
 *
 * Driven against `fakeCrewDb`, with `crew_admin_assign` and
 * `crew_admin_set_steps` standing in for migration 077's functions (the real
 * ones are proven against production by scripts/crew/race-test.mjs).
 */
jest.mock('@/lib/crew/mail', () => ({ sendCrewEmail: jest.fn(async () => ({ kind: 'sent', providerId: 'p1' })) }))

import { SETTING_SECTIONS, crewPhoneE164, screenCrewSetting, screenMemberInput, prefillFromApplication } from '@/lib/crew/adminForms'
import { DEFAULT_SETTINGS, settingsFromRows } from '@/lib/crew/rules'
import {
  addSpot, assignMember, publishParty, removeSpot, setPartyFields, setSlotsOverride, unassignMember, unpublishParty, createManualParty,
} from '@/lib/crew/adminActions'
import { createMember, inviteMember, loadRoster, overrideSteps, updateMember } from '@/lib/crew/adminMembers'
import { loadAdminOverview } from '@/lib/crew/admin'
import { sendCrewEmail } from '@/lib/crew/mail'
import { fakeCrewDb, fakeAdminAssign, type FakeCrewDb } from '../../helpers/fakeCrewDb'

const S = DEFAULT_SETTINGS
const NOW = new Date('2026-10-27T12:00:00Z')
const ACTOR = 'admin:allie@example.test'

// ── Rules ───────────────────────────────────────────────────────────────────

const PAY = { crew_start_cents: 5100, lead_start_cents: 7000, step_cents: 250, max_steps: 8, tip_floor_cents: 2000 }
const CONF = { request_hours_before: 120, reminder_hours_before: 96, due_hours_before: 72, day_before_hours: 24 }

describe('screenCrewSetting', () => {
  it('has one section per seeded crew_settings key, and nothing else', () => {
    expect(SETTING_SECTIONS.map(s => s.key).sort()).toEqual(
      ['attendance', 'availability', 'confirmations', 'drops', 'launch', 'lead', 'pay', 'shift', 'slots_by_guests', 'steps'])
  })

  it('accepts the seed values, and what it accepts reads back unchanged through settingsFromRows', () => {
    const r = screenCrewSetting('pay', PAY)
    expect(r).toEqual({ ok: true, value: PAY })
    expect(settingsFromRows([{ key: 'pay', value: (r as any).value }]).pay).toEqual(
      { crewStartCents: 5100, leadStartCents: 7000, stepCents: 250, maxSteps: 8, tipFloorCents: 2000 })
    expect(screenCrewSetting('confirmations', CONF).ok).toBe(true)
    expect(screenCrewSetting('drops', { late_drop_days: 7, standby_window_hours: 1.5, unclaimed_warning_hours: 48 }).ok).toBe(true)
    expect(screenCrewSetting('steps', { worked: 1, covered: 2, early_release: -1 }).ok).toBe(true)
  })

  it.each([
    ['a negative', 'pay', { ...PAY, crew_start_cents: -100 }],
    ['max_steps past 8', 'pay', { ...PAY, max_steps: 9 }],
    ['a fractional step count', 'pay', { ...PAY, max_steps: 7.5 }],
    ['a missing field', 'pay', { crew_start_cents: 5100 }],
    ['an unknown field', 'pay', { ...PAY, bonus: 1 }],
    ['a string number', 'pay', { ...PAY, step_cents: '250' }],
    ['min_slots over max_slots', 'slots_by_guests', { min_slots: 5, kids_per_crew: 4, max_slots: 4 }],
    ['kids_per_crew of 0', 'slots_by_guests', { min_slots: 3, kids_per_crew: 0, max_slots: 10 }],
    ['the reminder not before the request', 'confirmations', { ...CONF, reminder_hours_before: 120 }],
    ['the deadline after the reminder', 'confirmations', { ...CONF, due_hours_before: 100 }],
    ['the day-before after the deadline', 'confirmations', { ...CONF, day_before_hours: 80 }],
    ['an early release that ADDS a step', 'steps', { worked: 1, covered: 2, early_release: 1 }],
    ['an impossible launch date', 'launch', { launch_date: '2026-02-30', grace_days: 60 }],
    ['a bare-month launch date', 'launch', { launch_date: '2026-11', grace_days: 60 }],
    ['availability reminder after the due day', 'availability', { reminder_day_of_month: 16, due_day_of_month: 15 }],
    ['a warning outside the late-cancel window', 'drops', { late_drop_days: 1, standby_window_hours: 2, unclaimed_warning_hours: 48 }],
    ['an unknown key', 'bonus', { x: 1 }],
  ])('refuses %s, never clamps it', (_label, key, value) => {
    expect(screenCrewSetting(key, value).ok).toBe(false)
  })

  it('names the bound it refused on, rather than leaving it to the round-trip backstop', () => {
    expect(screenCrewSetting('pay', { ...PAY, max_steps: 9 })).toEqual({ ok: false, error: 'Most steps: between 0 and 8.' })
    expect(screenCrewSetting('pay', { ...PAY, crew_start_cents: -100 })).toEqual({ ok: false, error: 'Crew start: between 0 and 100000.' })
    expect(screenCrewSetting('slots_by_guests', { min_slots: 5, kids_per_crew: 4, max_slots: 4 }))
      .toEqual({ ok: false, error: 'Minimum crew cannot be more than the maximum.' })
  })

  it('takes a launch date or blank for not launched', () => {
    expect(screenCrewSetting('launch', { launch_date: '2026-11-01', grace_days: 60 })).toEqual({ ok: true, value: { launch_date: '2026-11-01', grace_days: 60 } })
    expect(screenCrewSetting('launch', { launch_date: '', grace_days: 60 })).toEqual({ ok: true, value: { launch_date: null, grace_days: 60 } })
  })
})

describe('crewPhoneE164', () => {
  it.each([
    ['(631) 555-0101', '+16315550101'],
    ['1-631-555-0101', '+16315550101'],
    ['+1 631 555 0101', '+16315550101'],
    ['', null],
  ])('%s → %s', (raw, out) => expect(crewPhoneE164(raw)).toEqual({ ok: true, phone: out }))

  it.each(['555-0101', '031-555-0101', '44 20 7946 0958', '631-555-01012'])('refuses %s', raw => {
    expect(crewPhoneE164(raw).ok).toBe(false)
  })
})

describe('screenMemberInput', () => {
  it('create needs a first name and takes a starting step within the max', () => {
    expect(screenMemberInput({}, { kind: 'create' }).ok).toBe(false)
    const r = screenMemberInput({ first_name: ' Ava ', phone: '631 555 0101', steps: 3, skills: ['Nails', 'Juggling'] }, { kind: 'create' })
    expect(r).toMatchObject({ ok: true, startingSteps: 3, row: { first_name: 'Ava', phone: '+16315550101', skills: ['Nails', 'Juggling'] } })
    expect(screenMemberInput({ first_name: 'Ava', steps: 9 }, { kind: 'create' }).ok).toBe(false)
  })

  it("refuses everything on Allie's row but her name, notes and skills", () => {
    const owner = { kind: 'edit' as const, isOwner: true, hasPhone: false }
    for (const body of [{ steps: 2 }, { status: 'removed' }, { email: 'a@b.co' }, { phone: '6315550101' }, { sms_opt_in: true }, { can_lead: false }]) {
      expect(screenMemberInput(body, owner).ok).toBe(false)
    }
    expect(screenMemberInput({ first_name: 'Allie', admin_notes: 'me' }, owner).ok).toBe(true)
  })

  it('edit never takes steps (that is the override, with a reason)', () => {
    expect(screenMemberInput({ steps: 4 }, { kind: 'edit', isOwner: false, hasPhone: true }).ok).toBe(false)
  })

  it('texts need a phone, and taking the phone away takes the texts with it', () => {
    expect(screenMemberInput({ sms_opt_in: true }, { kind: 'edit', isOwner: false, hasPhone: false }).ok).toBe(false)
    const r = screenMemberInput({ phone: '' }, { kind: 'edit', isOwner: false, hasPhone: true })
    expect(r).toMatchObject({ ok: true, row: { phone: null, sms_opt_in: false } })
  })

  it('prefills from an application without inventing anything', () => {
    expect(prefillFromApplication({ id: 'a1', name: 'Ava  Marie Test', email: ' ava@example.test ', phone: '(631) 555-0101', role_interest: 'lead' }))
      .toEqual({ first_name: 'Ava', last_name: 'Marie Test', email: 'ava@example.test', phone: '+16315550101', can_lead: true, job_application_id: 'a1' })
  })
})

// ── A party ─────────────────────────────────────────────────────────────────

const P = 'party-1'
const START = '2026-11-07T17:00:00.000Z'
const END = '2026-11-07T19:00:00.000Z'

function rpc(fn: string, args: any, db: FakeCrewDb) {
  if (fn === 'crew_admin_set_steps') {
    const m = db.tables.crew_members.find(r => r.id === args.p_member_id)
    if (!m || !String(args.p_reason ?? '').trim()) return { data: 'invalid', error: null }
    if (m.is_owner) return { data: 'owner', error: null }
    if (m.steps !== args.p_expected_steps) return { data: 'stale', error: null }
    ;(db.tables.crew_events ??= []).push({ member_id: m.id, type: 'admin_adjustment', step_before: m.steps, step_after: args.p_steps_after, metadata: { kind: 'step_override', reason: args.p_reason }, created_by: args.p_actor })
    m.steps = args.p_steps_after
    return { data: 'set', error: null }
  }
  return fakeAdminAssign(fn, args, db)
}

function partyDb(extra: { parties?: any[]; slots?: any[]; members?: any[]; unavail?: any[] } = {}) {
  return fakeCrewDb({
    crew_members: [
      { id: 'owner', first_name: 'Allie', last_name: null, status: 'active', can_lead: true, is_owner: true, is_test: false, steps: 0, needs_review: false, email: null, phone: null, skills: [], job_application_id: null },
      { id: 'ava', first_name: 'Ava', last_name: 'T', status: 'active', can_lead: true, is_owner: false, is_test: false, steps: 3, needs_review: false, email: 'ava@example.test', phone: null, skills: [], job_application_id: null },
      { id: 'mia', first_name: 'Mia', last_name: 'T', status: 'active', can_lead: false, is_owner: false, is_test: false, steps: 0, needs_review: false, email: null, phone: null, skills: [], job_application_id: null },
      ...(extra.members ?? []),
    ],
    crew_parties: [
      { id: P, booking_id: null, party_kind: 'manual', title: 'Glow', theme: null, starts_at: START, ends_at: END, guest_count: 12, location: 'Studio', status: 'draft', published_at: null, slots_override: null, extra_flat_cents: 0, sync_flags: [], updated_at: '2026-10-01T00:00:00Z', created_at: '' },
      ...(extra.parties ?? []),
    ],
    crew_slots: [
      { id: 'lead', party_id: P, role: 'lead', status: 'open', member_id: null, confirmed_at: null, created_at: '1' },
      { id: 'c1', party_id: P, role: 'crew', status: 'open', member_id: null, confirmed_at: null, created_at: '2' },
      { id: 'c2', party_id: P, role: 'crew', status: 'open', member_id: null, confirmed_at: null, created_at: '3' },
      ...(extra.slots ?? []),
    ],
    crew_unavailability: [...(extra.unavail ?? [])],
    crew_recurring_blocks: [],
    crew_standbys: [],
    crew_swap_requests: [],
    crew_events: [],
    bookings: [],
    booking_payments: [],
    pricing_items: [],
  }, { rpc })
}

describe('assigning, including Allie as Lead', () => {
  it('Allie can be assigned as Lead, is confirmed at once, and counts toward staffed', async () => {
    const db = partyDb()
    expect(await assignMember(db.sb, P, { slotId: 'lead', memberId: 'owner' }, ACTOR, S)).toEqual({ ok: true })
    expect(db.rpcCalls).toEqual([{ fn: 'crew_admin_assign', args: { p_slot_id: 'lead', p_member_id: 'owner', p_actor: ACTOR } }])
    const lead = db.tables.crew_slots.find(s => s.id === 'lead')!
    expect(lead).toMatchObject({ status: 'assigned', member_id: 'owner', assigned_by: ACTOR })
    expect(lead.confirmed_at).toBeTruthy()

    const o = await loadAdminOverview(db.sb, NOW, S)
    if (o.kind !== 'ok') throw new Error(o.error)
    const row = o.data.parties.find(p => p.id === P)!
    expect(row).toMatchObject({ staffed: 1, needed: 3, leadFilled: true, unconfirmed: 0 })
    expect(row.crew).toEqual([{ firstName: 'Allie', role: 'lead', confirmed: true, isOwner: true }])
  })

  it('Allie is never counted as unconfirmed, even on a row that somehow lacks confirmed_at', async () => {
    const db = partyDb()
    Object.assign(db.tables.crew_slots.find(s => s.id === 'lead')!, { status: 'assigned', member_id: 'owner', confirmed_at: null })
    Object.assign(db.tables.crew_slots.find(s => s.id === 'c1')!, { status: 'assigned', member_id: 'ava', confirmed_at: null })
    const o = await loadAdminOverview(db.sb, NOW, S)
    if (o.kind !== 'ok') throw new Error(o.error)
    expect(o.data.parties.find(p => p.id === P)).toMatchObject({ staffed: 2, unconfirmed: 1 })
  })

  it('a member who cannot lead is refused the Lead spot before the database is asked', async () => {
    const db = partyDb()
    const r = await assignMember(db.sb, P, { slotId: 'lead', memberId: 'mia' }, ACTOR, S)
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(db.rpcCalls).toEqual([])
  })

  it('an overlapping party is a warning; force assigns anyway', async () => {
    const db = partyDb({
      parties: [{ id: 'p2', booking_id: null, party_kind: 'manual', title: 'Spa', starts_at: '2026-11-07T18:00:00.000Z', ends_at: '2026-11-07T20:00:00.000Z', status: 'published', sync_flags: [], updated_at: '' }],
      slots: [{ id: 'x', party_id: 'p2', role: 'crew', status: 'assigned', member_id: 'mia' }],
    })
    const r = await assignMember(db.sb, P, { slotId: 'c1', memberId: 'mia' }, ACTOR, S)
    expect(r).toMatchObject({ ok: false, status: 409, warnings: [expect.stringContaining('Spa')] })
    expect(db.rpcCalls).toEqual([])
    expect(await assignMember(db.sb, P, { slotId: 'c1', memberId: 'mia', force: true }, ACTOR, S)).toEqual({ ok: true })
  })

  it('a blocked day is a warning too', async () => {
    const db = partyDb({ unavail: [{ member_id: 'mia', day: '2026-11-07', part: 'all_day' }] })
    const r = await assignMember(db.sb, P, { slotId: 'c1', memberId: 'mia' }, ACTOR, S)
    expect(r).toMatchObject({ ok: false, warnings: [expect.stringContaining('unavailable')] })
  })

  it('unassigning reopens the spot and leaves a zero-change ledger note naming the admin', async () => {
    const db = partyDb()
    await assignMember(db.sb, P, { slotId: 'c1', memberId: 'ava' }, ACTOR, S)
    const realNow = Date.now
    Date.now = () => NOW.getTime()
    try {
      expect(await unassignMember(db.sb, P, 'c1', ACTOR)).toEqual({ ok: true })
    } finally {
      Date.now = realNow
    }
    expect(db.tables.crew_slots.find(s => s.id === 'c1')).toMatchObject({ status: 'open', member_id: null, assigned_by: null })
    expect(db.tables.crew_events).toEqual([expect.objectContaining({
      member_id: 'ava', type: 'admin_adjustment', step_before: 3, step_delta: 0, step_after: 3, created_by: ACTOR, metadata: { kind: 'admin_unassign', role: 'crew' },
    })])
    expect(db.tables.crew_members.find(m => m.id === 'ava')!.steps).toBe(3)
  })

  it('a spot with a live cover request is not unassigned', async () => {
    const db = partyDb()
    await assignMember(db.sb, P, { slotId: 'c1', memberId: 'ava' }, ACTOR, S)
    db.tables.crew_swap_requests.push({ id: 'sw', slot_id: 'c1', status: 'open' })
    expect(await unassignMember(db.sb, P, 'c1', ACTOR)).toMatchObject({ ok: false, status: 409 })
    expect(db.tables.crew_slots.find(s => s.id === 'c1')!.member_id).toBe('ava')
  })
})

describe('publish, spots and fields', () => {
  it('publishes a draft, and goes back to draft only while nobody is on it', async () => {
    const db = partyDb()
    expect(await publishParty(db.sb, P, ACTOR, NOW)).toEqual({ ok: true })
    expect(db.tables.crew_parties[0]).toMatchObject({ status: 'published', updated_by: ACTOR })
    expect(db.tables.crew_parties[0].published_at).toBeTruthy()
    expect(await publishParty(db.sb, P, ACTOR, NOW)).toMatchObject({ ok: false, status: 409 })

    await assignMember(db.sb, P, { slotId: 'c1', memberId: 'ava' }, ACTOR, S)
    expect(await unpublishParty(db.sb, P, ACTOR)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('Unassign them first') })
    expect(db.tables.crew_parties[0].status).toBe('published')

    db.tables.crew_slots.find(s => s.id === 'c1')!.status = 'open'
    db.tables.crew_slots.find(s => s.id === 'c1')!.member_id = null
    expect(await unpublishParty(db.sb, P, ACTOR)).toEqual({ ok: true })
    expect(db.tables.crew_parties[0]).toMatchObject({ status: 'draft', published_at: null })
  })

  it('a claim that lands between the check and the write puts the party straight back to published', async () => {
    const db = partyDb()
    await publishParty(db.sb, P, ACTOR, NOW)
    // A crew member claims c1 at the instant the party goes to draft.
    const sb = {
      ...db.sb,
      from: (t: string) => {
        const q = db.sb.from(t)
        if (t !== 'crew_parties') return q
        const update = q.update
        q.update = (p: any) => {
          if (p.status === 'draft') Object.assign(db.tables.crew_slots.find(s => s.id === 'c1')!, { status: 'assigned', member_id: 'ava' })
          return update(p)
        }
        return q
      },
    }
    expect(await unpublishParty(sb, P, ACTOR)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('claimed a spot just now') })
    expect(db.tables.crew_parties[0].status).toBe('published')
    expect(db.tables.crew_parties[0].published_at).toBeTruthy()
  })

  it('a count change loses to a concurrent write and adds nothing', async () => {
    const db = partyDb()
    const sb = {
      ...db.sb,
      from: (t: string) => {
        const q = db.sb.from(t)
        if (t !== 'crew_parties') return q
        const update = q.update
        q.update = (p: any) => {
          // Somebody else (a Sync) writes the party between our read and our write.
          if ('slots_override' in p) db.tables.crew_parties[0].updated_at = '2026-10-27T13:00:00Z'
          return update(p)
        }
        return q
      },
    }
    expect(await setSlotsOverride(sb, P, 5, ACTOR, S)).toMatchObject({ ok: false, status: 409 })
    expect(db.tables.crew_slots.filter(s => s.party_id === P)).toHaveLength(3)
    expect(db.tables.crew_parties[0].slots_override).toBeNull()
  })

  it('a party that has started is not published', async () => {
    const db = partyDb()
    expect(await publishParty(db.sb, P, ACTOR, new Date('2026-11-07T18:00:00Z'))).toMatchObject({ ok: false, status: 409 })
  })

  it('removes an open crew spot, never the Lead', async () => {
    const db = partyDb()
    expect(await removeSpot(db.sb, P, 'lead', ACTOR)).toMatchObject({ ok: false, status: 409 })
    expect(await removeSpot(db.sb, P, 'c2', ACTOR)).toEqual({ ok: true })
    expect(db.tables.crew_slots.find(s => s.id === 'c2')!.status).toBe('cancelled')
    expect(await addSpot(db.sb, P, ACTOR)).toEqual({ ok: true, role: 'crew' })
  })

  it('a studio rental has no Lead spot: an added spot is a crew spot, and no "no Lead" alert ever fires', async () => {
    const db = partyDb()
    Object.assign(db.tables.crew_parties[0], { party_kind: 'studio_rental', status: 'published', published_at: NOW.toISOString() })
    db.tables.crew_slots = db.tables.crew_slots.filter(s => s.role === 'crew')
    expect(await addSpot(db.sb, P, ACTOR)).toEqual({ ok: true, role: 'crew' })
    expect(db.tables.crew_slots.filter(s => s.party_id === P).every(s => s.role === 'crew')).toBe(true)
    expect(await setSlotsOverride(db.sb, P, 5, ACTOR, S)).toEqual({ ok: true, added: 2 })
    expect(db.tables.crew_slots.filter(s => s.party_id === P).every(s => s.role === 'crew')).toBe(true)

    // Two days out with nobody leading: a themed party alerts, a rental does not.
    const soon = new Date('2026-11-05T12:00:00Z')
    const rental = await loadAdminOverview(db.sb, soon, S)
    if (rental.kind !== 'ok') throw new Error(rental.error)
    expect(rental.data.alerts.filter(a => a.kind === 'no_lead')).toEqual([])
    db.tables.crew_parties[0].party_kind = 'manual'
    const themed = await loadAdminOverview(db.sb, soon, S)
    if (themed.kind !== 'ok') throw new Error(themed.error)
    expect(themed.data.alerts.filter(a => a.kind === 'no_lead')).toHaveLength(1)
  })

  it('a raised count adds the missing spots; a lowered one removes nothing', async () => {
    const db = partyDb()
    expect(await setSlotsOverride(db.sb, P, 5, ACTOR, S)).toEqual({ ok: true, added: 2 })
    expect(db.tables.crew_slots.filter(s => s.party_id === P && s.status !== 'cancelled')).toHaveLength(5)
    expect(await setSlotsOverride(db.sb, P, 2, ACTOR, S)).toEqual({ ok: true, added: 0 })
    expect(db.tables.crew_slots.filter(s => s.party_id === P && s.status !== 'cancelled')).toHaveLength(5)
    expect(await setSlotsOverride(db.sb, P, 11, ACTOR, S)).toMatchObject({ ok: false, status: 400 })
  })

  it('extra pay and notes are screened and record the admin', async () => {
    const db = partyDb()
    expect(await setPartyFields(db.sb, P, { extra_flat_cents: -1 }, ACTOR)).toMatchObject({ ok: false, status: 400 })
    expect(await setPartyFields(db.sb, P, { extra_flat_cents: 1000.5 }, ACTOR)).toMatchObject({ ok: false, status: 400 })
    expect(await setPartyFields(db.sb, P, { extra_flat_cents: 1500, notes_for_crew: '  Bring wristbands ' }, ACTOR)).toEqual({ ok: true })
    expect(db.tables.crew_parties[0]).toMatchObject({ extra_flat_cents: 1500, notes_for_crew: 'Bring wristbands', updated_by: ACTOR })
  })

  it('a party by hand is a draft with the formula spots, in Eastern time', async () => {
    const db = partyDb()
    const r = await createManualParty(db.sb, { title: 'Pop-up', date: '2026-11-21', start: '13:00', end: '15:30', guest_count: 14, location: 'Market' }, ACTOR, S, NOW)
    if (!r.ok) throw new Error(r.error)
    const p = db.tables.crew_parties.find(x => x.id === r.id)!
    expect(p).toMatchObject({ status: 'draft', party_kind: 'manual', booking_id: null, starts_at: '2026-11-21T18:00:00.000Z', ends_at: '2026-11-21T20:30:00.000Z', updated_by: ACTOR })
    expect(db.tables.crew_slots.filter(s => s.party_id === r.id).map(s => s.role).sort()).toEqual(['crew', 'crew', 'crew', 'lead'])
    expect((await createManualParty(db.sb, { title: 'x', date: '2026-10-01', start: '13:00', end: '14:00', location: 'y' }, ACTOR, S, NOW)).ok).toBe(false)
  })
})

describe('the roster', () => {
  const realEnv = process.env.CREW_ENABLED
  afterEach(() => { process.env.CREW_ENABLED = realEnv; (sendCrewEmail as jest.Mock).mockClear() })

  it('a starting step goes through crew_admin_set_steps, so the ledger records it', async () => {
    const db = partyDb()
    const r = await createMember(db.sb, { first_name: 'Zoe', email: 'zoe@example.test', steps: 2 }, ACTOR, S)
    if (!r.ok) throw new Error(r.error)
    const z = db.tables.crew_members.find(m => m.id === r.id)!
    expect(z).toMatchObject({ steps: 2, is_owner: false, updated_by: ACTOR })
    expect(db.rpcCalls).toEqual([{ fn: 'crew_admin_set_steps', args: expect.objectContaining({ p_member_id: r.id, p_expected_steps: 0, p_steps_after: 2, p_reason: 'Starting step', p_actor: ACTOR }) }])
  })

  it('the override needs a reason, and Allie is never given steps', async () => {
    const db = partyDb()
    expect(await overrideSteps(db.sb, 'ava', { steps: 5, reason: ' ' }, ACTOR, S)).toEqual({ ok: false, status: 400, error: 'A reason is required.' })
    expect(db.rpcCalls).toEqual([])
    expect(await overrideSteps(db.sb, 'ava', { steps: 9, reason: 'x' }, ACTOR, S)).toMatchObject({ ok: false, status: 400 })
    expect(await overrideSteps(db.sb, 'owner', { steps: 1, reason: 'x' }, ACTOR, S)).toMatchObject({ ok: false, status: 400 })
    expect(await overrideSteps(db.sb, 'ava', { steps: 5, reason: 'Covered three weekends' }, ACTOR, S)).toEqual({ ok: true })
    expect(db.tables.crew_members.find(m => m.id === 'ava')!.steps).toBe(5)
  })

  it("Allie's row cannot be removed or paused", async () => {
    const db = partyDb()
    expect(await updateMember(db.sb, 'owner', { status: 'removed' }, ACTOR, NOW)).toMatchObject({ ok: false, status: 400 })
    expect(db.tables.crew_members.find(m => m.id === 'owner')!.status).toBe('active')
  })

  it('pausing someone who is on an upcoming party is refused until they are taken off', async () => {
    const db = partyDb()
    await assignMember(db.sb, P, { slotId: 'c1', memberId: 'ava' }, ACTOR, S)
    expect(await updateMember(db.sb, 'ava', { status: 'paused' }, ACTOR, NOW)).toMatchObject({ ok: false, status: 409 })
    expect(await updateMember(db.sb, 'mia', { status: 'paused' }, ACTOR, NOW)).toEqual({ ok: true })
  })

  it('no invite goes out before launch (CREW_ENABLED off), and nothing is recorded', async () => {
    delete process.env.CREW_ENABLED
    const db = partyDb()
    expect(await inviteMember(db.sb, 'ava', NOW, ACTOR)).toMatchObject({ ok: false, status: 409 })
    expect(sendCrewEmail).not.toHaveBeenCalled()
    expect(db.tables.crew_notifications ?? []).toEqual([])
  })

  it('after launch an invite is claimed once a day, then sent', async () => {
    process.env.CREW_ENABLED = 'true'
    const db = partyDb()
    expect(await inviteMember(db.sb, 'ava', NOW, ACTOR)).toEqual({ ok: true })
    expect(await inviteMember(db.sb, 'ava', NOW, ACTOR)).toMatchObject({ ok: false, status: 409 })
    expect(sendCrewEmail).toHaveBeenCalledTimes(1)
    expect(db.tables.crew_notifications).toEqual([expect.objectContaining({ member_id: 'ava', channel: 'email', template: 'invite', status: 'sent', payload: { sent_by: ACTOR } })])
    expect(await inviteMember(db.sb, 'owner', NOW, ACTOR)).toMatchObject({ ok: false, status: 400 })
  })

  it('counts parties worked, no-shows and uncovered late cancels; lists hired applicants not yet on the crew', async () => {
    const db = partyDb()
    db.tables.crew_slots.push(
      { id: 'w1', party_id: 'old', role: 'crew', status: 'completed', member_id: 'ava' },
      { id: 'w2', party_id: 'old2', role: 'crew', status: 'no_show', member_id: 'ava' },
    )
    db.tables.crew_events.push({ member_id: 'ava', type: 'late_cancel_uncovered', waived_grace: false }, { member_id: 'ava', type: 'late_cancel_uncovered', waived_grace: true })
    db.tables.job_applications = [{ id: 'app1', application_ref: 'HHJ-0001', name: 'New Person', email: 'n@example.test', phone: '6315550199', role_interest: 'helper', status: 'hired' }]
    const r = await loadRoster(db.sb, S, NOW)
    if (r.kind !== 'ok') throw new Error(r.error)
    expect(r.data.members.find(m => m.id === 'ava')).toMatchObject({ partiesWorked: 1, noShows: 1, lateCancelsUncovered: 1, crewRateCents: 5850, leadRateCents: 7750 })
    expect(r.data.members[0]).toMatchObject({ id: 'owner', crewRateCents: 0 })
    expect(r.data.hired.map(h => h.id)).toEqual(['app1'])
  })
})
