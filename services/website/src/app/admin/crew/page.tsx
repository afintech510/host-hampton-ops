'use client'

/**
 * /admin/crew — Allie's staffing screen (prompt 04 §2): Sync now, alerts, and
 * the next six weeks of crew parties. Works whether or not CREW_ENABLED is on.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  BTN_GHOST, BTN_PRIMARY, Banner, CrewFrame, FLAG_TEXT, INPUT, LoginGate, STATUS_STYLE, useAdminApi, whenLabel,
} from './_components/adminCrew'

interface PartyRow {
  id: string
  title: string
  kind: string
  bookingRef: string | null
  startsAt: string
  endsAt: string
  guestCount: number | null
  status: string
  flags: string[]
  needed: number
  staffed: number
  leadFilled: boolean
  unconfirmed: number
  available: number
  crew: { firstName: string; role: 'lead' | 'crew'; confirmed: boolean; isOwner: boolean }[]
}

interface Alert { kind: string; severity: 'urgent' | 'warn' | 'info'; text: string; partyId?: string; bookingRef?: string }

interface Overview {
  parties: PartyRow[]
  alerts: Alert[]
  sync: { needsTime: string[]; unclassified: string[]; rentalsWithoutHelper: string[]; reactivated: string[] } | null
  syncError: string | null
  counts: { members: number; canLead: number; needsReview: number }
  switches: { crewEnabled: boolean; smsEnabled: boolean; testLogin: boolean }
}

type Filter = 'all' | 'needs' | 'unconfirmed' | 'drafts'

const SEVERITY: Record<Alert['severity'], string> = {
  urgent: 'border-l-4 border-red-500 bg-red-50 text-red-900',
  warn: 'border-l-4 border-amber-400 bg-amber-50 text-amber-900',
  info: 'border-l-4 border-sky-300 bg-white text-hampton-navy',
}

export default function CrewSchedulePage() {
  const api = useAdminApi()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null)
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async (): Promise<'ok' | 'unauthorized' | 'error'> => {
    const r = await api<Overview & { error?: string }>('/api/admin/crew')
    if (r.status === 401) { setAuthed(false); return 'unauthorized' }
    if (!r.ok) { setError(r.data.error || 'Could not read the schedule.'); setAuthed(true); return 'error' }
    setData(r.data)
    setError('')
    setAuthed(true)
    return 'ok'
  }, [api])

  useEffect(() => { load() }, [load])

  async function syncNow() {
    setSyncing(true)
    setSyncMsg(null)
    const r = await api<{ summary?: any; error?: string }>('/api/admin/crew/sync', { method: 'POST' })
    setSyncing(false)
    if (!r.data.summary) { setSyncMsg({ tone: 'error', text: r.data.error || 'Sync failed.' }); return }
    const s = r.data.summary
    const parts = [
      `${s.created} new draft ${s.created === 1 ? 'party' : 'parties'}`,
      `${s.updated} updated`,
      `${s.cancelled} cancelled`,
      `${s.spotsAdded} spots added`,
    ]
    if (s.notificationsQueued) parts.push(`${s.notificationsQueued} crew notices queued (not sent)`)
    setSyncMsg({
      tone: s.errors.length ? 'warn' : 'ok',
      text: `Synced: ${parts.join(', ')}.${s.errors.length ? ` Problems: ${s.errors.join('; ')}` : ''}`,
    })
    await load()
  }

  if (authed === null) return <div className="min-h-screen bg-[#F6F1EB] grid place-items-center text-hampton-navy/60">Loading…</div>
  if (!authed) return <LoginGate title="Crew" onSignedIn={load} />

  const parties = (data?.parties ?? []).filter(p => {
    if (filter === 'needs') return (p.status === 'published' || p.status === 'draft') && p.staffed < p.needed
    if (filter === 'unconfirmed') return p.unconfirmed > 0
    if (filter === 'drafts') return p.status === 'draft'
    return true
  })

  return (
    <CrewFrame
      active="/admin/crew"
      title="Crew schedule"
      sub={data ? `${data.counts.members} active crew, ${data.counts.canLead} can lead. Next six weeks.` : null}
    >
      {data && !data.switches.crewEnabled && (
        <Banner tone="info">
          The crew app is not launched (CREW_ENABLED is off). You can set everything up here; crew cannot see anything yet
          {data.switches.testLogin ? ', except the invented test members on /crew/login' : ''}. Nothing is sent to anyone.
        </Banner>
      )}
      {error && <Banner tone="error">{error}</Banner>}
      {syncMsg && <Banner tone={syncMsg.tone}>{syncMsg.text}</Banner>}

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <button onClick={syncNow} disabled={syncing} className={BTN_PRIMARY}>{syncing ? 'Syncing…' : 'Sync now'}</button>
        <button onClick={() => setShowNew(v => !v)} className={BTN_GHOST}>{showNew ? 'Close' : 'New party by hand'}</button>
        <span className="text-hampton-navy/50 text-xs">Sync reads booked parties and makes draft crew parties. It never publishes and never removes a spot.</span>
      </div>

      {showNew && <NewPartyForm onCreated={id => { window.location.href = `/admin/crew/parties/${id}` }} />}

      {data && (
        <section className="mb-8">
          <h2 className="text-hampton-navy text-xs uppercase tracking-wider font-bold mb-2">Alerts</h2>
          {data.syncError && <Banner tone="error">Could not check the bookings for parties needing a time: {data.syncError}</Banner>}
          {data.alerts.length === 0 ? (
            <p className="bg-white rounded-2xl p-5 text-hampton-navy/50 text-sm">Nothing needs you right now.</p>
          ) : (
            <ul className="space-y-2">
              {data.alerts.map((a, i) => (
                <li key={i} className={`rounded-lg px-4 py-2.5 text-sm ${SEVERITY[a.severity]}`}>
                  {a.partyId ? <a className="underline" href={`/admin/crew/parties/${a.partyId}`}>{a.text}</a>
                    : a.bookingRef ? <a className="underline" href={`/admin/lead/${encodeURIComponent(a.bookingRef)}`}>{a.text}</a>
                    : a.text}
                </li>
              ))}
            </ul>
          )}
          {data.sync && data.sync.rentalsWithoutHelper.length > 0 && (
            <p className="text-hampton-navy/50 text-xs mt-2">
              Studio rentals booked without a Party Helper (no crew needed): {data.sync.rentalsWithoutHelper.join(', ')}.
            </p>
          )}
        </section>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        {([['all', 'All'], ['needs', 'Needs crew'], ['unconfirmed', 'Unconfirmed'], ['drafts', 'Drafts']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`text-sm font-semibold rounded-full px-4 py-1.5 ${filter === k ? 'bg-hampton-navy text-[#F6F1EB]' : 'bg-white text-hampton-navy'}`}>
            {l}
          </button>
        ))}
      </div>

      {parties.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center text-hampton-navy/50">No parties match.</div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-hampton-navy/50 text-[11px] uppercase tracking-wider">
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Party</th>
                <th className="px-4 py-3">Kids</th>
                <th className="px-4 py-3">Staffed</th>
                <th className="px-4 py-3">Available</th>
                <th className="px-4 py-3">Crew</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {parties.map(p => (
                <tr key={p.id} className="border-t border-hampton-pink/10 align-top hover:bg-[#F6F1EB]/50">
                  <td className="px-4 py-3 whitespace-nowrap text-hampton-navy">{whenLabel(p.startsAt, p.endsAt)}</td>
                  <td className="px-4 py-3">
                    <a href={`/admin/crew/parties/${p.id}`} className="font-semibold text-hampton-navy underline">{p.title}</a>
                    <div className="text-hampton-navy/40 text-xs">{p.bookingRef ?? 'By hand'}</div>
                    {p.flags.length > 0 && (
                      <div className="text-amber-700 text-xs mt-1">{p.flags.map(f => FLAG_TEXT[f] ?? f).join(' · ')}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">{p.guestCount ?? '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={p.staffed >= p.needed ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>{p.staffed}/{p.needed}</span>
                    {!p.leadFilled && <div className="text-red-700 text-xs">no Lead</div>}
                    {p.unconfirmed > 0 && <div className="text-amber-700 text-xs">{p.unconfirmed} unconfirmed</div>}
                  </td>
                  <td className="px-4 py-3">{p.status === 'draft' || p.status === 'published' ? p.available : '—'}</td>
                  <td className="px-4 py-3 text-hampton-navy/80">
                    {p.crew.length === 0 ? '—' : p.crew.map(c => `${c.firstName}${c.role === 'lead' ? ' (Lead)' : ''}${c.confirmed || c.isOwner ? '' : '?'}`).join(', ')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${STATUS_STYLE[p.status] ?? 'bg-gray-100'}`}>{p.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-hampton-navy/40 text-xs px-4 py-3">A name with “?” has not confirmed. Allie counts toward staffed when she is on a party.</p>
        </div>
      )}
    </CrewFrame>
  )
}

function NewPartyForm({ onCreated }: { onCreated: (id: string) => void }) {
  const api = useAdminApi()
  const [f, setF] = useState({ title: '', date: '', start: '', end: '', guest_count: '', location: '', notes_for_crew: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF(p => ({ ...p, [k]: e.target.value }))
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    const r = await api<{ id?: string; error?: string }>('/api/admin/crew/parties', {
      method: 'POST',
      body: { ...f, guest_count: f.guest_count === '' ? null : Number(f.guest_count) },
    })
    setBusy(false)
    if (!r.ok || !r.data.id) { setErr(r.data.error || 'Could not create it.'); return }
    onCreated(r.data.id)
  }
  return (
    <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm p-5 mb-6 grid sm:grid-cols-2 gap-3">
      <p className="sm:col-span-2 text-hampton-navy/60 text-sm">A crew party with no booking behind it. It starts as a draft.</p>
      <label className="text-sm text-hampton-navy">Title<input className={`${INPUT} w-full mt-1`} value={f.title} onChange={set('title')} maxLength={80} required /></label>
      <label className="text-sm text-hampton-navy">Date<input type="date" className={`${INPUT} w-full mt-1`} value={f.date} onChange={set('date')} required /></label>
      <label className="text-sm text-hampton-navy">Starts (Eastern)<input type="time" className={`${INPUT} w-full mt-1`} value={f.start} onChange={set('start')} required /></label>
      <label className="text-sm text-hampton-navy">Ends<input type="time" className={`${INPUT} w-full mt-1`} value={f.end} onChange={set('end')} required /></label>
      <label className="text-sm text-hampton-navy">Kids (optional)<input type="number" min={0} className={`${INPUT} w-full mt-1`} value={f.guest_count} onChange={set('guest_count')} /></label>
      <label className="text-sm text-hampton-navy">Location<input className={`${INPUT} w-full mt-1`} value={f.location} onChange={set('location')} maxLength={200} required /></label>
      <label className="text-sm text-hampton-navy sm:col-span-2">Notes for crew<textarea className={`${INPUT} w-full mt-1`} rows={2} value={f.notes_for_crew} onChange={set('notes_for_crew')} /></label>
      {err && <p className="sm:col-span-2 text-red-600 text-sm">{err}</p>}
      <div className="sm:col-span-2"><button disabled={busy} className={BTN_PRIMARY}>{busy ? 'Creating…' : 'Create draft'}</button></div>
    </form>
  )
}
