/**
 * /api/admin/marketing/content — the publish door and the reviewer's fix-it
 * path.
 *
 * The load-bearing assertions: `published` is refused for a slug that cannot
 * render, the row's `reviewed_by` names the person rather than the literal
 * 'admin', every write flushes the content cache, and PATCH is a whitelist that
 * cannot move `status`.
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
  adminActorId: jest.fn(() => 'admin:allie@hosthampton.test'),
  unauthorizedResponse: () => ({ status: 401, json: () => ({ error: 'Unauthorized' }) }),
}))

class IllegalTransitionError extends Error {}
class TransitionNotAuthorizedError extends Error {}
const mockAdvance = jest.fn()
const mockWriteLedger = jest.fn()
jest.mock('@/lib/marketing/graph', () => ({
  advance: (...args: any[]) => mockAdvance(...args),
  writeLedger: (...args: any[]) => mockWriteLedger(...args),
  IllegalTransitionError,
  TransitionNotAuthorizedError,
}))

jest.mock('@/lib/marketing/consent', () => ({ releasesAllSigned: jest.fn().mockResolvedValue(true) }))

const mockRevalidate = jest.fn()
jest.mock('@/lib/content/published', () => ({ revalidateContent: () => mockRevalidate() }))

import { POST, PATCH } from '@/app/api/admin/marketing/content/route'
import { isAdminAuthorized, adminActorId } from '@/lib/adminAuth'
import { MAX_DESCRIPTION_CHARS } from '@/lib/seo'

function makeReq(body: any) {
  return { json: jest.fn().mockResolvedValue(body), headers: { get: () => null } } as any
}

/** website_content.select().eq('id').maybeSingle() → row; update().eq() → result. */
function makeSupabase(opts: { row?: any; readError?: any; updateError?: any } = {}) {
  const updates: any[] = []
  return {
    updates,
    from: jest.fn(() => {
      const chain: any = {}
      chain.select = jest.fn(() => chain)
      chain.eq = jest.fn(() => chain)
      chain.maybeSingle = jest.fn(() =>
        Promise.resolve({
          data: opts.readError ? null : opts.row === undefined ? DEFAULT_ROW : opts.row,
          error: opts.readError ?? null,
        }),
      )
      chain.update = jest.fn((patch: any) => {
        updates.push(patch)
        return { eq: jest.fn(() => Promise.resolve({ error: opts.updateError ?? null })) }
      })
      return chain
    }),
  }
}

const DEFAULT_ROW = {
  slug: 'permanent-jewelry-southampton',
  locale: 'en',
  status: 'approved',
  title: 'Permanent Jewelry in Southampton | Host Hampton',
  meta_description: 'Short.',
  references_child_media: false,
  consent_release_ids: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(isAdminAuthorized as jest.Mock).mockReturnValue(true)
  mockAdvance.mockResolvedValue({ from: 'approved', to: 'published' })
})

describe('POST — auth and inputs', () => {
  it('401 without an admin', async () => {
    ;(isAdminAuthorized as jest.Mock).mockReturnValue(false)
    const res: any = await POST(makeReq({ id: 'x', to: 'published' }))
    expect(res.status).toBe(401)
    expect(mockAdvance).not.toHaveBeenCalled()
  })

  it('400 without id or to', async () => {
    const res: any = await POST(makeReq({ id: 'x' }))
    expect(res.status).toBe(400)
  })
})

describe('POST — rule 12, three outcomes on the row read', () => {
  it('a failed read is 503, not 404', async () => {
    mockGetSupabase.mockReturnValue(makeSupabase({ readError: { message: 'timeout' } }))
    const res: any = await POST(makeReq({ id: 'x', to: 'published' }))
    expect(res.status).toBe(503)
    expect(mockAdvance).not.toHaveBeenCalled()
  })

  it('a genuinely missing row is 404', async () => {
    mockGetSupabase.mockReturnValue(makeSupabase({ row: null }))
    const res: any = await POST(makeReq({ id: 'x', to: 'published' }))
    expect(res.status).toBe(404)
  })
})

