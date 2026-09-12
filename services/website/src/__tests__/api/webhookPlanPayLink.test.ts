/**
 * The plan pay link branch of POST /api/webhook.
 *
 * The signature cases live in `webhook.test.ts` and are unchanged; these are the
 * three things the new branch has to get right at the ROUTE level, which is where
 * the HTTP status that decides whether Stripe retries is chosen:
 *
 *   * a forged or missing signature reaches none of this;
 *   * a lookup that FAILED answers 500, so Stripe comes back — a 200 would
 *     discard a real payment;
 *   * a plan link never falls through to the legacy `pay_link` handler, which
 *     writes no `booking_payments` row.
 */

const mockConstructEvent = jest.fn()
jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({ webhooks: { constructEvent: mockConstructEvent } })),
)

const matchSpy = jest.fn()
const recordSpy = jest.fn()
const receiptSpy = jest.fn()
jest.mock('@/lib/planPayment', () => ({
  matchPlanPayLink: (...args: unknown[]) => matchSpy(...args),
  recordPlanPayment: (...args: unknown[]) => recordSpy(...args),
  sendPlanPaymentReceipt: (...args: unknown[]) => receiptSpy(...args),
}))

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: jest.fn().mockResolvedValue({ id: 'e1' }) } })),
}))

const mockFrom = jest.fn()
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn().mockImplementation(() => ({
    from: mockFrom,
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  })),
}))

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: () => body,
      body,
    }),
  },
}))

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'update', 'eq', 'in', 'gte', 'lte', 'order', 'single', 'maybeSingle', 'is', 'limit']) {
    c[m] = () => c
  }
  const p = Promise.resolve(result)
  c.then = p.then.bind(p)
  c.catch = p.catch.bind(p)
  return c
}

function req(sig: string | null = 'sig_valid') {
  return {
    text: jest.fn().mockResolvedValue('raw-body'),
    headers: {
      get: (name: string) => {
        if (name === 'stripe-signature') return sig
        if (name === 'host') return 'www.hosthampton.com'
        return null
      },
    },
  } as never
}

const SESSION = {
  id: 'cs_plan_1',
  amount_total: 25750,
  payment_intent: 'pi_1',
  payment_link: 'plink_1',
  metadata: { type: 'plan_pay_link', booking_ref: 'HH-2026-TEST', purpose: 'deposit', pay_link_row_id: 'row-1' },
}

const TARGET = {
  payLinkId: 'row-1',
  bookingRef: 'HH-2026-TEST',
  purpose: 'deposit' as const,
  expectedAmountCents: 25000,
  feeCents: 750,
  fromMetadataOnly: false,
}

const originalEnv = process.env

beforeEach(() => {
  jest.clearAllMocks()
  process.env = {
    ...originalEnv,
    STRIPE_SECRET_KEY: 'sk_test_fake',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_KEY: 'test-key',
  }
  mockFrom.mockImplementation(() => chain({ data: { contact_name: 'T', contact_email: 't@example.com' }, error: null }))
  mockConstructEvent.mockReturnValue({ type: 'checkout.session.completed', data: { object: SESSION } })
})

afterAll(() => {
  process.env = originalEnv
})

describe('POST /api/webhook — plan pay link', () => {
  it('reaches NONE of this when the signature does not verify', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('Invalid signature')
    })
    const { POST } = await import('@/app/api/webhook/route')
    const res = await POST(req('forged'))
    expect(res.status).toBe(400)
    expect(matchSpy).not.toHaveBeenCalled()
    expect(recordSpy).not.toHaveBeenCalled()
  })

  it('reaches none of this when there is no signature at all', async () => {
    const { POST } = await import('@/app/api/webhook/route')
    const res = await POST(req(null))
    expect(res.status).toBe(400)
    expect(matchSpy).not.toHaveBeenCalled()
  })

  it('records a matched plan payment and sends one receipt', async () => {
    matchSpy.mockResolvedValue({ outcome: 'matched', target: TARGET })
    recordSpy.mockResolvedValue({ ok: true, duplicate: false, bookingRef: 'HH-2026-TEST', amountCents: 25000, newBalanceCents: 75000 })
    const { POST } = await import('@/app/api/webhook/route')
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(recordSpy).toHaveBeenCalledTimes(1)
    expect(receiptSpy).toHaveBeenCalledTimes(1)
  })

  it('does NOT re-email on a redelivery', async () => {
    matchSpy.mockResolvedValue({ outcome: 'matched', target: TARGET })
    recordSpy.mockResolvedValue({ ok: true, duplicate: true, bookingRef: 'HH-2026-TEST', amountCents: 25000, newBalanceCents: 75000 })
    const { POST } = await import('@/app/api/webhook/route')
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ received: true, duplicate: true })
    expect(receiptSpy).not.toHaveBeenCalled()
  })

  it('answers 500 when the lookup FAILED, so Stripe redelivers', async () => {
    // A 200 here is how a payment gets lost forever.
    matchSpy.mockResolvedValue({ outcome: 'error', message: 'connection reset' })
    const { POST } = await import('@/app/api/webhook/route')
    const res = await POST(req())
    expect(res.status).toBe(500)
    expect(recordSpy).not.toHaveBeenCalled()
  })

  it('answers 500 when recording failed but could succeed later', async () => {
    matchSpy.mockResolvedValue({ outcome: 'matched', target: TARGET })
    recordSpy.mockResolvedValue({ ok: false, retryable: true, message: 'deadlock detected' })
    const { POST } = await import('@/app/api/webhook/route')
    const res = await POST(req())
    expect(res.status).toBe(500)
    expect(receiptSpy).not.toHaveBeenCalled()
  })

  it('stops retrying when the plan genuinely does not exist', async () => {
    matchSpy.mockResolvedValue({ outcome: 'matched', target: TARGET })
    recordSpy.mockResolvedValue({ ok: false, retryable: false, message: 'no such plan: HH-2026-TEST' })
    const { POST } = await import('@/app/api/webhook/route')
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ received: true })
  })

  it('lets an UNMATCHED session fall through to its own handler', async () => {
    // The legacy admin /api/admin/pay-link flow must keep working untouched.
    matchSpy.mockResolvedValue({ outcome: 'unmatched' })
    mockConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_legacy_1',
          amount_total: 5000,
          payment_intent: 'pi_legacy',
          payment_link: 'plink_legacy',
          metadata: { type: 'pay_link', customerName: 'Someone', amountCents: '5000', description: 'Room rental' },
        },
      },
    })
    const { POST } = await import('@/app/api/webhook/route')
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(recordSpy).not.toHaveBeenCalled()
    // The legacy branch's own work: a financial transaction, and no
    // booking_payments row (which is the gap the plan path exists to close).
    const tables = mockFrom.mock.calls.map(c => c[0])
    expect(tables).toContain('financial_transactions')
    expect(tables).not.toContain('booking_payments')
  })
})
