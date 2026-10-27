/**
 * The page-side gate for `/crew/*` server components (the twin of
 * `requireCrewMember` for route handlers).
 *
 *   app closed (neither CREW_ENABLED nor CREW_TEST_LOGIN) → 404;
 *   no session, or a member who may not enter          → /crew/login;
 *   the member could not be read                        → 'unavailable', which
 *     the page renders as "try again" rather than signing anybody out.
 */

import { notFound, redirect } from 'next/navigation'
import { currentCrewMember } from '@/lib/crew/auth'
import { crewAppOpen } from '@/lib/crew/settings'
import type { CrewMemberRow } from '@/lib/crew/db'

export async function requireCrewPage(): Promise<CrewMemberRow | 'unavailable'> {
  if (!crewAppOpen()) notFound()
  const s = await currentCrewMember()
  if (s.kind === 'none') redirect('/crew/login')
  if (s.kind === 'unavailable') {
    console.error('crew page: member read failed:', s.error)
    return 'unavailable'
  }
  return s.member
}
