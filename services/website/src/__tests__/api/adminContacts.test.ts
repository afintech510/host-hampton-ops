/**
 * Tests for admin contacts API routes:
 * - GET /api/admin/contacts
 * - GET /api/admin/contacts/[id]
 * - PATCH /api/admin/contacts/[id]
 */

function buildChain(resolveValue: any) {
  const chain: any = {}
  const methods = ['select', 'ilike', 'insert', 'update', 'delete', 'eq', 'neq', 'gte', 'lte', 'or', 'order', 'single', 'in', 'range', 'limit']
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

const sampleContact = {
  id: 'c-001',
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

    it('applies search filter with or()', async () => {
      const chain = buildChain({ data: [], error: null, count: 0 })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const url = new URL('http://localhost:3002/api/admin/contacts?search=jane')
      const req = { headers: authHeaders(), nextUrl: url } as any
      await listContacts(req)

      expect(chain.or).toHaveBeenCalledWith(expect.stringContaining('jane'))
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
      const res = await getContact(req, { params: Promise.resolve({ id: 'c-001' }) })
      expect(res.status).toBe(401)
    })

    it('returns contact with interactions and reminders', async () => {
      const contactChain = buildChain({ data: sampleContact, error: null })
      const interactionsChain = buildChain({ data: [{ id: 'i-1', type: 'email_sent' }], error: null })
      const remindersChain = buildChain({ data: [], error: null })

      const fromMock = jest.fn().mockImplementation((table: string) => {
        if (table === 'contacts') return contactChain
        if (table === 'contact_interactions') return interactionsChain
        return remindersChain
      })
      mockGetSupabase.mockReturnValue({ from: fromMock })

      const req = { headers: authHeaders() } as any
      const res = await getContact(req, { params: Promise.resolve({ id: 'c-001' }) })
      const body = res.json()

      expect(body.contact).toBeDefined()
      expect(body.interactions).toBeDefined()
      expect(body.reminders).toBeDefined()
    })

    it('returns 404 for non-existent contact', async () => {
      const contactChain = buildChain({ data: null, error: null })
      const emptyChain = buildChain({ data: [], error: null })

      const fromMock = jest.fn().mockImplementation((table: string) => {
        if (table === 'contacts') return contactChain
        return emptyChain
      })
      mockGetSupabase.mockReturnValue({ from: fromMock })

      const req = { headers: authHeaders() } as any
      const res = await getContact(req, { params: Promise.resolve({ id: 'nonexistent' }) })
      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /api/admin/contacts/[id]', () => {
    it('returns 401 without auth', async () => {
      const req = { headers: noAuthHeaders(), json: jest.fn() } as any
      const res = await updateContact(req, { params: Promise.resolve({ id: 'c-001' }) })
      expect(res.status).toBe(401)
    })

    it('updates allowed fields', async () => {
      const chain = buildChain({ data: null, error: null })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ status: 'vip', notes: 'VIP customer' }),
      } as any

      const res = await updateContact(req, { params: Promise.resolve({ id: 'c-001' }) })
      expect(res.json().ok).toBe(true)
      expect(chain.update).toHaveBeenCalledWith({ status: 'vip', notes: 'VIP customer' })
    })

    it('returns 400 when no valid fields provided', async () => {
      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ invalid_field: 'value' }),
      } as any

      const res = await updateContact(req, { params: Promise.resolve({ id: 'c-001' }) })
      expect(res.status).toBe(400)
    })

    it('updates opt-in fields', async () => {
      const chain = buildChain({ data: null, error: null })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ email_opt_in: false, sms_opt_in: true }),
      } as any

      const res = await updateContact(req, { params: Promise.resolve({ id: 'c-001' }) })
      expect(res.json().ok).toBe(true)
      expect(chain.update).toHaveBeenCalledWith({ email_opt_in: false, sms_opt_in: true })
    })
  })
})
