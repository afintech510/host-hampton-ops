/**
 * Tests for budget breakers (src/lib/marketing/budget.ts).
 * Covers the two audited failure modes: the counter is INCREMENTED after a
 * spend (recordLlmSpend), and the cap is CHECKED before the next call
 * (assertLlmBudget refuses + logs once over cap).
 */

import {
  checkLlmBudget,
  assertLlmBudget,
  recordLlmSpend,
  checkSmsBudget,
  recordSmsSent,
  currentMonth,
  BudgetExceededError,
} from '@/lib/marketing/budget'

/** Stateful mock: one mutable marketing_budget row; ledger inserts captured. */
function makeSupabase(initial: Partial<{ llm_usd_spent: number; llm_usd_cap: number; sms_sent: number; sms_cap: number }> = {}) {
  const budget = {
    id: 'b1',
    month: currentMonth(),
    llm_usd_spent: initial.llm_usd_spent ?? 0,
    llm_usd_cap: initial.llm_usd_cap ?? 25,
    sms_sent: initial.sms_sent ?? 0,
    sms_cap: initial.sms_cap ?? 500,
  }
  const ledgerInserts: any[] = []

  function chain(table: string): any {
    const c: any = {}
    ;['select', 'eq'].forEach(m => (c[m] = jest.fn(() => c)))
    c.maybeSingle = jest.fn(() => Promise.resolve({ data: table === 'marketing_budget' ? budget : null, error: null }))
    c.single = jest.fn(() => Promise.resolve({ data: table === 'marketing_budget' ? budget : null, error: null }))
    c.update = jest.fn((patch: any) => {
      Object.assign(budget, patch)
      return { eq: jest.fn(() => Promise.resolve({ error: null })) }
    })
    c.insert = jest.fn((payload: any) => {
      if (table === 'marketing_ledger') ledgerInserts.push(payload)
      return Promise.resolve({ error: null })
    })
    return c
  }

  return { supabase: { from: jest.fn((t: string) => chain(t)) } as any, budget, ledgerInserts }
}

describe('LLM budget', () => {
  it('checkLlmBudget is ok under cap and not ok at/over cap', async () => {
    const { supabase } = makeSupabase({ llm_usd_spent: 1, llm_usd_cap: 10 })
    const a = await checkLlmBudget(supabase, 2)
    expect(a.ok).toBe(true)
    expect(a.remaining).toBe(9)

    const b = await checkLlmBudget(supabase, 20)
    expect(b.ok).toBe(false)
  })

  it('recordLlmSpend increments the counter and writes an llm_call ledger row', async () => {
    const { supabase, budget, ledgerInserts } = makeSupabase({ llm_usd_spent: 0, llm_usd_cap: 10 })
    const newSpent = await recordLlmSpend(supabase, { usd: 3.5, tokens: 1200, actor: 'generate-draft' })
    expect(newSpent).toBeCloseTo(3.5)
    expect(budget.llm_usd_spent).toBeCloseTo(3.5)
    expect(ledgerInserts).toHaveLength(1)
    expect(ledgerInserts[0]).toMatchObject({ action: 'llm_call', cost_usd: 3.5, tokens: 1200 })
  })

  it('increment-before-check: with cap=$0.01 the second call is refused and logged', async () => {
    const { supabase, ledgerInserts } = makeSupabase({ llm_usd_spent: 0, llm_usd_cap: 0.01 })

    // First call: budget ok, then record spend that reaches the cap.
    await expect(assertLlmBudget(supabase, { estimatedUsd: 0 })).resolves.toMatchObject({ ok: true })
    await recordLlmSpend(supabase, { usd: 0.01, actor: 'generate-draft' })

    // Second call: now over cap → refuse + a 'note' ledger row.
    await expect(assertLlmBudget(supabase, { estimatedUsd: 0.01, actor: 'generate-draft' })).rejects.toBeInstanceOf(BudgetExceededError)

    const refusal = ledgerInserts.find(l => l.action === 'note' && l.meta?.refused === 'llm_budget')
    expect(refusal).toBeDefined()
  })
})

describe('SMS budget', () => {
  it('checkSmsBudget respects the cap', async () => {
    const { supabase } = makeSupabase({ sms_sent: 499, sms_cap: 500 })
    expect((await checkSmsBudget(supabase, 1)).ok).toBe(true)
    expect((await checkSmsBudget(supabase, 2)).ok).toBe(false)
  })

  it('recordSmsSent increments and writes a send ledger row', async () => {
    const { supabase, budget, ledgerInserts } = makeSupabase({ sms_sent: 0, sms_cap: 500 })
    const n = await recordSmsSent(supabase, { count: 3, actor: 'cron' })
    expect(n).toBe(3)
    expect(budget.sms_sent).toBe(3)
    expect(ledgerInserts.find(l => l.action === 'send')).toBeDefined()
  })
})
