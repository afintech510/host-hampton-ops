/**
 * Tests for admin campaigns, reminders, and actions API routes:
 * - GET/POST /api/admin/campaigns
 * - GET/PATCH/DELETE /api/admin/campaigns/[id]
 * - GET/PATCH /api/admin/reminders
 * - POST /api/admin/campaigns/actions
 */

function buildChain(resolveValue: any) {
  const chain: any = {}
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'gte', 'lte', 'or', 'order', 'single', 'in', 'range', 'limit']
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

const mockSendCampaign = jest.fn()
jest.mock('@/lib/brevo', () => ({
  sendCampaign: (...args: any[]) => mockSendCampaign(...args),
}))

import { GET as listCampaigns, POST as createCampaign } from '@/app/api/admin/campaigns/route'
import { GET as getCampaign, PATCH as updateCampaign, DELETE as deleteCampaign } from '@/app/api/admin/campaigns/[id]/route'
import { GET as listReminders, PATCH as cancelReminders } from '@/app/api/admin/reminders/route'
import { POST as runAction } from '@/app/api/admin/campaigns/actions/route'

const sampleCampaign = {
  id: 'camp-001',
  campaign_type: 'email',
  subject: 'Spring Newsletter',
  body_html: '<h1>Hello</h1>',
  status: 'draft',
  created_at: '2026-03-01T00:00:00Z',
}

