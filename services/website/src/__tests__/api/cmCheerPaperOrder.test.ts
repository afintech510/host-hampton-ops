/**
 * POST /api/cm-cheer-orders — the organizer's paper-order entry.
 * The claims: it is authenticated, it prices on the SERVER, it refuses what it
 * cannot price, it files under the right team, and a paper order is not emailed.
 */
const inserted: any[] = []
const mockInsertResult = { data: { id: 'x', order_ref: 'ESM-0011' }, error: null as any }

jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => ({
      insert: (row: any) => { inserted.push(row); return { select: () => ({ single: async () => mockInsertResult }) } },
    }),
  }),
}))
const mockAuth = jest.fn()
jest.mock('@/lib/cmCheerAuth', () => ({
  isCmCheerAuthorized: (...a: any[]) => mockAuth(...a),
  cmCheerUnauthorized: () => ({ status: 401, body: { error: 'Unauthorized' }, json: async () => ({ error: 'Unauthorized' }) }),
  CM_CHEER_ORDER_COLUMNS: '*',
}))
const mockUpsert = jest.fn().mockResolvedValue({})
jest.mock('@/lib/contacts', () => ({ upsertContact: (...a: any[]) => mockUpsert(...a) }))
const mockResend = jest.fn()
jest.mock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockResend } })) }))
jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body, json: async () => body }) },
}))

import { POST } from '@/app/api/cm-cheer-orders/route'

const valid = {
  team: 'esm-sharks', athleteName: 'Ava Test', teacherName: 'Mr. Wood', parentName: 'Pat Test',
  email: '', phone: '', paymentMethod: 'cash', markPaid: true,
  deliveryMethod: 'classroom', deliveryAddress: '',
  quantities: { 'tote-navy-circle': 1, 'hat-navy-script': 1 },
}
const req = (body: any) => ({ json: async () => body, headers: new Headers() }) as any

beforeEach(() => { inserted.length = 0; mockAuth.mockReturnValue(true); jest.clearAllMocks() })

describe('POST /api/cm-cheer-orders (paper)', () => {
  it('is closed to an unauthenticated caller and writes nothing', async () => {
    mockAuth.mockReturnValue(false)
    const res: any = await POST(req(valid))
    expect(res.status).toBe(401)
    expect(inserted).toHaveLength(0)
  })

  it('prices from quantities, files under esm-sharks, records paid, sends no email', async () => {
    const res: any = await POST(req(valid))
    expect(res.status).toBe(200)
    expect(res.body.order_ref).toBe('ESM-0011')
    const row = inserted[0]
    expect(row.team).toBe('esm-sharks')
    expect(row.subtotal_cents).toBe(6500)
    expect(row.cost_cents).toBe(4875)
    expect(row.profit_cents).toBe(1625)
    expect(row.status).toBe('paid')
    expect(row.email).toBe('')
    expect(row.status_note).toContain('paper order form')
    expect(mockResend).not.toHaveBeenCalled()
    expect(mockUpsert).not.toHaveBeenCalled() // no email, no contact row
  })

  it('ignores any price the client sends', async () => {
    await POST(req({ ...valid, total: 1, itemsData: [{ name: 'x', qty: 1, unit_price: 0.01, line_total: 0.01 }], subtotal_cents: 1 }))
    expect(inserted[0].subtotal_cents).toBe(6500)
  })

  it('adds the server-set $5 delivery and requires an address', async () => {
    const noAddr: any = await POST(req({ ...valid, deliveryMethod: 'home' }))
    expect(noAddr.status).toBe(400)
    expect(inserted).toHaveLength(0)
    const ok: any = await POST(req({ ...valid, deliveryMethod: 'home', deliveryAddress: '1 Main St, Eastport' }))
    expect(ok.status).toBe(200)
    expect(inserted[0].subtotal_cents).toBe(6500 + 500)
    expect(inserted[0].delivery_fee_cents).toBe(500)
    expect(inserted[0].profit_cents).toBe(1625 + 500)
  })

  it('records pending when payment is not in hand, and upserts a contact only with an email', async () => {
    await POST(req({ ...valid, markPaid: false, email: 'pat@example.com' }))
    expect(inserted[0].status).toBe('pending_payment')
    expect(mockUpsert).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['no team', { ...valid, team: undefined }],
    ['unknown team', { ...valid, team: 'nope' }],
    ['cm-cheer (no catalogue)', { ...valid, team: 'cm-cheer' }],
    ['missing teacher', { ...valid, teacherName: '' }],
    ['missing child', { ...valid, athleteName: ' ' }],
    ['bad email', { ...valid, email: 'not-an-email' }],
    ['bad payment', { ...valid, paymentMethod: 'check' }],
    ['unknown item', { ...valid, quantities: { 'sock-navy-circle': 1 } }],
    ['negative qty', { ...valid, quantities: { 'hat-navy-circle': -2 } }],
    ['no items', { ...valid, quantities: {} }],
  ])('refuses %s and writes nothing', async (_n, body) => {
    const res: any = await POST(req(body))
    expect(res.status).toBe(400)
    expect(inserted).toHaveLength(0)
  })

  it('reports a failed insert instead of success', async () => {
    mockInsertResult.error = { message: 'boom' }; mockInsertResult.data = null as any
    const res: any = await POST(req(valid))
    expect(res.status).toBe(500)
    mockInsertResult.error = null; mockInsertResult.data = { id: 'x', order_ref: 'ESM-0011' }
  })
})
