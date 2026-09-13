/**
 * WHO IS THIS PERSON — the behaviour, driven against a fake that refuses what
 * Postgres refuses (`helpers/fakeContactsDb.ts`).
 *
 * The whole point of this file is the second test in it: with the real
 * `contacts_email_key UNIQUE (email)` in place, `upsert(record, { onConflict:
 * 'email' })` creates a SECOND row for the same human when the address is typed
 * with different capitals. That is how eight real people ended up with two
 * rows each, and every test that existed before this one passed against a mock
 * with no unique index at all.
 */

import { makeContactsDb } from '../helpers/fakeContactsDb'
import {
  findContactsByEmail,
  findContactsByPhone,
  normalizePhoneKey,
  contactSearchFilter,
  CANONICAL_ROW_RULE,
  CONTACT_STATUSES,
} from '@/lib/contactLookup'

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: (...a: any[]) => mockGetSupabase(...a) }))

const mockSync = jest.fn().mockResolvedValue({
  brevo: { kind: 'synced' },
  quo: { kind: 'skipped', reason: 'no-phone' },
  recorded: true,
})
jest.mock('@/lib/contactSync', () => ({
  syncContactExternally: (...a: any[]) => mockSync(...a),
}))

import { upsertContactResult, upsertContact, upsertContactByPhone } from '@/lib/contacts'

const OLD = '00000000-0000-4000-8000-00000000d001'
const NEW = '00000000-0000-4000-8000-00000000d002'

function row(id: string, email: string | null, extra: Record<string, any> = {}) {
  return {
    id,
    email,
    phone: null,
    status: 'lead',
    email_opt_in: false,
    sms_opt_in: false,
    created_at: '2026-03-07T18:13:00.000Z',
    ...extra,
  }
}

function db(seed: Record<string, any[]> = {}) {
  const fake = makeContactsDb(seed)
  mockGetSupabase.mockReturnValue(fake.supabase)
  return fake
}

const PARAMS = {
  name: 'Jess Eberhardt',
  email: 'jeberhardt517@gmail.com',
  phone: '5164564773',
  sourceDetail: 'Party Builder — Save Quote',
  serviceInterests: ['kids-party'],
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSync.mockResolvedValue({
    brevo: { kind: 'synced' },
    quo: { kind: 'skipped', reason: 'no-phone' },
    recorded: true,
  })
})

/* ── The unique index, and what it does to `onConflict` ───────────────── */

describe('contacts_email_key is on the RAW value', () => {
  it('the fake refuses a second row with the IDENTICAL address (23505)', async () => {
    const fake = db({ contacts: [row(OLD, 'a@x.com')] })
    const res: any = await fake.supabase.from('contacts').insert({ email: 'a@x.com', status: 'lead' })
    expect(res.error.code).toBe('23505')
    expect(fake.tables.contacts).toHaveLength(1)
  })

  it('and ACCEPTS one that differs only in case — which is the whole bug', async () => {
    const fake = db({ contacts: [row(OLD, 'a@x.com')] })
    const res: any = await fake.supabase.from('contacts').insert({ email: 'A@x.com', status: 'lead' })
    expect(res.error).toBeNull()
    expect(fake.tables.contacts).toHaveLength(2)
  })

  it('REGRESSION: the old `upsert(onConflict: email)` duplicates the person', async () => {
    // Pinned deliberately. This is the exact statement `upsertContact` used to
    // make, and against the real index it makes two rows out of one human.
    const fake = db({ contacts: [row(OLD, 'jeberhardt517@gmail.com')] })
    await fake.supabase
      .from('contacts')
      .upsert({ email: 'Jeberhardt517@gmail.com', status: 'lead' }, { onConflict: 'email' })
    expect(fake.tables.contacts).toHaveLength(2)

    // …and the same statement with the SAME spelling correctly updates in place.
    await fake.supabase
      .from('contacts')
      .upsert({ email: 'jeberhardt517@gmail.com', first_name: 'Jess' }, { onConflict: 'email' })
    expect(fake.tables.contacts).toHaveLength(2)
    expect(fake.tables.contacts[0].first_name).toBe('Jess')
  })
})

/* ── findContactsByEmail ──────────────────────────────────────────────── */

