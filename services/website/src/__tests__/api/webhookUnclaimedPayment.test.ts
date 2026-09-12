/**
 * The $927 that went missing — POST /api/webhook's unclaimed-payment net.
 *
 * On 2026-09-12 a real customer paid $927.00 on a live Stripe Payment Link and
 * it was recorded NOWHERE. The link had been created BY HAND in the Stripe
 * dashboard, so its metadata was `{}`; every `m.type` branch declined it, it
 * reached the legacy party-booking tail, the `bookings` insert was refused by
 * `bookings_contact_reachable_check` (no contact to put on the row), and the
 * handler then threw a TypeError formatting a confirmation email for a customer
 * it did not have. Stripe got a 500, retried, gave up.
 *
 * Every fixture in the other webhook suites carries metadata, which is exactly
 * why the bug survived. These use the REAL event shape, taken from the live
 * Stripe object: empty metadata, `payment_link` present, `client_reference_id`
 * null, `payment_status: 'paid'`.
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
  isUniqueViolation: jest.requireActual('@/lib/planPayment').isUniqueViolation,
}))

const unclaimedSpy = jest.fn()
jest.mock('@/lib/unclaimedPayment', () => {
  const actual = jest.requireActual('@/lib/unclaimedPayment')
  return {
    // `requireActual` on the PREDICATE, deliberately. The whole claim under test
    // is that the real `isUnclaimableSession` says yes to the real event shape;
    // stubbing it would let this suite pass while the route kept dropping
    // payments (hard-won rule 7 — a guardrail moved between modules can break
    // its own test silently).
    isUnclaimableSession: actual.isUnclaimableSession,
    recordUnclaimedStripeSession: (...args: unknown[]) => unclaimedSpy(...args),
    UNCLAIMED_CATEGORY: actual.UNCLAIMED_CATEGORY,
  }
})

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

/** The live session, as Stripe actually sent it. */
const ORPHAN = {
  id: 'cs_live_a19RC3RB68xfe47kovLSde8qWJbKp3N2NfOht5iDbMDg4ORYnrCHyQfsSi',
  object: 'checkout.session',
  amount_total: 92700,
  currency: 'usd',
  mode: 'payment',
  status: 'complete',
  payment_status: 'paid',
  payment_intent: 'pi_live_orphan',
  payment_link: 'plink_1UEd7K02uXWznKaWhBqqbnpC',
  client_reference_id: null,
  customer_details: { email: 'customer@example.com', name: 'A Customer' },
  metadata: {},
  livemode: true,
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

function event(over: Record<string, unknown> = {}, type = 'checkout.session.completed') {
  mockConstructEvent.mockReturnValue({ type, data: { object: { ...ORPHAN, ...over } } })
}

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
  matchSpy.mockResolvedValue({ outcome: 'unmatched' })
  unclaimedSpy.mockResolvedValue({ recorded: true, duplicate: false, reference: 'stripe-unmatched-x' })
  event()
})

afterAll(() => {
  process.env = originalEnv
})

const tablesTouched = () => mockFrom.mock.calls.map(c => c[0])

