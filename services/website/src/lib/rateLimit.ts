/**
 * A bound on how many times a stranger may push a row through a public door.
 *
 * Before this module there was none, anywhere, on any route. One unauthenticated
 * POST to `/api/lead` writes a `contacts` row (which since link 17 really does
 * mirror into Brevo AND Quo), a `bookings` lead plan, an `ingested_messages`
 * event, a `contact_interactions` row and a `contact_sequence_enrollments` row,
 * then sends two emails through Resend and one SMS to Adam's phone. Nothing
 * counted. Measured volume for comparison: over the whole ten-day nginx window
 * the busiest public intake route took **23** requests.
 *
 * ── WHY THERE ARE TWO BUCKETS, AND WHAT THE FIRST ONE CANNOT DO ──
 *
 * Cloudflare fronts this site and nginx is configured with
 * `X-Real-IP $remote_addr` / `X-Forwarded-For $proxy_add_x_forwarded_for` and no
 * `real_ip_header`, so inside the container:
 *
 *   X-Real-IP          = the CLOUDFLARE EDGE address — trustworthy, and shared
 *                        by a great many real visitors, so useless as an identity
 *   X-Forwarded-For    = "<whatever Cloudflare was told>, <cloudflare edge>"
 *   CF-Connecting-IP   = the real client — set by Cloudflare, passed through
 *                        untouched, and therefore FORGEABLE by anyone who reaches
 *                        the origin IP directly with the right Host header
 *
 * That is the same family as `X-Forwarded-Host` (see `lib/publicOrigin.ts`): a
 * header nginx does not SET is a header the caller controls. So the per-caller
 * bucket is a courtesy — it stops the ordinary runaway script and the accidental
 * double-submit — and the per-ROUTE bucket is the one that holds against somebody
 * who is trying. The route ceiling is set two to three orders of magnitude above
 * real traffic, so it can only be reached deliberately.
 *
 * ── WHAT THIS DELIBERATELY IS NOT ──
 *
 * In-memory, in one container. It resets on every deploy and it would not be
 * shared if the site were ever scaled to two replicas. A durable limiter means a
 * table, a migration and a write on every request to a surface whose whole
 * problem is unbounded writes. The honest trade is an effective bound today with
 * its limits written down, rather than no bound at all — and it is recorded as
 * needs-Adam if he ever wants the durable version.
 *
 * Rule 10: a refusal SAYS it refused. Every rejection logs the route, the bucket
 * that tripped and the masked caller key, and answers 429 with `Retry-After`.
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export interface RateLimitRule {
  /** Stable name — the bucket key and the log label. */
  route: string
  /** Requests one caller may make in the window. */
  perCaller: number
  /** Requests ALL callers together may make in the window. Not forgeable. */
  perRoute: number
  /** Window in milliseconds. */
  windowMs: number
}

export const MINUTE_MS = 60_000
export const HOUR_MS = 60 * MINUTE_MS

/**
 * The default for a form that writes rows and sends mail.
 *
 * 5 per caller per 10 minutes covers a genuine retry and a corrected resubmit;
 * 120 per route per 10 minutes is roughly 300× the busiest route's real
 * ten-DAY volume.
 */
export function intakeRule(route: string): RateLimitRule {
  return { route, perCaller: 5, perRoute: 120, windowMs: 10 * MINUTE_MS }
}

/**
 * For an INTERACTIVE surface a customer works in — the party planner, the studio
 * edit form, the mileage lookup, a payment page that reconciles itself.
 *
 * Measured before it was chosen, and it is why this function exists. The nginx log
 * for `/api/party-builder/save` holds **five saves from one visitor in 6m22s** on
 * 10 September (22:35:02 → 22:41:24) and four in 51 seconds on the same day.
 * `intakeRule`'s 5-per-10-minutes would have refused that customer's fifth save
 * mid-plan, which is worse than having no limiter at all: a throttle that blocks a
 * paying customer is the outage this module's own header warns about, and I only
 * found it by firing the thing in production and then going back to the log.
 *
 * 30 per 10 minutes is six times the busiest real session and still three orders
 * of magnitude below what a script does.
 */
