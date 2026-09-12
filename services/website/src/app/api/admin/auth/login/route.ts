/**
 * `POST /api/admin/auth/login` — per-person admin sign-in (plan §11.1).
 *
 * Body: `{ email, password, sharedPassword? }`. On success it sets the
 * `hh_admin` session cookie and returns the display name.
 *
 * ── Claiming an account ──────────────────────────────────────────────────
 *
 * Migration 038 seeds rows UNCLAIMED (`password_hash IS NULL`) because a
 * password hash committed to the repo is a credential in git history. First
 * sign-in sets the hash, and it REQUIRES the shared `ADMIN_PASSWORD` as proof —
 * /admin is a public URL, so without that anyone who could guess `allie@…`
 * would be able to claim her account before she does. Requiring the shared
 * password means claiming widens nobody's access: whoever can do it could
 * already sign in as the shared admin.
 *
 * ── Why the 401 never says which case it was ─────────────────────────────
 *
 * `needsClaim` comes back on EVERY failure, not only for a real unclaimed row.
 * If it were accurate it would be an admin-email enumeration oracle against a
 * public endpoint. Being uniformly vague costs the UI nothing — it just always
 * offers the "first time signing in?" field — and tells an attacker nothing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isLocalRequest } from '@/lib/publicOrigin'
import {
  adminSessionSecret,
  hashPassword,
  setAdminCookieHeader,
  verifyPassword,
} from '@/lib/adminAuth'

/** A personal password shorter than this is not worth the table it sits in. */
const MIN_PASSWORD_LENGTH = 10

/**
 * Throttle. In-memory and per-container, which is the right size for a
 * two-person panel on a single box — it is a brute-force speed bump, not a
 * distributed rate limiter, and it must never be the thing that locks Adam out,
 * so the window is short and the failure is a 429 he can wait out.
 */
const MAX_ATTEMPTS = 10
const WINDOW_MS = 10 * 60 * 1000
const attempts = new Map<string, { count: number; firstAt: number }>()

function throttleKey(req: NextRequest, email: string): string {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  return `${ip}:${email}`
}

function isThrottled(key: string): boolean {
  const entry = attempts.get(key)
  if (!entry) return false
  if (Date.now() - entry.firstAt > WINDOW_MS) {
    attempts.delete(key)
    return false
  }
  return entry.count >= MAX_ATTEMPTS
}

function recordFailure(key: string): void {
  const entry = attempts.get(key)
  if (!entry || Date.now() - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: Date.now() })
    return
  }
  entry.count += 1
}

function failed() {
  return NextResponse.json(
    { error: 'Invalid email or password', needsClaim: true },
    { status: 401 },
  )
}

export async function POST(req: NextRequest) {
  let body: { email?: unknown; password?: unknown; sharedPassword?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const sharedPassword = typeof body.sharedPassword === 'string' ? body.sharedPassword : ''

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
  }

  const key = throttleKey(req, email)
  if (isThrottled(key)) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again in a few minutes.' },
      { status: 429 },
    )
  }

  const supabase = getSupabase()
  const { data: user } = await supabase
    .from('admin_users')
    .select('id, email, password_hash, display_name, is_active')
    .eq('email', email)
    .eq('is_active', true)
    .maybeSingle()

  if (!user) {
    recordFailure(key)
    return failed()
  }

  let claimed = false

  if (user.password_hash) {
    if (!verifyPassword(password, user.password_hash)) {
      recordFailure(key)
      return failed()
    }
  } else {
    // Unclaimed row: the shared password is the proof of authorization.
    const shared = process.env.ADMIN_PASSWORD
    if (!shared || sharedPassword !== shared) {
      recordFailure(key)
      return failed()
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`, needsClaim: true },
        { status: 400 },
      )
    }
    const { error: claimErr } = await supabase
      .from('admin_users')
      // Guarded on the hash still being NULL so two simultaneous claims cannot
      // have the loser silently overwrite the winner's password.
      .update({ password_hash: hashPassword(password) })
      .eq('id', user.id)
      .is('password_hash', null)
    if (claimErr) {
      return NextResponse.json({ error: 'Could not complete sign-in' }, { status: 500 })
    }
    claimed = true
  }

  attempts.delete(key)

  // Audit breadcrumb: how you notice a claimed account being used by someone
  // who should not have it. A failure here must not fail the login.
  await supabase
    .from('admin_users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', user.id)

  const isLocal = isLocalRequest(req)

  const res = NextResponse.json({
    ok: true,
    email: user.email,
    displayName: user.display_name,
    claimed,
  })
  res.headers.set('Set-Cookie', setAdminCookieHeader(user.email, adminSessionSecret(), isLocal))
  return res
}
