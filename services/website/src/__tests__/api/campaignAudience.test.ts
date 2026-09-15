/**
 * The audience belongs to the CAMPAIGN, not to the click.
 *
 * `CampaignsTab.tsx` held `const [sendListId, setSendListId] = useState(3)` and
 * never once called the setter. Every Send Now posted `listId: 3` — the full
 * marketing list — whatever the campaign was, and the route's only other input
 * was `BREVO_DEFAULT_LIST_ID`, which says the same thing. There was no way to
 * aim a campaign at a subset.
 *
 * That became load-bearing on 2026-09-15: Brevo's free plan caps sending at
 * 300/day and list 3 holds 970 sendable contacts, so the fall campaign goes out
 * as four batch lists (4, 5, 6, 7 — 243/243/243/241). Without migration 052's
 * `brevo_list_id` winning over the posted value, each of the four drafts would
 * have gone to all 970.
 */

/**
 * The route uses the chain two different ways and the shapes are NOT the same:
 * the claim is `.update(...).select('*')` and reads `claimed[0]`, an ARRAY,
 * while the before/after status reads end in `.maybeSingle()`, an OBJECT. A
 * harness that answers an object to both makes every claim fail and every test
 * 409 — which looks like a broken route rather than a broken mock.
 */
function buildChain(row: Record<string, unknown> | null) {
  const chain: any = {}
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'order', 'limit', 'range']) {
    chain[m] = jest.fn().mockReturnValue(chain)
  }
  const settle = (value: any) => {
    const p = Promise.resolve(value)
    return { then: p.then.bind(p), catch: p.catch.bind(p) }
  }
  chain.maybeSingle = jest.fn(() => settle({ data: row ? { ...row } : null, error: null }))
  chain.single = chain.maybeSingle
  const listP = Promise.resolve({ data: row ? [{ ...row }] : [], error: null })
  chain.then = listP.then.bind(listP)
  chain.catch = listP.catch.bind(listP)
  return chain
}

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: (...a: any[]) => mockGetSupabase(...a) }))

jest.mock('@/lib/adminAuth', () => ({
  isAdminAuthorized: () => true,
  unauthorizedResponse: () => ({ status: 401, json: () => ({ error: 'Unauthorized' }), body: { error: 'Unauthorized' } }),
}))

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }) },
}))

const mockSendCampaign = jest.fn()
jest.mock('@/lib/brevo', () => ({
  sendCampaign: (...a: any[]) => mockSendCampaign(...a),
  sendTransactionalEmail: jest.fn(),
  cancelCampaign: jest.fn(),
}))
jest.mock('@/lib/twilio', () => ({ sendBulkSMS: jest.fn() }))
jest.mock('@/lib/sequences/processor', () => ({ optedOutReason: jest.fn() }))

import { PATCH } from '@/app/api/admin/campaigns/[id]/route'

function makeReq(body: any) {
  return { headers: { get: () => null }, json: async () => body } as any
}

/** The campaign row the route reads before claiming it. */
function withCampaign(row: Record<string, unknown>) {
  mockGetSupabase.mockReturnValue({ from: jest.fn(() => buildChain(row)) })
}

/** The list id actually handed to Brevo. */
const listSentToBrevo = () => mockSendCampaign.mock.calls[0]?.[0]

const BASE = {
  id: 'camp-1',
  campaign_type: 'email',
  subject: 'Fall campaign',
  body_html: '<p>hi</p>',
  status: 'draft',
  scheduled_for: null,
  brevo_list_id: null as number | null,
}

describe('which Brevo list a campaign actually reaches', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.BREVO_DEFAULT_LIST_ID = '3'
    mockSendCampaign.mockResolvedValue({ kind: 'sent', id: 99 })
  })

  it("uses the campaign's own list, NOT the one the button posted", async () => {
    withCampaign({ ...BASE, brevo_list_id: 5 })

    // The button still posts 3 — that is the bug being defended against, and
    // the UI shipped that way for months.
    await PATCH(makeReq({ status: 'sending', listId: 3 }), { params: Promise.resolve({ id: 'camp-1' }) } as any)

    expect(listSentToBrevo()).toBe(5)
    expect(listSentToBrevo()).not.toBe(3)
  })

  it.each([4, 5, 6, 7])('batch list %i reaches exactly itself', async (listId) => {
    withCampaign({ ...BASE, brevo_list_id: listId })
    await PATCH(makeReq({ status: 'sending', listId: 3 }), { params: Promise.resolve({ id: 'camp-1' }) } as any)
    expect(listSentToBrevo()).toBe(listId)
  })

  it('falls back to the posted list when the campaign names none', async () => {
    withCampaign({ ...BASE, brevo_list_id: null })
    await PATCH(makeReq({ status: 'sending', listId: 6 }), { params: Promise.resolve({ id: 'camp-1' }) } as any)
    expect(listSentToBrevo()).toBe(6)
  })

  it('falls back to BREVO_DEFAULT_LIST_ID when neither names one', async () => {
    withCampaign({ ...BASE, brevo_list_id: null })
    await PATCH(makeReq({ status: 'sending' }), { params: Promise.resolve({ id: 'camp-1' }) } as any)
    expect(listSentToBrevo()).toBe(3)
  })

  it('refuses to send rather than widening when nothing names a list', async () => {
    delete process.env.BREVO_DEFAULT_LIST_ID
    withCampaign({ ...BASE, brevo_list_id: null })

    const res: any = await PATCH(makeReq({ status: 'sending' }), { params: Promise.resolve({ id: 'camp-1' }) } as any)

    // "No list configured" must never resolve to "everyone".
    expect(res.status).toBe(500)
    expect(mockSendCampaign).not.toHaveBeenCalled()
  })

  it('a zero from a bad parse is refused, not treated as unconfigured-then-default', async () => {
    withCampaign({ ...BASE, brevo_list_id: null })
    const res: any = await PATCH(makeReq({ status: 'sending', listId: 'not-a-number' }), { params: Promise.resolve({ id: 'camp-1' }) } as any)
    expect(res.status).toBe(500)
    expect(mockSendCampaign).not.toHaveBeenCalled()
  })
})
