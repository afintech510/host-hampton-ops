import { redirect } from 'next/navigation'
import { requireCrewPage } from '@/lib/crew/page'
import { CrewUnavailable } from '../_components/CrewTop'

export const dynamic = 'force-dynamic'

/** `/crew/skills` moved onto the Profile tab; an old link or bookmark lands there. */
export default async function CrewSkillsPage() {
  const member = await requireCrewPage()
  if (member === 'unavailable') return <CrewUnavailable />
  redirect('/crew/profile#skills')
}
