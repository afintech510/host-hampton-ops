/**
 * The origin this app is allowed to say it lives at.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY. Twenty-two API routes used to build their own public origin like this:
 *
 *     const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
 *     const origin = `https://${host}`
 *
 * `Host` cannot be forged past the edge — nginx's HTTPS `default_server`
 * answers 444 for any hostname that is not one of its `server_name`s. But
 * **nginx never sets `X-Forwarded-Host`**, so that header arrives exactly as
 * the client typed it and is passed straight through to the container, and the
 * code above *prefers* it. Measured against production on 2026-09-12:
 *
 *     curl -H 'X-Forwarded-Host: evil.example.com' \
 *          https://www.hosthampton.com/api/portal/auth
 *     → 307  location: https://evil.example.com/my-booking/login?error=invalid
 *
 * That one header decided:
 *
 *  - the `href` of the "View their quote" / "View Booking" links in the emails
 *    sent to the OWNER's inbox by the public `/api/quote/save`, `/api/lead`,
 *    `/api/checkout`, `/api/party-checkout` and `/api/party-builder/save`
 *    routes — a link in Adam's own notification, pointing at the caller's host,
 *    carrying a real booking ref (and Adam is the person holding `hh_admin`);
 *  - the saved-quote link mailed back to a CUSTOMER by `/api/quote/save` and
 *    `/api/portal/resend-link`;
 *  - **Stripe's `success_url` and `cancel_url`** in `/api/events/checkout`,
 *    `/api/cart-checkout`, `/api/gift-cards/checkout`,
 *    `/api/studio-rental/checkout` and `/api/admin/pay-link`, so a customer who
 *    really paid was redirected off-site afterwards with a live
 *    `{CHECKOUT_SESSION_ID}` in the query string;
 *  - every redirect out of `/api/portal/auth`, `/api/portal/email-auth/verify`
 *    and `/api/portal/my-bookings` — a plain open redirect.
 *
 * The portal MAGIC LINK was never affected, and that is the whole argument for
 * this module: `buildPortalUrl` uses `NEXT_PUBLIC_SITE_URL` with the same
 * hard-coded default, because somebody writing *that* line thought about it.
 * The origin was spelled five different ways across the codebase (`SITE_URL`
 * in `lib/seo.ts`, this env-or-default pair in `lib/portalAuth.ts`,
 * `lib/checkinAuth.ts` and `lib/unsubscribeLink.ts`, `siteUrl()` in
 * `lib/agent/config.ts`, `SITE_ORIGIN` in `lib/content/contentSafety.ts`) and
 * derived from a request header in twenty-two more places. Hard-won rule 11:
 * a concept defined twice is a concept nothing is checking — and here the one
 * spelling nobody checked is the one that reached a customer's inbox.
 *
 * WHY AN ALLOWLIST AND NOT A SANITISER. There is exactly one set of hostnames
 * this app is served from, and it is three items long. Anything else is either
 * a misconfiguration or an attack, and in both cases the right answer is the
 * canonical origin — never the caller's string, and never a repaired version of
 * it (a screen that repairs a hostile value is a screen whose output nobody can
 * reason about, `contentSafety.ts`).
 *
 * Rule 10: when this refuses a host it SAYS so, with the value, because a
 * silent fallback to the canonical origin looks exactly like the header not
 * having been sent.
 */

import { SITE_URL } from './seo'

/**
 * The origin used whenever the request cannot be trusted to name it.
 *
 * Same env-or-default pair as `portalAuth.ts` / `unsubscribeLink.ts` /
 * `checkinAuth.ts`, so the portal link, the unsubscribe link, the check-in link
 * and everything below agree. `seoAndOriginAgree` in the test asserts the
 * default still equals `SITE_URL`.
 */
export const CANONICAL_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL || SITE_URL).replace(/\/+$/, '')

