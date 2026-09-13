/**
 * The outbound mirror: `contactSync` → Brevo and Quo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Every assertion about a provider here was MEASURED against that provider's
 * live API on 2026-09-12 before it was written down, because the code's own
 * comment had been wrong about the central one for as long as it existed:
 *
 *   PUT  /v3/contacts/{email}  on an unknown address ->  404 document_not_found
 *   POST /v3/contacts  {updateEnabled:true}, new     ->  201
 *   POST /v3/contacts  {updateEnabled:true}, repeat  ->  204
 *   PUT  attributes-only after a blacklist           ->  blacklist SURVIVES
 *   POST /contacts/lists/3/add on a blacklisted one  ->  201, still blacklisted
 *   POST /v1/contacts (quo), duplicate externalId    ->  409
 *   GET  /v1/contacts?externalIds=<id>               ->  1 row, the right one
 *   GET  /v1/contacts?externalIds[]=<id>             ->  10 rows, UNFILTERED
 *
 * The last pair is why `findQuoContactByExternalId` does not use the bracketed
 * OpenPhone idiom: Quo ignores an unrecognised parameter rather than refusing
 * it, so that filter silently returns a page of strangers.
 */

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: (...a: any[]) => mockGetSupabase(...a) }))

import { makeContactsDb } from '../helpers/fakeContactsDb'
import { syncContactExternally } from '@/lib/contactSync'
import { upsertBrevoContact } from '@/lib/brevo'
import { findQuoContactByExternalId } from '@/lib/quo'

const CONTACT = '00000000-0000-4000-8000-00000000d001'
const QUO_ID = '6aa5a17e56a8c3d0a18f4bed'

type Call = { url: string; method: string; body: any }

function mockFetch(handler: (c: Call) => { status: number; body?: any; text?: string }) {
  const calls: Call[] = []
  global.fetch = jest.fn(async (url: any, init: any = {}) => {
    const call: Call = {
      url: String(url),
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)
    const res = handler(call)
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => res.body ?? {},
      text: async () => res.text ?? JSON.stringify(res.body ?? {}),
    } as any
  }) as any
  return calls
}

const originalFetch = global.fetch
const originalEnv = process.env

function db(seed: Record<string, any[]> = {}) {
  const fake = makeContactsDb(seed)
  mockGetSupabase.mockReturnValue(fake.supabase)
  return fake
}

function contactRow() {
  return {
    id: CONTACT,
    email: 'jess@example.com',
    phone: '6314008080',
    status: 'lead',
    email_opt_in: false,
    sms_opt_in: false,
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env = {
    ...originalEnv,
    BREVO_API_KEY: 'brevo-test-key',
    BREVO_DEFAULT_LIST_ID: '3',
    QUO_API_KEY: 'quo-test-key',
  }
  delete process.env.E2E_FAKE_SENDERS
})
afterEach(() => { global.fetch = originalFetch })
afterAll(() => { process.env = originalEnv })

/* ── Brevo ────────────────────────────────────────────────────────────── */

describe('upsertBrevoContact', () => {
  it('uses POST /contacts with updateEnabled — never PUT, which is update-only', async () => {
    const calls = mockFetch(() => ({ status: 201 }))
    const res = await upsertBrevoContact('a@x.com', { FIRSTNAME: 'A', LASTNAME: 'B' })

    expect(res).toEqual({ kind: 'synced', email: 'a@x.com', created: true })
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toBe('https://api.brevo.com/v3/contacts')
    expect(calls[0].body).toMatchObject({ email: 'a@x.com', updateEnabled: true })
  })

  it('treats 204 (the existing-contact answer) as success, not as an error', async () => {
    mockFetch(() => ({ status: 204 }))
    const res = await upsertBrevoContact('a@x.com', { FIRSTNAME: '', LASTNAME: '' })
    expect(res).toEqual({ kind: 'synced', email: 'a@x.com', created: false })
  })

  it('reports a 404 as an error rather than swallowing it — the old failure mode', async () => {
    mockFetch(() => ({ status: 404, text: '{"code":"document_not_found"}' }))
    const res = await upsertBrevoContact('a@x.com', { FIRSTNAME: '', LASTNAME: '' })
    expect(res.kind).toBe('error')
  })

  it('does not lowercase the address on the way out', async () => {
    const calls = mockFetch(() => ({ status: 201 }))
    await upsertBrevoContact('Jeberhardt517@gmail.com', { FIRSTNAME: '', LASTNAME: '' })
    expect(calls[0].body.email).toBe('Jeberhardt517@gmail.com')
  })
})

/* ── Quo ──────────────────────────────────────────────────────────────── */

describe('findQuoContactByExternalId', () => {
  it('uses `externalIds=`, NOT `externalIds[]=`, which Quo ignores', async () => {
    const calls = mockFetch(() => ({ status: 200, body: { data: [{ id: QUO_ID, externalId: CONTACT }] } }))
    const id = await findQuoContactByExternalId(CONTACT)

    expect(id).toBe(QUO_ID)
    expect(calls[0].url).toContain(`externalIds=${CONTACT}`)
    expect(calls[0].url).not.toContain('externalIds[]')
    expect(calls[0].url).not.toContain('externalIds%5B%5D')
  })

  it('re-compares the id and refuses a page of strangers', async () => {
    // Exactly what the bracketed form returns: an unfiltered page.
    mockFetch(() => ({
      status: 200,
      body: { data: [{ id: 'someone-else', externalId: 'not-ours' }, { id: 'another', externalId: null }] },
    }))
    expect(await findQuoContactByExternalId(CONTACT)).toBeNull()
  })

  it('returns null rather than throwing when Quo errors', async () => {
    mockFetch(() => ({ status: 500, text: 'boom' }))
    expect(await findQuoContactByExternalId(CONTACT)).toBeNull()
  })
})

