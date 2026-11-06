/**
 * Crew launch MVP autopilot (2026-11-05): the manager only acts when staffing
 * cannot be locked in. Driven against `fakeCrewDb` with fake providers.
 *
 *   runAutoPublish      new booked parties go up by themselves (narrowly)
 *   runCrewAsks         "new party" and "still need crew" go to FREE crew only
 *   runCovers           a late cancel nobody standing by took is offered to everyone free
 *   runPartyAlerts      the one routine manager touch: still short as the day nears
 *   runCrewJobs         all of it in one tick, twice, sends nothing the second time
 */
import { DEFAULT_SETTINGS, staffingShortfall, understaffedAlertAt, type CrewSettings } from '@/lib/crew/rules'
import { listPartiesInRange } from '@/lib/crew/db'
import { releaseMySpot } from '@/lib/crew/cover'
import {
  ASKS_PER_TICK, DIGEST_AFTER, listRecentlyPublished, runAutoPublish, runCovers, runCrewAsks, runCrewJobs, runPartyAlerts, type JobsCtx,
} from '@/lib/crew/jobs'
import type { CrewSenders } from '@/lib/crew/notify'
import { fakeCoverRpc, fakeCrewDb, type FakeCrewDb } from '../../helpers/fakeCrewDb'
import { openCoverNobodyToAsk } from '../../helpers/openCover'

const H = 3_600_000
const DAY = 24 * H
let NOW = new Date('2026-11-02T15:00:00Z') // Mon 10:00 EST

const AUTO: CrewSettings = {
  ...DEFAULT_SETTINGS,
  autopilot: { autoPublish: true, autoPublishFrom: '2026-11-04', understaffedDaysBefore: 5, nudgeFirstDaysBefore: 10, nudgeSecondDaysBefore: 5 },
}
const LADDER_OFF = AUTO.ladderEnabled === false && AUTO.payVisible === false

const iso = (ms: number) => new Date(ms).toISOString()
const startIn = (days: number) => iso(NOW.getTime() + days * DAY)
const endOf = (start: string) => iso(new Date(start).getTime() + 3 * H)

const person = (id: string, over: Record<string, unknown> = {}) => ({
  id, first_name: id.toUpperCase(), last_name: null, email: `${id}@example.test`, phone: null, steps: 3, can_lead: false,
  is_owner: false, is_test: false, skills: [], status: 'active', needs_review: false, sms_opt_in: false, sms_opt_in_at: null,
  email_opt_in: true, admin_notes: null, job_application_id: null, joined_on: '2026-10-01', created_at: `2026-10-01T00:00:0${id.length}Z`,
  updated_at: '2026-10-01T00:00:00Z', ...over,
})

function party(id: string, startDays: number, over: Record<string, unknown> = {}) {
  const starts_at = startIn(startDays)
  return {
    id, booking_id: `b-${id}`, party_kind: 'in_studio_theme', title: `Party ${id}`, theme: `Theme ${id}`, starts_at, ends_at: endOf(starts_at),
    guest_count: 12, location: '295 Montauk Hwy', notes_for_crew: null, slots_override: null, extra_flat_cents: 0, status: 'published',
    published_at: iso(NOW.getTime() - H), attendance_marked_at: null, cancelled_at: null, sync_flags: [],
    created_at: '2026-11-04T12:00:00Z', updated_at: '2026-11-04T12:00:00Z', ...over,
  }
}

const slot = (id: string, partyId: string, member: string | null, role: 'lead' | 'crew' = 'crew', over: Record<string, unknown> = {}) => ({
  id, party_id: partyId, role, status: member ? 'assigned' : 'open', member_id: member, assigned_at: member ? '2026-10-20T00:00:00Z' : null,
  assigned_via: member ? 'claim' : null, assigned_by: null, confirmed_at: null, covered_swap_id: null, created_at: '2026-10-20T00:00:00Z', ...over,
})

