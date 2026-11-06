/**
 * The pilot: the crew app is on for the people named in CREW_PILOT_MEMBER_IDS and shut for every other
 * real member, who can neither sign in nor be messaged. The manager gets a text for an alert that needs
 * a person. Nothing here reaches a provider: the senders are fakes.
 */
import { crewMemberMayEnter, inCrewPilot } from '@/lib/crew/settings'
import { crewMessagingAllowed, notifyAdmin, notifyMember, type CrewSenders } from '@/lib/crew/notify'
import { templates } from '@/lib/crew/templates'
import { fakeCrewDb } from '../../helpers/fakeCrewDb'

const LEXI = '71bebe44-2206-4971-aa94-d1ecc894c5a3'
const KAT = '2cda54e8-1a0e-47d9-9e9b-262f9dfe1f90'
const ENV = { ...process.env }
const NOON = new Date('2026-11-09T17:00:00Z')            // 12:00 EST
const LATE = new Date('2026-11-10T05:00:00Z')            // midnight EST

const member = (id: string, over: Record<string, unknown> = {}) => ({
  id, first_name: id === LEXI ? 'Lexi' : 'Kat', email: null, phone: '+16315550100', is_owner: false, is_test: false,
  status: 'active', email_opt_in: false, sms_opt_in: true, ...over,
}) as any

const senders = (): CrewSenders & { sms: jest.Mock; email: jest.Mock } =>
  ({ sms: jest.fn(async () => 'quo-1'), email: jest.fn(async () => ({ kind: 'sent' as const, providerId: 're-1' })) }) as any

beforeEach(() => {
  process.env = { ...ENV, CREW_ENABLED: 'true', CREW_SMS_ENABLED: 'true', CREW_ADMIN_EMAIL: 'alerts@example.test' }
  delete process.env.CREW_PILOT_MEMBER_IDS
  delete process.env.CREW_ADMIN_PHONE
})
afterAll(() => { process.env = ENV })

describe('the pilot allow-list', () => {
  it('no pilot set: everyone active is in, as at the full launch', () => {
    expect(inCrewPilot(member(KAT))).toBe(true)
    expect(crewMessagingAllowed(member(KAT))).toBe('ok')
    expect(crewMemberMayEnter(member(KAT))).toBe(true)
  })

  it('pilot set: only the named member may enter or be messaged', () => {
    process.env.CREW_PILOT_MEMBER_IDS = LEXI
    expect(crewMemberMayEnter(member(LEXI))).toBe(true)
    expect(crewMemberMayEnter(member(KAT))).toBe(false)
    expect(crewMemberMayEnter(member(KAT), 'onboarding')).toBe(false)
    expect(crewMessagingAllowed(member(LEXI))).toBe('ok')
    expect(crewMessagingAllowed(member(KAT))).toBe('not_pilot')
  })

  it('is case- and space-tolerant, and a member with no id is never in', () => {
    process.env.CREW_PILOT_MEMBER_IDS = ` ${LEXI.toUpperCase()} , ${KAT} `
    expect(inCrewPilot(member(LEXI))).toBe(true)
    expect(inCrewPilot(member(KAT))).toBe(true)
    expect(crewMemberMayEnter({ status: 'active', is_owner: false, is_test: false })).toBe(false)
  })

  it('a value that names nobody admits nobody, and test members are never affected', () => {
    process.env.CREW_PILOT_MEMBER_IDS = ' , '
    expect(crewMemberMayEnter(member(LEXI))).toBe(false)
    expect(crewMemberMayEnter(member('t1', { is_test: true }))).toBe(true)
  })

  it('the owner and a paused member stay out whatever the pilot says', () => {
    process.env.CREW_PILOT_MEMBER_IDS = LEXI
    expect(crewMemberMayEnter(member(LEXI, { is_owner: true }))).toBe(false)
    expect(crewMemberMayEnter(member(LEXI, { status: 'paused' }))).toBe(false)
    expect(crewMessagingAllowed(member(LEXI, { is_owner: true }))).toBe('owner')
  })

  it('notifyMember writes nothing and sends nothing for someone outside the pilot, and texts the one inside', async () => {
    process.env.CREW_PILOT_MEMBER_IDS = LEXI
    const db = fakeCrewDb({ crew_notifications: [] })
    const t = senders()
    const ctx = { sb: db.sb, now: NOON, senders: t }
    const digest = templates.partiesDigest(2, false, 'https://example.test/crew')
    const out = await notifyMember(ctx, member(KAT), 'newParty', digest, 'k:kat')
    expect(out).toEqual({ kind: 'held', reason: 'not_pilot' })
    expect(db.tables.crew_notifications).toHaveLength(0)
    expect(t.sms).not.toHaveBeenCalled()
    const ok = await notifyMember(ctx, member(LEXI), 'newParty', digest, 'k:lexi')
    expect(ok.kind).toBe('done')
    expect(t.sms).toHaveBeenCalledTimes(1)
    expect(t.sms.mock.calls[0][0]).toBe('+16315550100')
  })
})

