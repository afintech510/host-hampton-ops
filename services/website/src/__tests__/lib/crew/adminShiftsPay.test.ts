/**
 * Crew manager screens, launch follow-up (2026-11-05):
 *   - the shift on a party is adjustable, with the Party Lead an hour early by default;
 *   - pay is per person per hour and is never shown (roster, dropdowns, API payloads);
 *   - the schedule lists the child and parent; the weekend list says what to prep.
 */
import fs from 'fs'
import path from 'path'
jest.mock('@/lib/crew/mail', () => ({ sendCrewEmail: jest.fn(async () => ({ kind: 'sent', providerId: 'p1' })) }))

import { DEFAULT_SETTINGS, shiftWindow, settingsFromRows } from '@/lib/crew/rules'
import { setPartyShift } from '@/lib/crew/adminActions'
import { screenMemberInput, screenCrewSetting } from '@/lib/crew/adminForms'
import { loadRoster, updateMember, createMember } from '@/lib/crew/adminMembers'
import { loadAdminOverview, loadAdminParty, shiftForAdmin } from '@/lib/crew/admin'
import { buildWeekendParty, upcomingWeekend, weekendTotals } from '@/lib/crew/weekendSummary'
import { partyView } from '@/lib/crew/view'
import { fakeAdminAssign, fakeCrewDb } from '../../helpers/fakeCrewDb'

const S = DEFAULT_SETTINGS
const ACTOR = 'admin:allie@example.test'
const NOW = new Date('2026-11-04T15:00:00Z') // Wed
// Sat Nov 7 2026, 1:00-4:00 PM Eastern (EST, UTC-5)
const START = '2026-11-07T18:00:00.000Z'
const END = '2026-11-07T21:00:00.000Z'
const P = 'p1'

const member = (id: string, over: Record<string, unknown> = {}) => ({
  id, first_name: id.toUpperCase(), last_name: null, email: null, phone: null, steps: 0, can_lead: false, is_owner: false, is_test: false,
  skills: [], status: 'active', needs_review: false, sms_opt_in: false, email_opt_in: false, admin_notes: null, job_application_id: null,
  joined_on: '2026-10-01', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', hourly_rate_cents: null, ...over,
})

function world(over: Record<string, unknown> = {}) {
  return fakeCrewDb({
    crew_members: [member('lexi', { can_lead: true, hourly_rate_cents: 2500 }), member('kat'), member('allie', { is_owner: true, can_lead: true })],
    crew_parties: [{
      id: P, booking_id: 'b1', party_kind: 'in_studio_theme', title: 'Glow Party', theme: 'Glow Party', starts_at: START, ends_at: END,
      guest_count: 12, location: 'Studio', status: 'published', published_at: '2026-10-20T00:00:00Z', slots_override: null, extra_flat_cents: 0,
      sync_flags: [], updated_at: '2026-10-20T00:00:00Z', created_at: '', shift_starts_at: null, shift_ends_at: null, lead_starts_at: null, ...over,
    }],
    crew_slots: [
      { id: 'lead', party_id: P, role: 'lead', status: 'open', member_id: null, confirmed_at: null, created_at: '1' },
      { id: 'c1', party_id: P, role: 'crew', status: 'open', member_id: null, confirmed_at: null, created_at: '2' },
    ],
    crew_unavailability: [], crew_recurring_blocks: [], crew_standbys: [], crew_swap_requests: [], crew_events: [], crew_notifications: [],
    crew_member_profiles: [], job_applications: [],
    bookings: [{ id: 'b1', booking_ref: 'HH-PTY-AAAAA', status: 'approved', party_type: 'in_studio_theme', child_name: 'Ava Rossi', child_age: 7, contact_name: 'Maria Rossi', sel_pizza_or_bagels: 'bagels', sel_cupcake_flavor: 'vanilla', sel_add_mobile_cupcakes: null }],
    booking_payments: [], pricing_items: [],
  }, { rpc: fakeAdminAssign })
}

