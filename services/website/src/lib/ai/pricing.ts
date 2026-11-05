/**
 * What a model call costs, and the refusal to guess.
 *
 * `costUsd` in lib/agent/config.ts bills an UNKNOWN model at the default
 * model's rate — a quiet guess, fine for the drafting agent whose models are a
 * short fixed list. A provider switch (`ASSISTANT_PROVIDER=openai`,
 * `ASSISTANT_MODEL=<anything>`) makes "unknown model" an everyday possibility,
 * and a daily budget that prices an unpriced model at somebody else's rate is
 * not a budget. So here an unknown model FAILS CLOSED: `priceFor` returns null
 * and `assertModelPriced` throws before a single token is spent.
 *
 * A model can be priced without a deploy by setting
 * `ASSISTANT_PRICE_IN_PER_MTOK` and `ASSISTANT_PRICE_OUT_PER_MTOK` (USD per
 * million tokens) alongside `ASSISTANT_MODEL`. Both must be positive numbers.
 */

import { MODEL_PRICING } from '@/lib/agent/config'

export interface ModelPrice { in: number; out: number }

export class UnpricedModelError extends Error {
  constructor(public readonly model: string) {
    super(`No price is configured for model "${model}" — refusing to spend. Add it to MODEL_PRICING or set ASSISTANT_PRICE_IN_PER_MTOK / ASSISTANT_PRICE_OUT_PER_MTOK.`)
    this.name = 'UnpricedModelError'
  }
}

function positive(v: string | undefined): number | null {
  if (v == null || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function priceFor(model: string, env: NodeJS.ProcessEnv = process.env): ModelPrice | null {
  const known = MODEL_PRICING[model]
  if (known) return known
  const i = positive(env.ASSISTANT_PRICE_IN_PER_MTOK)
  const o = positive(env.ASSISTANT_PRICE_OUT_PER_MTOK)
  return i != null && o != null ? { in: i, out: o } : null
}

export function assertModelPriced(model: string, env: NodeJS.ProcessEnv = process.env): ModelPrice {
  const p = priceFor(model, env)
  if (!p) throw new UnpricedModelError(model)
  return p
}

/** USD for one call. Throws for an unpriced model rather than guessing. */
export function callUsd(model: string, inputTokens: number, outputTokens: number, env: NodeJS.ProcessEnv = process.env): number {
  const p = assertModelPriced(model, env)
  return (inputTokens / 1_000_000) * p.in + (outputTokens / 1_000_000) * p.out
}
