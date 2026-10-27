/**
 * lib/crew/sync.ts — the booking → crew-party reconcile (spec §9, prompt 04 §1).
 *
 * Driven against `fakeCrewDb`, which refuses a second crew party per booking
 * (uq_crew_parties_booking) and moves `updated_at` on every UPDATE, so the
 * idempotency and the compare-and-swap are exercised, not assumed.
 */
import {
  crewKindOf, crewTitleOf, neededSpots, partyHelperCount, planReconcile, reconcileCrewParties, helperTimeRange, helperWindow, rolesFor,
  rolesToAdd, loadReconcileInputs, applyReconcile,
} from '@/lib/crew/sync'
import { DEFAULT_SETTINGS } from '@/lib/crew/rules'
import { STUDIO_ADDRESS_LINE } from '@/lib/studioLocation'
import { fakeCrewDb } from '../../helpers/fakeCrewDb'

const NOW = new Date('2026-10-27T12:00:00Z') // 08:00 ET
const S = DEFAULT_SETTINGS
const OWNER = 'owner-allie'
const HELPER_ITEM = 'pi-helper'
const HELPER_HOURLY = 'pi-helper-hour'

function booking(over: Record<string, any>) {
  return {
    id: over.id,
    booking_ref: over.booking_ref ?? `HH-${over.id}`,
    status: 'deposit_paid',
    party_type: 'in_studio_theme',
    event_type: 'kid-party',
    party_date: '2026-11-07',
    party_time: '12:00',
    package_type: null,
    guest_count_approx: 12,
    party_tags: {},
    theme_name: 'Glow Party',
    is_mini: null,
    mobile_tier: null,
    qs_tier: null,
    child_name: 'Sentinelchild',
    contact_name: 'Sentinel Parent',
    ...over,
  }
}

function seed(extra: Record<string, any[]> = {}) {
  return {
    bookings: [
      booking({ id: 'b-theme', booking_ref: 'HH-THEME' }),
      booking({ id: 'b-mobile', booking_ref: 'HH-MOBILE', party_type: 'mobile_party', guest_count_approx: 20, theme_name: null,
        package_type: 'Mobile Craft Party', party_date: '2026-11-08', party_time: '14:00',
        party_tags: { location_type: 'mobile', location_address: '12 Main St, Quogue, NY 11959' } }),
      booking({ id: 'b-rental', booking_ref: 'HH-RENTAL', party_type: 'studio_rental', event_type: 'studio-rental', theme_name: null,
        guest_count_approx: 40, party_date: '2026-11-08', party_time: '10:00',
        party_tags: { rental_start_time: '10:00', rental_end_time: '13:00', rental_hours: 3 } }),
      booking({ id: 'b-rental-nohelper', booking_ref: 'HH-RENTAL-NONE', party_type: null, event_type: 'studio-rental',
        party_tags: { rental_start_time: '11:00', rental_end_time: '14:00' } }),
      booking({ id: 'b-notime', booking_ref: 'HH-NOTIME', party_time: 'Evening' }),
      booking({ id: 'b-quote', booking_ref: 'HH-QUOTE', status: 'approved' }),
      booking({ id: 'b-past', booking_ref: 'HH-PAST', party_date: '2026-10-20' }),
      booking({ id: 'b-odd', booking_ref: 'HH-ODD', party_type: null, event_type: 'Kids Birthday Party' }),
      booking({ id: 'b-vendor', booking_ref: 'HH-VENDOR', party_type: null, event_type: 'vendor_registration' }),
      ...(extra.bookings ?? []),
    ],
    booking_payments: [
      { booking_id: 'b-theme', amount_cents: 25000, payment_type: 'deposit' },
      { booking_id: 'b-rental', amount_cents: 25000, payment_type: 'deposit' },
      { booking_id: 'b-odd', amount_cents: 25000, payment_type: 'deposit' },
      { booking_id: 'b-vendor', amount_cents: 5000, payment_type: 'deposit' },
      ...(extra.booking_payments ?? []),
    ],
    booking_line_items: [
      { booking_id: 'b-rental', name: 'Party Helper 1–5 PM + Full Clean-up', category: 'service-add-on', pricing_item_id: null, quantity: 2, is_optional: false },
      { booking_id: 'b-rental', name: 'Party Helper (quoted only)', category: 'service-add-on', pricing_item_id: null, quantity: 5, is_optional: true },
      { booking_id: 'b-rental-nohelper', name: 'Tables', category: 'rental', pricing_item_id: null, quantity: 4, is_optional: false },
      ...(extra.booking_line_items ?? []),
    ],
    pricing_items: [
      { id: HELPER_ITEM, name: 'Party Helper' },
      { id: HELPER_HOURLY, name: 'Party Helper (per hour)' },
      { id: 'pi-other', name: 'Balloon arch' },
    ],
    crew_members: [
      { id: OWNER, first_name: 'Allie', is_owner: true, email: null, phone: null, email_opt_in: false, sms_opt_in: false },
      { id: 'm-ava', first_name: 'Ava', is_owner: false, email: 'ava@example.test', phone: '+16315550101', email_opt_in: true, sms_opt_in: true },
      { id: 'm-mia', first_name: 'Mia', is_owner: false, email: 'mia@example.test', phone: null, email_opt_in: false, sms_opt_in: false },
      ...(extra.crew_members ?? []),
    ],
    crew_parties: [...(extra.crew_parties ?? [])],
    crew_slots: [...(extra.crew_slots ?? [])],
  }
}

