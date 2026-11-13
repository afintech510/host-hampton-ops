'use client'

/**
 * The crew app's Schedule screen (read only, migration 100): the next six weeks of crew parties and who is
 * on each, in the admin Schedule's order. No alerts, no flags, no buttons that change anything.
 */

import { useMemo, useState } from 'react'
import type { CrewScheduleRow } from '@/lib/crew/bookingView'
import { useCrewData } from './useCrewData'

const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric' })
const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
const dayKey = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso))

const KIND: Record<string, string> = { in_studio_theme: 'Theme Party', mobile_party: 'Mobile Party', studio_rental: 'Studio Rental', manual: 'Event' }

type Filter = 'all' | 'needs'

function Row({ p }: { p: CrewScheduleRow }) {
  const short = p.needed - p.staffed
  const chip = p.status === 'cancelled' ? 'crew-alert' : short <= 0 && p.needed > 0 ? 'crew-ok' : p.staffed === 0 ? 'crew-alert' : 'crew-warn'
  const about = [p.child ? `${p.child}${p.childAge ? `, turning ${p.childAge}` : ''}` : null, p.parent ? `Parent: ${p.parent}` : null, p.guestCount ? `${p.guestCount} guests` : null, p.theme].filter(Boolean).join(' · ')
  const lead = p.crew.filter(c => c.role === 'lead')
  const crew = p.crew.filter(c => c.role !== 'lead')
  return (
    <article className="crew-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3>{p.title}</h3>
        <span className={`crew-chip ${chip}`}>{p.status === 'cancelled' ? 'Cancelled' : `Staff ${p.staffed}/${p.needed}`}</span>
      </div>
      <p className="crew-muted crew-small" style={{ margin: '.15rem 0 0' }}>
        {timeFmt.format(new Date(p.startsAt))} – {timeFmt.format(new Date(p.endsAt))} · {KIND[p.kind] ?? 'Party'}{p.status === 'draft' ? ' · Draft' : ''}
      </p>
      {about && <p className="crew-small" style={{ margin: '.35rem 0 0' }}>{about}</p>}
      {(p.food || p.cupcake) && (
        <p className="crew-small" style={{ margin: '.25rem 0 0' }}>
          {p.food && <>Main: <strong>{p.food}</strong></>}{p.food && p.cupcake && ' · '}{p.cupcake && <>Cupcakes: <strong>{p.cupcake}</strong></>}
        </p>
      )}
      <p className="crew-small" style={{ margin: '.5rem 0 0' }}>
        {p.crew.length === 0 ? <span className="crew-muted">Nobody is on it yet.</span> : (
          <>
            {lead.map((c, i) => <span key={`l${i}`} style={{ fontWeight: 700 }}>{c.firstName} (Lead){crew.length || i < lead.length - 1 ? ', ' : ''}</span>)}
            {crew.map((c, i) => <span key={`c${i}`}>{c.firstName}{i < crew.length - 1 ? ', ' : ''}</span>)}
          </>
        )}
        {short > 0 && p.status !== 'cancelled' && <span style={{ color: 'var(--c-warn-ink)' }}> · {short} open{!p.leadFilled && p.kind !== 'studio_rental' ? ' (needs a Lead)' : ''}</span>}
      </p>
    </article>
  )
}

export default function ScheduleView() {
  const { data, error, loading } = useCrewData<{ now: string; parties: CrewScheduleRow[] }>('/api/crew/schedule')
  const [filter, setFilter] = useState<Filter>('all')
  const shown = useMemo(() => {
    const live = (data?.parties ?? []).filter(p => p.status !== 'cancelled')
    return filter === 'needs' ? live.filter(p => p.needed - p.staffed > 0) : live
  }, [data, filter])
  const days = useMemo(() => {
    const out: { key: string; label: string; rows: CrewScheduleRow[] }[] = []
    for (const p of shown) {
      const key = dayKey(p.startsAt)
      let d = out.find(x => x.key === key)
      if (!d) { d = { key, label: dayFmt.format(new Date(p.startsAt)), rows: [] }; out.push(d) }
      d.rows.push(p)
    }
    return out
  }, [shown])

  return (
    <div>
      <div className="crew-row" role="group" aria-label="Filter">
        <button type="button" className={`crew-btn ${filter === 'all' ? '' : 'crew-btn-ghost'}`} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
        <button type="button" className={`crew-btn ${filter === 'needs' ? '' : 'crew-btn-ghost'}`} aria-pressed={filter === 'needs'} onClick={() => setFilter('needs')}>Needs crew</button>
      </div>
      {error && !data && <p role="alert" className="crew-note crew-warn">{error}</p>}
      {loading && <p className="crew-muted" role="status">Loading the schedule…</p>}
      {data && days.length === 0 && <p className="crew-muted">{filter === 'needs' ? 'Every party has the crew it needs.' : 'Nothing on the schedule in the next six weeks.'}</p>}
      {days.map(d => (
        <section key={d.key} aria-label={d.label}>
          <h2>{d.label}</h2>
          {d.rows.map(p => <Row key={p.id} p={p} />)}
        </section>
      ))}
    </div>
  )
}