function senders(): CrewSenders & { sms: jest.Mock; email: jest.Mock } {
  return { sms: jest.fn(async () => 'quo-1'), email: jest.fn(async () => ({ kind: 'sent' as const, providerId: 're-1' })) } as any
}

const ENV = { ...process.env }
let db: FakeCrewDb
let tx: ReturnType<typeof senders>

function seed(tables: Record<string, any[]>) {
  db = fakeCrewDb({
    crew_members: [], crew_parties: [], crew_slots: [], crew_standbys: [], crew_unavailability: [], crew_recurring_blocks: [],
    crew_settings: [{ key: 'drops', value: { late_drop_days: 7, standby_window_hours: 2, unclaimed_warning_hours: 48 } }],
    crew_swap_requests: [], crew_notifications: [], crew_events: [], contacts: [],
    ...tables,
  }, { rpc: fakeCoverRpc(() => NOW) })
  tx = senders()
}

const jobs = (scope: 'all' | 'test' = 'all', s: CrewSettings = AUTO): JobsCtx => ({ sb: db.sb, now: NOW, senders: tx, settings: s, scope })
const notes = (f: (r: any) => boolean = () => true) => db.tables.crew_notifications.filter(f)
const keys = (f: (r: any) => boolean = r => r.channel === 'in_app') => notes(f).map(r => r.dedupe_key).sort()
const published = async () => {
  const r = await listPartiesInRange(db.sb, '2026-01-01T00:00:00Z', '2028-01-01T00:00:00Z', { statuses: ['published'] })
  if (r.kind !== 'ok') throw new Error('read failed')
  return r.data
}

beforeEach(() => {
  process.env = { ...ENV, CREW_ENABLED: 'true', CREW_SMS_ENABLED: 'false', CREW_ADMIN_EMAIL: 'alerts@example.test' }
  NOW = new Date('2026-11-02T15:00:00Z')
})
afterAll(() => { process.env = ENV })

describe('the launch defaults', () => {
  it('start with the pay game and pay figures OFF', () => {
    expect(LADDER_OFF).toBe(true)
    expect(DEFAULT_SETTINGS.ladderEnabled).toBe(false)
    expect(DEFAULT_SETTINGS.payVisible).toBe(false)
    // …and an autopilot that publishes nothing until its migration seeded it ON.
    expect(DEFAULT_SETTINGS.autopilot.autoPublish).toBe(false)
  })
})

describe('auto-publish', () => {
  const drafts = () => [
    party('new', 20, { status: 'draft', published_at: null }),
    party('old', 21, { status: 'draft', published_at: null, created_at: '2026-10-27T12:00:00Z' }),
    party('flagged', 22, { status: 'draft', published_at: null, sync_flags: ['needs_address'] }),
    party('byhand', 23, { status: 'draft', published_at: null, booking_id: null }),
  ]
  const slotsFor = (...ids: string[]) => ids.map(i => slot(`s-${i}`, i, null, 'lead'))
  const statusOf = (id: string) => db.tables.crew_parties.find(p => p.id === id)!.status

  it('publishes only a clean, booked draft created on or after the cutoff — and says who did it', async () => {
    seed({ crew_parties: drafts(), crew_slots: slotsFor('new', 'old', 'flagged', 'byhand') })
    expect(await runAutoPublish(jobs())).toEqual({ published: 1, unavailable: false })
    expect(statusOf('new')).toBe('published')
    expect(statusOf('old')).toBe('draft')      // existing drafts wait for Adam
    expect(statusOf('flagged')).toBe('draft')  // a flag means a human looks first
    expect(statusOf('byhand')).toBe('draft')   // Allie's own party is hers to publish
    const row = db.tables.crew_parties.find(p => p.id === 'new')!
    expect(row.updated_by).toBe('system:crew-autopilot')
    expect(row.published_at).toBe(NOW.toISOString())
  })

  it('a second tick publishes nothing more', async () => {
    seed({ crew_parties: drafts(), crew_slots: slotsFor('new') })
    await runAutoPublish(jobs())
    expect((await runAutoPublish(jobs())).published).toBe(0)
  })

  it('does nothing when the setting is off, in the test scope, or when a draft has no spots', async () => {
    seed({ crew_parties: drafts(), crew_slots: slotsFor('new') })
    const off: CrewSettings = { ...AUTO, autopilot: { ...AUTO.autopilot, autoPublish: false } }
    expect((await runAutoPublish(jobs('all', off))).published).toBe(0)
    expect((await runAutoPublish(jobs('test'))).published).toBe(0)
    seed({ crew_parties: drafts(), crew_slots: [] })
    expect((await runAutoPublish(jobs())).published).toBe(0)
    expect(statusOf('new')).toBe('draft')
  })

  it('with no cutoff date every clean draft goes up (that is how Adam sweeps the old ones)', async () => {
    seed({ crew_parties: drafts(), crew_slots: slotsFor('new', 'old', 'flagged') })
    const sweep: CrewSettings = { ...AUTO, autopilot: { ...AUTO.autopilot, autoPublishFrom: null } }
    expect((await runAutoPublish(jobs('all', sweep))).published).toBe(2)
    expect(statusOf('flagged')).toBe('draft')
  })
})

