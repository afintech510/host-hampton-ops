import { notFound } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'
import { requireCrewPage } from '@/lib/crew/page'
import { loadBookingViewer } from '@/lib/crew/bookingView'
import CrewTop, { CrewUnavailable } from '../_components/CrewTop'
import ScheduleView from '../_components/ScheduleView'

export const dynamic = 'force-dynamic'

/** `/crew/schedule`: the next six weeks of crew parties and who is on each, read only (migration 100). 404 for anyone who has not been given the view. */
export default async function CrewSchedulePage() {
  const member = await requireCrewPage()
  if (member === 'unavailable') return <CrewUnavailable />
  const v = await loadBookingViewer(getSupabase(), member.id)
  if (v.kind !== 'ok') return <CrewUnavailable />
  if (!v.data) notFound()
  return (
    <main className="crew-wrap">
      <CrewTop firstName={member.first_name} isTest={member.is_test} />
      <h1>Schedule</h1>
      <ScheduleView />
    </main>
  )
}
