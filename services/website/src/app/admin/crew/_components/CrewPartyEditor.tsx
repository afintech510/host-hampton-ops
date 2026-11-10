'use client'

/**
 * /admin/crew/parties/[id] — one crew party (prompt 04 §3): facts and the
 * booking link, publish / back to draft, the spots (assign, including Allie as
 * Lead; unassign; add; remove an open one; override the count), the shift times,
 * notes for crew, and the standby list. Attendance is Phase 5.
 *
 * `embedded` is the compact form inside a booking tile (Bookings, under "Manage staff"):
 * just what you do to staff one party - assign, unassign, add or remove a spot, the shift
 * times, publish, notes - in tighter cards. The facts, the standby list and "Remove from
 * staffing" stay on the full page, which the tile links to.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { load as refresh } from './adminData'
import { useAdminData } from './adminData'
import { kindHasLead, workTypeOf } from '@/lib/crew/workTypes'
import {
  BTN_GHOST, BTN_PRIMARY, Banner, CrewFrame, FLAG_TEXT, INPUT, STATUS_STYLE, useAdminApi, whenLabel,
} from './adminCrew'

type Conflict = 'on_party' | 'overlap' | 'blocked' | 'not_lead' | 'inactive'
interface Fit { conflicts: Conflict[]; overlapWith: string[] }
interface Slot {
  id: string; role: 'lead' | 'crew'; status: string; memberId: string | null; memberName: string | null; isOwner: boolean
  confirmed: boolean; assignedVia: string | null; assignedBy: string | null
  activeCover: { id: string; status: string; reason: string; note: string | null; offeredToAllAt?: string | null } | null
}
interface Choice { id: string; name: string; canLead: boolean; isOwner: boolean; isTest: boolean; fitCrew: Fit; fitLead: Fit }
interface Shift { crewStart: string; end: string; leadStart: string; defaults: { crewStart: string; end: string; leadStart: string } }
interface PickVolunteer { memberId: string; name: string; rank: number; canLead: boolean; lastWorkedAt: string | null; recent: number }
interface PickPanelView {
  mode: 'pick' | 'first_come'
  openSpots: { slotId: string; role: 'lead' | 'crew' }[]
  volunteers: PickVolunteer[]
  conflicted: { memberId: string; name: string }[]
  standbys: { memberId: string; name: string }[]
  unavailable: { memberId: string; name: string }[]
  noResponse: { memberId: string; name: string }[]
  recommendation: { slotId: string; role: 'lead' | 'crew'; memberId: string; name: string }[]
}
interface PickResult {
  error?: string; assigned?: number; standby?: number; failed?: string[]
  flagged?: { slotId: string; memberId: string; name: string; warnings: string[] }[]
  dropped?: { memberName: string; partyTitle: string }[]
}
interface Special { kind: 'party_helper' | 'face_painter' | 'character' | 'entertainment'; label: string; quantity: number; crewSpot: boolean; action: string }
interface Detail {
  /** What the booking bought that needs a particular person. null = could not be read. */
  special?: Special[] | null
  /** Equitable scheduling: who asked, ranked, and what the system recommends. Null when the party is first come, first served. */
  pick: PickPanelView | null
  party: {
    id: string; title: string; theme: string | null; party_kind: string; starts_at: string; ends_at: string; guest_count: number | null
    location: string; notes_for_crew: string | null; slots_override: number | null; status: string
    published_at: string | null; sync_flags: string[]; booking_id: string | null; updated_by?: string | null
  }
  shift: Shift
  booking: { id: string; ref: string; status: string | null } | null
  about: { child: string | null; childAge: number | null; parent: string | null; food: string | null; cupcake: string | null } | null
  slots: Slot[]
  standbys: { memberId: string; name: string; since: string }[]
  members: Choice[]
  needed: number
  staffed: number
}

const CONFLICT_LABEL: Record<Conflict, string> = {
  on_party: 'on this party', overlap: 'another party then', blocked: 'marked unavailable', not_lead: 'not a Lead', inactive: 'inactive',
}

const SPECIAL_ICON: Record<Special['kind'], string> = { party_helper: '🧤', face_painter: '🎨', character: '🦸', entertainment: '🎤' }

