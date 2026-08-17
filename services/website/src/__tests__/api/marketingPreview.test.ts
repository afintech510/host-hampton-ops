/**
 * Tests for GET /api/admin/marketing/preview/[id].
 * Covers: admin auth, returning a content row regardless of status (unlike
 * the public renderer which only serves published), and 404 for a missing id.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }),
  },
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))

const mockIsAdminAuthorized = jest.fn()
jest.mock('@/lib/adminAuth', () => ({
  isAdminAuthorized: (...args: any[]) => mockIsAdminAuthorized(...args),
  unauthorizedResponse: () => ({ status: 401, json: () => ({ error: 'Unauthorized' }) }),
}))

import { GET } from '@/app/api/admin/marketing/preview/[id]/route'

function makeReq() {
  return { headers: { get: () => null } } as any
}

function makeSupabase(row: any, error: any = null) {
  const chain: any = {}
  ;['select', 'eq'].forEach(m => (chain[m] = jest.fn(() => chain)))
  chain.maybeSingle = jest.fn(() => Promise.resolve({ data: row, error }))
  return { from: jest.fn(() => chain) } as any
}

describe('GET /api/admin/marketing/preview/[id]', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 without admin auth', async () => {
    mockIsAdminAuthorized.mockReturnValue(false)
    const res = await GET(makeReq(), { params: { id: 'row-1' } })
    expect(res.status).toBe(401)
  })

  it('returns a draft row (not just published)', async () => {
    mockIsAdminAuthorized.mockReturnValue(true)
    const row = { id: 'row-1', slug: 'permanent-jewelry-montauk', locale: 'en', title: 'Test', status: 'draft' }
    mockGetSupabase.mockReturnValue(makeSupabase(row))

    const res = await GET(makeReq(), { params: { id: 'row-1' } })
    expect(res.status).toBe(200)
    expect(res.body.content.status).toBe('draft')
  })

  it('returns 404 when the id does not exist', async () => {
    mockIsAdminAuthorized.mockReturnValue(true)
    mockGetSupabase.mockReturnValue(makeSupabase(null))

    const res = await GET(makeReq(), { params: { id: 'missing' } })
    expect(res.status).toBe(404)
  })

  it('returns 500 on a query error', async () => {
    mockIsAdminAuthorized.mockReturnValue(true)
    mockGetSupabase.mockReturnValue(makeSupabase(null, { message: 'boom' }))

    const res = await GET(makeReq(), { params: { id: 'row-1' } })
    expect(res.status).toBe(500)
  })
})