const run = (db: ReturnType<typeof fakeCrewDb>, now = NOW) => reconcileCrewParties({ now, supabase: db.sb, settings: S })

describe('pure helpers', () => {
  it('crewKindOf: rental by type OR event type; mobile by the location toggle first', () => {
    expect(crewKindOf({ party_type: null, event_type: 'studio-rental', party_tags: {} })).toBe('studio_rental')
    expect(crewKindOf({ party_type: null, event_type: 'room-rental', party_tags: {} })).toBe('studio_rental')
    expect(crewKindOf({ party_type: 'in_studio_theme', event_type: 'kid-party', party_tags: { location_type: 'mobile' } })).toBe('mobile_party')
    expect(crewKindOf({ party_type: 'mobile_party', event_type: null, party_tags: {} })).toBe('mobile_party')
    expect(crewKindOf({ party_type: 'in_studio_theme', event_type: null, party_tags: {} })).toBe('in_studio_theme')
    expect(crewKindOf({ party_type: null, event_type: 'Kids Birthday Party', party_tags: {} })).toBeNull()
  })

  it('partyHelperCount: quantity, except the per-hour item counts as ONE helper; optional lines never count', () => {
    const items = [{ id: HELPER_ITEM, name: 'Party Helper' }, { id: HELPER_HOURLY, name: 'Party Helper (per hour)' }]
    expect(partyHelperCount([{ booking_id: 'x', name: 'Party Helper', category: 'service-add-on', pricing_item_id: null, quantity: 1, is_optional: false }], items))
      .toEqual({ count: 1, perHour: false })
    expect(partyHelperCount([{ booking_id: 'x', name: 'Anything', category: 'other', pricing_item_id: HELPER_ITEM, quantity: 3, is_optional: false }], items))
      .toEqual({ count: 3, perHour: false })
    expect(partyHelperCount([{ booking_id: 'x', name: 'Helper hours', category: 'other', pricing_item_id: HELPER_HOURLY, quantity: 5, is_optional: false }], items))
      .toEqual({ count: 1, perHour: true })
    expect(partyHelperCount([{ booking_id: 'x', name: 'Party Helper', category: 'service-add-on', pricing_item_id: null, quantity: 2, is_optional: true }], items))
      .toEqual({ count: 0, perHour: false })
    // A name match needs the add-on category: "Party Helper" in a package line is not an add-on bought.
    expect(partyHelperCount([{ booking_id: 'x', name: 'Party Helper', category: 'package', pricing_item_id: null, quantity: 1, is_optional: false }], items))
      .toEqual({ count: 0, perHour: false })
  })

  it.each([
    ['Party Helper 1–5 PM + Full Clean-up & Garbage Disposal', 13 * 60, 17 * 60],
    ['a party helper from 1:00–5:00 PM, then full clean-up', 13 * 60, 17 * 60],
    ['Helper 11–2 PM', 11 * 60, 14 * 60],
    ['Helper 10am-2pm', 10 * 60, 14 * 60],
    ['Helper 10:30 AM to 1:30 PM', 10 * 60 + 30, 13 * 60 + 30],
    ['Helper 6 to 9pm', 18 * 60, 21 * 60],
  ])('helperTimeRange reads %s', (text, startMin, endMin) => {
    expect(helperTimeRange(text)).toEqual({ startMin, endMin })
  })

  it.each([
    'Party Helper',                  // no time at all
    'Party Helper 1-5',              // no AM/PM: 1 AM is not believed
    'Party Helper 9-11',             // no AM/PM at all is ambiguous, even inside opening hours
    'Party Helper 2–5 AM',           // before 08:00
    'Party Helper 5–1 PM',           // ends before it starts
    'Studio Rental — Weekend 3 hrs', // a duration is not a time
  ])('helperTimeRange refuses %s', text => {
    expect(helperTimeRange(text)).toBeNull()
  })

  it("helperWindow: a rental's crew window is the HELPER's time on the party date, never the whole rental", () => {
    const items = [{ id: HELPER_ITEM, name: 'Party Helper' }]
    const line = (name: string, extra: Record<string, unknown> = {}) =>
      ({ booking_id: 'x', name, category: 'service-add-on', pricing_item_id: null, quantity: 1, is_optional: false, ...extra })
    const w = helperWindow({ party_date: '2026-12-06' }, [line('Party Helper 1–5 PM + Full Clean-up')], items)
    expect(w?.startsAt.toISOString()).toBe('2026-12-06T18:00:00.000Z') // 1 PM EST
    expect(w?.endsAt.toISOString()).toBe('2026-12-06T22:00:00.000Z')
    // The description is read when the name has no time.
    expect(helperWindow({ party_date: '2026-12-06' }, [line('Party Helper', { description: 'from 10:00 AM to 2:00 PM' })], items)?.startsAt.toISOString())
      .toBe('2026-12-06T15:00:00.000Z')
    // Two helper lines span both.
    const two = helperWindow({ party_date: '2026-12-06' }, [line('Party Helper 1–5 PM'), line('Party Helper 11–3 PM')], items)
    expect([two?.startsAt.toISOString(), two?.endsAt.toISOString()]).toEqual(['2026-12-06T16:00:00.000Z', '2026-12-06T22:00:00.000Z'])
    // An optional line's time never counts; no stated time is "needs a time".
    expect(helperWindow({ party_date: '2026-12-06' }, [line('Party Helper 1–5 PM', { is_optional: true })], items)).toBeNull()
    expect(helperWindow({ party_date: '2026-12-06' }, [line('Party Helper')], items)).toBeNull()
    expect(helperWindow({ party_date: '2026-12' }, [line('Party Helper 1–5 PM')], items)).toBeNull()
  })

  it('a rental has no Lead spot; every other party has exactly one', () => {
    expect(rolesFor('studio_rental', 2)).toEqual(['crew', 'crew'])
    expect(rolesFor('in_studio_theme', 3)).toEqual(['lead', 'crew', 'crew'])
    expect(rolesToAdd([], 2, 'studio_rental')).toEqual(['crew', 'crew'])
    expect(rolesToAdd([], 2, 'in_studio_theme')).toEqual(['lead', 'crew'])
  })

  it('crewTitleOf never carries a family name', () => {
    expect(crewTitleOf('in_studio_theme', 'Glow Party')).toBe('Glow Party')
    expect(crewTitleOf('mobile_party', 'Mobile Craft Party')).toBe('Mobile: Mobile Craft Party')
    expect(crewTitleOf('studio_rental', null)).toBe('Studio rental: Party Helper')
  })

  it('neededSpots: override wins; rental = helpers; otherwise the kid formula', () => {
    expect(neededSpots('in_studio_theme', 12, null, 0, S)).toBe(3)
    expect(neededSpots('in_studio_theme', 20, null, 0, S)).toBe(5)
    expect(neededSpots('in_studio_theme', 20, 2, 0, S)).toBe(2)
    expect(neededSpots('studio_rental', 45, null, 2, S)).toBe(2)
  })

  it('rolesToAdd never removes, and puts a missing Lead back first', () => {
    expect(rolesToAdd([{ role: 'lead', status: 'open' }, { role: 'crew', status: 'open' }, { role: 'crew', status: 'assigned' }], 2)).toEqual([])
    expect(rolesToAdd([{ role: 'lead', status: 'open' }], 3)).toEqual(['crew', 'crew'])
    expect(rolesToAdd([], 3)).toEqual(['lead', 'crew', 'crew'])
    expect(rolesToAdd([{ role: 'lead', status: 'cancelled' }, { role: 'crew', status: 'open' }], 2)).toEqual(['lead'])
    // Already over the count with no Lead: still nothing added (and nothing removed).
    expect(rolesToAdd([{ role: 'crew', status: 'open' }, { role: 'crew', status: 'open' }, { role: 'crew', status: 'assigned' }], 2)).toEqual([])
  })
})

