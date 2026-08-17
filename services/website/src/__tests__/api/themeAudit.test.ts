/**
 * Tests for POST /api/admin/marketing/theme-audit (theme-page audit seeder).
 * Covers: admin auth, one checklist task created per active theme, and the
 * idempotent skip of themes that already have an audit task.
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

import { POST } from '@/app/api/admin/marketing/theme-audit/route'
import { isAdminAuthorized } from '@/lib/adminAuth'

const THEMES = [
  { id: 'theme-1', name: 'Unicorn', slug: 'unicorn' },
  { id: 'theme-2', name: 'Dino', slug: 'dino' },
]

function makeReq() {
  return { headers: { get: () => null } } as any
}

/**
 * Supabase mock. party_themes.select(...).eq(...).order() resolves themes;
 * marketing_tasks.select(...).eq() resolves the existing-tasks list;
 * marketing_tasks.insert() records rows.
 */
function makeSupabase(opts: { themes: any[]; existingEntityIds?: string[] }) {
  const inserted: any[] = []

  function chain(table: string): any {
    const c: any = {}
    ;['select', 'eq', 'order'].forEach(m => (c[m] = jest.fn(() => c)))

    if (table === 'party_themes') {
      // resolves after .order()
      c.order = jest.fn(() => Promise.resolve({ data: opts.themes, error: null }))
    }
    if (table === 'marketing_tasks') {
      // the existing-tasks query resolves after .eq()
      c.eq = jest.fn(() =>
        Promise.resolve({
          data: (opts.existingEntityIds || []).map(id => ({ entity_id: id })),
          error: null,
        })
      )
      c.insert = jest.fn((row: any) => {
        inserted.push(row)
        return Promise.resolve({ error: null })
      })
    }
    return c
  }

  return { supabase: { from: jest.fn((t: string) => chain(t)) } as any, inserted }
}

describe('POST /api/admin/marketing/theme-audit', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(isAdminAuthorized as jest.Mock).mockReturnValue(true)
  })

  it('returns 401 without admin auth', async () => {
    ;(isAdminAuthorized as jest.Mock).mockReturnValue(false)
    const res = await POST(makeReq())
    expect(res.status).toBe(401)
  })

  it('creates one ALWAYS_ASK checklist task per active theme', async () => {
    const { supabase, inserted } = makeSupabase({ themes: THEMES })
    mockGetSupabase.mockReturnValue(supabase)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ scanned: 2, created: 2, skipped: 0 })

    expect(inserted).toHaveLength(2)
    expect(inserted.every(r => r.task_type === 'theme_page_audit')).toBe(true)
    expect(inserted.every(r => r.approval_tier === 'ALWAYS_ASK')).toBe(true)
    expect(inserted.every(r => r.status === 'pending_review')).toBe(true)
    expect(inserted.map(r => r.entity_id).sort()).toEqual(['theme-1', 'theme-2'])
    expect(inserted[0].context.checklist.length).toBeGreaterThan(0)
  })

  it('skips themes that already have an audit task (idempotent re-run)', async () => {
    const { supabase, inserted } = makeSupabase({ themes: THEMES, existingEntityIds: ['theme-1'] })
    mockGetSupabase.mockReturnValue(supabase)

    const res = await POST(makeReq())
    expect(res.json()).toMatchObject({ scanned: 2, created: 1, skipped: 1 })
    expect(inserted).toHaveLength(1)
    expect(inserted[0].entity_id).toBe('theme-2')
  })
})
