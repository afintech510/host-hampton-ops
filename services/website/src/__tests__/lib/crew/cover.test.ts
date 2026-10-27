/**
 * Crew Phase 4: "can't make it", cover, the cron's jobs and a crew text to the
 * Quo line — driven against `fakeCrewDb` with migration 077's release / claim /
 * drop functions standing in (`fakeCoverRpc`; the real ones are proven in
 * production by scripts/crew/race-test.mjs), and fake providers.
 */
import { DEFAULT_SETTINGS, type CrewSettings } from '@/lib/crew/rules'
import { assignCover, claimCover, dropAnyway, offerToEveryone, releaseMySpot, withdrawCover } from '@/lib/crew/cover'
import { runConfirmations, runCovers, runCrewJobs, runPartyAlerts, type JobsCtx } from '@/lib/crew/jobs'
import { handleCrewInboundSms, isConfirmReply } from '@/lib/crew/inbound'
import type { CrewSenders } from '@/lib/crew/notify'
import { fakeCoverRpc, fakeCrewDb, type FakeCrewDb } from '../../helpers/fakeCrewDb'

const H = 3_600_000
let NOW = new Date('2026-11-02T15:00:00Z')            // Mon 10:00 EST
const START = '2026-11-05T18:00:00.000Z'              // Thu 1 PM EST: 75 h out, a late cancel
const END = '2026-11-05T21:00:00.000Z'
const S: CrewSettings = DEFAULT_SETTINGS              // no launch date: in grace
const LIVE: CrewSettings = { ...DEFAULT_SETTINGS, launch: { launchDate: '2026-01-01', graceDays: 0 } }

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

