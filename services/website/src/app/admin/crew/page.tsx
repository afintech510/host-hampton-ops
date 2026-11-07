'use client'

/**
 * /admin/crew — Allie's staffing screen (prompt 04 §2): Sync now, alerts, and
 * the next six weeks of crew parties. Works whether or not CREW_ENABLED is on.
 */

import { useCallback, useEffect, useState } from 'react'
import { useAdminData } from './_components/adminData'
import { WORK_TYPES, kindHasLead, workTypeOf, type WorkKind } from '@/lib/crew/workTypes'
import {
  BTN_GHOST, BTN_PRIMARY, Banner, CrewFrame, FLAG_TEXT, INPUT, STATUS_STYLE, useAdminApi, whenLabel, whenParts,
} from './_components/adminCrew'

interface PartyRow {
  id: string
  title: string
  kind: string
  booked: boolean
  /** Equitable scheduling: how many answered each way, or null on a party that is first come, first served. */
  pick: { work: number; standby: number; unavailable: number } | null
  childName: string | null
  childAge: number | null
  parentName: string | null
  food: string | null
  cupcake: string | null
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

/** What sits under a party's title, on the table and on the phone card: who it is for, the picks, the menu, flags. */
function PartyBits({ p }: { p: PartyRow }) {
  return (
    <>
      {(p.childName || p.parentName) && (
        <div className="text-hampton-navy/80 text-xs mt-0.5">
          {p.childName && <span>Child: <strong>{p.childName}{p.childAge ? `, ${p.childAge}` : ''}</strong></span>}
          {p.childName && p.parentName && ' · '}
          {p.parentName && <span>Parent: <strong>{p.parentName}</strong></span>}
        </div>
      )}
      {p.pick && (
        <div className="text-xs mt-0.5">
          <span className={p.pick.work > 0 ? 'text-emerald-700 font-semibold' : 'text-hampton-navy/50'}>{p.pick.work} want to work</span>
          <span className="text-hampton-navy/50"> · {p.pick.standby} standby · {p.pick.unavailable} unavailable</span>
        </div>
      )}
      {p.booked && (p.food || p.cupcake) && (
        <div className="text-hampton-navy/80 text-xs mt-0.5">
          {p.food && <span>Food: <strong>{p.food}</strong></span>}
          {p.food && p.cupcake && ' · '}
          {p.cupcake && <span>Cupcakes: <strong>{p.cupcake}</strong></span>}
        </div>
      )}
      {!p.booked && (
        <div className="text-hampton-navy/40 text-xs">{workTypeOf(p.kind) ? `${workTypeOf(p.kind)!.emoji} ${workTypeOf(p.kind)!.label}` : 'By hand'}</div>
      )}
      {p.flags.length > 0 && (
        <div className="text-amber-700 text-xs mt-1">{p.flags.map(f => FLAG_TEXT[f] ?? f).join(' · ')}</div>
      )}
    </>
  )
}

const crewNames = (p: PartyRow) =>
  p.crew.map(c => `${c.firstName}${c.role === 'lead' ? ' (Lead)' : ''}${c.confirmed || c.isOwner ? '' : '?'}`).join(', ')

/** One party on a phone: the whole card opens it. The table is for screens wide enough to hold it. */
function PartyCardMobile({ p }: { p: PartyRow }) {
  const full = p.staffed >= p.needed
  const when = whenParts(p.startsAt, p.endsAt)
  const noLead = !p.leadFilled && kindHasLead(p.kind)
  return (
    <a href={`/admin/crew/parties/${p.id}`} className="block bg-white rounded-2xl shadow-sm p-4 active:bg-[#F6F1EB]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-hampton-navy/60">{when.day}</div>
          <div className="text-hampton-navy font-semibold">{when.time}</div>
        </div>
        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${STATUS_STYLE[p.status] ?? 'bg-gray-100'}`}>{p.status}</span>
      </div>
      <div className="mt-2 text-lg font-semibold text-hampton-navy leading-tight">{p.title}</div>
      <PartyBits p={p} />
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className={`rounded-xl py-2 ${full ? 'bg-emerald-50' : 'bg-red-50'}`}>
          <div className={`text-lg font-bold leading-none ${full ? 'text-emerald-700' : 'text-red-700'}`}>{p.staffed}/{p.needed}</div>
          <div className="text-[11px] uppercase tracking-wide text-hampton-navy/50 mt-1">Staffed</div>
        </div>
        <div className="rounded-xl py-2 bg-[#F6F1EB]">
          <div className="text-lg font-bold leading-none text-hampton-navy">{p.guestCount ?? '—'}</div>
          <div className="text-[11px] uppercase tracking-wide text-hampton-navy/50 mt-1">Kids</div>
        </div>
        <div className="rounded-xl py-2 bg-[#F6F1EB]">
          <div className="text-lg font-bold leading-none text-hampton-navy">{p.status === 'draft' || p.status === 'published' ? p.available : '—'}</div>
          <div className="text-[11px] uppercase tracking-wide text-hampton-navy/50 mt-1">Available</div>
        </div>
      </div>
      {(noLead || p.unconfirmed > 0) && (
        <div className="mt-2 text-xs">
          {noLead && <span className="text-red-700 font-semibold">No Lead</span>}
          {noLead && p.unconfirmed > 0 && ' · '}
          {p.unconfirmed > 0 && <span className="text-amber-700 font-semibold">{p.unconfirmed} unconfirmed</span>}
        </div>
      )}
      <div className="mt-2 text-sm text-hampton-navy/80"><span className="text-hampton-navy/50">Crew: </span>{p.crew.length === 0 ? '—' : crewNames(p)}</div>
    </a>
  )
}

export default function CrewSchedulePage() {
  const api = useAdminApi()
  const sched = useAdminData<Overview>('/api/admin/crew')
  const data = sched.data
  const error = data ? '' : sched.error ?? ''
  const [filter, setFilter] = useState<Filter>('all')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null)
  const [showNew, setShowNew] = useState(false)

  const reload = sched.reload
  const load = useCallback(async () => { await reload() }, [reload])

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
          {data.switches.testLogin ? ', except the test member on /crew/login (the Preview button above)' : ''}. Nothing is sent to anyone.
        </Banner>
      )}
      {error && <Banner tone="error">{error}</Banner>}
      {syncMsg && <Banner tone={syncMsg.tone}>{syncMsg.text}</Banner>}

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <button onClick={syncNow} disabled={syncing} className={BTN_PRIMARY}>{syncing ? 'Syncing…' : 'Sync now'}</button>
        <button onClick={() => setShowNew(v => !v)} className={BTN_GHOST}>{showNew ? 'Close' : 'Add work'}</button>
        {data?.switches.testLogin && <a href="/crew/login" className={BTN_GHOST}>Preview the crew app</a>}
        <span className="text-hampton-navy/50 text-xs">Sync reads booked parties and makes draft crew parties. It never publishes and never removes a spot.</span>
      </div>

      {showNew && <NewPartyForm onCreated={id => { window.location.href = `/admin/crew/parties/${id}` }} />}

      <PicksWaitingCard onDone={load} />

      <WeekendSummaryCard />

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
        <>
          <ul className="md:hidden space-y-3" aria-label="Parties">
            {parties.map(p => <li key={p.id}><PartyCardMobile p={p} /></li>)}
          </ul>
          <div className="hidden md:block bg-white rounded-2xl shadow-sm overflow-x-auto">
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
                      <PartyBits p={p} />
                    </td>
                    <td className="px-4 py-3">{p.guestCount ?? '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={p.staffed >= p.needed ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>{p.staffed}/{p.needed}</span>
                      {!p.leadFilled && kindHasLead(p.kind) && <div className="text-red-700 text-xs">no Lead</div>}
                      {p.unconfirmed > 0 && <div className="text-amber-700 text-xs">{p.unconfirmed} unconfirmed</div>}
                    </td>
                    <td className="px-4 py-3">{p.status === 'draft' || p.status === 'published' ? p.available : '—'}</td>
                    <td className="px-4 py-3 text-hampton-navy/80">{p.crew.length === 0 ? '—' : crewNames(p)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${STATUS_STYLE[p.status] ?? 'bg-gray-100'}`}>{p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {parties.length > 0 && <p className="text-hampton-navy/40 text-xs px-1 py-3">A name with “?” has not confirmed. Allie counts toward staffed when she is on a party.</p>}
    </CrewFrame>
  )
}

interface WItem { name: string; quantity: number }
interface WParty {
  partyId: string; title: string; kind: string; status: string; startsAt: string; endsAt: string; kids: number | null
  child: string | null; parent: string | null; theme: string | null; main: string | null; cupcakes: string | null
  food: WItem[]; drinks: WItem[]; addOns: WItem[]; activities: WItem[]
}
interface Weekend {
  from: string; to: string; parties: WParty[]
  totals: { parties: number; kids: number; pizzaKids: number; bagelKids: number; cupcakes: { label: string; parties: number }[]
    food: WItem[]; drinks: WItem[]; addOns: WItem[]; activities: { name: string; parties: number }[] }
}

const itemText = (xs: WItem[]) => xs.map(i => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name)).join(', ')

