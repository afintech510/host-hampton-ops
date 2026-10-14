import { freshenRender, guestRsvp, makeSendDb, rsvpRow, sendRow, EVITE_ID, SEND_NOW, type SendDb } from '../../helpers/sendFixtures'
import { __resetRateLimitForTests, guardRecipient, HOUR_MS } from '@/lib/rateLimit'
import { sendEviteEmail } from '@/lib/evites/mail'
import { claimAndSend, performSend, HOST_NOTIFY_LABEL, HOST_NOTIFY_MAX_PER_HOUR } from '@/lib/evites/sendOne'
import { reclaimFailed } from '@/lib/evites/sends'
import { sendOnRsvpChanged, sendOnRsvpCreated } from '@/lib/evites/inlineSends'
import { rsvpHooks } from '@/lib/evites/rsvpHooks'
import { adminHooks } from '@/lib/evites/adminHooks'
import { notifyPartyCancelled } from '@/lib/evites/adminHooks'
import type { EviteSendType } from '@/lib/evites/types'

/**
 * Build-and-send-one (`sendOne.ts`) and the inline hooks (`inlineSends.ts`): claim, re-read, build, send, finish.
 * Resend is mocked; the database is the evite fake with the real unique index.
 */

jest.mock('@/lib/evites/mail')
let db: SendDb
jest.mock('@/lib/supabase', () => ({ getSupabase: () => db.supabase }))

const mailMock = sendEviteEmail as jest.Mock
const ENV = ['EVITES_PAGES', 'EVITES_SENDS', 'EVITES_PILOT_REFS', 'PORTAL_LINK_SIGNING_SECRET', 'SUPABASE_URL'] as const
const saved: Record<string, string | undefined> = {}

const PARENT_RSVP = '00000000-0000-4000-8000-0000000000c1'
const mails = () => mailMock.mock.calls.map((c) => c[0] as { to: string; subject: string; html: string; text: string; attachments?: Array<{ filename: string; content: Buffer; contentType: string }>; headers?: Record<string, string> })
const ledger = () => db.tables.evite_sends
const sendKey = (send_type: EviteSendType, rsvp_id: string | null, ref_version: number) => ({ evite_id: EVITE_ID, rsvp_id, send_type, ref_version })

beforeEach(() => {
  jest.useFakeTimers({
    now: SEND_NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance'],
  })
  for (const k of ENV) saved[k] = process.env[k]
  process.env.EVITES_PAGES = 'on'
  process.env.EVITES_SENDS = 'on'
  delete process.env.EVITES_PILOT_REFS
  process.env.PORTAL_LINK_SIGNING_SECRET = 'test-signing-secret-0123456789abcdef'
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
  __resetRateLimitForTests()
  db = makeSendDb()
  mailMock.mockReset()
  mailMock.mockResolvedValue({ kind: 'sent', providerId: 're_ok' })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  jest.useRealTimers()
  jest.restoreAllMocks()
})

// ----------------------------------------------------------------------------------------------

describe('the flag', () => {
  it('EVITES_SENDS off: nothing is claimed, nothing is sent, nothing is read', async () => {
    process.env.EVITES_SENDS = 'off'
    db = makeSendDb({ rsvps: [rsvpRow({ id: PARENT_RSVP })] })
    expect(await claimAndSend(db.supabase, sendKey('new_rsvp', PARENT_RSVP, 1))).toEqual({ kind: 'disabled', reason: 'sends-off' })
    await sendOnRsvpCreated({ eviteId: EVITE_ID, rsvpId: PARENT_RSVP, slug: 'mia-glow-7kq2', revision: 1, status: 'yes' })
    await sendOnRsvpChanged({ eviteId: EVITE_ID, rsvpId: PARENT_RSVP, slug: 'mia-glow-7kq2', revision: 2, status: 'yes' })
    expect(await notifyPartyCancelled(db.supabase, EVITE_ID)).toEqual({ ok: true, queued: false, reason: 'sends-off' })
    expect(ledger()).toHaveLength(0)
    expect(mailMock).not.toHaveBeenCalled()
    expect(db.selects).toHaveLength(0)
  })

  it('an unrecognised value reads as off', async () => {
    process.env.EVITES_SENDS = 'true'
    expect((await claimAndSend(db.supabase, sendKey('new_rsvp', PARENT_RSVP, 1))).kind).toBe('disabled')
  })

  it('pilot: only a booking named in EVITES_PILOT_REFS sends', async () => {
    process.env.EVITES_SENDS = 'pilot'
    db = makeSendDb({ rsvps: [rsvpRow({ id: PARENT_RSVP })] })
    expect(await claimAndSend(db.supabase, sendKey('new_rsvp', PARENT_RSVP, 1))).toEqual({ kind: 'disabled', reason: 'not-pilot' })
    expect(ledger()).toHaveLength(0)

    process.env.EVITES_PILOT_REFS = 'HH-OTHER-9, hh-test-1'
    const r = await claimAndSend(db.supabase, sendKey('new_rsvp', PARENT_RSVP, 1))
    expect(r.kind).toBe('sent')
    expect(mailMock).toHaveBeenCalledTimes(1)
  })

  it('an unreadable pilot gate is `unavailable`, not "allowed"', async () => {
    process.env.EVITES_SENDS = 'pilot'
    db.errors.push({ table: 'bookings', op: 'select' })
    expect((await claimAndSend(db.supabase, sendKey('new_rsvp', PARENT_RSVP, 1))).kind).toBe('unavailable')
    expect(ledger()).toHaveLength(0)
  })

  it('flipped off between the claim and the send: the claimed row is left retriable (failed), not skipped', async () => {
    db = makeSendDb({ sends: [sendRow({ id: 'c', send_type: 'new_rsvp', rsvp_id: PARENT_RSVP })] })
    process.env.EVITES_SENDS = 'off'
    const r = await performSend(db.supabase, { id: 'c', evite_id: EVITE_ID, rsvp_id: PARENT_RSVP, send_type: 'new_rsvp', ref_version: 1, attempts: 1 }, { now: SEND_NOW })
    expect(r).toEqual({ kind: 'failed', error: 'sends-off' })
    expect(ledger()[0].status).toBe('failed')
    expect(mailMock).not.toHaveBeenCalled()
  })
})