describe('POST — the publish gate', () => {
  it('refuses to publish a slug shadowed by a hand-built page', async () => {
    // This is the live shape: all four English drafts collide with a real page.
    mockGetSupabase.mockReturnValue(makeSupabase({ row: { ...DEFAULT_ROW, slug: 'fundraiser' } }))
    const res: any = await POST(makeReq({ id: 'x', to: 'published' }))
    expect(res.status).toBe(409)
    expect(res.json().code).toBe('shadowed')
    expect(res.json().error).toMatch(/hand-built page/)
    expect(mockAdvance).not.toHaveBeenCalled()
  })

  it('allows the SPANISH row of the same slug, which really does render', async () => {
    mockGetSupabase.mockReturnValue(
      makeSupabase({ row: { ...DEFAULT_ROW, slug: 'party-room-rental', locale: 'es' } }),
    )
    const res: any = await POST(makeReq({ id: 'x', to: 'published' }))
    expect(res.status).toBe(200)
    expect(res.json().path).toBe('/es/party-room-rental')
  })

  it('does NOT block a non-publish transition on a shadowed slug', async () => {
    // Archiving a dead row must stay possible; only creating the URL is gated.
    mockAdvance.mockResolvedValue({ from: 'draft', to: 'archived' })
    mockGetSupabase.mockReturnValue(makeSupabase({ row: { ...DEFAULT_ROW, slug: 'fundraiser', status: 'draft' } }))
    const res: any = await POST(makeReq({ id: 'x', to: 'archived' }))
    expect(res.status).toBe(200)
    expect(mockAdvance).toHaveBeenCalled()
  })
})

describe('POST — actor and cache', () => {
  it('reviewed_by NAMES the admin instead of the literal "admin"', async () => {
    mockGetSupabase.mockReturnValue(makeSupabase())
    await POST(makeReq({ id: 'x', to: 'published' }))
    const patch = mockAdvance.mock.calls[0][0].patch
    expect(patch.reviewed_by).toBe('admin:allie@hosthampton.test')
    expect(patch.reviewed_by).not.toBe('admin')
    expect(adminActorId).toHaveBeenCalled()
  })

  it('the gated transition still carries isAdmin', async () => {
    mockGetSupabase.mockReturnValue(makeSupabase())
    await POST(makeReq({ id: 'x', to: 'published' }))
    expect(mockAdvance.mock.calls[0][0].actor).toEqual({
      id: 'admin:allie@hosthampton.test',
      isAdmin: true,
    })
  })

  it('flushes the content cache on a successful transition', async () => {
    mockGetSupabase.mockReturnValue(makeSupabase())
    await POST(makeReq({ id: 'x', to: 'published' }))
    expect(mockRevalidate).toHaveBeenCalledTimes(1)
  })

  it('does NOT flush when the transition was refused', async () => {
    mockAdvance.mockRejectedValue(new IllegalTransitionError('nope'))
    mockGetSupabase.mockReturnValue(makeSupabase())
    const res: any = await POST(makeReq({ id: 'x', to: 'published' }))
    expect(res.status).toBe(400)
    expect(mockRevalidate).not.toHaveBeenCalled()
  })

  it('a gate refusal is 403', async () => {
    mockAdvance.mockRejectedValue(new TransitionNotAuthorizedError('needs an admin'))
    mockGetSupabase.mockReturnValue(makeSupabase())
    const res: any = await POST(makeReq({ id: 'x', to: 'published' }))
    expect(res.status).toBe(403)
  })
})

