/**
 * Crew Phase 4: "can't make it", cover, the cron's jobs and a crew text to the
 * Quo line — driven against `fakeCrewDb` with migration 077's release / claim /
 * drop functions standing in (`fakeCoverRpc`; the real ones are proven in
 * production by scripts/crew/race-test.mjs), and fake providers.
 */
import { DEFAULT_SETTINGS, type CrewSettings } from '@/lib/crew/rules'
import { LADDER_ON } from '../../helpers/crewLadder'
import { assignCover, autoOfferToEveryone, claimCover, coverOptions, dropAnyway, eligibleFor, offerToEveryone, releaseMySpot, withdrawCover } from '@/lib/crew/cover'
import { runConfirmations, runCovers, runCrewJobs, runPartyAlerts, type JobsCtx } from '@/lib/crew/jobs'
import { handleCrewInboundSms, isConfirmReply } from '@/lib/crew/inbound'
import type { CrewSenders } from '@/lib/crew/notify'
import { templates } from '@/lib/crew/templates'
import { fakeCoverRpc, fakeCrewDb, type FakeCrewDb } from '../../helpers/fakeCrewDb'
import { openCoverNobodyToAsk } from '../../helpers/openCover'

const H = 3_600_000
let NOW = new Date('2026-11-02T15:00:00Z')            // Mon 10:00 EST
const START = '2026-11-05T18:00:00.000Z'              // Thu 1 PM EST: 75 h out, a late cancel
const END = '2026-11-05T21:00:00.000Z'
// The step arithmetic below runs with the pay ladder ON (it is OFF at launch: see the launch-mode blocks).
const S: CrewSettings = LADDER_ON                     // no launch date: in grace
const LIVE: CrewSettings = { ...LADDER_ON, launch: { launchDate: '2026-01-01', graceDays: 0 } }
// LAUNCH MODE: ladder and pay figures off. `OFF` is in grace, `OFF_LIVE` is past it.
const OFF: CrewSettings = DEFAULT_SETTINGS
const OFF_LIVE: CrewSettings = { ...DEFAULT_SETTINGS, launch: { launchDate: '2026-01-01', graceDays: 0 } }

const person = (id: string, over: Record<string, unknown> = {}) => ({
  id, first_name: id.toUpperCase(), last_name: null, email: `${id}@example.test`, phone: null, steps: 3, can_lead: false,
  is_owner: false, is_test: false, skills: [], status: 'active', needs_review: false, sms_opt_in: false, sms_opt_in_at: null,
  email_opt_in: true, admin_notes: null, job_application_id: null, joined_on: '2026-10-01', created_at: `2026-10-01T00:00:0${id.length}Z`,
  updated_at: '2026-10-01T00:00:00Z', ...over,
})

const party = (over: Record<string, unknown> = {}) => ({
  id: 'p1', booking_id: 'b1', party_kind: 'in_studio_theme', title: 'Glow Party', theme: 'Glow Party', starts_at: START, ends_at: END,
  guest_count: 12, location: '295 Montauk Hwy', notes_for_crew: null, slots_override: null, extra_flat_cents: 0, status: 'published',
  published_at: '2026-10-20T00:00:00Z', attendance_marked_at: null, cancelled_at: null, sync_flags: [], ...over,
})

const slot = (id: string, member: string | null, over: Record<string, unknown> = {}) => ({
  id, party_id: 'p1', role: 'crew', status: member ? 'assigned' : 'open', member_id: member, assigned_at: member ? '2026-10-20T00:00:00Z' : null,
  assigned_via: member ? 'claim' : null, assigned_by: null, confirmed_at: null, covered_swap_id: null, created_at: '2026-10-20T00:00:00Z', ...over,
})

function senders(): CrewSenders & { sms: jest.Mock; email: jest.Mock } {
  return { sms: jest.fn(async () => 'quo-1'), email: jest.fn(async () => ({ kind: 'sent' as const, providerId: 're-1' })) } as any
}

const ENV = { ...process.env }
let db: FakeCrewDb
let tx: ReturnType<typeof senders>

function seed() {
  db = fakeCrewDb({
    crew_members: [
      person('a'), person('b'), person('c'), person('d'), person('e'),
      person('allie', { is_owner: true, can_lead: true, email: null }),
    ],
    crew_parties: [party()],
    crew_slots: [slot('s-lead', 'allie', { role: 'lead', confirmed_at: '2026-10-20T00:00:00Z' }), slot('s-a', 'a'), slot('s-open', null)],
    crew_standbys: [
      { id: 'sb1', party_id: 'p1', member_id: 'b', withdrawn_at: null },
      { id: 'sb2', party_id: 'p1', member_id: 'c', withdrawn_at: null },
    ],
    // C is a standby but has blocked the day: never asked.
    crew_unavailability: [{ member_id: 'c', day: '2026-11-05', part: 'all_day' }],
    crew_recurring_blocks: [],
    crew_settings: [{ key: 'drops', value: { late_drop_days: 7, standby_window_hours: 2, unclaimed_warning_hours: 48 } }],
    crew_swap_requests: [],
    crew_notifications: [],
    crew_events: [],
    contacts: [],
  }, { rpc: fakeCoverRpc(() => NOW) })
  tx = senders()
}

const ctx = () => ({ sb: db.sb, now: NOW, senders: tx })
const jobs = (scope: 'all' | 'test' = 'all', s: CrewSettings = S): JobsCtx => ({ ...ctx(), settings: s, scope })
const notes = (f: (r: any) => boolean = () => true) => db.tables.crew_notifications.filter(f)
const keys = (f: (r: any) => boolean = r => r.channel === 'in_app') => notes(f).map(r => r.dedupe_key).sort()
const member = (id: string) => db.tables.crew_members.find(m => m.id === id) as any

beforeEach(() => {
  process.env = { ...ENV, CREW_ENABLED: 'true', CREW_SMS_ENABLED: 'false', CREW_ADMIN_EMAIL: 'alerts@example.test' }
  NOW = new Date('2026-11-02T15:00:00Z')
  seed()
})
afterAll(() => { process.env = ENV })

