'use client'

/**
 * Hours + punch details for a staff member who has a time clock (migration 094), shown under their
 * opened card on the Staff page. Renders nothing for anyone without one.
 */

import { useCallback, useEffect, useState } from 'react'
import { BTN_GHOST, BTN_PRIMARY, INPUT, useAdminApi } from './adminCrew'

interface Punch {
  id: string; punched_in_at: string; punched_out_at: string | null
  in_lat: number | null; in_lng: number | null; in_accuracy_m: number | null
  out_lat: number | null; out_lng: number | null
  in_on_studio_network: boolean | null; out_on_studio_network: boolean | null
  in_distance_m: number | null; out_distance_m: number | null
  in_ip: string | null; admin_note: string | null; edited_by: string | null; edited_at: string | null
  flags: string[]
}
interface TimeData {
  enabled: boolean; noticeAcceptedAt?: string | null; timeZone?: string
  config: { studio_ips: string[]; radius_m: number }; yourIp: string | null; punches?: Punch[]
}

const TZ = 'America/New_York'
const fmt = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
const mins = (p: Punch) => Math.max(0, Math.round(((p.punched_out_at ? new Date(p.punched_out_at) : new Date()).getTime() - new Date(p.punched_in_at).getTime()) / 60000))
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
const map = (lat: number | null, lng: number | null) => (lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null)

/** A value for <input type="datetime-local"> in Eastern time. */
function toLocalInput(iso: string): string {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
  return parts.replace(' ', 'T')
}
/** The instant an Eastern wall-clock "YYYY-MM-DDTHH:MM" means. */
function fromLocalInput(v: string): string {
  const asUtc = new Date(`${v}:00Z`)
  const shown = toLocalInput(asUtc.toISOString())
  const drift = new Date(`${shown}:00Z`).getTime() - asUtc.getTime()
  return new Date(asUtc.getTime() - drift).toISOString()
}

