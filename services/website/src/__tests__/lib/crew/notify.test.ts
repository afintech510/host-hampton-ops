/**
 * Crew Phase 4: the one send path (lib/crew/notify.ts). Driven against
 * `fakeCrewDb`, which enforces `(dedupe_key, channel)` as Postgres does, with
 * fake providers so nothing reaches Quo or Resend.
 */
import { drainCrewQueue, messageDayLabel, messageTimeLabel, notifyAdmin, notifyMember, type CrewSenders } from '@/lib/crew/notify'
import { templates } from '@/lib/crew/templates'
import { fakeCrewDb, type FakeCrewDb } from '../../helpers/fakeCrewDb'

const OPEN_HOUR = new Date('2026-11-02T15:00:00Z')   // 10:00 EST
const QUIET = new Date('2026-11-03T03:00:00Z')       // 22:00 EST the night before
const NEXT_8AM = '2026-11-03T13:00:00.000Z'

const member = (over: Record<string, unknown> = {}) => ({
  id: 'm-1', first_name: 'Sam', last_name: null, email: 'sam@example.test', phone: '+15555550101', steps: 2, can_lead: false,
  is_owner: false, is_test: false, skills: [], status: 'active', needs_review: false, sms_opt_in: true, sms_opt_in_at: null,
  email_opt_in: true, admin_notes: null, job_application_id: null, joined_on: '2026-10-01', created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z', ...over,
})

const ref = { theme: 'Glow Party', dayLabel: 'Thu Nov 5', timeLabel: '1–4 PM', setupLabel: '12:30 PM', url: 'https://www.hosthampton.com/crew' }

function senders(): CrewSenders & { sms: jest.Mock; email: jest.Mock } {
  return {
    sms: jest.fn(async () => 'quo-msg-1'),
    email: jest.fn(async () => ({ kind: 'sent' as const, providerId: 'resend-1' })),
  } as any
}

const ENV = { ...process.env }
let db: FakeCrewDb
beforeEach(() => {
  process.env = { ...ENV, CREW_ENABLED: 'true', CREW_SMS_ENABLED: 'true', CREW_ADMIN_EMAIL: 'alerts@example.test' }
  db = fakeCrewDb({ crew_members: [member()] })
})
afterAll(() => { process.env = ENV })

const rows = (filter: (r: any) => boolean = () => true) => (db.tables.crew_notifications ?? []).filter(filter)

describe('notifyMember: who is messaged at all', () => {
  it('never the owner, and writes nothing for her', async () => {
    const s = senders()
    const r = await notifyMember({ sb: db.sb, now: OPEN_HOUR, senders: s }, member({ is_owner: true }) as any, 'confirmed', templates.confirmed(ref), 'k1')
    expect(r).toEqual({ kind: 'owner' })
    expect(rows()).toHaveLength(0)
    expect(s.sms).not.toHaveBeenCalled()
  })

  it('a REAL member while CREW_ENABLED is off: held, nothing written; a test member still goes', async () => {
    process.env.CREW_ENABLED = 'false'
    const s = senders()
    const ctx = { sb: db.sb, now: OPEN_HOUR, senders: s }
    expect(await notifyMember(ctx, member() as any, 'confirmed', templates.confirmed(ref), 'k1')).toEqual({ kind: 'held', reason: 'crew_disabled' })
    expect(rows()).toHaveLength(0)
    const t = await notifyMember(ctx, member({ id: 'm-test', is_test: true }) as any, 'confirmed', templates.confirmed(ref), 'k2')
    expect(t.kind).toBe('done')
    expect(rows(r => r.member_id === 'm-test' && r.dedupe_key === 'k2').map(r => r.channel).sort()).toEqual(['email', 'in_app', 'sms'])
  })

  it('a member who is not active is held', async () => {
    const r = await notifyMember({ sb: db.sb, now: OPEN_HOUR, senders: senders() }, member({ status: 'paused' }) as any, 'confirmed', templates.confirmed(ref), 'k1')
    expect(r).toEqual({ kind: 'held', reason: 'inactive' })
    expect(rows()).toHaveLength(0)
  })
})