describe('"new party" and "still need crew" go to free crew', () => {
  const members = () => [
    person('a'), person('b'), person('c'), person('d', { can_lead: true }), person('e'),
    person('allie', { is_owner: true, can_lead: true, email: null }),
    person('paused', { status: 'paused' }),
  ]

  function world(partyOver: Record<string, unknown> = {}, slots?: any[]) {
    const starts_at = (partyOver.starts_at as string | undefined) ?? startIn(20)
    seed({
      crew_members: members(),
      crew_parties: [
        party('p1', 20, partyOver),
        // C works an overlapping party that day.
        party('p2', 20, { booking_id: 'b-p2', starts_at, ends_at: endOf(starts_at) }),
      ],
      crew_slots: [
        ...(slots ?? [slot('l1', 'p1', null, 'lead'), slot('c1', 'p1', null), slot('c2', 'p1', 'e')]),
        slot('x1', 'p2', 'c', 'lead'),
      ],
      crew_unavailability: [{ member_id: 'b', day: starts_at.slice(0, 10), part: 'all_day' }],
    })
  }
  const asked = (prefix: string) => keys(r => r.channel === 'in_app' && r.dedupe_key.startsWith(prefix))

  it('asks only people who could actually work it, once', async () => {
    world()
    const out = await runCrewAsks(jobs(), await published())
    // A and D: free. Not B (blocked), C (working an overlapping party), E (already on it), Allie (owner), the paused one.
    expect(asked('new_party:p1:')).toEqual(['new_party:p1:a', 'new_party:p1:d'])
    expect(out.newParty).toBe(2)
    const again = await runCrewAsks(jobs(), await published())
    expect(again.newParty).toBe(0)
    expect(asked('new_party:p1:')).toHaveLength(2)
  })

  it('says nothing about pay at launch, and signs as Allie', async () => {
    world()
    await runCrewAsks(jobs(), await published())
    const mail = tx.email.mock.calls.find(c => c[0] === 'a@example.test')![1]
    expect(mail.email.text).not.toMatch(/\$/)
    expect(mail.email.text).toMatch(/— Allie, Host Hampton$/)
  })

  it('a Lead-only vacancy goes only to people who can lead', async () => {
    world({}, [slot('l1', 'p1', null, 'lead'), slot('c1', 'p1', 'a'), slot('c2', 'p1', 'e')])
    await runCrewAsks(jobs(), await published())
    expect(asked('new_party:p1:')).toEqual(['new_party:p1:d'])
  })

  it('nobody is asked about a party with no open spot', async () => {
    world({}, [slot('l1', 'p1', 'd', 'lead'), slot('c1', 'p1', 'a'), slot('c2', 'p1', 'e')])
    expect((await runCrewAsks(jobs(), await published())).newParty).toBe(0)
  })

  it('the "new" notice lasts 72 hours from publishing, not forever', async () => {
    world({ published_at: iso(NOW.getTime() - 73 * H) })
    expect((await runCrewAsks(jobs(), await published())).newParty).toBe(0)
  })

  it('a party far past the 11-day look-ahead is still announced, found by when it was published', async () => {
    world({ starts_at: startIn(60), ends_at: endOf(startIn(60)) })
    const recent = await listRecentlyPublished(db.sb, NOW)
    expect(recent.kind === 'ok' && recent.data.map(p => p.party.id)).toEqual(expect.arrayContaining(['p1']))
  })

  it('a REAL member is never told about a TEST party', async () => {
    world({ booking_id: null, title: 'TEST — Glow' })
    db.tables.crew_members.push(person('t1', { is_test: true }) as any)
    await runCrewAsks(jobs(), await published())
    expect(asked('new_party:p1:')).toEqual(['new_party:p1:t1'])
  })

  it('an invented member is never told about a REAL party', async () => {
    world()
    db.tables.crew_members.find(m => m.id === 'a')!.is_test = true
    await runCrewAsks(jobs(), await published())
    expect(asked('new_party:p1:')).toEqual(['new_party:p1:d'])
  })

  it('the test scope asks only invented members', async () => {
    world({ booking_id: null, title: 'TEST — Glow' })
    db.tables.crew_members.push(person('t1', { is_test: true }) as any)
    await runCrewAsks(jobs('test'), await published())
    expect(asked('new_party:p1:')).toEqual(['new_party:p1:t1'])
  })

  it(`more than ${DIGEST_AFTER} parties at once become ONE message, and each party is still marked asked`, async () => {
    seed({
      crew_members: [person('a')],
      crew_parties: [1, 2, 3, 4, 5].map(i => party(`q${i}`, 20 + 2 * i)),
      crew_slots: [1, 2, 3, 4, 5].map(i => slot(`ql${i}`, `q${i}`, null)),
    })
    const out = await runCrewAsks(jobs(), await published())
    expect(out.newParty).toBe(1)
    expect(tx.email).toHaveBeenCalledTimes(1)
    expect(tx.email.mock.calls[0][1].email.subject).toMatch(/5 parties just went up/)
    expect(asked('new_party:')).toHaveLength(5)
    expect(notes(r => r.dedupe_key.startsWith('new_party:') && r.status === 'skipped').length).toBe(5)
    expect((await runCrewAsks(jobs(), await published())).newParty).toBe(0)
    expect(tx.email).toHaveBeenCalledTimes(1)
  })

  it(`never sends more than ${ASKS_PER_TICK} asks in a tick; the rest follow on the next one`, async () => {
    const many = Array.from({ length: 70 }, (_, i) => person(`m${i}`, { id: `m${i}` }))
    seed({
      crew_members: many,
      crew_parties: [party('p1', 20)],
      crew_slots: [slot('c1', 'p1', null)],
    })
    const first = await runCrewAsks(jobs(), await published())
    expect(first.newParty).toBe(ASKS_PER_TICK)
    const second = await runCrewAsks(jobs(), await published())
    expect(second.newParty).toBe(70 - ASKS_PER_TICK)
    expect((await runCrewAsks(jobs(), await published())).newParty).toBe(0)
  })

  describe('open-spot nudges', () => {
    it('round 1 at 10 days out, round 2 at 5, each once', async () => {
      world({ published_at: '2026-10-01T00:00:00Z', starts_at: startIn(9), ends_at: endOf(startIn(9)) })
      const out1 = await runCrewAsks(jobs(), await published())
      expect(out1.nudges).toBe(2)
      expect(asked('nudge:p1:1:')).toEqual(['nudge:p1:1:a', 'nudge:p1:1:d'])
      expect((await runCrewAsks(jobs(), await published())).nudges).toBe(0)

      NOW = new Date(NOW.getTime() + 5 * DAY) // 4 days out
      const out2 = await runCrewAsks(jobs(), await published())
      expect(out2.nudges).toBe(2)
      expect(asked('nudge:p1:2:')).toEqual(['nudge:p1:2:a', 'nudge:p1:2:d'])
    })

    it('skips a round the "new party" notice already was: published after the mark', async () => {
      // 9 days out, published an hour ago: the first mark (10 days) passed BEFORE it went up.
      world({ starts_at: startIn(9), ends_at: endOf(startIn(9)) })
      const out = await runCrewAsks(jobs(), await published())
      expect(out.newParty).toBe(2)
      expect(out.nudges).toBe(0)
    })

    it('stops asking once the party is full', async () => {
      world({ published_at: '2026-10-01T00:00:00Z', starts_at: startIn(9), ends_at: endOf(startIn(9)) },
        [slot('l1', 'p1', 'd', 'lead'), slot('c1', 'p1', 'a'), slot('c2', 'p1', 'e')])
      expect((await runCrewAsks(jobs(), await published())).nudges).toBe(0)
    })
  })
})