describe('the shift defaults and overrides (rules.shiftWindow)', () => {
  const party = { starts_at: START, ends_at: END }
  it('crew 30 minutes before to 30 after; the Party Lead an hour before', () => {
    const crew = shiftWindow(party, 'crew', S)
    const lead = shiftWindow(party, 'lead', S)
    expect(crew.startsAt.toISOString()).toBe('2026-11-07T17:30:00.000Z')
    expect(crew.endsAt.toISOString()).toBe('2026-11-07T21:30:00.000Z')
    expect(lead.startsAt.toISOString()).toBe('2026-11-07T17:00:00.000Z')
    expect(lead.endsAt.toISOString()).toBe('2026-11-07T21:30:00.000Z')
    expect(S.shift.leadSetupMinutes).toBe(60)
  })
  it('Allie can move any of the three for one party; a lead override does not move the crew', () => {
    const p = { ...party, shift_starts_at: '2026-11-07T17:15:00.000Z', shift_ends_at: '2026-11-07T22:00:00.000Z', lead_starts_at: '2026-11-07T16:30:00.000Z' }
    expect(shiftWindow(p, 'crew', S).startsAt.toISOString()).toBe('2026-11-07T17:15:00.000Z')
    expect(shiftWindow(p, 'lead', S).startsAt.toISOString()).toBe('2026-11-07T16:30:00.000Z')
    expect(shiftWindow(p, 'crew', S).endsAt.toISOString()).toBe('2026-11-07T22:00:00.000Z')
    const leadOnly = { ...party, lead_starts_at: '2026-11-07T16:30:00.000Z' }
    expect(shiftWindow(leadOnly, 'crew', S).startsAt.toISOString()).toBe('2026-11-07T17:30:00.000Z')
  })
  it('an unreadable override falls back to the default, never to nothing', () => {
    const w = shiftWindow({ ...party, shift_starts_at: 'garbage' }, 'crew', S)
    expect(w.startsAt.toISOString()).toBe('2026-11-07T17:30:00.000Z')
    expect(w.customStart).toBe(false)
  })
  it('the lead minutes are a setting the rules page accepts and round-trips', () => {
    const r = screenCrewSetting('shift', { setup_minutes: 30, cleanup_minutes: 30, lead_setup_minutes: 90 })
    expect(r).toEqual({ ok: true, value: { setup_minutes: 30, cleanup_minutes: 30, lead_setup_minutes: 90 } })
    expect(settingsFromRows([{ key: 'shift', value: { setup_minutes: 30, cleanup_minutes: 30 } }]).shift.leadSetupMinutes).toBe(60)
  })
  it('the crew see their OWN time: a Lead earlier than a helper', () => {
    const base = { ...world().tables.crew_parties[0] } as never
    const slots = [
      { id: 'a', party_id: P, role: 'lead', status: 'assigned', member_id: 'lexi', confirmed_at: null },
      { id: 'b', party_id: P, role: 'crew', status: 'assigned', member_id: 'kat', confirmed_at: null },
    ] as never
    const view = (id: string) => partyView({ party: base, slots, viewer: { id, steps: 0, can_lead: id === 'lexi' }, firstNames: new Map(), standbyMemberIds: new Set() }, S)!
    expect(view('lexi').shiftStartsAt).toBe('2026-11-07T17:00:00.000Z')
    expect(view('kat').shiftStartsAt).toBe('2026-11-07T17:30:00.000Z')
  })
})

