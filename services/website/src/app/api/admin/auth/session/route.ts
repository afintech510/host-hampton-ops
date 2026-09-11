/**
 * `GET /api/admin/auth/session` — who is signed in, if anyone.
 *
 * The admin UI is a client component, and the session is HttpOnly (so that a
 * stray XSS cannot read it the way it could read the old localStorage token).
 * That means the page cannot see its own cookie and has to ask.
 *
 * Returns `{ authenticated, email, displayName }`. `email` is null for the
 * shared-password path, which has no identity by definition.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { getAdminEmail } from '@/lib/adminAuth'

export async function GET(req: NextRequest) {
  const email = getAdminEmail(req)
  if (!email) {
    return NextResponse.json({ authenticated: false, email: null, displayName: null })
  }

  // Confirm against the table so a DEACTIVATED user loses the panel on their
  // next page load rather than at the end of the cookie's 7-day life. The
  // synchronous cookie check in adminAuth.ts cannot do this; here we can.
  const supabase = getSupabase()
  const { data: user } = await supabase
    .from('admin_users')
    .select('email, display_name')
    .eq('email', email)
    .eq('is_active', true)
    .maybeSingle()

  if (!user) {
    return NextResponse.json({ authenticated: false, email: null, displayName: null })
  }

  return NextResponse.json({
    authenticated: true,
    email: user.email,
    displayName: user.display_name,
  })
}
