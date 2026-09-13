/**
 * Tests for admin contacts API routes:
 * - GET /api/admin/contacts
 * - GET /api/admin/contacts/[id]
 * - PATCH /api/admin/contacts/[id]
 *
 * The list route keeps a chain mock, because what it needs to assert is which
 * FILTER was built. The `[id]` routes are driven against `makeContactsDb`
 * (link 17): the old chain mock answered `{data: null, error: null}` to an
 * UPDATE, which is exactly what a zero-row update looks like — so it could not
 * see that this route answered `{ok: true}` for a contact id that does not
 * exist, on the surface whose fields are somebody's marketing consent.
 */

import { makeContactsDb } from '../helpers/fakeContactsDb'
import { contactSearchFilter } from '@/lib/contactLookup'

function buildChain(resolveValue: any) {
  const chain: any = {}
  const methods = ['select', 'ilike', 'insert', 'update', 'delete', 'eq', 'neq', 'gte', 'lte', 'or', 'order', 'single', 'maybeSingle', 'in', 'range', 'limit']
  for (const m of methods) {
    chain[m] = jest.fn().mockReturnValue(chain)
  }
  const p = Promise.resolve(resolveValue)
  chain.then = p.then.bind(p)
  chain.catch = p.catch.bind(p)
  return chain
}

const mockGetSupabase = jest.fn()

jest.mock('@/lib/supabase', () => ({
  getSupabase: (...args: any[]) => mockGetSupabase(...args),
}))

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({
      status: init?.status || 200,
      json: () => body,
      body,
    }),
  },
}))

import { GET as listContacts } from '@/app/api/admin/contacts/route'
import { GET as getContact, PATCH as updateContact } from '@/app/api/admin/contacts/[id]/route'

const C1 = '00000000-0000-4000-8000-0000000000c1'
const C2 = '00000000-0000-4000-8000-0000000000c2'

const sampleContact = {
  id: C1,
  first_name: 'Jane',
  last_name: 'Smith',
  email: 'jane@example.com',
  phone: '5551234567',
  status: 'lead',
  email_opt_in: true,
  sms_opt_in: false,
  created_at: '2026-02-01T00:00:00Z',
}

