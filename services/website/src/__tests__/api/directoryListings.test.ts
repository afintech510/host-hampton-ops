/**
 * Tests for POST /api/admin/marketing/directory-listings (directory-listing
 * task seeder). Covers: admin auth, one checklist task per directory
 * (PartySlate + NAP consistency), and idempotent skip on re-run.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }),
  },
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))

jest.mock('@/lib/adminAuth', () => ({
  isAdminAuthorized: jest.fn(() => true),
  unauthorizedResponse: () => ({ status: 401, json: () => ({ error: 'Unauthorized' }) }),
}))

jest.mock('@/lib/marketing/graph', () => ({ writeLedger: jest.fn().mockResolvedValue(undefined) }))

import { POST } from '@/app/api/admin/marketing/directory-listings/route'
import { isAdminAuthorized } from '@/lib/adminAuth'

function makeReq() {
  return { headers: { get: () => null } } as any
}

/** marketing_tasks.select().eq() resolves existing tasks; .insert() records rows. */
function makeSupabase(opts: { existingEntityIds?: string[] } = {}) {
  const inserted: any[] = []
  const chain: any = {
    select: jest.fn(() => chain),
    eq: jest.fn(() =>
      Promise.resolve({
        data: (opts.existingEntityIds || []).map(id => ({ entity_id: id })),
        error: null,
      })
    ),
    insert: jest.fn((row: any) => {
      inserted.push(row)
      return Promise.resolve({ error: null })
    }),
  }
  return { supabase: { from: jest.fn(() => chain) } as any, inserted }
}

describe('POST /api/admin/marketing/directory-listings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(isAdminAuthorized as jest.Mock).mockReturnValue(true)
  })

  it('returns 401 without admin auth', async () => {
    ;(isAdminAuthorized as jest.Mock).mockReturnValue(false)
    const res = await POST(makeReq())
    expect(res.status).toBe(401)
  })

  it('creates one ALWAYS_ASK task per directory, PartySlate and NAP consistency', async () => {
    const { supabase, inserted } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ scanned: 2, created: 2, skipped: 0 })

    expect(inserted).toHaveLength(2)
    expect(inserted.every((r: any) => r.task_type === 'directory_listing')).toBe(true)
    expect(inserted.every((r: any) => r.approval_tier === 'ALWAYS_ASK')).toBe(true)
    expect(inserted.every((r: any) => r.status === 'pending_review')).toBe(true)
    expect(inserted.map((r: any) => r.entity_id).sort()).toEqual(['nap-consistency', 'partyslate'])
    expect(inserted[0].context.checklist.length).toBeGreaterThan(0)
  })

  it('skips directories that already have a task (idempotent re-run)', async () => {
    const { supabase, inserted } = makeSupabase({ existingEntityIds: ['partyslate'] })
    mockGetSupabase.mockReturnValue(supabase)

    const res = await POST(makeReq())
    expect(res.json()).toMatchObject({ scanned: 2, created: 1, skipped: 1 })
    expect(inserted).toHaveLength(1)
    expect(inserted[0].entity_id).toBe('nap-consistency')
  })
})
