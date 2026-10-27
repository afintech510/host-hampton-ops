'use client'

/**
 * /admin/crew/parties/[id] — one crew party (prompt 04 §3): facts and the
 * booking link, publish / back to draft, the spots (assign, including Allie as
 * Lead; unassign; add; remove an open one; override the count), extra pay per
 * person, notes for crew, and the standby list. Attendance is Phase 5.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  BTN_DANGER, BTN_GHOST, BTN_PRIMARY, Banner, CrewFrame, FLAG_TEXT, INPUT, LoginGate, STATUS_STYLE, money, useAdminApi, whenLabel,
} from '../../_components/adminCrew'

type Conflict = 'on_party' | 'overlap' | 'blocked' | 'not_lead' | 'inactive'
interface Fit { conflicts: Conflict[]; overlapWith: string[] }
interface Slot {
  id: string; role: 'lead' | 'crew'; status: string; memberId: string | null; memberName: string | null; isOwner: boolean
  confirmed: boolean; assignedVia: string | null; assignedBy: string | null
  activeCover: { id: string; status: string; reason: string; note: string | null } | null
}
interface Choice { id: string; name: string; canLead: boolean; isOwner: boolean; isTest: boolean; crewRateCents: number; leadRateCents: number; fitCrew: Fit; fitLead: Fit }
interface Detail {
  party: {
    id: string; title: string; theme: string | null; party_kind: string; starts_at: string; ends_at: string; guest_count: number | null
    location: string; notes_for_crew: string | null; slots_override: number | null; extra_flat_cents: number; status: string
    published_at: string | null; sync_flags: string[]; booking_id: string | null; updated_by?: string | null
  }
  booking: { id: string; ref: string; status: string | null } | null
  slots: Slot[]
  standbys: { memberId: string; name: string; since: string }[]
  members: Choice[]
  needed: number
  staffed: number
}

const CONFLICT_LABEL: Record<Conflict, string> = {
  on_party: 'on this party', overlap: 'another party then', blocked: 'marked unavailable', not_lead: 'not a Lead', inactive: 'inactive',
}

export default function CrewPartyPage({ params }: { params: { id: string } }) {
  const api = useAdminApi()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ slotId: string; memberId: string; warnings: string[] } | null>(null)

  const load = useCallback(async (): Promise<'ok' | 'unauthorized' | 'error'> => {
    const r = await api<Detail & { error?: string }>(`/api/admin/crew/parties/${params.id}`)
    if (r.status === 401) { setAuthed(false); return 'unauthorized' }
    setAuthed(true)
    if (!r.ok) { setError(r.data.error || 'Could not read the party.'); return 'error' }
    setD(r.data)
    return 'ok'
  }, [api, params.id])

  useEffect(() => { load() }, [load])

  async function act(body: Record<string, unknown>, done?: string) {
    setBusy(true)
    setError('')
    setNotice('')
    const r = await api<{ error?: string; warnings?: string[]; warning?: string; added?: number }>(`/api/admin/crew/parties/${params.id}`, { method: 'PATCH', body })
    setBusy(false)
    if (!r.ok) {
      if (r.status === 409 && r.data.warnings?.length && body.action === 'assign') {
        setPending({ slotId: body.slotId as string, memberId: body.memberId as string, warnings: r.data.warnings })
        return
      }
      setError(r.data.error || 'That did not work.')
      await load()
      return
    }
    setPending(null)
    if (r.data.warning) setNotice(r.data.warning)
    else if (done) setNotice(done)
    await load()
  }

  if (authed === null) return <div className="min-h-screen bg-[#F6F1EB] grid place-items-center text-hampton-navy/60">Loading…</div>
  if (!authed) return <LoginGate title="Crew party" onSignedIn={load} />
  if (!d) return <CrewFrame active="" title="Crew party"><Banner tone="error">{error || 'Loading…'}</Banner></CrewFrame>

  const p = d.party
  const live = p.status === 'draft' || p.status === 'published'
  const liveSlots = d.slots.filter(s => s.status !== 'cancelled')
  const anyoneOn = liveSlots.some(s => s.memberId && ['assigned', 'completed', 'no_show'].includes(s.status))

  return (
    <CrewFrame
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
      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="ok">{notice}</Banner>}
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

      <div className="grid lg:grid-cols-3 gap-5">
        <section className="lg:col-span-2 space-y-5">
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="font-semibold text-hampton-navy">Spots — {d.staffed}/{d.needed} staffed</h2>
              <div className="flex flex-wrap gap-2">
                {p.status === 'draft' && <button disabled={busy} onClick={() => act({ action: 'publish' }, 'Published. Crew can see it now (once the crew app is launched).')} className={BTN_PRIMARY}>Publish</button>}
                {p.status === 'published' && (
                  <button disabled={busy || anyoneOn} title={anyoneOn ? 'Only while nobody is on it' : ''} onClick={() => act({ action: 'unpublish' }, 'Back to draft.')} className={BTN_GHOST}>
                    Back to draft
                  </button>
                )}
              </div>
            </div>

            <ul className="divide-y divide-hampton-pink/10">
              {d.slots.filter(s => s.status !== 'cancelled').map(s => (
                <SlotRow key={s.id} slot={s} members={d.members} busy={busy} live={live}
                  onAssign={(memberId, force) => act({ action: 'assign', slotId: s.id, memberId, force }, 'Assigned.')}
                  onUnassign={() => act({ action: 'unassign', slotId: s.id }, 'Unassigned; the spot is open again.')}
                  onRemove={() => act({ action: 'remove_spot', slotId: s.id }, 'Spot removed.')}
                />
              ))}
            </ul>

            {pending && (
              <div className="mt-4 bg-amber-50 text-amber-900 rounded-lg p-4 text-sm">
                {pending.warnings.map((w, i) => <p key={i}>{w}</p>)}
                <div className="flex gap-2 mt-3">
                  <button disabled={busy} onClick={() => act({ action: 'assign', slotId: pending.slotId, memberId: pending.memberId, force: true }, 'Assigned despite the conflict.')} className={BTN_PRIMARY}>Assign anyway</button>
                  <button onClick={() => setPending(null)} className={BTN_GHOST}>Cancel</button>
                </div>
              </div>
            )}

            {live && (
              <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-hampton-pink/10">
                <button disabled={busy || liveSlots.length >= 10} onClick={() => act({ action: 'add_spot' }, 'Spot added.')} className={BTN_GHOST}>Add a spot</button>
                <CountOverride value={p.slots_override} busy={busy} onSave={v => act({ action: 'set_count', value: v }, 'Count saved.')} />
              </div>
            )}
          </div>

          {live && (
            <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
              <h2 className="font-semibold text-hampton-navy">For the crew</h2>
              <ExtraPay cents={p.extra_flat_cents} busy={busy} onSave={c => act({ action: 'fields', extra_flat_cents: c }, 'Extra pay saved.')} />
              <Notes initial={p.notes_for_crew ?? ''} busy={busy} onSave={v => act({ action: 'fields', notes_for_crew: v }, 'Notes saved.')} />
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <div className="bg-white rounded-2xl shadow-sm p-5 text-sm space-y-1.5 text-hampton-navy/80">
            <h2 className="font-semibold text-hampton-navy mb-2">Facts</h2>
            <p>Kind: {p.party_kind.replace(/_/g, ' ')}</p>
            {p.party_kind === 'studio_rental' && (
              <p className="text-hampton-navy/60 text-xs">A room rental with a Party Helper: the time is the helper&apos;s, and a Lead or a helper can take each spot. There is no Lead spot.</p>
            )}
            <p>Theme: {p.theme ?? '—'}</p>
            <p>Extra pay per person: {money(p.extra_flat_cents)}</p>
            <p>Spot count: {p.slots_override ? `${p.slots_override} (set by hand)` : 'from the guest count'}</p>
            {d.booking ? (
              <p>Booking: <a className="underline" href={`/admin/lead/${encodeURIComponent(d.booking.ref)}`}>{d.booking.ref}</a> ({d.booking.status ?? '—'})</p>
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
        </aside>
      </div>
    </CrewFrame>
  )
}

function SlotRow({ slot, members, busy, live, onAssign, onUnassign, onRemove }: {
  slot: Slot; members: Choice[]; busy: boolean; live: boolean
  onAssign: (memberId: string, force: boolean) => void; onUnassign: () => void; onRemove: () => void
}) {
  const [pick, setPick] = useState('')
  const lead = slot.role === 'lead'
  const options = members.filter(m => !lead || m.canLead || m.isOwner)
  return (
    <li className="py-3 flex flex-wrap items-center gap-3">
      <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${lead ? 'bg-hampton-navy text-[#F6F1EB]' : 'bg-[#F6F1EB] text-hampton-navy'}`}>
        {lead ? 'Party Lead' : 'Crew'}
      </span>
      {slot.memberId ? (
        <>
          <span className="font-semibold text-hampton-navy">{slot.memberName}{slot.isOwner ? ' (Allie, unpaid)' : ''}</span>
          <span className="text-xs text-hampton-navy/50">
            {slot.isOwner ? '' : slot.confirmed ? 'confirmed' : 'not confirmed'}
            {slot.assignedVia ? ` · ${slot.assignedVia === 'admin' ? 'assigned' : slot.assignedVia === 'cover' ? 'covering' : 'claimed'}` : ''}
          </span>
          {slot.activeCover && (
            <span className="text-xs text-amber-800 bg-amber-50 rounded px-2 py-0.5">
              can&apos;t make it ({slot.activeCover.reason}{slot.activeCover.note ? `: ${slot.activeCover.note}` : ''}), cover {slot.activeCover.status}
            </span>
          )}
          {live && slot.status === 'assigned' && !slot.activeCover && (
            <button disabled={busy} onClick={onUnassign} className={`${BTN_DANGER} ml-auto`}>Unassign</button>
          )}
        </>
      ) : (
        <>
          <span className="text-hampton-navy/50">Open</span>
          {live && (
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <select value={pick} onChange={e => setPick(e.target.value)} className={INPUT} aria-label="Assign">
                <option value="">Assign…</option>
                {options.map(m => {
                  const fit = lead ? m.fitLead : m.fitCrew
                  const notes = fit.conflicts.map(c => CONFLICT_LABEL[c])
                  return (
                    <option key={m.id} value={m.id} disabled={fit.conflicts.includes('on_party')}>
                      {m.name}{m.isOwner ? ' (Allie)' : ''}{m.isTest ? ' [test]' : ''}
                      {m.isOwner ? '' : ` · ${money(lead ? m.leadRateCents : m.crewRateCents)}`}
                      {notes.length ? ` — ${notes.join(', ')}` : ''}
                    </option>
                  )
                })}
              </select>
              <button disabled={busy || !pick} onClick={() => onAssign(pick, false)} className={BTN_PRIMARY}>Assign</button>
              {!lead && <button disabled={busy} onClick={onRemove} className={BTN_GHOST}>Remove spot</button>}
            </div>
          )}
        </>
      )}
    </li>
  )
}

function CountOverride({ value, busy, onSave }: { value: number | null; busy: boolean; onSave: (v: number | null) => void }) {
  const [v, setV] = useState(value == null ? '' : String(value))
  useEffect(() => { setV(value == null ? '' : String(value)) }, [value])
  return (
    <span className="flex items-center gap-2 text-sm text-hampton-navy">
      Spot count
      <input type="number" min={1} max={10} value={v} onChange={e => setV(e.target.value)} placeholder="auto" className={`${INPUT} w-20`} />
      <button disabled={busy} onClick={() => onSave(v === '' ? null : Number(v))} className={BTN_GHOST}>Set</button>
    </span>
  )
}

function ExtraPay({ cents, busy, onSave }: { cents: number; busy: boolean; onSave: (c: number) => void }) {
  const [v, setV] = useState((cents / 100).toFixed(2))
  useEffect(() => { setV((cents / 100).toFixed(2)) }, [cents])
  const parsed = Math.round(Number(v) * 100)
  const valid = v.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 && parsed <= 100_000
  return (
    <label className="block text-sm text-hampton-navy">
      Extra pay per person (e.g. a holiday weekend)
      <span className="flex items-center gap-2 mt-1">
        $<input value={v} onChange={e => setV(e.target.value)} inputMode="decimal" className={`${INPUT} w-28`} />
        <button disabled={busy || !valid || parsed === cents} onClick={() => onSave(parsed)} className={BTN_GHOST}>Save</button>
      </span>
    </label>
  )
}

function Notes({ initial, busy, onSave }: { initial: string; busy: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(initial)
  useEffect(() => { setV(initial) }, [initial])
  return (
    <label className="block text-sm text-hampton-navy">
      Notes for crew (only the people working it see these)
      <textarea value={v} onChange={e => setV(e.target.value)} rows={3} maxLength={2000} className={`${INPUT} w-full mt-1`} />
      {v !== initial && <button disabled={busy} onClick={() => onSave(v)} className={`${BTN_GHOST} mt-2`}>Save notes</button>}
    </label>
  )
}
