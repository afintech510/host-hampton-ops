'use client'

/**
 * /admin/crew/members — the roster (prompt 04 §4). Adam enters the real crew
 * here; nothing about them is ever written into the repository.
 *
 * can_lead, skills, parties worked, uncovered late cancels, no-shows and flags;
 * add and edit; invite (only once the crew app is launched); "Add to crew" from
 * a hired job application. Allie's owner row cannot be removed, paid or notified.
 *
 * PAY is set per person, per hour, and is never displayed here: the list shows no
 * rate, and the editor's pay box is write-only ("set" / "not set") so a figure is
 * never on screen for someone looking over a shoulder. There are no steps.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  BTN_GHOST, BTN_PRIMARY, Banner, CrewFrame, INPUT, useAdminApi, whenParts,
} from '../_components/adminCrew'
import { useAdminData, warm } from '../_components/adminData'
import { useSnapToTop } from '../_components/useSnapToTop'
import TimeClockPanel from '../_components/TimeClockPanel'
import { staffStatus, staffNotes, staffStatusUpdate, type StaffStatus } from '@/lib/crew/memberStatus'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { CREW_SKILLS } from '@/lib/crew/skills'
import { prefillFromApplication } from '@/lib/crew/adminForms'

interface Member {
  id: string; firstName: string; lastName: string | null; email: string | null; phone: string | null
  hasHourlyRate: boolean; canLead: boolean; isOwner: boolean; isTest: boolean; skills: string[]
  status: 'active' | 'paused' | 'removed'; needsReview: boolean; emailOptIn: boolean; smsOptIn: boolean
  adminNotes: string | null; jobApplicationId: string | null; joinedOn: string
  partiesWorked: number; noShows: number; lateCancelsUncovered: number; upcomingSpots: number
  parties: { partyId: string; title: string; startsAt: string; endsAt: string; role: 'lead' | 'crew'; confirmed: boolean; status: string }[]
  onboarding: 'added' | 'link_sent' | 'signed_in' | 'profile_done' | 'agreement_signed' | 'not_required'
}

const STAGE_LABEL: Record<Member['onboarding'], string> = {
  added: 'Added', link_sent: 'Link sent', signed_in: 'Signed in', profile_done: 'Profile done', agreement_signed: 'Agreement signed', not_required: '—',
}
interface Hired { id: string; ref: string; name: string; email: string; phone: string; roleInterest: string }
interface Roster { members: Member[]; hired: Hired[] }

type FormState = {
  first_name: string; last_name: string; email: string; phone: string; can_lead: boolean; skills: string[]; extras: string
  email_opt_in: boolean; sms_opt_in: boolean; admin_notes: string; status: StaffStatus; hourly_dollars: string; job_application_id: string | null
}

const EMPTY: FormState = {
  first_name: '', last_name: '', email: '', phone: '', can_lead: false, skills: [], extras: '',
  email_opt_in: true, sms_opt_in: false, admin_notes: '', status: 'active', hourly_dollars: '', job_application_id: null,
}

const ONBOARDING_URL = `${CANONICAL_ORIGIN}/crew/login`
const known = new Set<string>(CREW_SKILLS)

function formFrom(m: Member): FormState {
  return {
    first_name: m.firstName, last_name: m.lastName ?? '', email: m.email ?? '', phone: m.phone ?? '', can_lead: m.canLead,
    skills: m.skills.filter(s => known.has(s)), extras: m.skills.filter(s => !known.has(s)).join(', '),
    email_opt_in: m.emailOptIn, sms_opt_in: m.smsOptIn, admin_notes: staffNotes(m.adminNotes), status: staffStatus(m.status, m.adminNotes), hourly_dollars: '',
    job_application_id: m.jobApplicationId,
  }
}

function payload(f: FormState, mode: 'create' | 'edit' | 'owner') {
  const skills = [...f.skills, ...f.extras.split(',').map(s => s.trim()).filter(Boolean)]
  if (mode === 'owner') return { first_name: f.first_name, last_name: f.last_name, admin_notes: f.admin_notes, skills }
  const base: Record<string, unknown> = {
    first_name: f.first_name, last_name: f.last_name, email: f.email, phone: f.phone, can_lead: f.can_lead, skills,
    email_opt_in: f.email_opt_in, sms_opt_in: f.sms_opt_in, ...staffStatusUpdate(f.status, f.admin_notes),
  }
  // Pay per hour: only sent when typed, so saving the form never rewrites it.
  const dollars = Number(f.hourly_dollars)
  if (f.hourly_dollars.trim() && Number.isFinite(dollars)) base.hourly_rate_cents = Math.round(dollars * 100)
  if (mode === 'create' && f.job_application_id) base.job_application_id = f.job_application_id
  return base
}

export default function CrewMembersPage() {
  const api = useAdminApi()
  const roster = useAdminData<Roster>('/api/admin/crew/members')
  const data = roster.data
  const [actionError, setError] = useState('')
  const error = actionError || (data ? '' : roster.error ?? '')
  const [notice, setNotice] = useState('')
  const [adding, setAdding] = useState<FormState | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [showRemoved, setShowRemoved] = useState(false)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)

  const reload = roster.reload
  const load = useCallback(async () => { await reload() }, [reload])

  async function create(f: FormState) {
    setError('')
    const r = await api<{ error?: string; warning?: string }>('/api/admin/crew/members', { method: 'POST', body: payload(f, 'create') })
    if (!r.ok) { setError(r.data.error || 'Could not add them.'); return false }
    setNotice(r.data.warning || `${f.first_name} added.`)
    setAdding(null)
    await load()
    return true
  }

  // Allie (the owner row) is not a crew member to schedule, so she shows only with the removed ones.
  const members = (data?.members ?? []).filter(m => showRemoved || (m.status !== 'removed' && !m.isOwner))
  const visibleMembers = selectedMemberId ? members.filter(m => m.id === selectedMemberId) : members

  return (
    <CrewFrame active="/admin/crew/members" title="Party Crew" wordmark>
      {error && <Banner tone="error">{error}</Banner>}
      {roster.loading && <div className="text-center text-hampton-navy/50 py-8">Loading the crew…</div>}
      {notice && <Banner tone="ok">{notice}</Banner>}

      <div className="flex flex-wrap gap-2 mb-5">
        <button onClick={() => setAdding(adding ? null : { ...EMPTY })} className={BTN_PRIMARY}>{adding ? 'Close' : 'Add a crew member'}</button>
        <label className="flex items-center gap-2 text-sm text-hampton-navy/70 ml-2">
          <input type="checkbox" checked={showRemoved} onChange={e => { setShowRemoved(e.target.checked); setSelectedMemberId(null) }} /> Show archived / former staff
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
          <MemberForm key={adding.job_application_id ?? 'new'} initial={adding} mode="create" onSave={create} />
        </div>
      )}

      {members.length > 0 && (
        <nav aria-label="Filter staff by person" className="max-w-3xl mx-auto mb-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setSelectedMemberId(null)} aria-pressed={selectedMemberId === null}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold border ${selectedMemberId === null ? 'bg-hampton-navy text-white border-hampton-navy' : 'bg-white text-hampton-navy border-hampton-navy/20'}`}>
            All
          </button>
          {members.map(m => (
            <button key={m.id} type="button" onClick={() => setSelectedMemberId(m.id)} aria-pressed={selectedMemberId === m.id}
              aria-label={`Show ${m.firstName} ${m.lastName ?? ''}`.trim()}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold border ${selectedMemberId === m.id ? 'bg-hampton-navy text-white border-hampton-navy' : 'bg-white text-hampton-navy border-hampton-navy/20'}`}>
              {m.firstName}
            </button>
          ))}
        </nav>
      )}

      <div className="space-y-3 max-w-3xl mx-auto">
        {visibleMembers.map(m => (
          <MemberCard key={m.id} m={m} open={open === m.id}
            onToggle={() => setOpen(open === m.id ? null : m.id)}
            onChanged={async (msg) => { setNotice(msg); setError(''); await load() }}
            onError={setError} />
        ))}
      </div>
    </CrewFrame>
  )
}

const memberFlags = (m: Member) => [
  m.isOwner ? 'owner' : null,
  m.isTest ? 'test' : null,
  m.status !== 'active' ? staffStatus(m.status, m.adminNotes) : null,
  m.needsReview ? 'needs a talk' : null,
  m.upcomingSpots ? `${m.upcomingSpots} upcoming` : null,
].filter(Boolean)

type MemberHandlers = { onChanged: (msg: string) => Promise<void>; onError: (e: string) => void }

/** The editor under an open member: the same on the table and on the phone. */
function MemberPanel(props: { m: Member } & MemberHandlers) {
  return (
    <>
      <MemberPanelInner {...props} />
      {/* Hours under the person: renders nothing unless they have a time clock. */}
      {!props.m.isOwner && <TimeClockPanel memberId={props.m.id} firstName={props.m.firstName} />}
    </>
  )
}

