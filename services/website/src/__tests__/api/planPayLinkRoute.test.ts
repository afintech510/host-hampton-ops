/**
 * `POST /api/plan/[ref]/pay-link` — who may ask for a link, and for how much.
 *
 * The whole surface area of "pay for someone else's plan" is here, so it is
 * tested here rather than inferred from the page's access check. The two
 * questions:
 *
 *   1. Does a portal cookie for plan A get a pay link for plan B? (It must not.)
 *   2. Can a request body move the amount? (It must not, and for `custom` it may
 *      only do so for an admin and only within what the plan owes.)
 */

import { createMockNextRequest } from '../mocks/nextRequest'
import { buildPortalCookieValue } from '@/lib/portalAuth'
import { buildAdminCookieValue } from '@/lib/adminAuth'

const PORTAL_SECRET = 'test-portal-secret'

const mintSpy = jest.fn()
jest.mock('@/lib/planPayLinks', () => {
  const actual = jest.requireActual('@/lib/planPayLinks')
  return {
    // requireActual so the real `quoteFor`, `isPayPurpose` and the studio rule are
    // exercised — a guardrail moved behind a mock can pass its own test while
    // being gone (hard-won rule 7).
    ...actual,
    createPlanPayLink: (...args: unknown[]) => mintSpy(...args),
  }
})

const loadSpy = jest.fn()
jest.mock('@/lib/planInvoice', () => {
  const actual = jest.requireActual('@/lib/planInvoice')
  return { ...actual, loadPlanInvoice: (...args: unknown[]) => loadSpy(...args) }
})

jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})))

const paymentsResult: { data: unknown; error: unknown } = { data: [], error: null }
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => {
    const chain: Record<string, unknown> = {
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(paymentsResult).then(res, rej),
    }
    for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'maybeSingle', 'single', 'insert', 'update']) {
      chain[m] = () => chain
    }
    return { from: () => chain }
  },
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

const INVOICE = {
  booking: {
    id: 'bk-1',
    booking_ref: 'HH-2026-MINE',
    status: 'quoted',
    contact_email: 'adam@easternbuilding.supply',
    contact_phone: '+16314008080',
    contact_name: 'Test Person',
  },
  partyType: 'in_studio_theme',
  docTitle: 'Party Quotation',
  totalCents: 100000,
  depositCents: 25000,
  balanceDueCents: 75000,
  depositIsSeparate: false,
  invoiceNumber: '444124-000116',
}

