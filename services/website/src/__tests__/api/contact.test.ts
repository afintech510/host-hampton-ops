/**
 * Tests for public contact and lead form APIs:
 * - POST /api/contact
 * - POST /api/lead
 */

function buildChain(resolveValue: any) {
  const chain: any = {}
  const methods = ['select', 'ilike', 'insert', 'update', 'upsert', 'eq', 'neq', 'gte', 'lte', 'or', 'order', 'single', 'in', 'range', 'limit']
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

// Mock upsertContact — it calls getSupabase internally, simpler to mock it directly
const mockUpsertContact = jest.fn()
jest.mock('@/lib/contacts', () => ({
  upsertContact: (...args: any[]) => mockUpsertContact(...args),
}))

// Mock email templates for lead
jest.mock('@/lib/emailTemplates', () => ({
  leadNotifyHtml: jest.fn().mockReturnValue('<p>Lead notification</p>'),
  leadConfirmHtml: jest.fn().mockReturnValue('<p>Lead confirmation</p>'),
}))

import { POST as contactPost } from '@/app/api/contact/route'
import { POST as leadPost } from '@/app/api/lead/route'

describe('POST /api/contact', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = {
      ...originalEnv,
      RESEND_API_KEY: 're_test_fake',
      RESEND_FROM_EMAIL: 'test@mail.hosthampton.com',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_KEY: 'test-key',
    }
    // Default: upsertContact succeeds
    mockUpsertContact.mockResolvedValue('contact-uuid-1')
    // Set up supabase mock for interaction insert
    const chain = buildChain({ data: null, error: null })
    mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })
  })

  afterAll(() => { process.env = originalEnv })

  function makeReq(body: any) {
    return { json: jest.fn().mockResolvedValue(body) } as any
  }

  it('returns 400 when name is missing', async () => {
    const res = await contactPost(makeReq({ email: 'test@test.com', message: 'Hi' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when email is missing', async () => {
    const res = await contactPost(makeReq({ name: 'Test', message: 'Hi' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when message is missing', async () => {
    const res = await contactPost(makeReq({ name: 'Test', email: 'test@test.com' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid email format', async () => {
    const res = await contactPost(makeReq({ name: 'Test', email: 'not-email', message: 'Hi' }))
    expect(res.status).toBe(400)
  })

  it('returns 200 on valid submission', async () => {
    const res = await contactPost(makeReq({ name: 'Jane Doe', email: 'jane@test.com', message: 'Hello!' }))
    expect(res.status).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it('calls upsertContact with correct params', async () => {
    await contactPost(makeReq({ name: 'Jane Doe', email: 'jane@test.com', phone: '555-1234', message: 'Hello!' }))

    expect(mockUpsertContact).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Jane Doe',
      email: 'jane@test.com',
      phone: '555-1234',
      sourceDetail: 'Contact Us page',
    }))
  })

  it('sends 2 emails (admin + auto-response)', async () => {
    await contactPost(makeReq({ name: 'Jane Doe', email: 'jane@test.com', message: 'Hello!' }))
    expect(mockResendSend).toHaveBeenCalledTimes(2)
  })

  it('skips emails when RESEND_API_KEY not set', async () => {
    delete process.env.RESEND_API_KEY
    const res = await contactPost(makeReq({ name: 'Jane Doe', email: 'jane@test.com', message: 'Hello!' }))
    expect(res.status).toBe(200)
    expect(mockResendSend).not.toHaveBeenCalled()
  })
})

describe('POST /api/lead', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = {
      ...originalEnv,
      RESEND_API_KEY: 're_test_fake',
      RESEND_FROM_EMAIL: 'test@mail.hosthampton.com',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_KEY: 'test-key',
    }
    mockUpsertContact.mockResolvedValue('contact-uuid-2')
    const chain = buildChain({ data: null, error: null })
    mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })
  })

  afterAll(() => { process.env = originalEnv })

  const validLead = {
    eventType: 'Kids Birthday Party',
    fullName: 'Sarah Jones',
    email: 'sarah@test.com',
    phone: '631-555-1234',
    childAge: '7',
    guestCount: '15',
    partyTheme: 'Glow',
    preferredDate: '2026-04-10',
    sourcePage: 'party-packages',
  }

  function makeReq(body: any, extraHeaders?: Record<string, string>) {
    const headers: Record<string, string> = { host: 'www.hosthampton.com', ...extraHeaders }
    return {
      json: jest.fn().mockResolvedValue(body),
      headers: {
        get: (name: string) => headers[name] || headers[name.toLowerCase()] || null,
      },
    } as any
  }

  it('returns 400 when required fields are missing', async () => {
    const res = await leadPost(makeReq({ email: 'test@test.com' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid email', async () => {
    const res = await leadPost(makeReq({ ...validLead, email: 'bad-email' }))
    expect(res.status).toBe(400)
  })

  it('returns 200 on valid lead submission', async () => {
    const res = await leadPost(makeReq(validLead))
    expect(res.status).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it('calls upsertContact with correct service interests', async () => {
    await leadPost(makeReq(validLead))
    expect(mockUpsertContact).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Sarah Jones',
      email: 'sarah@test.com',
      phone: '631-555-1234',
      serviceInterests: ['kids-party'],
    }))
  })

  it('sends 2 emails (admin notification + customer confirmation)', async () => {
    await leadPost(makeReq(validLead))
    expect(mockResendSend).toHaveBeenCalledTimes(2)
  })

  it('sends owner notification to hosthampton295@gmail.com', async () => {
    await leadPost(makeReq(validLead))

    const ownerCall = mockResendSend.mock.calls.find(
      (call: any[]) => call[0].to === 'hosthampton295@gmail.com'
    )
    expect(ownerCall).toBeDefined()
    expect(ownerCall[0].subject).toContain('Sarah Jones')
  })

  it('maps room-rental source page to room-rental interest', async () => {
    await leadPost(makeReq({ ...validLead, sourcePage: 'party-room-rental', eventType: 'Studio Rental' }))
    expect(mockUpsertContact).toHaveBeenCalledWith(expect.objectContaining({
      serviceInterests: ['room-rental'],
    }))
  })

  it('skips emails when RESEND_API_KEY not set', async () => {
    delete process.env.RESEND_API_KEY
    const res = await leadPost(makeReq(validLead))
    expect(res.status).toBe(200)
    expect(mockResendSend).not.toHaveBeenCalled()
  })
})
