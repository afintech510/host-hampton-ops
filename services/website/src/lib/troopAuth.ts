/**
 * Who may use the troop board's Leaders tab.
 *
 * The `lib/cmCheerAuth.ts` shape: one shared password the troop's leaders hold
 * (`TROOP_LEADER_PASSWORD`, sent as a Bearer token from the page and kept in
 * sessionStorage for the tab only), plus Host Hampton's own admin credential, so
 * Allie or Adam signed in to /admin see the Leaders tab without typing anything.
 *
 * A troop co-leader is NOT a Host Hampton admin and must never become one — the
 * admin login reads every customer's booking. That is why this is a second
 * credential rather than an `admin_users` row.
 *
 * FAILS CLOSED when the variable is unset: an unconfigured door opens for nobody
 * but an HH admin.
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { isAdminAuthorized } from '@/lib/adminAuth'

export function isTroopLeaderAuthorized(req: NextRequest): boolean {
  if (isAdminAuthorized(req)) return true

  const expected = process.env.TROOP_LEADER_PASSWORD
  if (!expected) return false

  const auth = req.headers.get('authorization')
  if (!auth || !auth.startsWith('Bearer ')) return false
  const given = Buffer.from(auth.slice('Bearer '.length))
  const want = Buffer.from(expected)
  return given.length === want.length && timingSafeEqual(given, want)
}

export function troopLeaderUnauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