/** The upcoming Saturday and Sunday, with what has to be on hand for each party. */
function WeekendSummaryCard() {
  const api = useAdminApi()
  const [w, setW] = useState<Weekend | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    api<Weekend & { error?: string }>('/api/admin/crew/weekend').then(r => {
      if (r.ok) setW(r.data)
      else if (r.status !== 401) setErr(r.data.error || 'Could not read the weekend.')
    })
  }, [api])
  if (err) return <Banner tone="error">{err}</Banner>
  if (!w) return null
  const t = w.totals
  const label = (d: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${d}T12:00:00Z`))
  return (
    <section className="mb-8">
      <h2 className="text-hampton-navy text-xs uppercase tracking-wider font-bold mb-2">This weekend, {label(w.from)} – {label(w.to)}: what to prep</h2>
      {w.parties.length === 0 ? (
        <p className="bg-white rounded-2xl p-5 text-hampton-navy/50 text-sm">No crew parties this weekend.</p>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm p-5 text-sm text-hampton-navy">
          <p className="mb-3">
            <strong>{t.parties}</strong> {t.parties === 1 ? 'party' : 'parties'} · <strong>{t.kids}</strong> kids
            {t.pizzaKids > 0 && <> · Pizza for <strong>{t.pizzaKids}</strong> kids</>}
            {t.bagelKids > 0 && <> · Bagels for <strong>{t.bagelKids}</strong> kids</>}
            {t.cupcakes.length > 0 && <> · Cupcakes: {t.cupcakes.map(c => `${c.label} (${c.parties})`).join(', ')}</>}
          </p>
          {(t.food.length > 0 || t.drinks.length > 0 || t.addOns.length > 0 || t.activities.length > 0) && (
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 mb-4 pb-4 border-b border-hampton-pink/10">
              {t.food.length > 0 && (<><dt className="text-hampton-navy/50">Extra food</dt><dd>{itemText(t.food)}</dd></>)}
              {t.drinks.length > 0 && (<><dt className="text-hampton-navy/50">Drinks</dt><dd>{itemText(t.drinks)}</dd></>)}
              {t.addOns.length > 0 && (<><dt className="text-hampton-navy/50">Add-ons</dt><dd>{itemText(t.addOns)}</dd></>)}
              {t.activities.length > 0 && (<><dt className="text-hampton-navy/50">Activities</dt><dd>{t.activities.map(a => (a.parties > 1 ? `${a.name} (${a.parties} parties)` : a.name)).join(', ')}</dd></>)}
            </dl>
          )}
          <ul className="space-y-3">
            {w.parties.map(p => (
              <li key={p.partyId}>
                <a href={`/admin/crew/parties/${p.partyId}`} className="font-semibold underline">{p.title}</a>
                <span className="text-hampton-navy/60"> · {whenLabel(p.startsAt, p.endsAt)} · {p.kids ?? '?'} kids{p.status === 'draft' ? ' · draft' : ''}</span>
                {(p.child || p.parent) && <div className="text-xs text-hampton-navy/70">{p.child && `Child: ${p.child}`}{p.child && p.parent && ' · '}{p.parent && `Parent: ${p.parent}`}</div>}
                <div className="text-xs text-hampton-navy/80">
                  {[
                    p.main && `${p.main}${p.cupcakes ? ` + ${p.cupcakes} cupcakes` : ''}`,
                    !p.main && p.cupcakes && `${p.cupcakes} cupcakes`,
                    p.food.length > 0 && `Food: ${itemText(p.food)}`,
                    p.drinks.length > 0 && `Drinks: ${itemText(p.drinks)}`,
                    p.addOns.length > 0 && `Add-ons: ${itemText(p.addOns)}`,
                    p.activities.length > 0 && `Activities: ${itemText(p.activities)}`,
                  ].filter(Boolean).join(' · ') || 'Nothing extra booked.'}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/**
 * "Add work": a party by hand, or one of the other kinds of crew work (Clean
 * Floor, Drop-off Event, Balloon Decor, Party Setup, Retail Shift). Picking a
 * kind fills in a title, times, how many people and the studio as the place, and
 * every one of them can be changed before it is created as a draft.
 */
interface WaitingParty {
  id: string; title: string; when: string; open: number; asked: number
  recommendation: { role: 'lead' | 'crew'; name: string }[]
  conflicted: string[]
}

/**
 * Equitable scheduling: the parties waiting on a decision, each with the system's
 * recommendation (worked least recently first). One tap approves every
 * recommendation, earliest party first, and sends ONE round of messages.
 */
function PicksWaitingCard({ onDone }: { onDone: () => void }) {
  const api = useAdminApi()
  const [d, setD] = useState<{ parties: WaitingParty[]; total: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const r = await api<{ parties: WaitingParty[]; total: number }>('/api/admin/crew/picks')
    if (r.ok) setD(r.data)
  }, [api])
  useEffect(() => { load() }, [load])

  async function approveAll() {
    if (!window.confirm('Approve the recommended people for every party listed? Everyone else who asked becomes standby and is told.')) return
    setBusy(true); setErr(''); setMsg('')
    const r = await api<{ error?: string; approved?: number; standby?: number; held?: string[]; dropped?: { memberName: string; partyTitle: string }[] }>(
      '/api/admin/crew/picks', { method: 'POST', body: { action: 'approve_all' } })
    setBusy(false)
    if (!r.ok) { setErr(r.data.error || 'That did not work.'); return }
    const bits = [`Approved ${r.data.approved ?? 0}.`]
    if (r.data.standby) bits.push(`${r.data.standby} moved to standby.`)
    if (r.data.held?.length) bits.push(`Held for you to confirm: ${r.data.held.join(' · ')}`)
    if (r.data.dropped?.length) bits.push(`Dropped overlapping requests: ${r.data.dropped.map(x => `${x.memberName} (${x.partyTitle})`).join(', ')}.`)
    setMsg(bits.join(' '))
    await load()
    onDone()
  }

  if (!d || (d.parties.length === 0 && !msg)) return null
  return (
    <div className="bg-white rounded-2xl shadow-sm p-5 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h2 className="font-semibold text-hampton-navy">Picks waiting ({d.total})</h2>
        {d.parties.length > 0 && <button disabled={busy} onClick={approveAll} className={BTN_PRIMARY}>{busy ? 'Approving…' : 'Approve all recommended'}</button>}
      </div>
      {err && <Banner tone="error">{err}</Banner>}
      {msg && <Banner tone="ok">{msg}</Banner>}
      <ul className="divide-y divide-hampton-pink/10 text-sm">
        {d.parties.map(p => (
          <li key={p.id} className="py-2">
            <a href={`/admin/crew/parties/${p.id}`} className="font-semibold text-hampton-navy underline">{p.title}</a>
            <span className="text-hampton-navy/60"> · {p.when} · {p.asked} asked, {p.open} {p.open === 1 ? 'spot' : 'spots'}</span>
            <div className="text-xs text-hampton-navy/70 mt-0.5">
              Recommended: {p.recommendation.length === 0 ? 'nobody free' : p.recommendation.map(r => `${r.name}${r.role === 'lead' ? ' (Lead)' : ''}`).join(', ')}
              {p.conflicted.length > 0 && <span className="text-amber-800"> · busy: {p.conflicted.join(', ')}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function NewPartyForm({ onCreated }: { onCreated: (id: string) => void }) {
  const api = useAdminApi()
  const [kind, setKind] = useState<'manual' | WorkKind>('manual')
  const [f, setF] = useState({ title: '', date: '', start: '', end: '', guest_count: '', spots: '', location: '', notes_for_crew: '' })
  const work = kind === 'manual' ? null : workTypeOf(kind)
  function pickKind(v: string) {
    const next = v === 'manual' ? null : workTypeOf(v)
    setKind(next ? next.kind : 'manual')
    setF(p => next
      ? { ...p, title: next.label, start: next.defaultStart, end: next.defaultEnd, spots: String(next.defaultSpots), guest_count: '', location: p.location }
      : { ...p, title: p.title === (work?.label ?? '') ? '' : p.title, spots: '' })
  }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF(p => ({ ...p, [k]: e.target.value }))
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    const r = await api<{ id?: string; error?: string }>('/api/admin/crew/parties', {
      method: 'POST',
      body: { ...f, kind, guest_count: f.guest_count === '' ? null : Number(f.guest_count), spots: f.spots === '' ? null : Number(f.spots) },
    })
    setBusy(false)
    if (!r.ok || !r.data.id) { setErr(r.data.error || 'Could not create it.'); return }
    onCreated(r.data.id)
  }
  return (
    <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm p-5 mb-6 grid sm:grid-cols-2 gap-3">
      <p className="sm:col-span-2 text-hampton-navy/60 text-sm">Crew work with no booking behind it. It starts as a draft; you publish it from its page.</p>
      <label className="text-sm text-hampton-navy sm:col-span-2">What kind of work
        <select className={`${INPUT} w-full mt-1`} value={kind} onChange={e => pickKind(e.target.value)}>
          <option value="manual">A party, by hand</option>
          {WORK_TYPES.map(t => <option key={t.kind} value={t.kind}>{t.emoji} {t.label}</option>)}
        </select>
        {work && <span className="block text-hampton-navy/50 text-xs mt-1">{work.blurb} No Party Lead spot: everyone is crew.</span>}
      </label>
      <label className="text-sm text-hampton-navy">Title<input className={`${INPUT} w-full mt-1`} value={f.title} onChange={set('title')} maxLength={80} required /></label>
      <label className="text-sm text-hampton-navy">Date<input type="date" className={`${INPUT} w-full mt-1`} value={f.date} onChange={set('date')} required /></label>
      <label className="text-sm text-hampton-navy">Starts (Eastern)<input type="time" className={`${INPUT} w-full mt-1`} value={f.start} onChange={set('start')} required /></label>
      <label className="text-sm text-hampton-navy">Ends<input type="time" className={`${INPUT} w-full mt-1`} value={f.end} onChange={set('end')} required /></label>
      {work
        ? <label className="text-sm text-hampton-navy">How many people<input type="number" min={1} max={10} className={`${INPUT} w-full mt-1`} value={f.spots} onChange={set('spots')} required /></label>
        : <label className="text-sm text-hampton-navy">Kids (optional)<input type="number" min={0} className={`${INPUT} w-full mt-1`} value={f.guest_count} onChange={set('guest_count')} /></label>}
      <label className="text-sm text-hampton-navy">Location{work ? ' (blank = the studio)' : ''}<input className={`${INPUT} w-full mt-1`} value={f.location} onChange={set('location')} maxLength={200} required={!work} /></label>
      <label className="text-sm text-hampton-navy sm:col-span-2">Notes for crew<textarea className={`${INPUT} w-full mt-1`} rows={2} value={f.notes_for_crew} onChange={set('notes_for_crew')} /></label>
      {err && <p className="sm:col-span-2 text-red-600 text-sm">{err}</p>}
      <div className="sm:col-span-2"><button disabled={busy} className={BTN_PRIMARY}>{busy ? 'Creating…' : 'Create draft'}</button></div>
    </form>
  )
}