describe('findContactsByEmail', () => {
  it('finds a row whose stored spelling differs in case', async () => {
    const fake = db({ contacts: [row(OLD, 'Jeberhardt517@gmail.com')] })
    const res = await findContactsByEmail(fake.supabase, 'jeberhardt517@gmail.com')
    expect(res.kind).toBe('found')
    if (res.kind === 'found') expect(res.primary.id).toBe(OLD)
  })

  it('returns BOTH rows of a duplicated person, oldest first', async () => {
    const fake = db({
      contacts: [
        row(NEW, 'jeberhardt517@gmail.com', { created_at: '2026-05-25T22:51:00.000Z' }),
        row(OLD, 'Jeberhardt517@gmail.com', { created_at: '2026-05-25T01:24:00.000Z' }),
      ],
    })
    const res = await findContactsByEmail(fake.supabase, 'JEBERHARDT517@GMAIL.COM')
    expect(res.kind).toBe('found')
    if (res.kind !== 'found') return
    expect(res.contacts.map(c => c.id)).toEqual([OLD, NEW])
    expect(res.primary.id).toBe(OLD)
    expect(CANONICAL_ROW_RULE).toBe('oldest created_at wins')
  })

  it('a row with an unreadable clock sorts LAST rather than displacing a real one', async () => {
    const fake = db({
      contacts: [
        row(NEW, 'a@x.com', { created_at: 'not-a-date' }),
        row(OLD, 'A@x.com', { created_at: '2026-01-01T00:00:00.000Z' }),
      ],
    })
    const res = await findContactsByEmail(fake.supabase, 'a@x.com')
    if (res.kind !== 'found') throw new Error('expected found')
    expect(res.primary.id).toBe(OLD)
  })

  it('appends created_at when the caller did not ask for it', async () => {
    const fake = db({
      contacts: [
        row(NEW, 'a@x.com', { created_at: '2026-09-01T00:00:00.000Z' }),
        row(OLD, 'A@x.com', { created_at: '2026-01-01T00:00:00.000Z' }),
      ],
    })
    // Without the append, both rows would carry `created_at: undefined` and the
    // ordering would silently become "whatever order they came back in".
    const res = await findContactsByEmail(fake.supabase, 'a@x.com', 'id, status')
    if (res.kind !== 'found') throw new Error('expected found')
    expect(res.primary.id).toBe(OLD)
  })

  it('does not match a STRANGER through a LIKE wildcard in a real address', async () => {
    // `_` is any single character in LIKE, so `first_last@` must not return
    // `firstXlast@`. The exact re-compare is what makes `ilike` safe here.
    const fake = db({
      contacts: [row(OLD, 'firstXlast@gmail.com'), row(NEW, 'first_last@gmail.com')],
    })
    const res = await findContactsByEmail(fake.supabase, 'first_last@gmail.com')
    if (res.kind !== 'found') throw new Error('expected found')
    expect(res.contacts.map(c => c.id)).toEqual([NEW])
  })

  it('answers `unavailable` — not `absent` — when the read fails', async () => {
    const fake = db({ contacts: [row(OLD, 'a@x.com')] })
    fake.failReads('contacts')
    const res = await findContactsByEmail(fake.supabase, 'a@x.com')
    expect(res.kind).toBe('unavailable')
  })

  it('an empty address is absent, not an unfiltered list', async () => {
    const fake = db({ contacts: [row(OLD, 'a@x.com')] })
    expect((await findContactsByEmail(fake.supabase, '   ')).kind).toBe('absent')
  })
})

/* ── findContactsByPhone ──────────────────────────────────────────────── */

describe('findContactsByPhone', () => {
  it('normalises every format the live table actually holds', () => {
    for (const raw of ['6314008080', '+16314008080', '631-400-8080', '16314008080', '(631) 400-8080']) {
      expect(normalizePhoneKey(raw)).toBe('6314008080')
    }
    expect(normalizePhoneKey('8080')).toBe('')
    expect(normalizePhoneKey(null)).toBe('')
  })

  it('finds a contact stored in a different format from the inbound `From`', async () => {
    const fake = db({ contacts: [row(OLD, 'a@x.com', { phone: '631-400-8080' })] })
    const res = await findContactsByPhone(fake.supabase, '+16314008080')
    if (res.kind !== 'found') throw new Error('expected found')
    expect(res.primary.id).toBe(OLD)
  })

  it('returns EVERY row holding the number — a household shares a phone', async () => {
    const fake = db({
      contacts: [
        row(OLD, 'lina@x.com', { phone: '347-400-4495', created_at: '2026-01-01T00:00:00.000Z' }),
        row(NEW, 'ahmad@x.com', { phone: '3474004495', created_at: '2026-02-01T00:00:00.000Z' }),
      ],
    })
    const res = await findContactsByPhone(fake.supabase, '+13474004495')
    if (res.kind !== 'found') throw new Error('expected found')
    expect(res.contacts.map(c => c.id)).toEqual([OLD, NEW])
  })

  it('does not match a number that merely shares its last four digits', async () => {
    const fake = db({ contacts: [row(OLD, 'a@x.com', { phone: '516-555-8080' })] })
    expect((await findContactsByPhone(fake.supabase, '+16314008080')).kind).toBe('absent')
  })

  it('answers `unavailable` when the read fails', async () => {
    const fake = db({ contacts: [row(OLD, 'a@x.com', { phone: '6314008080' })] })
    fake.failReads('contacts')
    expect((await findContactsByPhone(fake.supabase, '+16314008080')).kind).toBe('unavailable')
  })
})