describe('Admin Contacts API', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, ADMIN_PASSWORD: 'test-admin-pw' }
  })

  afterAll(() => { process.env = originalEnv })

  function authHeaders() {
    return { get: (n: string) => n === 'authorization' ? 'Bearer test-admin-pw' : null, has: (n: string) => n === 'authorization' }
  }
  function noAuthHeaders() {
    return { get: () => null, has: () => false }
  }
  function db(seed: Record<string, any[]> = {}) {
    const fake = makeContactsDb(seed)
    mockGetSupabase.mockReturnValue(fake.supabase)
    return fake
  }

  describe('GET /api/admin/contacts', () => {
    it('returns 401 without auth', async () => {
      const req = { headers: noAuthHeaders() } as any
      const res = await listContacts(req)
      expect(res.status).toBe(401)
    })

    it('returns contacts list with total count', async () => {
      const chain = buildChain({ data: [sampleContact], error: null, count: 1 })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const url = new URL('http://localhost:3002/api/admin/contacts')
      const req = { headers: authHeaders(), nextUrl: url } as any
      const res = await listContacts(req)
      const body = res.json()

      expect(body.contacts).toBeDefined()
      expect(Array.isArray(body.contacts)).toBe(true)
      expect(body.total).toBeDefined()
    })

    it('applies status filter', async () => {
      const chain = buildChain({ data: [], error: null, count: 0 })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const url = new URL('http://localhost:3002/api/admin/contacts?status=vip')
      const req = { headers: authHeaders(), nextUrl: url } as any
      await listContacts(req)

      expect(chain.eq).toHaveBeenCalledWith('status', 'vip')
    })

    it('applies opt_in email filter', async () => {
      const chain = buildChain({ data: [], error: null, count: 0 })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const url = new URL('http://localhost:3002/api/admin/contacts?opt_in=email')
      const req = { headers: authHeaders(), nextUrl: url } as any
      await listContacts(req)

      expect(chain.eq).toHaveBeenCalledWith('email_opt_in', true)
    })

    it('applies a search filter built by contactSearchFilter, not by interpolation', async () => {
      const chain = buildChain({ data: [], error: null, count: 0 })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const url = new URL('http://localhost:3002/api/admin/contacts?search=jane')
      const req = { headers: authHeaders(), nextUrl: url } as any
      await listContacts(req)

      expect(chain.or).toHaveBeenCalledWith(contactSearchFilter('jane'))
      expect(chain.or).toHaveBeenCalledWith(expect.stringContaining('jane'))
    })

    it('a search term cannot rewrite its own PostgREST filter', async () => {
      const chain = buildChain({ data: [], error: null, count: 0 })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      // A comma starts a new disjunct and `)` closes the group; `%` is a LIKE
      // wildcard run. None of them may survive into the expression.
      const url = new URL(
        'http://localhost:3002/api/admin/contacts?search=' + encodeURIComponent('x,status.eq.vip)')
      )
      const req = { headers: authHeaders(), nextUrl: url } as any
      await listContacts(req)

      const built = chain.or.mock.calls[0][0] as string
      expect(built).not.toContain('status.eq.vip')
      expect(built.split(',')).toHaveLength(4) // exactly our four columns
    })

    it('returns 500 on supabase error', async () => {
      const chain = buildChain({ data: null, error: { message: 'db error' }, count: null })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const url = new URL('http://localhost:3002/api/admin/contacts')
      const req = { headers: authHeaders(), nextUrl: url } as any
      const res = await listContacts(req)
      expect(res.status).toBe(500)
    })
  })

  describe('GET /api/admin/contacts/[id]', () => {
    it('returns 401 without auth', async () => {
      const req = { headers: noAuthHeaders() } as any
      const res = await getContact(req, { params: Promise.resolve({ id: C1 }) })
      expect(res.status).toBe(401)
    })

    it('returns contact with interactions and reminders', async () => {
      db({
        contacts: [sampleContact],
        contact_interactions: [
          { id: '00000000-0000-4000-8000-00000000aa01', contact_id: C1, type: 'email_sent' },
        ],
      })

      const req = { headers: authHeaders() } as any
      const res = await getContact(req, { params: Promise.resolve({ id: C1 }) })
      const body = res.json()

      expect(body.contact).toBeDefined()
      expect(body.interactions).toHaveLength(1)
      expect(body.reminders).toBeDefined()
      expect(body.duplicateRows).toEqual([])
    })

    it('names the OTHER row when this person has two, so an opt-out here is not mistaken for all of them', async () => {
      db({
        contacts: [
          sampleContact,
          { ...sampleContact, id: C2, email: 'Jane@example.com', created_at: '2026-08-01T00:00:00Z' },
        ],
      })

      const req = { headers: authHeaders() } as any
      const res = await getContact(req, { params: Promise.resolve({ id: C1 }) })

      expect(res.json().duplicateRows).toEqual([{ id: C2, email: 'Jane@example.com' }])
    })

    it('returns 404 for non-existent contact', async () => {
      db({ contacts: [] })

      const req = { headers: authHeaders() } as any
      const res = await getContact(req, { params: Promise.resolve({ id: C2 }) })
      expect(res.status).toBe(404)
    })

    it('answers 503, not 404, when the contact read FAILS', async () => {
      const fake = db({ contacts: [sampleContact] })
      fake.failReads('contacts')

      const req = { headers: authHeaders() } as any
      const res = await getContact(req, { params: Promise.resolve({ id: C1 }) })
      expect(res.status).toBe(503)
    })
  })

  describe('PATCH /api/admin/contacts/[id]', () => {
    it('returns 401 without auth', async () => {
      const req = { headers: noAuthHeaders(), json: jest.fn() } as any
      const res = await updateContact(req, { params: Promise.resolve({ id: C1 }) })
      expect(res.status).toBe(401)
    })

    it('updates allowed fields', async () => {
      const fake = db({ contacts: [sampleContact] })

      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ status: 'vip', notes: 'VIP customer' }),
      } as any

      const res = await updateContact(req, { params: Promise.resolve({ id: C1 }) })
      expect(res.json().ok).toBe(true)
      expect(fake.tables.contacts[0]).toMatchObject({ status: 'vip', notes: 'VIP customer' })
    })

    it('returns 400 when no valid fields provided', async () => {
      db({ contacts: [sampleContact] })
      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ invalid_field: 'value' }),
      } as any

      const res = await updateContact(req, { params: Promise.resolve({ id: C1 }) })
      expect(res.status).toBe(400)
    })

    it('refuses a status outside the contact_status enum, with a 400 rather than a 500', async () => {
      const fake = db({ contacts: [sampleContact] })
      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ status: 'nurturing' }),
      } as any

      const res = await updateContact(req, { params: Promise.resolve({ id: C1 }) })
      expect(res.status).toBe(400)
      expect(fake.tables.contacts[0].status).toBe('lead')
    })

    it('updates opt-in fields', async () => {
      const fake = db({ contacts: [sampleContact] })

      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ email_opt_in: false, sms_opt_in: true }),
      } as any

      const res = await updateContact(req, { params: Promise.resolve({ id: C1 }) })
      expect(res.json().ok).toBe(true)
      expect(fake.tables.contacts[0]).toMatchObject({ email_opt_in: false, sms_opt_in: true })
    })

    it('does NOT answer ok for an id that matches no row', async () => {
      // The whole point of `.select('id')` on the update: this used to be a
      // cheerful `{ok: true}` over a write that changed nothing.
      db({ contacts: [sampleContact] })

      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ email_opt_in: false }),
      } as any

      const res = await updateContact(req, { params: Promise.resolve({ id: C2 }) })
      expect(res.status).toBe(404)
      expect(res.json().ok).toBeUndefined()
    })

    it('an opt-out written here does NOT reach the person’s other row — and the GET says so', async () => {
      // Recorded rather than fixed: merging eight real people is needs-Adam 31.
      // What must not happen is that nobody can tell.
      const fake = db({
        contacts: [
          { ...sampleContact, email_opt_in: true },
          { ...sampleContact, id: C2, email: 'Jane@example.com', email_opt_in: true, created_at: '2026-08-01T00:00:00Z' },
        ],
      })

      await updateContact(
        { headers: authHeaders(), json: jest.fn().mockResolvedValue({ email_opt_in: false }) } as any,
        { params: Promise.resolve({ id: C1 }) }
      )

      expect(fake.tables.contacts[0].email_opt_in).toBe(false)
      expect(fake.tables.contacts[1].email_opt_in).toBe(true)

      const res = await getContact({ headers: authHeaders() } as any, { params: Promise.resolve({ id: C1 }) })
      expect(res.json().duplicateRows).toHaveLength(1)
    })
  })
})
