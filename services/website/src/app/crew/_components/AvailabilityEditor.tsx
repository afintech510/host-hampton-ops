'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export type Part = 'all_day' | 'before_noon' | 'after_noon'

export interface CalDay { date: string; day: number; past: boolean; working: boolean; part: Part | null }
export interface CalMonth { key: string; label: string; leadingBlanks: number; days: CalDay[] }

const PART_LABEL: Record<Part, string> = { all_day: 'All day', before_noon: 'Morning', after_noon: 'Afternoon' }
const PART_SHORT: Record<Part, string> = { all_day: 'Off', before_noon: 'AM off', after_noon: 'PM off' }
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DOW_LONG = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']

async function save(body: Record<string, unknown>): Promise<string | null> {
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

/**
 * Month calendar plus weekly blocks (spec §3.8). Tap a day, then choose what
 * you can't do. A day you are working is shown and cannot be blocked: that is
 * "Can't make it" on the party, and the server refuses it either way.
 */
export default function AvailabilityEditor({ months, weekly }: { months: CalMonth[]; weekly: (Part | null)[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<CalDay | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    const err = await save(body)
    setBusy(false)
    if (err) setError(err)
    else {
      setSelected(null)
      router.refresh()
    }
  }

  return (
    <div>
      {months.map(m => (
        <section key={m.key} className="crew-card" aria-label={m.label}>
          <h3 style={{ marginBottom: '.6rem' }}>{m.label}</h3>
          <div className="crew-cal">
            {DOW.map(d => <div key={d} className="crew-dow">{d}</div>)}
            {Array.from({ length: m.leadingBlanks }, (_, i) => <div key={`b${i}`} />)}
            {m.days.map(d => {
              const cls = ['crew-day',
                d.working ? 'crew-day-working' : '',
                d.part ? 'crew-day-blocked' : '',
                selected?.date === d.date ? 'crew-day-sel' : ''].join(' ')
              const state = d.working ? 'working' : d.part ? PART_LABEL[d.part] + ' unavailable' : 'available'
              return (
                <button
                  key={d.date} type="button" className={cls} disabled={d.past || d.working}
                  aria-label={`${d.date}: ${state}`} aria-pressed={selected?.date === d.date}
                  onClick={() => { setSelected(d); setError(null) }}
                >
                  <span>{d.day}</span>
                  {d.working && <span style={{ fontSize: '.65rem' }}>Working</span>}
                  {!d.working && d.part && <span style={{ fontSize: '.65rem' }}>{PART_SHORT[d.part]}</span>}
                </button>
              )
            })}
          </div>
        </section>
      ))}

      {selected && (
        <div className="crew-card" role="dialog" aria-label={`Availability for ${selected.date}`}>
          <p style={{ marginTop: 0 }}><strong>{selected.date}</strong>: when can&apos;t you work?</p>
          <div className="crew-row">
            {(['all_day', 'before_noon', 'after_noon'] as Part[]).map(p => (
              <button key={p} type="button" className={selected.part === p ? 'crew-btn' : 'crew-btn crew-btn-ghost'} disabled={busy}
                onClick={() => run({ day: selected.date, part: p })}>
                {PART_LABEL[p]}
              </button>
            ))}
            {selected.part && (
              <button type="button" className="crew-btn crew-btn-ghost" disabled={busy} onClick={() => run({ day: selected.date, part: null })}>
                I&apos;m free
              </button>
            )}
            <button type="button" className="crew-btn crew-btn-ghost" disabled={busy} onClick={() => setSelected(null)}>Close</button>
          </div>
          <p className="crew-small crew-muted" style={{ marginBottom: 0 }}>
            Morning blocks parties that start before noon. Afternoon blocks parties that run past noon.
          </p>
        </div>
      )}

      <h2>Every week</h2>
      <div className="crew-card">
        {weekly.map((part, dow) => (
          <div key={dow} className="crew-row" style={{ justifyContent: 'space-between', padding: '.3rem 0' }}>
            <label htmlFor={`crew-weekly-${dow}`} style={{ fontWeight: 600 }}>{DOW_LONG[dow]}</label>
            <select
              id={`crew-weekly-${dow}`} className="crew-input" style={{ width: 'auto', minWidth: '11rem' }} disabled={busy}
              value={part ?? ''} onChange={e => run({ dow, part: e.target.value || null })}
            >
              <option value="">I can work</option>
              <option value="all_day">Not all day</option>
              <option value="before_noon">Not mornings</option>
              <option value="after_noon">Not afternoons</option>
            </select>
          </div>
        ))}
      </div>
      {error && <p role="alert" className="crew-note crew-alert">{error}</p>}
    </div>
  )
}
