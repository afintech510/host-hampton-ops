/**
 * Who is allowed to see — and now to PAY — one plan.
 *
 * This used to be six inlined lines at the bottom of
 * `app/plan/[ref]/summary/page.tsx`. It is extracted because Phase 5 items 2-4
 * add API routes that must make the *same* decision, and a second copy of an
 * access rule is a second place for it to drift. That is not hypothetical here:
 * the rule the pay path depends on is "a portal session for another booking is
 * not a session for this one", and if the page enforced it while
 * `/api/plan/[ref]/pay-link` did not, anyone with any portal cookie could mint
 * a pay link against anyone else's plan.
 *
 * ── The asymmetry, which is deliberate ─────────────────────────────────────
 *
 *   * The CUSTOMER's `hh_portal` cookie names one ref and authorizes that ref
 *     only.
 *   * An ADMIN's `hh_admin` cookie (migration 038) is not scoped to a ref,
 *     because an admin is entitled to every plan.
 *
 * Both are pure HMAC + a clock read, so this is safe in a server component and
 * in a route handler and adds no query to either.
 *
 * The shared admin password is deliberately NOT accepted here. It arrives as a
 * Bearer header, which a browser never sends on a page navigation, so honouring
 * it would only ever matter to a script — and this file's job is to answer "is
 * the human in front of this plan entitled to it". Routes that also want to
 * accept the shared password call `isAdminAuthorized(req)` alongside this.
 */

import { getPortalBookingRef } from '@/lib/portalAuth'
import { adminSessionSecret, getAdminEmailFromCookie } from '@/lib/adminAuth'

export type PlanAccess =
  | { ok: true; isAdmin: boolean; adminEmail: string | null }
  | { ok: false; reason: 'no-secret' | 'denied' }

/**
 * `cookieHeader` is `cookies().toString()`-shaped in a server component and
 * `req.headers.get('cookie')` in a route. `ref` is the plan being asked for.
 */
export function planAccess(cookieHeader: string | null, ref: string): PlanAccess {
  const secret = process.env.PORTAL_LINK_SIGNING_SECRET
  // No portal secret means no portal cookie can be verified. Failing closed is
  // the only safe answer on a path that leads to a card charge.
  if (!secret) return { ok: false, reason: 'no-secret' }

  const adminEmail = getAdminEmailFromCookie(cookieHeader, adminSessionSecret())
  if (adminEmail) return { ok: true, isAdmin: true, adminEmail }

  const authedRef = getPortalBookingRef(cookieHeader, secret)
  if (authedRef && authedRef === ref) return { ok: true, isAdmin: false, adminEmail: null }

  return { ok: false, reason: 'denied' }
}