describe('setPartyShift', () => {
  const party = (db: ReturnType<typeof world>) => db.tables.crew_parties.find(p => p.id === P)!

  it('stores Eastern times on the party date as instants', async () => {
    const db = world()
    expect(await setPartyShift(db.sb, P, { crew_start: '12:15', end: '17:00', lead_start: '11:30' }, ACTOR)).toEqual({ ok: true })
    expect(party(db)).toMatchObject({
      shift_starts_at: '2026-11-07T17:15:00.000Z', shift_ends_at: '2026-11-07T22:00:00.000Z', lead_starts_at: '2026-11-07T16:30:00.000Z', updated_by: ACTOR,
    })
  })
  it('null puts the default back', async () => {
    const db = world({ shift_starts_at: '2026-11-07T17:15:00.000Z' })
    expect(await setPartyShift(db.sb, P, { crew_start: null }, ACTOR)).toEqual({ ok: true })
    expect(party(db).shift_starts_at).toBeNull()
  })
  it('refuses a start after the party begins, an end before it finishes, and nonsense', async () => {
    const db = world()
    expect(await setPartyShift(db.sb, P, { crew_start: '13:30' }, ACTOR)).toMatchObject({ ok: false, status: 400 })
    expect(await setPartyShift(db.sb, P, { lead_start: '14:00' }, ACTOR)).toMatchObject({ ok: false, status: 400 })
    expect(await setPartyShift(db.sb, P, { end: '15:30' }, ACTOR)).toMatchObject({ ok: false, status: 400 })
    expect(await setPartyShift(db.sb, P, { crew_start: '25:00' }, ACTOR)).toMatchObject({ ok: false, status: 400 })
    expect(await setPartyShift(db.sb, P, { crew_start: 'noon' }, ACTOR)).toMatchObject({ ok: false, status: 400 })
    expect(await setPartyShift(db.sb, P, {}, ACTOR)).toMatchObject({ ok: false, status: 400 })
    expect(party(db).shift_starts_at).toBeNull()
  })
  it('a shift that ends after midnight ends the NEXT day', async () => {
    const db = world({ starts_at: '2026-11-08T00:00:00.000Z', ends_at: '2026-11-08T03:00:00.000Z' }) // 7-10 PM ET Sat
    expect(await setPartyShift(db.sb, P, { end: '00:30' }, ACTOR)).toEqual({ ok: true })
    expect(party(db).shift_ends_at).toBe('2026-11-08T05:30:00.000Z')
  })
  it('a cancelled party cannot be changed', async () => {
    const db = world({ status: 'cancelled' })
    expect(await setPartyShift(db.sb, P, { end: '17:00' }, ACTOR)).toMatchObject({ ok: false, status: 409 })
  })
  it('the party page gets the times as Eastern HH:MM, and the defaults to compare against', async () => {
    expect(shiftForAdmin({ starts_at: START, ends_at: END, shift_starts_at: null, shift_ends_at: null, lead_starts_at: null }, S))
      .toEqual({ crewStart: '12:30', end: '16:30', leadStart: '12:00', defaults: { crewStart: '12:30', end: '16:30', leadStart: '12:00' } })
    const custom = shiftForAdmin({ starts_at: START, ends_at: END, shift_starts_at: '2026-11-07T17:15:00.000Z', shift_ends_at: null, lead_starts_at: null }, S)
    expect(custom).toMatchObject({ crewStart: '12:15', defaults: { crewStart: '12:30' } })
  })
})