describe('notifyMember: channels', () => {
  it('in_app always, email when opted in, and a skipped SMS row that says WHY when SMS is off', async () => {
    process.env.CREW_SMS_ENABLED = 'false'
    const s = senders()
    const r = await notifyMember({ sb: db.sb, now: OPEN_HOUR, senders: s }, member() as any, 'confirmed', templates.confirmed(ref), 'confirmed:x')
    expect(r).toEqual({ kind: 'done', channels: { in_app: 'sent', email: 'sent', sms: 'skipped' } })
    expect(s.email).toHaveBeenCalledTimes(1)
    expect(s.sms).not.toHaveBeenCalled()
    expect(rows(r => r.channel === 'sms')[0]).toMatchObject({ status: 'skipped', error: 'CREW_SMS_ENABLED is off' })
    expect(rows(r => r.channel === 'email')[0]).toMatchObject({ status: 'sent', provider_id: 'resend-1' })
  })

  it('the same dedupe key again sends NOTHING on any channel', async () => {
    const s = senders()
    const ctx = { sb: db.sb, now: OPEN_HOUR, senders: s }
    await notifyMember(ctx, member() as any, 'confirmed', templates.confirmed(ref), 'confirmed:x')
    const again = await notifyMember(ctx, member() as any, 'confirmed', templates.confirmed(ref), 'confirmed:x')
    expect(again).toEqual({ kind: 'done', channels: { in_app: 'duplicate', email: 'duplicate', sms: 'duplicate' } })
    expect(s.email).toHaveBeenCalledTimes(1)
    expect(s.sms).toHaveBeenCalledTimes(1)
  })

  it('no SMS without the member’s own opt-in, nor without a phone', async () => {
    const s = senders()
    await notifyMember({ sb: db.sb, now: OPEN_HOUR, senders: s }, member({ sms_opt_in: false }) as any, 'confirmed', templates.confirmed(ref), 'a')
    await notifyMember({ sb: db.sb, now: OPEN_HOUR, senders: s }, member({ id: 'm-2', phone: null }) as any, 'confirmed', templates.confirmed(ref), 'b')
    expect(s.sms).not.toHaveBeenCalled()
    expect(rows(r => r.channel === 'sms').map(r => r.error).sort()).toEqual(['no phone on file', 'sms_opt_in is off'])
  })

  it('the FIRST text carries the opt-out disclosure, the second does not, and both are GSM-7', async () => {
    const s = senders()
    const ctx = { sb: db.sb, now: OPEN_HOUR, senders: s }
    await notifyMember(ctx, member() as any, 'confirmed', templates.confirmed(ref), 'one')
    await notifyMember(ctx, member() as any, 'confirmed', templates.confirmed(ref), 'two')
    const [first, second] = s.sms.mock.calls.map(c => c[1] as string)
    expect(first).toMatch(/Reply STOP to opt out/)
    expect(second).not.toMatch(/Reply STOP/)
    for (const body of [first, second]) {
      expect(body).not.toMatch(/[—–’]/)
      expect(body).toMatch(/- Allie, Host Hampton/)
    }
    expect(rows(r => r.dedupe_key === 'sms_disclosure:m-1')[0]).toMatchObject({ status: 'sent', provider_id: 'quo-msg-1' })
  })

  it('a failed text is recorded failed, and the disclosure rides on the next one instead', async () => {
    const s = senders()
    s.sms.mockResolvedValueOnce(null)
    const ctx = { sb: db.sb, now: OPEN_HOUR, senders: s }
    expect((await notifyMember(ctx, member() as any, 'confirmed', templates.confirmed(ref), 'one') as any).channels.sms).toBe('failed')
    await notifyMember(ctx, member() as any, 'confirmed', templates.confirmed(ref), 'two')
    expect(s.sms.mock.calls[1][1]).toMatch(/Reply STOP to opt out/)
    expect(rows(r => r.dedupe_key === 'one' && r.channel === 'sms')[0].status).toBe('failed')
  })

  it('HELP is answered even without the opt-in (the carrier expects it), but never with SMS switched off', async () => {
    const s = senders()
    await notifyMember({ sb: db.sb, now: OPEN_HOUR, senders: s }, member({ sms_opt_in: false }) as any, 'smsHelp', templates.smsHelp(), 'h1', { helpReply: true })
    expect(s.sms).toHaveBeenCalledTimes(1)
    process.env.CREW_SMS_ENABLED = 'false'
    await notifyMember({ sb: db.sb, now: OPEN_HOUR, senders: s }, member({ sms_opt_in: false }) as any, 'smsHelp', templates.smsHelp(), 'h2', { helpReply: true })
    expect(s.sms).toHaveBeenCalledTimes(1)
  })
})

