import { TENANT } from '@/tenant'
import { requireCrewPage } from '@/lib/crew/page'
import { crewMemberMayEnter } from '@/lib/crew/settings'
import { CrewUnavailable } from '../_components/CrewTop'
import ActionButton from '../_components/ActionButton'
import CrewBrand from '../_components/CrewBrand'
import OnboardingFlow from '../_components/OnboardingFlow'

export const dynamic = 'force-dynamic'

/**
 * `/crew/onboarding`: the steps a new crew member finishes before the board
 * opens for them — details, a confirmed email, the text choice, and the
 * subcontractor agreement. Reachable with only CREW_ONBOARDING_ENABLED on.
 */
export default async function CrewOnboardingPage() {
  const member = await requireCrewPage('onboarding')
  if (member === 'unavailable') return <CrewUnavailable />

  return (
    <main className="crew-wrap">
      <div className="crew-top">
        <CrewBrand />
        <span className="crew-who crew-small">
          {member.is_test && <span className="crew-chip crew-gold">Test</span>}
          <span className="crew-muted crew-who-name">{member.first_name}</span>
          <ActionButton endpoint="/api/crew/auth/logout" label="Sign out" variant="ghost" redirectTo="/crew/login" />
        </span>
      </div>
      <h1>Set up your account</h1>
      <OnboardingFlow boardOpen={crewMemberMayEnter(member, 'app')} businessName={TENANT.business.name} ownerName={TENANT.people.customerSignoff} />
    </main>
  )
}