describe('coverOptions: what Find Cover shows before it texts anyone', () => {
  beforeEach(() => {
    member('d').last_name = 'Rivera'
    db.tables.crew_unavailability = []
  })

  it('lists the waitlisted who are free as the ones it would text, and the free others to ask yourself', async () => {
    const r = await coverOptions(db.sb, S, member('a'), 's-a', NOW)
    expect(r).toEqual({ kind: 'ok', data: { role: 'crew', live: null, standbys: ['B', 'C'], others: ['D R.', 'E'] } })
  })

  it('leaves out the owner, the person asking, anyone blocked that day, and anyone already on the party', async () => {
    db.tables.crew_unavailability = [{ member_id: 'c', day: '2026-11-05', part: 'all_day' }]
    db.tables.crew_slots.push(slot('s-e', 'e'))
    const r = await coverOptions(db.sb, S, member('a'), 's-a', NOW)
    expect(r).toMatchObject({ kind: 'ok', data: { standbys: ['B'], others: ['D R.'] } })
  })

  it('never carries a phone number or an email — only a name', async () => {
    member('b').phone = '+16315550101'
    const r = await coverOptions(db.sb, S, member('a'), 's-a', NOW)
    expect(JSON.stringify(r)).not.toMatch(/\+1631|@example|\d{7}/)
  })

  it('says so when a request is already open, with how many it went to', async () => {
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    const swap = db.tables.crew_swap_requests[0]
    const r = await coverOptions(db.sb, S, member('a'), 's-a', NOW)
    expect(r).toMatchObject({ kind: 'ok', data: { live: { swapId: swap.id, asked: 1 } } })
  })

  it('is null for a spot that is not yours, or a party that has started', async () => {
    expect(await coverOptions(db.sb, S, member('b'), 's-a', NOW)).toEqual({ kind: 'ok', data: null })
    expect(await coverOptions(db.sb, S, member('a'), 's-a', new Date(Date.parse(START) + 60_000))).toEqual({ kind: 'ok', data: null })
  })

  it('changes nothing: no request, no message, no event', async () => {
    await coverOptions(db.sb, S, member('a'), 's-a', NOW)
    expect(db.tables.crew_swap_requests).toHaveLength(0)
    expect(db.tables.crew_notifications).toHaveLength(0)
    expect(db.tables.crew_events).toHaveLength(0)
  })
})

