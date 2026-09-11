/**
 * Admin authentication — shared password (unchanged) + per-person sessions.
 *
 * Plan §11.1. This file used to be ten lines: one Bearer header compared to
 * `ADMIN_PASSWORD`. That is still here and still works, because ~56 admin API
 * routes call `isAdminAuthorized(req)` and because the shared password is the
 * guard against this change locking Adam out of the panel he runs the business
 * from. What is ADDED is a signed session cookie carrying a real identity, so:
 *
 *   * `marketing_ledger` can record WHO approved a message to a customer
 *     (`admin:allie@…`) instead of the anonymous `'ADMIN'`;
 *   * a SERVER COMPONENT can recognise an admin — which is what unblocks
 *     `/plan/[ref]/summary`, whose header comment has been waiting for exactly
 *     this. A Bearer header in localStorage is invisible to a server render.
 *
 * ── The guardrail this file is closest to ────────────────────────────────
 *
 * `approved` and `sent` are GATED edges in lib/marketing/graph.ts, reachable
 * only with `actor.isAdmin: true`. This change alters what "an authenticated
 * admin" means, so the rule it must not break: **an authenticated identity
 * must not widen who can set `isAdmin`.** It does not. There are exactly two
 * ways to pass `isAdminAuthorized` — the shared password, which already
 * granted full admin, or a session cookie signed by this server, which is only
 * ever minted by /api/admin/auth/login after verifying a password. The session
 * adds a NAME to an admin; it does not add an admin.
 *
 * `/review/[token]` is untouched by all of this and stays read-only: a preview
 * token is not a credential and mints no cookie.
 *
 * ── Cookie shape ─────────────────────────────────────────────────────────
 *
 * The HMAC pattern is lib/portalAuth.ts's, deliberately reused rather than a
 * session library added. Value is `<email>:<issuedAtMs>:<sig>` where sig is
 * HMAC-SHA256 over `adminsession:<email>:<issuedAtMs>`. The `adminsession:`
 * prefix is load-bearing: it means a portal cookie's signature can never be
 * replayed as an admin cookie even though they may share a secret.
 *
 * Expiry is INSIDE the signed payload, not just in Max-Age, because Max-Age is
 * a client-side hint a client can ignore. Verification is pure HMAC + a clock
 * read, so it stays synchronous and `isAdminAuthorized` keeps its signature.
 *
 * The cost of that: deactivating a user in `admin_users` does not kill a live
 * cookie, it only stops the next login — so the TTL is the revocation window,
 * which is why it is 7 days and not 30 like the customer portal.
 */

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

const COOKIE_NAME = 'hh_admin'
/** Session lifetime. Also the revocation window — see the header. */
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000

/**
 * Dedicated secret, falling back to the portal's — the same precedent
 * `REVIEW_LINK_SIGNING_SECRET` already sets, so this ships without a new env
 * var having to reach a running container to work.
 */
export function adminSessionSecret(): string {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    process.env.PORTAL_LINK_SIGNING_SECRET ||
    'dev-secret'
  )
}

/* ── Password hashing ──────────────────────────────────────────────────── */

// scrypt is Node's built-in KDF: a real memory-hard KDF, no new dependency and
// no native module in the Docker build. N=16384 is the Node default work
// factor; it is recorded in the string so it can be raised later without
// invalidating existing hashes.
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 64

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16)
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!N || !r || !p) return false

  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(parts[4], 'hex')
    expected = Buffer.from(parts[5], 'hex')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length === 0) return false

  let derived: Buffer
  try {
    derived = crypto.scryptSync(password, salt, expected.length, { N, r, p })
  } catch {
    // Absurd stored parameters (an N that blows the memory limit) are a
    // corrupt row, not a valid login.
    return false
  }

  try {
    return crypto.timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

/* ── Session cookie ────────────────────────────────────────────────────── */

function signSession(email: string, issuedAtMs: number, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`adminsession:${email}:${issuedAtMs}`)
    .digest('hex')
}