/* ── upsertContactResult ──────────────────────────────────────────────── */

describe('upsertContactResult', () => {
  it('creates one row for a new address, as a lead, with the address as typed', async () => {
    const fake = db({ contacts: [] })
    const res = await upsertContactResult({ ...PARAMS, email: 'Jeberhardt517@gmail.com' })
    expect(res.kind).toBe('created')
    expect(fake.tables.contacts).toHaveLength(1)
    expect(fake.tables.contacts[0]).toMatchObject({
      email: 'Jeberhardt517@gmail.com',
      status: 'lead',
    })
  })

  it('THE HEADLINE: a returning customer who capitalises differently is NOT duplicated', async () => {
    const fake = db({ contacts: [row(OLD, 'jeberhardt517@gmail.com', { status: 'customer' })] })

    const res = await upsertContactResult({ ...PARAMS, email: 'Jeberhardt517@gmail.com' })

    expect(res.kind).toBe('updated')
    expect(fake.tables.contacts).toHaveLength(1)
    if (res.kind === 'updated') expect(res.contactId).toBe(OLD)
  })

  it('does not rewrite the stored spelling — the unique index is on the raw value', async () => {
    const fake = db({ contacts: [row(OLD, 'Jeberhardt517@gmail.com')] })
    await upsertContactResult({ ...PARAMS, email: 'jeberhardt517@gmail.com' })
    expect(fake.tables.contacts[0].email).toBe('Jeberhardt517@gmail.com')
  })

  it('never demotes an existing status, including `unsubscribed`', async () => {
    const fake = db({ contacts: [row(OLD, 'a@x.com', { status: 'unsubscribed' })] })
    await upsertContactResult({ ...PARAMS, email: 'A@x.com' })
    expect(fake.tables.contacts[0].status).toBe('unsubscribed')
  })

  it('writes to the OLDEST row when a person already has two, and says so', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const fake = db({
      contacts: [
        row(NEW, 'jeberhardt517@gmail.com', { created_at: '2026-05-25T22:51:00.000Z' }),
        row(OLD, 'Jeberhardt517@gmail.com', { created_at: '2026-05-25T01:24:00.000Z' }),
      ],
    })

    const res = await upsertContactResult({ ...PARAMS, email: 'jeberhardt517@gmail.com' })

    if (res.kind !== 'updated') throw new Error('expected updated')
    expect(res.contactId).toBe(OLD)
    expect(fake.tables.contacts).toHaveLength(2)
    // Rule 10: it must not be silent that the other row was left alone.
    expect(warn.mock.calls.flat().join(' ')).toContain('2 contact rows share')
    warn.mockRestore()
  })

  it('a failed read is `unavailable` and writes NOTHING — it must not guess `absent`', async () => {
    const fake = db({ contacts: [row(OLD, 'jeberhardt517@gmail.com')] })
    fake.failReads('contacts')

    const res = await upsertContactResult(PARAMS)

    expect(res.kind).toBe('unavailable')
    expect(fake.tables.contacts).toHaveLength(1)
    expect(mockSync).not.toHaveBeenCalled()
  })

  it('a 23505 race after an `absent` read recovers by updating, not by failing', async () => {
    const fake = db({ contacts: [] })
    // Another writer lands the row between the read and the insert.
    const realInsert = fake.supabase.from
    let inserted = false
    mockGetSupabase.mockReturnValue({
      from: (t: string) => {
        const q = realInsert(t)
        if (t === 'contacts' && !inserted) {
          const origInsert = q.insert
          q.insert = (r: any) => {
            inserted = true
            fake.tables.contacts.push(row(OLD, 'jeberhardt517@gmail.com'))
            return origInsert.call(q, r)
          }
        }
        return q
      },
    })

    const res = await upsertContactResult(PARAMS)

    expect(res.kind).toBe('updated')
    if (res.kind === 'updated') expect(res.contactId).toBe(OLD)
    expect(fake.tables.contacts).toHaveLength(1)
  })

  it('an explicit marketing consent still sets email_opt_in on an existing row', async () => {
    const fake = db({ contacts: [row(OLD, 'a@x.com', { email_opt_in: false })] })
    await upsertContactResult({ ...PARAMS, email: 'A@x.com', marketingConsent: true })
    expect(fake.tables.contacts[0].email_opt_in).toBe(true)
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ emailOptIn: true }))
  })

  it('does NOT hand an `unsubscribed` contact back to the marketing list', async () => {
    // `optedOutReason` reads BOTH email_opt_in and status; this call site used
    // to read only the first, so an admin-set `unsubscribed` would have been
    // re-added to Brevo's list by that person's next enquiry.
    const fake = db({ contacts: [row(OLD, 'a@x.com', { email_opt_in: true, status: 'unsubscribed' })] })
    await upsertContactResult({ ...PARAMS, email: 'A@x.com' })
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ emailOptIn: false }))
    void fake
  })

  it('upsertContact() is the same implementation, narrowed to an id', async () => {
    db({ contacts: [row(OLD, 'a@x.com')] })
    await expect(upsertContact({ ...PARAMS, email: 'A@x.com' })).resolves.toBe(OLD)
  })

  it('upsertContact() answers null when the database is unavailable', async () => {
    const fake = db({ contacts: [row(OLD, 'a@x.com')] })
    fake.failReads('contacts')
    await expect(upsertContact({ ...PARAMS, email: 'a@x.com' })).resolves.toBeNull()
  })
})

