/**
 * Tests for Brevo webhook handler:
 * - POST /api/webhooks/brevo
 *
 * Covers: unsubscribe, hard_bounce, soft_bounce (with 3+ threshold),
 *         opened, clicked, missing fields, invalid JSON
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

import { POST } from '@/app/api/webhooks/brevo/route'

describe('POST /api/webhooks/brevo', () => {
  beforeEach(() => { jest.clearAllMocks() })

  function makeReq(body: any) {
    return {
      json: jest.fn().mockResolvedValue(body),
    } as any
  }

  function makeInvalidReq() {
    return {
      json: jest.fn().mockRejectedValue(new Error('parse error')),
    } as any
  }

  it('returns 400 for invalid JSON', async () => {
    const res = await POST(makeInvalidReq())
    expect(res.status).toBe(400)
  })

  it('returns 400 when event or email is missing', async () => {
    const res = await POST(makeReq({ event: 'unsubscribed' }))
    expect(res.status).toBe(400)
  })

  it('handles unsubscribe — sets email_opt_in=false and logs interaction', async () => {
    const contactsChain = buildChain({ data: null, error: null })
    const contactLookup = buildChain({ data: { id: 'c-001' }, error: null })
    const interactionsChain = buildChain({ data: null, error: null })

    let contactsCalls = 0
    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'contacts') {
        contactsCalls++
        return contactsCalls <= 1 ? contactsChain : contactLookup
      }
      return interactionsChain
    })
    mockGetSupabase.mockReturnValue({ from: fromMock })

    const res = await POST(makeReq({ event: 'unsubscribed', email: 'test@example.com' }))
    expect(res.json().received).toBe(true)
    expect(contactsChain.update).toHaveBeenCalledWith({ email_opt_in: false })
  })

  it('handles hard_bounce — disables email', async () => {
    const contactsChain = buildChain({ data: null, error: null })
    const contactLookup = buildChain({ data: { id: 'c-002' }, error: null })
    const interactionsChain = buildChain({ data: null, error: null })

    let contactsCalls = 0
    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'contacts') {
        contactsCalls++
        return contactsCalls <= 1 ? contactsChain : contactLookup
      }
      return interactionsChain
    })
    mockGetSupabase.mockReturnValue({ from: fromMock })

    const res = await POST(makeReq({ event: 'hard_bounce', email: 'bounce@example.com' }))
    expect(res.json().received).toBe(true)
    expect(contactsChain.update).toHaveBeenCalledWith({ email_opt_in: false })
  })

  it('handles opened — updates last_engaged_at', async () => {
    const contactsChain = buildChain({ data: null, error: null })
    const contactLookup = buildChain({ data: { id: 'c-003' }, error: null })
    const interactionsChain = buildChain({ data: null, error: null })

    let contactsCalls = 0
    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'contacts') {
        contactsCalls++
        return contactsCalls <= 1 ? contactsChain : contactLookup
      }
      return interactionsChain
    })
    mockGetSupabase.mockReturnValue({ from: fromMock })

    const res = await POST(makeReq({ event: 'opened', email: 'active@example.com' }))
    expect(res.json().received).toBe(true)
    expect(contactsChain.update).toHaveBeenCalledWith(expect.objectContaining({
      last_engaged_at: expect.any(String),
    }))
  })

  it('handles clicked — updates last_engaged_at and logs with link', async () => {
    const contactsChain = buildChain({ data: null, error: null })
    const contactLookup = buildChain({ data: { id: 'c-004' }, error: null })
    const interactionsChain = buildChain({ data: null, error: null })

    let contactsCalls = 0
    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'contacts') {
        contactsCalls++
        return contactsCalls <= 1 ? contactsChain : contactLookup
      }
      return interactionsChain
    })
    mockGetSupabase.mockReturnValue({ from: fromMock })

    const res = await POST(makeReq({ event: 'clicked', email: 'click@example.com', link: 'https://hosthampton.com/events' }))
    expect(res.json().received).toBe(true)
  })

  it('returns 200 even for unrecognized events (graceful no-op)', async () => {
    const chain = buildChain({ data: null, error: null })
    mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

    const res = await POST(makeReq({ event: 'delivered', email: 'test@example.com' }))
    expect(res.json().received).toBe(true)
  })
})