/** Host of the canonical origin, e.g. `www.hosthampton.com`. */
export const CANONICAL_HOST = CANONICAL_ORIGIN.replace(/^https?:\/\//, '')

/**
 * Hostnames a request is allowed to claim.
 *
 * `hosthampton.com` is here because Cloudflare serves the apex; `localhost` and
 * `127.0.0.1` because `next start` and the deploy script's own smoke test talk
 * to the container directly, and refusing them would make every local link
 * point at production.
 */
export const ALLOWED_REQUEST_HOSTS: readonly string[] = [
  CANONICAL_HOST,
  'hosthampton.com',
  'localhost',
  '127.0.0.1',
]

export interface HeaderBag {
  get(name: string): string | null
}

/** A local development host, which is allowed to be served over plain http. */
function isLocalHost(host: string): boolean {
  const bare = host.split(':')[0]
  return bare === 'localhost' || bare === '127.0.0.1'
}

/**
 * The host the request may claim, or null when it may not claim one.
 *
 * PARSES rather than prefix-matches, for the reason `safeImageUrl` does: a
 * hostname is whatever a URL parser says it is, and `evil.example.com` hides
 * inside plenty of strings that a `startsWith`/`includes` test reads as ours —
 * `www.hosthampton.com.evil.example.com`, `evil.example.com/www.hosthampton.com`,
 * `evil.example.com@www.hosthampton.com` (userinfo, where the real host is the
 * part AFTER the `@`) and `www.hosthampton.com:80@evil.example.com`.
 */
export function screenRequestHost(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null
  // `X-Forwarded-Host` is defined as a comma-separated list when it crosses more
  // than one proxy. We sit behind exactly one, so a list means somebody else
  // wrote part of it — refused rather than "take the first", which is how a
  // header meant to be read left-to-right gets read right-to-left by the next
  // person to touch it.
  if (s.includes(',')) return null
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number
    if (cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029) return null
  }
  if (s.includes('\\') || s.includes('/') || s.includes('@') || s.includes('?') || s.includes('#')) return null
  let url: URL
  try {
    url = new URL(`https://${s}`)
  } catch {
    return null
  }
  // `new URL` is authoritative about where the host ends. If re-serialising the
  // host does not give back what we were handed (case aside), the string carried
  // something more than a host and we are not going to guess which part matters.
  if (url.host.toLowerCase() !== s.toLowerCase()) return null
  const bare = url.hostname.toLowerCase()
  if (!ALLOWED_REQUEST_HOSTS.includes(bare)) return null
  return url.host.toLowerCase()
}

/**
 * The host this request is allowed to be answered as.
 *
 * Falls back to `CANONICAL_HOST` and warns when the claimed host is refused.
 */
export function publicHost(req: { headers: HeaderBag }): string {
  const forwarded = req.headers.get('x-forwarded-host')
  const direct = req.headers.get('host')
  const claimed = forwarded || direct
  const screened = screenRequestHost(claimed)
  // A DEVELOPMENT host is only ever believed from `Host`, never from
  // `X-Forwarded-Host`.
  //
  // `localhost` is on the allowlist so that `next start` and the deploy
  // script's own smoke test get working links. But the allowlist is also what
  // `isLocalRequest` reads, and several routes use that to decide whether a
  // session cookie gets the `Secure` flag — so honouring a CLAIMED `localhost`
  // would let a caller strip `Secure` off an admin cookie in production just by
  // asking for it. Behind nginx `Host` is always one of the `server_name`s, and
  // in development there is no proxy at all, so this costs nothing and closes
  // the hole. Found by the test for this module, not by reading it.
  if (screened && isLocalHost(screened) && forwarded && screenRequestHost(direct) !== screened) {
    console.warn(`[publicOrigin] refused a forwarded development host; using ${CANONICAL_HOST}`)
    return CANONICAL_HOST
  }
  if (screened) return screened
  if (claimed) {
    // Bounded, because the value is attacker-written and this goes in a log a
    // human reads.
    console.warn(
      `[publicOrigin] refused host header ${JSON.stringify(String(claimed).slice(0, 120))}; using ${CANONICAL_HOST}`
    )
  }
  return CANONICAL_HOST
}

/**
 * Is this request being served from a development host?
 *
 * Read off the SCREENED host, not the raw header — otherwise a caller could
 * claim `localhost` and be handed a cookie without the `Secure` flag, which is
 * what several routes use this for.
 */
export function isLocalRequest(req: { headers: HeaderBag }): boolean {
  return isLocalHost(publicHost(req))
}

/**
 * The absolute origin (`https://host`) to build links and redirects from.
 *
 * This is the value that belongs in an email `href`, in a Stripe `success_url`
 * and in a `NextResponse.redirect` — never the raw header.
 */
export function publicOrigin(req: { headers: HeaderBag }): string {
  const host = publicHost(req)
  if (host === CANONICAL_HOST) return CANONICAL_ORIGIN
  return `${isLocalHost(host) ? 'http' : 'https'}://${host}`
}