describe('a late cancel', () => {
  it('asks ONLY the standbys who could work it, tells Allie with the reason, and leaves the canceller on', async () => {
    const r = await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', 'flu')
    expect(r).toMatchObject({ kind: 'requested', asked: 1, escalated: false })
    const swap = db.tables.crew_swap_requests[0]
    expect(keys()).toEqual([`cover:${swap.id}:b`, `cover_requested:${swap.id}`])
    // Not C (blocked), not D/E (not standbys), not the owner, not A.
    expect(db.tables.crew_slots.find(s => s.id === 's-a')).toMatchObject({ status: 'assigned', member_id: 'a' })
    // FYI alerts are in-app only (autopilot handles it): the reason is on the page, never in Allie's inbox.
    const alert = notes(r => r.template === 'coverRequested')
    expect(alert.map(r => r.channel)).toEqual(['in_app'])
    expect(alert[0].payload.text).toMatch(/reason: sick: flu/)
    expect(tx.email.mock.calls.some(c => c[0] === 'alerts@example.test')).toBe(false)
    // The cover offer to B never names the reason.
    const offer = tx.email.mock.calls.find(c => c[0] === 'b@example.test')![1]
    expect(JSON.stringify(offer)).not.toMatch(/sick|flu/)
    expect(swap.standbys_notified_at).toBe(NOW.toISOString())
  })

  it('an invented test member is never asked about a REAL party — so with only one on the waitlist, nothing opens', async () => {
    member('b').is_test = true
    const r = await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    expect(r).toMatchObject({ kind: 'refused', status: 409 })
    expect(db.tables.crew_swap_requests).toHaveLength(0)
    expect(notes(n => n.member_id === 'b')).toHaveLength(0)
    expect(db.tables.crew_slots.find(s => s.id === 's-a')).toMatchObject({ status: 'assigned', member_id: 'a' })
  })

  it('with nobody on the waitlist who could work it, nothing is written and nobody is told', async () => {
    db.tables.crew_standbys = []
    const before = notes().length
    const r = await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    expect(r.kind).toBe('refused')
    expect((r as { error: string }).error).toMatch(/waitlist/)
    expect(db.tables.crew_swap_requests).toHaveLength(0)
    expect(notes()).toHaveLength(before)
    expect(db.rpcCalls.some(c => c.fn === 'crew_release_slot')).toBe(false)
  })

  it('with someone on the waitlist it is a request however far off the party is — and the canceller stays on', async () => {
    db.tables.crew_parties[0].starts_at = '2026-12-20T18:00:00.000Z'
    db.tables.crew_parties[0].ends_at = '2026-12-20T21:00:00.000Z'
    db.tables.crew_unavailability = []
    const r = await releaseMySpot(ctx(), S, member('a'), 's-a', 'school', null)
    expect(r).toMatchObject({ kind: 'requested', asked: 1, escalated: false })
    expect(db.rpcCalls.find(c => c.fn === 'crew_release_slot')!.args).toMatchObject({ p_kind: 'late_cancel' })
    expect(db.tables.crew_slots.find(s => s.id === 's-a')).toMatchObject({ status: 'assigned', member_id: 'a' })
    expect(member('a').steps).toBe(3)
    expect(db.tables.crew_events).toHaveLength(0)
  })

  it('only the person who asked can withdraw it', async () => {
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    const swap = db.tables.crew_swap_requests[0]
    expect((await withdrawCover(ctx(), S, member('b'), swap.id)).kind).toBe('refused')
    expect(swap.status).toBe('open')
  })

  it('a second "can\'t make it" on the same spot asks nobody twice', async () => {
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    const n = notes().length
    expect((await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)).kind).toBe('already_requested')
    expect(notes()).toHaveLength(n)
  })

  it('with nobody to ask it escalates to Allie at once — even when the DB clock runs ahead of the app', async () => {
    db.tables.crew_standbys = []
    // The real created_at is the database's now(), after this request's `now`.
    const rpc = fakeCoverRpc(() => new Date(NOW.getTime() + 50))
    db.sb.rpc = async (fn: string, args: any) => { db.rpcCalls.push({ fn, args }); return rpc(fn, args, db) }
    const r = await openCoverNobodyToAsk(ctx(), S, db, member('a'), 's-a', 'family')
    expect(r).toMatchObject({ kind: 'ok', data: { asked: 0, escalated: true } })
    expect(db.tables.crew_swap_requests[0].status).toBe('escalated')
    expect(keys()).toContain(`cover_escalated:${db.tables.crew_swap_requests[0].id}`)
  })

  it('a standby claims: both are told, Allie too, and the canceller’s steps do not move', async () => {
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    const swap = db.tables.crew_swap_requests[0]
    expect(await claimCover(ctx(), S, member('b'), swap.id)).toEqual({ kind: 'ok' })
    expect(db.tables.crew_slots.find(s => s.id === 's-a')).toMatchObject({ member_id: 'b', assigned_via: 'cover', covered_swap_id: swap.id })
    expect(member('a').steps).toBe(3)
    expect(keys()).toEqual(expect.arrayContaining([`covered:${swap.id}`, `cover_claimed:${swap.id}`, `cover_taken:${swap.id}`]))
    // A second claimer gets the plain answer.
    expect(await claimCover(ctx(), S, member('e'), swap.id)).toEqual({ kind: 'refused', status: 409, error: 'Someone just took it.' })
  })

  it('a member who is not a standby is refused until Allie offers it to everyone', async () => {
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    const swap = db.tables.crew_swap_requests[0]
    expect(await claimCover(ctx(), S, member('e'), swap.id)).toEqual({ kind: 'refused', status: 409, error: expect.stringContaining('offered to other people') })
    const offered = await offerToEveryone(ctx(), S, swap.id, 'admin:allie@example.test')
    // D and E are free. B was already asked in the standby round (not asked twice), C blocked the
    // day, A is the canceller, and the owner is never asked.
    expect(offered).toEqual({ kind: 'ok', asked: 2 })
    expect(keys(r => r.template === 'coverOpen' && r.channel === 'in_app')).toEqual([`cover_all:${swap.id}:d`, `cover_all:${swap.id}:e`])
    expect((await offerToEveryone(ctx(), S, swap.id, 'admin:allie@example.test')).kind).toBe('refused')
    expect(await claimCover(ctx(), S, member('e'), swap.id)).toEqual({ kind: 'ok' })
    expect(notes(r => r.template === 'coverOfferedToAll')[0].payload.actor).toBe('admin:allie@example.test')
  })

  it('a member blocked that day is refused even after it is offered to everyone', async () => {
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    const swap = db.tables.crew_swap_requests[0]
    await offerToEveryone(ctx(), S, swap.id, 'admin:x')
    const r = await claimCover(ctx(), S, member('c'), swap.id)
    expect(r.kind).toBe('refused')
    expect(db.tables.crew_slots.find(s => s.id === 's-a').member_id).toBe('a')
  })

  it('Allie assigns cover (herself included) through crew_claim_swap as admin', async () => {
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    const swap = db.tables.crew_swap_requests[0]
    expect(await assignCover(ctx(), S, swap.id, 'e', 'admin:allie@example.test')).toEqual({ kind: 'ok' })
    const call = db.rpcCalls.find(c => c.fn === 'crew_claim_swap')!
    expect(call.args).toMatchObject({ p_member_id: 'e', p_by_admin: true, p_actor: 'admin:allie@example.test' })
  })

  it('withdraw closes it once; drop anyway resets the rate outside grace and records-not-applies inside it', async () => {
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    const swap = db.tables.crew_swap_requests[0]
    expect(await withdrawCover(ctx(), S, member('a'), swap.id)).toEqual({ kind: 'ok' })
    expect((await withdrawCover(ctx(), S, member('a'), swap.id)).kind).toBe('refused')

    // In grace: recorded, not applied.
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    const sw2 = db.tables.crew_swap_requests[1]
    expect(await dropAnyway(ctx(), S, member('a'), sw2.id)).toEqual({ kind: 'ok' })
    expect(member('a').steps).toBe(3)
    expect(db.tables.crew_events.at(-1)).toMatchObject({ type: 'late_cancel_uncovered', step_before: 3, step_after: 3, waived_grace: true })
    // BOTH the member and Allie are told — Allie's alert used to share the member's key and was swallowed.
    expect(notes(r => r.template === 'droppedUncovered' && r.member_id === 'a' && r.channel === 'in_app')).toHaveLength(1)
    const allie = notes(r => r.template === 'droppedUncovered' && r.member_id === null)
    expect(allie.map(r => `${r.channel}:${r.status}`).sort()).toEqual(['email:sent', 'in_app:sent'])
    expect(tx.email.mock.calls.some(c => c[0] === 'alerts@example.test' && /URGENT open spot/.test(c[1].email.subject))).toBe(true)

    // Out of grace: reset to 0.
    seed()
    await releaseMySpot(ctx(), LIVE, member('a'), 's-a', 'sick', null)
    const sw3 = db.tables.crew_swap_requests[0]
    await dropAnyway(ctx(), LIVE, member('a'), sw3.id)
    expect(member('a').steps).toBe(0)
  })
})

describe('the cron: cover requests', () => {
  it('escalates after the standby window, warns at 48 h, expires at the start — each exactly once', async () => {
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    const swap = db.tables.crew_swap_requests[0]
    const byId = new Map(db.tables.crew_members.map(m => [m.id, m as any]))

    NOW = new Date(NOW.getTime() + 1 * H)
    expect((await runCovers(jobs(), byId)).escalated).toBe(0)
    NOW = new Date(NOW.getTime() + 1.5 * H)
    expect((await runCovers(jobs(), byId)).escalated).toBe(1)
    expect((await runCovers(jobs(), byId)).escalated).toBe(0)
    expect(swap.status).toBe('escalated')

    NOW = new Date(Date.parse(START) - 47 * H)
    expect((await runCovers(jobs(), byId)).warned).toBe(1)
    expect((await runCovers(jobs(), byId)).warned).toBe(0)
    expect(keys()).toEqual(expect.arrayContaining([`cover_warn:${swap.id}`, `cover_unclaimed:${swap.id}`]))

    NOW = new Date(Date.parse(START) + 60_000)
    expect((await runCovers(jobs(), byId)).expired).toBe(1)
    expect(swap.status).toBe('expired')
    expect(db.tables.crew_events.filter(e => e.type !== 'early_release')).toHaveLength(0)
  })
})

