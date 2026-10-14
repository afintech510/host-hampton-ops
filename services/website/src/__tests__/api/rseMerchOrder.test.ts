/**
 * POST /api/cm-cheer-order for the RSE merch page (`team: 'rse'`).
 * The claims: an RSE order files under `rse`, and while RSE has no verified
 * Venmo account a `venmo` order is refused before anything is written.
 */
const inserted: any[] = []
const mockInsertResult = { data: { id: 'x', order_ref: 'RSE-0001' }, error: null as any }

jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => ({
      insert: (row: any) => { inserted.push(row); return { select: () => ({ single: async () => mockInsertResult }) } },
    }),
  }),
}))
jest.mock('@/lib/rateLimit', () => ({ guardRate: () => null, intakeRule: () => ({}) }))
jest.mock('@/lib/contacts', () => ({ upsertContact: jest.fn().mockResolvedValue({}) }))
jest.mock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: jest.fn() } })) }))
jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body, json: async () => body }) },
}))

import { POST } from '@/app/api/cm-cheer-order/route'

const line = { name: 'Royal Blue Medium Canvas Tote — Rooster Patch', qty: 1, unit_price: 40, line_total: 40, cost_per_unit: 30 }
const order = (over: Record<string, unknown> = {}) => ({
  team: 'rse', athleteName: 'Ava Test', teacherName: 'Mrs. Smith', parentName: 'Pat Test',
  email: 'pat@example.com', phone: '6315550100', paymentMethod: 'cash',
  deliveryMethod: 'classroom', deliveryAddress: null,
  total: 40, totalCost: 30, totalProfit: 10, itemsData: [line], items: '1x ' + line.name,
  ...over,
})
const req = (body: any) => ({ json: async () => body, headers: new Headers() }) as any

beforeEach(() => { inserted.length = 0 })

describe('POST /api/cm-cheer-order — RSE', () => {
  it('files a cash order under the rse team', async () => {
    const res: any = await POST(req(order()))
    expect(res.status).toBe(200)
    expect(res.body.order_ref).toBe('RSE-0001')
    expect(inserted).toHaveLength(1)
    expect(inserted[0].team).toBe('rse')
    expect(inserted[0].teacher_name).toBe('Mrs. Smith')
  })

  it('refuses venmo while RSE has no verified account, and writes nothing', async () => {
    const res: any = await POST(req(order({ paymentMethod: 'venmo' })))
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/venmo/i)
    expect(inserted).toHaveLength(0)
  })

  it('still requires the teacher, as for any school PTO', async () => {
    const res: any = await POST(req(order({ teacherName: '' })))
    expect(res.status).toBe(400)
    expect(inserted).toHaveLength(0)
  })
})
