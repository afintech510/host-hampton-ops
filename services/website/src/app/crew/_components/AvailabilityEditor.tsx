'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface PeriodItem { id: string; label: string }

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

/** `2026-11-14T15:00` plus an hour, as a datetime-local value. Wall-clock arithmetic only: no zone is involved. */
function plusOneHour(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)
  if (!m) return ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) + 1, Number(m[5])))
  return d.toISOString().slice(0, 16)
}

/**
 * The whole availability page (spec §3.8): pick when you can't work, from a
 * start date and time to an end date and time, and add it. Periods you've added
 * are listed under the form with a Remove. A time you are working a party is
 * refused by the server; that is "Can't make it" on the party.
 */
export default function AvailabilityEditor({ periods, minLocal }: { periods: PeriodItem[]; minLocal: string }) {
  const router = useRouter()
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
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

  function add(e: React.FormEvent) {
    e.preventDefault()
    if (!start || !end) { setError('Pick a start and an end, date and time.'); return }
    if (end <= start) { setError('The end has to be after the start.'); return }
    void run({ start, end }, () => { setStart(''); setEnd('') })
  }

  return (
    <div>
      <form onSubmit={add} className="crew-card">
        <p style={{ marginTop: 0, fontWeight: 600 }}>When can&apos;t you work?</p>
        <label htmlFor="crew-unavail-start" className="crew-small crew-muted" style={{ display: 'block', marginBottom: '.3rem' }}>From</label>
        <input
          id="crew-unavail-start" type="datetime-local" className="crew-input" required min={minLocal} value={start} disabled={busy}
          onChange={e => {
            const v = e.target.value
            setStart(v)
            if (v && (!end || end <= v)) setEnd(plusOneHour(v))
          }}
        />
        <label htmlFor="crew-unavail-end" className="crew-small crew-muted" style={{ display: 'block', margin: '.8rem 0 .3rem' }}>Until</label>
        <input
          id="crew-unavail-end" type="datetime-local" className="crew-input" required min={start || minLocal} value={end} disabled={busy}
          onChange={e => setEnd(e.target.value)}
        />
        <div style={{ marginTop: '.9rem' }}>
          <button type="submit" className="crew-btn" disabled={busy}>{busy ? 'One moment…' : 'Add'}</button>
        </div>
        {error && <p role="alert" className="crew-small" style={{ color: '#8E1043', marginBottom: 0 }}>{error}</p>}
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
