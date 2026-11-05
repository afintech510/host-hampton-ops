import { getSupabase } from '@/lib/supabase'
import { requireCrewPage } from '@/lib/crew/page'
import { loadCrewSettings } from '@/lib/crew/settings'
import { getMyPeriods } from '@/lib/crew/db'
import { localParts } from '@/lib/crew/rules'
import CrewTop, { CrewUnavailable } from '../_components/CrewTop'
import AvailabilityEditor, { type PeriodItem } from '../_components/AvailabilityEditor'

export const dynamic = 'force-dynamic'

const monthOnly = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' })
const when = new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
})

/** `YYYY-MM` plus n months. */
function addMonths(ym: string, n: number): string {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1 + n
  return new Date(Date.UTC(y, m, 1, 12)).toISOString().slice(0, 7)
}

const monthName = (ym: string) => monthOnly.format(new Date(`${ym}-01T12:00:00Z`))

/**
 * `/crew/availability` (spec §3.8): add a start and an end for a time you
 * can't work, and see the ones you have. Parties you are working can't be
 * blocked; the server refuses it.
 */
export default async function CrewAvailabilityPage() {
  const member = await requireCrewPage()
  if (member === 'unavailable') return <CrewUnavailable />

  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return <CrewUnavailable />
  const now = new Date()
  const periods = await getMyPeriods(sb, member.id, now)
  if (periods.kind !== 'ok') return <CrewUnavailable />

  const items: PeriodItem[] = periods.data.map(p => ({
    id: p.id,
    label: `${when.format(p.startsAt)} to ${when.format(p.endsAt)}`,
  }))

  // The earliest a person can pick, as Eastern wall-clock for a datetime-local input.
  const here = localParts(now)
  const minLocal = `${here.dateKey}T${String(Math.floor(here.minutes / 60)).padStart(2, '0')}:${String(here.minutes % 60).padStart(2, '0')}`

  // Next month's availability is due on the due day of THIS month; once that
  // has passed, the month after next is due on the due day of next month.
  const { dueDayOfMonth } = settings.settings.availability
  const firstMonth = here.dateKey.slice(0, 7)
  const dayNum = Number(here.dateKey.slice(8, 10))
  const dueFor = dayNum <= dueDayOfMonth ? addMonths(firstMonth, 1) : addMonths(firstMonth, 2)
  const dueIn = dayNum <= dueDayOfMonth ? firstMonth : addMonths(firstMonth, 1)
  const dueLabel = `${monthName(dueIn)} ${dueDayOfMonth}`

  return (
    <main className="crew-wrap">
      <CrewTop firstName={member.first_name} isTest={member.is_test} />
      <h1>Availability</h1>
      <div className="crew-note crew-info">
        Please add the times you can&apos;t work in <strong>{monthName(dueFor)}</strong> by <strong>{dueLabel}</strong>.
      </div>
      <AvailabilityEditor periods={items} minLocal={minLocal} />
      <p className="crew-muted crew-small">Already on a party then? Use Can&apos;t make it on that party instead.</p>
    </main>
  )
}
