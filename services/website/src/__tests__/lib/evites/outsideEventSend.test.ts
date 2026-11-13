import { freshenRender, makeSendDb, rsvpRow, EVITE_ID, SEND_NOW, type SendDb } from '../../helpers/sendFixtures'
import { __resetRateLimitForTests } from '@/lib/rateLimit'
import { sendEviteEmail } from '@/lib/evites/mail'
import { claimAndSend } from '@/lib/evites/sendOne'
import { sendOnRsvpCreated } from '@/lib/evites/inlineSends'
import type { EviteSendType } from '@/lib/evites/types'

/**
 * What the sender does for an outside event (migration 096): a shower at James Joyce, Jan 30 2027, 12-3.
 * Resend is mocked; the database is the evite fake with the real unique index.
 */

jest.mock('@/lib/evites/mail')
let db: SendDb
jest.mock('@/lib/supabase', () => ({ getSupabase: () => db.supabase }))

const mailMock = sendEviteEmail as jest.Mock
const ENV = ['EVITES_PAGES', 'EVITES_SENDS', 'EVITES_PILOT_REFS', 'PORTAL_LINK_SIGNING_SECRET', 'SUPABASE_URL'] as const
const saved: Record<string, string | undefined> = {}
const RSVP = '00000000-0000-4000-8000-0000000000c1'
const mails = () => mailMock.mock.calls.map((c) => c[0] as { to: string; subject: string; html: string; text: string })
const sendKey = (send_type: EviteSendType, rsvp_id: string | null, ref_version: number) => ({ evite_id: EVITE_ID, rsvp_id, send_type, ref_version })

const SHOWER = {
  status: 'confirmed',
  party_type: 'outside_event',
  party_date: '2027-01-30',
  party_time: '12:00',
  child_name: 'Maeghan',
  child_age: null,
  package_type: null,
  total_cents: 0,
  party_tags: {
    location_type: 'mobile',
    venue_name: 'James Joyce',
    location_address: '49 S Ocean Ave, Patchogue, NY 11772',
    occasion: 'Baby Shower',
    audience: 'guests',
    event_end_time: '15:00',
  },
}

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

describe('an outside event: the RSVP email to the host', () => {
  const ctx = { eviteId: EVITE_ID, rsvpId: RSVP, slug: 'maeghan-babyshower-7kq2', revision: 1, status: 'yes' as const }

  it('names the guests and the occasion, and offers the guest list link only', async () => {
    db = makeSendDb({
      booking: { ...SHOWER, total_cents: 75000 }, // even a priced row: an outside event has no planner or invoice
      rsvps: [rsvpRow({ id: RSVP, parent_name: 'Jen Guest', children: [{ first_name: 'Jen' }, { first_name: 'Mike' }], adult_count: 0 })],
    })
    await sendOnRsvpCreated(ctx)
    expect(mails()).toHaveLength(1)
    const m = mails()[0]
    expect(m.subject).toBe("New RSVP: Jen Guest is coming to Maeghan's Baby Shower")
    expect(m.text).toContain('Guests: Jen, Mike')
    expect(m.text).not.toMatch(/Kids:|Adults:|Party planner|Invoice:/)
    expect(m.text).toMatch(/See all your RSVPs: https:\/\/www\.hosthampton\.com\/api\/portal\/auth\?ref=HH-TEST-1&token=[\w-]+&redirect=%2Fmy-booking%2Finvitation/)
    expect(db.tables.portal_tokens).toHaveLength(1)
  })

  it('a kids audience keeps the kids wording, but still no planner or invoice link', async () => {
    db = makeSendDb({
      booking: { ...SHOWER, total_cents: 75000, party_tags: { ...SHOWER.party_tags, audience: 'kids' } },
      rsvps: [rsvpRow({ id: RSVP })],
    })
    await sendOnRsvpCreated(ctx)
    expect(mails()[0].text).not.toMatch(/Party planner|Invoice:/)
    expect(mails()[0].text).toContain('Kids:')
  })
})

describe('an outside event: invite_ready', () => {
  it("says the invitation is ready in the occasion's words, and links the host page", async () => {
    db = makeSendDb({ booking: SHOWER })
    await freshenRender(db)
    const r = await claimAndSend(db.supabase, sendKey('invite_ready', null, 0), { now: SEND_NOW })
    expect(r.kind).toBe('sent')
    const m = mails()[0]
    expect(m.subject).toBe("Maeghan's Baby Shower invitation is ready!")
    expect(m.text).toContain('James Joyce')
    expect(m.text).not.toMatch(/party is booked|class list|Speonk|Montauk/i)
    expect(m.text).toMatch(/Open my invitation: https:\/\/www\.hosthampton\.com\/api\/portal\/auth\?ref=HH-TEST-1&token=[\w-]+&redirect=%2Fmy-booking%2Finvitation/)
  })
})

describe('an outside event: lead_preview', () => {
  it('is never sent: there is no planner to reserve a date in', async () => {
    db = makeSendDb({
      booking: { ...SHOWER, status: 'awaiting_deposit', created_at: '2026-10-30T12:00:00Z' },
      payments: [] as Array<Record<string, unknown>>,
    })
    Object.assign(db.tables.evites[0], { image_key: '0123456789abcdef0123456789abcdef', invite_object: 'invite-v1-9f2c.jpg', og_object: 'og-v1-9f2c.jpg' })
    expect(await claimAndSend(db.supabase, sendKey('lead_preview', null, 0))).toEqual({ kind: 'skipped', reason: 'outside-event' })
    expect(mailMock).not.toHaveBeenCalled()
  })
})
