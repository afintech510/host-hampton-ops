/**
 * Tests for admin events API routes:
 * - GET /api/admin/events
 * - POST /api/admin/events
 * - GET /api/admin/events/[id]
 * - PUT /api/admin/events/[id]
 * - DELETE /api/admin/events/[id]
 * - GET /api/admin/events/[id]/tickets
 * - POST /api/admin/events/[id]/email
 */

import { sampleEvent, sampleTicket } from '../mocks/fixtures'

// --- Chain builder ---
function buildChain(resolveValue: any) {
  const chain: any = {}
  const methods = ['select', 'ilike', 'insert', 'update', 'delete', 'eq', 'neq', 'gte', 'lte', 'order', 'single', 'in']
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

const mockResendSend = jest.fn().mockResolvedValue({ id: 'email_1' })
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockResendSend },
  })),
}))

// Import all route handlers AFTER mocks
import { GET as listEvents, POST as createEvent } from '@/app/api/admin/events/route'
import { GET as getEvent, PUT as updateEvent, DELETE as deleteEvent } from '@/app/api/admin/events/[id]/route'
import { GET as getTickets } from '@/app/api/admin/events/[id]/tickets/route'
import { POST as sendEmail } from '@/app/api/admin/events/[id]/email/route'

describe('Admin Events API', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = {
      ...originalEnv,
      ADMIN_PASSWORD: 'test-admin-pw',
      RESEND_API_KEY: 're_test_fake',
      RESEND_FROM_EMAIL: 'test@mail.hosthampton.com',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_KEY: 'test-key',
    }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  function authHeaders() {
    return {
      get: (name: string) => name === 'authorization' ? 'Bearer test-admin-pw' : null,
      has: (name: string) => name === 'authorization',
    }
  }

  function noAuthHeaders() {
    return {
      get: () => null,
      has: () => false,
    }
  }

  describe('GET /api/admin/events', () => {
    it('returns 401 without auth', async () => {
      const req = { headers: noAuthHeaders() } as any
      const response = await listEvents(req)
      expect(response.status).toBe(401)
    })

    it('returns events list with ticket counts', async () => {
      const eventsChain = buildChain({ data: [sampleEvent], error: null })
      const countChain = buildChain({ data: null, error: null, count: 4 })

      const fromMock = jest.fn().mockImplementation((table: string) => {
        if (table === 'event_tickets') return countChain
        return eventsChain
      })

      mockGetSupabase.mockReturnValue({ from: fromMock })

      const req = { headers: authHeaders() } as any
      const response = await listEvents(req)
      const body = response.json()

      expect(body.events).toBeDefined()
      expect(Array.isArray(body.events)).toBe(true)
    })
  })

  describe('POST /api/admin/events', () => {
    it('returns 401 without auth', async () => {
      const req = {
        headers: noAuthHeaders(),
        json: jest.fn().mockResolvedValue({}),
      } as any
      const response = await createEvent(req)
      expect(response.status).toBe(401)
    })

    it('creates event with auto-generated slug', async () => {
      const eventChain = buildChain({ data: { ...sampleEvent, slug: 'test-workshop' }, error: null })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(eventChain) })

      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({
          title: 'Test Workshop',
          category: 'workshop',
          priceCents: 3500,
          maxTickets: 20,
        }),
      } as any

      const response = await createEvent(req)
      const body = response.json()

      expect(body.event).toBeDefined()
      expect(eventChain.insert).toHaveBeenCalledWith(expect.objectContaining({
        slug: 'test-workshop',
        title: 'Test Workshop',
        category: 'workshop',
        price_cents: 3500,
        max_tickets: 20,
        available_tickets: 20,
      }))
    })
  })

  describe('GET /api/admin/events/[id]', () => {
    it('returns 401 without auth', async () => {
      const req = { headers: noAuthHeaders() } as any
      const response = await getEvent(req, { params: { id: 'abc' } })
      expect(response.status).toBe(401)
    })

    it('returns event detail with sessions when has_sessions=true', async () => {
      const sessionEvent = { ...sampleEvent, has_sessions: true }
      const eventChain = buildChain({ data: sessionEvent, error: null })
      const sessionChain = buildChain({ data: [{ id: 's1' }], error: null })

      const fromMock = jest.fn().mockImplementation((table: string) => {
        if (table === 'event_sessions') return sessionChain
        return eventChain
      })

      mockGetSupabase.mockReturnValue({ from: fromMock })

      const req = { headers: authHeaders() } as any
      const response = await getEvent(req, { params: { id: sampleEvent.id } })
      const body = response.json()

      expect(body.event).toBeDefined()
      expect(body.sessions).toBeDefined()
    })

    it('returns 404 for non-existent event', async () => {
      const chain = buildChain({ data: null, error: { message: 'not found' } })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const req = { headers: authHeaders() } as any
      const response = await getEvent(req, { params: { id: 'nonexistent' } })
      expect(response.status).toBe(404)
    })
  })

  describe('PUT /api/admin/events/[id]', () => {
    it('updates event fields', async () => {
      const chain = buildChain({ data: { ...sampleEvent, title: 'Updated Title' }, error: null })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ title: 'Updated Title' }),
      } as any

      const response = await updateEvent(req, { params: { id: sampleEvent.id } })
      expect(response.status).toBe(200)
      expect(chain.update).toHaveBeenCalled()
    })

    it('recalculates available_tickets when max_tickets changes', async () => {
      const currentChain = buildChain({ data: { max_tickets: 12, available_tickets: 8 }, error: null })
      const updateChain = buildChain({ data: { ...sampleEvent, max_tickets: 20, available_tickets: 16 }, error: null })

      let callCount = 0
      const fromMock = jest.fn().mockImplementation(() => {
        callCount++
        if (callCount <= 1) return currentChain
        return updateChain
      })

      mockGetSupabase.mockReturnValue({ from: fromMock })

      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ maxTickets: 20 }),
      } as any

      await updateEvent(req, { params: { id: sampleEvent.id } })
      expect(fromMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('DELETE /api/admin/events/[id]', () => {
    it('soft-deletes event by setting is_active=false', async () => {
      const chain = buildChain({ data: null, error: null })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const req = { headers: authHeaders() } as any
      const response = await deleteEvent(req, { params: { id: sampleEvent.id } })
      expect(response.json().archived).toBe(true)
      expect(chain.update).toHaveBeenCalledWith({ is_active: false })
    })
  })

  describe('GET /api/admin/events/[id]/tickets', () => {
    it('returns 401 without auth', async () => {
      const req = { headers: noAuthHeaders() } as any
      const response = await getTickets(req, { params: { id: 'abc' } })
      expect(response.status).toBe(401)
    })

    it('returns ticket list for event', async () => {
      const chain = buildChain({ data: [sampleTicket], error: null })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const req = { headers: authHeaders() } as any
      const response = await getTickets(req, { params: { id: sampleEvent.id } })
      const body = response.json()

      expect(body.tickets).toBeDefined()
      expect(Array.isArray(body.tickets)).toBe(true)
    })
  })

  describe('POST /api/admin/events/[id]/email', () => {
    it('returns 401 without auth', async () => {
      const req = { headers: noAuthHeaders(), json: jest.fn() } as any
      const response = await sendEmail(req, { params: { id: 'abc' } })
      expect(response.status).toBe(401)
    })

    it('returns 400 when subject or body missing', async () => {
      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ subject: 'Test' }),
      } as any

      const response = await sendEmail(req, { params: { id: sampleEvent.id } })
      expect(response.status).toBe(400)
    })

    it('returns 400 when no confirmed attendees', async () => {
      const chain = buildChain({ data: [], error: null })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ subject: 'Reminder', htmlBody: '<p>Hello!</p>' }),
      } as any

      const response = await sendEmail(req, { params: { id: sampleEvent.id } })
      expect(response.status).toBe(400)
      expect(response.json().error).toContain('No confirmed attendees')
    })

    it('sends emails to unique confirmed attendees', async () => {
      const ticketsChain = buildChain({
        data: [
          { customer_email: 'jane@test.com', customer_name: 'Jane' },
          { customer_email: 'john@test.com', customer_name: 'John' },
          { customer_email: 'jane@test.com', customer_name: 'Jane' },
        ],
        error: null,
      })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(ticketsChain) })

      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ subject: 'Reminder', htmlBody: '<p>Hello!</p>' }),
      } as any

      const response = await sendEmail(req, { params: { id: sampleEvent.id } })
      const body = response.json()

      expect(body.total).toBe(2)
      expect(body.sent).toBe(2)
    })
  })
})
