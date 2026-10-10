/**
 * The Birthday Club (spec §10): `recordClubOptIn` / `recordClubOptOut` / `retryClubLinks`.
 *
 * Driven against `makeFakeDb` carrying the real `contacts` constraints (raw-value unique email, `lead_source`
 * enum - extended with 'evite' exactly as migration 068 does) so a second INSERT of a different spelling is
 * possible, a 23505 is a real refusal, and an UPDATE of a contact is COUNTABLE.
 */

const mockFetch = jest.fn()
global.fetch = mockFetch as unknown as typeof fetch

import { makeFakeDb, type FakeDb } from '../../helpers/fakeReminderDb'
import { contactsSpec, LEAD_SOURCE_LABELS } from '../../helpers/fakeContactsDb'
import {
  CLUB_RETRY_PER_TICK,
  PROMOTIONAL_LIST_ID,
  clubListId,
  recordClubOptIn,
  recordClubOptOut,
  retryClubLinks,
  splitParentName,
} from '@/lib/evites/club'

const RSVP_ID = '11111111-1111-4111-8111-111111111111'
const EVITE_ID = '22222222-2222-4222-8222-222222222222'
const SLUG = 'mia-glow-ab3d'
const NOW = new Date('2026-10-20T15:00:00Z')

function specs() {
  const contacts = contactsSpec()
  // Migration 068: ALTER TYPE lead_source ADD VALUE 'evite'.
  contacts.checks = (contacts.checks ?? []).map((c) => (c.column === 'source' ? { ...c, allowed: [...LEAD_SOURCE_LABELS, 'evite'] } : c))
  return {
    contacts,
    evites: { columns: { id: 'uuid', slug: 'text' } as Record<string, 'uuid' | 'text'> },
    evite_rsvps: {
      columns: {
        id: 'uuid',
        evite_id: 'uuid',
        parent_name: 'text',
        club_email: 'text',
        club_opt_in_at: 'timestamptz',
        club_opted_out_at: 'timestamptz',
        opt_in_text_version: 'text',
        birthday_month: 'int',
        contact_id: 'uuid',
      } as Record<string, 'uuid' | 'text' | 'timestamptz' | 'int'>,
    },
  }
}

function rsvp(over: Record<string, unknown> = {}) {
  return {
    id: RSVP_ID,
    evite_id: EVITE_ID,
    parent_name: 'Jane Q Parent',
    club_email: 'Jane@Example.com',
    club_opt_in_at: '2026-10-20T14:59:00Z',
    club_opted_out_at: null,
    opt_in_text_version: 'club-v1',
    birthday_month: 6,
    contact_id: null,
    ...over,
  }
}

function db(seed: Record<string, Array<Record<string, unknown>>> = {}): FakeDb {
  return makeFakeDb(specs(), { evites: [{ id: EVITE_ID, slug: SLUG }], evite_rsvps: [rsvp()], contacts: [], ...seed })
}

/** Count UPDATEs the code issues against a table, by wrapping the fake's `from`. */
function watch(fake: FakeDb) {
  const updates: Record<string, number> = {}
  const inner = fake.supabase.from
  fake.supabase.from = (table: string) => {
    const t = inner(table)
    const update = t.update
    t.update = (payload: Record<string, unknown>) => {
      updates[table] = (updates[table] ?? 0) + 1
      return update(payload)
    }
    return t
  }
  return updates
}

const input = (over: Record<string, unknown> = {}) => ({
  email: 'Jane@Example.com',
  parentName: 'Jane Q Parent',
  birthdayMonth: 6,
  slug: SLUG,
  consentVersion: 'club-v1',
  rsvpId: RSVP_ID,
  ...over,
})

function brevoOk(status = 201) {
  mockFetch.mockResolvedValue({ ok: status < 300, status, text: async () => '{}' })
}
const brevoBodies = () => mockFetch.mock.calls.map(([, init]) => JSON.parse(init.body))

const OLD_ENV = { ...process.env }
beforeEach(() => {
  mockFetch.mockReset()
  process.env.BREVO_API_KEY = 'test-key'
  process.env.BREVO_BIRTHDAY_CLUB_LIST_ID = '9'
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  process.env = { ...OLD_ENV }
  jest.restoreAllMocks()
})