describe('the cron: confirmations and alerts', () => {
  const byId = () => new Map(db.tables.crew_members.map(m => [m.id, m as any]))
  const parties = () => [{ party: db.tables.crew_parties[0] as any, slots: db.tables.crew_slots as any[] }]

  it('reminds 3 days before (once) and never asks anyone to confirm, never alerts about confirming, never the owner', async () => {
    NOW = new Date(Date.parse(START) - 100 * H)
    expect((await runConfirmations(jobs(), parties(), byId())).threeDay).toBe(0)
    NOW = new Date(Date.parse(START) - 71 * H)
    expect((await runConfirmations(jobs(), parties(), byId())).threeDay).toBe(1)
    expect((await runConfirmations(jobs(), parties(), byId())).threeDay).toBe(0)
    // Nothing between the two reminders, and no confirmation traffic of any kind.
    NOW = new Date(Date.parse(START) - 40 * H)
    expect(await runConfirmations(jobs(), parties(), byId())).toMatchObject({ threeDay: 0, dayBefore: 0 })
    expect(keys().some(k => /confirm_request|confirm_reminder|unconfirmed/.test(k))).toBe(false)
    expect(notes(r => r.member_id === 'allie')).toHaveLength(0)
  })

  it("the 3-day reminder is a statement, not a question: 'you're working', no Y, no confirm", () => {
    const t = templates.threeDay({ theme: 'Glow Party', dayLabel: 'Sat Nov 14', timeLabel: '1-4 PM', shiftLabel: '12:30-4:30 PM', url: 'https://www.hosthampton.com/crew/parties/x' } as any)
    for (const body of [t.sms, t.email.text, t.inApp]) {
      expect(body).toMatch(/you're working Glow Party/)
      expect(body).not.toMatch(/confirm|reply y|yes or no|accept/i)
    }
  })

  it('Allie on the Lead spot is never reminded or reported to herself', async () => {
    db.tables.crew_slots.find(s => s.id === 's-lead').confirmed_at = null
    NOW = new Date(Date.parse(START) - 71 * H)
    await runConfirmations(jobs(), parties(), byId())
    NOW = new Date(Date.parse(START) - 23 * H)
    await runConfirmations(jobs(), parties(), byId())
    expect(keys().filter(k => k.includes('s-lead'))).toEqual([])
  })

  it('a cron that first runs inside the 3-day window still sends it once, and one that first runs after the window sends nothing', async () => {
    NOW = new Date(Date.parse(START) - 67 * H)
    expect(await runConfirmations(jobs(), parties(), byId())).toMatchObject({ threeDay: 1 })
    seed()
    NOW = new Date(Date.parse(START) - 60 * H)
    expect(await runConfirmations(jobs(), parties(), byId())).toMatchObject({ threeDay: 0 })
  })

  it('"tomorrow" goes only inside its window, and only to someone on it before then', async () => {
    NOW = new Date(Date.parse(START) - 23 * H)
    expect((await runConfirmations(jobs(), parties(), byId())).dayBefore).toBe(1)
    seed()
    NOW = new Date(Date.parse(START) - 10 * H)
    expect((await runConfirmations(jobs(), parties(), byId())).dayBefore).toBe(0)
  })

  describe('the understaffed alert (one per party, shared with the page)', () => {
    const DAY = 24 * H
    const at = (daysOut: number) => new Date(Date.parse(START) - daysOut * DAY)
    // p1: a themed party, Lead spot open, the one crew spot held.
    const noLead = () => {
      db.tables.crew_slots = [slot('s-lead', null, { role: 'lead' }), slot('s-a', 'a')]
      return [{ party: db.tables.crew_parties[0] as any, slots: db.tables.crew_slots as any[] }]
    }
    // p2: a studio rental; there is no Lead spot at all.
    const rental = (crew: (string | null)[]) => {
      db.tables.crew_parties.push(party({ id: 'p2', booking_id: 'b2', party_kind: 'studio_rental' }))
      const rows = crew.map((m, i) => slot(`s-r${i}`, m, { party_id: 'p2' }))
      db.tables.crew_slots.push(...rows)
      return [{ party: db.tables.crew_parties[1] as any, slots: rows as any[] }]
    }

    it('fires for a themed party with no Lead inside the Lead window, once, and emails Allie', async () => {
      const ps = noLead()
      NOW = at(6)
      expect((await runPartyAlerts(jobs(), ps)).understaffed).toBe(1)
      expect(keys()).toEqual(['understaffed:p1'])
      const email = notes(r => r.template === 'understaffed' && r.channel === 'email')
      expect(email).toHaveLength(1)
      const sent = tx.email.mock.calls.find(c => c[0] === 'alerts@example.test')![1]
      expect(sent.email.subject).toMatch(/Short on crew/)
      expect(sent.email.text).toMatch(/still needs a Party Lead\./)
      expect((await runPartyAlerts(jobs(), ps)).understaffed).toBe(0)
      expect(notes(r => r.template === 'understaffed')).toHaveLength(2)   // in_app + email, no more
    })

    it('a missing Lead is told at the Lead window (7 days), a short crew only at the crew window (5 days)', async () => {
      const ps = noLead()
      NOW = at(8)
      expect((await runPartyAlerts(jobs(), ps)).understaffed).toBe(0)
      // Lead held, one crew spot open: not short until 5 days out.
      db.tables.crew_slots = [slot('s-lead', 'allie', { role: 'lead' }), slot('s-a', null)]
      const crewShort = [{ party: db.tables.crew_parties[0] as any, slots: db.tables.crew_slots as any[] }]
      NOW = at(6)
      expect((await runPartyAlerts(jobs(), crewShort)).understaffed).toBe(0)
      NOW = at(4)
      expect((await runPartyAlerts(jobs(), crewShort)).understaffed).toBe(1)
      expect(tx.email.mock.calls.find(c => c[0] === 'alerts@example.test')![1].email.text).toMatch(/still needs 1 crew spot\./)
    })

    it('a studio rental with every spot held is never short, however close the day', async () => {
      const ps = rental(['a', 'b'])
      NOW = at(1)
      expect((await runPartyAlerts(jobs(), ps)).understaffed).toBe(0)
      expect(notes(r => r.template === 'understaffed')).toHaveLength(0)
    })

    it('a studio rental with an open crew spot is short of CREW only — never of a Lead', async () => {
      const ps = rental(['a', null])
      NOW = at(4)
      expect((await runPartyAlerts(jobs(), ps)).understaffed).toBe(1)
      expect(keys()).toEqual(['understaffed:p2'])
      const text = tx.email.mock.calls.find(c => c[0] === 'alerts@example.test')![1].email.text as string
      expect(text).toMatch(/still needs 1 crew spot\./)
      expect(text).not.toMatch(/Party Lead/)
    })

    it('the setting moves the moment: understaffed_days_before 9 tells a short crew 9 days out', async () => {
      const wide: CrewSettings = { ...S, autopilot: { ...S.autopilot, understaffedDaysBefore: 9 } }
      const ps = rental([null])
      NOW = at(8)
      expect((await runPartyAlerts(jobs('all', wide), ps)).understaffed).toBe(1)
    })
  })

  it('attendance not marked 12 h after the end alerts Allie once', async () => {
    NOW = new Date(Date.parse(END) + 13 * H)
    expect((await runPartyAlerts(jobs(), parties())).attendance).toBe(1)
    expect((await runPartyAlerts(jobs(), parties())).attendance).toBe(0)
  })

  it('test scope touches TEST parties only', async () => {
    NOW = new Date(Date.parse(START) - 71 * H)
    expect((await runConfirmations(jobs('test'), parties(), byId())).threeDay).toBe(0)
    db.tables.crew_parties[0] = { ...db.tables.crew_parties[0], booking_id: null, title: 'TEST — Glow' }
    expect((await runConfirmations(jobs('test'), parties(), byId())).threeDay).toBe(0) // A is not a test member
    member('a').is_test = true
    expect((await runConfirmations(jobs('test'), [{ party: db.tables.crew_parties[0] as any, slots: db.tables.crew_slots as any[] }], byId())).threeDay).toBe(1)
  })
})

describe('the whole tick, twice', () => {
  it('the second run writes no new notification', async () => {
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    NOW = new Date(Date.parse(START) - 47 * H)
    const first = await runCrewJobs(jobs())
    expect(first.ok).toBe(true)
    const n = notes().length
    expect(n).toBeGreaterThan(0)
    const second = await runCrewJobs(jobs())
    expect(second.ok).toBe(true)
    expect(notes()).toHaveLength(n)
  })

  it('a failed read is ok:false with the job named, never an empty success', async () => {
    db.failOn.add('select:crew_parties')
    const r = await runCrewJobs(jobs())
    expect(r.ok).toBe(false)
    expect(r.unavailable).toContain('parties')
  })
})

// ── LAUNCH MODE and AUTOPILOT ───────────────────────────────────────────────

/** Anything that tells a crew member their pay moves, or what it is. */
const LADDER_WORDS = /\b(rate|rates|step|steps|ladder|reset|two parties|counts as)\b/i
const mailTo = (addr: string) => tx.email.mock.calls.filter(c => c[0] === addr).map(c => c[1].email as { subject: string; text: string })
const noMoneyTalk = (text: string) => {
  expect(text).not.toContain('$')
  expect(text).not.toMatch(LADDER_WORDS)
}

describe('LAUNCH MODE: the pay ladder is off', () => {
  describe('a release far from the party', () => {
    beforeEach(() => {
      db.tables.crew_parties[0].starts_at = '2026-11-20T18:00:00.000Z'
      db.tables.crew_parties[0].ends_at = '2026-11-20T21:00:00.000Z'
      db.tables.crew_unavailability = []
    })

    it('is a cover request that moves no step — the canceller stays on, even past the launch grace', async () => {
      const r = await releaseMySpot(ctx(), OFF_LIVE, member('a'), 's-a', 'school', null)
      expect(r.kind).toBe('requested')
      expect(member('a').steps).toBe(3)
      expect(db.tables.crew_slots.find(s => s.id === 's-a')).toMatchObject({ status: 'assigned', member_id: 'a' })
      expect(db.tables.crew_events).toHaveLength(0)
      expect(db.rpcCalls.find(c => c.fn === 'crew_release_slot')!.args).toMatchObject({ p_kind: 'late_cancel', p_expected_steps: 3, p_steps_after: 3 })
    })

    it('tells the waitlist nothing about a rate, and Allie in the app only', async () => {
      await releaseMySpot(ctx(), OFF_LIVE, member('a'), 's-a', 'school', null)
      const mail = mailTo('b@example.test')
      expect(mail).toHaveLength(1)
      noMoneyTalk(mail[0].text)
      noMoneyTalk(mail[0].subject)
      expect(notes(r => r.template === 'coverRequested').map(r => r.channel)).toEqual(['in_app'])
      expect(tx.email.mock.calls.some(c => c[0] === 'alerts@example.test')).toBe(false)
    })
  })

  describe('a late cancel', () => {
    it('drop anyway releases the spot and resets nothing, past the grace too', async () => {
      await releaseMySpot(ctx(), OFF_LIVE, member('a'), 's-a', 'sick', null)
      const swap = db.tables.crew_swap_requests[0]
      expect(await dropAnyway(ctx(), OFF_LIVE, member('a'), swap.id)).toEqual({ kind: 'ok' })
      expect(member('a').steps).toBe(3)
      expect(db.tables.crew_events.at(-1)).toMatchObject({ type: 'late_cancel_uncovered', step_before: 3, step_after: 3, waived_grace: false })
      expect(db.tables.crew_slots.find(s => s.id === 's-a')).toMatchObject({ status: 'open', member_id: null })
      for (const m of mailTo('a@example.test')) { noMoneyTalk(m.text); noMoneyTalk(m.subject) }
      // This one still needs a person: Allie is emailed.
      expect(mailTo('alerts@example.test').some(m => /URGENT open spot/.test(m.subject))).toBe(true)
    })

    it('the offer, the claim and the thank-you carry no pay figure and no ladder wording', async () => {
      await releaseMySpot(ctx(), OFF, member('a'), 's-a', 'sick', null)
      const swap = db.tables.crew_swap_requests[0]
      await claimCover(ctx(), OFF, member('b'), swap.id)
      const toB = mailTo('b@example.test')
      expect(toB.length).toBeGreaterThanOrEqual(2)           // the offer, then "thanks for covering"
      for (const m of toB) { noMoneyTalk(m.text); noMoneyTalk(m.subject) }
      for (const m of mailTo('a@example.test')) { noMoneyTalk(m.text); noMoneyTalk(m.subject) }
    })

    it('with the ladder on, the same offer carries the pay figure', async () => {
      await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
      const offer = mailTo('b@example.test')[0]
      expect(offer.text).toContain('$')
    })

    it('an offer to everyone free carries no pay figure either', async () => {
      await releaseMySpot(ctx(), OFF, member('a'), 's-a', 'sick', null)
      const swap = db.tables.crew_swap_requests[0]
      await offerToEveryone(ctx(), OFF, swap.id, 'admin:allie@example.test')
      const toE = mailTo('e@example.test')
      expect(toE).toHaveLength(1)
      noMoneyTalk(toE[0].text)
    })
  })

  describe('which alerts email Allie and which are for the page only', () => {
    it('FYI alerts (spot released, cover requested, withdrawn, escalated, taken) are in-app only', async () => {
      await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
      const swap = db.tables.crew_swap_requests[0]
      await withdrawCover(ctx(), S, member('a'), swap.id)
      await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
      const sw2 = db.tables.crew_swap_requests[1]
      await claimCover(ctx(), S, member('b'), sw2.id)
      const fyi = ['coverRequested', 'coverWithdrawn', 'coverTaken']
      for (const t of fyi) {
        const rows = notes(r => r.template === t)
        expect(rows.length).toBeGreaterThan(0)
        expect(rows.every(r => r.channel === 'in_app')).toBe(true)
      }
      expect(mailTo('alerts@example.test')).toHaveLength(0)
    })

    it('an escalation is in-app only; the 48-hour "still uncovered" warning is an email', async () => {
      await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
      const swap = db.tables.crew_swap_requests[0]
      const byId = new Map(db.tables.crew_members.map(m => [m.id, m as any]))
      NOW = new Date(NOW.getTime() + 2.5 * H)
      await runCovers(jobs(), byId)
      expect(notes(r => r.template === 'coverEscalated').map(r => r.channel)).toEqual(['in_app'])
      NOW = new Date(Date.parse(START) - 47 * H)
      await runCovers(jobs(), byId)
      expect(swap.status).toBe('escalated')
      expect(notes(r => r.template === 'coverUnclaimed').map(r => r.channel).sort()).toEqual(['email', 'in_app'])
      expect(mailTo('alerts@example.test').map(m => m.subject)).toEqual([expect.stringMatching(/Still uncovered at 48 hours/)])
    })
  })
})

describe('AUTOPILOT: a late cancel nobody took is offered to everyone free', () => {
  const byId = () => new Map(db.tables.crew_members.map(m => [m.id, m as any]))

  it('the cron escalates and offers it in the same tick, to the people the standby round did not reach', async () => {
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    const swap = db.tables.crew_swap_requests[0]
    NOW = new Date(NOW.getTime() + 2.5 * H)
    const r = await runCovers(jobs(), byId())
    expect(r).toMatchObject({ escalated: 1, autoOffered: 1 })
    expect(swap.offered_to_all_at).toBe(NOW.toISOString())
    // D and E; B was a standby and already has the request, C is blocked, A is the canceller.
    expect(keys(n => n.template === 'coverOpen' && n.channel === 'in_app')).toEqual([`cover_all:${swap.id}:d`, `cover_all:${swap.id}:e`])
    // The record says the system did it.
    expect(notes(n => n.dedupe_key === `cover_all:${swap.id}`)[0].payload).toMatchObject({ actor: 'system:crew-autopilot', asked: 2 })
    // Allie is told it happened — on the page. 2 offered + 1 standby = 3 asked.
    const told = notes(n => n.template === 'coverOfferedToAll' && n.dedupe_key === `cover_offered:${swap.id}`)
    expect(told.map(n => n.channel)).toEqual(['in_app'])
    expect(told[0].payload.text).toMatch(/offered to 3 crew members/)
    expect(mailTo('alerts@example.test')).toHaveLength(0)
  })

  it('once: the next tick offers nothing and writes nothing', async () => {
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    NOW = new Date(NOW.getTime() + 2.5 * H)
    await runCovers(jobs(), byId())
    const n = notes().length
    expect((await runCovers(jobs(), byId())).autoOffered).toBe(0)
    expect(notes()).toHaveLength(n)
  })

  it('Allie hears "still uncovered" only one standby window AFTER the offer, even past the 48-hour mark', async () => {
    NOW = new Date(Date.parse(START) - 49 * H)
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    const swap = db.tables.crew_swap_requests[0]
    NOW = new Date(Date.parse(START) - 47 * H)                  // created + 2 h: escalates now, past the 48-hour mark
    const first = await runCovers(jobs(), byId())
    expect(first).toMatchObject({ escalated: 1, autoOffered: 1, warned: 0 })
    expect(swap.warned_at ?? null).toBeNull()
    expect(notes(n => n.template === 'coverUnclaimed')).toHaveLength(0)
    NOW = new Date(NOW.getTime() + 1 * H)
    expect((await runCovers(jobs(), byId())).warned).toBe(0)
    NOW = new Date(NOW.getTime() + 1 * H)                       // one standby window after the offer
    expect((await runCovers(jobs(), byId())).warned).toBe(1)
    expect(notes(n => n.template === 'coverUnclaimed' && n.channel === 'email')).toHaveLength(1)
  })

  it('nobody free at all is the one case that emails Allie', async () => {
    db.tables.crew_standbys = []
    for (const id of ['b', 'd', 'e']) db.tables.crew_unavailability.push({ member_id: id, day: '2026-11-05', part: 'all_day' })
    await openCoverNobodyToAsk(ctx(), S, db, member('a'), 's-a', 'family')    // no standbys: escalated at once
    const swap = db.tables.crew_swap_requests[0]
    expect(swap.status).toBe('escalated')
    const out = await autoOfferToEveryone(ctx(), S, swap, db.tables.crew_parties[0] as any)
    expect(out).toBe('nobody_free')
    const rows = notes(n => n.template === 'coverNobodyFree')
    expect(rows.map(n => n.channel).sort()).toEqual(['email', 'in_app'])
    expect(rows[0].dedupe_key).toBe(`cover_nobody:${swap.id}`)
    expect(mailTo('alerts@example.test').some(m => /Nobody free to cover/.test(m.subject))).toBe(true)
    expect(notes(n => n.template === 'coverOfferedToAll' && n.dedupe_key.startsWith('cover_offered:'))).toHaveLength(0)
  })

  it('a standby who was asked counts as somebody asked: no "nobody free" email', async () => {
    for (const id of ['d', 'e']) db.tables.crew_unavailability.push({ member_id: id, day: '2026-11-05', part: 'all_day' })
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)      // B (a standby) is asked; D and E are blocked
    const swap = db.tables.crew_swap_requests[0]
    swap.status = 'escalated'
    const out = await autoOfferToEveryone(ctx(), S, swap, db.tables.crew_parties[0] as any)
    expect(out).toBe('offered')
    expect(notes(n => n.template === 'coverNobodyFree')).toHaveLength(0)
    expect(mailTo('alerts@example.test')).toHaveLength(0)
  })

  it('a request that was already offered (or closed) is "not_needed", and sends nothing', async () => {
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    const swap = db.tables.crew_swap_requests[0]
    await offerToEveryone(ctx(), S, swap.id, 'admin:allie@example.test')
    const n = notes().length
    expect(await autoOfferToEveryone(ctx(), S, swap, db.tables.crew_parties[0] as any)).toBe('not_needed')
    expect(notes()).toHaveLength(n)
  })

  it('a failed read in the middle gives the claim back, so the next tick tries again', async () => {
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    const swap = db.tables.crew_swap_requests[0]
    swap.status = 'escalated'
    db.failOn.add('select:crew_notifications')                 // askedMemberIds cannot read
    const out = await autoOfferToEveryone(ctx(), S, swap, db.tables.crew_parties[0] as any)
    expect(out).toBe('unavailable')
    expect(swap.offered_to_all_at ?? null).toBeNull()
    db.failOn.delete('select:crew_notifications')
    expect(await autoOfferToEveryone(ctx(), S, swap, db.tables.crew_parties[0] as any)).toBe('offered')
  })
})