function req(opts: { cookie?: string; body?: unknown; bearer?: string } = {}) {
  const headers: Record<string, string> = { host: 'www.hosthampton.com' }
  if (opts.cookie) headers.cookie = opts.cookie
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`
  return createMockNextRequest({
    method: 'POST',
    headers,
    body: opts.body ?? { purpose: 'deposit' },
  }) as never
}

const params = (ref = 'HH-2026-MINE') => Promise.resolve({ ref })

describe('POST /api/plan/[ref]/pay-link — access', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = {
      ...originalEnv,
      PORTAL_LINK_SIGNING_SECRET: PORTAL_SECRET,
      ADMIN_SESSION_SECRET: 'test-admin-secret',
      ADMIN_PASSWORD: 'shared-pw',
      STRIPE_SECRET_KEY: 'sk_test_fake',
    }
    paymentsResult.data = []
    paymentsResult.error = null
    loadSpy.mockResolvedValue({ ok: true, invoice: INVOICE })
    mintSpy.mockResolvedValue({
      ok: true,
      payUrl: 'https://pay.stripe.com/plink_1',
      payLinkId: 'row-1',
      quote: { purpose: 'deposit', amountCents: 25000, feeCents: 750, chargeCents: 25750, label: 'x' },
    })
  })

  afterAll(() => {
    process.env = originalEnv
  })

  const portalCookie = (ref: string) => `hh_portal=${buildPortalCookieValue(ref, PORTAL_SECRET)}`
  const adminCookie = () => `hh_admin=${buildAdminCookieValue('adam@benchworksai.com', 'test-admin-secret')}`

  it('refuses with no cookie at all', async () => {
    const { POST } = await import('@/app/api/plan/[ref]/pay-link/route')
    const res = await POST(req(), { params: params() })
    expect(res.status).toBe(403)
    expect(mintSpy).not.toHaveBeenCalled()
  })

  it('REFUSES a portal cookie for a DIFFERENT plan', async () => {
    // This is the "pay for someone else's plan" case. A portal session for
    // another booking is not a session for this one.
    const { POST } = await import('@/app/api/plan/[ref]/pay-link/route')
    const res = await POST(req({ cookie: portalCookie('HH-2026-THEIRS') }), { params: params('HH-2026-MINE') })
    expect(res.status).toBe(403)
    expect(mintSpy).not.toHaveBeenCalled()
  })

  it('allows the customer whose plan it is', async () => {
    const { POST } = await import('@/app/api/plan/[ref]/pay-link/route')
    const res = await POST(req({ cookie: portalCookie('HH-2026-MINE') }), { params: params('HH-2026-MINE') })
    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, payUrl: 'https://pay.stripe.com/plink_1' })
  })

  it('attributes a customer-minted link to their portal session, not to an admin', async () => {
    const { POST } = await import('@/app/api/plan/[ref]/pay-link/route')
    await POST(req({ cookie: portalCookie('HH-2026-MINE') }), { params: params('HH-2026-MINE') })
    expect(mintSpy.mock.calls[0][0]).toMatchObject({ actor: 'portal:HH-2026-MINE' })
  })

  it('allows an admin on any plan, and names them in the ledger actor', async () => {
    const { POST } = await import('@/app/api/plan/[ref]/pay-link/route')
    const res = await POST(req({ cookie: adminCookie() }), { params: params('HH-2026-ANYONES') })
    expect(res.status).toBe(200)
    // adminActorId, never a literal 'ADMIN' — both admins have claimed accounts.
    expect(mintSpy.mock.calls[0][0]).toMatchObject({ actor: 'admin:adam@benchworksai.com' })
  })

  it('still accepts the shared admin password, as the other 56 routes do', async () => {
    const { POST } = await import('@/app/api/plan/[ref]/pay-link/route')
    const res = await POST(req({ bearer: 'shared-pw' }), { params: params('HH-2026-ANYONES') })
    expect(res.status).toBe(200)
    // The historical anonymous actor, because the shared password names nobody.
    expect(mintSpy.mock.calls[0][0]).toMatchObject({ actor: 'ADMIN' })
  })
})

describe('POST /api/plan/[ref]/pay-link — the amount', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = {
      ...originalEnv,
      PORTAL_LINK_SIGNING_SECRET: PORTAL_SECRET,
      ADMIN_SESSION_SECRET: 'test-admin-secret',
      STRIPE_SECRET_KEY: 'sk_test_fake',
    }
    paymentsResult.data = []
    paymentsResult.error = null
    loadSpy.mockResolvedValue({ ok: true, invoice: INVOICE })
    mintSpy.mockResolvedValue({
      ok: true, payUrl: 'u', payLinkId: 'row-1',
      quote: { purpose: 'deposit', amountCents: 25000, feeCents: 750, chargeCents: 25750, label: 'x' },
    })
  })

  afterAll(() => {
    process.env = originalEnv
  })

  const portalCookie = (ref: string) => `hh_portal=${buildPortalCookieValue(ref, PORTAL_SECRET)}`
  const adminCookie = () => `hh_admin=${buildAdminCookieValue('adam@benchworksai.com', 'test-admin-secret')}`

  it('IGNORES an amount a customer puts in the body', async () => {
    // The body is data. `createPlanPayLink` is handed no customCents at all for a
    // deposit, so there is nothing for a crafted request to move.
    const { POST } = await import('@/app/api/plan/[ref]/pay-link/route')
    await POST(
      req({ cookie: portalCookie('HH-2026-MINE'), body: { purpose: 'deposit', amountDollars: '1.00', amountCents: 100 } }),
      { params: params('HH-2026-MINE') },
    )
    expect(mintSpy.mock.calls[0][0].customCents).toBeUndefined()
  })

  it('refuses a CUSTOM amount from a customer', async () => {
    const { POST } = await import('@/app/api/plan/[ref]/pay-link/route')
    const res = await POST(
      req({ cookie: portalCookie('HH-2026-MINE'), body: { purpose: 'custom', amountDollars: '1.00' } }),
      { params: params('HH-2026-MINE') },
    )
    expect(res.status).toBe(403)
    expect(mintSpy).not.toHaveBeenCalled()
  })

  it('accepts a custom amount from an admin, in cents', async () => {
    const { POST } = await import('@/app/api/plan/[ref]/pay-link/route')
    await POST(
      req({ cookie: adminCookie(), body: { purpose: 'custom', amountDollars: '300.50' } }),
      { params: params('HH-2026-MINE') },
    )
    expect(mintSpy.mock.calls[0][0].customCents).toBe(30050)
  })

  it('refuses an unknown purpose', async () => {
    const { POST } = await import('@/app/api/plan/[ref]/pay-link/route')
    const res = await POST(
      req({ cookie: portalCookie('HH-2026-MINE'), body: { purpose: 'refund' } }),
      { params: params('HH-2026-MINE') },
    )
    expect(res.status).toBe(400)
    expect(mintSpy).not.toHaveBeenCalled()
  })

  it('does NOT charge when the payment history cannot be read', async () => {
    // Without it the amount owed is unknown, and an unknown amount must never
    // become a charge.
    paymentsResult.error = { message: 'connection reset' }
    const { POST } = await import('@/app/api/plan/[ref]/pay-link/route')
    const res = await POST(req({ cookie: portalCookie('HH-2026-MINE') }), { params: params('HH-2026-MINE') })
    expect(res.status).toBe(503)
    expect(mintSpy).not.toHaveBeenCalled()
  })

  it('says "try again", not "no such plan", when the plan cannot be READ', async () => {
    loadSpy.mockResolvedValue({ ok: false, notFound: false, error: 'connection reset' })
    const { POST } = await import('@/app/api/plan/[ref]/pay-link/route')
    const res = await POST(req({ cookie: portalCookie('HH-2026-MINE') }), { params: params('HH-2026-MINE') })
    expect(res.status).toBe(503)
  })

  it('404s a plan that really is absent', async () => {
    loadSpy.mockResolvedValue({ ok: false, notFound: true, error: 'not found' })
    const { POST } = await import('@/app/api/plan/[ref]/pay-link/route')
    const res = await POST(req({ cookie: portalCookie('HH-2026-MINE') }), { params: params('HH-2026-MINE') })
    expect(res.status).toBe(404)
  })

  it('refuses when Stripe is not configured, rather than throwing', async () => {
    delete process.env.STRIPE_SECRET_KEY
    const { POST } = await import('@/app/api/plan/[ref]/pay-link/route')
    const res = await POST(req({ cookie: portalCookie('HH-2026-MINE') }), { params: params('HH-2026-MINE') })
    expect(res.status).toBe(503)
  })
})
