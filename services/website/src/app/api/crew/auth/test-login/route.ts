import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { portalSigningSecret } from '@/lib/portalAuth'
import { isLocalRequest } from '@/lib/publicOrigin'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { crewTestLoginEnabled } from '@/lib/crew/settings'
import { isUuid, setCrewCookieHeader } from '@/lib/crew/auth'
import { getMember } from '@/lib/crew/db'

export const dynamic = 'force-dynamic'

/**
 * The password-free test picker: click a crew member, become them. Adam asked
 * for it to click through the app (2026-10-26).
 *
 * The site is public, so this must never be a way to become a REAL crew member:
 *
 *   - it does not exist (404) unless CREW_TEST_LOGIN is exactly `true`;
 *   - it re-reads the member and refuses (403) anything but an ACTIVE, `is_test`,
 *     non-owner row — the id in the body is a request, never a credential;
 *   - it is rate-limited;
 *   - it sets the same signed `hh_crew` cookie as the real login, which
 *     `requireCrewMember` re-judges on every request, so switching the flag off
 *     ends these sessions on their next click.
 */
export async function POST(req: NextRequest) {
  if (!crewTestLoginEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const limited = guardRate(req, plannerRule('crew/auth/test-login'))
  if (limited) return limited

  try {
    const body = await req.json().catch(() => ({}))
    const memberId = body?.memberId
    if (!isUuid(memberId)) return NextResponse.json({ error: 'Pick a crew member.' }, { status: 400 })

    const read = await getMember(getSupabase(), memberId)
    if (read.kind !== 'ok') {
      console.error('crew/auth/test-login: member read failed:', read.error)
      return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })
    }
    const m = read.data
    if (!m || m.is_test !== true || m.status !== 'active' || m.is_owner) {
      return NextResponse.json({ error: 'Only test crew members can be picked here.' }, { status: 403 })
    }

    const res = NextResponse.json({ ok: true })
    res.headers.set('Set-Cookie', setCrewCookieHeader(m.id, portalSigningSecret(), isLocalRequest(req)))
    return res
  } catch (err: unknown) {
    console.error('crew/auth/test-login error:', err instanceof Error ? err.message : 'failed')
    return NextResponse.json({ error: 'Sign-in is unavailable right now. Try again.' }, { status: 500 })
  }
}