describe('a TEST party is never offered to a real person', () => {
  beforeEach(() => {
    db.tables.crew_parties[0] = party({ booking_id: null, title: 'TEST — Glow' }) as any
    for (const id of ['a', 'b', 'e']) member(id).is_test = true
  })
  const pws = () => ({ party: db.tables.crew_parties[0] as any, slots: db.tables.crew_slots as any[] })

  it('eligibleFor keeps the invented members and drops the real ones', async () => {
    const r = await eligibleFor(db.sb, S, pws(), 'crew', 'all', ['a'])
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    // D is real: refused. C blocked the day. The owner is never asked.
    expect(r.data.map(m => m.id).sort()).toEqual(['b', 'e'])
  })

  it('a real party still refuses the invented ones (the old rule, unchanged)', async () => {
    db.tables.crew_parties[0] = party() as any
    const r = await eligibleFor(db.sb, S, pws(), 'crew', 'all', ['a'])
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.data.map(m => m.id)).toEqual(['d'])
  })

  it('a late cancel on a TEST party asks the invented standby, and offer-to-everyone only the other invented members', async () => {
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    const swap = db.tables.crew_swap_requests[0]
    expect(keys(n => n.template === 'coverOffer' && n.channel === 'in_app')).toEqual([`cover:${swap.id}:b`])
    const offered = await offerToEveryone(ctx(), S, swap.id, 'admin:allie@example.test')
    expect(offered).toEqual({ kind: 'ok', asked: 1 })
    expect(notes(n => n.member_id === 'd')).toHaveLength(0)
  })
})