describe('quiet hours DEFER, never cancel, and the queue delivers', () => {
  it('a 10pm text is queued for 8am and nothing is sent', async () => {
    const s = senders()
    const r = await notifyMember({ sb: db.sb, now: QUIET, senders: s }, member() as any, 'confirmRequest', templates.confirmRequest(ref, 'Wed'), 'q1')
    expect((r as any).channels.sms).toBe('deferred')
    expect(s.sms).not.toHaveBeenCalled()
    const q = rows(r => r.channel === 'sms')[0]
    expect(q).toMatchObject({ status: 'queued', scheduled_for: NEXT_8AM })
    expect(q.error).toMatch(/quiet_hours/)
    // Email is not a telephone rule: it went at once.
    expect(s.email).toHaveBeenCalledTimes(1)
  })

  it('the drain sends it once at 8am, and a second drain sends nothing', async () => {
    const s = senders()
    await notifyMember({ sb: db.sb, now: QUIET, senders: s }, member() as any, 'confirmed', templates.confirmed(ref), 'q1')
    const at8 = new Date('2026-11-03T13:05:00Z')
    expect((await drainCrewQueue({ sb: db.sb, now: QUIET, senders: s })).scanned).toBe(0)
    const d1 = await drainCrewQueue({ sb: db.sb, now: at8, senders: s })
    expect(d1).toMatchObject({ sent: 1, failed: 0, skipped: 0 })
    expect(s.sms).toHaveBeenCalledTimes(1)
    const d2 = await drainCrewQueue({ sb: db.sb, now: at8, senders: s })
    expect(d2.scanned).toBe(0)
    expect(s.sms).toHaveBeenCalledTimes(1)
  })

  it('a queued row that is past the freshness bound is skipped with the reason, not sent', async () => {
    db.tables.crew_notifications = [{ id: 'n1', member_id: 'm-1', channel: 'sms', template: 'confirmed', dedupe_key: 'old', status: 'queued',
      scheduled_for: '2026-10-29T13:00:00.000Z', payload: { sms: 'old news' } }]
    const s = senders()
    const d = await drainCrewQueue({ sb: db.sb, now: OPEN_HOUR, senders: s })
    expect(d).toMatchObject({ skipped: 1, sent: 0 })
    expect(s.sms).not.toHaveBeenCalled()
    expect(db.tables.crew_notifications[0].error).toMatch(/^stale: /)
  })

  it('consent is re-read at send time: an opt-out since queueing stops the text', async () => {
    const s = senders()
    await notifyMember({ sb: db.sb, now: QUIET, senders: s }, member() as any, 'confirmed', templates.confirmed(ref), 'q1')
    db.tables.crew_members[0].sms_opt_in = false
    const d = await drainCrewQueue({ sb: db.sb, now: new Date('2026-11-03T13:05:00Z'), senders: s })
    expect(d.skipped).toBe(1)
    expect(s.sms).not.toHaveBeenCalled()
  })

  it('a held cover offer is dropped once somebody took the cover', async () => {
    db.tables.crew_swap_requests = [{ id: 'sw1', status: 'claimed' }]
    const s = senders()
    await notifyMember({ sb: db.sb, now: QUIET, senders: s }, member() as any, 'coverOffer', templates.coverOffer('Jo', ref, 'crew', '$56.00'), 'cover:sw1:m-1',
      { payload: { swap_id: 'sw1' } })
    const d = await drainCrewQueue({ sb: db.sb, now: new Date('2026-11-03T13:05:00Z'), senders: s })
    expect(d.skipped).toBe(1)
    expect(db.tables.crew_notifications.find(r => r.channel === 'sms').error).toMatch(/no longer true/)
  })

  it("the reconcile's queued partyCancelled notice is rendered from its facts and delivered", async () => {
    db.tables.crew_notifications = [{ id: 'n1', member_id: 'm-1', channel: 'email', template: 'partyCancelled', dedupe_key: 'party_cancelled:p:m-1',
      status: 'queued', scheduled_for: '2026-11-02T14:00:00.000Z', payload: { party_id: 'p', theme: 'Glow Party', day_label: 'Thu, Nov 5', time_label: '1 PM – 4 PM' } }]
    const s = senders()
    const d = await drainCrewQueue({ sb: db.sb, now: OPEN_HOUR, senders: s })
    expect(d.sent).toBe(1)
    expect(s.email.mock.calls[0][1].email.subject).toBe('Cancelled: Glow Party, Thu, Nov 5')
  })

  it('a test-scope drain never touches a real member’s row', async () => {
    db.tables.crew_notifications = [{ id: 'n1', member_id: 'm-1', channel: 'sms', template: 'confirmed', dedupe_key: 'k', status: 'queued',
      scheduled_for: '2026-11-02T14:00:00.000Z', payload: { sms: 'x' } }]
    const s = senders()
    const d = await drainCrewQueue({ sb: db.sb, now: OPEN_HOUR, senders: s }, { memberFilter: m => m.is_test })
    expect(d).toMatchObject({ sent: 0, skipped: 0 })
    expect(db.tables.crew_notifications[0].status).toBe('queued')
    expect(s.sms).not.toHaveBeenCalled()
  })

  it('a row another tick already claimed is not sent again', async () => {
    db.tables.crew_notifications = [{ id: 'n1', member_id: 'm-1', channel: 'sms', template: 'confirmed', dedupe_key: 'k', status: 'sending',
      scheduled_for: '2026-11-02T14:00:00.000Z', payload: { sms: 'x' } }]
    const s = senders()
    expect((await drainCrewQueue({ sb: db.sb, now: OPEN_HOUR, senders: s })).scanned).toBe(0)
    expect(s.sms).not.toHaveBeenCalled()
  })
})

