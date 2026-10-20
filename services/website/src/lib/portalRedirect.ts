/**
 * Where a portal sign-in may send the customer afterwards - ONE allow-list.
 *
 * Two doors use it, and they must never disagree:
 *   - `/api/portal/auth?...&redirect=<path>`  (the magic link) picks the landing page;
 *   - `/my-booking/login?next=<path>` carries the wish through the "email me a link"
 *     round trip: the login page posts it to `/api/portal/resend-link`, which puts it
 *     on the link it mails, and `/api/portal/auth` then checks it AGAIN.
 *
 * The rule is an EXACT match against a short list of paths. Deliberately:
 *   - no query string and no fragment (`/my-booking/invitation?x=1` is refused): the
 *     list is paths this site owns, and a query string is where an attacker's
 *     parameter would ride in;
 *   - nothing that merely STARTS with an allowed path (`/my-booking/../admin`,
 *     `/my-booking@evil.com`, `/my-booking.evil.com`);
 *   - nothing that is not a string beginning with a single `/`: `//evil.com`,
 *     `/\evil.com`, `https://evil.com`, `javascript:` and the empty string are all null.
 * A refusal is `null`, and every caller falls back to its own default rather than to
 * the raw value. Pure and import-free, so the login page (a client component) can use it.
 *
 * The `/plan/<ref>/summary` landing is the one dynamic entry. It is only ever valid for
 * the ref a request has JUST authenticated, so it needs `authenticatedRef`; the login
 * page, which does not know a ref yet, never gets it.
 */

export const PORTAL_REDIRECT_PATHS: readonly string[] = [
  '/my-booking',
  '/my-booking/invitation',
  '/party-builder',
  '/party-planner',
  // The studio-rental planner: in manage mode for a studio booking's portal cookie.
  // Missing until 2026-10-20, so no sign-in link could land a renter there and every
  // "planner" link a studio customer got opened the PARTY planner instead.
  '/studio-rental',
]

/**
 * Where a signed-in customer lands when the link names no page: the studio-rental
 * planner for a studio booking, the party planner for everything else.
 *
 * `/studio-rental` opens in manage mode only for `event_type = 'studio-rental'` (see
 * its page), so that is the test — an older `room-rental` row would land on a blank
 * new-booking form, which is worse than the party planner.
 */
export function defaultPortalLanding(booking: { event_type?: string | null } | null | undefined): string {
  return booking?.event_type === 'studio-rental' ? '/studio-rental' : '/party-planner'
}

/** The redirect if it is allowed, else null. */
export function safePortalRedirect(raw: unknown, authenticatedRef?: string): string | null {
  if (typeof raw !== 'string' || raw === '') return null
  if (PORTAL_REDIRECT_PATHS.includes(raw)) return raw
  if (authenticatedRef && raw === `/plan/${authenticatedRef}/summary`) return raw
  return null
}
