/**
 * Tests for POST /api/fundraiser-inquiry
 */

// --- Supabase chain mock ---
function buildChain(resolveValue: any) {
  const chain: any = {}
  const methods = ['select', 'ilike', 'insert', 'update', 'upsert', 'eq', 'neq', 'gte', 'lte', 'order', 'limit', 'single', 'in']
  for (const m of methods) {
    chain[m] = jest.fn().mockReturnValue(chain)
  }
  const p = Promise.resolve(resolveValue)
  chain.then = p.then.bind(p)
  chain.catch = p.catch.bind(p)
  return chain
}

// --- Module mocks ---
const mockResendSend = jest.fn().mockResolvedValue({ id: 'email_1' })
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockResendSend },
  })),
}))

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

import { POST } from '@/app/api/fundraiser-inquiry/route'

describe('POST /api/fundraiser-inquiry', () => {
  const originalEnv = process.env

  const validBody = {
    organizationName: 'Lincoln Elementary PTA',
    contactName: 'Sarah Jones',
    email: 'sarah@lincoln.edu',
    phone: '631-555-1234',
    organizationType: 'school',
    estimatedQuantity: '50–99',
    message: 'We need hats for spring fundraiser',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = {
      ...originalEnv,
      RESEND_API_KEY: 're_test_fake',
      RESEND_FROM_EMAIL: 'test@mail.hosthampton.com',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_KEY: 'test-key',
    }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  function makeReq(body: any) {
    return { json: jest.fn().mockResolvedValue(body) } as any
  }

  it('returns 400 when required fields are missing', async () => {
    const response = await POST(makeReq({ email: 'test@test.com' }))
    expect(response.status).toBe(400)
    expect(response.json().error).toContain('Missing required fields')
  })

  it('returns 400 when email format is invalid', async () => {
    const response = await POST(makeReq({
      organizationName: 'Test Org',
      contactName: 'Test',
      email: 'not-an-email',
    }))
    expect(response.status).toBe(400)
    expect(response.json().error).toContain('Invalid email')
  })

  it('creates the contact with an INSERT — never an upsert keyed on a raw address', async () => {
    // `upsertContact` reads case-insensitively and then INSERTs or UPDATES BY
    // ID. It must never go back to `upsert(record, {onConflict: 'email'})`:
    // `contacts_email_key` is unique on the RAW value, so that conflict target
    // is case-sensitive and `Foo@x.com` simply became a second row. Eight real
    // people (docs/contact-identity-review.md §1).
    const priorLookupChain = buildChain({ data: [], error: null })
    const insertChain = buildChain({ data: { id: 'contact-uuid-1' }, error: null })
    const updateChain = buildChain({ data: [{ id: 'contact-uuid-1' }], error: null })
    const interactionsChain = buildChain({ data: null, error: null })

    let contactsCalls = 0
    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'contacts') {
        contactsCalls++
        if (contactsCalls === 1) return priorLookupChain
        if (contactsCalls === 2) return insertChain
        return updateChain
      }
      return interactionsChain
    })

    mockGetSupabase.mockReturnValue({ from: fromMock })

    const response = await POST(makeReq(validBody))
    expect(response.status).toBe(200)
    expect(response.json().success).toBe(true)
    expect(priorLookupChain.ilike).toHaveBeenCalledWith('email', 'sarah@lincoln.edu')
    expect(insertChain.insert).toHaveBeenCalled()
    expect(priorLookupChain.upsert).not.toHaveBeenCalled()
    expect(insertChain.upsert).not.toHaveBeenCalled()
    // A brand-new contact IS a lead, and carries the address as typed.
    expect(insertChain.insert.mock.calls[0][0]).toEqual(
      expect.objectContaining({ status: 'lead', email: 'sarah@lincoln.edu' })
    )
  })

  it('updates an existing contact BY ID, writing neither status nor the stored spelling', async () => {
    // The row already exists as `unsubscribed`. The old code upserted
    // `status: 'lead'` unconditionally, which demoted paying customers and —
    // the reason it matters here — erased the opt-out. And rewriting `email`
    // would change the stored spelling under a unique index on the raw value.
    const priorLookupChain = buildChain({
      data: [{ id: 'contact-uuid-1', email: 'Sarah@lincoln.edu', status: 'unsubscribed', created_at: '2026-01-01T00:00:00Z' }],
      error: null,
    })
    const updateChain = buildChain({ data: [{ id: 'contact-uuid-1' }], error: null })
    const interactionsChain = buildChain({ data: null, error: null })

    let contactsCalls = 0
    mockGetSupabase.mockReturnValue({
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'contacts') {
          contactsCalls++
          return updateChain
        }
        return interactionsChain
      }).mockImplementationOnce((table: string) => {
        if (table === 'contacts') { contactsCalls++; return priorLookupChain }
        return interactionsChain
      }),
    })

    const response = await POST(makeReq(validBody))
    expect(response.status).toBe(200)
    expect(updateChain.insert).not.toHaveBeenCalled()
    expect(updateChain.upsert).not.toHaveBeenCalled()
    expect(updateChain.update).toHaveBeenCalled()
    const payload = updateChain.update.mock.calls[0][0]
    expect(payload).not.toHaveProperty('status')
    expect(payload).not.toHaveProperty('email')
    expect(updateChain.eq).toHaveBeenCalledWith('id', 'contact-uuid-1')
  })

  it('inserts contact_interaction with form_submission type', async () => {
    const contactsChain = buildChain({ data: null, error: null })
    const contactSelectChain = buildChain({ data: { id: 'contact-uuid-1' }, error: null })
    const interactionsChain = buildChain({ data: null, error: null })

    let contactsCalls = 0
    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'contacts') {
        contactsCalls++
        return contactsCalls <= 1 ? contactsChain : contactSelectChain
      }
      return interactionsChain
    })

    mockGetSupabase.mockReturnValue({ from: fromMock })

    await POST(makeReq(validBody))

    expect(fromMock).toHaveBeenCalledWith('contact_interactions')
    expect(interactionsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        contact_id: 'contact-uuid-1',
        type: 'form_submission',
        metadata: expect.objectContaining({ page: 'fundraiser' }),
      })
    )
  })

  it('sends 2 emails on successful submission', async () => {
    const contactsChain = buildChain({ data: null, error: null })
    const contactSelectChain = buildChain({ data: { id: 'contact-uuid-1' }, error: null })
    const interactionsChain = buildChain({ data: null, error: null })

    let contactsCalls = 0
    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'contacts') {
        contactsCalls++
        return contactsCalls <= 1 ? contactsChain : contactSelectChain
      }
      return interactionsChain
    })

    mockGetSupabase.mockReturnValue({ from: fromMock })

    await POST(makeReq(validBody))

    expect(mockResendSend).toHaveBeenCalledTimes(2)
  })

  it('skips emails when RESEND_API_KEY is not set', async () => {
    delete process.env.RESEND_API_KEY

    const contactsChain = buildChain({ data: null, error: null })
    const contactSelectChain = buildChain({ data: { id: 'contact-uuid-1' }, error: null })
    const interactionsChain = buildChain({ data: null, error: null })

    let contactsCalls = 0
    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'contacts') {
        contactsCalls++
        return contactsCalls <= 1 ? contactsChain : contactSelectChain
      }
      return interactionsChain
    })

    mockGetSupabase.mockReturnValue({ from: fromMock })

    const response = await POST(makeReq(validBody))
    expect(response.status).toBe(200)
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it('returns 200 even when contact upsert fails', async () => {
    const contactsChain = buildChain({ data: null, error: { message: 'upsert failed' } })
    const contactSelectChain = buildChain({ data: null, error: { message: 'not found' } })
    const interactionsChain = buildChain({ data: null, error: null })

    let contactsCalls = 0
    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'contacts') {
        contactsCalls++
        return contactsCalls <= 1 ? contactsChain : contactSelectChain
      }
      return interactionsChain
    })

    mockGetSupabase.mockReturnValue({ from: fromMock })

    const response = await POST(makeReq(validBody))
    expect(response.status).toBe(200)
    expect(response.json().success).toBe(true)
  })

  it('sends owner notification to hosthampton295@gmail.com', async () => {
    const contactsChain = buildChain({ data: null, error: null })
    const contactSelectChain = buildChain({ data: { id: 'contact-uuid-1' }, error: null })
    const interactionsChain = buildChain({ data: null, error: null })

    let contactsCalls = 0
    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'contacts') {
        contactsCalls++
        return contactsCalls <= 1 ? contactsChain : contactSelectChain
      }
      return interactionsChain
    })

    mockGetSupabase.mockReturnValue({ from: fromMock })

    await POST(makeReq(validBody))

    const ownerCall = mockResendSend.mock.calls.find(
      (call: any[]) => call[0].to === 'hosthampton295@gmail.com'
    )
    expect(ownerCall).toBeDefined()
    expect(ownerCall[0].subject).toContain('Lincoln Elementary PTA')
  })
})
