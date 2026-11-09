import { notFound } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'
import { requireCrewPage } from '@/lib/crew/page'
import { type PunchRow, listPunches, loadClockMember, minutesWorked, hoursLabel, etDay, etWeekStart, TIME_ZONE } from '@/lib/crew/timeClock'
import CrewTop, { CrewUnavailable } from '../_components/CrewTop'

export const dynamic = 'force-dynamic'

const dayLabel = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso))
const clock = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
const weekLabel = (monday: string) => `Week of ${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${monday}T12:00:00Z`))}`

/** `/crew/time`: all of my logged hours, by week. 404 for anyone without a time clock. */
export default async function CrewTimePage() {
  const member = await requireCrewPage()
  if (member === 'unavailable') return <CrewUnavailable />
  const sb = getSupabase()
  const cm = await loadClockMember(sb, member.id)
  if (cm.kind !== 'ok') return <CrewUnavailable />
  if (!cm.data) notFound()
  const list = await listPunches(sb, member.id, 1000)
  if (list.kind !== 'ok') return <CrewUnavailable />

  const now = new Date()
  const byWeek: Record<string, PunchRow[]> = {}
  for (const p of list.data) {
    const k = etWeekStart(p.punched_in_at)
    ;(byWeek[k] ??= []).push(p)
  }
  const weeks = Object.entries(byWeek).sort((a, b) => (a[0] < b[0] ? 1 : -1))
  const total = list.data.reduce((s, p) => s + minutesWorked(p, now), 0)

  return (
    <main className="crew-wrap">
      <CrewTop firstName={member.first_name} isTest={member.is_test} />
      <h1>My hours</h1>
      <p className="crew-muted crew-small" style={{ marginTop: 0 }}>All time logged: <strong>{hoursLabel(total)}</strong></p>
      {list.data.length === 0 && <p className="crew-muted">No punches yet. Use the Time clock on the Parties page.</p>}
      {weeks.map(([monday, rows]) => (
        <section key={monday} className="crew-card" aria-label={weekLabel(monday)}>
          <h2 style={{ marginTop: 0 }}>{weekLabel(monday)} <span className="crew-muted" style={{ fontWeight: 400 }}>· {hoursLabel(rows.reduce((s, p) => s + minutesWorked(p, now), 0))}</span></h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {rows.map(p => (
              <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '.75rem', padding: '.35rem 0' }}>
                <span>{dayLabel(p.punched_in_at)}<br /><span className="crew-small crew-muted">{clock(p.punched_in_at)} – {p.punched_out_at ? clock(p.punched_out_at) : 'now'}{p.punched_out_at && etDay(p.punched_out_at) !== etDay(p.punched_in_at) ? ' (next day)' : ''}{p.edited_at ? ' · edited by a manager' : ''}</span></span>
                <strong>{p.punched_out_at ? hoursLabel(minutesWorked(p, now)) : 'In progress'}</strong>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  )
}