// ----------------------------------------------------------------------------------------------

describe('new_rsvp (inline, to the parent)', () => {
  const ctx = { eviteId: EVITE_ID, rsvpId: PARENT_RSVP, slug: 'mia-glow-7kq2', revision: 1, status: 'yes' as const }

  it('claims, sends once to the booking contact, and records the provider id', async () => {
    db = makeSendDb({ rsvps: [rsvpRow({ id: PARENT_RSVP, parent_name: 'Gina Guest', children: [{ first_name: 'Ava' }] })] })
    await sendOnRsvpCreated(ctx)
    expect(mails()).toHaveLength(1)
    expect(mails()[0].to).toBe('pat@example.com')
    expect(mails()[0].subject).toBe("New RSVP: Gina Guest is coming to Mia's Glow Party")
    expect(mails()[0].text).toContain('Allie & the Host Hampton team')
    expect(ledger()).toHaveLength(1)
    expect(ledger()[0]).toMatchObject({ send_type: 'new_rsvp', ref_version: 1, rsvp_id: PARENT_RSVP, status: 'sent', provider_id: 're_ok', attempts: 1 })
  })

  it('links the guest list, the planner and (priced) the invoice, all from ONE portal token', async () => {
    db = makeSendDb({ rsvps: [rsvpRow({ id: PARENT_RSVP })], booking: { total_cents: 75000 } })
    await sendOnRsvpCreated(ctx)
    expect(db.tables.portal_tokens).toHaveLength(1)
    const t = mails()[0].text
    const auth = 'https://www\\.hosthampton\\.com/api/portal/auth\\?ref=HH-TEST-1&token=([\\w-]+)&redirect='
    const host = t.match(new RegExp(`See all your RSVPs: ${auth}%2Fmy-booking%2Finvitation`))
    const planner = t.match(new RegExp(`Party planner: ${auth}%2Fparty-planner`))
    const invoice = t.match(new RegExp(`Invoice: ${auth}%2Fplan%2FHH-TEST-1%2Fsummary`))
    expect(host && planner && invoice).toBeTruthy()
    expect(new Set([host![1], planner![1], invoice![1]]).size).toBe(1)
  })

  it('an unpriced plan gets no invoice link (it would be an empty page)', async () => {
    db = makeSendDb({ rsvps: [rsvpRow({ id: PARENT_RSVP })], booking: { total_cents: null } })
    await sendOnRsvpCreated(ctx)
    expect(mails()[0].text).toContain('Party planner: ')
    expect(mails()[0].text).not.toContain('Invoice: ')
  })

  it('a token that will not mint still sends the RSVP: bare guest-list link, no planner or invoice button', async () => {
    db = makeSendDb({ rsvps: [rsvpRow({ id: PARENT_RSVP })], booking: { total_cents: 75000 } })
    db.errors.push({ table: 'portal_tokens', op: 'insert', message: 'refused' })
    await sendOnRsvpCreated(ctx)
    expect(mails()).toHaveLength(1)
    const t = mails()[0].text
    expect(t).toContain('See all your RSVPs: https://www.hosthampton.com/my-booking/invitation')
    expect(t).not.toContain('Party planner:')
    expect(t).not.toContain('Invoice:')
    expect(t).not.toContain('token=')
    expect(ledger()[0]).toMatchObject({ status: 'sent' })
  })

  it('a duplicate claim sends nothing: calling the hook twice is one email', async () => {
    db = makeSendDb({ rsvps: [rsvpRow({ id: PARENT_RSVP })] })
    await sendOnRsvpCreated(ctx)
    await sendOnRsvpCreated(ctx)
    expect(mails()).toHaveLength(1)
    expect(ledger()).toHaveLength(1)
  })

  it('a suppressed parent (unsubscribed) is skipped with the reason, and no mail goes', async () => {
    db = makeSendDb({
      rsvps: [rsvpRow({ id: PARENT_RSVP })],
      contacts: [{ id: 'c1', email: 'Pat@Example.com', email_opt_in: false, status: 'lead', created_at: '2026-01-01T00:00:00Z' }],
      interactions: [{ id: 'i1', contact_id: 'c1', type: 'email_unsubscribed', metadata: {} }],
    })
    await sendOnRsvpCreated(ctx)
    expect(mailMock).not.toHaveBeenCalled()
    expect(ledger()[0]).toMatchObject({ status: 'skipped', outcome: 'suppressed' })
  })

  it('unreadable suppression leaves a claimable trace: failed, retried by reclaimFailed, then sent', async () => {
    db = makeSendDb({ rsvps: [rsvpRow({ id: PARENT_RSVP })] })
    db.errors.push({ table: 'contacts', op: 'select', times: 1, message: 'down' })
    await sendOnRsvpCreated(ctx)
    expect(mailMock).not.toHaveBeenCalled()
    expect(ledger()[0]).toMatchObject({ status: 'failed', attempts: 1 })
    expect(String(ledger()[0].last_error)).toMatch(/suppression/)

    const later = new Date(SEND_NOW.getTime() + 15 * 60_000)
    const r = await reclaimFailed(db.supabase, { limit: 5, now: later })
    expect(r.reclaimed).toHaveLength(1)
    const again = await performSend(db.supabase, r.reclaimed[0], { now: later })
    expect(again.kind).toBe('sent')
    expect(ledger()[0]).toMatchObject({ status: 'sent', attempts: 2 })
    expect(mails()).toHaveLength(1)
  })

  it('a booking with no contact email is skipped (the admin card shows it)', async () => {
    db = makeSendDb({ booking: { contact_email: null }, rsvps: [rsvpRow({ id: PARENT_RSVP })] })
    await sendOnRsvpCreated(ctx)
    expect(ledger()[0]).toMatchObject({ status: 'skipped', outcome: 'no-email' })
    expect(mailMock).not.toHaveBeenCalled()
  })

  it('the in-memory parent limiter (evite-host, 40/h) skips the 41st', async () => {
    db = makeSendDb({ rsvps: [rsvpRow({ id: PARENT_RSVP })] })
    for (let i = 0; i < HOST_NOTIFY_MAX_PER_HOUR; i++) guardRecipient('pat@example.com', { label: HOST_NOTIFY_LABEL, max: HOST_NOTIFY_MAX_PER_HOUR, windowMs: HOUR_MS }, SEND_NOW.getTime())
    await sendOnRsvpCreated(ctx)
    expect(mailMock).not.toHaveBeenCalled()
    expect(ledger()[0]).toMatchObject({ status: 'skipped', outcome: 'host-rate-limited' })
  })

  it('a Resend failure is `failed` with the error kept, retriable; no key is `failed` too', async () => {
    db = makeSendDb({ rsvps: [rsvpRow({ id: PARENT_RSVP })] })
    mailMock.mockResolvedValueOnce({ kind: 'failed', error: 'resend rejected: domain' })
    await sendOnRsvpCreated(ctx)
    expect(ledger()[0]).toMatchObject({ status: 'failed', last_error: 'resend rejected: domain' })

    db = makeSendDb({ rsvps: [rsvpRow({ id: PARENT_RSVP })] })
    mailMock.mockResolvedValueOnce({ kind: 'unconfigured' })
    await sendOnRsvpCreated(ctx)
    expect(ledger()[0]).toMatchObject({ status: 'failed' })
    expect(String(ledger()[0].last_error)).toMatch(/RESEND_API_KEY/)
  })

  it('never throws, and a thrown mailer is a failed row, not a stuck claim', async () => {
    db = makeSendDb({ rsvps: [rsvpRow({ id: PARENT_RSVP })] })
    mailMock.mockRejectedValueOnce(new Error('kaboom'))
    await expect(sendOnRsvpCreated(ctx)).resolves.toBeUndefined()
    expect(ledger()[0]).toMatchObject({ status: 'failed' })
    expect(String(ledger()[0].last_error)).toMatch(/kaboom/)
  })

  it('a party that is not live (no deposit yet) is skipped, and one past its start is too', async () => {
    db = makeSendDb({ payments: [], booking: { status: 'awaiting_deposit' }, rsvps: [rsvpRow({ id: PARENT_RSVP })] })
    await sendOnRsvpCreated(ctx)
    expect(ledger()[0]).toMatchObject({ status: 'skipped', outcome: 'state-preview' })

    db = makeSendDb({ rsvps: [rsvpRow({ id: PARENT_RSVP })] })
    const r = await claimAndSend(db.supabase, sendKey('new_rsvp', PARENT_RSVP, 1), { now: new Date('2026-11-14T19:00:01Z') })
    expect(r).toEqual({ kind: 'skipped', reason: 'past-sendable-window' })
  })

  it('the hooks are installed as the defaults of rsvpHooks and adminHooks', () => {
    expect(rsvpHooks.onRsvpCreated).toBe(sendOnRsvpCreated)
    expect(rsvpHooks.onRsvpChanged).toBe(sendOnRsvpChanged)
    expect(typeof adminHooks.notifyPartyCancelled).toBe('function')
  })
})