describe('the understaffed alert — the one routine manager touch', () => {
  const fullCrew = (partyId: string) => [slot(`${partyId}-l`, partyId, 'allie', 'lead'), slot(`${partyId}-c1`, partyId, 'a'), slot(`${partyId}-c2`, partyId, 'b')]
  const base = () => [person('a'), person('b'), person('allie', { is_owner: true, can_lead: true, email: null })]
  const adminMail = () => tx.email.mock.calls.filter(c => c[0] === 'alerts@example.test').map(c => c[1].email)

  it('emails Allie once when a party is still short of crew at the setting (5 days)', async () => {
    seed({ crew_members: base(), crew_parties: [party('p1', 4)], crew_slots: [slot('l', 'p1', 'allie', 'lead'), slot('c1', 'p1', 'a'), slot('c2', 'p1', null)] })
    expect((await runPartyAlerts(jobs(), await published())).understaffed).toBe(1)
    expect(keys()).toEqual(['understaffed:p1'])
    expect(adminMail()).toHaveLength(1)
    expect(adminMail()[0].text).toMatch(/1 crew spot/)
    expect((await runPartyAlerts(jobs(), await published())).understaffed).toBe(0)
    expect(adminMail()).toHaveLength(1)
  })

  it('a full party is never alerted; a party with no Lead spot at all counts as lead-short at the 7-day mark', async () => {
    seed({ crew_members: base(), crew_parties: [party('p1', 6), party('p2', 3)], crew_slots: [slot('c1', 'p1', null), ...fullCrew('p2')] })
    const out = await runPartyAlerts(jobs(), await published())
    expect(out.understaffed).toBe(1)
    expect(keys()).toEqual(['understaffed:p1'])
  })

  it('is quiet before its mark: crew short 6 days out waits for the 5-day mark', async () => {
    seed({ crew_members: base(), crew_parties: [party('p1', 6)], crew_slots: [slot('l', 'p1', 'allie', 'lead'), slot('c1', 'p1', 'a'), slot('c2', 'p1', null)] })
    expect((await runPartyAlerts(jobs(), await published())).understaffed).toBe(0)
    NOW = new Date(NOW.getTime() + 1.5 * DAY) // 4.5 days out
    expect((await runPartyAlerts(jobs(), await published())).understaffed).toBe(1)
  })

  it('a missing Lead is raised at the earlier Lead-alert mark (7 days), crew shortage waits for 5', async () => {
    seed({ crew_members: base(), crew_parties: [party('p1', 6)], crew_slots: [slot('l', 'p1', null, 'lead'), slot('c1', 'p1', 'a'), slot('c2', 'p1', 'b')] })
    expect((await runPartyAlerts(jobs(), await published())).understaffed).toBe(1)
    seed({ crew_members: base(), crew_parties: [party('p1', 6)], crew_slots: [slot('l', 'p1', 'allie', 'lead'), slot('c1', 'p1', 'a'), slot('c2', 'p1', null)] })
    expect((await runPartyAlerts(jobs(), await published())).understaffed).toBe(0)
  })

  it('never for a studio rental on account of a Lead; only if its crew spots are open', async () => {
    seed({
      crew_members: base(),
      crew_parties: [party('r1', 3, { party_kind: 'studio_rental' })],
      crew_slots: [slot('r1a', 'r1', 'a'), slot('r1b', 'r1', 'b')],
    })
    expect((await runPartyAlerts(jobs(), await published())).understaffed).toBe(0)
    db.tables.crew_slots.push(slot('r1c', 'r1', null) as any)
    expect((await runPartyAlerts(jobs(), await published())).understaffed).toBe(1)
  })

  it('shares one definition with the page: the same predicate, not a second copy', () => {
    const rental = { party_kind: 'studio_rental' }
    const themed = { party_kind: 'in_studio_theme' }
    const open = [{ role: 'crew' as const, status: 'open', member_id: null }]
    expect(staffingShortfall(rental, open)).toEqual({ crewShort: 1, leadShort: false })
    expect(staffingShortfall(themed, open)).toEqual({ crewShort: 1, leadShort: true })
    expect(staffingShortfall(themed, [{ role: 'lead', status: 'cancelled', member_id: null }])).toEqual({ crewShort: 0, leadShort: true })
    const start = new Date('2026-11-20T18:00:00Z')
    expect(start.getTime() - understaffedAlertAt(start, false, AUTO).getTime()).toBe(5 * DAY)
    expect(start.getTime() - understaffedAlertAt(start, true, AUTO).getTime()).toBe(7 * DAY)
  })
})