describe('a late cancel', () => {
  it('asks ONLY the standbys who could work it, tells Allie with the reason, and leaves the canceller on', async () => {
    const r = await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', 'flu')
    expect(r).toMatchObject({ kind: 'requested', asked: 1, escalated: false })
    const swap = db.tables.crew_swap_requests[0]
    expect(keys()).toEqual([`cover:${swap.id}:b`, `cover_requested:${swap.id}`])
    // Not C (blocked), not D/E (not standbys), not the owner, not A.
    expect(db.tables.crew_slots.find(s => s.id === 's-a')).toMatchObject({ status: 'assigned', member_id: 'a' })
    const alert = notes(r => r.template === 'coverRequested' && r.channel === 'email')[0]
    expect(alert.status).toBe('sent')
    expect(tx.email.mock.calls.find(c => c[0] === 'alerts@example.test')![1].email.text).toMatch(/reason: sick: flu/)
    // The cover offer to B never names the reason.
    const offer = tx.email.mock.calls.find(c => c[0] === 'b@example.test')![1]
    expect(JSON.stringify(offer)).not.toMatch(/sick|flu/)
    expect(swap.standbys_notified_at).toBe(NOW.toISOString())
  })

  it('an invented test member is never asked about a REAL party', async () => {
    member('b').is_test = true
    const r = await releaseMySpot(ctx(), S, member('a'), 's-a', 'sick', null)
    expect(r).toMatchObject({ kind: 'requested', asked: 0, escalated: true })
    expect(notes(n => n.member_id === 'b')).toHaveLength(0)
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
    const r = await releaseMySpot(ctx(), S, member('a'), 's-a', 'family', null)
    expect(r).toMatchObject({ kind: 'requested', asked: 0, escalated: true })
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
    expect(await claimCover(ctx(), S, member('e'), swap.id)).toEqual({ kind: 'refused', status: 409, error: 'Someone just took it.' })
    const offered = await offerToEveryone(ctx(), S, swap.id, 'admin:allie@example.test')
    // B, D and E are free; C blocked the day; A is the canceller; the owner is never asked.
    expect(offered).toEqual({ kind: 'ok', asked: 3 })
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

describe('an early release', () => {
  beforeEach(() => {
    db.tables.crew_parties[0].starts_at = '2026-11-20T18:00:00.000Z'
    db.tables.crew_parties[0].ends_at = '2026-11-20T21:00:00.000Z'
  })

  it('opens the spot, costs a step outside grace, and tells the member and Allie', async () => {
    const r = await releaseMySpot(ctx(), LIVE, member('a'), 's-a', 'school', null)
    expect(r).toMatchObject({ kind: 'released', waived: false, rateCents: 5100 + 2 * 250 })
    expect(member('a').steps).toBe(2)
    expect(db.tables.crew_slots.find(s => s.id === 's-a')).toMatchObject({ status: 'open', member_id: null })
    expect(keys().some(k => k.startsWith('early_release:s-a:'))).toBe(true)
    expect(keys().some(k => k.startsWith('spot_released:s-a:'))).toBe(true)
  })

  it('in grace the step is recorded and not applied', async () => {
    const r = await releaseMySpot(ctx(), S, member('a'), 's-a', 'school', null)
    expect(r).toMatchObject({ kind: 'released', waived: true })
    expect(member('a').steps).toBe(3)
    expect(db.tables.crew_events[0]).toMatchObject({ type: 'early_release', waived_grace: true })
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

  it('requests at 120 h (once), reminds only after 12 h, alerts Allie after the deadline — never the owner', async () => {
    NOW = new Date(Date.parse(START) - 119 * H)
    expect((await runConfirmations(jobs(), parties(), byId())).requests).toBe(1)
    expect((await runConfirmations(jobs(), parties(), byId())).requests).toBe(0)
    NOW = new Date(Date.parse(START) - 95 * H)
    expect((await runConfirmations(jobs(), parties(), byId())).reminders).toBe(1)
    NOW = new Date(Date.parse(START) - 71 * H)
    expect((await runConfirmations(jobs(), parties(), byId())).overdue).toBe(1)
    expect((await runConfirmations(jobs(), parties(), byId())).overdue).toBe(0)
    expect(notes(r => r.member_id === 'allie')).toHaveLength(0)
  })

  it('Allie on the Lead spot, unconfirmed, is never asked and never reported to herself', async () => {
    db.tables.crew_slots.find(s => s.id === 's-lead').confirmed_at = null
    NOW = new Date(Date.parse(START) - 119 * H)
    await runConfirmations(jobs(), parties(), byId())
    NOW = new Date(Date.parse(START) - 60 * H)
    await runConfirmations(jobs(), parties(), byId())
    expect(keys().filter(k => k.includes('s-lead'))).toEqual([])
  })

  it('a cron that first runs AFTER the reminder time sends the request, not request + reminder at once', async () => {
    NOW = new Date(Date.parse(START) - 90 * H)
    const r = await runConfirmations(jobs(), parties(), byId())
    expect(r).toMatchObject({ requests: 1, reminders: 0, overdue: 0 })
  })

  it('"tomorrow" goes only inside its window, and only to someone on it before then', async () => {
    NOW = new Date(Date.parse(START) - 23 * H)
    expect((await runConfirmations(jobs(), parties(), byId())).dayBefore).toBe(1)
    seed()
    NOW = new Date(Date.parse(START) - 10 * H)
    expect((await runConfirmations(jobs(), parties(), byId())).dayBefore).toBe(0)
  })

  it('the no-Lead alert fires 7 days out for a party with no Lead, never for a studio rental', async () => {
    db.tables.crew_slots = [slot('s-lead', null, { role: 'lead' }), slot('s-a', 'a')]
    db.tables.crew_parties.push(party({ id: 'p2', booking_id: 'b2', party_kind: 'studio_rental' }))
    db.tables.crew_slots.push(slot('s-r', null, { party_id: 'p2' }))
    const ps = [
      { party: db.tables.crew_parties[0] as any, slots: db.tables.crew_slots.filter(s => s.party_id === 'p1') as any[] },
      { party: db.tables.crew_parties[1] as any, slots: db.tables.crew_slots.filter(s => s.party_id === 'p2') as any[] },
    ]
    expect((await runPartyAlerts(jobs(), ps)).noLead).toBe(1)
    expect(keys()).toEqual(['no_lead:p1'])
  })

  it('attendance not marked 12 h after the end alerts Allie once', async () => {
    NOW = new Date(Date.parse(END) + 13 * H)
    expect((await runPartyAlerts(jobs(), parties())).attendance).toBe(1)
    expect((await runPartyAlerts(jobs(), parties())).attendance).toBe(0)
  })

  it('test scope touches TEST parties only', async () => {
    NOW = new Date(Date.parse(START) - 119 * H)
    expect((await runConfirmations(jobs('test'), parties(), byId())).requests).toBe(0)
    db.tables.crew_parties[0] = { ...db.tables.crew_parties[0], booking_id: null, title: 'TEST — Glow' }
    expect((await runConfirmations(jobs('test'), parties(), byId())).requests).toBe(0) // A is not a test member
    member('a').is_test = true
    expect((await runConfirmations(jobs('test'), [{ party: db.tables.crew_parties[0] as any, slots: db.tables.crew_slots as any[] }], byId())).requests).toBe(1)
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