export default function TimeClockPanel({ memberId, firstName }: { memberId: string; firstName: string }) {
  const api = useAdminApi()
  const [data, setData] = useState<TimeData | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [ein, setEin] = useState('')
  const [eout, setEout] = useState('')
  const [enote, setEnote] = useState('')

  const load = useCallback(async () => {
    const r = await api<TimeData & { error?: string }>(`/api/admin/crew/time?memberId=${memberId}`)
    if (!r.ok) { setError(r.data.error || 'Could not load the time clock.'); return }
    setData(r.data)
  }, [api, memberId])
  useEffect(() => { void load() }, [load])

  if (!data?.enabled) return error ? <p className="text-sm text-red-700">{error}</p> : null
  const punches = data.punches ?? []
  const now = Date.now()
  const week = punches.filter(p => now - new Date(p.punched_in_at).getTime() < 7 * 86400000).reduce((s, p) => s + mins(p), 0)
  const total = punches.reduce((s, p) => s + mins(p), 0)
  const studioKnown = data.config.studio_ips.length > 0

  async function recordStudio() {
    setError(''); setNotice('')
    const r = await api<{ error?: string }>('/api/admin/crew/time', { method: 'PUT', body: { useThisConnection: true } })
    if (!r.ok) setError(r.data.error || 'Could not save.')
    else { setNotice('This connection is now the studio network.'); await load() }
  }
  async function saveEdit(id: string) {
    setError('')
    const r = await api<{ error?: string }>('/api/admin/crew/time/punches', {
      method: 'PATCH',
      body: { id, punchedInAt: fromLocalInput(ein), punchedOutAt: eout ? fromLocalInput(eout) : null, adminNote: enote },
    })
    if (!r.ok) { setError(r.data.error || 'Could not save.'); return }
    setEditing(null); setNotice('Punch updated.'); await load()
  }

  return (
    <section className="mt-5 border-t border-hampton-pink/10 pt-4" aria-label={`${firstName}'s hours`}>
      <h3 className="text-base font-semibold text-hampton-navy">Time clock · {firstName}</h3>
      <p className="text-sm text-hampton-navy/70 mt-1">
        Last 7 days: <strong>{hm(week)}</strong> · All logged: <strong>{hm(total)}</strong>
        {data.noticeAcceptedAt ? <> · Notice accepted {fmt(data.noticeAcceptedAt)}</> : ' · Notice not accepted yet'}
      </p>

      <div className="mt-2 rounded-xl bg-[#F6F1EB] p-3 text-xs text-hampton-navy/80">
        <div>
          Studio network: {studioKnown ? data.config.studio_ips.join(', ') : <strong>not recorded</strong>} · on-site radius {data.config.radius_m} m
        </div>
        <div className="mt-1">
          This connection: <code>{data.yourIp ?? 'unknown'}</code>{' '}
          <button type="button" className={BTN_GHOST} onClick={recordStudio} disabled={!data.yourIp}>I&apos;m on the studio Wi-Fi: record it</button>
        </div>
        <div className="mt-1 text-hampton-navy/60">A web page can&apos;t read the Wi-Fi name; the check compares the internet address the punch came from. Cell data always reads &quot;not on the studio network&quot;.</div>
      </div>

      {error && <p role="alert" className="text-sm text-red-700 mt-2">{error}</p>}
      {notice && <p className="text-sm text-emerald-700 mt-2">{notice}</p>}

      {punches.length === 0 ? <p className="text-sm text-hampton-navy/50 mt-3">No punches yet.</p> : (
        <ul className="mt-3 space-y-2">
          {punches.map(p => {
            const inMap = map(p.in_lat, p.in_lng)
            const outMap = map(p.out_lat, p.out_lng)
            return (
              <li key={p.id} className="rounded-xl bg-white border border-hampton-navy/10 p-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-semibold text-hampton-navy">{fmt(p.punched_in_at)} → {p.punched_out_at ? fmt(p.punched_out_at) : 'still in'}</span>
                  <span className="font-bold">{hm(mins(p))}</span>
                </div>
                <div className="mt-1 text-xs text-hampton-navy/70">
                  In: {p.in_on_studio_network === true ? 'studio network' : p.in_on_studio_network === false ? 'other network' : 'network unknown'}
                  {inMap ? <> · <a className="underline" href={inMap} target="_blank" rel="noopener noreferrer">map</a></> : null}
                  {p.punched_out_at && <> · Out: {p.out_on_studio_network === true ? 'studio network' : p.out_on_studio_network === false ? 'other network' : 'network unknown'}
                    {outMap ? <> · <a className="underline" href={outMap} target="_blank" rel="noopener noreferrer">map</a></> : null}</>}
                </div>
                {p.flags.length > 0 && <div className="mt-1 text-xs text-amber-800 font-medium">⚑ {p.flags.join(' · ')}</div>}
                {p.admin_note && <div className="mt-1 text-xs text-hampton-navy/60">Note: {p.admin_note}</div>}
                {editing === p.id ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label className="text-xs">In<input type="datetime-local" className={INPUT} value={ein} onChange={e => setEin(e.target.value)} /></label>
                    <label className="text-xs">Out<input type="datetime-local" className={INPUT} value={eout} onChange={e => setEout(e.target.value)} /></label>
                    <label className="text-xs sm:col-span-2">Note<input className={INPUT} value={enote} maxLength={500} onChange={e => setEnote(e.target.value)} /></label>
                    <div className="flex gap-2 sm:col-span-2">
                      <button className={BTN_PRIMARY} onClick={() => saveEdit(p.id)}>Save</button>
                      <button className={BTN_GHOST} onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button className={`${BTN_GHOST} mt-2`} onClick={() => { setEditing(p.id); setEin(toLocalInput(p.punched_in_at)); setEout(p.punched_out_at ? toLocalInput(p.punched_out_at) : ''); setEnote(p.admin_note ?? '') }}>Fix this punch</button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
