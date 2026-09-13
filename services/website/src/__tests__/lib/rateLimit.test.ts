/**
 * `lib/rateLimit.ts` — the bound on how many times a stranger may push a row
 * through a public door. There was none, anywhere, before this.
 *
 * The properties worth pinning are the ones that cost something if they regress:
 * a limiter that never refuses is decoration, and a limiter that refuses the wrong
 * caller is an outage on the booking funnel. Both directions are tested.
 */

import {
  checkRateLimit,
  guardRate,
  callerKey,
  maskKey,
  intakeRule,
  costlyRule,
  rateLimitedResponse,
  __resetRateLimitForTests,
  MINUTE_MS,
} from '@/lib/rateLimit'
import type { NextRequest } from 'next/server'

function req(headers: Record<string, string> = {}): NextRequest {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return { headers: { get: (n: string) => lower[n.toLowerCase()] ?? null } } as unknown as NextRequest
}

const fromCf = (ip: string) => req({ 'cf-connecting-ip': ip })

beforeEach(() => __resetRateLimitForTests())

describe('callerKey — which header names the visitor', () => {
  it('prefers CF-Connecting-IP, which is the only header that names the actual client', () => {
    const r = req({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1, 172.68.1.1', 'x-real-ip': '172.68.1.1' })
    expect(callerKey(r)).toEqual({ key: '203.0.113.7', trusted: false })
  })

  it('falls back to the FIRST X-Forwarded-For entry, not the last', () => {
    // nginx appends its own `$remote_addr`, which is the Cloudflare edge, so the
    // LAST entry identifies Cloudflare and the first is the client's claim.
    const r = req({ 'x-forwarded-for': '198.51.100.1, 172.68.1.1' })
    expect(callerKey(r).key).toBe('198.51.100.1')
  })

  it('falls back to X-Real-IP and marks it TRUSTED but unhelpful', () => {
    // nginx sets this itself, so it cannot be forged — and it is the Cloudflare
    // edge address, shared by a great many real visitors.
    expect(callerKey(req({ 'x-real-ip': '172.68.1.1' }))).toEqual({ key: '172.68.1.1', trusted: true })
  })

  it('ignores a header that is not an address', () => {
    expect(callerKey(req({ 'cf-connecting-ip': 'not-an-ip' })).key).not.toBe('not-an-ip')
    expect(callerKey(req({ 'cf-connecting-ip': 'x'.repeat(200) })).key).toBe('unknown')
  })

  it('never throws on a request with no headers at all', () => {
    // A rate limiter must never become an outage, and that includes refusing to
    // crash on a shape it did not expect — it sits in front of every public write.
    expect(() => callerKey({} as unknown as NextRequest)).not.toThrow()
    expect(callerKey({} as unknown as NextRequest).key).toBe('unknown')
  })

  it('masks an address before it is logged', () => {
    expect(maskKey('203.0.113.7')).toBe('203.x.x.7')
    expect(maskKey('unknown')).toBe('unknown')
    expect(maskKey('2001:db8::1')).not.toContain('db8::1')
  })
})

describe('the per-caller bucket', () => {
  it('allows the documented allowance and refuses the next one', () => {
    const rule = intakeRule('t1')
    for (let i = 0; i < rule.perCaller; i++) {
      expect(checkRateLimit(fromCf('203.0.113.7'), rule).allowed).toBe(true)
    }
    const refused = checkRateLimit(fromCf('203.0.113.7'), rule)
    expect(refused.allowed).toBe(false)
    if (!refused.allowed) {
      expect(refused.bucket).toBe('caller')
      expect(refused.retryAfterSeconds).toBeGreaterThan(0)
    }
  })

  it('does not punish a DIFFERENT caller', () => {
    const rule = intakeRule('t2')
    for (let i = 0; i < rule.perCaller + 3; i++) checkRateLimit(fromCf('203.0.113.7'), rule)
    expect(checkRateLimit(fromCf('203.0.113.8'), rule).allowed).toBe(true)
  })

  it('does not leak across routes', () => {
    for (let i = 0; i < 10; i++) checkRateLimit(fromCf('203.0.113.7'), intakeRule('t3'))
    expect(checkRateLimit(fromCf('203.0.113.7'), intakeRule('t4')).allowed).toBe(true)
  })

  it('forgets the window once it has passed', () => {
    const rule = intakeRule('t5')
    const t0 = 1_000_000_000_000
    for (let i = 0; i < rule.perCaller; i++) checkRateLimit(fromCf('203.0.113.7'), rule, t0)
    expect(checkRateLimit(fromCf('203.0.113.7'), rule, t0).allowed).toBe(false)
    expect(checkRateLimit(fromCf('203.0.113.7'), rule, t0 + rule.windowMs + 1).allowed).toBe(true)
  })
})

describe('the per-route bucket — the half that is not forgeable', () => {
  it('refuses once the whole route allowance is spent, whoever the callers are', () => {
    // The per-caller key comes from a header the caller controls, so somebody
    // rotating it walks through that bucket. This one they cannot.
    const rule = { route: 't6', perCaller: 1000, perRoute: 8, windowMs: MINUTE_MS }
    for (let i = 0; i < rule.perRoute; i++) {
      expect(checkRateLimit(fromCf(`203.0.113.${i}`), rule).allowed).toBe(true)
    }
    const refused = checkRateLimit(fromCf('203.0.113.99'), rule)
    expect(refused.allowed).toBe(false)
    if (!refused.allowed) expect(refused.bucket).toBe('route')
  })

  it('is NOT charged when the caller bucket already refused', () => {
    // Otherwise one caller hammering a route exhausts everybody else's allowance,
    // which turns a throttle into a denial of service against real customers.
    const rule = { route: 't7', perCaller: 2, perRoute: 6, windowMs: MINUTE_MS }
    for (let i = 0; i < 20; i++) checkRateLimit(fromCf('203.0.113.7'), rule)
    // The noisy caller spent 2 of the 6; four are left for everybody else.
    for (let i = 0; i < 4; i++) {
      expect(checkRateLimit(fromCf(`203.0.113.${20 + i}`), rule).allowed).toBe(true)
    }
    expect(checkRateLimit(fromCf('203.0.113.50'), rule).allowed).toBe(false)
  })
})

describe('an unidentifiable caller', () => {
  it('SKIPS the per-caller bucket rather than sharing one', () => {
    // Every caller with no usable address header would otherwise land in a single
    // bucket called `unknown` and throttle each other — so a proxy
    // misconfiguration would cap the whole site at `perCaller` requests per
    // window. nginx sets X-Real-IP unconditionally, so this is unreachable on
    // production traffic; it is the direction that must be safe anyway.
    const rule = intakeRule('t8')
    for (let i = 0; i < rule.perCaller + 10; i++) {
      expect(checkRateLimit(req(), rule).allowed).toBe(true)
    }
  })

  it('is still held by the route bucket', () => {
    const rule = { route: 't9', perCaller: 2, perRoute: 5, windowMs: MINUTE_MS }
    for (let i = 0; i < rule.perRoute; i++) expect(checkRateLimit(req(), rule).allowed).toBe(true)
    const refused = checkRateLimit(req(), rule)
    expect(refused.allowed).toBe(false)
    if (!refused.allowed) expect(refused.bucket).toBe('route')
  })
})

describe('the refusal itself', () => {
  it('is a 429 carrying Retry-After, and does not read like an accusation', () => {
    const res = rateLimitedResponse({ allowed: false, bucket: 'caller', retryAfterSeconds: 42 })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
  })

  it('never sends Retry-After: 0, which a client reads as "immediately"', () => {
    const res = rateLimitedResponse({ allowed: false, bucket: 'route', retryAfterSeconds: 0 })
    expect(res.headers.get('Retry-After')).toBe('1')
  })

  it('guardRate returns null while the caller is inside the allowance', () => {
    const rule = intakeRule('t10')
    expect(guardRate(fromCf('203.0.113.7'), rule)).toBeNull()
    for (let i = 0; i < rule.perCaller; i++) guardRate(fromCf('203.0.113.7'), rule)
    expect(guardRate(fromCf('203.0.113.7'), rule)).not.toBeNull()
  })
})

describe('the rules themselves', () => {
  it('an intake allowance covers a genuine retry and a corrected resubmit', () => {
    // Measured for scale: over the whole ten-day nginx window the busiest public
    // intake route took 23 requests. These numbers are two to three orders of
    // magnitude above real traffic on purpose.
    const rule = intakeRule('x')
    expect(rule.perCaller).toBeGreaterThanOrEqual(3)
    expect(rule.perRoute).toBeGreaterThanOrEqual(100)
    expect(rule.windowMs).toBeLessThanOrEqual(30 * MINUTE_MS)
  })

  it('a costly route is tighter than an intake route', () => {
    expect(costlyRule('y').perCaller).toBeLessThanOrEqual(intakeRule('y').perCaller)
  })
})