describe('a late cancel on autopilot', () => {
  const START = '2026-11-05T18:00:00.000Z' // 75 h after NOW
  const world = () => seed({
    crew_members: [person('a'), person('b'), person('c'), person('d'), person('allie', { is_owner: true, can_lead: true, email: null })],
    crew_parties: [party('p1', 0, { starts_at: START, ends_at: endOf(START) })],
    crew_slots: [slot('s-lead', 'p1', 'allie', 'lead'), slot('s-a', 'p1', 'a'), slot('s-open', 'p1', null)],
    crew_standbys: [{ id: 'sb1', party_id: 'p1', member_id: 'b', withdrawn_at: null }],
  })
  const swap = () => db.tables.crew_swap_requests[0]
  const ctx = () => ({ sb: db.sb, now: NOW, senders: tx })
  const members = new Map<string, any>()
  const refreshMembers = () => { members.clear(); for (const m of db.tables.crew_members) members.set(m.id, m) }

  it('after the standby window, offers the spot to everyone free — not just standbys — and tells Allie in-app only', async () => {
    world()
    await releaseMySpot(ctx(), AUTO, db.tables.crew_members.find(m => m.id === 'a') as any, 's-a', 'sick', null)
    expect(swap().status).toBe('open')

    NOW = new Date(NOW.getTime() + 3 * H) // past the 2h window
    refreshMembers()
    const out = await runCovers(jobs(), members)
    expect(out).toMatchObject({ escalated: 1, autoOffered: 1 })
    expect(swap().status).toBe('escalated')
    expect(swap().offered_to_all_at).toBe(NOW.toISOString())
    // C and D were not standbys, B already had the standby text: only C and D are asked now.
    expect(keys(r => r.channel === 'in_app' && r.dedupe_key.startsWith(`cover_all:${swap().id}:`))).toEqual([`cover_all:${swap().id}:c`, `cover_all:${swap().id}:d`])
    // Allie: in-app notes, and NO email for the FYI alerts.
    expect(notes(r => r.member_id === null && r.channel === 'email' && /cover_(escalated|offered|requested)/.test(r.dedupe_key))).toHaveLength(0)
    expect(keys(r => r.member_id === null && r.channel === 'in_app')).toEqual(expect.arrayContaining([`cover_offered:${swap().id}`, `cover_escalated:${swap().id}`]))
    // The offer says nothing about pay or rates.
    const offer = tx.email.mock.calls.find(c => c[0] === 'c@example.test')![1]
    expect(offer.email.text).not.toMatch(/\$|rate|two parties/i)
  })

  it('does it once: the next tick asks nobody and writes nothing new', async () => {
    world()
    await releaseMySpot(ctx(), AUTO, db.tables.crew_members.find(m => m.id === 'a') as any, 's-a', 'sick', null)
    NOW = new Date(NOW.getTime() + 3 * H)
    refreshMembers()
    await runCovers(jobs(), members)
    const n = notes().length
    const sent = tx.email.mock.calls.length
    NOW = new Date(NOW.getTime() + 5 * 60_000)
    refreshMembers()
    const again = await runCovers(jobs(), members)
    expect(again.autoOffered).toBe(0)
    expect(notes()).toHaveLength(n)
    expect(tx.email.mock.calls.length).toBe(sent)
  })

  it('Allie is emailed only if it is STILL unclaimed at the 48-hour mark', async () => {
    world()
    await releaseMySpot(ctx(), AUTO, db.tables.crew_members.find(m => m.id === 'a') as any, 's-a', 'sick', null)
    NOW = new Date(NOW.getTime() + 3 * H)
    refreshMembers()
    await runCovers(jobs(), members)
    const toAllie = () => tx.email.mock.calls.filter(c => c[0] === 'alerts@example.test')
    expect(toAllie()).toHaveLength(0)

    // 47 h before the party: not yet.
    NOW = new Date(new Date(START).getTime() - 49 * H)
    refreshMembers()
    await runCovers(jobs(), members)
    expect(toAllie()).toHaveLength(0)
    // 48 h before: the one email.
    NOW = new Date(new Date(START).getTime() - 47 * H)
    refreshMembers()
    expect((await runCovers(jobs(), members)).warned).toBe(1)
    expect(toAllie()).toHaveLength(1)
    expect(toAllie()[0][1].email.subject).toMatch(/Still uncovered at 48 hours/)
    await runCovers(jobs(), members)
    expect(toAllie()).toHaveLength(1)
  })

  it('a cancel inside 48 hours does not email Allie before the open offer has had a window', async () => {
    seed({
      crew_members: [person('a'), person('b'), person('allie', { is_owner: true, can_lead: true, email: null })],
      crew_parties: [party('p1', 0, { starts_at: iso(NOW.getTime() + 30 * H), ends_at: iso(NOW.getTime() + 33 * H) })],
      crew_slots: [slot('s-lead', 'p1', 'allie', 'lead'), slot('s-a', 'p1', 'a'), slot('s-open', 'p1', null)],
      crew_standbys: [{ id: 'sb1', party_id: 'p1', member_id: 'b', withdrawn_at: null }],
    })
    await releaseMySpot(ctx(), AUTO, db.tables.crew_members.find(m => m.id === 'a') as any, 's-a', 'sick', null)
    NOW = new Date(NOW.getTime() + 3 * H)
    refreshMembers()
    const out = await runCovers(jobs(), members)
    expect(out.autoOffered).toBe(1)
    expect(out.warned).toBe(0)
    expect(tx.email.mock.calls.filter(c => c[0] === 'alerts@example.test')).toHaveLength(0)
    NOW = new Date(NOW.getTime() + 2 * H)
    refreshMembers()
    expect((await runCovers(jobs(), members)).warned).toBe(1)
  })

  it('when nobody is free to be asked, that is the one thing that emails Allie at once', async () => {
    seed({
      crew_members: [person('a'), person('allie', { is_owner: true, can_lead: true, email: null })],
      crew_parties: [party('p1', 0, { starts_at: START, ends_at: endOf(START) })],
      crew_slots: [slot('s-lead', 'p1', 'allie', 'lead'), slot('s-a', 'p1', 'a'), slot('s-open', 'p1', null)],
    })
    await openCoverNobodyToAsk(ctx(), AUTO, db, db.tables.crew_members.find(m => m.id === 'a') as any, 's-a', 'sick')
    refreshMembers()
    // No standby → escalated at once by the request itself; the next tick offers.
    const out = await runCovers(jobs(), members)
    expect(out.autoOffered).toBe(1)
    const mail = tx.email.mock.calls.filter(c => c[0] === 'alerts@example.test')
    expect(mail).toHaveLength(1)
    expect(mail[0][1].email.subject).toMatch(/Nobody free to cover/)
  })
})

