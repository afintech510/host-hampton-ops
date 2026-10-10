import { cronDb } from '../../helpers/cronFixtures'
import { guestRsvp, uuid, type SendDb } from '../../helpers/sendFixtures'
import { runRetention } from '@/lib/evites/retention'
import { runEviteSendsTick } from '@/lib/evites/cronTick'

/**
 * Retention (spec §12, §13), cron step 8. The party is Sat 14 Nov 2026 (ET); the boundaries are Eastern CALENDAR
 * days, not 24-hour spans: +7 d is Sat 21 Nov, +30 d is Mon 14 Dec.
 */

jest.mock('@/lib/evites/mail')
jest.mock('@/lib/evites/render', () => ({ queueRender: jest.fn(), renderEvite: jest.fn() }))
let db: SendDb
jest.mock('@/lib/supabase', () => ({ getSupabase: () => db.supabase }))

const ENV = ['EVITES_PAGES', 'EVITES_SENDS', 'EVITES_PILOT_REFS'] as const
const saved: Record<string, string | undefined> = {}
type Row = Record<string, unknown>
const rsvp = (id: string) => db.tables.evite_rsvps.find((r) => r.id === id) as Row

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  process.env.EVITES_PAGES = 'on'
  process.env.EVITES_SENDS = 'off'
  delete process.env.EVITES_PILOT_REFS
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  jest.restoreAllMocks()
})

const CLUB = { club_email: 'club@example.com', club_opt_in_at: '2026-10-21T00:00:00Z', opt_in_text_version: 'v1', birthday_month: 3, consent_ip: '203.0.113.9' }

function partyDb(rsvps: Row[], o: Parameters<typeof cronDb>[0] = {}) {
  return cronDb({ rsvps, ...o, evite: { went_live_at: '2026-11-01T00:00:00Z', ...o?.evite } })
}

describe('day +7: the allergy note', () => {
  it('is kept up to and including the 20th, and purged on the 21st (Eastern date)', async () => {
    const id = uuid()
    db = partyDb([guestRsvp({ id, has_allergy: true, allergy_note: 'peanuts', reminder_email: 'g@example.com' })])
    // 20 Nov 23:30 ET = 21 Nov 04:30Z: still the 20th in New York.
    let rep = await runRetention(db.supabase, { now: new Date('2026-11-21T04:30:00Z') })
    expect(rep.allergyPurged).toBe(0)
    expect(rsvp(id).allergy_note).toBe('peanuts')
    // 21 Nov 00:30 ET = 05:30Z.
    rep = await runRetention(db.supabase, { now: new Date('2026-11-21T05:30:00Z') })
    expect(rep.allergyPurged).toBe(1)
    expect(rsvp(id).allergy_note).toBeNull()
    expect(rsvp(id).allergy_purged_at).toBe('2026-11-21T05:30:00.000Z')
    // The guest's reminder address is untouched until +30.
    expect(rsvp(id).reminder_email).toBe('g@example.com')
  })

  it('is not purged again once purged (the original time stays)', async () => {
    const id = uuid()
    db = partyDb([guestRsvp({ id, allergy_note: null, allergy_purged_at: '2026-11-21T05:30:00.000Z' })])
    const rep = await runRetention(db.supabase, { now: new Date('2026-11-25T12:00:00Z') })
    expect(rep.allergyPurged).toBe(0)
    expect(rsvp(id).allergy_purged_at).toBe('2026-11-21T05:30:00.000Z')
  })
})

describe('day +30: reminder contacts, then the archive', () => {
  const NOW = new Date('2026-12-14T17:00:00Z')

  it('purges a non-club guest, keeps a club opt-in as the consent record, and then archives the evite', async () => {
    const plain = uuid(), club = uuid(), out = uuid()
    db = partyDb([
      guestRsvp({ id: plain, reminder_email: 'p@example.com', consent_ip: '198.51.100.7' }),
      guestRsvp({ id: club, reminder_email: 'c@example.com', ...CLUB }),
      guestRsvp({ id: out, reminder_email: 'o@example.com', ...CLUB, club_opted_out_at: '2026-11-20T00:00:00Z' }),
    ])
    const rep = await runRetention(db.supabase, { now: NOW })
    expect(rep.contactsPurged).toBe(2)
    expect(rsvp(plain)).toMatchObject({ reminder_email: null, reminder_phone_e164: null, consent_ip: null, contacts_purged_at: NOW.toISOString() })
    // The club member keeps every consent field, and is not purged.
    expect(rsvp(club)).toMatchObject({ ...CLUB, contacts_purged_at: null })
    // Opted OUT: the reminder contact goes, the record of what they agreed to (and when they withdrew) stays.
    expect(rsvp(out)).toMatchObject({ reminder_email: null, contacts_purged_at: NOW.toISOString(), club_email: 'club@example.com', club_opt_in_at: '2026-10-21T00:00:00Z', club_opted_out_at: '2026-11-20T00:00:00Z', consent_ip: '203.0.113.9' })
    // Nobody is waiting to be purged, so the page goes.
    expect(rep.archivedAfterParty).toBe(1)
    expect(db.tables.evites[0].archived_at).toBe(NOW.toISOString())
  })

  it('does nothing on the 13th (day 29)', async () => {
    const id = uuid()
    db = partyDb([guestRsvp({ id, reminder_email: 'p@example.com' })])
    const rep = await runRetention(db.supabase, { now: new Date('2026-12-14T04:30:00Z') }) // 13 Dec 23:30 ET
    expect(rep.contactsPurged).toBe(0)
    expect(rep.archivedAfterParty).toBe(0)
    expect(rsvp(id).reminder_email).toBe('p@example.com')
    expect(db.tables.evites[0].archived_at).toBeNull()
  })

  it('does not archive while a guest still has contacts to purge (a failed purge is retried, not abandoned)', async () => {
    const id = uuid()
    db = partyDb([guestRsvp({ id, reminder_email: 'p@example.com' })])
    db.errors.push({ table: 'evite_rsvps', op: 'update', times: 1000 })
    const rep = await runRetention(db.supabase, { now: NOW })
    expect(rep.errors).toBeGreaterThan(0)
    expect(rep.archivedAfterParty).toBe(0)
    expect(rep.archiveDeferred).toBe(1)
    expect(db.tables.evites[0].archived_at).toBeNull()
    db.errors.length = 0
    const again = await runRetention(db.supabase, { now: new Date(NOW.getTime() + 15 * 60_000) })
    expect(again.contactsPurged).toBe(1)
    expect(again.archivedAfterParty).toBe(1)
  })

  it('a failed read is an error, never "nothing to purge"', async () => {
    db = partyDb([guestRsvp({ reminder_email: 'p@example.com' })])
    db.errors.push({ table: 'evite_rsvps', op: 'select', times: 1000 })
    const rep = await runRetention(db.supabase, { now: NOW })
    expect(rep.errors).toBeGreaterThan(0)
    expect(rep.contactsPurged).toBe(0)
  })
})

