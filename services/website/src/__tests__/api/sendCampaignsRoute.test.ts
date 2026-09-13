/**
 * GET /api/cron/send-campaigns — the route's own contract.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS. It was written to close a hole the attack harness found
 * in `outboundSendSurface.test.ts`: mutation 26 disabled the `created_not_sent`
 * branch — the one that stops a campaign Brevo CREATED but never DELIVERED from
 * being recorded as `sent` — and the whole suite stayed green. The surface rule
 * asserted only that the STRING `created_not_sent` appears in the file, which is
 * still true of `if (false && result.kind === 'created_not_sent')`.
 *
 * A grep cannot see reachability. The fix for a rule that cannot tell whether a
 * branch runs is not a cleverer grep, it is a test that runs it.
 *
 * This route is the highest blast radius on the surface: every claimed row is
 * one Brevo campaign to list 3, which is 944 real people. It had no behavioural
 * test at all.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }),
  },
}))

const mockSendCampaign = jest.fn()
jest.mock('@/lib/brevo', () => ({ sendCampaign: (...a: any[]) => mockSendCampaign(...a) }))

let rows: any[]
const updates: { id: string; patch: Record<string, unknown> }[] = []

/**
 * A Supabase stand-in narrow enough to be honest: it records every UPDATE with
 * the id it was keyed on, so an assertion can say "this row ended up `sent`"
 * rather than "an update happened".
 */
function makeSupabase() {
  const table = (name: string) => {
    const state: any = { name, filters: {} as Record<string, unknown>, patch: null as any, isUpdate: false }
    const api: any = {
      select: () => api,
      update: (patch: any) => { state.isUpdate = true; state.patch = patch; return api },
      eq: (col: string, val: unknown) => { state.filters[col] = val; return api },
      lte: () => api,
      in: (_col: string, vals: string[]) => { state.filters.in = vals; return api },
      order: () => api,
      limit: () => finish(),
      then: (resolve: any) => resolve(finish()),
    }
    function finish() {
      if (state.isUpdate) {
        if (state.filters.id) {
          updates.push({ id: String(state.filters.id), patch: state.patch })
          return { data: null, error: null }
        }
        // The claim: conditional UPDATE returning the rows it took.
        const ids: string[] = (state.filters.in as string[]) ?? []
        const claimed = rows.filter(r => ids.includes(r.id) && r.status === state.filters.status)
        claimed.forEach(r => { r.status = 'sending' })
        return { data: claimed.map(r => ({ ...r })), error: null }
      }
      const due = rows.filter(r => r.status === 'scheduled')
      return { data: due.map(r => ({ id: r.id })), error: null }
    }
    return api
  }
  return { from: (n: string) => table(n) }
}

jest.mock('@/lib/supabase', () => ({ getSupabase: () => makeSupabase() }))

import { GET } from '@/app/api/cron/send-campaigns/route'

const CRON_SECRET = 'test-cron-secret'

function makeReq(params: Record<string, string> = {}) {
  const headers = new Map<string, string>([['x-cron-secret', CRON_SECRET]])
  return {
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    nextUrl: { searchParams: { get: (k: string) => params[k] ?? null } },
  } as any
}

const OLD = process.env
beforeEach(() => {
  process.env = { ...OLD, CRON_SECRET, BREVO_DEFAULT_LIST_ID: '3' }
  rows = []
  updates.length = 0
  mockSendCampaign.mockReset()
})
afterAll(() => { process.env = OLD })

function campaign(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'c1', campaign_type: 'event_update', status: 'scheduled',
    subject: 'Bingo night', body_html: '<p>hi</p>', scheduled_for: '2020-01-01T00:00:00Z',
    ...over,
  }
}

const patchFor = (id: string) => Object.assign({}, ...updates.filter(u => u.id === id).map(u => u.patch))

