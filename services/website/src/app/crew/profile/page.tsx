import { TENANT } from '@/tenant'
import { requireCrewPage } from '@/lib/crew/page'
import { CrewUnavailable } from '../_components/CrewTop'
import ActionButton from '../_components/ActionButton'
import ProfileForm from '../_components/ProfileForm'

export const dynamic = 'force-dynamic'

/**
 * `/crew/profile`: a member edits their own address, emergency contact and
 * preferred name. Legal name and birthday are what the signed agreement names,
 * so they are shown, not editable, once it is signed (the API enforces it).
 */
export default async function CrewProfilePage() {
  const member = await requireCrewPage('onboarding')
  if (member === 'unavailable') return <CrewUnavailable />

  return (
    <main className="crew-wrap">
      <div className="crew-top">
        <span className="crew-brand">{TENANT.business.name} Crew</span>
        <span className="crew-row crew-small">
          <a className="crew-link" href="/crew/onboarding">Back</a>
          <ActionButton endpoint="/api/crew/auth/logout" label="Sign out" variant="ghost" redirectTo="/crew/login" />
        </span>
      </div>
      <h1>My details</h1>
      <ProfileForm ownerName={TENANT.people.customerSignoff} />
    </main>
  )
}
