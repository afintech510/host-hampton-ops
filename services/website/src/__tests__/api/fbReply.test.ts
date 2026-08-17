/**
 * Tests for POST /api/admin/marketing/fb-reply (Facebook-assist LLM draft node).
 * Covers: admin auth, required input, budget refusal (no model call, no spend),
 * the happy path (draft lands as an ALWAYS_ASK fb_reply marketing_task, never
 * sent anywhere), and the voice-profile fold-in.
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

class BudgetExceededError extends Error {
  constructor() {
    super('llm budget exceeded')
    this.name = 'BudgetExceededError'
  }
}
jest.mock('@/lib/marketing/budget', () => ({
  BudgetExceededError,
  assertLlmBudget: jest.fn().mockResolvedValue({ ok: true, spent: 0, cap: 25, remaining: 25 }),
  recordLlmSpend: jest.fn().mockResolvedValue(0.005),
}))

jest.mock('@/lib/marketing/graph', () => ({
  writeLedger: jest.fn().mockResolvedValue(undefined),
}))

import { POST } from '@/app/api/admin/marketing/fb-reply/route'
import { isAdminAuthorized } from '@/lib/adminAuth'
import { assertLlmBudget, recordLlmSpend } from '@/lib/marketing/budget'
import { writeLedger } from '@/lib/marketing/graph'

function makeReq(body: any) {
  return { json: jest.fn().mockResolvedValue(body), headers: { get: () => null } } as any
}

/**
 * marketing_tasks.insert().select().single() resolves a row;
 * voice_profile.select().eq().maybeSingle() resolves the active profile.
 */
function makeSupabase(opts: { insertError?: any; voiceProfile?: any } = {}) {
  const inserted: any[] = []
  const taskChain: any = {
    insert: jest.fn((row: any) => {
      inserted.push(row)
      return taskChain
    }),
    select: jest.fn(() => taskChain),
    single: jest.fn(() =>
      Promise.resolve(
        opts.insertError ? { data: null, error: opts.insertError } : { data: { id: 'task-uuid-1' }, error: null }
      )
    ),
  }
  const voiceProfileChain: any = {
    select: jest.fn(() => voiceProfileChain),
    eq: jest.fn(() => voiceProfileChain),
    maybeSingle: jest.fn(() =>
      Promise.resolve({ data: opts.voiceProfile ? { profile: opts.voiceProfile } : null, error: null })
    ),
  }
  return {
    supabase: {
      from: jest.fn((table: string) => (table === 'voice_profile' ? voiceProfileChain : taskChain)),
    } as any,
    inserted,
  }
}

function mockAnthropicOk(reply = "Hi! Thanks for reaching out — starting at $1,100 depending on activities chosen.") {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      content: [{ type: 'text', text: JSON.stringify({ reply }) }],
      usage: { input_tokens: 400, output_tokens: 150 },
    }),
  }) as any
}

describe('POST /api/admin/marketing/fb-reply', () => {
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
    const res = await POST(makeReq({ text: 'Do you do parties in Southampton?' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when text is missing', async () => {
    const res = await POST(makeReq({}))
    expect(res.status).toBe(400)
  })

  it('refuses when the LLM budget is exhausted — no model call, no spend, no draft', async () => {
    ;(assertLlmBudget as jest.Mock).mockRejectedValueOnce(new BudgetExceededError())
    const { supabase, inserted } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)
    global.fetch = jest.fn() as any

    const res = await POST(makeReq({ text: 'Do you do parties in Southampton?' }))

    expect(res.status).toBe(402)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(recordLlmSpend).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(0)
  })

  it('drafts an ALWAYS_ASK fb_reply task landing as pending_review, never auto-sent', async () => {
    const { supabase, inserted } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)
    mockAnthropicOk()

    const res = await POST(makeReq({ text: 'Do you do parties in Southampton?' }))

    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, id: 'task-uuid-1', status: 'pending_review' })

    expect(inserted).toHaveLength(1)
    expect(inserted[0].task_type).toBe('fb_reply')
    expect(inserted[0].approval_tier).toBe('ALWAYS_ASK')
    expect(inserted[0].status).toBe('pending_review')
    expect(inserted[0].context.inbound_text).toBe('Do you do parties in Southampton?')
    expect(inserted[0].context.draft_reply).toContain('$1,100')

    expect(recordLlmSpend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tokens: 550, entityId: 'task-uuid-1' })
    )
    expect(writeLedger).toHaveBeenCalled()
  })

  it('folds the active voice profile into the system prompt when present', async () => {
    const { supabase } = makeSupabase({
      voiceProfile: { tone_rules: ['Warm and brief.'], greeting: 'Hi [First Name]!' },
    })
    mockGetSupabase.mockReturnValue(supabase)
    mockAnthropicOk()

    await POST(makeReq({ text: 'Do you do parties in Southampton?' }))

    const call = (global.fetch as jest.Mock).mock.calls[0]
    const requestBody = JSON.parse(call[1].body)
    expect(requestBody.system).toContain('OPERATOR VOICE')
    expect(requestBody.system).toContain('Warm and brief.')
  })

  it('returns 503 when ANTHROPIC_API_KEY is not configured', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { supabase } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)
    const res = await POST(makeReq({ text: 'Do you do parties in Southampton?' }))
    expect(res.status).toBe(503)
    expect(assertLlmBudget).not.toHaveBeenCalled()
  })
})