export function buildAdminCookieValue(email: string, secret: string, issuedAtMs = Date.now()): string {
  const normalized = email.toLowerCase()
  const sig = signSession(normalized, issuedAtMs, secret)
  return `${encodeURIComponent(normalized)}:${issuedAtMs}:${sig}`
}

export function setAdminCookieHeader(email: string, secret: string, isInsecure = false): string {
  const value = buildAdminCookieValue(email, secret)
  const secureFlag = isInsecure ? '' : '; Secure'
  // SameSite=Lax is what keeps a cookie-authorized mutation from being
  // CSRF-able: it is not sent on a cross-site POST. See requireSameSite below
  // for the belt-and-braces half of that.
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secureFlag}`
}

export function clearAdminCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`
}

/**
 * The email of the admin this cookie names, or null. Pure HMAC + clock, so it
 * is safe in a server component (`cookies().toString()`) and in a route.
 */
export function getAdminEmailFromCookie(cookieHeader: string | null, secret: string): string | null {
  if (!cookieHeader) return null

  const cookies = cookieHeader.split(';').map(c => c.trim())
  const target = cookies.find(c => c.startsWith(`${COOKIE_NAME}=`))
  if (!target) return null

  const value = target.slice(COOKIE_NAME.length + 1)
  const parts = value.split(':')
  if (parts.length !== 3) return null

  let email = parts[0]
  const issuedAtMs = Number(parts[1])
  const sig = parts[2]
  try {
    email = decodeURIComponent(email)
  } catch {
    return null
  }
  email = email.toLowerCase()
  if (!email || !Number.isFinite(issuedAtMs)) return null

  // Expiry lives in the signed payload, so a client cannot extend it by
  // keeping the cookie past Max-Age. A future-dated issuedAt is a forgery
  // attempt or a badly skewed clock; either way it is not a session.
  const age = Date.now() - issuedAtMs
  if (age < 0 || age > SESSION_MAX_AGE_MS) return null

  const expected = signSession(email, issuedAtMs, secret)
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  } catch {
    return null
  }

  return email
}

/* ── Request authorization ─────────────────────────────────────────────── */

function hasSharedPasswordBearer(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  const expected = process.env.ADMIN_PASSWORD
  // An unset ADMIN_PASSWORD must not make `Bearer undefined` a valid login.
  if (!expected) return false
  return auth === `Bearer ${expected}`
}

/**
 * A cookie authorizes a mutation, which a Bearer header never did, so it
 * inherits CSRF as a concern the header path did not have. SameSite=Lax is the
 * real defence; this is the cheap second lock, and it is worth having on a gate
 * whose downstream effect is "message a customer".
 */
function isSameSiteRequest(req: NextRequest): boolean {
  const fetchSite = req.headers.get('sec-fetch-site')
  if (fetchSite) return fetchSite === 'same-origin' || fetchSite === 'none'
  // Older clients send no Sec-Fetch-Site. Fall back to Origin, and treat an
  // absent Origin as same-site (it is absent on same-origin GETs).
  const origin = req.headers.get('origin')
  if (!origin) return true
  const host = req.headers.get('host')
  if (!host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** The authenticated admin's email, or null if they came in on the shared password. */
export function getAdminEmail(req: NextRequest): string | null {
  if (!isSameSiteRequest(req)) return null
  return getAdminEmailFromCookie(req.headers.get('cookie'), adminSessionSecret())
}

/**
 * Unchanged signature, unchanged meaning: "is this request an authenticated
 * admin". It is now true for the shared Bearer password OR a valid session
 * cookie. Both are proofs of an admin credential — see the header on why this
 * does not widen who can set `isAdmin`.
 */
export function isAdminAuthorized(req: NextRequest): boolean {
  if (hasSharedPasswordBearer(req)) return true
  return getAdminEmail(req) !== null
}

/**
 * The ledger actor for this request: `admin:<email>` when we know who it is,
 * and the historical anonymous `'ADMIN'` when they used the shared password.
 * Callers still set `isAdmin` themselves — this function only names the human.
 */
export function adminActorId(req: NextRequest): string {
  const email = getAdminEmail(req)
  return email ? `admin:${email}` : 'ADMIN'
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
