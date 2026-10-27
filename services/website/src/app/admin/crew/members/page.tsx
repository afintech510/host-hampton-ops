'use client'

/**
 * /admin/crew/members — the roster (prompt 04 §4). Adam enters the real crew
 * here; nothing about them is ever written into the repository.
 *
 * Steps → rate, can_lead, skills, parties worked, uncovered late cancels,
 * no-shows and flags; add and edit; the step override (reason required);
 * invite (only once the crew app is launched); "Add to crew" from a hired
 * job application. Allie's owner row cannot be removed, paid, or given steps.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  BTN_GHOST, BTN_PRIMARY, Banner, CrewFrame, INPUT, LoginGate, money, useAdminApi,
} from '../_components/adminCrew'
import { CREW_SKILLS } from '@/lib/crew/skills'
import { prefillFromApplication } from '@/lib/crew/adminForms'

interface Member {
  id: string; firstName: string; lastName: string | null; email: string | null; phone: string | null; steps: number
  crewRateCents: number; leadRateCents: number; canLead: boolean; isOwner: boolean; isTest: boolean; skills: string[]
  status: 'active' | 'paused' | 'removed'; needsReview: boolean; emailOptIn: boolean; smsOptIn: boolean
  adminNotes: string | null; jobApplicationId: string | null; joinedOn: string
  partiesWorked: number; noShows: number; lateCancelsUncovered: number; upcomingSpots: number
}
interface Hired { id: string; ref: string; name: string; email: string; phone: string; roleInterest: string }
interface Roster { members: Member[]; hired: Hired[]; maxSteps: number }

type FormState = {
  first_name: string; last_name: string; email: string; phone: string; can_lead: boolean; skills: string[]; extras: string
  email_opt_in: boolean; sms_opt_in: boolean; admin_notes: string; status: Member['status']; steps: number; job_application_id: string | null
}

const EMPTY: FormState = {
  first_name: '', last_name: '', email: '', phone: '', can_lead: false, skills: [], extras: '',
  email_opt_in: true, sms_opt_in: false, admin_notes: '', status: 'active', steps: 0, job_application_id: null,
}

const known = new Set<string>(CREW_SKILLS)

function formFrom(m: Member): FormState {
  return {
    first_name: m.firstName, last_name: m.lastName ?? '', email: m.email ?? '', phone: m.phone ?? '', can_lead: m.canLead,
    skills: m.skills.filter(s => known.has(s)), extras: m.skills.filter(s => !known.has(s)).join(', '),
    email_opt_in: m.emailOptIn, sms_opt_in: m.smsOptIn, admin_notes: m.adminNotes ?? '', status: m.status, steps: m.steps,
    job_application_id: m.jobApplicationId,
  }
}

function payload(f: FormState, mode: 'create' | 'edit' | 'owner') {
  const skills = [...f.skills, ...f.extras.split(',').map(s => s.trim()).filter(Boolean)]
  if (mode === 'owner') return { first_name: f.first_name, last_name: f.last_name, admin_notes: f.admin_notes, skills }
  const base: Record<string, unknown> = {
    first_name: f.first_name, last_name: f.last_name, email: f.email, phone: f.phone, can_lead: f.can_lead, skills,
    email_opt_in: f.email_opt_in, sms_opt_in: f.sms_opt_in, admin_notes: f.admin_notes, status: f.status,
  }
  if (mode === 'create') {
    base.steps = f.steps
    if (f.job_application_id) base.job_application_id = f.job_application_id
  }
  return base
}

export default function CrewMembersPage() {
  const api = useAdminApi()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [data, setData] = useState<Roster | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [adding, setAdding] = useState<FormState | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [showRemoved, setShowRemoved] = useState(false)

  const load = useCallback(async (): Promise<'ok' | 'unauthorized' | 'error'> => {
    const r = await api<Roster & { error?: string }>('/api/admin/crew/members')
    if (r.status === 401) { setAuthed(false); return 'unauthorized' }
    setAuthed(true)
    if (!r.ok) { setError(r.data.error || 'Could not read the roster.'); return 'error' }
    setData(r.data)
    return 'ok'
  }, [api])
  useEffect(() => { load() }, [load])

  async function create(f: FormState) {
    setError('')
    const r = await api<{ error?: string; warning?: string }>('/api/admin/crew/members', { method: 'POST', body: payload(f, 'create') })
    if (!r.ok) { setError(r.data.error || 'Could not add them.'); return false }
    setNotice(r.data.warning || `${f.first_name} added.`)
    setAdding(null)
    await load()
    return true
  }

  if (authed === null) return <div className="min-h-screen bg-[#F6F1EB] grid place-items-center text-hampton-navy/60">Loading…</div>
  if (!authed) return <LoginGate title="Crew roster" onSignedIn={load} />

  const members = (data?.members ?? []).filter(m => showRemoved || m.status !== 'removed')
  const maxSteps = data?.maxSteps ?? 8

  return (
    <CrewFrame active="/admin/crew/members" title="Crew roster" sub="Rates are per party. Steps never show to crew as a number.">
      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="ok">{notice}</Banner>}

      <div className="flex flex-wrap gap-2 mb-5">
        <button onClick={() => setAdding(adding ? null : { ...EMPTY })} className={BTN_PRIMARY}>{adding ? 'Close' : 'Add a crew member'}</button>
        <label className="flex items-center gap-2 text-sm text-hampton-navy/70 ml-2">
          <input type="checkbox" checked={showRemoved} onChange={e => setShowRemoved(e.target.checked)} /> Show removed
        </label>
      </div>

      {data && data.hired.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-5 mb-5">
          <h2 className="text-hampton-navy text-xs uppercase tracking-wider font-bold mb-2">Hired, not on the crew yet</h2>
          <ul className="space-y-2">
            {data.hired.map(a => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-semibold text-hampton-navy">{a.name}</span>
                <span className="text-hampton-navy/50 font-mono text-xs">{a.ref}</span>
                <button
                  className={`${BTN_GHOST} ml-auto`}
                  onClick={() => {
                    const p = prefillFromApplication(a as any)
                    setAdding({ ...EMPTY, first_name: p.first_name, last_name: p.last_name ?? '', email: p.email, phone: p.phone ?? '', can_lead: p.can_lead, job_application_id: p.job_application_id })
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }}
                >
                  Add to crew
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {adding && (
        <div className="bg-white rounded-2xl shadow-sm p-5 mb-5">
          <h2 className="font-semibold text-hampton-navy mb-3">{adding.job_application_id ? 'Add to crew (from their application)' : 'New crew member'}</h2>
          <MemberForm key={adding.job_application_id ?? 'new'} initial={adding} mode="create" maxSteps={maxSteps} onSave={create} />
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-hampton-navy/50 text-[11px] uppercase tracking-wider">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Rate (crew / Lead)</th>
              <th className="px-4 py-3">Lead</th>
              <th className="px-4 py-3">Worked</th>
              <th className="px-4 py-3">Late, uncovered</th>
              <th className="px-4 py-3">No-shows</th>
              <th className="px-4 py-3">Flags</th>
            </tr>
          </thead>
          <tbody>
            {members.map(m => (
              <MemberRow key={m.id} m={m} open={open === m.id} maxSteps={maxSteps}
                onToggle={() => setOpen(open === m.id ? null : m.id)}
                onChanged={async (msg) => { setNotice(msg); setError(''); await load() }}
                onError={setError} />
            ))}
          </tbody>
        </table>
      </div>
    </CrewFrame>
  )
}

function MemberRow({ m, open, maxSteps, onToggle, onChanged, onError }: {
  m: Member; open: boolean; maxSteps: number; onToggle: () => void; onChanged: (msg: string) => Promise<void>; onError: (e: string) => void
}) {
  const api = useAdminApi()
  const flags = [
    m.isOwner ? 'owner (unpaid)' : null,
    m.isTest ? 'test' : null,
    m.status !== 'active' ? m.status : null,
    m.needsReview ? 'needs a talk' : null,
    m.upcomingSpots ? `${m.upcomingSpots} upcoming` : null,
  ].filter(Boolean)

  async function save(f: FormState) {
    const r = await api<{ error?: string }>(`/api/admin/crew/members/${m.id}`, { method: 'PATCH', body: payload(f, m.isOwner ? 'owner' : 'edit') })
    if (!r.ok) { onError(r.data.error || 'Could not save.'); return false }
    await onChanged(`${f.first_name} saved.`)
    return true
  }

  return (
    <>
      <tr className={`border-t border-hampton-pink/10 cursor-pointer hover:bg-[#F6F1EB]/50 ${m.status === 'removed' ? 'opacity-50' : ''}`} onClick={onToggle}>
        <td className="px-4 py-3 font-semibold text-hampton-navy">{m.firstName} {m.lastName ?? ''}</td>
        <td className="px-4 py-3">{m.isOwner ? '—' : `${money(m.crewRateCents)} / ${money(m.leadRateCents)}`}{!m.isOwner && <span className="text-hampton-navy/40 text-xs"> · step {m.steps}</span>}</td>
        <td className="px-4 py-3">{m.canLead ? 'Yes' : '—'}</td>
        <td className="px-4 py-3">{m.partiesWorked}</td>
        <td className="px-4 py-3">{m.lateCancelsUncovered}</td>
        <td className="px-4 py-3">{m.noShows}</td>
        <td className="px-4 py-3 text-xs text-hampton-navy/70">{flags.join(' · ') || '—'}</td>
      </tr>
      {open && (
        <tr className="bg-[#F6F1EB]/40">
          <td colSpan={7} className="px-4 py-4">
            <div className="grid lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2">
                <MemberForm key={JSON.stringify(m)} initial={formFrom(m)} mode={m.isOwner ? 'owner' : 'edit'} maxSteps={maxSteps} onSave={save} />
              </div>
              <div className="space-y-4">
                {m.isOwner ? (
                  <p className="text-sm text-hampton-navy/70">Allie is the owner row: she can be assigned as Party Lead and counts toward staffed, and is never paid, given steps, notified or removed.</p>
                ) : (
                  <>
                    <StepOverride m={m} maxSteps={maxSteps} onChanged={onChanged} onError={onError} />
                    <Invite m={m} onChanged={onChanged} onError={onError} />
                    {m.needsReview && (
                      <button className={BTN_GHOST} onClick={async () => {
                        const r = await api<{ error?: string }>(`/api/admin/crew/members/${m.id}`, { method: 'PATCH', body: { needs_review: false } })
                        if (!r.ok) onError(r.data.error || 'Could not clear it.')
                        else await onChanged('Flag cleared.')
                      }}>Talked to them: clear the flag</button>
                    )}
                  </>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function MemberForm({ initial, mode, maxSteps, onSave }: {
  initial: FormState; mode: 'create' | 'edit' | 'owner'; maxSteps: number; onSave: (f: FormState) => Promise<boolean>
}) {
  const [f, setF] = useState<FormState>(initial)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF(p => ({ ...p, [k]: v }))
  const owner = mode === 'owner'
  return (
    <form
      onSubmit={async e => { e.preventDefault(); setBusy(true); await onSave(f); setBusy(false) }}
      className="grid sm:grid-cols-2 gap-3 text-sm text-hampton-navy"
    >
      <label>First name<input className={`${INPUT} w-full mt-1`} value={f.first_name} onChange={e => set('first_name', e.target.value)} maxLength={40} required /></label>
      <label>Last name<input className={`${INPUT} w-full mt-1`} value={f.last_name} onChange={e => set('last_name', e.target.value)} maxLength={60} /></label>
      {!owner && (
        <>
          <label>Email<input type="email" className={`${INPUT} w-full mt-1`} value={f.email} onChange={e => set('email', e.target.value)} /></label>
          <label>Mobile<input type="tel" className={`${INPUT} w-full mt-1`} value={f.phone} onChange={e => set('phone', e.target.value)} placeholder="631-555-0100" /></label>
          {mode === 'create' && (
            <label>Starting step (0–{maxSteps})
              <input type="number" min={0} max={maxSteps} className={`${INPUT} w-full mt-1`} value={f.steps} onChange={e => set('steps', Number(e.target.value))} />
            </label>
          )}
          <label>Status
            <select className={`${INPUT} w-full mt-1`} value={f.status} onChange={e => set('status', e.target.value as FormState['status'])}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="removed">Removed</option>
            </select>
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.can_lead} onChange={e => set('can_lead', e.target.checked)} /> Can be Party Lead</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.email_opt_in} onChange={e => set('email_opt_in', e.target.checked)} /> Email alerts</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.sms_opt_in} onChange={e => set('sms_opt_in', e.target.checked)} /> Text alerts (they agreed)</label>
        </>
      )}
      <fieldset className="sm:col-span-2">
        <legend className="mb-1">Skills (what they told us)</legend>
        <div className="flex flex-wrap gap-2">
          {CREW_SKILLS.map(s => (
            <label key={s} className="flex items-center gap-1.5 bg-white rounded-full px-3 py-1 text-xs">
              <input type="checkbox" checked={f.skills.includes(s)} onChange={e => set('skills', e.target.checked ? [...f.skills, s] : f.skills.filter(x => x !== s))} />
              {s}
            </label>
          ))}
        </div>
        <input className={`${INPUT} w-full mt-2`} value={f.extras} onChange={e => set('extras', e.target.value)} placeholder="Other skills, comma-separated" />
      </fieldset>
      <label className="sm:col-span-2">Notes (only admins see these)
        <textarea className={`${INPUT} w-full mt-1`} rows={2} value={f.admin_notes} onChange={e => set('admin_notes', e.target.value)} />
      </label>
      <div className="sm:col-span-2"><button disabled={busy} className={BTN_PRIMARY}>{busy ? 'Saving…' : mode === 'create' ? 'Add' : 'Save'}</button></div>
    </form>
  )
}

function StepOverride({ m, maxSteps, onChanged, onError }: { m: Member; maxSteps: number; onChanged: (msg: string) => Promise<void>; onError: (e: string) => void }) {
  const api = useAdminApi()
  const [steps, setSteps] = useState(m.steps)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="bg-white rounded-xl p-4 text-sm text-hampton-navy">
      <p className="font-semibold mb-2">Set their step</p>
      <div className="flex items-center gap-2 mb-2">
        <input type="number" min={0} max={maxSteps} value={steps} onChange={e => setSteps(Number(e.target.value))} className={`${INPUT} w-20`} />
        <span className="text-hampton-navy/50 text-xs">now step {m.steps} · {money(m.crewRateCents)} a party</span>
      </div>
      <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} placeholder="Reason (required)" className={`${INPUT} w-full mb-2`} />
      <button
        disabled={busy || !reason.trim() || steps === m.steps}
        className={BTN_GHOST}
        onClick={async () => {
          setBusy(true)
          const r = await api<{ error?: string }>(`/api/admin/crew/members/${m.id}/steps`, { method: 'POST', body: { steps, reason } })
          setBusy(false)
          if (!r.ok) onError(r.data.error || 'Could not set it.')
          else { setReason(''); await onChanged(`${m.firstName} is now at step ${steps}.`) }
        }}
      >
        Save step
      </button>
    </div>
  )
}

function Invite({ m, onChanged, onError }: { m: Member; onChanged: (msg: string) => Promise<void>; onError: (e: string) => void }) {
  const api = useAdminApi()
  const [busy, setBusy] = useState(false)
  return (
    <button
      disabled={busy || !m.email || m.status !== 'active'}
      className={BTN_GHOST}
      title={!m.email ? 'No email address' : ''}
      onClick={async () => {
        setBusy(true)
        const r = await api<{ error?: string }>(`/api/admin/crew/members/${m.id}/invite`, { method: 'POST' })
        setBusy(false)
        if (!r.ok) onError(r.data.error || 'Could not send it.')
        else await onChanged(`Invite sent to ${m.firstName}.`)
      }}
    >
      Email an invite
    </button>
  )
}