describe('pay is private: per person, per hour, never shown', () => {
  it('the roster says WHETHER a rate is set and carries no figure, no step and no per-party rate', async () => {
    const db = world()
    const r = await loadRoster(db.sb, S, NOW)
    if (r.kind !== 'ok') throw new Error(r.error)
    const lexi = r.data.members.find(m => m.id === 'lexi')!
    expect(lexi.hasHourlyRate).toBe(true)
    expect(r.data.members.find(m => m.id === 'kat')!.hasHourlyRate).toBe(false)
    const json = JSON.stringify(r.data)
    expect(json).not.toContain('2500')
    expect(json).not.toMatch(/crewRateCents|leadRateCents|"steps"|hourly_rate/)
  })
  it('the party page dropdown choices carry no pay either', async () => {
    const db = world()
    const d = await loadAdminParty(db.sb, P, S)
    if (d.kind !== 'ok' || !d.data) throw new Error('party')
    const json = JSON.stringify(d.data.members)
    expect(json).not.toMatch(/Rate|rate|steps|2500|cents/)
    expect(d.data.members.length).toBeGreaterThan(0)
  })
  it('the rate can be set when adding or editing a person, within sane bounds', async () => {
    expect(screenMemberInput({ first_name: 'Kat', hourly_rate_cents: 2200 }, { kind: 'create' })).toMatchObject({ ok: true, row: { hourly_rate_cents: 2200 } })
    for (const bad of [-1, 20001, 22.5, '22', null]) {
      expect(screenMemberInput({ first_name: 'Kat', hourly_rate_cents: bad }, { kind: 'create' }).ok).toBe(false)
    }
    // Allie is never paid: the owner row accepts no rate.
    expect(screenMemberInput({ hourly_rate_cents: 2000 }, { kind: 'edit', isOwner: true, hasPhone: false }).ok).toBe(false)
    const db = world()
    expect(await updateMember(db.sb, 'kat', { hourly_rate_cents: 2100 }, ACTOR, NOW)).toEqual({ ok: true })
    expect(db.tables.crew_members.find(m => m.id === 'kat')!.hourly_rate_cents).toBe(2100)
    const made = await createMember(db.sb, { first_name: 'Zoe', hourly_rate_cents: 1900 }, ACTOR, S)
    expect(made.ok).toBe(true)
  })
  it('saving the form without typing a rate leaves the stored one alone', async () => {
    const db = world()
    expect(await updateMember(db.sb, 'lexi', { admin_notes: 'x' }, ACTOR, NOW)).toEqual({ ok: true })
    expect(db.tables.crew_members.find(m => m.id === 'lexi')!.hourly_rate_cents).toBe(2500)
  })
  const SRC = path.join(process.cwd(), 'src')
  const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8')
  it('the roster page has no step box and no rate column; the party page prints no money beside a name', () => {
    const roster = read('app/admin/crew/members/page.tsx')
    expect(roster).not.toMatch(/Set their step|StepOverride|Starting step|crewRateCents|leadRateCents|money\(/)
    expect(roster).toMatch(/Pay per hour/)
    const party = read('app/admin/crew/_components/CrewPartyEditor.tsx')
    expect(party).not.toMatch(/RateCents/)
    const opt = party.slice(party.indexOf('<option key={m.id}'), party.indexOf('</option>', party.indexOf('<option key={m.id}')))
    expect(opt).not.toMatch(/money\(|RateCents|\$\d/)
  })
  it('only the admin member editor reads the rate column; no crew route or page selects it', () => {
    const users: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(p) }
        else if (/\.tsx?$/.test(e.name) && /hourly_rate_cents/.test(fs.readFileSync(p, 'utf8'))) users.push(path.relative(SRC, p).split(path.sep).join('/'))
      }
    }
    walk(SRC)
    const crewUsers = users.filter(u => /crew/i.test(u)).sort()
    expect(crewUsers).toEqual(['app/admin/crew/members/page.tsx', 'lib/crew/adminForms.ts', 'lib/crew/adminMembers.ts'])
    expect(crewUsers.every(u => u.startsWith('lib/crew/admin') || u.startsWith('app/admin/'))).toBe(true)
    expect(crewUsers.some(u => u.startsWith('app/crew/') || u.startsWith('app/api/crew/'))).toBe(false)
  })
})

describe('the schedule list names the child and the parent', () => {
  it('first names only, the age and the food — never a surname or the booking reference — and nothing for a party made by hand', async () => {
    const db = world()
    db.tables.crew_parties.push({ ...db.tables.crew_parties[0], id: 'p2', booking_id: null, party_kind: 'manual', title: 'By hand', starts_at: '2026-11-08T18:00:00.000Z', ends_at: '2026-11-08T21:00:00.000Z' })
    const o = await loadAdminOverview(db.sb, NOW, S)
    if (o.kind !== 'ok') throw new Error(o.error)
    const booked = o.data.parties.find(p => p.id === P)!
    expect(booked).toMatchObject({ booked: true, childName: 'Ava', childAge: 7, parentName: 'Maria', food: 'Bagels', cupcake: 'Vanilla (default)' })
    // Nothing on the row can print the booking id or a surname.
    expect(JSON.stringify(booked)).not.toMatch(/HH-PTY|Rossi/)
    expect(o.data.parties.find(p => p.id === 'p2')).toMatchObject({ booked: false, childName: null, childAge: null, parentName: null, food: null, cupcake: null })
  })
})