describe('rsvp_changed (inline, to the parent)', () => {
  it('goes out at the new revision; the same revision twice is one email, the next revision is another', async () => {
    db = makeSendDb({ rsvps: [rsvpRow({ id: PARENT_RSVP, revision: 2, status: 'no', children: [], adult_count: 0 })] })
    const ctx = { eviteId: EVITE_ID, rsvpId: PARENT_RSVP, slug: 'mia-glow-7kq2', revision: 2, status: 'no' as const }
    await sendOnRsvpChanged(ctx)
    await sendOnRsvpChanged(ctx)
    expect(mails()).toHaveLength(1)
    expect(mails()[0].subject).toMatch(/^RSVP updated:.*can't make it/)
    await sendOnRsvpChanged({ ...ctx, revision: 3 })
    expect(mails()).toHaveLength(2)
    expect(ledger().map((s) => s.ref_version)).toEqual([2, 3])
  })
})

// ----------------------------------------------------------------------------------------------

describe('rsvp_confirmed (inline, to the guest)', () => {
  it('sends the guest an .ics (PUBLISH) with their own links, and sets cal_version_seen = cal_version', async () => {
    const g = guestRsvp({ id: PARENT_RSVP, cal_version_seen: 0 })
    db = makeSendDb({ evite: { cal_version: 2 }, rsvps: [g] })
    await sendOnRsvpCreated({ eviteId: EVITE_ID, rsvpId: PARENT_RSVP, slug: 'mia-glow-7kq2', revision: 1, status: 'yes' })

    const toGuest = mails().filter((m) => m.to === 'gina@example.com')
    expect(toGuest).toHaveLength(1)
    const m = toGuest[0]
    expect(m.subject).toBe("You're on the list for Mia's Glow Party")
    expect(m.attachments).toHaveLength(1)
    expect(m.attachments![0].filename).toBe('party.ics')
    expect(m.attachments![0].contentType).toMatch(/^text\/calendar; method=PUBLISH/)
    const ics = m.attachments![0].content.toString('utf8')
    expect(ics).toContain('METHOD:PUBLISH')
    expect(ics).toContain('SEQUENCE:2')
    expect(ics).toContain(`UID:evite-${EVITE_ID}@hosthampton.com`)
    expect(m.text).toContain('https://www.hosthampton.com/i/mia-glow-7kq2/cal')
    expect(m.text).toMatch(/Plans changed\? Update your RSVP: https:\/\/www\.hosthampton\.com\/i\/mia-glow-7kq2\/rsvp\/[\w-]+\.\d+\.[\w-]+\n/)
    expect(m.text).toMatch(/Stop reminders: .*\?stop=1/)
    expect(db.tables.evite_rsvps[0].cal_version_seen).toBe(2)
    // and the parent was told too
    expect(mails().some((x) => x.to === 'pat@example.com')).toBe(true)
    expect(ledger().map((s) => [s.send_type, s.status]).sort()).toEqual([['new_rsvp', 'sent'], ['rsvp_confirmed', 'sent']])
  })

  it('cal_version_seen only moves forward', async () => {
    db = makeSendDb({ evite: { cal_version: 1 }, rsvps: [guestRsvp({ id: PARENT_RSVP, cal_version_seen: 3 })] })
    await claimAndSend(db.supabase, sendKey('rsvp_confirmed', PARENT_RSVP, 0))
    expect(mails()).toHaveLength(1)
    expect(db.tables.evite_rsvps[0].cal_version_seen).toBe(3)
  })

  it('a guest with no reminder email gets no claim at all (no ledger noise)', async () => {
    db = makeSendDb({ rsvps: [rsvpRow({ id: PARENT_RSVP, reminder_email: null })] })
    await sendOnRsvpCreated({ eviteId: EVITE_ID, rsvpId: PARENT_RSVP, slug: 'mia-glow-7kq2', revision: 1, status: 'yes' })
    expect(ledger().map((s) => s.send_type)).toEqual(['new_rsvp'])
  })

  it('a guest who said "no", or opted out of reminders, is skipped by the sender', async () => {
    db = makeSendDb({ rsvps: [guestRsvp({ id: PARENT_RSVP, reminder_opt_out_at: '2026-10-30T00:00:00Z' })] })
    expect(await claimAndSend(db.supabase, sendKey('rsvp_confirmed', PARENT_RSVP, 0))).toEqual({ kind: 'skipped', reason: 'opted-out' })
    db = makeSendDb({ rsvps: [guestRsvp({ id: PARENT_RSVP, status: 'no', children: [], adult_count: 0 })] })
    expect(await claimAndSend(db.supabase, sendKey('rsvp_confirmed', PARENT_RSVP, 0))).toEqual({ kind: 'skipped', reason: 'rsvp-no' })
    expect(mailMock).not.toHaveBeenCalled()
  })

  it('cal_version_seen is NOT set when the mail did not go', async () => {
    db = makeSendDb({ evite: { cal_version: 2 }, rsvps: [guestRsvp({ id: PARENT_RSVP })] })
    mailMock.mockResolvedValueOnce({ kind: 'failed', error: 'nope' })
    await claimAndSend(db.supabase, sendKey('rsvp_confirmed', PARENT_RSVP, 0))
    expect(db.tables.evite_rsvps[0].cal_version_seen).toBe(0)
  })
})

// ----------------------------------------------------------------------------------------------

describe('the guest reminders keyed on the calendar version (what P09b selects)', () => {
  const key = (t: EviteSendType, v: number) => sendKey(t, PARENT_RSVP, v)

  it('week_before / day_before / details_changed send at the current cal_version with an .ics; a stale version is skipped', async () => {
    db = makeSendDb({ evite: { cal_version: 1 }, rsvps: [guestRsvp({ id: PARENT_RSVP })] })
    expect((await claimAndSend(db.supabase, key('week_before', 1), { now: new Date('2026-11-07T15:00:00Z') })).kind).toBe('sent')
    expect((await claimAndSend(db.supabase, key('day_before', 1), { now: new Date('2026-11-13T21:00:00Z') })).kind).toBe('sent')
    expect((await claimAndSend(db.supabase, key('details_changed', 1))).kind).toBe('sent')
    expect(await claimAndSend(db.supabase, key('day_before', 0), { now: new Date('2026-11-13T21:00:00Z') })).toEqual({ kind: 'skipped', reason: 'stale-cal-version' })
    expect(mails().map((m) => m.subject)).toEqual([
      "Reminder: Mia's Glow Party is Saturday, November 14",
      "Mia's Glow Party is Saturday, November 14",
      "Update: Mia's Glow Party is now Saturday, November 14",
    ])
    for (const m of mails()) expect(m.attachments![0].content.toString('utf8')).toContain('SEQUENCE:1')
  })

  it('sendable-until: week_before stops 48h before the start, day_before at 23:59 ET the day before', async () => {
    db = makeSendDb({ rsvps: [guestRsvp({ id: PARENT_RSVP })] })
    // start = 2026-11-14 19:00Z. week_before cutoff = 2026-11-12 19:00Z
    expect(await claimAndSend(db.supabase, key('week_before', 0), { now: new Date('2026-11-12T19:00:01Z') })).toEqual({ kind: 'skipped', reason: 'past-sendable-window' })
    // 23:59 ET on Nov 13 = 2026-11-14 04:59Z
    const dayBefore = makeSendDb({ rsvps: [guestRsvp({ id: PARENT_RSVP })] })
    expect((await claimAndSend(dayBefore.supabase, key('day_before', 0), { now: new Date('2026-11-14T04:58:00Z') })).kind).toBe('sent')
    const late = makeSendDb({ rsvps: [guestRsvp({ id: PARENT_RSVP })] })
    expect(await claimAndSend(late.supabase, key('day_before', 0), { now: new Date('2026-11-14T05:00:00Z') })).toEqual({ kind: 'skipped', reason: 'past-sendable-window' })
  })

  it('the day-before email never carries the TODO arrival note', async () => {
    db = makeSendDb({ rsvps: [guestRsvp({ id: PARENT_RSVP })] })
    await claimAndSend(db.supabase, key('day_before', 0), { now: new Date('2026-11-13T21:00:00Z') })
    expect(mails()[0].html + mails()[0].text).not.toMatch(/TODO/)
    expect(mails()[0].text).toContain('Where: Host Hampton, 295 Montauk Hwy, Speonk, NY 11972')
  })

  it('a link the edit token cannot be signed for fails the send (retriable), it does not send a bare email', async () => {
    db = makeSendDb({ rsvps: [guestRsvp({ id: PARENT_RSVP, edit_nonce: 'short' })] })
    const r = await claimAndSend(db.supabase, key('week_before', 0), { now: new Date('2026-11-07T15:00:00Z') })
    expect(r.kind).toBe('failed')
    expect(mailMock).not.toHaveBeenCalled()
  })
})

describe('final_headcount', () => {
  it('sums the yes answers, rolls up allergies, and carries the notes', async () => {
    db = makeSendDb({
      evite: { cal_version: 0 },
      rsvps: [
        guestRsvp({ id: '00000000-0000-4000-8000-0000000000d1', children: [{ first_name: 'Ava' }, { first_name: 'Ben' }], adult_count: 2, has_allergy: true, allergy_note: 'peanuts', note_to_honoree: 'Happy birthday Mia!' }),
        guestRsvp({ id: '00000000-0000-4000-8000-0000000000d2', parent_name: 'Hal Host', children: [{ first_name: 'Cy' }], adult_count: 1 }),
        guestRsvp({ id: '00000000-0000-4000-8000-0000000000d3', status: 'no', children: [], adult_count: 0 }),
      ],
    })
    const r = await claimAndSend(db.supabase, sendKey('final_headcount', null, 0), { now: new Date('2026-11-13T21:30:00Z') })
    expect(r.kind).toBe('sent')
    const m = mails()[0]
    expect(m.to).toBe('pat@example.com')
    expect(m.text).toContain('Kids: 3 of 12 expected')
    expect(m.text).toContain('Adults: 3+')
    expect(m.text).toContain("Can't come: 1")
    expect(m.text).toContain('peanuts')
    expect(m.text).toContain('Happy birthday Mia!')
    expect(m.attachments).toBeUndefined()
  })

  it('an unreadable RSVP list is a retriable failure, not an empty headcount', async () => {
    db = makeSendDb()
    db.errors.push({ table: 'evite_rsvps', op: 'select', message: 'down' })
    const r = await claimAndSend(db.supabase, sendKey('final_headcount', null, 0), { now: new Date('2026-11-13T21:30:00Z') })
    expect(r.kind).toBe('failed')
    expect(mailMock).not.toHaveBeenCalled()
  })
})

// ----------------------------------------------------------------------------------------------

describe('invite_ready', () => {
  it('mints a /my-booking/invitation magic link and mails it', async () => {
    db = makeSendDb()
    await freshenRender(db)
    const r = await claimAndSend(db.supabase, sendKey('invite_ready', null, 0))
    expect(r.kind).toBe('sent')
    expect(db.tables.portal_tokens).toHaveLength(1)
    const m = mails()[0]
    expect(m.subject).toBe("Mia's Glow Party invitation is ready!")
    expect(m.text).toMatch(/Open my invitation: https:\/\/www\.hosthampton\.com\/api\/portal\/auth\?ref=HH-TEST-1&token=[\w-]+&redirect=%2Fmy-booking%2Finvitation/)
  })

  it('a mint that fails marks the send failed and sends NOTHING (never a dead link)', async () => {
    db = makeSendDb()
    await freshenRender(db)
    db.errors.push({ table: 'portal_tokens', op: 'insert', message: 'refused' })
    const r = await claimAndSend(db.supabase, sendKey('invite_ready', null, 0))
    expect(r.kind).toBe('failed')
    expect(mailMock).not.toHaveBeenCalled()
    expect(ledger()[0]).toMatchObject({ status: 'failed' })
    expect(String(ledger()[0].last_error)).toMatch(/portal link not minted/)
  })

  it('waits for a fresh render, and stops 2 days before the party', async () => {
    db = makeSendDb()
    expect((await claimAndSend(db.supabase, sendKey('invite_ready', null, 0))).kind).toBe('failed')
    expect(mailMock).not.toHaveBeenCalled()
    const late = makeSendDb()
    await freshenRender(late)
    expect(await claimAndSend(late.supabase, sendKey('invite_ready', null, 0), { now: new Date('2026-11-12T19:00:01Z') })).toEqual({ kind: 'skipped', reason: 'past-sendable-window' })
  })
})

describe('lead_preview', () => {
  const PREVIEW = { booking: { status: 'awaiting_deposit', created_at: '2026-10-30T12:00:00Z' }, payments: [] as Array<Record<string, unknown>> }

  async function previewDb(over: Record<string, unknown> = {}) {
    const d = makeSendDb({ ...PREVIEW, ...over })
    Object.assign(d.tables.evites[0], { image_key: '0123456789abcdef0123456789abcdef', invite_object: 'invite-v1-9f2c.jpg', og_object: 'og-v1-9f2c.jpg' })
    return d
  }

  it('sends the preview with the unsubscribe headers, a minted Reserve link, and the image', async () => {
    db = await previewDb()
    const r = await claimAndSend(db.supabase, sendKey('lead_preview', null, 0))
    expect(r.kind).toBe('sent')
    const m = mails()[0]
    expect(m.to).toBe('pat@example.com')
    expect(m.subject).toBe("Here's Mia's Glow Party invitation ✨")
    expect(m.headers?.['List-Unsubscribe']).toContain('/api/unsubscribe?t=')
    expect(m.html).toContain('<img src="https://proj.supabase.co/storage/v1/object/public/evites/0123456789abcdef0123456789abcdef/invite-v1-9f2c.jpg"')
    expect(m.html).toContain('Reserve your date')
    expect(m.text).toContain('redirect=%2Fparty-planner')
    expect(db.tables.portal_tokens).toHaveLength(1)
  })

  it('a priced plan gets the invoice as its Reserve link', async () => {
    db = await previewDb()
    db.tables.bookings[0].total_cents = 45000
    await claimAndSend(db.supabase, sendKey('lead_preview', null, 0))
    expect(mails()[0].text).toContain('redirect=%2Fplan%2FHH-TEST-1%2Fsummary')
  })

  it('the Reserve button is omitted when the mint fails, and the email still goes', async () => {
    db = await previewDb()
    db.errors.push({ table: 'portal_tokens', op: 'insert' })
    const r = await claimAndSend(db.supabase, sendKey('lead_preview', null, 0))
    expect(r.kind).toBe('sent')
    expect(mails()[0].html).not.toContain('Reserve your date')
    expect(mails()[0].html).toContain('See the invitation')
  })

  it('suppressed (unsubscribed, or hard-bounced) is skipped; unreadable is deferred as failed', async () => {
    const contacts = [{ id: 'c1', email: 'pat@example.com', email_opt_in: false, status: 'lead', created_at: '2026-01-01T00:00:00Z' }]
    db = await previewDb({ contacts, interactions: [{ id: 'i1', contact_id: 'c1', type: 'email_unsubscribed', metadata: {} }] })
    expect(await claimAndSend(db.supabase, sendKey('lead_preview', null, 0))).toEqual({ kind: 'skipped', reason: 'suppressed' })
    db = await previewDb({ contacts, interactions: [{ id: 'i2', contact_id: 'c1', type: 'email_bounced', metadata: { bounce_type: 'hard' } }] })
    expect(await claimAndSend(db.supabase, sendKey('lead_preview', null, 0))).toEqual({ kind: 'skipped', reason: 'suppressed' })
    db = await previewDb({ contacts })
    db.errors.push({ table: 'contact_interactions', op: 'select', message: 'down' })
    expect((await claimAndSend(db.supabase, sendKey('lead_preview', null, 0))).kind).toBe('failed')
    expect(mailMock).not.toHaveBeenCalled()
  })

  it('is for a PREVIEW only (a booked party gets invite_ready instead), within 14 days, and needs a render', async () => {
    db = makeSendDb()
    expect(await claimAndSend(db.supabase, sendKey('lead_preview', null, 0))).toEqual({ kind: 'skipped', reason: 'state-live' })
    db = await previewDb()
    expect(await claimAndSend(db.supabase, sendKey('lead_preview', null, 0), { now: new Date('2026-11-14T12:00:01Z') })).toEqual({ kind: 'skipped', reason: 'past-sendable-window' })
    db = makeSendDb(PREVIEW)
    expect((await claimAndSend(db.supabase, sendKey('lead_preview', null, 0))).kind).toBe('failed')
    expect(mailMock).not.toHaveBeenCalled()
  })

  it('refuses to mail without an unsubscribe signing secret (an email with a dead opt-out is worse than none)', async () => {
    db = await previewDb()
    delete process.env.PORTAL_LINK_SIGNING_SECRET // restored by afterEach
    const r = await claimAndSend(db.supabase, sendKey('lead_preview', null, 0))
    expect(r.kind).toBe('failed')
    expect(String(ledger()[0].last_error)).toMatch(/unsubscribe signing secret/)
    expect(mailMock).not.toHaveBeenCalled()
  })
})

// ----------------------------------------------------------------------------------------------

describe('party_cancelled via notifyPartyCancelled (admin notify_cancelled)', () => {
  const ids = ['00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000e5']
  const cancelledDb = () =>
    makeSendDb({
      booking: { status: 'cancelled' },
      evite: { cal_version: 1, went_live_at: '2026-10-05T00:00:00Z' },
      rsvps: [
        guestRsvp({ id: ids[0], reminder_email: 'gina@example.com' }),
        guestRsvp({ id: ids[1], reminder_email: 'hal@example.com', parent_name: 'Hal Host' }),
        guestRsvp({ id: ids[2], status: 'no', children: [], adult_count: 0, reminder_email: 'no@example.com' }),
        guestRsvp({ id: ids[3], reminder_opt_out_at: '2026-10-30T00:00:00Z', reminder_email: 'optout@example.com' }),
        guestRsvp({ id: ids[4], reminder_email: null }),
      ],
    })

  it('mails each yes guest with an email who has not opted out, with a CANCEL .ics, and stamps cancelled_notice_at once', async () => {
    db = cancelledDb()
    const r = await notifyPartyCancelled(db.supabase, EVITE_ID)
    expect(r).toMatchObject({ ok: true, queued: true, count: 2, sent: 2, failed: 0, stamped: true })
    expect(mails().map((m) => m.to).sort()).toEqual(['gina@example.com', 'hal@example.com'])
    for (const m of mails()) {
      expect(m.subject).toBe("Cancelled: Mia's Glow Party on Saturday, November 14")
      const ics = m.attachments![0].content.toString('utf8')
      expect(m.attachments![0].contentType).toMatch(/method=CANCEL/)
      expect(ics).toContain('METHOD:CANCEL')
      expect(ics).toContain('STATUS:CANCELLED')
      expect(ics).toContain('SEQUENCE:2')
    }
    expect(ledger().every((s) => s.send_type === 'party_cancelled' && s.ref_version === 2 && s.status === 'sent')).toBe(true)
    const stamp = db.tables.evites[0].cancelled_notice_at
    expect(stamp).toBe(SEND_NOW.toISOString())

    // a second click: nobody is mailed again and the original stamp stays
    jest.setSystemTime(new Date(SEND_NOW.getTime() + 3_600_000))
    const again = await notifyPartyCancelled(db.supabase, EVITE_ID)
    expect(again).toMatchObject({ ok: true, queued: false, sent: 0, duplicate: 2, stamped: false })
    expect(mails()).toHaveLength(2)
    expect(db.tables.evites[0].cancelled_notice_at).toBe(stamp)
  })

  it('a failed send is queued for retry (failed row), not lost, and the party still counts as announced', async () => {
    db = cancelledDb()
    mailMock.mockResolvedValueOnce({ kind: 'failed', error: 'blip' })
    const r = await notifyPartyCancelled(db.supabase, EVITE_ID)
    expect(r).toMatchObject({ ok: true, queued: true, sent: 1, failed: 1 })
    expect(ledger().filter((s) => s.status === 'failed')).toHaveLength(1)
  })

  it('does nothing for a party that is not cancelled', async () => {
    db = makeSendDb({ rsvps: [guestRsvp({ id: ids[0] })] })
    expect(await notifyPartyCancelled(db.supabase, EVITE_ID)).toEqual({ ok: true, queued: false, reason: 'not-cancelled' })
    expect(mailMock).not.toHaveBeenCalled()
    expect(db.tables.evites[0].cancelled_notice_at).toBeNull()
  })

  it('with no guests to tell it says so and still marks the party announced', async () => {
    db = makeSendDb({ booking: { status: 'cancelled' }, rsvps: [] })
    expect(await notifyPartyCancelled(db.supabase, EVITE_ID)).toMatchObject({ ok: true, queued: false, reason: 'no-guests', stamped: true })
  })

  it('an unreadable guest list is an {ok:false} and stamps nothing', async () => {
    db = cancelledDb()
    db.errors.push({ table: 'evite_rsvps', op: 'select' })
    expect(await notifyPartyCancelled(db.supabase, EVITE_ID)).toMatchObject({ ok: false, queued: false })
    expect(db.tables.evites[0].cancelled_notice_at).toBeNull()
  })

  it('honours pilot mode: a non-pilot party is not announced', async () => {
    process.env.EVITES_SENDS = 'pilot'
    db = cancelledDb()
    expect(await notifyPartyCancelled(db.supabase, EVITE_ID)).toEqual({ ok: true, queued: false, reason: 'not-pilot' })
    expect(mailMock).not.toHaveBeenCalled()
  })

  it('a cancellation needs no signing: it goes even when the edit link cannot be signed', async () => {
    db = makeSendDb({ booking: { status: 'cancelled' }, rsvps: [guestRsvp({ id: ids[0], edit_nonce: 'short' })] })
    expect(await notifyPartyCancelled(db.supabase, EVITE_ID)).toMatchObject({ sent: 1 })
  })
})

describe('performSend on a vanished row', () => {
  it('an RSVP deleted after the claim is a skip, not a send', async () => {
    db = makeSendDb({ sends: [sendRow({ id: 'g', send_type: 'week_before', rsvp_id: PARENT_RSVP, ref_version: 0 })] })
    const r = await performSend(db.supabase, { id: 'g', evite_id: EVITE_ID, rsvp_id: PARENT_RSVP, send_type: 'week_before', ref_version: 0, attempts: 1 }, { now: SEND_NOW })
    expect(r).toEqual({ kind: 'skipped', reason: 'gone-rsvp' })
    expect(ledger()[0].status).toBe('skipped')
  })

  it('an unreadable evite is a retriable failure', async () => {
    db = makeSendDb({ sends: [sendRow({ id: 'h' })] })
    db.errors.push({ table: 'evites', op: 'select' })
    const r = await performSend(db.supabase, { id: 'h', evite_id: EVITE_ID, rsvp_id: null, send_type: 'invite_ready', ref_version: 0, attempts: 1 }, { now: SEND_NOW })
    expect(r.kind).toBe('failed')
    expect(ledger()[0].status).toBe('failed')
  })
})
