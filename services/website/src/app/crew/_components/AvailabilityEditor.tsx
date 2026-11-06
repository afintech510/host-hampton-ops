'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface PeriodItem { id: string; label: string }

/** Every half hour of the day: value "00:00", "00:30" … "23:30", label "12:00 AM" … "11:30 PM". */
const TIMES = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2), m = i % 2 ? '30' : '00'
  return { value: `${String(h).padStart(2, '0')}:${m}`, label: `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}` }
})

async function send(body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch('/api/crew/availability', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (res.status === 401) {
      window.location.href = '/crew/login'
      return null
    }
    const data = await res.json().catch(() => ({}))
    return res.ok ? null : (typeof data?.error === 'string' ? data.error : "That didn't save. Try again.")
  } catch {
    return "The site didn't answer. Try again."
  }
}

/** `2026-11-14` + `15:00` plus an hour, as `[date, time]`. Wall-clock arithmetic only: no zone is involved. */
function plusOneHour(date: string, time: string): [string, string] {
  const d = new Date(`${date}T${time}:00Z`)
  if (Number.isNaN(d.getTime())) return ['', '']
  d.setUTCHours(d.getUTCHours() + 1)
  const iso = d.toISOString()
  return [iso.slice(0, 10), iso.slice(11, 16)]
}

function When({ id, label, date, time, minDate, disabled, onDate, onTime }: {
  id: string; label: string; date: string; time: string; minDate: string; disabled: boolean
  onDate: (v: string) => void; onTime: (v: string) => void
}) {
  return (
    <div style={{ marginBottom: '.8rem' }}>
      <label htmlFor={`${id}-date`} className="crew-small crew-muted" style={{ display: 'block', marginBottom: '.3rem' }}>{label}</label>
      <div className="crew-row" style={{ gap: '.5rem', flexWrap: 'nowrap' }}>
        <input id={`${id}-date`} type="date" className="crew-input" style={{ flex: '1 1 55%' }} required min={minDate} value={date} disabled={disabled}
          onChange={e => onDate(e.target.value)} />
        <select id={`${id}-time`} aria-label={`${label} time`} className="crew-input" style={{ flex: '1 1 45%' }} required value={time} disabled={disabled}
          onChange={e => onTime(e.target.value)}>
          <option value="">Time</option>
          {TIMES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
    </div>
  )
}

/**
 * The whole availability page (spec §3.8): pick when you can't work, from a
 * start date and time to an end date and time, and add it. Times go by the
 * half hour: a date and a list, not a free-minute clock. Periods you've added
 * are listed under the form with a Remove. A time you are working a party is
 * refused by the server; that is "Can't make it" on the party.
 */
export default function AvailabilityEditor({ periods, minDate }: { periods: PeriodItem[]; minDate: string }) {
  const router = useRouter()
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(body: Record<string, unknown>, onDone?: () => void) {
    setBusy(true)
    setError(null)
    const err = await send(body)
    setBusy(false)
    if (err) setError(err)
    else {
      onDone?.()
      router.refresh()
    }
  }

  const start = startDate && startTime ? `${startDate}T${startTime}` : ''
  const end = endDate && endTime ? `${endDate}T${endTime}` : ''

  /** Once the start is complete, an end that is empty or not after it follows by an hour. */
  function followStart(d: string, t: string) {
    if (!d || !t) return
    if (!(endDate && endTime && `${endDate}T${endTime}` > `${d}T${t}`)) {
      const [ed, et] = plusOneHour(d, t)
      setEndDate(ed); setEndTime(et)
    }
  }

  function add(e: React.FormEvent) {
    e.preventDefault()
    if (!start || !end) { setError('Pick a start and an end, date and time.'); return }
    if (end <= start) { setError('The end has to be after the start.'); return }
    void run({ start, end }, () => { setStartDate(''); setStartTime(''); setEndDate(''); setEndTime('') })
  }

  return (
    <div>
      <form onSubmit={add} className="crew-card">
        <p style={{ marginTop: 0, fontWeight: 600 }}>When can&apos;t you work?</p>
        <When id="crew-unavail-start" label="From" date={startDate} time={startTime} minDate={minDate} disabled={busy}
          onDate={v => { setStartDate(v); followStart(v, startTime) }}
          onTime={v => { setStartTime(v); followStart(startDate, v) }} />
        <When id="crew-unavail-end" label="Until" date={endDate} time={endTime} minDate={startDate || minDate} disabled={busy}
          onDate={setEndDate} onTime={setEndTime} />
        <div>
          <button type="submit" className="crew-btn" disabled={busy}>{busy ? 'One moment…' : 'Add'}</button>
        </div>
        {error && <p role="alert" className="crew-small" style={{ color: 'var(--c-alert-ink)', marginBottom: 0 }}>{error}</p>}
      </form>

      <h2>Times you can&apos;t work</h2>
      {periods.length === 0 ? (
        <p className="crew-muted">Nothing yet. You&apos;re free for every party.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {periods.map(p => (
            <li key={p.id} className="crew-card crew-row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: '.8rem' }}>
              <span>{p.label}</span>
              <button type="button" className="crew-btn crew-btn-ghost" disabled={busy} onClick={() => run({ remove: p.id })}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