describe('notifyAdmin', () => {
  it('an in-app row with no member and an email to CREW_ADMIN_EMAIL, once; TEST alerts say so', async () => {
    const s = senders()
    const ctx = { sb: db.sb, now: OPEN_HOUR, senders: s }
    expect(await notifyAdmin(ctx, 'noLead', { subject: 'No Lead', text: 't' }, 'no_lead:p', { test: true })).toEqual({ in_app: 'sent', email: 'sent' })
    expect(await notifyAdmin(ctx, 'noLead', { subject: 'No Lead', text: 't' }, 'no_lead:p', { test: true })).toEqual({ in_app: 'duplicate', email: 'duplicate' })
    expect(s.email).toHaveBeenCalledTimes(1)
    expect(s.email.mock.calls[0][0]).toBe('alerts@example.test')
    expect(s.email.mock.calls[0][1].email.subject).toBe('[TEST] No Lead')
    expect(rows(r => r.member_id === null)).toHaveLength(2)
  })
})

describe('labels, in Eastern time on a UTC box', () => {
  it('"Thu Nov 5" and "1–4 PM", across the DST change', () => {
    expect(messageDayLabel(new Date('2026-11-05T18:00:00Z'))).toBe('Thu Nov 5')
    expect(messageTimeLabel(new Date('2026-11-05T18:30:00Z'), new Date('2026-11-05T21:30:00Z'))).toBe('1:30–4:30 PM')
    expect(messageTimeLabel(new Date('2026-10-31T15:00:00Z'), new Date('2026-10-31T18:00:00Z'))).toBe('11 AM–2 PM')
  })
})
