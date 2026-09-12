/**
 * `/api/cron/agent-distill` — the weekly learning run's front door.
 *
 * Small surface, three things worth pinning:
 *
 *   1. an unset `CRON_SECRET` must not make the route world-callable (the
 *      `!!process.env.CRON_SECRET` half of the check, which `agent-dispatch`
 *      has and the older cron routes do not);
 *   2. `AGENT_ENABLED` stops it, like every other agent surface — a kill switch
 *      that stops the parts somebody remembered is not a kill switch;
 *   3. the distiller's status is PASSED THROUGH, so a failed read of the view
 *      shows up as a red run on cron-job.org rather than as a green one
 *      reporting zero proposals every Monday while the loop is dead.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }),
  },
}))

jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({}) }))

const mockDistill = jest.fn()
jest.mock('@/lib/agent/distill', () => ({ distillFeedback: (...a: unknown[]) => mockDistill(...(a as [])) }))

import { GET } from '@/app/api/cron/agent-distill/route'

function req(params: Record<string, string> = {}, headers: Record<string, string> = {}) {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    nextUrl: { searchParams: { get: (k: string) => params[k] ?? null } },
  } as any
}

const OK = { ok: true, status: 200, considered: 3, edited: 2, proposed: 1, duplicates: 0, refused: [] }

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 'sekrit'
  process.env.AGENT_ENABLED = '1'
  mockDistill.mockResolvedValue(OK)
})

describe('auth', () => {
  it('accepts the secret by header or query string', async () => {
    expect((await GET(req({}, { 'x-cron-secret': 'sekrit' }))).status).toBe(200)
    expect((await GET(req({ secret: 'sekrit' }))).status).toBe(200)
  })

  it('refuses a wrong secret and a missing one', async () => {
    expect((await GET(req({ secret: 'nope' }))).status).toBe(401)
    expect((await GET(req())).status).toBe(401)
    expect(mockDistill).not.toHaveBeenCalled()
  })

  it('is NOT open to the world when CRON_SECRET is unset', async () => {
    // Without the `!!process.env.CRON_SECRET` half, `undefined === undefined`
    // lets a caller who sends no header at all straight through.
    delete process.env.CRON_SECRET
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req({ secret: '' }))).status).toBe(401)
    expect(mockDistill).not.toHaveBeenCalled()
  })
})

describe('the kill switch', () => {
  it('does nothing at all with AGENT_ENABLED off', async () => {
    process.env.AGENT_ENABLED = '0'
    const res = await GET(req({ secret: 'sekrit' }))
    expect(res.status).toBe(200)
    expect(res.body.skipped).toMatch(/AGENT_ENABLED/)
    expect(mockDistill).not.toHaveBeenCalled()
  })
})

describe('the window', () => {
  it('defaults to seven days', async () => {
    await GET(req({ secret: 'sekrit' }))
    expect(mockDistill).toHaveBeenCalledWith(expect.objectContaining({ sinceDays: 7 }))
  })

  it('honours ?days= for a catch-up, and clamps a silly one', async () => {
    await GET(req({ secret: 'sekrit', days: '30' }))
    expect(mockDistill).toHaveBeenCalledWith(expect.objectContaining({ sinceDays: 30 }))

    await GET(req({ secret: 'sekrit', days: '99999' }))
    expect(mockDistill).toHaveBeenLastCalledWith(expect.objectContaining({ sinceDays: 120 }))

    await GET(req({ secret: 'sekrit', days: 'banana' }))
    expect(mockDistill).toHaveBeenLastCalledWith(expect.objectContaining({ sinceDays: 7 }))
  })
})

describe('failure is visible', () => {
  it('passes a 503 through rather than reporting a clean run', async () => {
    mockDistill.mockResolvedValue({ ...OK, ok: false, status: 503, error: 'Could not read draft_feedback' })
    const res = await GET(req({ secret: 'sekrit' }))
    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/draft_feedback/)
  })
})
