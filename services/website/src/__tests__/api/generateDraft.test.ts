/**
 * Tests for POST /api/marketing/generate-draft (the Claude LLM draft node).
 * Covers: admin auth, required inputs, the budget-refusal path (no model call,
 * no spend), and the happy path (draft lands as pending_review via advance(),
 * never published; spend recorded with real tokens).
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

// Budget: real BudgetExceededError class so `instanceof` works in the route.
class BudgetExceededError extends Error {
  constructor() {
    super('llm budget exceeded')
    this.name = 'BudgetExceededError'
  }
}
jest.mock('@/lib/marketing/budget', () => ({
  BudgetExceededError,
  assertLlmBudget: jest.fn().mockResolvedValue({ ok: true, spent: 0, cap: 25, remaining: 25 }),
  recordLlmSpend: jest.fn().mockResolvedValue(0.01),
}))

jest.mock('@/lib/marketing/graph', () => ({
  advance: jest.fn().mockResolvedValue({ from: 'draft', to: 'pending_review' }),
  // townDraft writes a `note` row when the normaliser changed anything. Without
  // this the mock would throw the moment a test produced a note — rule 7, a
  // guardrail moved between modules breaking its own test silently.
  writeLedger: jest.fn().mockResolvedValue(undefined),
}))

import { POST } from '@/app/api/marketing/generate-draft/route'
import { isAdminAuthorized } from '@/lib/adminAuth'
import { assertLlmBudget, recordLlmSpend } from '@/lib/marketing/budget'
import { advance, writeLedger } from '@/lib/marketing/graph'
import { MAX_TITLE_CHARS, MAX_DESCRIPTION_CHARS } from '@/lib/seo'

const VALID_DRAFT = {
  title: 'Permanent Jewelry in Southampton, NY | Host Hampton',
  meta_description: 'Welded-on permanent bracelets for Southampton.',
  keywords: ['permanent jewelry southampton', 'welded bracelet'],
  sections: [{ heading: 'How it works', text: 'We weld it on.' }],
  faq: [{ q: 'Do you serve Southampton?', a: 'Yes.' }],
}

function makeReq(body: any) {
  return { json: jest.fn().mockResolvedValue(body), headers: { get: () => null } } as any
}

/**
 * Supabase mock: website_content.insert(...).select().single() resolves a row;
 * voice_profile.select().eq('is_active', true).maybeSingle() resolves the
 * active profile (or null/error, per opts) on a separate chain so it doesn't
 * interfere with the website_content insert chain.
 */
function makeSupabase(
  opts: { insertError?: any; voiceProfile?: any; voiceProfileError?: any } = {}
) {
  const inserted: any[] = []
  const contentChain: any = {
    insert: jest.fn((row: any) => {
      inserted.push(row)
      return contentChain
    }),
    select: jest.fn(() => contentChain),
    single: jest.fn(() =>
      Promise.resolve(
        opts.insertError
          ? { data: null, error: opts.insertError }
          : { data: { id: 'wc-uuid-1' }, error: null }
      )
    ),
  }
  const voiceProfileChain: any = {
    select: jest.fn(() => voiceProfileChain),
    eq: jest.fn(() => voiceProfileChain),
    maybeSingle: jest.fn(() =>
      Promise.resolve(
        opts.voiceProfileError
          ? { data: null, error: opts.voiceProfileError }
          : { data: opts.voiceProfile ? { profile: opts.voiceProfile } : null, error: null }
      )
    ),
  }
  return {
    supabase: {
      from: jest.fn((table: string) => (table === 'voice_profile' ? voiceProfileChain : contentChain)),
    } as any,
    inserted,
  }
}

const SAMPLE_VOICE_PROFILE = {
  tone_rules: ['Warm and brief.'],
  greeting: 'Hi [First Name], thanks so much for reaching out!',
  pricing_style: 'State a real starting number fast.',
  dos: ['Say "we".'],
  donts: ['Say "contact us for pricing".'],
  exemplars: [{ context: 'First-touch', text: 'Hi [Name], thanks so much for reaching out!' }],
}

function mockAnthropicOk() {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      content: [{ type: 'text', text: JSON.stringify(VALID_DRAFT) }],
      usage: { input_tokens: 1500, output_tokens: 2000 },
    }),
  }) as any
}

