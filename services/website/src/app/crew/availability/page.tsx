import { getSupabase } from '@/lib/supabase'
import { requireCrewPage } from '@/lib/crew/page'
import { loadCrewSettings } from '@/lib/crew/settings'
import { getAvailability } from '@/lib/crew/db'
import { myLiveWindows } from '@/lib/crew/board'
import { localParts, type DayPart } from '@/lib/crew/rules'
import { etDateString } from '@/lib/partyTime'
import CrewTop, { CrewUnavailable } from '../_components/CrewTop'
import AvailabilityEditor, { type CalMonth } from '../_components/AvailabilityEditor'

export const dynamic = 'force-dynamic'

const MONTHS_SHOWN = 3
const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const monthOnly = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' })

/** `YYYY-MM` plus n months. */
function addMonths(ym: string, n: number): string {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1 + n
  const d = new Date(Date.UTC(y, m, 1, 12))
  return d.toISOString().slice(0, 7)
}

const daysIn = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0, 12)).getUTCDate()
const monthLabel = (ym: string) => monthFmt.format(new Date(`${ym}-01T12:00:00Z`))
const monthName = (ym: string) => monthOnly.format(new Date(`${ym}-01T12:00:00Z`))

/**
 * `/crew/availability` (spec §3.8): this month and the next two, weekly blocks,
 * and when next month's availability is due. Days you are working are shown
 * and cannot be blocked.
 */
export default async function CrewAvailabilityPage() {
  const member = await requireCrewPage()
  if (member === 'unavailable') return <CrewUnavailable />

  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return <CrewUnavailable />
  const today = etDateString(new Date())
  const firstMonth = today.slice(0, 7)
  const lastMonth = addMonths(firstMonth, MONTHS_SHOWN - 1)
  const [avail, windows] = await Promise.all([
    getAvailability(sb, member.id, `${firstMonth}-01`, `${lastMonth}-${String(daysIn(lastMonth)).padStart(2, '0')}`),
    myLiveWindows(sb, member.id),
  ])
  if (avail.kind !== 'ok' || windows.kind !== 'ok') return <CrewUnavailable />

  const blocked = new Map<string, DayPart>()
  for (const b of avail.data.blocks) {
    // One row per part is possible in the table; show the widest.
    const prev = blocked.get(b.day)
    if (!prev || b.part === 'all_day') blocked.set(b.day, b.part)
  }
  const working = new Set(windows.data.map(w => localParts(w.window.startsAt).dateKey))

  const months: CalMonth[] = []
  for (let i = 0; i < MONTHS_SHOWN; i++) {
    const ym = addMonths(firstMonth, i)
    const n = daysIn(ym)
    months.push({
      key: ym,
      label: monthLabel(ym),
      leadingBlanks: new Date(`${ym}-01T12:00:00Z`).getUTCDay(),
      days: Array.from({ length: n }, (_, k) => {
        const date = `${ym}-${String(k + 1).padStart(2, '0')}`
        return { date, day: k + 1, past: date < today, working: working.has(date), part: blocked.get(date) ?? null }
      }),
    })
  }

  const weekly: (DayPart | null)[] = Array.from({ length: 7 }, (_, dow) => {
    const rows = avail.data.recurring.filter(r => r.active && r.dow === dow)
    return rows.find(r => r.part === 'all_day')?.part ?? rows[0]?.part ?? null
  })

  // Next month's availability is due on the due day of THIS month; once that
  // has passed, the month after next is due on the due day of next month.
  const { dueDayOfMonth } = settings.settings.availability
  const dayNum = Number(today.slice(8, 10))
  const dueFor = dayNum <= dueDayOfMonth ? addMonths(firstMonth, 1) : addMonths(firstMonth, 2)
  const dueIn = dayNum <= dueDayOfMonth ? firstMonth : addMonths(firstMonth, 1)
  const dueLabel = `${monthName(dueIn)} ${dueDayOfMonth}`

  return (
    <main className="crew-wrap">
      <CrewTop firstName={member.first_name} isTest={member.is_test} />
      <h1>Availability</h1>
      <div className="crew-note crew-info">
        Please mark the days you can&apos;t work in <strong>{monthName(dueFor)}</strong> by <strong>{dueLabel}</strong>.
        Blocking a day never changes your pay.
      </div>
      <p className="crew-muted crew-small">Tap a day to block it. Green days are parties you&apos;re working.</p>
      <AvailabilityEditor months={months} weekly={weekly} />
    </main>
  )
}
