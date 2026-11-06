import { getSupabase } from '@/lib/supabase'
import { requireCrewPage } from '@/lib/crew/page'
import { getMyPeriods } from '@/lib/crew/db'
import { etDateString } from '@/lib/partyTime'
import CrewTop, { CrewUnavailable } from '../_components/CrewTop'
import AvailabilityEditor, { type PeriodItem } from '../_components/AvailabilityEditor'

export const dynamic = 'force-dynamic'

const when = new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
})

/**
 * `/crew/availability` (spec §3.8): add a start and an end for a time you
 * can't work, and see the ones you have. Parties you are working can't be
 * blocked; the server refuses it.
 */
export default async function CrewAvailabilityPage() {
  const member = await requireCrewPage()
  if (member === 'unavailable') return <CrewUnavailable />

  const now = new Date()
  const periods = await getMyPeriods(getSupabase(), member.id, now)
  if (periods.kind !== 'ok') return <CrewUnavailable />

  const items: PeriodItem[] = periods.data.map(p => ({
    id: p.id,
    label: `${when.format(p.startsAt)} to ${when.format(p.endsAt)}`,
  }))

  return (
    <main className="crew-wrap">
      <CrewTop firstName={member.first_name} isTest={member.is_test} />
      <h1>Availability</h1>
      <AvailabilityEditor periods={items} minDate={etDateString(now)} />
    </main>
  )
}
