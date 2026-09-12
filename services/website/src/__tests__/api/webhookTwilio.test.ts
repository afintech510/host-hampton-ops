/**
 * Tests for Twilio webhook handler:
 * - POST /api/webhooks/twilio
 *
 * Covers: STOP opt-out, HELP response, inbound SMS logging,
 *         delivery status callbacks, invalid body
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

import { POST } from '@/app/api/webhooks/twilio/route'

describe('POST /api/webhooks/twilio', () => {
  beforeEach(() => { jest.clearAllMocks() })

  function makeReq(formBody: string) {
    return {
      text: jest.fn().mockResolvedValue(formBody),
    } as any
  }

  function makeInvalidReq() {
    return {
      text: jest.fn().mockRejectedValue(new Error('read error')),
    } as any
  }

  it('returns 400 for invalid body', async () => {
    const res = await POST(makeInvalidReq())
    expect(res.status).toBe(400)
  })

  it('handles STOP — opts out of SMS and cancels reminders', async () => {
    const contactChain = buildChain({ data: { id: 'c-001' }, error: null })
    const updateChain = buildChain({ data: null, error: null })
    const insertChain = buildChain({ data: null, error: null })

    let contactsCalls = 0
    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'contacts') {
        contactsCalls++
        return contactsCalls <= 1 ? contactChain : updateChain
      }
      if (table === 'scheduled_reminders') return updateChain
      return insertChain
    })
    mockGetSupabase.mockReturnValue({ from: fromMock })

    const res = await POST(makeReq('From=%2B16315551234&Body=STOP&MessageSid=SM123'))

    // Should return TwiML XML
    expect(res.headers.get('Content-Type')).toBe('text/xml')
    const body = await (res as Response).text?.() || ''
    // It's a Response object with '<Response></Response>'
    expect(fromMock).toHaveBeenCalledWith('contacts')
    expect(fromMock).toHaveBeenCalledWith('scheduled_reminders')
    expect(fromMock).toHaveBeenCalledWith('contact_interactions')
  })

  it('handles HELP — returns TwiML with help text', async () => {
    const chain = buildChain({ data: null, error: null })
    mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

    const res = await POST(makeReq('From=%2B16315551234&Body=HELP&MessageSid=SM456'))
    expect(res.headers.get('Content-Type')).toBe('text/xml')
  })

  it('logs inbound SMS for known contact', async () => {
    const contactChain = buildChain({ data: { id: 'c-002' }, error: null })
    const insertChain = buildChain({ data: null, error: null })

    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'contacts') return contactChain
      return insertChain
    })
    mockGetSupabase.mockReturnValue({ from: fromMock })

    const res = await POST(makeReq('From=%2B16315559999&Body=Hello+there&MessageSid=SM789'))
    expect(res.headers.get('Content-Type')).toBe('text/xml')
    expect(fromMock).toHaveBeenCalledWith('contact_interactions')
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      contact_id: 'c-002',
      type: 'sms_received',
    }))
  })

  it('handles delivery status callback', async () => {
    const chain = buildChain({ data: null, error: null })
    mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

    const res = await POST(makeReq('MessageSid=SM999&MessageStatus=delivered'))
    expect(res.json().received).toBe(true)
  })

  it('returns received=true for empty body/from (status-only callback)', async () => {
    const chain = buildChain({ data: null, error: null })
    mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(chain) })

    const res = await POST(makeReq('MessageSid=SM000&SmsStatus=sent'))
    expect(res.json().received).toBe(true)
  })
})
