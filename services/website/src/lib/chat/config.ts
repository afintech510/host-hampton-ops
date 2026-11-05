/**
 * The website Host Assistant: switches, limits and what "available" means.
 *
 * ── THE SWITCH ──
 *
 * `PUBLIC_CHAT_ENABLED` must be exactly `true`. Unset, empty, `1`, `yes`,
 * `TRUE` — all OFF. A chat that talks to strangers and spends money per message
 * is opt-in with no ambiguity about what "on" is spelled like.
 *
 * ── FAIL CLOSED IN PRODUCTION ──
 *
 * Turnstile is the only thing between the open internet and the model bill, so
 * in production the chat is OFF unless BOTH `TURNSTILE_SITE_KEY` and
 * `TURNSTILE_SECRET_KEY` are set — and the model provider's own key. Outside
 * production (dev, test) an unconfigured Turnstile is skipped so the widget can
 * be exercised without a Cloudflare account; the check is on `NODE_ENV`, which
 * `next build` and `next start` set and which a request cannot influence.
 *
 * Every function takes `env` so a test can state the whole environment.
 */

import { providerConfigured } from '@/lib/ai/select'

export const CHAT_ENTITY = 'public_chat'

/** Visitor message length (characters). A birthday-party question is a sentence or three. */
export const MAX_MESSAGE_CHARS = 800
/** Visitor messages per session. Past this the chat hands off to a person. */
export const MAX_TURNS_PER_SESSION = 40
/** Model output tokens per call. A chat reply is short. */
export const MAX_REPLY_TOKENS = 1024
/** Tool round-trips inside one visitor message. */
export const MAX_TOOL_ITERATIONS = 6
/** Bytes of persisted history per session. A tool-use transcript cannot be truncated safely, so it is closed. */
export const MAX_HISTORY_BYTES = 150_000
/** One chat may spend at most this much, whatever the daily cap says. */
export const MAX_SESSION_USD = 0.75
/** What one turn is assumed to cost when checking headroom BEFORE spending. */
export const ESTIMATED_TURN_USD = 0.05
/** Default daily ceiling (USD, UTC day) on the whole public chat. */
export const DEFAULT_DAILY_USD_CAP = 3

/** How long a booking card stays valid after the assistant proposes it. */
export const CARD_TTL_MS = 30 * 60 * 1000

export function chatEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PUBLIC_CHAT_ENABLED === 'true'
}

export function turnstileSiteKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.TURNSTILE_SITE_KEY?.trim() || null
}

export function turnstileConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!turnstileSiteKey(env) && !!env.TURNSTILE_SECRET_KEY?.trim()
}

export type Availability = { ok: true } | { ok: false; reason: 'disabled' | 'no_turnstile' | 'no_provider' }

/**
 * Is the chat allowed to answer right now? Checked BEFORE the rate limiter
 * spends anything, and before Turnstile, the database or the model are touched.
 */
export function chatAvailability(env: NodeJS.ProcessEnv = process.env): Availability {
  if (!chatEnabled(env)) return { ok: false, reason: 'disabled' }
  if (env.NODE_ENV === 'production' && !turnstileConfigured(env)) return { ok: false, reason: 'no_turnstile' }
  if (!providerConfigured(env)) return { ok: false, reason: 'no_provider' }
  return { ok: true }
}

/** Daily USD ceiling for the public chat. A bad value falls back to the default, never to "no cap". */
export function dailyUsdCap(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.PUBLIC_CHAT_DAILY_USD_CAP)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_USD_CAP
}
