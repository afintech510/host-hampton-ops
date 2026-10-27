import { requireCrewPage } from '@/lib/crew/page'
import { CREW_SKILLS, MAX_EXTRAS, MAX_EXTRA_LENGTH, splitSkills } from '@/lib/crew/skills'
import CrewTop, { CrewUnavailable } from '../_components/CrewTop'
import SkillsForm from '../_components/SkillsForm'

export const dynamic = 'force-dynamic'

/** `/crew/skills`: self-reported, informational only. */
export default async function CrewSkillsPage() {
  const member = await requireCrewPage()
  if (member === 'unavailable') return <CrewUnavailable />
  const { picked, extras } = splitSkills(Array.isArray(member.skills) ? member.skills : [])

  return (
    <main className="crew-wrap">
      <CrewTop firstName={member.first_name} isTest={member.is_test} />
      <h1>My skills</h1>
      <p className="crew-muted" style={{ marginTop: 0 }}>This helps Allie plan each party. It doesn&apos;t change your pay.</p>
      <SkillsForm options={CREW_SKILLS} picked={picked} extras={extras} maxExtras={MAX_EXTRAS} maxLength={MAX_EXTRA_LENGTH} />
    </main>
  )
}
