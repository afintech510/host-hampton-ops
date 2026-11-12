'use client'

/**
 * /admin/crew/time - everyone who has used the time clock. Tap a name to open it: week by week
 * (Monday to Sunday, Eastern) with a total for each week. Read only; punch detail and edits are on
 * the Staff page.
 */

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Banner, CrewFrame } from '../_components/adminCrew'
import { useAdminData } from '../_components/adminData'

interface Week { weekStart: string; minutes: number; punches: Array<{ id: string; in: string; out: string | null; minutes: number; edited: boolean }> }
interface Person { id: string; name: string; isTest: boolean; clockedInSince: string | null; totalMinutes: number; weeks: Week[] }

const TZ = 'America/New_York'
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
const day = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso))
const clock = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
const weekLabel = (monday: string) => `Week of ${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${monday}T12:00:00Z`))}`

export default function CrewTimeClockPage() {
  const data = useAdminData<{ people?: Person[] }>('/api/admin/crew/time/summary')
  const people = data.data?.people ?? null
  const [open, setOpen] = useState<string | null>(null)

  return (
    <CrewFrame active="/admin/crew/time" title="Time clock" sub="Everyone who has punched in, week by week.">
      {data.error && !people && <Banner tone="error">{data.error}</Banner>}
      {people && people.length === 0 && <p className="text-sm text-hampton-navy/60">Nobody has used the time clock yet.</p>}
      <div className="max-w-3xl mx-auto space-y-3">
        {people?.map(p => {
          const isOpen = open === p.id
          return (
            <section key={p.id} className="rounded-2xl border-2 border-hampton-navy/10 bg-white">
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                <span>
                  <span className="block font-semibold text-hampton-navy">
                    {p.name}{p.isTest && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Test</span>}
                  </span>
                  <span className="block text-xs text-hampton-navy/60">
                    {p.clockedInSince ? `Clocked in since ${clock(p.clockedInSince)}` : 'Punched out'} · {p.weeks.length} {p.weeks.length === 1 ? 'week' : 'weeks'}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <strong className="text-hampton-navy">{hm(p.totalMinutes)}</strong>
                  <ChevronDown size={20} aria-hidden="true" className={`text-hampton-navy/60 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-hampton-navy/10 px-4 py-2">
                  {p.weeks.map(w => (
                    <div key={w.weekStart} className="py-2">
                      <div className="flex items-baseline justify-between">
                        <h3 className="text-sm font-semibold text-hampton-navy">{weekLabel(w.weekStart)}</h3>
                        <strong className="text-sm text-hampton-navy">{hm(w.minutes)}</strong>
                      </div>
                      <ul className="mt-1 divide-y divide-hampton-navy/5">
                        {w.punches.map(x => (
                          <li key={x.id} className="flex items-start justify-between gap-3 py-1.5 text-sm">
                            <span>
                              {day(x.in)}
                              <span className="block text-xs text-hampton-navy/60">
                                {clock(x.in)} – {x.out ? clock(x.out) : 'now'}{x.edited ? ' · edited' : ''}
                              </span>
                            </span>
                            <span className="text-hampton-navy">{x.out ? hm(x.minutes) : 'In progress'}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </CrewFrame>
  )
}
