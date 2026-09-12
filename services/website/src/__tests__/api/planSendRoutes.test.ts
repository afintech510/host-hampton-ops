/**
 * Sending a plan to a customer (Phase 5 item 4).
 *
 * The rule is "nothing auto-sends to a customer, ever", so the tests are about
 * what it takes to make a send happen at all:
 *
 *   * the admin route needs an admin credential AND an explicit `confirm`;
 *   * the customer route needs a portal cookie for THAT plan;
 *   * neither will send to an address supplied in the request — only to the one
 *     stored on the booking, which is what stops "email me my invoice" becoming a
 *     way to have someone else's invoice delivered elsewhere.
 */

import { createMockNextRequest } from '../mocks/nextRequest'
import { buildPortalCookieValue } from '@/lib/portalAuth'
import { buildAdminCookieValue } from '@/lib/adminAuth'
import { makePlanDb, writesTo, type PlanDb } from '../mocks/planDb'

const PORTAL_SECRET = 'test-portal-secret'
const ADMIN_SECRET = 'test-admin-secret'

const sendEmailSpy = jest.fn()
const smsSpy = jest.fn()

jest.mock('@/lib/planShare', () => {
  const actual = jest.requireActual('@/lib/planShare')
  return {
    ...actual,
    // requireActual keeps the real link builder and templates; only the actual
    // transmission is stubbed, so "did it try to send, and to whom" is a real
    // observation rather than a mock of the thing under test (rule 7).
    sendPlanSummaryEmail: (...args: unknown[]) => sendEmailSpy(...args),
    buildPlanSummaryLink: async () => ({ ok: true, url: 'https://www.hosthampton.com/api/portal/auth?x=1' }),
  }
})

jest.mock('@/lib/sms', () => ({ sendSMSVia: (...args: unknown[]) => smsSpy(...args) }))

const loadSpy = jest.fn()
jest.mock('@/lib/planInvoice', () => {
  const actual = jest.requireActual('@/lib/planInvoice')
  return { ...actual, loadPlanInvoice: (...args: unknown[]) => loadSpy(...args) }
})

let db: PlanDb
jest.mock('@/lib/supabase', () => ({ getSupabase: () => db }))

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

const INVOICE = (over: Record<string, unknown> = {}) => ({
  booking: {
    id: 'bk-1',
    booking_ref: 'HH-2026-MINE',
    status: 'quoted',
    contact_name: 'Test Person',
    contact_email: 'adam@easternbuilding.supply',
    contact_phone: '+16314008080',
    ...(over.booking as Record<string, unknown> | undefined),
  },
  docTitle: 'Party Quotation',
  invoiceNumber: '444124-000116',
  totalCents: 100000,
  depositCents: 25000,
  balanceDueCents: 75000,
  depositIsSeparate: false,
  eventDateTime: 'Saturday, October 3, 2026 · 11:00',
  ...over,
})

