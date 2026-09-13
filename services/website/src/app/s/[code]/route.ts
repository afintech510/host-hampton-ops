import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { reviewLinkSecret } from '@/lib/agent/config'
import {
  hashShortCode,
  isAllowedTarget,
  isShortLinkExpired,
  isWellFormedCode,
} from '@/lib/shortLink'

export const dynamic = 'force-dynamic'

/**
 * /s/<code> — the short-link redirector (plan §25.3).
 *
 * Exists to take a 112-character preview URL down to 48, which is the
 * difference between a 3-segment and a 2-segment reviewer SMS on every draft.
 * See lib/shortLink.ts for why the saving is in the token and not in a
 * third-party shortener (short answer: US carriers filter bit.ly).
 *
 * ── Everything here fails the same way: 404 ──────────────────────────────
 *
 * Malformed, unknown, expired, tampered, or pointing somewhere we would not
 * send a human — all 404. Same reasoning as /review/[token]: a response that
 * distinguishes "expired" from "never existed" tells someone holding a guessed
 * code that they guessed a real one.
 *
 * ── Rate limiting is load-bearing here, not decoration ───────────────────
 *
 * A short code is 128 bits where the preview token was 256. That is safe
 * because of the TTL and because this endpoint will not answer an unbounded
 * number of guesses — the two are the reason the shorter code was allowed. The
 * limiter is in-process and per-IP: this runs as a single container behind
 * nginx, so that is the real boundary; if the app is ever scaled out, this must
 * move to the database or Redis, and the comment is here so that is noticed.
 */

/** Guesses per IP per window. Generous for a human, useless for a scanner. */
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60_000
const hits = new Map<string, { n: number; resetAt: number }>()

function rateLimited(ip: string, now = Date.now()): boolean {
  const rec = hits.get(ip)
  if (!rec || now >= rec.resetAt) {
    hits.set(ip, { n: 1, resetAt: now + RATE_WINDOW_MS })
    // Opportunistic sweep so the map cannot grow without bound.
    // forEach, not for..of — the repo downlevels to ES5 and a Map iterator
    // needs --downlevelIteration.
    if (hits.size > 5000) {
      const stale: string[] = []
      hits.forEach((v, k) => { if (now >= v.resetAt) stale.push(k) })
      stale.forEach(k => hits.delete(k))
    }
    return false
  }
  rec.n += 1
  return rec.n > RATE_LIMIT
}

/**
 * Client IP. `x-forwarded-for` is attacker-controlled in general, but nginx
 * SETS this one (unlike X-Forwarded-Host, which it does not) and we take the
 * FIRST entry, which is what nginx appended. A spoofed value can only cost the
 * spoofer their own budget — it cannot raise the ceiling.
 */
function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for') || ''
  const first = xff.split(',')[0]?.trim()
  return first || req.headers.get('x-real-ip') || 'unknown'
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params

  // Shape first — a code we could not have minted never reaches the database.
  if (!isWellFormedCode(code)) return new NextResponse('Not found', { status: 404 })

  if (rateLimited(clientIp(req))) {
    console.error('[short-link] rate limited', clientIp(req))
    return new NextResponse('Too many requests', { status: 429 })
  }

  const secret = reviewLinkSecret()
  // FAIL CLOSED. An unconfigured secret means every hash we compute is wrong,
  // and the one thing that must not happen is treating that as "no check".
  if (!secret) {
    console.error('[short-link] REVIEW_LINK_SIGNING_SECRET unset — refusing to resolve')
    return new NextResponse('Not found', { status: 404 })
  }

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('short_links')
    .select('code_hash, target, kind, expires_at, used_count')
    .eq('code_hash', hashShortCode(code, secret))
    .maybeSingle()

  // A read failure is NOT a miss. Saying 404 here would quietly turn a Supabase
  // timeout into "your link is dead" for a reviewer holding a valid link.
  if (error) {
    console.error('[short-link] lookup failed:', error.message)
    return new NextResponse('Temporarily unavailable', { status: 503 })
  }
  if (!data) return new NextResponse('Not found', { status: 404 })

  if (isShortLinkExpired(data.expires_at as string | null)) {
    return new NextResponse('Not found', { status: 404 })
  }

  // Re-screen on the way OUT. The target was screened when it was written, but
  // a stored value is not trusted just because we stored it — that is the only
  // check standing between a bad row and an open redirect on our domain.
  const target = String(data.target || '')
  if (!isAllowedTarget(target)) {
    console.error('[short-link] stored target failed the screen, refusing:', target.slice(0, 80))
    return new NextResponse('Not found', { status: 404 })
  }

  // Evidence, not a limit (§25.7). A preview link is forwardable by design; a
  // count climbing past 1 is how you notice it being forwarded. Best-effort:
  // failing to record a use must never cost the reviewer their redirect.
  void supabase
    .from('short_links')
    .update({ used_count: (Number(data.used_count) || 0) + 1, last_used_at: new Date().toISOString() })
    .eq('code_hash', data.code_hash)
    .then(({ error: e }) => {
      if (e) console.error('[short-link] use-count update failed (non-fatal):', e.message)
    })

  // 302, not 301: a permanent redirect would be cached by the browser and the
  // link would keep "working" from cache after it expired.
  return NextResponse.redirect(target, 302)
}