describe('the manager text', () => {
  const msg = { subject: 'Needs crew: Glow Party', text: 'Glow Party on Sat Nov 14 still needs 2 crew.\nhttps://www.example.test/admin/crew/parties/p1' }

  it('texts the manager once for an alert that needs a person, alongside the email', async () => {
    process.env.CREW_ADMIN_PHONE = '+16315992469'
    const db = fakeCrewDb({ crew_notifications: [] })
    const t = senders()
    const out = await notifyAdmin({ sb: db.sb, now: NOON, senders: t }, 'understaffed', msg, 'understaffed:p1')
    expect(out).toMatchObject({ in_app: 'sent', email: 'sent', sms: 'sent' })
    expect(t.sms).toHaveBeenCalledWith('+16315992469', expect.stringContaining('Glow Party'))
    // A replay sends nothing twice.
    const again = await notifyAdmin({ sb: db.sb, now: NOON, senders: t }, 'understaffed', msg, 'understaffed:p1')
    expect(again.sms).toBe('duplicate')
    expect(t.sms).toHaveBeenCalledTimes(1)
  })

  it('never texts for an FYI, and nothing at all when no number is set or crew texts are off', async () => {
    process.env.CREW_ADMIN_PHONE = '+16315992469'
    const db = fakeCrewDb({ crew_notifications: [] })
    const t = senders()
    await notifyAdmin({ sb: db.sb, now: NOON, senders: t }, 'fyi', msg, 'fyi:1', { info: true })
    expect(t.sms).not.toHaveBeenCalled()
    process.env.CREW_SMS_ENABLED = 'false'
    expect((await notifyAdmin({ sb: db.sb, now: NOON, senders: t }, 'x', msg, 'x:1')).sms).toBeUndefined()
    process.env.CREW_SMS_ENABLED = 'true'
    delete process.env.CREW_ADMIN_PHONE
    expect((await notifyAdmin({ sb: db.sb, now: NOON, senders: t }, 'y', msg, 'y:1')).sms).toBeUndefined()
    expect(t.sms).not.toHaveBeenCalled()
  })

  it('in quiet hours the email and the page still go, the text is recorded as skipped and not sent', async () => {
    process.env.CREW_ADMIN_PHONE = '+16315992469'
    const db = fakeCrewDb({ crew_notifications: [] })
    const t = senders()
    const out = await notifyAdmin({ sb: db.sb, now: LATE, senders: t }, 'understaffed', msg, 'understaffed:p2')
    expect(out).toMatchObject({ in_app: 'sent', email: 'sent', sms: 'skipped' })
    expect(t.sms).not.toHaveBeenCalled()
  })

  it('marks a test party and shortens a long alert to its subject and link', async () => {
    process.env.CREW_ADMIN_PHONE = '+16315992469'
    const db = fakeCrewDb({ crew_notifications: [] })
    const t = senders()
    const long = { subject: 'Cover needed: Glow Party', text: `${'x'.repeat(400)}\nhttps://www.example.test/admin/crew/parties/p1` }
    await notifyAdmin({ sb: db.sb, now: NOON, senders: t }, 'cover', long, 'cover:1', { test: true })
    const body = t.sms.mock.calls[0][1] as string
    expect(body).toMatch(/^\[TEST\] /)
    expect(body.length).toBeLessThan(160)
    expect(body).toContain('https://www.example.test/admin/crew/parties/p1')
  })
})