/* ── syncContactExternally ────────────────────────────────────────────── */

describe('syncContactExternally', () => {
  it('records brevo_synced_at and clears sync_error on a clean run', async () => {
    const fake = db({ contacts: [contactRow()] })
    mockFetch(c => (c.url.includes('quo') ? { status: 201, body: { data: { id: QUO_ID } } } : { status: 201 }))

    const res = await syncContactExternally({ contactId: CONTACT, email: 'jess@example.com', phone: '6314008080' })

    expect(res.brevo).toEqual({ kind: 'synced' })
    expect(res.quo).toEqual({ kind: 'synced' })
    expect(res.recorded).toBe(true)
    expect(fake.tables.contacts[0].brevo_synced_at).toBeTruthy()
    expect(fake.tables.contacts[0].quo_contact_id).toBe(QUO_ID)
    expect(fake.tables.contacts[0].sync_error).toBeNull()
  })

  it('only adds to the marketing list when the caller says the contact consented', async () => {
    db({ contacts: [contactRow()] })
    const calls = mockFetch(() => ({ status: 201 }))

    await syncContactExternally({ contactId: CONTACT, email: 'jess@example.com', emailOptIn: false })
    expect(calls.some(c => c.url.includes('/lists/'))).toBe(false)

    calls.length = 0
    await syncContactExternally({ contactId: CONTACT, email: 'jess@example.com', emailOptIn: true })
    expect(calls.some(c => c.url.includes('/contacts/lists/3/contacts/add'))).toBe(true)
  })

  it('a failed list-add is `partial`, not `synced` — at Brevo is not on the list', async () => {
    const fake = db({ contacts: [contactRow()] })
    mockFetch(c => (c.url.includes('/lists/') ? { status: 400, text: 'nope' } : { status: 201 }))

    const res = await syncContactExternally({ contactId: CONTACT, email: 'jess@example.com', emailOptIn: true })

    expect(res.brevo.kind).toBe('partial')
    expect(fake.tables.contacts[0].sync_error).toContain('partial')
  })

  it('a Quo 409 recovers the existing id instead of failing forever', async () => {
    const fake = db({ contacts: [contactRow()] })
    mockFetch(c => {
      if (c.url.includes('api.brevo.com')) return { status: 201 }
      if (c.method === 'POST') return { status: 409, text: 'externalId exists' }
      return { status: 200, body: { data: [{ id: QUO_ID, externalId: CONTACT }] } }
    })

    const res = await syncContactExternally({ contactId: CONTACT, email: 'jess@example.com', phone: '6314008080' })

    expect(res.quo).toEqual({ kind: 'synced' })
    expect(fake.tables.contacts[0].quo_contact_id).toBe(QUO_ID)
  })

  it('names WHY a provider was skipped — four reasons, never one word', async () => {
    db({ contacts: [contactRow()] })
    mockFetch(() => ({ status: 201 }))

    const noEmail = await syncContactExternally({ contactId: CONTACT, phone: '6314008080' })
    expect(noEmail.brevo).toEqual({ kind: 'skipped', reason: 'no-email' })

    const noPhone = await syncContactExternally({ contactId: CONTACT, email: 'jess@example.com' })
    expect(noPhone.quo).toEqual({ kind: 'skipped', reason: 'no-phone' })

    delete process.env.BREVO_API_KEY
    delete process.env.QUO_API_KEY
    const unconfigured = await syncContactExternally({ contactId: CONTACT, email: 'a@x.com', phone: '6314008080' })
    expect(unconfigured.brevo).toEqual({ kind: 'skipped', reason: 'not-configured' })
    expect(unconfigured.quo).toEqual({ kind: 'skipped', reason: 'not-configured' })
  })

  it('reports `recorded: false` when the bookkeeping write matches no row', async () => {
    // The old code discarded this write's result entirely, which is why
    // `brevo_synced_at` was NULL on all 1220 rows and nobody knew.
    db({ contacts: [] })
    mockFetch(() => ({ status: 201 }))

    const res = await syncContactExternally({ contactId: CONTACT, email: 'jess@example.com' })

    expect(res.brevo.kind).toBe('synced')
    expect(res.recorded).toBe(false)
  })

  it('reports `recorded: false` when the bookkeeping write ERRORS', async () => {
    const fake = db({ contacts: [contactRow()] })
    mockFetch(() => ({ status: 201 }))
    fake.failWrites('contacts')

    const res = await syncContactExternally({ contactId: CONTACT, email: 'jess@example.com' })
    expect(res.recorded).toBe(false)
  })

  it('a Brevo failure is persisted to sync_error so a backfill can find it', async () => {
    const fake = db({ contacts: [contactRow()] })
    mockFetch(() => ({ status: 400, text: 'bad' }))

    const res = await syncContactExternally({ contactId: CONTACT, email: 'jess@example.com' })

    expect(res.brevo.kind).toBe('error')
    expect(fake.tables.contacts[0].sync_error).toContain('error')
    expect(fake.tables.contacts[0].brevo_synced_at).toBeUndefined()
  })

  it('says what happened in BOTH directions', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    db({ contacts: [contactRow()] })

    mockFetch(() => ({ status: 201 }))
    await syncContactExternally({ contactId: CONTACT, email: 'jess@example.com' })
    expect(log.mock.calls.flat().join(' ')).toContain('brevo=synced')

    mockFetch(() => ({ status: 400, text: 'bad' }))
    await syncContactExternally({ contactId: CONTACT, email: 'jess@example.com' })
    expect(warn.mock.calls.flat().join(' ')).toContain('brevo=error')

    log.mockRestore()
    warn.mockRestore()
  })
})