export function plannerRule(route: string): RateLimitRule {
  return { route, perCaller: 30, perRoute: 400, windowMs: 10 * MINUTE_MS }
}

/** For a route that spends money at a third party on every call. */
export function costlyRule(route: string, perCaller = 3, perRoute = 30): RateLimitRule {
  return { route, perCaller, perRoute, windowMs: HOUR_MS }
}

/**
 * For a route whose whole job is to interrupt Adam — an email to the owner
 * inbox AND a billed SMS to his phone, on every call.
 *
 * `/api/portal/send-message` and `/api/portal/notify-payment` each do both, on a
 * portal cookie alone, and neither counted anything. Measured over the ten-day
 * nginx window: **four** notify-payment requests (all real customers, all 200)
 * and **zero** send-message requests. 8 per caller per hour is 2× the real
 * ten-day total in a single hour for one person, so it cannot refuse a customer
 * who is genuinely going back and forth; 60 per route per hour bounds the
 * text-bomb, which is what a stolen or shared cookie buys today.
 *
 * The per-caller half is forgeable (see the header) — the route ceiling is the
 * half that holds, and on this surface that ceiling is what stops Adam's phone
 * from ringing all night.
 */
export function ownerNotifyRule(route: string): RateLimitRule {
  return { route, perCaller: 8, perRoute: 60, windowMs: HOUR_MS }
}

// ───────────────────────────────────────────────────────────────────────────
// Caller identity
// ───────────────────────────────────────────────────────────────────────────

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
const IPV6ISH = /^[0-9a-f:]{3,45}$/i

function looksLikeIp(value: string): boolean {
  const s = value.trim()
  if (!s || s.length > 45) return false
  return IPV4.test(s) || IPV6ISH.test(s)
}

/**
 * Best available identity for the caller, and a note about how much it is worth.
 *
 * Exported because the tests pin the precedence: `CF-Connecting-IP` first because
 * it is the only header that names the actual visitor, then the FIRST
 * `X-Forwarded-For` entry (Cloudflare's own claim about the client, which nginx
 * appends its edge address to), then `X-Real-IP`, which nginx sets itself and so
 * always exists but identifies Cloudflare rather than the visitor.
 */
export function callerKey(req: NextRequest): { key: string; trusted: boolean } {
  /**
   * Read defensively. A rate limiter must never become an outage, and that
   * includes throwing on a request shape it did not expect: `req.headers` is
   * always present on a real `NextRequest`, but this function sits in front of
   * every public write in the application and the cost of being wrong about that
   * is a 500 on the booking funnel rather than a missed throttle.
   */
  const get = (name: string): string | null => {
    try {
      return req.headers?.get?.(name) ?? null
    } catch {
      return null
    }
  }

  const cf = get('cf-connecting-ip')
  if (cf && looksLikeIp(cf)) return { key: cf.trim(), trusted: false }

  const xff = get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]
    if (first && looksLikeIp(first)) return { key: first.trim(), trusted: false }
  }

  const real = get('x-real-ip')
  if (real && looksLikeIp(real)) return { key: real.trim(), trusted: true }

  return { key: 'unknown', trusted: true }
}

/**
 * Never log a whole address: the first and last octets are enough to tell two
 * callers apart in a log line.
 *
 * The first version of this replaced only the leading `a.b.` and left `c.d`
 * intact, producing `203.x.x.113.7` — two octets it had set out to hide, in a
 * string that looks masked. Anchored at both ends now.
 */
export function maskKey(key: string): string {
  if (key === 'unknown') return key
  const v4 = /^(\d{1,3})\.\d{1,3}\.\d{1,3}\.(\d{1,3})$/.exec(key)
  if (v4) return `${v4[1]}.x.x.${v4[2]}`
  return `${key.slice(0, 6)}…`
}

// ───────────────────────────────────────────────────────────────────────────
// The buckets
// ───────────────────────────────────────────────────────────────────────────

interface Bucket {
  count: number
  /** When this window opened. */
  since: number
}

