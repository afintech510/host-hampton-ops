/**
 * Booking-agent configuration — every env name the agent reads, in one place.
 *
 * All getters read process.env at CALL time (never at module load) so tests can
 * set process.env in beforeEach and so a container restart is enough to change
 * behaviour.
 *
 * Env (also in docker-compose.yml and AGENTS.md §7):
 *   AGENT_ENABLED             '1' / 'true' turns the dispatcher on. Default OFF.
 *   AGENT_DRAFT_MODEL         Claude model for customer-facing drafts.
 *   AGENT_TRIAGE_MODEL        Claude model for Phase-3 email triage (unused yet).
 *   AGENT_DAILY_USD_CAP       Hard daily ceiling on agent LLM spend.
 *   REVIEW_LINK_SIGNING_SECRET  HMAC secret for /review/<token> preview links.
 *                             Falls back to PORTAL_LINK_SIGNING_SECRET.
 *   REVIEWER_PHONES           (lib/ownerNotify.ts) who gets the review SMS.
 */

/** Default model for customer-facing drafts. Haiku is fine for triage, not for this. */
export const DEFAULT_DRAFT_MODEL = 'claude-sonnet-5'

/** USD per 1M tokens (input / output), per model id. */
export const MODEL_PRICING: Record<string, { in: number; out: number }> = {
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-opus-5': { in: 15, out: 75 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  'claude-haiku-4-5': { in: 1, out: 5 },
}

/**
 * Master kill switch. Production stays exactly as it is until this is on:
 * events are still recorded (they are useful history either way), but the
 * dispatcher refuses to claim or draft anything.
 */
export function agentEnabled(): boolean {
  const v = (process.env.AGENT_ENABLED || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

export function draftModel(): string {
  return process.env.AGENT_DRAFT_MODEL?.trim() || DEFAULT_DRAFT_MODEL
}

export function triageModel(): string {
  return process.env.AGENT_TRIAGE_MODEL?.trim() || 'claude-haiku-4-5-20251001'
}

/** Hard daily ceiling on agent LLM spend, in USD. */
export function dailyUsdCap(): number {
  const n = Number(process.env.AGENT_DAILY_USD_CAP)
  return Number.isFinite(n) && n > 0 ? n : 5
}

/** Cost of one call in USD. Unknown models bill at the default model's rate. */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING[model] || MODEL_PRICING[DEFAULT_DRAFT_MODEL]
  return (inputTokens / 1_000_000) * price.in + (outputTokens / 1_000_000) * price.out
}

/** Signing secret for review preview links. Empty string when unconfigured. */
export function reviewLinkSecret(): string {
  return (
    process.env.REVIEW_LINK_SIGNING_SECRET?.trim() ||
    process.env.PORTAL_LINK_SIGNING_SECRET?.trim() ||
    ''
  )
}

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') || 'https://www.hosthampton.com'
}
