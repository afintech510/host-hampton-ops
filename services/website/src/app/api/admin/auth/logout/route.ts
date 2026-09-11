/**
 * `POST /api/admin/auth/logout` — clear the `hh_admin` session cookie.
 *
 * Unauthenticated on purpose: "forget me" must always work, even from a
 * session that has already expired or been deactivated.
 */

import { NextResponse } from 'next/server'
import { clearAdminCookieHeader } from '@/lib/adminAuth'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.headers.set('Set-Cookie', clearAdminCookieHeader())
  return res
}