describe('POST /api/marketing/generate-draft', () => {
  const originalEnv = process.env
  const originalFetch = global.fetch
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, ANTHROPIC_API_KEY: 'sk-test' }
    ;(isAdminAuthorized as jest.Mock).mockReturnValue(true)
  })
  afterAll(() => {
    process.env = originalEnv
    global.fetch = originalFetch
  })

  it('returns 401 without admin auth', async () => {
    ;(isAdminAuthorized as jest.Mock).mockReturnValue(false)
    const res = await POST(makeReq({ town: 'Southampton', service: 'permanent jewelry' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when town or service is missing', async () => {
    const res = await POST(makeReq({ town: 'Southampton' }))
    expect(res.status).toBe(400)
  })

  it('refuses when the LLM budget is exhausted — no model call, no spend, no draft', async () => {
    ;(assertLlmBudget as jest.Mock).mockRejectedValueOnce(new BudgetExceededError())
    const { supabase, inserted } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)
    global.fetch = jest.fn() as any

    const res = await POST(makeReq({ town: 'Southampton', service: 'permanent jewelry' }))

    expect(res.status).toBe(402)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(recordLlmSpend).not.toHaveBeenCalled()
    expect(advance).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(0)
  })

  it('drafts a row that lands as pending_review (never published) and records real spend', async () => {
    const { supabase, inserted } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)
    mockAnthropicOk()

    const res = await POST(makeReq({ town: 'Southampton', service: 'permanent jewelry' }))

    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, id: 'wc-uuid-1', status: 'pending_review' })

    // Inserted as a draft — never approved/published on this path.
    expect(inserted).toHaveLength(1)
    expect(inserted[0].status).toBe('draft')
    expect(inserted[0].slug).toBe('permanent-jewelry-southampton')
    expect(inserted[0].references_child_media).toBe(false)

    // advance() is the ONLY status writer and moves it to pending_review.
    expect(advance).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'website_content', id: 'wc-uuid-1', to: 'pending_review' })
    )
    // Never published.
    expect((advance as jest.Mock).mock.calls.every(c => c[0].to !== 'published')).toBe(true)

    // Real cost recorded: 1500 in @ $1/M + 2000 out @ $5/M = $0.0115.
    expect(recordLlmSpend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tokens: 3500, entityId: 'wc-uuid-1' })
    )
    expect((recordLlmSpend as jest.Mock).mock.calls[0][1].usd).toBeCloseTo(0.0115, 6)
  })

  it('returns 503 when ANTHROPIC_API_KEY is not configured', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { supabase } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)
    const res = await POST(makeReq({ town: 'Southampton', service: 'permanent jewelry' }))
    expect(res.status).toBe(503)
    expect(assertLlmBudget).not.toHaveBeenCalled()
  })

  it('returns 409 on a duplicate (slug, locale)', async () => {
    const { supabase } = makeSupabase({ insertError: { code: '23505', message: 'duplicate key' } })
    mockGetSupabase.mockReturnValue(supabase)
    mockAnthropicOk()
    const res = await POST(makeReq({ town: 'Southampton', service: 'permanent jewelry' }))
    expect(res.status).toBe(409)
    expect(advance).not.toHaveBeenCalled()
  })

  it('folds the active voice profile into the Anthropic system prompt when present', async () => {
    const { supabase } = makeSupabase({ voiceProfile: SAMPLE_VOICE_PROFILE })
    mockGetSupabase.mockReturnValue(supabase)
    mockAnthropicOk()

    const res = await POST(makeReq({ town: 'Southampton', service: 'permanent jewelry' }))

    expect(res.status).toBe(200)
    const call = (global.fetch as jest.Mock).mock.calls[0]
    const requestBody = JSON.parse(call[1].body)
    expect(requestBody.system).toContain('OPERATOR VOICE')
    expect(requestBody.system).toContain('Warm and brief.')
    expect(requestBody.system).toContain('Hi [First Name], thanks so much for reaching out!')
  })

  it('falls back to the base system prompt when no voice profile row is active', async () => {
    const { supabase } = makeSupabase({ voiceProfile: null })
    mockGetSupabase.mockReturnValue(supabase)
    mockAnthropicOk()

    const res = await POST(makeReq({ town: 'Southampton', service: 'permanent jewelry' }))

    expect(res.status).toBe(200)
    const call = (global.fetch as jest.Mock).mock.calls[0]
    const requestBody = JSON.parse(call[1].body)
    expect(requestBody.system).not.toContain('OPERATOR VOICE')
  })

  /* ── What the model writes is data, not a DraftResult ──────────────────── */

  function mockAnthropicRaw(content: any) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content, usage: { input_tokens: 10, output_tokens: 10 } }),
    }) as any
  }

  it('finds the first TEXT block — content[0] can be a thinking block (rule 1)', async () => {
    const { supabase, inserted } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)
    mockAnthropicRaw([
      { type: 'thinking', thinking: 'Let me plan the page…' },
      { type: 'text', text: JSON.stringify(VALID_DRAFT) },
    ])
    const res = await POST(makeReq({ town: 'Southampton', service: 'permanent jewelry' }))
    expect(res.status).toBe(200)
    expect(inserted).toHaveLength(1)
  })

  it('states the real character budget in the prompt, imported not restated (rule 11)', async () => {
    const { supabase } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)
    mockAnthropicOk()
    await POST(makeReq({ town: 'Southampton', service: 'permanent jewelry' }))
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    const userPrompt = body.messages[0].content
    expect(userPrompt).toContain(`at most ${MAX_TITLE_CHARS} characters`)
    expect(userPrompt).toContain(`at most ${MAX_DESCRIPTION_CHARS} characters`)
  })

  it('an over-budget title is trimmed BEFORE it reaches the row, and the trim is on the ledger', async () => {
    const { supabase, inserted } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)
    mockAnthropicRaw([
      {
        type: 'text',
        text: JSON.stringify({
          ...VALID_DRAFT,
          title: 'Permanent Jewelry Welded Bracelets and Anklets for Southampton NY | Host Hampton',
        }),
      },
    ])
    const res = await POST(makeReq({ town: 'Southampton', service: 'permanent jewelry' }))
    expect(res.status).toBe(200)
    expect(inserted[0].title.length).toBeLessThanOrEqual(MAX_TITLE_CHARS)
    expect(inserted[0].title.endsWith(' | Host Hampton')).toBe(true)
    // Rule 10: it happened, so it is recorded and returned.
    expect(res.json().notes.join(' ')).toMatch(/title/)
    expect(writeLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'note', entityType: 'website_content' }),
    )
  })

  it('a section that answers with "html" stores text, and no markup reaches the DB', async () => {
    const { supabase, inserted } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)
    mockAnthropicRaw([
      {
        type: 'text',
        text: JSON.stringify({
          ...VALID_DRAFT,
          sections: [{ heading: 'How it works', html: '<p>We weld it on.</p><script>steal()</script>' }],
        }),
      },
    ])
    const res = await POST(makeReq({ town: 'Southampton', service: 'permanent jewelry' }))
    expect(res.status).toBe(200)
    expect(inserted[0].structured.sections).toEqual([{ heading: 'How it works', text: 'We weld it on.' }])
    expect(JSON.stringify(inserted[0])).not.toMatch(/<script|steal/)
  })

  it('refuses a reply with no usable body rather than queueing an empty page for review', async () => {
    const { supabase, inserted } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)
    mockAnthropicRaw([{ type: 'text', text: JSON.stringify({ ...VALID_DRAFT, sections: [], faq: [] }) }])
    const res = await POST(makeReq({ town: 'Southampton', service: 'permanent jewelry' }))
    expect(res.status).toBe(502)
    expect(inserted).toHaveLength(0)
    expect(advance).not.toHaveBeenCalled()
  })

  /* ── The slug is checked before the money is spent ─────────────────────── */

  it('refuses a slug shadowed by a hand-built page — with NO model call', async () => {
    const { supabase, inserted } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)
    global.fetch = jest.fn() as any
    const res = await POST(
      makeReq({ town: 'Southampton', service: 'permanent jewelry', slug: 'studio-rental' }),
    )
    expect(res.status).toBe(422)
    expect(res.json().error).toMatch(/hand-built page/)
    // The whole point of checking first: no Claude call, no spend, no row.
    expect(global.fetch).not.toHaveBeenCalled()
    expect(recordLlmSpend).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(0)
  })

  it('refuses a reserved slug before spending', async () => {
    const { supabase } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)
    global.fetch = jest.fn() as any
    const res = await POST(makeReq({ town: 'X', service: 'y', slug: 'admin' }))
    expect(res.status).toBe(422)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('the slug the cron generates for every one of its towns is publishable', async () => {
    const { supabase, inserted } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)
    mockAnthropicOk()
    const res = await POST(makeReq({ town: 'East Hampton', service: 'permanent jewelry' }))
    expect(res.status).toBe(200)
    expect(inserted[0].slug).toBe('permanent-jewelry-east-hampton')
  })

  it('falls back to the base system prompt when the voice_profile query errors (defensive no-op)', async () => {
    const { supabase } = makeSupabase({ voiceProfileError: { message: 'relation does not exist' } })
    mockGetSupabase.mockReturnValue(supabase)
    mockAnthropicOk()

    const res = await POST(makeReq({ town: 'Southampton', service: 'permanent jewelry' }))

    expect(res.status).toBe(200)
    const call = (global.fetch as jest.Mock).mock.calls[0]
    const requestBody = JSON.parse(call[1].body)
    expect(requestBody.system).not.toContain('OPERATOR VOICE')
  })
})
