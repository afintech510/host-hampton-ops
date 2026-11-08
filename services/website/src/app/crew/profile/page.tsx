import { TENANT } from '@/tenant'
import { requireCrewPage } from '@/lib/crew/page'
import { currentCrewMember } from '@/lib/crew/auth'
import { CREW_SKILLS, MAX_EXTRAS, MAX_EXTRA_LENGTH, splitSkills } from '@/lib/crew/skills'
import CrewTop, { CrewUnavailable } from '../_components/CrewTop'
import ActionButton from '../_components/ActionButton'
import CrewBrand from '../_components/CrewBrand'
import ProfileForm from '../_components/ProfileForm'
import EmailChange from '../_components/EmailChange'
import SkillsForm from '../_components/SkillsForm'

export const dynamic = 'force-dynamic'

/** `+16314008080` as `(631) 400-8080`; anything else as stored. */
function phoneLabel(e164: string | null): string | null {
  const m = e164 ? /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164) : null
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164
}

/**
 * `/crew/profile`: the third tab. A member's own name, address, emergency
 * contact, email and phone, and the skills Allie plans with. Legal name and
 * birthday are what the signed agreement names, so they are shown, not
 * editable, once it is signed (the API enforces it). Open to a member who is
 * still onboarding, with the onboarding header instead of the tabs.
 */
export default async function CrewProfilePage() {
  const member = await requireCrewPage('onboarding')
  if (member === 'unavailable') return <CrewUnavailable />

  const session = await currentCrewMember()
  const onboarding = session.kind === 'ok' && session.onboarding.incomplete
  const { picked, extras } = splitSkills(Array.isArray(member.skills) ? member.skills : [])
  const owner = TENANT.people.customerSignoff

  return (
    <main className="crew-wrap">
      {onboarding ? (
        <div className="crew-top">
          <CrewBrand />
          <span className="crew-who crew-small">
            <a className="crew-link" href="/crew/onboarding">Back</a>
          </span>
        </div>
      ) : (
        <CrewTop firstName={member.first_name} isTest={member.is_test} />
      )}
      {/* Sign out lives here, on the heading's line, at the right. */}
      <div className="crew-title-row">
        <h1>Profile</h1>
        <ActionButton endpoint="/api/crew/auth/logout" label="Sign out" variant="ghost" redirectTo="/crew/login" />
      </div>

      <h2>My details</h2>
      <ProfileForm ownerName={owner} />

      <h2>Contact</h2>
      <EmailChange email={member.email} phone={phoneLabel(member.phone)} ownerName={owner} />

      <h2 id="skills">My skills</h2>
      <p className="crew-muted" style={{ marginTop: 0 }}>This helps {owner} plan each party.</p>
      <SkillsForm options={CREW_SKILLS} picked={picked} extras={extras} maxExtras={MAX_EXTRAS} maxLength={MAX_EXTRA_LENGTH} />

    </main>
  )
}