/**
 * Module-level state. `globalThis` rather than a module const so a hot reload in
 * dev, and any accidental double module instantiation, share one map instead of
 * silently doubling every allowance.
 */
interface Store {
  buckets: Map<string, Bucket>
  lastSweep: number
}

const STORE_KEY = '__hhRateLimitStore' as const

function store(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>
  let s = g[STORE_KEY]
  if (!s) {
    s = { buckets: new Map(), lastSweep: 0 }
    g[STORE_KEY] = s
  }
  return s
}

/**
 * Drop windows that have expired.
 *
 * Without this the map is an unbounded memory leak keyed by attacker-chosen
 * strings — which on a rate limiter would be funny. Swept lazily, at most once a
 * minute, and the map is additionally capped so a flood of distinct forged keys
 * cannot grow it without limit.
 */
const MAX_TRACKED_KEYS = 20_000

function sweep(s: Store, now: number): void {
  if (now - s.lastSweep < MINUTE_MS && s.buckets.size < MAX_TRACKED_KEYS) return
  s.lastSweep = now
  // `forEach` rather than `for…of`: this project's tsconfig target predates
  // Map iteration, and a sweep that does not compile is a sweep that never runs.
  const stale: string[] = []
  s.buckets.forEach((bucket, key) => {
    // Any window longer than an hour is stale for every rule we define.
    if (now - bucket.since > HOUR_MS) stale.push(key)
  })
  for (const key of stale) s.buckets.delete(key)
  if (s.buckets.size >= MAX_TRACKED_KEYS) {
    // Last resort: the tracking itself has become the problem. Clearing means
    // every caller gets a fresh allowance, which is the safe direction — a rate
    // limiter must never become an outage.
    console.warn(`rateLimit: tracking ${s.buckets.size} keys — clearing all buckets`)
    s.buckets.clear()
  }
}

function hit(s: Store, key: string, limit: number, windowMs: number, now: number): { allowed: boolean; retryAfterMs: number } {
  const existing = s.buckets.get(key)
  if (!existing || now - existing.since >= windowMs) {
    s.buckets.set(key, { count: 1, since: now })
    return { allowed: true, retryAfterMs: 0 }
  }
  if (existing.count >= limit) {
    return { allowed: false, retryAfterMs: Math.max(0, windowMs - (now - existing.since)) }
  }
  existing.count += 1
  return { allowed: true, retryAfterMs: 0 }
}

export type RateLimitOutcome =
  | { allowed: true }
  | { allowed: false; bucket: 'caller' | 'route'; retryAfterSeconds: number }

/**
 * Count this request. Call it ONCE per request, before doing any work.
 *
 * The per-route bucket is charged first and only when the caller bucket allowed
 * the request, so a single caller hammering one route cannot exhaust the global
 * allowance for everybody else.
 */
export function checkRateLimit(req: NextRequest, rule: RateLimitRule, nowMs?: number): RateLimitOutcome {
  const s = store()
  const now = nowMs ?? Date.now()
  sweep(s, now)

  const { key, trusted } = callerKey(req)

  /**
   * No usable address at all. The per-caller bucket is SKIPPED rather than shared.
   *
   * Every caller with no `CF-Connecting-IP`, no `X-Forwarded-For` and no
   * `X-Real-IP` would otherwise land in one bucket called `unknown` and throttle
   * each other — which means a proxy misconfiguration, or a future deployment that
   * does not set those headers, would cap the whole site at `perCaller` requests
   * per window. **A rate limiter must never become an outage**, and being unable
   * to tell two callers apart is not a reason to treat them as one. The route
   * bucket below still applies, so this is not an unbounded hole.
   *
   * nginx sets `X-Real-IP` unconditionally in front of this container, so on
   * production traffic this branch is unreachable; it is the tests and any future
   * proxy change that take it.
   */
  if (key === 'unknown') {
    const routeOnly = hit(s, `r:${rule.route}`, rule.perRoute, rule.windowMs, now)
    if (!routeOnly.allowed) {
      console.warn(`rateLimit: refused ${rule.route} — ROUTE bucket exhausted; caller could not be identified`)
      return { allowed: false, bucket: 'route', retryAfterSeconds: Math.ceil(routeOnly.retryAfterMs / 1000) }
    }
    return { allowed: true }
  }

  const caller = hit(s, `c:${rule.route}:${key}`, rule.perCaller, rule.windowMs, now)
  if (!caller.allowed) {
    console.warn(
      `rateLimit: refused ${rule.route} — caller bucket (${rule.perCaller}/${Math.round(rule.windowMs / 1000)}s) ` +
        `for ${maskKey(key)}${trusted ? '' : ' [caller-supplied key]'}`,
    )
    return { allowed: false, bucket: 'caller', retryAfterSeconds: Math.ceil(caller.retryAfterMs / 1000) }
  }

  const route = hit(s, `r:${rule.route}`, rule.perRoute, rule.windowMs, now)
  if (!route.allowed) {
    console.warn(
      `rateLimit: refused ${rule.route} — ROUTE bucket (${rule.perRoute}/${Math.round(rule.windowMs / 1000)}s) exhausted; ` +
        `last caller ${maskKey(key)}`,
    )
    return { allowed: false, bucket: 'route', retryAfterSeconds: Math.ceil(route.retryAfterMs / 1000) }
  }

  return { allowed: true }
}