describe('a lead that never booked', () => {
  const LEAD = { status: 'awaiting_deposit', party_date: '2027-03-06' }
  const leadDb = (createdAt: string, booking: Row = {}) =>
    cronDb({ booking: { ...LEAD, ...booking }, evite: { created_at: createdAt }, payments: [] })

  it('is archived 60 days after the invitation was made, not before', async () => {
    db = leadDb('2026-10-01T12:00:00Z')
    let rep = await runRetention(db.supabase, { now: new Date('2026-11-29T12:00:00Z') }) // day 59
    expect(rep.archivedDeadLead).toBe(0)
    rep = await runRetention(db.supabase, { now: new Date('2026-11-30T12:00:00Z') }) // day 60
    expect(rep.archivedDeadLead).toBe(1)
    expect(db.tables.evites[0].archived_at).toBe('2026-11-30T12:00:00.000Z')
  })

  it('is archived once its party date has gone by, even inside 60 days', async () => {
    db = leadDb('2026-11-01T12:00:00Z', { party_date: '2026-11-10' })
    const rep = await runRetention(db.supabase, { now: new Date('2026-11-12T12:00:00Z') })
    expect(rep.archivedDeadLead).toBe(1)
  })

  it('a BOOKED party is never treated as a dead lead, however old the invitation', async () => {
    db = cronDb({ booking: { party_date: '2027-03-06' }, evite: { created_at: '2026-06-01T12:00:00Z' } })
    const rep = await runRetention(db.supabase, { now: new Date('2026-11-30T12:00:00Z') })
    expect(rep.archivedDeadLead).toBe(0)
    expect(db.tables.evites[0].archived_at).toBeNull()
  })
})

describe('the flags', () => {
  const NOW = new Date('2026-12-14T17:00:00Z')

  it('pages off: nothing is read or written', async () => {
    process.env.EVITES_PAGES = 'off'
    db = partyDb([guestRsvp({ reminder_email: 'p@example.com' })])
    const rep = await runRetention(db.supabase, { now: NOW })
    expect(rep).toMatchObject({ allergyPurged: 0, contactsPurged: 0, archivedAfterParty: 0, errors: 0 })
    expect(db.selects).toHaveLength(0)
  })

  it('pilot: only a booking named in EVITES_PILOT_REFS is touched', async () => {
    process.env.EVITES_PAGES = 'pilot'
    process.env.EVITES_PILOT_REFS = 'HH-SOMEONE-ELSE'
    const id = uuid()
    db = partyDb([guestRsvp({ id, reminder_email: 'p@example.com' })])
    let rep = await runRetention(db.supabase, { now: NOW })
    expect(rep.contactsPurged).toBe(0)
    expect(rsvp(id).reminder_email).toBe('p@example.com')
    process.env.EVITES_PILOT_REFS = 'HH-TEST-1'
    rep = await runRetention(db.supabase, { now: NOW })
    expect(rep.contactsPurged).toBe(1)
  })

  it('runs inside the tick whenever pages is on, even with sends off (privacy does not wait on the emails), and reports counts', async () => {
    const id = uuid()
    db = partyDb([guestRsvp({ id, allergy_note: 'peanuts', reminder_email: 'p@example.com' })])
    const rep = await runEviteSendsTick(db.supabase, { now: new Date('2026-11-25T12:00:00Z') })
    expect(rep.retention?.allergyPurged).toBe(1)
    expect(rsvp(id).allergy_note).toBeNull()
  })

  it('does not run inside the tick when pages is off', async () => {
    process.env.EVITES_PAGES = 'off'
    process.env.EVITES_SENDS = 'off'
    db = partyDb([guestRsvp({ allergy_note: 'peanuts' })])
    const rep = await runEviteSendsTick(db.supabase, { now: new Date('2026-11-25T12:00:00Z') })
    expect(rep.retention).toBeNull()
  })
})