function MemberPanelInner({ m, onChanged, onError }: { m: Member } & MemberHandlers) {
  const api = useAdminApi()
  const [archive, setArchive] = useState(false)
  const [archiving, setArchiving] = useState(false)
  async function save(f: FormState) {
    const r = await api<{ error?: string }>(`/api/admin/crew/members/${m.id}`, { method: 'PATCH', body: payload(f, m.isOwner ? 'owner' : 'edit') })
    if (!r.ok) { onError(r.data.error || 'Could not save.'); return false }
    await onChanged(`${f.first_name} saved.`)
    return true
  }

  return (
    <div className="grid lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2">
        <MemberForm key={JSON.stringify(m)} initial={formFrom(m)} mode={m.isOwner ? 'owner' : 'edit'} hasHourlyRate={m.hasHourlyRate} onSave={save} />
      </div>
      <div className="space-y-4">
        {m.isOwner ? (
          <p className="text-sm text-hampton-navy/70">Allie is the owner row: she can be assigned as Party Lead and counts toward staffed, and is never paid, notified or removed.</p>
        ) : (
          <>
            {m.status !== 'removed' && (archive ? <div className="rounded-xl border border-amber-200 p-3 text-sm">
              <p className="mb-2">Archive {m.firstName}? They will lose crew access and stop receiving crew notices. Unassign upcoming work first.</p>
              <div className="flex flex-wrap gap-2">
                <button disabled={archiving} className={BTN_PRIMARY} onClick={async () => {
                  setArchiving(true)
                  const r = await api<{ error?: string }>(`/api/admin/crew/members/${m.id}`, { method: 'PATCH', body: staffStatusUpdate('archived', m.adminNotes ?? '') })
                  setArchiving(false)
                  if (!r.ok) onError(r.data.error || 'Could not archive.')
                  else await onChanged(`${m.firstName} archived.`)
                  setArchive(false)
                }}>Archive staff member</button>
                <button disabled={archiving} className={BTN_GHOST} onClick={() => setArchive(false)}>Keep active</button>
              </div>
            </div> : <button className={BTN_GHOST} onClick={() => setArchive(true)}>Archive staff member</button>)}
            <Invite m={m} onChanged={onChanged} onError={onError} />
            <ViewAs m={m} onError={onError} />
            <Onboarding m={m} onChanged={onChanged} onError={onError} />
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
  )
}

/** The parties a person is working, two short lines each, each a link to its party-staff page. */
function WorkingParties({ parties }: { parties: Member['parties'] }) {
  // The party-staff pages these lines open are ready before they are tapped.
  const firstIds = parties.slice(0, 3).map(p => p.partyId).join(',')
  useEffect(() => {
    if (firstIds) warm(firstIds.split(',').map(id => `/api/admin/crew/parties/${id}`))
  }, [firstIds])
  if (parties.length === 0) return <div className="px-4 pb-3 -mt-1 text-xs text-hampton-navy/40">Not on any party yet.</div>
  return (
    <ul className="px-4 pb-3 space-y-1.5" aria-label="Working">
      {parties.slice(0, 6).map(p => {
        const w = whenParts(p.startsAt, p.endsAt)
        return (
          <li key={p.partyId}>
            <Link href={`/admin/crew/parties/${p.partyId}`} prefetch className="block rounded-lg bg-[#F6F1EB] px-3 py-1.5 leading-tight active:bg-hampton-navy/10">
              <div className="text-xs font-semibold text-hampton-navy">{w.day} · {w.time}</div>
              <div className="text-xs text-hampton-navy/70 truncate">
                {p.title} · {p.role === 'lead' ? 'Party Lead' : 'Crew'} · <span className={p.confirmed ? 'text-emerald-700' : 'text-amber-700'}>{p.confirmed ? '✓ confirmed' : 'not confirmed'}</span>
                {p.status === 'draft' ? ' · draft' : ''}
              </div>
            </Link>
          </li>
        )
      })}
      {parties.length > 6 && <li className="text-xs text-hampton-navy/50 px-1">+ {parties.length - 6} more</li>}
    </ul>
  )
}

/** One crew member: tap the top to open the editor in place; the parties under it go to their staff pages. */
function MemberCard({ m, open, onToggle, onChanged, onError }: {
  m: Member; open: boolean; onToggle: () => void
} & MemberHandlers) {
  const flags = memberFlags(m)
  const cardRef = useRef<HTMLDivElement>(null)
  useSnapToTop(cardRef, open)
  return (
    <div ref={cardRef} className={`bg-white rounded-2xl shadow-sm ${m.status === 'removed' ? 'opacity-50' : ''}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full text-left p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="text-lg font-semibold text-hampton-navy leading-tight">{m.firstName} {m.lastName ?? ''}</div>
          <div className="flex flex-wrap justify-end gap-1.5">
            {m.canLead && <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-violet-100 text-violet-800">Lead</span>}
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#F6F1EB] text-hampton-navy">{STAGE_LABEL[m.onboarding]}</span>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl py-2 bg-[#F6F1EB]">
            <div className="text-lg font-bold leading-none text-hampton-navy">{m.partiesWorked}</div>
            <div className="text-[11px] uppercase tracking-wide text-hampton-navy/50 mt-1">Worked</div>
          </div>
          <div className="rounded-xl py-2 bg-[#F6F1EB]">
            <div className="text-lg font-bold leading-none text-hampton-navy">{m.lateCancelsUncovered}</div>
            <div className="text-[11px] uppercase tracking-wide text-hampton-navy/50 mt-1">Late, uncovered</div>
          </div>
          <div className="rounded-xl py-2 bg-[#F6F1EB]">
            <div className="text-lg font-bold leading-none text-hampton-navy">{m.noShows}</div>
            <div className="text-[11px] uppercase tracking-wide text-hampton-navy/50 mt-1">No-shows</div>
          </div>
        </div>
        {flags.length > 0 && <div className="mt-2 text-xs text-hampton-navy/70">{flags.join(' · ')}</div>}
      </button>
      <WorkingParties parties={m.parties ?? []} />
      {open && (
        <div className="border-t border-hampton-pink/10 bg-[#F6F1EB]/40 rounded-b-2xl p-4">
          <MemberPanel m={m} onChanged={onChanged} onError={onError} />
        </div>
      )}
    </div>
  )
}

function MemberForm({ initial, mode, hasHourlyRate = false, onSave }: {
  initial: FormState; mode: 'create' | 'edit' | 'owner'; hasHourlyRate?: boolean; onSave: (f: FormState) => Promise<boolean>
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
          <label>Pay per hour ($) <span className="text-hampton-navy/40 text-xs">{hasHourlyRate ? 'set — type to change' : 'not set'}</span>
            <input type="number" min={0} max={200} step="0.25" inputMode="decimal" autoComplete="off" className={`${INPUT} w-full mt-1`}
              value={f.hourly_dollars} onChange={e => set('hourly_dollars', e.target.value)} placeholder={hasHourlyRate ? '••••' : 'e.g. 20'} />
          </label>
          <label>Status
            <select className={`${INPUT} w-full mt-1`} value={f.status} onChange={e => set('status', e.target.value as FormState['status'])}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="archived">Archived</option>
              <option value="quit">Quit</option>
              <option value="fired">Fired</option>
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

/** Open the crew app as this member, read-only (audited). Works with the crew switches off. */
function ViewAs({ m, onError }: { m: Member; onError: (e: string) => void }) {
  const api = useAdminApi()
  const [busy, setBusy] = useState(false)
  if (m.isOwner) return null
  return (
    <button
      disabled={busy}
      className={BTN_GHOST}
      title="See the crew app exactly as they do. Read-only: nothing you click changes anything."
      onClick={async () => {
        setBusy(true)
        const r = await api<{ error?: string; redirect?: string }>(`/api/admin/crew/members/${m.id}/view-as`, { method: 'POST' })
        if (!r.ok) {
          setBusy(false)
          onError(r.data.error || 'Could not start the preview.')
        } else window.location.href = r.data.redirect || '/crew'
      }}
    >
      View as {m.firstName}
    </button>
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

interface AdminProfile {
  legalFirstName: string | null; legalLastName: string | null; preferredName: string | null; dateOfBirth: string | null
  addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; zip: string | null
  emergencyName: string | null; emergencyRelationship: string | null; emergencyPhone: string | null
  agreementVersion: string | null; agreementSignedAt: string | null; hasSignedAgreement: boolean
}

/** Send the onboarding text; view the private profile (audited); open the signed agreement (audited). */
function Onboarding({ m, onChanged, onError }: { m: Member; onChanged: (msg: string) => Promise<void>; onError: (e: string) => void }) {
  const api = useAdminApi()
  const [busy, setBusy] = useState(false)
  const [profile, setProfile] = useState<AdminProfile | null | undefined>(undefined)
  if (m.onboarding === 'not_required') return null
  return (
    <div className="space-y-2">
      <p className="text-xs text-hampton-navy/60">Onboarding: <strong>{STAGE_LABEL[m.onboarding]}</strong></p>
      <p className="text-xs text-hampton-navy/70">Share the onboarding link yourself. No onboarding text is sent here.</p>
      <a href="/crew/login" target="_blank" rel="noopener noreferrer" className="block text-sm underline break-all">{ONBOARDING_URL}</a>
      <button className={BTN_GHOST} onClick={async () => {
        try {
          await navigator.clipboard.writeText(ONBOARDING_URL)
          await onChanged('Onboarding link copied. Share it manually with the staff member.')
        } catch { onError('Could not copy. Select the link above and copy it.') }
      }}>Copy onboarding link</button>
      <button
        disabled={busy}
        className={BTN_GHOST}
        onClick={async () => {
          setBusy(true)
          const r = await api<{ error?: string; profile?: AdminProfile | null }>(`/api/admin/crew/members/${m.id}/profile`, { method: 'GET' })
          setBusy(false)
          if (!r.ok) onError(r.data.error || 'Could not open the profile.')
          else setProfile(r.data.profile ?? null)
        }}
      >
        View profile (logged)
      </button>
      {m.onboarding === 'agreement_signed' && (
        <button
          disabled={busy}
          className={BTN_GHOST}
          onClick={async () => {
            setBusy(true)
            const r = await api<{ error?: string; url?: string }>(`/api/admin/crew/members/${m.id}/agreement`, { method: 'GET' })
            setBusy(false)
            if (!r.ok || !r.data.url) onError(r.data.error || 'Could not get the agreement.')
            else window.open(r.data.url, '_blank', 'noopener')
          }}
        >
          Download signed agreement
        </button>
      )}
      {profile === null && <p className="text-xs text-hampton-navy/60">They have not started the form yet.</p>}
      {profile && (
        <dl className="text-xs text-hampton-navy/80 space-y-1 bg-white rounded-lg p-3">
          <div><dt className="inline font-semibold">Name: </dt><dd className="inline">{profile.legalFirstName} {profile.legalLastName}{profile.preferredName ? ` (${profile.preferredName})` : ''}</dd></div>
          <div><dt className="inline font-semibold">Birthday: </dt><dd className="inline">{profile.dateOfBirth}</dd></div>
          <div><dt className="inline font-semibold">Address: </dt><dd className="inline">{[profile.addressLine1, profile.addressLine2, profile.city, `${profile.state ?? ''} ${profile.zip ?? ''}`].filter(Boolean).join(', ')}</dd></div>
          <div><dt className="inline font-semibold">Emergency: </dt><dd className="inline">{profile.emergencyName} ({profile.emergencyRelationship}) {profile.emergencyPhone}</dd></div>
          <div><dt className="inline font-semibold">Agreement: </dt><dd className="inline">{profile.agreementSignedAt ? `signed (${profile.agreementVersion})` : 'not signed'}</dd></div>
        </dl>
      )}
    </div>
  )
}