describe('a campaign Brevo created but did not deliver', () => {
  it('is recorded FAILED, never sent — and names the Brevo id so a human can find it', async () => {
    rows = [campaign()]
    mockSendCampaign.mockResolvedValue({ kind: 'created_not_sent', id: 77, error: 'sendNow 500' })

    const res: any = await GET(makeReq())
    const body = res.json()

    expect(body.sent).toBe(0)
    expect(body.failed).toBe(1)
    expect(patchFor('c1').status).toBe('failed')
    expect(patchFor('c1').brevo_campaign_id).toBe('77')
    expect(body.notes.join(' ')).toContain('CREATED but not sent')
  })

  it('and a genuinely delivered campaign IS recorded sent — the guard is not blanket', async () => {
    rows = [campaign()]
    mockSendCampaign.mockResolvedValue({ kind: 'sent', id: 88 })

    const res: any = await GET(makeReq())
    expect(res.json().sent).toBe(1)
    expect(patchFor('c1').status).toBe('sent')
    expect(patchFor('c1').sent_at).toBeTruthy()
  })
})

describe('campaign_type is classified, not assumed', () => {
  it('an SMS row is NOT emailed to the list', async () => {
    rows = [campaign({ campaign_type: 'sms', body_html: '<p>would have gone to 944 people</p>' })]

    const res: any = await GET(makeReq())

    expect(mockSendCampaign).not.toHaveBeenCalled()
    expect(res.json().sent).toBe(0)
    // Returned to draft rather than burned as `failed`: it is a real campaign
    // for a different sender, not a broken one.
    expect(patchFor('c1').status).toBe('draft')
    expect(res.json().notes.join(' ')).toContain('not an email campaign')
  })

  it('refuses an unrecognised type rather than defaulting to email', async () => {
    rows = [campaign({ campaign_type: 'carrier_pigeon' })]
    const res: any = await GET(makeReq())
    expect(mockSendCampaign).not.toHaveBeenCalled()
    expect(res.json().sent).toBe(0)
  })

  it.each(['email', 'event_update', 'marketing'])('sends a %s campaign', async type => {
    rows = [campaign({ campaign_type: type })]
    mockSendCampaign.mockResolvedValue({ kind: 'sent', id: 1 })
    const res: any = await GET(makeReq())
    // All three are permitted by scheduled_campaigns_campaign_type_check and
    // all three are email. An allowlist written from the DATA would have refused
    // 'marketing' and 'email', neither of which any row carries today.
    expect(res.json().sent).toBe(1)
  })
})

describe('the blast-radius caps', () => {
  it('refuses a limit above MAX_PER_TICK rather than silently clamping it', async () => {
    const res: any = await GET(makeReq({ limit: '99' }))
    expect(res.status).toBe(400)
    expect(mockSendCampaign).not.toHaveBeenCalled()
  })

  it('refuses a non-integer limit', async () => {
    const res: any = await GET(makeReq({ limit: 'all' }))
    expect(res.status).toBe(400)
  })

  it('an unconfigured list defers rather than failing the campaign', async () => {
    process.env.BREVO_DEFAULT_LIST_ID = ''
    rows = [campaign()]
    const res: any = await GET(makeReq())
    expect(mockSendCampaign).not.toHaveBeenCalled()
    expect(res.json().deferred).toBe(1)
    // Back to `scheduled`: a missing env var is not the campaign's fault.
    expect(patchFor('c1').status).toBe('scheduled')
  })

  it('a campaign with no body is refused, not sent empty', async () => {
    rows = [campaign({ body_html: null })]
    const res: any = await GET(makeReq())
    expect(mockSendCampaign).not.toHaveBeenCalled()
    expect(patchFor('c1').status).toBe('failed')
  })
})

describe('authorisation', () => {
  it('401s without the cron secret, before reading anything', async () => {
    const req = {
      headers: { get: () => null },
      nextUrl: { searchParams: { get: () => null } },
    } as any
    const res: any = await GET(req)
    expect(res.status).toBe(401)
    expect(mockSendCampaign).not.toHaveBeenCalled()
  })
})
