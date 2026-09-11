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
/**
 * Ledger actor and entity name for everything the agent does. They live here,
 * not in draftInquiry.ts, because the nodes that need them (triage, extraction)
 * are also imported BY the draft node — putting them in a leaf module keeps the
 * agent's import graph acyclic.
 */
export const AGENT_ACTOR = 'AGENT'
export const DRAFT_ENTITY = 'inquiry_draft'

export const DEFAULT_DRAFT_MODEL = 'claude-sonnet-5'

/**
 * USD per 1M tokens (input / output), per model id.
 *
 * Corrected 2026-09-11: Sonnet 5 was listed at 3/15 (those are Sonnet 4.6's
 * rates) and Opus 5 at 15/75, so the ledger over-billed every draft by ~50%
 * and the daily cap tripped early. Note thinking tokens bill as output.
 */
export const MODEL_PRICING: Record<string, { in: number; out: number }> = {
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-opus-5': { in: 5, out: 25 },
  'claude-fable-5-1': { in: 10, out: 50 },
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

/**
 * Is it a reasonable hour to text a human? Used by the Phase-2 review nudge so a
 * draft that lands at 11pm does not buzz a phone at 1am.
 *
 * 9am–8pm America/New_York, every day — this is a party business, so Saturday is
 * a working day and "business hours" means "awake", not "Mon–Fri".
 */
export function isBusinessHours(now: Date = new Date()): boolean {
  // hourCycle 'h23' explicitly. `hour12: false` alone leaves en-US on the h24
  // cycle, where midnight formats as "24" — harmless for a 9–20 window (24 is
  // outside it either way) but exactly the kind of thing that becomes a 1am
  // text the day someone widens the range.
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(now),
  )
  return Number.isFinite(hour) && hour >= 9 && hour < 20
}

/** How long a draft may sit in sent_for_review before the single nudge SMS. */
export const NUDGE_AFTER_MS = 2 * 60 * 60 * 1000

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') || 'https://www.hosthampton.com'
}
