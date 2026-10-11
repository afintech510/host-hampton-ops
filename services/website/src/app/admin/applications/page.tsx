'use client'

/**
 * The job application book — every /join-the-team application, newest first.
 *
 * Copied from /admin/market-vendors, including its auth: the `hh_admin` cookie
 * if Adam is signed into /admin in this browser, else the shared-password bearer
 * under `localStorage['hh_admin_token']`. Only a 401 means the password is wrong;
 * anything else is reported as "could not reach", because a network fault that
 * reads as a bad password sends Adam hunting for a credential that was never
 * the problem.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  APPLICATION_STATUSES,
  HELPER_SKILLS,
  JOB_HEARD_ABOUT,
  WEEKDAY_OPTIONS,
  WEEKEND_OPTIONS,
  YES_SOME_NO,
  asksHelper,
  asksLead,
  labelOf,
  roleInterestLabel,
} from '@/lib/careers'

const TOKEN_KEY = 'hh_admin_token'

interface Application {
  id: string
  application_ref: string
  role_interest: string
  name: string
  email: string
  phone: string
  weekend_availability: string
  weekday_availability: string | null
  has_car: boolean | null
  heard_about: string | null
  heard_about_detail: string | null
  why_us: string | null
  hospitality_experience: string | null
  lead_comfort_rating: number | null
  decorating_experience: string | null
  balloon_experience: string | null
  portfolio_url: string | null
  kids_experience: string | null
  activity_comfort_rating: number | null
  crafts_experience: string | null
  braiding_experience: string | null
  tinsel_experience: string | null
  nails_experience: string | null
  will_learn_beauty: boolean | null
  status: string
  admin_notes: string | null
  reviewed_at: string | null
  created_at: string
}

interface Stats {
  total: number
  new: number
  interviewing: number
  hired: number
}

const STATUS_STYLE: Record<string, string> = {
  new: 'bg-amber-100 text-amber-800',
  contacted: 'bg-sky-100 text-sky-800',
  interviewing: 'bg-violet-100 text-violet-800',
  hired: 'bg-emerald-100 text-emerald-800',
  declined: 'bg-gray-200 text-gray-600',
}

const STATUS_LABEL: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  interviewing: 'Interviewing',
  hired: 'Hired',
  declined: 'Declined',
}

const SELECT = 'border-2 border-hampton-pink/30 rounded-full px-3 py-1.5 text-sm text-hampton-navy bg-white outline-none'

export default function ApplicationsPage() {
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(true)
  const [pw, setPw] = useState('')
  const [loginError, setLoginError] = useState('')

  const [apps, setApps] = useState<Application[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [filters, setFilters] = useState({ role: '', weekend: '', car: '', status: '' })
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const authHeaders = useCallback((): HeadersInit => {
    const t = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null
    return t ? { Authorization: `Bearer ${t}` } : {}
  }, [])

  const load = useCallback(async (): Promise<'ok' | 'unauthorized' | 'error'> => {
    try {
      const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString()
      const res = await fetch(`/api/admin/applications${qs ? `?${qs}` : ''}`, { headers: authHeaders() })
      if (res.status === 401) return 'unauthorized'
      if (!res.ok) {
        setError('Could not reach the application book.')
        return 'error'
      }
      const data = await res.json()
      setApps(data.applications || [])
      setStats(data.stats || null)
      setError('')
      return 'ok'
    } catch {
      setError('Could not reach the application book.')
      return 'error'
    }
  }, [authHeaders, filters])

  useEffect(() => {
    load().then(r => {
      setAuthed(r === 'ok')
      setChecking(false)
    })
  }, [load])

  async function login(e: React.FormEvent) {
    e.preventDefault()
    setLoginError('')
    localStorage.setItem(TOKEN_KEY, pw)
    const r = await load()
    if (r === 'ok') {
      setAuthed(true)
      return
    }
    localStorage.removeItem(TOKEN_KEY)
    setLoginError(r === 'unauthorized' ? 'That password was not accepted.' : 'Could not reach the application book — try again.')
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/applications/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Update failed.')
        return
      }
      await load()
    } catch {
      setError('Update failed.')
    } finally {
      setBusyId('')
    }
  }

  if (checking) {
    return <div className="min-h-screen bg-[#F6F1EB] grid place-items-center text-hampton-navy/60">Loading…</div>
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#F6F1EB] grid place-items-center px-5">
        <form onSubmit={login} className="bg-white rounded-2xl shadow-sm p-8 w-full max-w-sm">
          <h1 className="font-serif text-2xl text-hampton-navy mb-2">Job applications</h1>
          <p className="text-hampton-navy/60 text-sm mb-5">Admin password.</p>
          <input
            type="password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            className="w-full border-2 border-hampton-pink/40 rounded-lg px-4 py-3 mb-3 outline-none focus:border-hampton-navy"
            placeholder="Password"
            autoFocus
          />
          {loginError && <p className="text-red-600 text-sm mb-3">{loginError}</p>}
          <button type="submit" className="w-full bg-hampton-navy text-[#F6F1EB] font-bold py-3 rounded-full">
            Open
          </button>
        </form>
      </div>
    )
  }

  const setFilter = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLSelectElement>) =>
    setFilters(prev => ({ ...prev, [k]: e.target.value }))

  return (
    <div className="min-h-screen bg-[#F6F1EB] px-5 py-10">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="font-serif text-3xl text-hampton-navy">Job applications</h1>
          <p className="text-hampton-navy/60 text-sm mt-1">From /join-the-team, newest first.</p>
        </div>

        {error && <p className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-3 mb-5">{error}</p>}

        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <Tile label="Shown" value={String(stats.total)} />
            <Tile label="New" value={String(stats.new)} accent={stats.new > 0} />
            <Tile label="Interviewing" value={String(stats.interviewing)} />
            <Tile label="Hired" value={String(stats.hired)} />
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-6">
          <select value={filters.role} onChange={setFilter('role')} className={SELECT} aria-label="Role">
            <option value="">Any role</option>
            <option value="lead">Party Lead (incl. Either)</option>
            <option value="helper">Party Helper (incl. Either)</option>
            <option value="either">Either only</option>
          </select>
          <select value={filters.weekend} onChange={setFilter('weekend')} className={SELECT} aria-label="Weekends">
            <option value="">Any weekends</option>
            {WEEKEND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={filters.car} onChange={setFilter('car')} className={SELECT} aria-label="Car">
            <option value="">Car: any</option>
            <option value="yes">Has a car</option>
            <option value="no">No car</option>
          </select>
          <select value={filters.status} onChange={setFilter('status')} className={SELECT} aria-label="Status">
            <option value="">Any status</option>
            {APPLICATION_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>

        {apps.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center text-hampton-navy/50">No applications match.</div>
        ) : (
          <div className="space-y-3">
            {apps.map(a => (
              <div key={a.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <button
                  onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                  className="w-full text-left px-5 py-4 flex flex-wrap items-center gap-3"
                >
                  <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${STATUS_STYLE[a.status] || 'bg-gray-100 text-gray-700'}`}>
                    {STATUS_LABEL[a.status] || a.status}
                  </span>
                  <span className="font-semibold text-hampton-navy">{a.name}</span>
                  <span className="text-hampton-navy/50 text-sm">{roleInterestLabel(a.role_interest)}</span>
                  <span className="text-hampton-navy/50 text-sm">{labelOf(WEEKEND_OPTIONS, a.weekend_availability)}</span>
                  {a.has_car && <span title="Has a car" className="text-sm">🚗</span>}
                  <span className="ml-auto text-hampton-navy/40 text-xs">
                    {new Date(a.created_at).toLocaleDateString()} · <span className="font-mono">{a.application_ref}</span>
                  </span>
                </button>

                {expanded === a.id && (
                  <div className="px-5 pb-5 border-t border-hampton-pink/20 pt-4 space-y-4">
                    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      <Row label="Email" value={<a className="underline" href={`mailto:${a.email}`}>{a.email}</a>} />
                      <Row label="Phone" value={<a className="underline" href={`tel:${a.phone.replace(/[^\d+]/g, '')}`}>{a.phone}</a>} />
                      <Row label="Weekdays" value={labelOf(WEEKDAY_OPTIONS, a.weekday_availability)} />
                      <Row label="Car + license" value={a.has_car === null ? '—' : a.has_car ? 'Yes' : 'No'} />
                      <Row
                        label="Heard via"
                        value={labelOf(JOB_HEARD_ABOUT, a.heard_about) + (a.heard_about_detail ? ` — ${a.heard_about_detail}` : '')}
                      />
                      <Row label="Applied" value={new Date(a.created_at).toLocaleString()} />
                    </div>

                    {asksLead(a.role_interest) && (
                      <Block title="Party Lead">
                        <Answer label="Experience" value={a.hospitality_experience} />
                        <Answer label="Managing parents + a team" value={a.lead_comfort_rating ? `${a.lead_comfort_rating} / 5` : null} />
                        <Answer label="Decorating / design" value={a.decorating_experience} />
                        <Answer label="Balloon arch / garland" value={labelOf(YES_SOME_NO, a.balloon_experience)} />
                        {a.portfolio_url && (
                          <p className="text-sm">
                            <a href={a.portfolio_url} target="_blank" rel="noopener noreferrer nofollow" className="underline text-hampton-navy">
                              Portfolio / photos ↗
                            </a>
                          </p>
                        )}
                      </Block>
                    )}

                    {asksHelper(a.role_interest) && (
                      <Block title="Party Helper">
                        <Answer label="Experience with kids" value={a.kids_experience} />
                        <Answer label="Leading group activities" value={a.activity_comfort_rating ? `${a.activity_comfort_rating} / 5` : null} />
                        <div className="flex flex-wrap gap-2">
                          {HELPER_SKILLS.map(s => (
                            <span key={s.field} className="text-xs bg-[#F6F1EB] text-hampton-navy rounded-full px-3 py-1">
                              {s.label}: <strong>{labelOf(YES_SOME_NO, a[s.field])}</strong>
                            </span>
                          ))}
                        </div>
                      </Block>
                    )}

                    <Answer label="Why Host Hampton" value={a.why_us} />

                    <NotesBox initial={a.admin_notes || ''} busy={busyId === a.id} onSave={admin_notes => patch(a.id, { admin_notes })} />

                    <div className="flex flex-wrap gap-2 pt-1">
                      {APPLICATION_STATUSES.filter(s => s !== a.status).map(s => (
                        <button
                          key={s}
                          disabled={busyId === a.id}
                          onClick={() => patch(a.id, { status: s })}
                          className="text-sm font-semibold border-2 border-hampton-navy/30 text-hampton-navy rounded-full px-4 py-1.5 disabled:opacity-50"
                        >
                          Mark {STATUS_LABEL[s].toLowerCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 ${accent ? 'bg-amber-50' : 'bg-white'}`}>
      <p className="text-hampton-navy/50 text-[11px] uppercase tracking-wider mb-1">{label}</p>
      <p className="text-hampton-navy text-xl font-bold">{value}</p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <p className="text-hampton-navy/80">
      <span className="text-hampton-navy/50">{label}: </span>
      {value}
    </p>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-hampton-navy text-xs uppercase tracking-wider font-bold">{title}</p>
      {children}
    </div>
  )
}

function Answer({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div>
      <p className="text-hampton-navy/50 text-xs uppercase tracking-wider mb-1">{label}</p>
      <p className="text-hampton-navy/80 text-sm whitespace-pre-line">{value}</p>
    </div>
  )
}

function NotesBox({ initial, busy, onSave }: { initial: string; busy: boolean; onSave: (v: string) => void }) {
  const [value, setValue] = useState(initial)
  const dirty = value !== initial
  return (
    <div>
      <p className="text-hampton-navy/50 text-xs uppercase tracking-wider mb-1">Your notes</p>
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        rows={2}
        placeholder="Called Tue, interview Sat 10am…"
        className="w-full border-2 border-hampton-pink/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-hampton-navy"
      />
      {dirty && (
        <button
          disabled={busy}
          onClick={() => onSave(value)}
          className="mt-2 text-sm font-semibold bg-hampton-navy text-[#F6F1EB] rounded-full px-4 py-1.5 disabled:opacity-50"
        >
          Save notes
        </button>
      )}
    </div>
  )
}