/** An alert for each thing the booking bought that needs a particular person, so it is not missed. */
function SpecialStaffingAlert({ special, staffed, needed }: { special: Special[] | null | undefined; staffed: number; needed: number }) {
  if (special === null) return <Banner tone="warn">Could not read what this booking bought, so special staffing (a helper, a face painter, a character) is not checked. Reload to try again.</Banner>
  if (!special || special.length === 0) return null
  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 mb-4" role="alert" data-special-staffing>
      <div className="text-sm font-bold text-amber-900 mb-2">⚠ Special staffing on this booking</div>
      <ul className="space-y-2">
        {special.map((s, i) => (
          <li key={i} className="text-sm text-amber-950">
            <span aria-hidden="true">{SPECIAL_ICON[s.kind]} </span>
            <span className="font-semibold">{s.label}{s.quantity > 1 ? ` ×${s.quantity}` : ''}</span>
            {s.crewSpot && <span className={staffed >= needed ? ' text-emerald-800' : ' font-semibold text-red-700'}> · {staffed} of {needed} spots filled</span>}
            <div className="text-amber-900/80">{s.action}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function CrewPartyEditor({ partyId, embedded = false, onChanged }: { partyId: string; embedded?: boolean; onChanged?: () => void }) {
  const params = { id: partyId }
  const card = embedded ? 'bg-white rounded-xl border border-hampton-navy/10 p-3' : 'bg-white rounded-2xl shadow-sm p-5'
  const [removeConfirm, setRemoveConfirm] = useState(false)

  const api = useAdminApi()
  const detail = useAdminData<Detail>(`/api/admin/crew/parties/${params.id}`, 15_000)
  const d = detail.data
  const [actionError, setError] = useState('')
  const error = actionError || (d ? '' : detail.error ?? '')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  /** Who is chosen for each open spot, applied together by the one Assign button. */
  const [picks, setPicks] = useState<Record<string, string>>({})
  /** Picks the server flagged (another party then, marked unavailable…), waiting for one "Assign anyway". */
  const [pending, setPending] = useState<{ slotId: string; memberId: string; who: string; warnings: string[] }[]>([])

  const reload = detail.reload
  const load = useCallback(async () => {
    await reload()
    onChanged?.()
    void refresh('/api/admin/crew')
    void refresh('/api/admin/crew-app/bookings')
  }, [reload, onChanged])

  async function act(body: Record<string, unknown>, done?: string) {
    setBusy(true)
    setError('')
    setNotice('')
    const r = await api<{ error?: string; warning?: string; added?: number }>(`/api/admin/crew/parties/${params.id}`, { method: 'PATCH', body })
    setBusy(false)
    if (!r.ok) {
      setError(r.data.error || 'That did not work.')
      await load()
      return
    }
    if (r.data.warning) setNotice(r.data.warning)
    else if (done) setNotice(done)
    await load()
  }

  /**
   * Assign every chosen spot in one click. One at a time, so each is judged
   * against the party as the one before it left it. A pick the server flags is
   * not forced: it is listed once, with a single "Assign anyway" for the lot.
   */
  async function assignAll(chosen: { slotId: string; memberId: string; who: string; force: boolean }[]) {
    setBusy(true)
    setError('')
    setNotice('')
    // A party the manager picks: one call approves everyone chosen, logs it, moves the rest who asked to
    // standby once it is full, drops overlapping requests and sends one round of messages.
    if (d?.pick) {
      const r = await api<PickResult>(`/api/admin/crew/parties/${params.id}`, {
        method: 'PATCH',
        body: { action: 'approve_picks', picks: chosen.map(c => ({ slotId: c.slotId, memberId: c.memberId })), force: chosen.every(c => c.force) },
      })
      if (!r.ok) { setError(r.data.error || 'That did not work.'); await load(); setBusy(false); return }
      setPicks({})
      setPending((r.data.flagged ?? []).map(f => ({ slotId: f.slotId, memberId: f.memberId, who: f.name, warnings: f.warnings })))
      const bits: string[] = []
      if (r.data.assigned) bits.push(`Approved ${r.data.assigned}.`)
      if (r.data.standby) bits.push(`${r.data.standby} moved to standby.`)
      if (r.data.dropped?.length) bits.push(`Dropped overlapping requests: ${r.data.dropped.map(x => `${x.memberName} (${x.partyTitle})`).join(', ')}.`)
      if (bits.length) setNotice(bits.join(' '))
      if (r.data.failed?.length) setError(r.data.failed.join(' · '))
      await load()
      setBusy(false)
      return
    }
    const flagged: typeof pending = []
    const failed: string[] = []
    const done = new Set<string>()
    for (const c of chosen) {
      const r = await api<{ error?: string; warnings?: string[] }>(`/api/admin/crew/parties/${params.id}`, {
        method: 'PATCH', body: { action: 'assign', slotId: c.slotId, memberId: c.memberId, force: c.force },
      })
      if (r.ok) done.add(c.slotId)
      else if (r.status === 409 && r.data.warnings?.length) flagged.push({ slotId: c.slotId, memberId: c.memberId, who: c.who, warnings: r.data.warnings })
      else failed.push(`${c.who}: ${r.data.error || 'that did not work'}`)
    }
    setPicks(prev => Object.fromEntries(Object.entries(prev).filter(([slotId]) => !done.has(slotId))))
    setPending(flagged)
    if (failed.length) setError(failed.join(' · '))
    if (done.size) setNotice(`Assigned ${done.size} ${done.size === 1 ? 'spot' : 'spots'}.${flagged.length ? ' See below for the rest.' : ''}`)
    await load()
    setBusy(false)
  }

  /** A late cancel nobody took: offer it to everyone free that day, or put someone on it. */
  async function coverAct(swapId: string, body: Record<string, unknown>, done: (data: { asked?: number }) => string) {
    setBusy(true)
    setError('')
    setNotice('')
    const r = await api<{ error?: string; asked?: number }>(`/api/admin/crew/swaps/${swapId}`, { method: 'PATCH', body })
    setBusy(false)
    if (!r.ok) setError(r.data.error || 'That did not work.')
    else setNotice(done(r.data))
    await load()
  }

  if (!d) return <EditorFrame embedded={embedded} active="" title="Crew party"><Banner tone={error ? 'error' : 'info'}>{error || 'Loading…'}</Banner></EditorFrame>

  const p = d.party
  const live = p.status === 'draft' || p.status === 'published'
  const liveSlots = d.slots.filter(s => s.status !== 'cancelled')
  const anyoneOn = liveSlots.some(s => s.memberId && ['assigned', 'completed', 'no_show'].includes(s.status))
  const nameOf = (id: string) => d.members.find(m => m.id === id)?.name ?? 'Someone'
  const chosen = liveSlots
    .filter(s => !s.memberId && picks[s.id])
    .map(s => ({ slotId: s.id, memberId: picks[s.id], who: nameOf(picks[s.id]), force: false }))
  const takenElsewhere = (slotId: string) => new Set(Object.entries(picks).filter(([id, m]) => id !== slotId && m).map(([, m]) => m))

  return (
    <EditorFrame embedded={embedded}
      active=""
      title={p.title}
      sub={
        <span>
          {whenLabel(p.starts_at, p.ends_at)} · {p.guest_count ?? '?'} kids · {p.location}
          {' · '}
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${STATUS_STYLE[p.status] ?? ''}`}>{p.status}</span>
        </span>
      }
    >
      {!embedded && <Link href={d.booking ? `/admin/crew/bookings?party=${d.booking.id}` : '/admin/crew/bookings'} className={`${BTN_GHOST} inline-flex mb-4`}>Back to Bookings</Link>}
      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="ok">{notice}</Banner>}
      <SpecialStaffingAlert special={d.special} staffed={d.staffed} needed={d.needed} />
      {p.sync_flags.length > 0 && (
        <Banner tone="warn">
          {p.sync_flags.map(f => (
            <span key={f} className="mr-3">
              {FLAG_TEXT[f] ?? f}
              {f === 'time_changed' && (
                <button disabled={busy} onClick={() => act({ action: 'clear_flag', flag: f }, 'Cleared.')} className="ml-2 underline">clear</button>
              )}
            </span>
          ))}
        </Banner>
      )}

      <div className={embedded ? 'grid gap-3' : 'grid lg:grid-cols-3 gap-5'}>
        <section className={embedded ? 'space-y-3' : 'lg:col-span-2 space-y-5'}>
          {d.pick && (
            <PickCard pick={d.pick} busy={busy} live={live} cardClass={card}
              onApprove={() => assignAll(d.pick!.recommendation.map(r => ({ slotId: r.slotId, memberId: r.memberId, who: r.name, force: false })))}
              onAssign={(slotId, memberId, who) => assignAll([{ slotId, memberId, who, force: false }])}
              onStandby={(memberId, who) => act({ action: 'standby', memberId }, `${who} is on standby.`)} />
          )}
          <div className={card}>
            <div className={embedded ? 'mb-2' : 'mb-4'}>
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold text-hampton-navy">Spots</h2>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${d.staffed >= d.needed ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                  {d.staffed} of {d.needed} staffed
                </span>
              </div>
              <div className={`flex flex-col sm:flex-row sm:flex-wrap gap-2 empty:hidden ${embedded ? 'mt-2' : 'mt-3'}`}>
                {live && liveSlots.some(s => !s.memberId) && (
                  <button disabled={busy || chosen.length === 0} onClick={() => assignAll(chosen)} className={`${BTN_PRIMARY} w-full sm:w-auto`}>
                    {busy ? 'Assigning…' : chosen.length > 1 ? `Assign ${chosen.length}` : 'Assign'}
                  </button>
                )}
                {p.status === 'draft' && <button disabled={busy} onClick={() => act({ action: 'publish' }, 'Published. Eligible crew can see it now.')} className={`${BTN_PRIMARY} w-full sm:w-auto`}>Publish</button>}
                {p.status === 'published' && (
                  <button disabled={busy || anyoneOn} title={anyoneOn ? 'Only while nobody is on it' : ''} onClick={() => act({ action: 'unpublish' }, 'Back to draft.')} className={`${BTN_GHOST} w-full sm:w-auto`}>
                    Back to draft
                  </button>
                )}
              </div>
              {p.status === 'published' && anyoneOn && (
                <p className="text-xs text-hampton-navy/50 mt-2">Back to draft works only while nobody is on the party.</p>
              )}
            </div>

            <ul className={embedded ? 'space-y-2' : 'space-y-3'}>
              {d.slots.filter(s => s.status !== 'cancelled').map(s => (
                <SlotRow key={s.id} slot={s} members={d.members} busy={busy} live={live} compact={embedded}
                  pick={picks[s.id] ?? ''} taken={takenElsewhere(s.id)}
                  onPick={memberId => setPicks(prev => ({ ...prev, [s.id]: memberId }))}
                  onUnassign={() => act({ action: 'unassign', slotId: s.id }, 'Unassigned; the spot is open again.')}
                  onRemove={() => act({ action: 'remove_spot', slotId: s.id }, 'Spot removed.')}
                  onOfferAll={swapId => coverAct(swapId, { action: 'offer_all' }, x => `Offered to everyone free that day (${x.asked ?? 0} asked).`)}
                  onAssignCover={(swapId, memberId) => coverAct(swapId, { action: 'assign', memberId }, () => 'Assigned. Both of them have been told.')}
                />
              ))}
            </ul>

            {pending.length > 0 && (
              <div className="mt-4 bg-amber-50 text-amber-900 rounded-lg p-4 text-sm">
                {pending.map(c => (
                  <div key={c.slotId} className="mb-2">
                    <p className="font-semibold">{c.who}</p>
                    {c.warnings.map((w, i) => <p key={i}>{w}</p>)}
                  </div>
                ))}
                <div className="flex gap-2 mt-3">
                  <button disabled={busy} onClick={() => assignAll(pending.map(c => ({ slotId: c.slotId, memberId: c.memberId, who: c.who, force: true })))} className={BTN_PRIMARY}>
                    {pending.length > 1 ? 'Assign them anyway' : 'Assign anyway'}
                  </button>
                  <button onClick={() => setPending([])} className={BTN_GHOST}>Cancel</button>
                </div>
              </div>
            )}

            {live && (
              <div className={`border-t border-hampton-pink/10 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 ${embedded ? 'mt-3 pt-3' : 'mt-4 pt-4'}`}>
                <button disabled={busy || liveSlots.length >= 10} onClick={() => act({ action: 'add_spot' }, 'Spot added.')} className={`${BTN_GHOST} w-full sm:w-auto`}>+ Add a spot</button>
                <CountOverride value={p.slots_override} busy={busy} onSave={v => act({ action: 'set_count', value: v }, 'Count saved.')} />
              </div>
            )}
          </div>

          {live && (
            <div className={`${card} ${embedded ? 'space-y-3' : 'space-y-4'}`}>
              <h2 className="font-semibold text-hampton-navy">Shift and notes</h2>
              <ShiftEditor shift={d.shift} rental={!kindHasLead(p.party_kind)} busy={busy}
                onSave={v => act({ action: 'shift', ...v }, 'Shift saved.')} />
              <Notes initial={p.notes_for_crew ?? ''} busy={busy} onSave={v => act({ action: 'fields', notes_for_crew: v }, 'Notes saved.')} />
            </div>
          )}
        </section>

        {!embedded && <aside className="space-y-5">
          <div className="bg-white rounded-2xl shadow-sm p-5 text-sm space-y-1.5 text-hampton-navy/80">
            <h2 className="font-semibold text-hampton-navy mb-2">Facts</h2>
            <p>Kind: {workTypeOf(p.party_kind) ? `${workTypeOf(p.party_kind)!.emoji} ${workTypeOf(p.party_kind)!.label}` : p.party_kind.replace(/_/g, ' ')}</p>
            {p.party_kind === 'studio_rental' && (
              <p className="text-hampton-navy/60 text-xs">A room rental with a Party Helper: the time is the helper&apos;s, and a Lead or a helper can take each spot. There is no Lead spot.</p>
            )}
            {workTypeOf(p.party_kind) && (
              <p className="text-hampton-navy/60 text-xs">Crew work, not a party: everyone is crew, there is no Party Lead spot, and the shift is the whole time.</p>
            )}
            {!workTypeOf(p.party_kind) && <p>Theme: {p.theme ?? '—'}</p>}
            {d.about && (
              <>
                {d.about.child && <p>Child: <strong>{d.about.child}{d.about.childAge ? `, ${d.about.childAge}` : ''}</strong></p>}
                {d.about.parent && <p>Parent: <strong>{d.about.parent}</strong></p>}
                {d.about.food && <p>Food: <strong>{d.about.food}</strong></p>}
                {d.about.cupcake && <p>Cupcakes: <strong>{d.about.cupcake}</strong></p>}
              </>
            )}
            <p>Spot count: {p.slots_override ? `${p.slots_override} (set by hand)` : 'from the guest count'}</p>
            {d.booking ? (
              <p><a className="underline" href={`/admin/lead/${encodeURIComponent(d.booking.ref)}`}>Open the booking</a> ({d.booking.status ?? '—'})</p>
            ) : <p>Made by hand, no booking.</p>}
            {p.updated_by && <p className="text-hampton-navy/40 text-xs">Last changed by {p.updated_by}</p>}
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-5 text-sm">
            <h2 className="font-semibold text-hampton-navy mb-2">Standbys</h2>
            {d.standbys.length === 0 ? <p className="text-hampton-navy/50">Nobody yet.</p> : (
              <ul className="space-y-1">{d.standbys.map(s => <li key={s.memberId}>{s.name}</li>)}</ul>
            )}
            <p className="text-hampton-navy/40 text-xs mt-2">Crew who said they can cover. They are asked first if someone cancels late.</p>
          </div>
        </aside>}
      </div>
      {!embedded && (live || (p.status === 'cancelled' && actionError)) && <div className="mt-5 rounded-xl border border-red-200 p-4">
        {removeConfirm ? <>
          <p className="text-sm text-hampton-navy mb-3">Remove {p.title} from staffing? Assigned staff and cover requests will be cancelled. The booking and staffing history are kept.</p>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} className={BTN_PRIMARY} onClick={async () => { await act({ action: 'remove' }, 'Removed from staffing.'); setRemoveConfirm(false) }}>Remove from staffing</button>
            <button disabled={busy} className={BTN_GHOST} onClick={() => setRemoveConfirm(false)}>Keep it</button>
          </div>
        </> : <button disabled={busy} className={`${BTN_GHOST} text-red-700`} onClick={() => setRemoveConfirm(true)}>Remove from staffing</button>}
      </div>}
    </EditorFrame>
  )
}

const shortDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })

/** "never worked", "Oct 12 (24 days ago)" or "Nov 20 (approved, ahead)". */
function lastWorkedLabel(iso: string | null): string {
  if (!iso) return 'never worked'
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return `${shortDay(iso)} (${days > 0 ? `${days} day${days === 1 ? '' : 's'} ago` : days === 0 ? 'today' : 'approved, ahead'})`
}

/**
 * Everyone who said they are available to work this party, best placed first (worked
 * least recently, then fewest in the last 30 days), with the system's recommendation for
 * the open spots. The manager finalizes it: each person goes ON the party (a spot) or into
 * the STANDBY pool, one tap each, or "Approve recommended" does the whole recommendation.
 * Being put on a spot is the confirmation; nobody is asked to accept it.
 */
function PickCard({ pick, busy, live, cardClass, onApprove, onAssign, onStandby }: {
  pick: PickPanelView; busy: boolean; live: boolean; cardClass: string; onApprove: () => void
  onAssign: (slotId: string, memberId: string, name: string) => void; onStandby: (memberId: string, name: string) => void
}) {
  const rec = new Map(pick.recommendation.map(r => [r.memberId, r.role]))
  const names = (l: { name: string }[]) => l.map(x => x.name).join(', ')
  /** The spot a person goes on: the one recommended for them, else a crew spot, else (a Lead) the Lead spot. */
  const spotFor = (memberId: string, canLead: boolean): string | null =>
    pick.recommendation.find(r => r.memberId === memberId)?.slotId
    ?? pick.openSpots.find(sp => sp.role === 'crew')?.slotId
    ?? (canLead ? pick.openSpots.find(sp => sp.role === 'lead')?.slotId ?? null : null)
  const noSpot = pick.openSpots.length === 0
  return (
    <div className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h2 className="font-semibold text-hampton-navy">Available to work this ({pick.volunteers.length + pick.conflicted.length})</h2>
        {live && pick.openSpots.length > 0 && pick.recommendation.length > 0 && (
          <button disabled={busy} onClick={onApprove} className={`${BTN_PRIMARY} w-full sm:w-auto`}>
            Approve recommended ({pick.recommendation.length})
          </button>
        )}
      </div>
      {pick.volunteers.length === 0 ? (
        <p className="text-hampton-navy/50 text-sm">Nobody has said they are available yet.</p>
      ) : (
        <ol className="space-y-3 text-sm">
          {pick.volunteers.map(v => {
            const spot = spotFor(v.memberId, v.canLead)
            return (
              <li key={v.memberId} className="rounded-xl bg-[#F6F1EB]/60 p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="w-5 text-hampton-navy/40 font-semibold">{v.rank}</span>
                  <span className="font-semibold text-hampton-navy">{v.name}</span>
                  {v.canLead && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-hampton-navy text-[#F6F1EB]">Lead</span>}
                  {rec.has(v.memberId) && (
                    <span className="ml-auto text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800">
                      ★ recommended: {rec.get(v.memberId) === 'lead' ? 'Lead spot' : 'crew spot'}
                    </span>
                  )}
                </div>
                <div className="text-hampton-navy/60 text-xs mt-0.5 pl-8">{lastWorkedLabel(v.lastWorkedAt)} · {v.recent} in 30 days</div>
                {live && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <button disabled={busy || !spot} title={spot ? '' : 'No open spot for them'} onClick={() => spot && onAssign(spot, v.memberId, v.name)} className={BTN_PRIMARY}>
                      Put on party
                    </button>
                    <button disabled={busy} onClick={() => onStandby(v.memberId, v.name)} className={BTN_GHOST}>
                      Standby
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
      {live && noSpot && pick.volunteers.length > 0 && (
        <p className="text-hampton-navy/50 text-xs mt-2">Every spot is filled, so Standby is the only choice. Add a spot below to put more people on.</p>
      )}
      {pick.conflicted.length > 0 && (
        <p className="text-amber-800 bg-amber-50 rounded-lg p-3 text-xs mt-3">
          Said they are available, but now busy or marked unavailable then, so not recommended: {names(pick.conflicted)}.
        </p>
      )}
      {pick.standbys.length > 0 && (
        <div className="mt-3 pt-3 border-t border-hampton-pink/10">
          <p className="text-xs font-semibold text-hampton-navy mb-1">Standby pool ({pick.standbys.length})</p>
          <ul className="text-sm space-y-1">
            {pick.standbys.map(sb => {
              const spot = spotFor(sb.memberId, false)
              return (
                <li key={sb.memberId} className="flex items-center justify-between gap-3">
                  <span className="text-hampton-navy">{sb.name}</span>
                  {live && spot && (
                    <button disabled={busy} onClick={() => onAssign(spot, sb.memberId, sb.name)} className="text-sm font-semibold underline text-hampton-navy disabled:opacity-50 min-h-[40px] px-1">
                      Put on party
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <div className="mt-3 pt-3 border-t border-hampton-pink/10 text-xs text-hampton-navy/70 space-y-1">
        {pick.unavailable.length > 0 && <p><strong>Not available:</strong> {names(pick.unavailable)}</p>}
        {pick.noResponse.length > 0 && <p><strong>Not answered yet:</strong> {names(pick.noResponse)}</p>}
      </div>
    </div>
  )
}

/** Small, tappable, and always at the same edge of the card, whatever the name or status wraps to. */
const BTN_SMALL_DANGER = 'shrink-0 text-sm font-semibold rounded-full px-3.5 min-h-[40px] border-2 border-red-200 text-red-700 bg-white disabled:opacity-50'
const CHIP = 'text-[11px] font-semibold px-2 py-0.5 rounded-full'

function SlotRow({ slot, members, busy, live, compact = false, pick, taken, onPick, onUnassign, onRemove, onOfferAll, onAssignCover }: {
  slot: Slot; members: Choice[]; busy: boolean; live: boolean
  /** Tighter, for the editor inside a booking tile. */
  compact?: boolean
  /** The person chosen for this open spot, and the people already chosen for the others. The page's one Assign button applies them. */
  pick: string; taken: ReadonlySet<string>; onPick: (memberId: string) => void
  onUnassign: () => void; onRemove: () => void
  onOfferAll: (swapId: string) => void; onAssignCover: (swapId: string, memberId: string) => void
}) {
  const [coverPick, setCoverPick] = useState('')
  const lead = slot.role === 'lead'
  const options = members.filter(m => !lead || m.canLead || m.isOwner)

  // An open spot: one dashed card, the role named once, the choice full width.
  if (!slot.memberId) {
    return (
      <li className={`rounded-xl border-2 border-dashed border-hampton-pink/40 ${compact ? 'p-2' : 'p-3'}`}>
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-hampton-navy/70">{lead ? 'Party Lead spot' : 'Crew spot'} <span className="font-normal text-hampton-navy/50">· open</span></span>
          {live && !lead && <button disabled={busy} onClick={onRemove} className="text-sm text-hampton-navy/60 underline min-h-[40px] px-1 disabled:opacity-50">Remove spot</button>}
        </div>
        {live && (
          <select value={pick} onChange={e => onPick(e.target.value)} className={`${INPUT} w-full mt-1`} aria-label={`Choose for the ${lead ? 'Party Lead' : 'crew'} spot`} disabled={busy}>
            <option value="">Choose who works it…</option>
            {options.map(m => {
              const fit = lead ? m.fitLead : m.fitCrew
              const notes = fit.conflicts.map(c => CONFLICT_LABEL[c])
              return (
                <option key={m.id} value={m.id} disabled={fit.conflicts.includes('on_party') || taken.has(m.id)}>
                  {m.name}{m.isTest ? ' [test]' : ''}
                  {notes.length ? ` — ${notes.join(', ')}` : ''}
                </option>
              )
            })}
          </select>
        )}
      </li>
    )
  }

  // A filled spot: who on the left (initial, name, one line of chips), the one action on the right.
  const via = slot.assignedVia === 'admin' ? 'Assigned' : slot.assignedVia === 'cover' ? 'Covering' : slot.assignedVia ? 'Claimed' : ''
  return (
    <li className={`rounded-xl bg-[#F6F1EB]/60 ${compact ? 'p-2' : 'p-3'}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden className={`shrink-0 ${compact ? 'w-8 h-8 text-sm' : 'w-10 h-10'} rounded-full flex items-center justify-center font-bold ${lead ? 'bg-hampton-navy text-[#F6F1EB]' : 'bg-white text-hampton-navy border border-hampton-pink/30'}`}>
          {(slot.memberName ?? '?').trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-hampton-navy leading-tight break-words">{slot.memberName}</p>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {lead && <span className={`${CHIP} bg-hampton-navy text-[#F6F1EB]`}>Party Lead</span>}
            {via && <span className={`${CHIP} bg-white text-hampton-navy/60 border border-hampton-pink/20`}>{via}</span>}
            {slot.status !== 'assigned' && <span className={`${CHIP} bg-violet-100 text-violet-800`}>{slot.status.replace(/_/g, ' ')}</span>}
          </div>
        </div>
        {live && slot.status === 'assigned' && !slot.activeCover && (
          <button
            disabled={busy}
            onClick={() => { if (window.confirm(`Take ${slot.memberName} off this party?`)) onUnassign() }}
            className={BTN_SMALL_DANGER}
          >
            Unassign
          </button>
        )}
      </div>
      {slot.activeCover && (
        <div className="mt-3 rounded-lg bg-amber-50 text-amber-900 p-3 text-sm space-y-2">
          <p>
            Can&apos;t make it ({slot.activeCover.reason}{slot.activeCover.note ? `: ${slot.activeCover.note}` : ''}) · cover {slot.activeCover.status}
            {slot.activeCover.offeredToAllAt ? ' · offered to everyone' : ''}
          </p>
          {live && (
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
              {!slot.activeCover.offeredToAllAt && (
                <button disabled={busy} onClick={() => onOfferAll(slot.activeCover!.id)} className={`${BTN_GHOST} w-full sm:w-auto`}>Offer to everyone free that day</button>
              )}
              <select value={coverPick} onChange={e => setCoverPick(e.target.value)} className={`${INPUT} w-full sm:w-auto`} aria-label="Assign cover">
                <option value="">Put someone on it…</option>
                {options.filter(m => m.id !== slot.memberId).map(m => {
                  const fit = lead ? m.fitLead : m.fitCrew
                  const notes = fit.conflicts.map(c => CONFLICT_LABEL[c])
                  return (
                    <option key={m.id} value={m.id} disabled={fit.conflicts.includes('on_party')}>
                      {m.name}{m.isTest ? ' [test]' : ''}{notes.length ? ` — ${notes.join(', ')}` : ''}
                    </option>
                  )
                })}
              </select>
              <button disabled={busy || !coverPick} onClick={() => onAssignCover(slot.activeCover!.id, coverPick)} className={`${BTN_PRIMARY} w-full sm:w-auto`}>Assign cover</button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function CountOverride({ value, busy, onSave }: { value: number | null; busy: boolean; onSave: (v: number | null) => void }) {
  const [v, setV] = useState(value == null ? '' : String(value))
  useEffect(() => { setV(value == null ? '' : String(value)) }, [value])
  return (
    <div className="text-sm text-hampton-navy">
      <label htmlFor="spot-count" className="block text-hampton-navy/70 mb-1">Spot count <span className="text-hampton-navy/40">(blank = from the guest count)</span></label>
      <div className="flex items-center gap-2">
        <input id="spot-count" type="number" min={1} max={10} value={v} onChange={e => setV(e.target.value)} placeholder="auto" className={`${INPUT} w-24`} />
        <button disabled={busy} onClick={() => onSave(v === '' ? null : Number(v))} className={BTN_GHOST}>Set</button>
      </div>
    </div>
  )
}

/**
 * The shift for this party: when the crew arrive, when everyone is done, and when
 * the Party Lead arrives. Defaults are 30 minutes before and after the party, and an
 * hour before for the Lead (the shift settings). A time left at its default is sent
 * as null, so a later change to the default still applies to this party.
 */
function ShiftEditor({ shift, rental, busy, onSave }: {
  shift: Shift; rental: boolean; busy: boolean
  onSave: (v: { crew_start: string | null; end: string | null; lead_start: string | null }) => void
}) {
  const [crew, setCrew] = useState(shift.crewStart)
  const [end, setEnd] = useState(shift.end)
  const [lead, setLead] = useState(shift.leadStart)
  useEffect(() => { setCrew(shift.crewStart); setEnd(shift.end); setLead(shift.leadStart) }, [shift.crewStart, shift.end, shift.leadStart])
  const dirty = crew !== shift.crewStart || end !== shift.end || lead !== shift.leadStart
  const orNull = (v: string, def: string) => (v === def ? null : v)
  return (
    <div className="text-sm text-hampton-navy">
      <p className="font-medium mb-1">Shift</p>
      <div className="flex flex-wrap items-end gap-3">
        {!rental && (
          <label>Party Lead arrives
            <input type="time" value={lead} onChange={e => setLead(e.target.value)} className={`${INPUT} block mt-1`} />
          </label>
        )}
        <label>{rental ? 'Crew arrives' : 'Helpers arrive'}
          <input type="time" value={crew} onChange={e => setCrew(e.target.value)} className={`${INPUT} block mt-1`} />
        </label>
        <label>Everyone done
          <input type="time" value={end} onChange={e => setEnd(e.target.value)} className={`${INPUT} block mt-1`} />
        </label>
        <button disabled={busy || !dirty} className={BTN_GHOST}
          onClick={() => onSave({ crew_start: orNull(crew, shift.defaults.crewStart), end: orNull(end, shift.defaults.end), lead_start: orNull(lead, shift.defaults.leadStart) })}>
          Save shift
        </button>
        {(crew !== shift.defaults.crewStart || end !== shift.defaults.end || lead !== shift.defaults.leadStart) && (
          <button type="button" className="underline text-xs text-hampton-navy/60" onClick={() => { setCrew(shift.defaults.crewStart); setEnd(shift.defaults.end); setLead(shift.defaults.leadStart) }}>
            back to the default
          </button>
        )}
      </div>
      <p className="text-hampton-navy/50 text-xs mt-1">Eastern time. Default: helpers 30 minutes before the party to 30 after; the Party Lead 1 hour before. Crew see their own time.</p>
    </div>
  )
}

function Notes({ initial, busy, onSave }: { initial: string; busy: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(initial)
  useEffect(() => { setV(initial) }, [initial])
  return (
    <label className="block text-sm text-hampton-navy">
      Notes for crew (only the people working it see these)
      <textarea value={v} onChange={e => setV(e.target.value)} rows={2} maxLength={2000} className={`${INPUT} w-full mt-1`} />
      {v !== initial && <button disabled={busy} onClick={() => onSave(v)} className={`${BTN_GHOST} mt-2`}>Save notes</button>}
    </label>
  )
}

function EditorFrame({ embedded, children, ...props }: { embedded: boolean; children: ReactNode; active: string; title: string; sub?: ReactNode }) {
  return embedded ? <div>{children}</div> : <CrewFrame {...props}>{children}</CrewFrame>
}
