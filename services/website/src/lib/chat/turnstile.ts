/**
 * Cloudflare Turnstile, verified SERVER-SIDE on the first message of a chat.
 *
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 *
 * Three outcomes, because "could not check" is not "passed" (rule 12):
 *
 *   ok           Cloudflare said `success: true` for this token.
 *   failed       Cloudflare said no, the token was missing, the request threw or
 *                timed out, or the answer was not JSON. ALL of these refuse. A
 *                Turnstile outage turns the chat into "text us" — it never turns
 *                it into an open door.
 *   unconfigured No secret on this server. The caller decides what that means:
 *                in production `chatAvailability` has already kept the chat OFF
 *                (config.ts), so this is reachable only outside production.
 *
 * "Fail CLOSED when the secret is set but verification fails": the ONLY way to
 * `ok` is a success answer from Cloudflare; `unconfigured` is reported only when
 * the secret itself is absent.
 *
 * The visitor's address is passed as `remoteip` when it parses as one. It is
 * optional for Cloudflare and forgeable by us (see lib/rateLimit.ts), so it is
 * a hint to their scoring and not something we rely on.
 */

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const MAX_TOKEN_CHARS = 2048
const TIMEOUT_MS = 5000

export type TurnstileResult = 'ok' | 'failed' | 'unconfigured'

export async function verifyTurnstile(
  token: unknown,
  remoteIp: string | null,
  opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {},
): Promise<TurnstileResult> {
  const env = opts.env ?? process.env
  const secret = env.TURNSTILE_SECRET_KEY?.trim()
  if (!secret) return 'unconfigured'

  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_CHARS) return 'failed'

  const form = new URLSearchParams()
  form.set('secret', secret)
  form.set('response', token)
  if (remoteIp && remoteIp !== 'unknown') form.set('remoteip', remoteIp)

  try {
    const res = await (opts.fetchImpl ?? fetch)(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.warn(`chat: Turnstile siteverify answered HTTP ${res.status} — refusing`)
      return 'failed'
    }
    const json = (await res.json()) as { success?: unknown; 'error-codes'?: unknown }
    if (json.success === true) return 'ok'
    // Cloudflare's own error codes are not secrets and say WHY (rule 10).
    console.warn(`chat: Turnstile refused a token — ${Array.isArray(json['error-codes']) ? json['error-codes'].join(',') : 'no codes'}`)
    return 'failed'
  } catch (err) {
    console.warn('chat: Turnstile siteverify could not be reached — refusing:', err instanceof Error ? err.message : err)
    return 'failed'
  }
}