describe('Admin Campaigns API', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = {
      ...originalEnv,
      ADMIN_PASSWORD: 'test-admin-pw',
      BREVO_API_KEY: 'test-brevo-key',
      BREVO_DEFAULT_LIST_ID: '5',
    }
  })

  afterAll(() => { process.env = originalEnv })

  function authHeaders() {
    return { get: (n: string) => n === 'authorization' ? 'Bearer test-admin-pw' : null, has: (n: string) => n === 'authorization' }
  }
  function noAuthHeaders() {
    return { get: () => null, has: () => false }
  }

  // --- Campaigns CRUD ---

  describe('GET /api/admin/campaigns', () => {
    it('returns 401 without auth', async () => {
      const req = { headers: noAuthHeaders() } as any
      const res = await listCampaigns(req)
      expect(res.status).toBe(401)
    })

    it('returns campaigns list', async () => {
      const chain = buildChain({ data: [sampleCampaign], error: null })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const url = new URL('http://localhost:3002/api/admin/campaigns')
      const req = { headers: authHeaders(), nextUrl: url } as any
      const res = await listCampaigns(req)

      expect(res.json().campaigns).toBeDefined()
      expect(Array.isArray(res.json().campaigns)).toBe(true)
    })

    it('filters by status', async () => {
      const chain = buildChain({ data: [], error: null })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const url = new URL('http://localhost:3002/api/admin/campaigns?status=sent')
      const req = { headers: authHeaders(), nextUrl: url } as any
      await listCampaigns(req)

      expect(chain.eq).toHaveBeenCalledWith('status', 'sent')
    })
  })

  describe('POST /api/admin/campaigns', () => {
    it('returns 401 without auth', async () => {
      const req = { headers: noAuthHeaders(), json: jest.fn() } as any
      const res = await createCampaign(req)
      expect(res.status).toBe(401)
    })

    it('returns 400 when subject is missing', async () => {
      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ body_html: '<p>test</p>' }),
      } as any
      const res = await createCampaign(req)
      expect(res.status).toBe(400)
    })

    it('creates draft campaign without scheduled_for', async () => {
      const chain = buildChain({ data: sampleCampaign, error: null })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ subject: 'Test Campaign', body_html: '<p>Hi</p>' }),
      } as any

      const res = await createCampaign(req)
      expect(res.json().campaign).toBeDefined()
      expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({
        subject: 'Test Campaign',
        status: 'draft',
      }))
    })

    it('creates scheduled campaign with scheduled_for', async () => {
      const chain = buildChain({ data: { ...sampleCampaign, status: 'scheduled' }, error: null })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({
          subject: 'Scheduled Campaign',
          scheduled_for: '2026-04-01T10:00:00Z',
        }),
      } as any

      const res = await createCampaign(req)
      expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({
        status: 'scheduled',
        scheduled_for: '2026-04-01T10:00:00Z',
      }))
    })
  })

  describe('GET /api/admin/campaigns/[id]', () => {
    it('returns 404 for non-existent campaign', async () => {
      const chain = buildChain({ data: null, error: { message: 'not found' } })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const req = { headers: authHeaders() } as any
      const res = await getCampaign(req, { params: Promise.resolve({ id: 'nonexistent' }) })
      expect(res.status).toBe(404)
    })

    it('returns campaign detail', async () => {
      const chain = buildChain({ data: sampleCampaign, error: null })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const req = { headers: authHeaders() } as any
      const res = await getCampaign(req, { params: Promise.resolve({ id: 'camp-001' }) })
      expect(res.json().campaign).toBeDefined()
    })
  })

  describe('PATCH /api/admin/campaigns/[id]', () => {
    it('sends campaign via Brevo when status=sending', async () => {
      const campaignChain = buildChain({ data: { ...sampleCampaign, campaign_type: 'email', subject: 'Test', body_html: '<p>Hi</p>' }, error: null })
      const updateChain = buildChain({ data: null, error: null })

      let callCount = 0
      const fromMock = jest.fn().mockImplementation(() => {
        callCount++
        return callCount <= 1 ? campaignChain : updateChain
      })
      mockGetSupabase.mockReturnValue({ from: fromMock })
      mockSendCampaign.mockResolvedValue(42)

      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ status: 'sending' }),
      } as any

      const res = await updateCampaign(req, { params: Promise.resolve({ id: 'camp-001' }) })
      expect(res.json().ok).toBe(true)
      expect(mockSendCampaign).toHaveBeenCalledWith(5, 'Test', '<p>Hi</p>', 'Host Hampton', undefined)
    })

    it('returns 500 when Brevo send fails', async () => {
      const campaignChain = buildChain({ data: { ...sampleCampaign, campaign_type: 'email', subject: 'Test', body_html: '<p>Hi</p>' }, error: null })
      const updateChain = buildChain({ data: null, error: null })

      let callCount = 0
      const fromMock = jest.fn().mockImplementation(() => {
        callCount++
        return callCount <= 1 ? campaignChain : updateChain
      })
      mockGetSupabase.mockReturnValue({ from: fromMock })
      mockSendCampaign.mockResolvedValue(null)

      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ status: 'sending' }),
      } as any

      const res = await updateCampaign(req, { params: Promise.resolve({ id: 'camp-001' }) })
      expect(res.status).toBe(500)
    })

    it('updates draft fields', async () => {
      const chain = buildChain({ data: null, error: null })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ subject: 'Updated Subject' }),
      } as any

      const res = await updateCampaign(req, { params: Promise.resolve({ id: 'camp-001' }) })
      expect(res.json().ok).toBe(true)
      expect(chain.update).toHaveBeenCalledWith({ subject: 'Updated Subject' })
    })

    it('returns 400 when no valid fields provided', async () => {
      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ invalid: 'stuff' }),
      } as any

      const res = await updateCampaign(req, { params: Promise.resolve({ id: 'camp-001' }) })
      expect(res.status).toBe(400)
    })
  })

  describe('DELETE /api/admin/campaigns/[id]', () => {
    it('cancels a draft campaign', async () => {
      const chain = buildChain({ data: null, error: null })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const req = { headers: authHeaders() } as any
      const res = await deleteCampaign(req, { params: Promise.resolve({ id: 'camp-001' }) })
      expect(res.json().ok).toBe(true)
      expect(chain.update).toHaveBeenCalledWith({ status: 'cancelled' })
    })
  })

  // --- Reminders ---

  describe('GET /api/admin/reminders', () => {
    it('returns 401 without auth', async () => {
      const req = { headers: noAuthHeaders() } as any
      const res = await listReminders(req)
      expect(res.status).toBe(401)
    })

    it('returns pending reminders', async () => {
      const chain = buildChain({ data: [{ id: 'r-1', reminder_type: 'event_1day', channel: 'email' }], error: null })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const req = { headers: authHeaders() } as any
      const res = await listReminders(req)
      expect(res.json().reminders).toBeDefined()
    })
  })

  describe('PATCH /api/admin/reminders', () => {
    it('returns 400 when no IDs provided', async () => {
      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ ids: [] }),
      } as any
      const res = await cancelReminders(req)
      expect(res.status).toBe(400)
    })

    it('cancels reminders by IDs', async () => {
      const chain = buildChain({ data: null, error: null })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ ids: ['r-1', 'r-2'] }),
      } as any
      const res = await cancelReminders(req)
      expect(res.json().ok).toBe(true)
      expect(res.json().cancelled).toBe(2)
    })
  })

  // --- Actions ---

  describe('POST /api/admin/campaigns/actions', () => {
    it('returns 401 without auth', async () => {
      const req = { headers: noAuthHeaders(), json: jest.fn() } as any
      const res = await runAction(req)
      expect(res.status).toBe(401)
    })

    it('returns 400 for unknown action', async () => {
      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ action: 'unknown' }),
      } as any
      const res = await runAction(req)
      expect(res.status).toBe(400)
    })

    it('draft-newsletter returns message when no upcoming events', async () => {
      const eventsChain = buildChain({ data: [], error: null })
      const insertChain = buildChain({ data: null, error: null })

      const fromMock = jest.fn().mockImplementation((table: string) => {
        if (table === 'events') return eventsChain
        return insertChain
      })
      mockGetSupabase.mockReturnValue({ from: fromMock })

      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ action: 'draft-newsletter' }),
      } as any
      const res = await runAction(req)
      expect(res.json().message).toContain('No upcoming events')
    })

    it('draft-newsletter creates draft campaign with events', async () => {
      const eventsChain = buildChain({
        data: [{ title: 'Spring Market', event_date: '2026-03-15', event_time: '2:00 PM', price_cents: 0, status: 'published' }],
        error: null,
      })
      const insertChain = buildChain({ data: { id: 'camp-new', subject: "What's Coming Up" }, error: null })

      const fromMock = jest.fn().mockImplementation((table: string) => {
        if (table === 'events') return eventsChain
        return insertChain
      })
      mockGetSupabase.mockReturnValue({ from: fromMock })

      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ action: 'draft-newsletter' }),
      } as any
      const res = await runAction(req)
      expect(res.json().message).toContain('1 events')
      expect(res.json().campaign).toBeDefined()
    })

    it('process-reminders returns 0 when nothing due', async () => {
      const chain = buildChain({ data: [], error: null })
      mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

      const req = {
        headers: authHeaders(),
        json: jest.fn().mockResolvedValue({ action: 'process-reminders' }),
      } as any
      const res = await runAction(req)
      expect(res.json().processed).toBe(0)
    })
  })
})
