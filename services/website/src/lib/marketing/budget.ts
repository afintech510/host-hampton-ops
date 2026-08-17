/**
 * Marketing budget breakers.
 *
 * Two of the top failure modes from the graph-engineer audit were "breakers
 * only checked at dispatch" and "spend counters never incremented". This
 * module fixes both by pairing:
 *
 *   - a CHECK that runs BEFORE every gated action (assertLlmBudget /
 *     assertSmsBudget), and
 *   - a RECORD that INCREMENTS the monthly counter after the action really
 *     happened (recordLlmSpend / recordSmsSent), each writing a ledger row.
 *
 * Callers must do both: check, act, record. The counter is per calendar
 * month (UTC), stored in marketing_budget keyed 'YYYY-MM'.
 */

import { getSupabase } from '@/lib/supabase'
import { writeLedger } from '@/lib/marketing/graph'

type Supa = ReturnType<typeof getSupabase>

/** 'YYYY-MM' for the given instant (UTC). */
export function currentMonth(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7)
}

export interface BudgetRow {
  id: string
  month: string
  llm_usd_spent: number
  llm_usd_cap: number
  sms_sent: number
  sms_cap: number
}

/** Fetch (or lazily create) the budget row for a month. */
export async function getOrCreateBudget(supabase: Supa, month: string = currentMonth()): Promise<BudgetRow> {
  const { data } = await supabase.from('marketing_budget').select('*').eq('month', month).maybeSingle()
  if (data) return data as BudgetRow

  // Create it. On a concurrent-insert conflict (unique month), re-read.
  const { data: inserted, error } = await supabase
    .from('marketing_budget')
    .insert({ month })
    .select('*')
    .single()

  if (inserted) return inserted as BudgetRow

  const { data: reread } = await supabase.from('marketing_budget').select('*').eq('month', month).single()
  if (reread) return reread as BudgetRow

  throw new Error(`getOrCreateBudget: could not obtain budget row for ${month}${error ? ` (${error.message})` : ''}`)
}

export interface BudgetCheck {
  ok: boolean
  spent: number
  cap: number
  remaining: number
}

/**
 * BEFORE an LLM call: is there budget left this month? Does NOT mutate.
 * `estimatedUsd` (default 0) lets a caller pre-reserve headroom for the call
 * it is about to make, so a call that would blow the cap is refused up front.
 */
export async function checkLlmBudget(
  supabase: Supa,
  estimatedUsd = 0,
  month: string = currentMonth()
): Promise<BudgetCheck> {
  const b = await getOrCreateBudget(supabase, month)
  const spent = Number(b.llm_usd_spent)
  const cap = Number(b.llm_usd_cap)
  const remaining = cap - spent
  return { ok: spent + estimatedUsd <= cap, spent, cap, remaining }
}

/**
 * BEFORE an LLM call, throwing variant. Logs a 'note' ledger row on refusal
 * so a blocked generation is auditable (verification: cap=$0.01 → 2nd call
 * refused and logged).
 */
export async function assertLlmBudget(
  supabase: Supa,
  opts: { estimatedUsd?: number; actor?: string; entityType?: string; entityId?: string; month?: string } = {}
): Promise<BudgetCheck> {
  const month = opts.month ?? currentMonth()
  const check = await checkLlmBudget(supabase, opts.estimatedUsd ?? 0, month)
  if (!check.ok) {
    await writeLedger(supabase, {
      entityType: opts.entityType ?? 'budget',
      entityId: opts.entityId ?? null,
      action: 'note',
      actor: opts.actor ?? 'system',
      meta: {
        refused: 'llm_budget',
        month,
        spent: check.spent,
        cap: check.cap,
        estimatedUsd: opts.estimatedUsd ?? 0,
      },
    })
    throw new BudgetExceededError('llm', month, check.spent, check.cap)
  }
  return check
}

/**
 * AFTER an LLM call really happened: increment the monthly spend by the actual
 * USD cost and append an 'llm_call' ledger row (with tokens/cost). Read-modify
 * -write is fine for this single-owner, low-volume system.
 */
export async function recordLlmSpend(
  supabase: Supa,
  opts: {
    usd: number
    tokens?: number
    actor?: string
    entityType?: string
    entityId?: string
    month?: string
    meta?: Record<string, unknown>
  }
): Promise<number> {
  const month = opts.month ?? currentMonth()
  const b = await getOrCreateBudget(supabase, month)
  const newSpent = Number(b.llm_usd_spent) + Number(opts.usd)

  const { error } = await supabase
    .from('marketing_budget')
    .update({ llm_usd_spent: newSpent })
    .eq('id', b.id)
  if (error) console.error('recordLlmSpend update error:', error.message)

  await writeLedger(supabase, {
    entityType: opts.entityType ?? 'budget',
    entityId: opts.entityId ?? null,
    action: 'llm_call',
    actor: opts.actor ?? 'system',
    costUsd: opts.usd,
    tokens: opts.tokens ?? null,
    meta: { month, ...(opts.meta ?? {}) },
  })

  return newSpent
}

/** BEFORE queueing marketing SMS: how many sends are left this month? */
export async function checkSmsBudget(
  supabase: Supa,
  countToSend = 0,
  month: string = currentMonth()
): Promise<{ ok: boolean; sent: number; cap: number; remaining: number }> {
  const b = await getOrCreateBudget(supabase, month)
  const sent = Number(b.sms_sent)
  const cap = Number(b.sms_cap)
  return { ok: sent + countToSend <= cap, sent, cap, remaining: cap - sent }
}

/** AFTER marketing SMS were queued/sent: increment the monthly SMS counter. */
export async function recordSmsSent(
  supabase: Supa,
  opts: { count: number; actor?: string; entityType?: string; entityId?: string; month?: string; meta?: Record<string, unknown> }
): Promise<number> {
  const month = opts.month ?? currentMonth()
  const b = await getOrCreateBudget(supabase, month)
  const newCount = Number(b.sms_sent) + Number(opts.count)

  const { error } = await supabase.from('marketing_budget').update({ sms_sent: newCount }).eq('id', b.id)
  if (error) console.error('recordSmsSent update error:', error.message)

  await writeLedger(supabase, {
    entityType: opts.entityType ?? 'budget',
    entityId: opts.entityId ?? null,
    action: 'send',
    actor: opts.actor ?? 'cron',
    meta: { month, sms_count: opts.count, ...(opts.meta ?? {}) },
  })

  return newCount
}

export class BudgetExceededError extends Error {
  constructor(kind: 'llm' | 'sms', month: string, spent: number, cap: number) {
    super(`${kind} budget exceeded for ${month}: ${spent} / ${cap}`)
    this.name = 'BudgetExceededError'
  }
}