describe('the waitlist: backup crew get first pick when a spot is handed back, however early', () => {
  it('a release 9 days out asks the waitlisted who are free — and only them', async () => {
    seed({
      crew_members: [person('a'), person('b'), person('c'), person('d'), person('allie', { is_owner: true, can_lead: true, email: null })],
      crew_parties: [party('p1', 9)],
      crew_slots: [slot('s-lead', 'p1', 'allie', 'lead'), slot('s-a', 'p1', 'a'), slot('s-x', 'p1', 'c')],
      crew_standbys: [
        { id: 'sb1', party_id: 'p1', member_id: 'b', withdrawn_at: null },
        { id: 'sb2', party_id: 'p1', member_id: 'd', withdrawn_at: null },
        { id: 'sb3', party_id: 'p1', member_id: 'c', withdrawn_at: null }, // already on it
      ],
      crew_unavailability: [{ member_id: 'd', day: startIn(9).slice(0, 10), part: 'all_day' }], // blocked that day
    })
    const r = await releaseMySpot({ sb: db.sb, now: NOW, senders: tx }, AUTO, db.tables.crew_members.find(m => m.id === 'a') as any, 's-a', 'family', null)
    expect(r).toMatchObject({ kind: 'requested', asked: 1 })
    expect(keys(k => k.channel === 'in_app' && k.dedupe_key.startsWith('cover:'))).toHaveLength(1)
    expect(keys(k => k.channel === 'in_app' && k.dedupe_key.startsWith('cover:'))[0]).toMatch(/:b$/)
    expect(db.tables.crew_slots.find(s => s.id === 's-a')).toMatchObject({ status: 'assigned', member_id: 'a' })
    const mail = tx.email.mock.calls.find(c => c[0] === 'b@example.test')![1]
    expect(mail.email.text).toMatch(/up on the waitlist, so you get first pick/)
    expect(mail.email.text).toMatch(/we'll ask the next person/)
    expect(mail.email.text).not.toMatch(/\$|rate/i)
  })
})

describe('one whole tick', () => {
  it('announces a party that is months away the day it goes up (found by when it was published)', async () => {
    seed({
      crew_members: [person('a')],
      crew_parties: [party('far', 60)],
      crew_slots: [slot('f-c', 'far', null)],
    })
    const out = await runCrewJobs(jobs())
    expect(out.asks.newParty).toBe(1)
    expect(keys()).toContain('new_party:far:a')
  })

  it('publishes, asks and alerts — and a second tick sends nothing new', async () => {
    seed({
      crew_members: [person('a'), person('b'), person('allie', { is_owner: true, can_lead: true, email: null })],
      crew_parties: [party('fresh', 20, { status: 'draft', published_at: null, created_at: '2026-11-04T12:00:00Z' }), party('close', 4)],
      crew_slots: [slot('f-l', 'fresh', null, 'lead'), slot('f-c', 'fresh', null), slot('c-l', 'close', null, 'lead'), slot('c-c', 'close', 'a')],
    })
    const first = await runCrewJobs(jobs())
    expect(first).toMatchObject({ ok: true, autoPublished: 1, understaffed: 1 })
    expect(first.asks.newParty + first.asks.nudges).toBeGreaterThan(0)
    const n = notes().length
    const mail = tx.email.mock.calls.length
    const second = await runCrewJobs(jobs())
    expect(second).toMatchObject({ ok: true, autoPublished: 0, understaffed: 0 })
    expect(second.asks).toEqual({ newParty: 0, nudges: 0 })
    expect(notes()).toHaveLength(n)
    expect(tx.email.mock.calls.length).toBe(mail)
    // No text was ever sent: CREW_SMS_ENABLED is off.
    expect(tx.sms).not.toHaveBeenCalled()
  })
})