describe('POST /api/webhook — a settled session that nothing claims', () => {
  it('is RECORDED rather than dropped', async () => {
    const { POST } = await import('@/app/api/webhook/route')
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ received: true, unclaimed: true, recorded: true })
    expect(unclaimedSpy).toHaveBeenCalledTimes(1)
    expect((unclaimedSpy.mock.calls[0][0] as { amount_total: number }).amount_total).toBe(92700)
  })

  it('never reaches the legacy party-booking insert that used to throw', async () => {
    // That insert is what turned a lost payment into a 500 and a stack trace.
    const { POST } = await import('@/app/api/webhook/route')
    await POST(req())
    expect(tablesTouched()).not.toContain('bookings')
  })

  it('is ACKNOWLEDGED even when recording it also failed — a retry changes nothing', async () => {
    unclaimedSpy.mockResolvedValue({ recorded: false, reason: 'connection reset' })
    const { POST } = await import('@/app/api/webhook/route')
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ unclaimed: true, recorded: false })
  })

  it('does NOT swallow a session the metadata branches can still handle', async () => {
    // `contactEmail` is exactly what `bookings_contact_reachable_check` needs, so
    // a session carrying one still belongs to the legacy booking flow.
    event({
      metadata: { contactEmail: 'real@example.com', contactName: 'Real Person', partyDate: '2026-12-01', partyTime: '11:00' },
    })
    const { POST } = await import('@/app/api/webhook/route')
    await POST(req())
    expect(unclaimedSpy).not.toHaveBeenCalled()
    expect(tablesTouched()).toContain('bookings')
  })

  it('reaches none of this when the signature does not verify', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('Invalid signature')
    })
    const { POST } = await import('@/app/api/webhook/route')
    const res = await POST(req('forged'))
    expect(res.status).toBe(400)
    expect(unclaimedSpy).not.toHaveBeenCalled()
  })

  it('still matches a PLAN pay link by payment_link alone when the metadata is empty', async () => {
    // Tier 2 of `matchPlanPayLink` is what makes the plan path immune to this
    // whole class of bug, and `session.payment_link` IS populated on real live
    // Payment Link sessions — verified against production events.
    matchSpy.mockResolvedValue({ outcome: 'matched', target: TARGET })
    recordSpy.mockResolvedValue({
      ok: true, duplicate: false, bookingRef: 'HH-2026-TEST', amountCents: 92700, newBalanceCents: 0, overpaidCents: 0,
    })
    const { POST } = await import('@/app/api/webhook/route')
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(recordSpy).toHaveBeenCalledTimes(1)
    expect(unclaimedSpy).not.toHaveBeenCalled()
  })
})

describe('POST /api/webhook — the delayed half of a Checkout payment', () => {
  it('records a plan payment through the SAME path as checkout.session.completed', async () => {
    // `recordPlanPayment` refuses a `payment_status: 'unpaid'` session; this is
    // the event that says it settled after all. One code path, so the two cannot
    // drift into only one of them recording.
    matchSpy.mockResolvedValue({ outcome: 'matched', target: TARGET })
    recordSpy.mockResolvedValue({
      ok: true, duplicate: false, bookingRef: 'HH-2026-TEST', amountCents: 25000, newBalanceCents: 0, overpaidCents: 0,
    })
    event({ metadata: { type: 'plan_pay_link', booking_ref: 'HH-2026-TEST', purpose: 'deposit', pay_link_row_id: 'row-1' } }, 'checkout.session.async_payment_succeeded')
    const { POST } = await import('@/app/api/webhook/route')
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(recordSpy).toHaveBeenCalledTimes(1)
  })

  it('does NOT re-run the legacy ticket branches — that would issue a second ticket', async () => {
    event({ metadata: { type: 'event_ticket', eventId: 'e1', quantity: '2', customerEmail: 'x@example.com', customerName: 'X' } }, 'checkout.session.async_payment_succeeded')
    const { POST } = await import('@/app/api/webhook/route')
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(tablesTouched()).not.toContain('event_tickets')
    // Caught by the net instead, so it is visible rather than silently handled twice.
    expect(unclaimedSpy).toHaveBeenCalledTimes(1)
  })

  it('passes an overpayment through to the receipt so Adam is told', async () => {
    matchSpy.mockResolvedValue({ outcome: 'matched', target: TARGET })
    recordSpy.mockResolvedValue({
      ok: true, duplicate: false, bookingRef: 'HH-2026-TEST', amountCents: 60000, newBalanceCents: 0, overpaidCents: 30000,
    })
    const { POST } = await import('@/app/api/webhook/route')
    await POST(req())
    expect((receiptSpy.mock.calls[0][0] as { overpaidCents: number }).overpaidCents).toBe(30000)
  })
})