describe('recordClubOptIn - a contact that already exists', () => {
  it('links contact_id and writes NOTHING to the contact (zero contacts UPDATEs, no new row)', async () => {
    const fake = db({
      contacts: [{ id: '33333333-3333-4333-8333-333333333333', email: 'jane@example.com', first_name: 'Janet', last_name: 'Real', status: 'customer', email_opt_in: false, sms_opt_in: false, created_at: '2025-01-01T00:00:00Z' }],
    })
    const updates = watch(fake)
    brevoOk()
    const out = await recordClubOptIn(fake.supabase, input())
    expect(out).toEqual({ contact: 'linked', brevo: 'listed' })
    expect(updates.contacts ?? 0).toBe(0)
    expect(updates.evite_rsvps).toBe(1)
    expect(fake.tables.contacts).toHaveLength(1)
    expect(fake.tables.contacts[0]).toMatchObject({ first_name: 'Janet', last_name: 'Real', status: 'customer', email_opt_in: false })
    expect(fake.tables.evite_rsvps[0].contact_id).toBe('33333333-3333-4333-8333-333333333333')
  })

  it('with two rows for one person, links the OLDEST', async () => {
    const fake = db({
      contacts: [
        { id: '44444444-4444-4444-8444-444444444444', email: 'Jane@Example.com', created_at: '2026-03-01T00:00:00Z' },
        { id: '33333333-3333-4333-8333-333333333333', email: 'jane@example.com', created_at: '2025-01-01T00:00:00Z' },
      ],
    })
    brevoOk()
    await recordClubOptIn(fake.supabase, input())
    expect(fake.tables.evite_rsvps[0].contact_id).toBe('33333333-3333-4333-8333-333333333333')
  })
})