describe('a text from a crew phone (Quo inbound)', () => {
  beforeEach(() => {
    Object.assign(member('a'), { phone: '+15555550111', sms_opt_in: true })
    NOW = new Date(Date.parse(START) - 100 * H)
  })
  const inbound = (text: string, from = '(555) 555-0111') => handleCrewInboundSms({ sb: db.sb, now: NOW, from, text, messageId: 'msg-1', senders: tx })

  it('Y confirms the earliest due spot, YES too, and creates no contact', async () => {
    expect(await inbound('y')).toEqual({ kind: 'handled', action: 'confirmed' })
    expect(db.tables.crew_slots.find(s => s.id === 's-a').confirmed_at).toBe(NOW.toISOString())
    expect(await inbound('YES!')).toEqual({ kind: 'handled', action: 'nothing_to_confirm' })
    expect(db.tables.contacts).toHaveLength(0)
  })

  it('before the request has gone out there is nothing to confirm', async () => {
    NOW = new Date(Date.parse(START) - 130 * H)
    expect(await inbound('Y')).toEqual({ kind: 'handled', action: 'nothing_to_confirm' })
    expect(db.tables.crew_slots.find(s => s.id === 's-a').confirmed_at).toBeNull()
  })

  it('STOP turns crew texts off', async () => {
    expect(await inbound('STOP')).toEqual({ kind: 'handled', action: 'opt_out' })
    expect(member('a').sms_opt_in).toBe(false)
  })

  it('another number is not crew; the owner and a removed member never match', async () => {
    expect(await inbound('Y', '+15555550999')).toEqual({ kind: 'not_crew' })
    member('a').status = 'removed'
    expect(await inbound('Y')).toEqual({ kind: 'not_crew' })
  })

  it('a failed roster read is unavailable, so the webhook asks Quo to retry', async () => {
    db.failOn.add('select:crew_members')
    expect((await inbound('STOP')).kind).toBe('unavailable')
  })

  it('isConfirmReply is exact', () => {
    expect(['Y', 'y', ' yes ', 'YES.'].every(isConfirmReply)).toBe(true)
    expect(['yes but late', 'Yeah', 'N', ''].some(isConfirmReply)).toBe(false)
  })
})