function req(opts: { cookie?: string; bearer?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { host: 'www.hosthampton.com' }
  if (opts.cookie) headers.cookie = opts.cookie
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`
  return createMockNextRequest({ method: 'POST', headers, body: opts.body ?? {} }) as never
}

const params = (ref = 'HH-2026-MINE') => Promise.resolve({ ref })
const portalCookie = (ref: string) => `hh_portal=${buildPortalCookieValue(ref, PORTAL_SECRET)}`
const adminCookie = () => `hh_admin=${buildAdminCookieValue('hosthampton295@gmail.com', ADMIN_SECRET)}`

/** The cooldown claim row this request believes it inserted. */
const MY_CLAIM = { id: 'claim-mine', created_at: '2026-09-11T12:00:00.000Z' }

const originalEnv = process.env

beforeEach(() => {
  jest.clearAllMocks()
  process.env = {
    ...originalEnv,
    PORTAL_LINK_SIGNING_SECRET: PORTAL_SECRET,
    ADMIN_SESSION_SECRET: ADMIN_SECRET,
    ADMIN_PASSWORD: 'shared-pw',
    RESEND_API_KEY: 're_test',
  }
  // The email-me cooldown is now CLAIMED, not merely checked: insert a claim
  // row, read the claims back, win only if ours is the oldest. So the ledger
  // queue is (1) our claim insert, (2) the claims read, (3) the real send row.
  db = makePlanDb({ marketing_ledger: [{ data: MY_CLAIM, error: null }, { data: [MY_CLAIM], error: null }, { data: null, error: null }] })
  loadSpy.mockResolvedValue({ ok: true, invoice: INVOICE() })
  sendEmailSpy.mockResolvedValue({ ok: true })
  smsSpy.mockResolvedValue('msg_1')
})

afterAll(() => {
  process.env = originalEnv
})

describe('POST /api/admin/plan/[ref]/send — "Send to client"', () => {
  it('refuses without an admin credential', async () => {
    const { POST } = await import('@/app/api/admin/plan/[ref]/send/route')
    const res = await POST(req({ body: { channel: 'email', confirm: true } }), { params: params() })
    expect(res.status).toBe(401)
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('refuses a CUSTOMER portal cookie — this is an admin action', async () => {
    const { POST } = await import('@/app/api/admin/plan/[ref]/send/route')
    const res = await POST(
      req({ cookie: portalCookie('HH-2026-MINE'), body: { channel: 'email', confirm: true } }),
      { params: params() },
    )
    expect(res.status).toBe(401)
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('sends NOTHING without an explicit confirm', async () => {
    const { POST } = await import('@/app/api/admin/plan/[ref]/send/route')
    const res = await POST(req({ cookie: adminCookie(), body: { channel: 'email' } }), { params: params() })
    expect(res.status).toBe(400)
    expect(sendEmailSpy).not.toHaveBeenCalled()
    expect(smsSpy).not.toHaveBeenCalled()
  })

  it('sends on a confirmed admin request, to the address ON THE PLAN', async () => {
    const { POST } = await import('@/app/api/admin/plan/[ref]/send/route')
    const res = await POST(
      // A `to` in the body must be ignored: honouring it would make this a way to
      // have a customer's quote delivered to an inbox of the caller's choosing.
      req({ cookie: adminCookie(), body: { channel: 'email', confirm: true, to: 'attacker@example.com' } }),
      { params: params() },
    )
    expect(res.status).toBe(200)
    expect(sendEmailSpy).toHaveBeenCalledTimes(1)
    expect(sendEmailSpy.mock.calls[0][0].to).toBe('adam@easternbuilding.supply')
  })

  it('names the admin who did it in the ledger', async () => {
    const { POST } = await import('@/app/api/admin/plan/[ref]/send/route')
    await POST(req({ cookie: adminCookie(), body: { channel: 'email', confirm: true } }), { params: params() })
    const row = writesTo(db, 'marketing_ledger', 'insert')[0].payload as Record<string, unknown>
    expect(row.actor).toBe('admin:hosthampton295@gmail.com')
    expect(row.action).toBe('send')
  })

  it('records the historical anonymous actor on the shared password', async () => {
    const { POST } = await import('@/app/api/admin/plan/[ref]/send/route')
    await POST(req({ bearer: 'shared-pw', body: { channel: 'email', confirm: true } }), { params: params() })
    const row = writesTo(db, 'marketing_ledger', 'insert')[0].payload as Record<string, unknown>
    expect(row.actor).toBe('ADMIN')
  })

  it('REFUSES a cancelled plan, and records the refusal', async () => {
    // Sending a cancelled plan tells a customer their cancelled party is on.
    loadSpy.mockResolvedValue({ ok: true, invoice: INVOICE({ booking: { id: 'bk-1', booking_ref: 'HH-2026-MINE', status: 'cancelled', contact_name: 'X', contact_email: 'x@example.com', contact_phone: null } }) })
    const { POST } = await import('@/app/api/admin/plan/[ref]/send/route')
    const res = await POST(req({ cookie: adminCookie(), body: { channel: 'email', confirm: true } }), { params: params() })
    expect(res.status).toBe(409)
    expect(sendEmailSpy).not.toHaveBeenCalled()
    const note = writesTo(db, 'marketing_ledger', 'insert')[0].payload as Record<string, unknown>
    expect((note.meta as Record<string, unknown>).job).toBe('plan_send_refused')
  })

  it('refuses a text when the plan has no phone number', async () => {
    loadSpy.mockResolvedValue({ ok: true, invoice: INVOICE({ booking: { id: 'bk-1', booking_ref: 'HH-2026-MINE', status: 'quoted', contact_name: 'X', contact_email: 'x@example.com', contact_phone: null } }) })
    const { POST } = await import('@/app/api/admin/plan/[ref]/send/route')
    const res = await POST(req({ cookie: adminCookie(), body: { channel: 'sms', confirm: true } }), { params: params() })
    expect(res.status).toBe(409)
    expect(smsSpy).not.toHaveBeenCalled()
  })

  it('reports a PARTIAL send rather than rounding it to success', async () => {
    // An admin who thinks the client has the quote when only the text landed will
    // not follow up.
    sendEmailSpy.mockResolvedValue({ ok: false, reason: 'Email failed: bounced' })
    const { POST } = await import('@/app/api/admin/plan/[ref]/send/route')
    const res = await POST(req({ cookie: adminCookie(), body: { channel: 'both', confirm: true } }), { params: params() })
    expect(res.status).toBe(200)
    const body = res.json() as unknown as { results: string[]; failures: string[] }
    expect(body.results).toHaveLength(1)
    expect(body.failures[0]).toMatch(/bounced/)
  })

  it('is a failure, not a success, when nothing went out at all', async () => {
    sendEmailSpy.mockResolvedValue({ ok: false, reason: 'Email failed: bounced' })
    const { POST } = await import('@/app/api/admin/plan/[ref]/send/route')
    const res = await POST(req({ cookie: adminCookie(), body: { channel: 'email', confirm: true } }), { params: params() })
    expect(res.status).toBe(502)
  })
})

describe('POST /api/plan/[ref]/email-me — customer self-serve', () => {
  it('refuses a portal cookie for a DIFFERENT plan', async () => {
    const { POST } = await import('@/app/api/plan/[ref]/email-me/route')
    const res = await POST(req({ cookie: portalCookie('HH-2026-THEIRS') }), { params: params('HH-2026-MINE') })
    expect(res.status).toBe(403)
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('sends only to the address on the plan, ignoring one in the body', async () => {
    const { POST } = await import('@/app/api/plan/[ref]/email-me/route')
    const res = await POST(
      req({ cookie: portalCookie('HH-2026-MINE'), body: { to: 'attacker@example.com' } }),
      { params: params('HH-2026-MINE') },
    )
    expect(res.status).toBe(200)
    expect(sendEmailSpy.mock.calls[0][0].to).toBe('adam@easternbuilding.supply')
    expect(res.json()).toMatchObject({ sentTo: 'adam@easternbuilding.supply' })
  })

  it('rate-limits a double click', async () => {
    // An OLDER claim than ours exists in the window, so we lost the slot.
    db = makePlanDb({
      marketing_ledger: [
        { data: MY_CLAIM, error: null },
        { data: [{ id: 'claim-theirs', created_at: '2026-09-11T00:00:00.000Z' }], error: null },
      ],
    })
    const { POST } = await import('@/app/api/plan/[ref]/email-me/route')
    const res = await POST(req({ cookie: portalCookie('HH-2026-MINE') }), { params: params('HH-2026-MINE') })
    expect(res.status).toBe(429)
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('only ONE of several simultaneous callers gets the slot', async () => {
    // The bug this replaced: the check and the write straddled the send, so the
    // limit was check-then-act. Measured in production before the fix — five
    // concurrent calls, THREE emails. Every racer inserts its own claim, then
    // every racer sees every claim, and the oldest id is the only winner.
    const winner = { id: 'claim-aaa', created_at: '2026-09-11T12:00:00.000Z' }
    const loser = { id: 'claim-bbb', created_at: '2026-09-11T12:00:00.000Z' }
    const all = [winner, loser]
    const { POST } = await import('@/app/api/plan/[ref]/email-me/route')

    db = makePlanDb({ marketing_ledger: [{ data: winner, error: null }, { data: all, error: null }, { data: null, error: null }] })
    const first = await POST(req({ cookie: portalCookie('HH-2026-MINE') }), { params: params('HH-2026-MINE') })

    db = makePlanDb({ marketing_ledger: [{ data: loser, error: null }, { data: all, error: null }] })
    const second = await POST(req({ cookie: portalCookie('HH-2026-MINE') }), { params: params('HH-2026-MINE') })

    expect([first.status, second.status]).toEqual([200, 429])
    expect(sendEmailSpy).toHaveBeenCalledTimes(1)
  })

  it('a failed cooldown claim DECLINES rather than sending', async () => {
    // "Cannot tell" must not be the way round the limit.
    db = makePlanDb({ marketing_ledger: [{ data: null, error: { message: 'connection reset' } }] })
    const { POST } = await import('@/app/api/plan/[ref]/email-me/route')
    const res = await POST(req({ cookie: portalCookie('HH-2026-MINE') }), { params: params('HH-2026-MINE') })
    expect(res.status).toBe(503)
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('a failed cooldown READ declines too, and does not send', async () => {
    db = makePlanDb({
      marketing_ledger: [{ data: MY_CLAIM, error: null }, { data: null, error: { message: 'connection reset' } }],
    })
    const { POST } = await import('@/app/api/plan/[ref]/email-me/route')
    const res = await POST(req({ cookie: portalCookie('HH-2026-MINE') }), { params: params('HH-2026-MINE') })
    expect(res.status).toBe(503)
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('a send that FAILS after claiming the slot records the failure, not a send', async () => {
    // Rule 10: a claimed cooldown that produced no email must say so, or the
    // ledger asserts a send that never happened.
    sendEmailSpy.mockResolvedValue({ ok: false, reason: 'Email failed: bounced' })
    const { POST } = await import('@/app/api/plan/[ref]/email-me/route')
    const res = await POST(req({ cookie: portalCookie('HH-2026-MINE') }), { params: params('HH-2026-MINE') })
    expect(res.status).toBe(502)
    const rows = writesTo(db, 'marketing_ledger', 'insert').map(
      w => ((w.payload as Record<string, unknown>).meta as Record<string, unknown>).job,
    )
    expect(rows).toContain('plan_summary_email_claim')
    expect(rows).toContain('plan_summary_email_failed')
    expect(rows).not.toContain('plan_summary_email')
  })

  it('says so plainly when the plan has no email address yet', async () => {
    loadSpy.mockResolvedValue({ ok: true, invoice: INVOICE({ booking: { id: 'bk-1', booking_ref: 'HH-2026-MINE', status: 'lead', contact_name: 'X', contact_email: null, contact_phone: '+16314008080' } }) })
    const { POST } = await import('@/app/api/plan/[ref]/email-me/route')
    const res = await POST(req({ cookie: portalCookie('HH-2026-MINE') }), { params: params('HH-2026-MINE') })
    expect(res.status).toBe(409)
  })

  it('says "try again", not "no such plan", when the plan cannot be READ', async () => {
    loadSpy.mockResolvedValue({ ok: false, notFound: false, error: 'connection reset' })
    const { POST } = await import('@/app/api/plan/[ref]/email-me/route')
    const res = await POST(req({ cookie: portalCookie('HH-2026-MINE') }), { params: params('HH-2026-MINE') })
    expect(res.status).toBe(503)
  })
})