describe('recordClubOptIn - an absent contact', () => {
  it('INSERTs the email as typed, source evite, both opt-ins false, and links it', async () => {
    const fake = db()
    brevoOk()
    const out = await recordClubOptIn(fake.supabase, input())
    expect(out).toEqual({ contact: 'created', brevo: 'listed' })
    expect(fake.tables.contacts).toHaveLength(1)
    expect(fake.tables.contacts[0]).toMatchObject({
      email: 'Jane@Example.com',
      first_name: 'Jane',
      last_name: 'Q Parent',
      source: 'evite',
      source_detail: `evite:${SLUG}`,
      status: 'lead',
      email_opt_in: false,
      sms_opt_in: false,
    })
    expect(fake.tables.evite_rsvps[0].contact_id).toBe(fake.tables.contacts[0].id)
    expect(fake.refusals).toEqual([])
  })

  it('a one-word parent name leaves last_name null', () => {
    expect(splitParentName('Madonna')).toEqual({ first_name: 'Madonna', last_name: null })
    expect(splitParentName('   ')).toEqual({ first_name: null, last_name: null })
  })

  it('23505 on the INSERT: re-finds the winner and takes the found branch (no second row, no update)', async () => {
    const fake = db()
    const winner = { id: '55555555-5555-4555-8555-555555555555', email: 'Jane@Example.com', first_name: 'Winner', created_at: '2026-10-20T14:00:00Z' }
    // The first lookup sees nobody; then another writer inserts; our INSERT collides on contacts_email_key.
    const inner = fake.supabase.from
    let looked = 0
    fake.supabase.from = (table: string) => {
      const t = inner(table)
      if (table === 'contacts') {
        const select = t.select
        t.select = (cols?: string) => {
          looked += 1
          if (looked === 1) {
            const q = select(cols)
            const realThen = q.then.bind(q)
            q.then = (res: any, rej: any) => {
              fake.tables.contacts.push(winner)
              return realThen(() => res({ data: [], error: null }), rej)
            }
            return q
          }
          return select(cols)
        }
      }
      return t
    }
    const updates = watch(fake)
    brevoOk()
    const out = await recordClubOptIn(fake.supabase, input({ email: 'Jane@Example.com' }))
    expect(out.contact).toBe('linked')
    expect(fake.refusals.some((r) => r.error.code === '23505')).toBe(true)
    expect(fake.tables.contacts).toHaveLength(1)
    expect(updates.contacts ?? 0).toBe(0)
    expect(fake.tables.evite_rsvps[0].contact_id).toBe(winner.id)
  })

  it('a contacts read that fails is UNAVAILABLE: no insert, no link, no Brevo call, nothing thrown', async () => {
    const fake = db()
    fake.failReads('contacts')
    const out = await recordClubOptIn(fake.supabase, input())
    expect(out).toEqual({ contact: 'unavailable', brevo: 'not-attempted' })
    expect(fake.tables.contacts).toHaveLength(0)
    expect(fake.tables.evite_rsvps[0].contact_id).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('an INSERT that fails (not 23505) leaves the RSVP for the retry', async () => {
    const fake = db()
    fake.failWrites('contacts')
    const out = await recordClubOptIn(fake.supabase, input())
    expect(out.contact).toBe('unavailable')
    expect(fake.tables.evite_rsvps[0].contact_id).toBeNull()
  })

  it('an implausible address never reaches the database or Brevo', async () => {
    const fake = db()
    const out = await recordClubOptIn(fake.supabase, input({ email: '%@x' }))
    expect(out.contact).toBe('invalid')
    expect(fake.tables.contacts).toHaveLength(0)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('recordClubOptIn - Brevo', () => {
  it('POSTs /v3/contacts with a lowercased address, updateEnabled, the club list, and no emailBlacklisted', async () => {
    const fake = db()
    brevoOk()
    await recordClubOptIn(fake.supabase, input({ email: 'Jane@Example.COM' }))
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.brevo.com/v3/contacts')
    expect(init.method).toBe('POST')
    const body = brevoBodies()[0]
    expect(body).toEqual({ email: 'jane@example.com', updateEnabled: true, listIds: [9] })
    expect('emailBlacklisted' in body).toBe(false)
    expect('attributes' in body).toBe(false)
  })

  it('BREVO_BIRTHDAY_CLUB_LIST_ID unset: no Brevo call at all, the contact is still linked', async () => {
    delete process.env.BREVO_BIRTHDAY_CLUB_LIST_ID
    const fake = db()
    const out = await recordClubOptIn(fake.supabase, input())
    expect(out).toEqual({ contact: 'created', brevo: 'skipped' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each(['', 'abc', '0', '-4', '9.5', String(PROMOTIONAL_LIST_ID)])('list id %p is not usable (and 3 is never used)', async (raw) => {
    process.env.BREVO_BIRTHDAY_CLUB_LIST_ID = raw
    expect(clubListId()).toBeNull()
    const fake = db()
    const out = await recordClubOptIn(fake.supabase, input())
    expect(out.brevo).toBe('skipped')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('a Brevo error is reported as failed and does not undo the link', async () => {
    const fake = db()
    brevoOk(500)
    const out = await recordClubOptIn(fake.supabase, input())
    expect(out).toEqual({ contact: 'created', brevo: 'failed' })
    expect(fake.tables.evite_rsvps[0].contact_id).not.toBeNull()
  })

  it('a thrown fetch is a failed outcome, never an exception', async () => {
    const fake = db()
    mockFetch.mockRejectedValue(new Error('network down'))
    await expect(recordClubOptIn(fake.supabase, input())).resolves.toEqual({ contact: 'created', brevo: 'failed' })
  })
})

describe('recordClubOptOut', () => {
  it('removes the LOWERCASED address from the club list and nothing else', async () => {
    const fake = db()
    brevoOk(200)
    const out = await recordClubOptOut(fake.supabase, { email: 'Jane@Example.COM', rsvpId: RSVP_ID })
    expect(out).toEqual({ brevo: 'listed' })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.brevo.com/v3/contacts/lists/9/contacts/remove')
    expect(JSON.parse(init.body)).toEqual({ emails: ['jane@example.com'] })
    expect(fake.tables.contacts).toHaveLength(0)
  })

  it('no address, or no usable list id: no call', async () => {
    const fake = db()
    await recordClubOptOut(fake.supabase, { email: null, rsvpId: RSVP_ID })
    delete process.env.BREVO_BIRTHDAY_CLUB_LIST_ID
    await recordClubOptOut(fake.supabase, { email: 'a@b.co', rsvpId: RSVP_ID })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('retryClubLinks (cron step 8b)', () => {
  const row = (n: number, over: Record<string, unknown> = {}) =>
    rsvp({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`,
      club_email: `guest${n}@example.com`,
      club_opt_in_at: new Date(NOW.getTime() - n * 60_000).toISOString(),
      ...over,
    })

  it('picks up ONLY opted-in, unlinked, not-opted-out, recent rows and links them', async () => {
    const fake = db({
      evite_rsvps: [
        row(1),
        row(2, { contact_id: '33333333-3333-4333-8333-333333333333' }),
        row(3, { club_opt_in_at: null, opt_in_text_version: null, club_email: null }),
        row(4, { club_opted_out_at: '2026-10-20T14:00:00Z' }),
        row(5, { club_opt_in_at: '2026-01-01T00:00:00Z' }),
      ],
    })
    brevoOk()
    const rep = await retryClubLinks(fake.supabase, { now: NOW })
    expect(rep).toMatchObject({ candidates: 1, created: 1, linked: 0, unavailable: 0, readFailed: false })
    expect(fake.tables.contacts).toHaveLength(1)
    expect(fake.tables.contacts[0].email).toBe('guest1@example.com')
  })

  it(`is bounded to ${CLUB_RETRY_PER_TICK} a tick, newest first`, async () => {
    const rows = Array.from({ length: CLUB_RETRY_PER_TICK + 8 }, (_, i) => row(i + 1))
    const fake = db({ evite_rsvps: rows })
    brevoOk()
    const rep = await retryClubLinks(fake.supabase, { now: NOW })
    expect(rep.candidates).toBe(CLUB_RETRY_PER_TICK)
    expect(fake.tables.contacts).toHaveLength(CLUB_RETRY_PER_TICK)
    expect(fake.tables.contacts.map((c) => c.email)).toContain('guest1@example.com')
    expect(fake.tables.contacts.map((c) => c.email)).not.toContain(`guest${CLUB_RETRY_PER_TICK + 8}@example.com`)
  })

  it('a failed read is reported, not mistaken for "nothing to do"', async () => {
    const fake = db()
    fake.failReads('evite_rsvps')
    const rep = await retryClubLinks(fake.supabase, { now: NOW })
    expect(rep.readFailed).toBe(true)
    expect(rep.candidates).toBe(0)
  })

  it('the report is counts only: no address, name or slug in it', async () => {
    const fake = db({ evite_rsvps: [row(1)] })
    brevoOk()
    const json = JSON.stringify(await retryClubLinks(fake.supabase, { now: NOW }))
    expect(json).not.toMatch(/@|guest|mia-glow/i)
  })
})