/** The 429 a refused caller gets. Phrased for a customer, not an attacker. */
export function rateLimitedResponse(outcome: Extract<RateLimitOutcome, { allowed: false }>): NextResponse {
  return NextResponse.json(
    {
      error:
        outcome.bucket === 'caller'
          ? 'You have sent this a few times already — please wait a moment and try again.'
          : 'We are receiving an unusual number of requests. Please try again shortly, or call us on (631) 998-9325.',
    },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, outcome.retryAfterSeconds)) } },
  )
}

/**
 * The whole guard in one call: returns a 429 response to return, or null to
 * carry on. Every public intake route starts with this.
 */
export function guardRate(req: NextRequest, rule: RateLimitRule): NextResponse | null {
  const outcome = checkRateLimit(req, rule)
  return outcome.allowed ? null : rateLimitedResponse(outcome)
}

// ───────────────────────────────────────────────────────────────────────────
// The other axis: how often we will contact ONE recipient
// ───────────────────────────────────────────────────────────────────────────

/**
 * A bound on how many times we will mail or text one ADDRESS, regardless of who
 * asked.
 *
 * This is a different question from `checkRateLimit`, which bounds a CALLER and
 * a ROUTE. `/api/portal/resend-link` is the case that needs both: the caller
 * bucket stops one script, the route bucket stops a flood, and neither stops
 * somebody cycling through open proxies to text one real customer's phone forty
 * times. The recipient bucket does.
 *
 * It already existed — as a private `Map<string, number[]>` inside
 * `resend-link/route.ts` with its own window constants and, because nothing ever
 * deleted a key, as an unbounded memory leak keyed by any string a caller cared
 * to submit. Rule 11: a second implementation of "how often may this happen" is
 * one nothing is checking. Folding it in here gives it the sweep, the cap and
 * the logging the caller/route buckets already have.
 *
 * Keys are namespaced by the caller (`email:`, `sms:`) and are NOT logged: the
 * identifier is a real person's address or phone number.
 */
export function guardRecipient(
  identifier: string,
  opts: { label: string; max: number; windowMs: number },
  nowMs?: number,
): boolean {
  const s = store()
  const now = nowMs ?? Date.now()
  sweep(s, now)
  const outcome = hit(s, `p:${opts.label}:${identifier}`, opts.max, opts.windowMs, now)
  if (!outcome.allowed) {
    // Rule 10: a refusal says it refused. The recipient is not named.
    console.warn(
      `rateLimit: suppressed ${opts.label} — recipient bucket (${opts.max}/${Math.round(opts.windowMs / 1000)}s) exhausted`,
    )
  }
  return !outcome.allowed
}

/** Test-only: forget every bucket. */
export function __resetRateLimitForTests(): void {
  const s = store()
  s.buckets.clear()
  s.lastSweep = 0
}