describe('PATCH — the reviewer fix-it path', () => {
  it('401 without an admin', async () => {
    ;(isAdminAuthorized as jest.Mock).mockReturnValue(false)
    const res: any = await PATCH(makeReq({ id: 'x', title: 'T' }))
    expect(res.status).toBe(401)
  })

  it('cannot move status — it is not on the whitelist', async () => {
    const supa = makeSupabase()
    mockGetSupabase.mockReturnValue(supa)
    await PATCH(makeReq({ id: 'x', status: 'published', published_at: 'now', title: 'New title' }))
    expect(supa.updates).toHaveLength(1)
    expect(Object.keys(supa.updates[0])).toEqual(['title'])
    expect(mockAdvance).not.toHaveBeenCalled()
  })

  it('trims an over-budget description and SAYS it trimmed it', async () => {
    const supa = makeSupabase()
    mockGetSupabase.mockReturnValue(supa)
    const long = 'word '.repeat(60).trim()
    const res: any = await PATCH(makeReq({ id: 'x', meta_description: long }))
    expect(res.status).toBe(200)
    expect(supa.updates[0].meta_description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS)
    expect(res.json().notes.join(' ')).toMatch(/description trimmed/)
  })

  it('strips markup out of a pasted title', async () => {
    const supa = makeSupabase()
    mockGetSupabase.mockReturnValue(supa)
    await PATCH(makeReq({ id: 'x', title: '<b>Southampton</b> | Host Hampton' }))
    expect(supa.updates[0].title).toBe('Southampton | Host Hampton')
  })

  it('refuses an empty title rather than blanking the page', async () => {
    mockGetSupabase.mockReturnValue(makeSupabase())
    const res: any = await PATCH(makeReq({ id: 'x', title: '   ' }))
    expect(res.status).toBe(400)
  })

  it('refuses a slug change onto a hand-built page', async () => {
    const supa = makeSupabase()
    mockGetSupabase.mockReturnValue(supa)
    const res: any = await PATCH(makeReq({ id: 'x', slug: 'studio-rental' }))
    expect(res.status).toBe(422)
    expect(res.json().code).toBe('shadowed')
    expect(supa.updates).toHaveLength(0)
  })

  it('refuses a malformed slug', async () => {
    mockGetSupabase.mockReturnValue(makeSupabase())
    const res: any = await PATCH(makeReq({ id: 'x', slug: 'Not A Slug' }))
    expect(res.status).toBe(422)
    expect(res.json().code).toBe('format')
  })

  it('accepts a good slug change and records the move in the ledger', async () => {
    const supa = makeSupabase()
    mockGetSupabase.mockReturnValue(supa)
    const res: any = await PATCH(makeReq({ id: 'x', slug: 'permanent-jewelry-montauk' }))
    expect(res.status).toBe(200)
    expect(supa.updates[0].slug).toBe('permanent-jewelry-montauk')
    const ledger = mockWriteLedger.mock.calls[0][1]
    expect(ledger.actor).toBe('admin:allie@hosthampton.test')
    expect(ledger.meta.slug_from).toBe('permanent-jewelry-southampton')
    expect(ledger.meta.slug_to).toBe('permanent-jewelry-montauk')
    expect(mockRevalidate).toHaveBeenCalled()
  })

  it('a failed read is 503, not 404', async () => {
    mockGetSupabase.mockReturnValue(makeSupabase({ readError: { message: 'timeout' } }))
    const res: any = await PATCH(makeReq({ id: 'x', title: 'T' }))
    expect(res.status).toBe(503)
  })

  it('a (slug, locale) collision with another row is 409, not a 503', async () => {
    mockGetSupabase.mockReturnValue(makeSupabase({ updateError: { code: '23505' } }))
    const res: any = await PATCH(makeReq({ id: 'x', slug: 'permanent-jewelry-montauk' }))
    expect(res.status).toBe(409)
    expect(res.json().error).toMatch(/already uses/)
  })

  it('a no-op PATCH writes nothing and flushes nothing', async () => {
    const supa = makeSupabase()
    mockGetSupabase.mockReturnValue(supa)
    const res: any = await PATCH(makeReq({ id: 'x' }))
    expect(res.status).toBe(200)
    expect(supa.updates).toHaveLength(0)
    expect(mockRevalidate).not.toHaveBeenCalled()
    expect(mockWriteLedger).not.toHaveBeenCalled()
  })
})
