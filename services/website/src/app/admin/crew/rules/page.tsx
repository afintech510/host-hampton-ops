'use client'

/**
 * /admin/crew/rules — every `crew_settings` value (prompt 04 §5), one section
 * per key. Money is typed in dollars and saved as cents. The server refuses
 * rather than clamps (`screenCrewSetting`), and a save is only accepted if
 * `settingsFromRows` reads it back exactly as typed.
 */

import { useCallback, useEffect, useState } from 'react'
import { BTN_GHOST, BTN_PRIMARY, Banner, CrewFrame, INPUT, LoginGate, useAdminApi } from '../_components/adminCrew'
import { SETTING_SECTIONS, type SettingField, type SettingSection } from '@/lib/crew/adminForms'

interface Row { key: string; value: Record<string, unknown>; description: string | null }

const UNIT: Partial<Record<SettingField['unit'], string>> = {
  steps: 'steps', count: 'people', kids: 'kids', minutes: 'min', hours: 'hours', days: 'days', day_of_month: 'of the month',
}

function etToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export default function CrewRulesPage() {
  const api = useAdminApi()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<'ok' | 'unauthorized' | 'error'> => {
    const r = await api<{ rows?: Row[]; error?: string }>('/api/admin/crew/settings')
    if (r.status === 401) { setAuthed(false); return 'unauthorized' }
    setAuthed(true)
    if (!r.ok || !r.data.rows) { setError(r.data.error || 'Could not read the rules.'); return 'error' }
    setRows(r.data.rows)
    return 'ok'
  }, [api])
  useEffect(() => { load() }, [load])

  if (authed === null) return <div className="min-h-screen bg-[#F6F1EB] grid place-items-center text-hampton-navy/60">Loading…</div>
  if (!authed) return <LoginGate title="Crew rules" onSignedIn={load} />

  return (
    <CrewFrame active="/admin/crew/rules" title="Crew rules" sub="Every number the crew rules use. Each section saves on its own.">
      {error && <Banner tone="error">{error}</Banner>}
      <div className="grid lg:grid-cols-2 gap-5">
        {rows && SETTING_SECTIONS.map(section => {
          const row = rows.find(r => r.key === section.key)
          return <SectionCard key={`${section.key}:${JSON.stringify(row?.value ?? null)}`} section={section} stored={row?.value ?? null} onSaved={load} />
        })}
      </div>
    </CrewFrame>
  )
}

function toInput(f: SettingField, v: unknown): string {
  if (f.unit === 'date') return typeof v === 'string' ? v : ''
  if (typeof v !== 'number') return ''
  return f.unit === 'cents' ? (v / 100).toFixed(2) : String(v)
}

function fromInput(f: SettingField, s: string): number | string | null {
  if (f.unit === 'date') return s.trim() === '' ? null : s.trim()
  if (s.trim() === '') return NaN
  const n = Number(s)
  return f.unit === 'cents' ? Math.round(n * 100) : n
}

function SectionCard({ section, stored, onSaved }: { section: SettingSection; stored: Record<string, unknown> | null; onSaved: () => Promise<unknown> }) {
  const api = useAdminApi()
  const initial = Object.fromEntries(section.fields.map(f => [f.field, toInput(f, stored?.[f.field])]))
  const [vals, setVals] = useState<Record<string, string>>(initial)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const dirty = section.fields.some(f => vals[f.field] !== initial[f.field])

  async function save() {
    setBusy(true)
    setMsg(null)
    const value = Object.fromEntries(section.fields.map(f => [f.field, fromInput(f, vals[f.field])]))
    const r = await api<{ error?: string }>('/api/admin/crew/settings', { method: 'PUT', body: { key: section.key, value } })
    setBusy(false)
    if (!r.ok) { setMsg({ tone: 'error', text: r.data.error || 'Could not save.' }); return }
    await onSaved()
  }

  const launch = section.key === 'launch'
  const launchDate = vals.launch_date
  const graceDays = Number(vals.grace_days)

  return (
    <div className="bg-white rounded-2xl shadow-sm p-5">
      <h2 className="font-semibold text-hampton-navy">{section.title}</h2>
      <p className="text-hampton-navy/50 text-xs mt-1 mb-4">{section.help}</p>
      {!stored && <p className="text-red-700 text-sm mb-3">This setting is missing from the database.</p>}
      <div className="space-y-3">
        {section.fields.map(f => (
          <label key={f.field} className="flex flex-wrap items-center gap-2 text-sm text-hampton-navy">
            <span className="w-56">{f.label}</span>
            {f.unit === 'cents' && <span>$</span>}
            <input
              type={f.unit === 'date' ? 'date' : 'number'}
              step={f.unit === 'cents' ? '0.01' : f.integer ? '1' : 'any'}
              min={f.unit === 'date' ? undefined : f.unit === 'cents' ? f.min / 100 : f.min}
              max={f.unit === 'date' ? undefined : f.unit === 'cents' ? f.max / 100 : f.max}
              value={vals[f.field]}
              onChange={e => setVals(v => ({ ...v, [f.field]: e.target.value }))}
              className={`${INPUT} ${f.unit === 'date' ? 'w-44' : 'w-28'}`}
            />
            {UNIT[f.unit] && <span className="text-hampton-navy/50">{UNIT[f.unit]}</span>}
            {launch && f.unit === 'date' && (
              <>
                <button type="button" className={BTN_GHOST} onClick={() => setVals(v => ({ ...v, launch_date: etToday() }))}>Set to today</button>
                {launchDate && <button type="button" className="text-xs underline text-hampton-navy/60" onClick={() => setVals(v => ({ ...v, launch_date: '' }))}>clear</button>}
              </>
            )}
            {f.help && <span className="w-full text-hampton-navy/40 text-xs">{f.help}</span>}
          </label>
        ))}
      </div>
      {launch && (
        <p className="text-hampton-navy/60 text-xs mt-3">
          {launchDate
            ? `Grace runs from ${launchDate} until midnight Eastern on ${Number.isFinite(graceDays) ? addDays(launchDate, graceDays) : '…'}. Until then a late cancel, a dropped party or a no-show is noted but nobody's rate goes down. Raises always apply.`
            : 'Not launched: every step loss is noted and waived until you set a launch date. Raises always apply.'}
        </p>
      )}
      {msg && <p className={`text-sm mt-3 ${msg.tone === 'error' ? 'text-red-600' : 'text-emerald-700'}`}>{msg.text}</p>}
      <div className="mt-4">
        <button disabled={busy || !dirty} onClick={save} className={BTN_PRIMARY}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}