describe('reconcileCrewParties against the fake database', () => {
  it('creates DRAFT parties for booked eligible bookings only, with one Lead and the formula spots', async () => {
    const db = fakeCrewDb(seed())
    const r = await run(db)
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    const parties = db.tables.crew_parties
    expect(parties.map(p => p.booking_id).sort()).toEqual(['b-mobile', 'b-rental', 'b-theme'])
    expect(parties.every(p => p.status === 'draft' && p.published_at == null && p.updated_by === 'system:crew-sync')).toBe(true)
    const slotsOf = (bookingId: string) => db.tables.crew_slots.filter(s => s.party_id === parties.find(p => p.booking_id === bookingId)!.id)
    expect(slotsOf('b-theme').map(s => s.role).sort()).toEqual(['crew', 'crew', 'lead'])
    expect(slotsOf('b-mobile')).toHaveLength(5)
    // 2 helpers (the optional 5 ignored), both ordinary crew spots, for the helper's 1–5 PM — not the 10–1 rental.
    expect(slotsOf('b-rental').map(s => s.role)).toEqual(['crew', 'crew'])
    const rental = parties.find(p => p.booking_id === 'b-rental')!
    expect([rental.starts_at, rental.ends_at]).toEqual(['2026-11-08T18:00:00.000Z', '2026-11-08T22:00:00.000Z'])
    expect(r.summary).toMatchObject({ created: 3, spotsAdded: 10, needsTime: ['HH-NOTIME'], unclassified: ['HH-ODD'], rentalsWithoutHelper: ['HH-RENTAL-NONE'] })

    const theme = parties.find(p => p.booking_id === 'b-theme')!
    expect(theme.starts_at).toBe('2026-11-07T17:00:00.000Z') // noon EST
    expect(theme.ends_at).toBe('2026-11-07T19:00:00.000Z')
    expect(theme.location).toBe(STUDIO_ADDRESS_LINE)
    expect(parties.find(p => p.booking_id === 'b-mobile')!.location).toBe('12 Main St, Quogue, NY 11959')
    // Nothing about the family reaches a crew party row.
    expect(JSON.stringify(parties)).not.toMatch(/Sentinel/)
    // Nothing was claimed, assigned, stepped or sent.
    expect(db.rpcCalls).toEqual([])
    expect(db.tables.crew_events ?? []).toEqual([])
    expect(db.tables.crew_notifications ?? []).toEqual([])
  })

  it('is idempotent: a second run creates 0 and updates 0', async () => {
    const db = fakeCrewDb(seed())
    await run(db)
    const before = JSON.stringify(db.tables.crew_parties) + JSON.stringify(db.tables.crew_slots)
    const r = await run(db)
    if (r.kind !== 'ok') throw new Error('unavailable')
    expect(r.summary).toMatchObject({ created: 0, updated: 0, cancelled: 0, spotsAdded: 0, raced: 0 })
    expect(JSON.stringify(db.tables.crew_parties) + JSON.stringify(db.tables.crew_slots)).toBe(before)
  })

  it('a create that collides on uq_crew_parties_booking is "already there", not an error', async () => {
    const db = fakeCrewDb(seed())
    const inputs = await loadReconcileInputs(db.sb, NOW)
    if (inputs.kind !== 'ok') throw new Error('unavailable')
    const plan = planReconcile(inputs.data, S, NOW)
    const first = await applyReconcile(db.sb, plan)
    const second = await applyReconcile(db.sb, plan) // the same plan, as a concurrent tick would hold it
    expect(first.created).toBe(3)
    expect(second).toMatchObject({ created: 0, alreadyThere: 3, errors: [] })
    expect(db.tables.crew_parties).toHaveLength(3)
  })

  it('raising the guest count adds open crew spots; lowering removes nothing and flags it', async () => {
    const db = fakeCrewDb(seed())
    await run(db)
    const party = () => db.tables.crew_parties.find(p => p.booking_id === 'b-theme')!
    const live = () => db.tables.crew_slots.filter(s => s.party_id === party().id && s.status !== 'cancelled')
    // Ava takes one of the spots, so the lowering below cannot be "solved" by deleting her.
    live()[1].status = 'assigned'
    live()[1].member_id = 'm-ava'

    db.tables.bookings.find(b => b.id === 'b-theme')!.guest_count_approx = 20
    const up = await run(db)
    if (up.kind !== 'ok') throw new Error('unavailable')
    expect(up.summary).toMatchObject({ updated: 1, spotsAdded: 2 })
    expect(live()).toHaveLength(5)
    expect(live().filter(s => s.role === 'lead')).toHaveLength(1)
    expect(party().guest_count).toBe(20)
    expect(party().sync_flags).toEqual([])

    db.tables.bookings.find(b => b.id === 'b-theme')!.guest_count_approx = 6
    const down = await run(db)
    if (down.kind !== 'ok') throw new Error('unavailable')
    expect(down.summary.spotsAdded).toBe(0)
    expect(live()).toHaveLength(5)
    expect(live().some(s => s.member_id === 'm-ava')).toBe(true)
    expect(party().sync_flags).toEqual(['over_staffed'])
    expect(down.summary.flagged).toContainEqual({ bookingRef: 'HH-THEME', partyId: party().id, flags: ['over_staffed'] })

    // Back up to five's worth: the flag clears on its own.
    db.tables.bookings.find(b => b.id === 'b-theme')!.guest_count_approx = 20
    await run(db)
    expect(party().sync_flags).toEqual([])
  })

  it('two runs planned from one read add the missing spots ONCE (the updated_at claim)', async () => {
    const db = fakeCrewDb(seed())
    await run(db)
    db.tables.bookings.find(b => b.id === 'b-theme')!.guest_count_approx = 20
    const inputs = await loadReconcileInputs(db.sb, NOW)
    if (inputs.kind !== 'ok') throw new Error('unavailable')
    const plan = planReconcile(inputs.data, S, NOW)
    const a = await applyReconcile(db.sb, plan)
    const b = await applyReconcile(db.sb, plan)
    expect(a).toMatchObject({ updated: 1, spotsAdded: 2 })
    expect(b).toMatchObject({ updated: 0, raced: 1, spotsAdded: 0 })
    const id = db.tables.crew_parties.find(p => p.booking_id === 'b-theme')!.id
    expect(db.tables.crew_slots.filter(s => s.party_id === id)).toHaveLength(5)
  })

  it("an existing rental party made the old way is moved to the helper's time and its OPEN Lead spot becomes a crew spot", async () => {
    const db = fakeCrewDb(seed())
    await run(db)
    const rental = db.tables.crew_parties.find(p => p.booking_id === 'b-rental')!
    // As Phase 3 first built it: the whole 10–1 rental, one open Lead spot and one held one.
    Object.assign(rental, { starts_at: '2026-11-08T15:00:00.000Z', ends_at: '2026-11-08T18:00:00.000Z' })
    const [a, b] = db.tables.crew_slots.filter(s => s.party_id === rental.id)
    Object.assign(a, { role: 'lead' })
    db.tables.crew_slots.push({ ...b, id: 'held-lead', role: 'lead', status: 'assigned', member_id: 'm-ava' })
    b.status = 'cancelled'
    // (two Lead spots cannot coexist live in the real table; the held one stands in for "a claim landed")
    const r = await run(db)
    if (r.kind !== 'ok') throw new Error('unavailable')
    expect([rental.starts_at, rental.ends_at]).toEqual(['2026-11-08T18:00:00.000Z', '2026-11-08T22:00:00.000Z'])
    expect(a.role).toBe('crew')
    expect(db.tables.crew_slots.find(s => s.id === 'held-lead')!.role).toBe('lead')
    expect(rental.sync_flags).toEqual(['time_changed'])
  })

  it('a booked rental whose helper line states no time needs a time, and gets no crew party', async () => {
    const db = fakeCrewDb(seed())
    db.tables.booking_line_items.find(l => l.booking_id === 'b-rental' && !l.is_optional)!.name = 'Party Helper + Full Clean-up'
    const r = await run(db)
    if (r.kind !== 'ok') throw new Error('unavailable')
    expect(r.summary.needsTime.slice().sort()).toEqual(['HH-NOTIME', 'HH-RENTAL'])
    expect(db.tables.crew_parties.some(p => p.booking_id === 'b-rental')).toBe(false)
  })

  it('a party left with no spots gets its Lead back first', async () => {
    const db = fakeCrewDb(seed())
    await run(db)
    const id = db.tables.crew_parties.find(p => p.booking_id === 'b-theme')!.id
    db.tables.crew_slots = db.tables.crew_slots.filter(s => s.party_id !== id)
    await run(db)
    expect(db.tables.crew_slots.filter(s => s.party_id === id).map(s => s.role).sort()).toEqual(['crew', 'crew', 'lead'])
  })

  it('a moved party with crew on it is re-timed and flagged time_changed, and the flag sticks', async () => {
    const db = fakeCrewDb(seed())
    await run(db)
    const party = () => db.tables.crew_parties.find(p => p.booking_id === 'b-theme')!
    const s0 = db.tables.crew_slots.find(s => s.party_id === party().id)!
    Object.assign(s0, { status: 'assigned', member_id: 'm-ava' })
    db.tables.bookings.find(b => b.id === 'b-theme')!.party_time = '15:00'
    await run(db)
    expect(party().starts_at).toBe('2026-11-07T20:00:00.000Z')
    expect(party().sync_flags).toEqual(['time_changed'])
    const again = await run(db)
    if (again.kind !== 'ok') throw new Error('unavailable')
    expect(again.summary.updated).toBe(0)
    expect(party().sync_flags).toEqual(['time_changed'])
  })

  it('a cancelled booking cancels its published party and its spots, QUEUES partyCancelled for the crew (never the owner), and moves no step', async () => {
    const db = fakeCrewDb(seed())
    await run(db)
    const party = db.tables.crew_parties.find(p => p.booking_id === 'b-theme')!
    Object.assign(party, { status: 'published', published_at: NOW.toISOString() })
    const slots = db.tables.crew_slots.filter(s => s.party_id === party.id)
    Object.assign(slots.find(s => s.role === 'lead')!, { status: 'assigned', member_id: OWNER })
    Object.assign(slots.filter(s => s.role === 'crew')[0], { status: 'assigned', member_id: 'm-ava' })
    Object.assign(slots.filter(s => s.role === 'crew')[1], { status: 'assigned', member_id: 'm-mia' })
    db.tables.crew_swap_requests = [{ id: 'sw1', slot_id: slots.filter(s => s.role === 'crew')[0].id, status: 'open' }]

    db.tables.bookings.find(b => b.id === 'b-theme')!.status = 'cancelled'
    const r = await run(db)
    if (r.kind !== 'ok') throw new Error('unavailable')
    expect(r.summary).toMatchObject({ cancelled: 1 })
    expect(party.status).toBe('cancelled')
    expect(party.cancelled_at).toBeTruthy()
    expect(db.tables.crew_slots.filter(s => s.party_id === party.id).every(s => s.status === 'cancelled')).toBe(true)
    // Who was on it survives on the row.
    expect(db.tables.crew_slots.filter(s => s.party_id === party.id).map(s => s.member_id).filter(Boolean).sort()).toEqual(['m-ava', 'm-mia', OWNER].sort())
    expect(db.tables.crew_swap_requests[0].status).toBe('cancelled')

    const notes = db.tables.crew_notifications
    expect(notes.every(n => n.status === 'queued' && n.template === 'partyCancelled')).toBe(true)
    expect(notes.map(n => `${n.member_id}:${n.channel}`).sort()).toEqual(['m-ava:email', 'm-ava:in_app', 'm-ava:sms', 'm-mia:in_app'])
    expect(notes.some(n => n.member_id === OWNER)).toBe(false)
    expect(r.summary.notificationsQueued).toBe(4)
    expect(db.rpcCalls).toEqual([])
    expect(db.tables.crew_events ?? []).toEqual([])

    const again = await run(db)
    if (again.kind !== 'ok') throw new Error('unavailable')
    expect(again.summary).toMatchObject({ cancelled: 0, notificationsQueued: 0 })
    expect(db.tables.crew_notifications).toHaveLength(4)
  })

  it('a lost booking cancels its DRAFT party and tells nobody: a draft was never shown', async () => {
    const db = fakeCrewDb(seed())
    await run(db)
    const party = db.tables.crew_parties.find(p => p.booking_id === 'b-theme')!
    Object.assign(db.tables.crew_slots.find(s => s.party_id === party.id && s.role === 'crew')!, { status: 'assigned', member_id: 'm-ava' })
    db.tables.bookings.find(b => b.id === 'b-theme')!.status = 'lost'
    const r = await run(db)
    if (r.kind !== 'ok') throw new Error('unavailable')
    expect(r.summary.cancelled).toBe(1)
    expect(db.tables.crew_notifications ?? []).toEqual([])
  })

  it('a booking that is booked again after its crew party was cancelled is reported, never resurrected', async () => {
    const db = fakeCrewDb(seed())
    await run(db)
    db.tables.bookings.find(b => b.id === 'b-theme')!.status = 'cancelled'
    await run(db)
    db.tables.bookings.find(b => b.id === 'b-theme')!.status = 'deposit_paid'
    const r = await run(db)
    if (r.kind !== 'ok') throw new Error('unavailable')
    expect(r.summary.reactivated).toEqual(['HH-THEME'])
    expect(db.tables.crew_parties.filter(p => p.booking_id === 'b-theme').map(p => p.status)).toEqual(['cancelled'])
  })

  it('money refunded to nothing flags not_booked and adds no spots', async () => {
    const db = fakeCrewDb(seed())
    await run(db)
    db.tables.booking_payments.push({ booking_id: 'b-theme', amount_cents: 25000, payment_type: 'refund' })
    // `deposit_paid` alone still reads as booked (lib/bookingStatus.ts); a refunded quote does not.
    Object.assign(db.tables.bookings.find(b => b.id === 'b-theme')!, { status: 'approved', guest_count_approx: 20 })
    await run(db)
    const party = db.tables.crew_parties.find(p => p.booking_id === 'b-theme')!
    expect(party.sync_flags).toEqual(['not_booked'])
    expect(db.tables.crew_slots.filter(s => s.party_id === party.id)).toHaveLength(3)
  })

  it('any unreadable input table stops the run and writes nothing', async () => {
    const tables = ['bookings', 'booking_payments', 'booking_line_items', 'pricing_items', 'crew_parties', 'crew_slots', 'crew_members']
    for (const t of tables) {
      const db = fakeCrewDb(seed())
      await run(db) // parties exist, so every input table is really read below
      db.tables.bookings.find(b => b.id === 'b-theme')!.guest_count_approx = 20
      db.tables.bookings.find(b => b.id === 'b-quote')!.status = 'deposit_paid'
      const before = JSON.stringify(db.tables.crew_parties) + JSON.stringify(db.tables.crew_slots)
      db.failOn.add(`select:${t}`)
      const r = await run(db)
      expect([t, r.kind]).toEqual([t, 'unavailable'])
      expect(JSON.stringify(db.tables.crew_parties) + JSON.stringify(db.tables.crew_slots)).toBe(before)
    }
  })

  it('dryRun plans and writes nothing', async () => {
    const db = fakeCrewDb(seed())
    const r = await reconcileCrewParties({ now: NOW, supabase: db.sb, settings: S, dryRun: true })
    if (r.kind !== 'ok') throw new Error('unavailable')
    expect(r.plan?.creates).toHaveLength(3)
    expect(r.summary.needsTime).toEqual(['HH-NOTIME'])
    expect(db.tables.crew_parties).toEqual([])
  })

  it('a party that has already started today is not created', async () => {
    const db = fakeCrewDb(seed({ bookings: [booking({ id: 'b-today', booking_ref: 'HH-TODAY', party_date: '2026-10-27', party_time: '08:00' })] }))
    db.tables.booking_payments.push({ booking_id: 'b-today', amount_cents: 25000, payment_type: 'deposit' })
    await run(db, new Date('2026-10-27T13:30:00Z')) // 09:30 ET
    expect(db.tables.crew_parties.some(p => p.booking_id === 'b-today')).toBe(false)
  })
})
