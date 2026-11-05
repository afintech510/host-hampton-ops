/**
 * The page-side gate for `/crew/*` server components (the twin of
 * `requireCrewMember` for route handlers).
 *
 *   app closed (neither CREW_ENABLED nor CREW_TEST_LOGIN) → 404;
 *   no session, or a member who may not enter          → /crew/login;
 *   the board before onboarding is done / while only the onboarding door is
 *     open                                              → /crew/onboarding;
 *   the member could not be read                        → 'unavailable', which
 *     the page renders as "try again" rather than signing anybody out.
 */

import { notFound, redirect } from 'next/navigation'
import { crewAccessDenied, currentCrewMember } from '@/lib/crew/auth'
import { crewAppOpen, type CrewScope } from '@/lib/crew/settings'
import type { CrewMemberRow } from '@/lib/crew/db'

export async function requireCrewPage(want: CrewScope = 'app'): Promise<CrewMemberRow | 'unavailable'> {
  if (!crewAppOpen()) notFound()
  const s = await currentCrewMember()
  if (s.kind === 'none') redirect('/crew/login')
  if (s.kind === 'unavailable') {
    console.error('crew page: member read failed:', s.error)
    return 'unavailable'
  }
  // The board is behind onboarding: until the profile and agreement are done
  // (or while only the onboarding door is open) every other page goes there.
  if (crewAccessDenied(s, want)) redirect('/crew/onboarding')
  return s.member
}
