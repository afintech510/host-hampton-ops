'use client'

/**
 * Shared by the /admin/crew pages: the admin auth the applications page uses
 * (the `hh_admin` cookie if signed in, else the shared password as a Bearer
 * from `localStorage['hh_admin_token']`), a fetch wrapper, the sign-in gate,
 * and the page frame with the Crew sub-navigation.
 *
 * Only a 401 means the password is wrong; anything else is "could not reach",
 * because a network fault that reads as a bad password sends Adam hunting for
 * a credential that was never the problem.
 */

import { useCallback, useState } from 'react'

const TOKEN_KEY = 'hh_admin_token'

export type ApiResult<T = any> = { status: number; ok: boolean; data: T }

export function useAdminApi() {
  const call = useCallback(async <T = any,>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> => {
    const t = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null
    try {
      const res = await fetch(path, {
        method: init.method ?? 'GET',
        headers: {
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(t ? { Authorization: `Bearer ${t}` } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      return { status: res.status, ok: res.ok, data }
    } catch {
      return { status: 0, ok: false, data: { error: 'Could not reach the server.' } as T }
    }
  }, [])
  return call
}

export function LoginGate({ title, onSignedIn }: { title: string; onSignedIn: () => Promise<'ok' | 'unauthorized' | 'error'> }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    localStorage.setItem(TOKEN_KEY, pw)
    const r = await onSignedIn()
    if (r === 'ok') return
    localStorage.removeItem(TOKEN_KEY)
    setErr(r === 'unauthorized' ? 'That password was not accepted.' : 'Could not reach the server. Try again.')
  }
  return (
    <div className="min-h-screen bg-[#F6F1EB] grid place-items-center px-5">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm p-8 w-full max-w-sm">
        <h1 className="font-serif text-2xl text-hampton-navy mb-2">{title}</h1>
        <p className="text-hampton-navy/60 text-sm mb-5">Admin password.</p>
        <input
          type="password"
          value={pw}
          onChange={e => setPw(e.target.value)}
          className="w-full border-2 border-hampton-pink/40 rounded-lg px-4 py-3 mb-3 outline-none focus:border-hampton-navy"
          placeholder="Password"
          autoFocus
        />
        {err && <p className="text-red-600 text-sm mb-3">{err}</p>}
        <button type="submit" className="w-full bg-hampton-navy text-[#F6F1EB] font-bold py-3 rounded-full">Open</button>
      </form>
    </div>
  )
}

const NAV = [
  { href: '/admin/crew', label: 'Schedule' },
  { href: '/admin/crew/members', label: 'Roster' },
  { href: '/admin/crew/rules', label: 'Rules' },
]

export function CrewFrame({ active, title, sub, children }: { active: string; title: string; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F6F1EB] px-4 sm:px-5 py-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center gap-2 mb-5 text-sm">
          <a href="/admin" className="text-hampton-navy/50 hover:text-hampton-navy mr-2">← Admin</a>
          {NAV.map(n => (
            <a
              key={n.href}
              href={n.href}
              className={`rounded-full px-4 py-1.5 font-semibold ${active === n.href ? 'bg-hampton-navy text-[#F6F1EB]' : 'bg-white text-hampton-navy'}`}
            >
              {n.label}
            </a>
          ))}
        </div>
        <h1 className="font-serif text-3xl text-hampton-navy">{title}</h1>
        {sub && <div className="text-hampton-navy/60 text-sm mt-1">{sub}</div>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  )
}

export function Banner({ tone, children }: { tone: 'error' | 'warn' | 'ok' | 'info'; children: React.ReactNode }) {
  const cls = {
    error: 'bg-red-50 text-red-700',
    warn: 'bg-amber-50 text-amber-800',
    ok: 'bg-emerald-50 text-emerald-800',
    info: 'bg-sky-50 text-sky-800',
  }[tone]
  return <div className={`${cls} text-sm rounded-lg px-4 py-3 mb-4`}>{children}</div>
}

export const BTN = 'text-sm font-semibold rounded-full px-4 py-2 min-h-[40px] disabled:opacity-50'
export const BTN_PRIMARY = `${BTN} bg-hampton-navy text-[#F6F1EB]`
export const BTN_GHOST = `${BTN} border-2 border-hampton-navy/30 text-hampton-navy bg-white`
export const BTN_DANGER = `${BTN} border-2 border-red-300 text-red-700 bg-white`
export const INPUT = 'border-2 border-hampton-pink/30 rounded-lg px-3 py-2 text-sm text-hampton-navy bg-white outline-none focus:border-hampton-navy'

export function money(cents: number | null | undefined): string {
  const c = Math.round(Number(cents) || 0)
  return `$${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`
}

const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' })
const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })

export function whenLabel(startsAt: string, endsAt: string): string {
  return `${dayFmt.format(new Date(startsAt))} · ${timeFmt.format(new Date(startsAt))}–${timeFmt.format(new Date(endsAt))}`
}

export const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  published: 'bg-emerald-100 text-emerald-800',
  completed: 'bg-violet-100 text-violet-800',
  cancelled: 'bg-red-100 text-red-700',
}

export const FLAG_TEXT: Record<string, string> = {
  over_staffed: 'More spots than the guest count needs',
  needs_time: 'Booking has no usable time',
  needs_address: 'No address yet',
  not_booked: 'Booking no longer booked',
  no_helper: 'Party Helper add-on gone',
  per_hour_helper: 'Per-hour Party Helper (one helper)',
  unclassified: 'Not a crew party type any more',
  time_changed: 'Time changed after crew signed up',
}