/* ── upsertContactByPhone ─────────────────────────────────────────────── */

describe('upsertContactByPhone', () => {
  it('reuses a contact whose number is stored in another format', async () => {
    const fake = db({ contacts: [row(OLD, 'a@x.com', { phone: '(631) 833-8149' })] })
    const id = await upsertContactByPhone({ phone: '+16318338149', sourceDetail: 'quo-inbound-sms' })
    expect(id).toBe(OLD)
    expect(fake.tables.contacts).toHaveLength(1)
  })

  it('creates a phone-only lead when the number really is new', async () => {
    const fake = db({ contacts: [] })
    const id = await upsertContactByPhone({ phone: '+16318338149', name: 'Pat Doe', sourceDetail: 'quo-inbound-sms' })
    expect(id).toBeTruthy()
    expect(fake.tables.contacts).toHaveLength(1)
    expect(fake.tables.contacts[0]).toMatchObject({ email: null, status: 'lead', first_name: 'Pat' })
  })

  it('a failed read creates NOTHING — that is how the third row got made', async () => {
    const fake = db({ contacts: [row(OLD, 'a@x.com', { phone: '6318338149' })] })
    fake.failReads('contacts')
    const id = await upsertContactByPhone({ phone: '+16318338149', sourceDetail: 'quo-inbound-sms' })
    expect(id).toBeNull()
    expect(fake.tables.contacts).toHaveLength(1)
  })
})

/* ── contactSearchFilter ──────────────────────────────────────────────── */

describe('contactSearchFilter', () => {
  it('builds exactly four disjuncts for an ordinary term', () => {
    const f = contactSearchFilter('jane')
    expect(f.split(',')).toEqual([
      'first_name.ilike.*jane*',
      'last_name.ilike.*jane*',
      'email.ilike.*jane*',
      'phone.ilike.*jane*',
    ])
  })

  it('a comma cannot add a disjunct', () => {
    expect(contactSearchFilter('x,status.eq.vip')).not.toContain('status.eq.vip')
    expect(contactSearchFilter('x,status.eq.vip').split(',')).toHaveLength(4)
  })

  it('a parenthesis cannot close the group', () => {
    expect(contactSearchFilter('a)')).not.toContain(')')
  })

  it('a LIKE wildcard in the term is not a wildcard', () => {
    expect(contactSearchFilter('%')).toBe('id.is.null')
    expect(contactSearchFilter('a%b')).toBe(
      'first_name.ilike.*a b*,last_name.ilike.*a b*,email.ilike.*a b*,phone.ilike.*a b*'
    )
  })

  it('an all-metacharacter term returns NOTHING rather than everything', () => {
    for (const t of ['%', '_', '()', ',,,', '***', '']) {
      expect(contactSearchFilter(t)).toBe('id.is.null')
    }
  })
})

describe('CONTACT_STATUSES', () => {
  it('matches pg_enum contact_status exactly, in order', () => {
    expect([...CONTACT_STATUSES]).toEqual([
      'lead', 'warm_lead', 'hot_lead', 'customer', 'vip', 'inactive', 'unsubscribed',
    ])
  })
})