describe('the upcoming-weekend prep list', () => {
  const party = (over: Record<string, unknown> = {}) => ({ id: 'p', booking_id: 'b', party_kind: 'in_studio_theme', title: 'Glow Party', theme: null, starts_at: START, ends_at: END, guest_count: 12, status: 'published', ...over }) as never
  const row = (over: Record<string, unknown> = {}) => ({
    party_type: 'in_studio_theme', package_type: 'Glow', child_name: 'Ava Rossi', contact_name: 'Maria Rossi', party_tags: {},
    sel_theme_name: 'Glow Party', sel_pizza_or_bagels: 'pizza', sel_cupcake_flavor: 'chocolate', sel_add_mobile_cupcakes: null, ...over,
  })
  const line = (name: string, category: string, extra: Record<string, unknown> = {}) => ({ name, category, quantity: 1, is_optional: false, guest_multiplied: false, ...extra })

  it('the weekend is the next Saturday and Sunday, this one if today is part of it', () => {
    expect(upcomingWeekend(new Date('2026-11-04T15:00:00Z'))).toEqual({ saturday: '2026-11-07', sunday: '2026-11-08' }) // Wed
    expect(upcomingWeekend(new Date('2026-11-07T15:00:00Z'))).toEqual({ saturday: '2026-11-07', sunday: '2026-11-08' }) // Sat
    expect(upcomingWeekend(new Date('2026-11-08T15:00:00Z'))).toEqual({ saturday: '2026-11-07', sunday: '2026-11-08' }) // Sun
    expect(upcomingWeekend(new Date('2026-11-09T15:00:00Z'))).toEqual({ saturday: '2026-11-14', sunday: '2026-11-15' }) // Mon
  })
  it('lists the food, drinks, add-ons and activities that were booked, and not the optional ones', () => {
    const w = buildWeekendParty(party(), row(), [
      line('Fruit Platter', 'food-add-on'), line('Juice Boxes', 'beverage-add-on', { quantity: 2 }), line('Balloon Arch', 'decor-add-on'),
      line('Slime Station', 'activity-add-on'), line('Perfume Making', 'activity-add-on', { is_optional: true }), line('Early bird', 'discount'),
      line('Glow Party', 'theme'),
    ])
    expect(w).toMatchObject({ child: 'Ava Rossi', parent: 'Maria Rossi', theme: 'Glow Party', kids: 12 })
    expect(w.main).toMatch(/pizza/i)
    expect(w.cupcakes).toMatch(/chocolate/i)
    expect(w.food).toEqual([{ name: 'Fruit Platter', quantity: 1 }])
    expect(w.drinks).toEqual([{ name: 'Juice Boxes', quantity: 2 }])
    expect(w.addOns).toEqual([{ name: 'Balloon Arch', quantity: 1 }])
    expect(w.activities).toEqual([{ name: 'Slime Station', quantity: 1 }])
  })
  it('a mobile party has no pizza from us; a rental has no food choice at all', () => {
    const mobile = buildWeekendParty(party({ party_kind: 'mobile_party' }), row({ party_type: 'mobile_party', sel_add_mobile_cupcakes: 'true' }), [])
    expect(mobile.main).toBeNull()
    expect(mobile.cupcakes).toBeTruthy()
    const mobileNone = buildWeekendParty(party({ party_kind: 'mobile_party' }), row({ party_type: 'mobile_party' }), [])
    expect(mobileNone.cupcakes).toBeNull()
    const rental = buildWeekendParty(party({ party_kind: 'studio_rental' }), row({ party_type: 'studio_rental' }), [line('Coffee Bar', 'food-add-on')])
    expect(rental.main).toBeNull()
    expect(rental.cupcakes).toBeNull()
    expect(rental.food).toEqual([{ name: 'Coffee Bar', quantity: 1 }])
  })
  it('a party with no booking still lists, with nothing to prep', () => {
    const w = buildWeekendParty(party({ booking_id: null, title: 'By hand' }), null, [])
    expect(w).toMatchObject({ title: 'By hand', child: null, main: null, food: [], activities: [] })
  })
  it('totals answer the shopping question', () => {
    const a = buildWeekendParty(party({ id: 'a', guest_count: 12 }), row({ sel_pizza_or_bagels: 'pizza' }), [line('Slime Station', 'activity-add-on'), line('Fruit Platter', 'food-add-on')])
    const b = buildWeekendParty(party({ id: 'b', guest_count: 8 }), row({ sel_pizza_or_bagels: 'bagels', sel_cupcake_flavor: 'vanilla' }), [line('Slime Station', 'activity-add-on'), line('Fruit Platter', 'food-add-on')])
    const c = buildWeekendParty(party({ id: 'c', guest_count: 10 }), row({ sel_pizza_or_bagels: 'pizza' }), [])
    const t = weekendTotals([a, b, c])
    expect(t).toMatchObject({ parties: 3, kids: 30, pizzaKids: 22, bagelKids: 8 })
    expect(t.food).toEqual([{ name: 'Fruit Platter', quantity: 2 }])
    expect(t.activities).toEqual([{ name: 'Slime Station', parties: 2 }])
    expect(t.cupcakes.reduce((n, x) => n + x.parties, 0)).toBe(3)
  })
})
