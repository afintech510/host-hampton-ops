import { NextResponse } from 'next/server'
import { clearPortalCookieHeader } from '@/lib/portalAuth'

/**
 * Clears the per-booking portal cookie (hh_portal). Used by the "Start a new
 * plan" button in MyPartiesModal — `document.cookie` can't clear HttpOnly
 * cookies from the client, so we route through the server.
 *
 * Leaves the email-session cookie (hh_portal_email) intact so the customer
 * stays signed in and the My Parties picker still works.
 */
export async function POST() {
  const response = NextResponse.json({ ok: true })
  response.headers.set('Set-Cookie', clearPortalCookieHeader())
  return response
}