// ── Ranked cover: one standby at a time, whoever worked least recently first ─

describe('ranked cover', () => {
  const byId = () => new Map(db.tables.crew_members.map(m => [m.id, m as any]))
  const askedKeys = () => keys(r => r.template === 'coverOffer' && r.channel === 'in_app')

  beforeEach(() => {
    db.tables.crew_unavailability = []
    db.tables.crew_standbys = ['b', 'c', 'd'].map(m => ({ id: `sb-${m}`, party_id: 'p1', member_id: m, withdrawn_at: null }))
    // b worked two days ago, d worked a month ago, c has never worked.
    db.tables.crew_parties.push(
      party({ id: 'past-b', booking_id: 'bb', status: 'completed', starts_at: '2026-10-31T18:00:00.000Z', ends_at: '2026-10-31T21:00:00.000Z' }),
      party({ id: 'past-d', booking_id: 'bd', status: 'completed', starts_at: '2026-10-01T18:00:00.000Z', ends_at: '2026-10-01T21:00:00.000Z' }),
    )
    db.tables.crew_slots.push(
      slot('h-b', 'b', { party_id: 'past-b', status: 'completed' }),
      slot('h-d', 'd', { party_id: 'past-d', status: 'completed' }),
    )
  })

  it('asks ONLY the person who worked least recently, and says who is next in Find Cover', async () => {
    const options = await coverOptions(db.sb, S, member('a'), 's-a', NOW)
    expect(options).toMatchObject({ kind: 'ok', data: { standbys: ['C', 'D', 'B'] } })
    const r = await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    expect(r).toMatchObject({ kind: 'requested', asked: 1, escalated: false })
    const swap = db.tables.crew_swap_requests[0]
    expect(askedKeys()).toEqual([`cover:${swap.id}:c`])
  })

  it('a standby who has not been asked yet cannot take the spot early; the one asked can', async () => {
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    const swap = db.tables.crew_swap_requests[0]
    expect(await claimCover(ctx(), S, member('b'), swap.id)).toMatchObject({ kind: 'refused', status: 409 })
    expect(db.tables.crew_slots.find(s => s.id === 's-a').member_id).toBe('a')
    expect(await claimCover(ctx(), S, member('c'), swap.id)).toEqual({ kind: 'ok' })
    expect(db.tables.crew_slots.find(s => s.id === 's-a').member_id).toBe('c')
  })

  it('asks the next person only after a full turn, then the next, then escalates when nobody is left', async () => {
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    const swap = db.tables.crew_swap_requests[0]

    NOW = new Date(NOW.getTime() + 1 * H)
    expect(await runCovers(jobs(), byId())).toMatchObject({ advanced: 0, escalated: 0 })
    expect(askedKeys()).toHaveLength(1)

    NOW = new Date(NOW.getTime() + 1.5 * H)                       // 2.5 h: c's turn is over
    expect(await runCovers(jobs(), byId())).toMatchObject({ advanced: 1, escalated: 0 })
    expect(askedKeys()).toEqual([`cover:${swap.id}:c`, `cover:${swap.id}:d`])
    expect((await runCovers(jobs(), byId())).advanced).toBe(0)    // d's turn has only just begun

    NOW = new Date(NOW.getTime() + 2.5 * H)                       // d's turn is over: b
    expect(await runCovers(jobs(), byId())).toMatchObject({ advanced: 1, escalated: 0 })
    expect(askedKeys()).toEqual([`cover:${swap.id}:b`, `cover:${swap.id}:c`, `cover:${swap.id}:d`])

    NOW = new Date(NOW.getTime() + 2.5 * H)                       // b's turn is over and nobody is left
    expect(await runCovers(jobs(), byId())).toMatchObject({ advanced: 0, escalated: 1 })
    expect(swap.status).toBe('escalated')
  })

  it('the person asked second can take it once their turn has come', async () => {
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    const swap = db.tables.crew_swap_requests[0]
    NOW = new Date(NOW.getTime() + 2.5 * H)
    await runCovers(jobs(), byId())
    expect(await claimCover(ctx(), S, member('d'), swap.id)).toEqual({ kind: 'ok' })
  })

  it('a text held for quiet hours does not use up the first person\'s turn', async () => {
    NOW = new Date('2026-11-03T04:00:00Z')                        // 11 PM EST: texts wait until 8 AM
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    const swap = db.tables.crew_swap_requests[0]
    NOW = new Date('2026-11-03T12:30:00Z')                        // 7:30 AM: five hours on, still before their text goes
    expect((await runCovers(jobs(), byId())).advanced).toBe(0)
    NOW = new Date('2026-11-03T14:00:00Z')                        // 9 AM: an hour after it could go
    expect((await runCovers(jobs(), byId())).advanced).toBe(0)
    NOW = new Date('2026-11-03T15:30:00Z')                        // 10:30 AM: a full window after 8 AM
    expect((await runCovers(jobs(), byId())).advanced).toBe(1)
    expect(askedKeys()).toEqual([`cover:${swap.id}:c`, `cover:${swap.id}:d`])
  })

  it('once it is offered to everyone, anyone free may take it', async () => {
    await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    const swap = db.tables.crew_swap_requests[0]
    await offerToEveryone(ctx(), S, swap.id, 'admin:allie@example.test')
    expect(await claimCover(ctx(), S, member('b'), swap.id)).toEqual({ kind: 'ok' })
  })
})
