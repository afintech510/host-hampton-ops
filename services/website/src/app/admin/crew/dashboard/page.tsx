'use client'

/**
 * /admin/crew/dashboard - the numbers, phone first. Where each one comes from is in
 * lib/dashboardMetrics.ts; a source that could not be read shows as unavailable here,
 * never as a zero.
 *
 *   Gross sales            the books ledger (bookkeeping imports + every payment since +
 *                          event tickets; fundraiser orders are not in it) for the year,
 *                          quarter or month to date, against the same stretch of the
 *                          periods before it (year: last year; quarter: last quarter and
 *                          the same quarter last year; month: last month and the same
 *                          month last year)
 *   Booking backlog        what the parties booked from today on are worth
 *   Bookings made          count and $ this week / month / 30 / 60 days, against the same
 *                          stretch before
 *   Booked ahead           the future bookings by kind: in-studio, mobile, room rental
 *   Upcoming events        sign-ups and ticket revenue
 *   Leads                  open leads and their quoted value, and how fast new ones arrive
 */

import { Banner, CrewFrame, money } from '../_components/adminCrew'
import { useAdminData } from '../_components/adminData'
import WeekendPrep from '../_components/WeekendPrep'
import { pill, useRemembered } from '../_components/PartyFilters'
import type { SalesPeriod, SalesPeriodKey } from '@/lib/dashboardMetrics'

type Money = number
interface Dash {
  asOf: string
  today: string
  errors: string[]
  ytd: null | { year: number; grossCents: Money; refundsCents: Money; netCents: Money; byGroup: { group: string; cents: Money }[]; throughDate: string | null }
  /** Year, quarter and month to date, each with its comparisons. null when the books could not be read. */
  sales: null | SalesPeriod[]
  backlog: { count: number; totalCents: Money; collectedCents: Money; toCollectCents: Money; byType: { type: string; label: string; count: number; totalCents: Money }[] }
  bookingsMade: { key: string; label: string; count: number; cents: Money; prior: { count: number; cents: Money } }[]
  events: null | { count: number; signups: number; revenueCents: Money; events: { id: string; title: string; date: string; capacity: number | null; signups: number; revenueCents: Money }[] }
  leads: null | {
    count: number
    valueCents: Money
    unpriced: number
    velocity: {
      series: { weekStart: string; count: number; partial: boolean }[]
      thisWeek: number
      lastWeek: number
      thisMonth: number
      lastMonthSamePoint: number
      perWeekRecent: number
      perWeekEarlier: number
      changePct: number
      trend: 'up' | 'down' | 'flat'
    }
  }
}

/** Whole dollars for the big numbers: $145,508. */
const whole = (cents: number) => `$${Math.round((Number(cents) || 0) / 100).toLocaleString('en-US')}`

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl shadow-sm p-4">
      <div className="text-xs font-bold uppercase tracking-wider text-hampton-navy/50">{title}</div>
      {hint && <div className="text-[11px] text-hampton-navy/40 mb-1">{hint}</div>}
      <div className="mt-2">{children}</div>
    </section>
  )
}

function Unavailable({ what }: { what: string }) {
  return <p className="text-sm text-amber-800">{what} could not be read just now, so it is not shown. It is not zero.</p>
}

function Delta({ now, prior, money: isMoney }: { now: number; prior: number; money?: boolean }) {
  const diff = now - prior
  if (diff === 0) return <span className="text-hampton-navy/40">same as before</span>
  const up = diff > 0
  return (
    <span className={up ? 'text-emerald-700' : 'text-red-700'}>
      {up ? '▲' : '▼'} {isMoney ? whole(Math.abs(diff)) : Math.abs(diff)} <span className="text-hampton-navy/40">vs {isMoney ? whole(prior) : prior} before</span>
    </span>
  )
}

const shortRange = (a: string, b: string) => `${shortDay(a)} – ${shortDay(b)}`

/** One earlier stretch held against this one: its like-for-like figure, how this compares, and the whole period for reference. */
function Comparison({ c, current }: { c: SalesPeriod['comparisons'][number]; current: number }) {
  const up = c.grossCents !== null && current >= c.grossCents
  const same = c.grossCents !== null && current === c.grossCents
  return (
    <li className="rounded-xl bg-[#F6F1EB] p-3" data-sales-comparison>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-hampton-navy">{c.label}</div>
          <div className="text-[11px] text-hampton-navy/50">{c.title} · {shortRange(c.start, c.end)}</div>
        </div>
        {c.grossCents === null ? (
          <div className="text-right text-xs text-hampton-navy/50 shrink-0">books don&apos;t go back that far</div>
        ) : (
          <div className="text-right shrink-0">
            <div className="text-lg font-bold text-hampton-navy leading-tight">{whole(c.grossCents)}</div>
            <div className="text-[11px] font-semibold">
              {same ? (
                <span className="text-hampton-navy/50">same</span>
              ) : (
                <span className={up ? 'text-emerald-700' : 'text-red-700'}>
                  {up ? '▲' : '▼'} {c.changePct === null ? '' : `${Math.abs(c.changePct)}% · `}{whole(Math.abs(current - c.grossCents))}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
      {c.fullGrossCents !== null && c.end !== c.fullEnd && (
        <div className="mt-1 text-[11px] text-hampton-navy/50">Whole {c.title}: {whole(c.fullGrossCents)}</div>
      )}
    </li>
  )
}

function Bars({ rows }: { rows: { label: string; value: number; right: string }[] }) {
  const max = Math.max(1, ...rows.map(r => r.value))
  return (
    <ul className="space-y-2.5">
      {rows.map(r => (
        <li key={r.label}>
          <div className="flex justify-between text-sm text-hampton-navy">
            <span>{r.label}</span>
            <span className="font-semibold">{r.right}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-hampton-navy/10 overflow-hidden">
            <div className="h-full rounded-full bg-hampton-navy" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

const shortDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** New leads per week as a line: solid through the last full week, dashed to this week so far. */
function LineChart({ series }: { series: { weekStart: string; count: number; partial: boolean }[] }) {
  const W = 320
  const H = 130
  const padL = 24
  const padR = 8
  const padT = 10
  const padB = 22
  const max = Math.max(4, ...series.map(s => s.count))
  const x = (i: number) => padL + (i * (W - padL - padR)) / Math.max(1, series.length - 1)
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB)
  const pts = series.map((s, i) => [x(i), y(s.count)] as const)
  const solid = pts.slice(0, -1)
  const path = (p: ReadonlyArray<readonly [number, number]>) => p.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ')
  const area = `${path(solid)} L${solid[solid.length - 1][0].toFixed(1)},${H - padB} L${solid[0][0].toFixed(1)},${H - padB} Z`
  const last = pts[pts.length - 1]
  const prev = pts[pts.length - 2]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`New leads per week, last ${series.length} weeks`}>
      {[0, 0.5, 1].map(f => (
        <g key={f}>
          <line x1={padL} x2={W - padR} y1={y(max * f)} y2={y(max * f)} stroke="#1E1B3A" strokeOpacity="0.08" />
          <text x={padL - 4} y={y(max * f) + 3} textAnchor="end" fontSize="9" fill="#1E1B3A" fillOpacity="0.45">{Math.round(max * f)}</text>
        </g>
      ))}
      <path d={area} fill="#1E1B3A" fillOpacity="0.07" />
      <path d={path(solid)} fill="none" stroke="#1E1B3A" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      {prev && last && <line x1={prev[0]} y1={prev[1]} x2={last[0]} y2={last[1]} stroke="#1E1B3A" strokeWidth="2.2" strokeDasharray="4 3" strokeLinecap="round" />}
      {pts.map(([px, py], i) => (
        <circle key={i} cx={px} cy={py} r={i === pts.length - 1 ? 4 : 2.4} fill={i === pts.length - 1 ? '#fff' : '#1E1B3A'} stroke="#1E1B3A" strokeWidth="1.6" />
      ))}
      <text x={padL} y={H - 6} fontSize="9" fill="#1E1B3A" fillOpacity="0.5">{shortDay(series[0].weekStart)}</text>
      <text x={W - padR} y={H - 6} textAnchor="end" fontSize="9" fill="#1E1B3A" fillOpacity="0.5">this week</text>
    </svg>
  )
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[#F6F1EB] p-3">
      <div className="text-[11px] font-semibold text-hampton-navy/50">{label}</div>
      <div className="text-xl font-bold text-hampton-navy leading-tight">{value}</div>
      {sub && <div className="text-[11px] mt-0.5">{sub}</div>}
    </div>
  )
}

export default function CrewDashboardPage() {
  const { data, error, loading, refreshing } = useAdminData<Dash>('/api/admin/crew-app/dashboard', 60_000)
  const d = data
  // Which period the sales card shows is remembered while you move between tabs.
  const [period, setPeriod] = useRemembered<SalesPeriodKey>('dashboard.period', 'ytd')
  const sales = d?.sales?.find(p => p.key === period) ?? d?.sales?.[0] ?? null
  const asOf = d ? new Date(d.asOf).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : null

  return (
    <CrewFrame active="/admin/crew/dashboard" title="Dashboard" sub={d ? `As of ${asOf}${refreshing ? ' · refreshing…' : ''}` : null}>
      <div className="max-w-3xl mx-auto space-y-3">
        <WeekendPrep />
        {error && !d && <Banner tone="error">{error}</Banner>}
        {loading && <div className="text-center text-hampton-navy/50 py-10">Loading the numbers…</div>}
        {d && d.errors.length > 0 && <Banner tone="warn">{d.errors.join(' ')}</Banner>}

        {d && (
          <>
            <Section title="Gross sales" hint="The books: bookkeeping imports + every payment since + event tickets. Fundraiser orders are not counted.">
              {d.sales && sales ? (
                <>
                  <div className="flex gap-1.5" role="group" aria-label="Period" data-sales-periods>
                    {d.sales.map(p => (
                      <button key={p.key} type="button" aria-pressed={period === p.key} onClick={() => setPeriod(p.key)} className={`${pill(period === p.key)} flex-1`}>
                        {p.button}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 text-sm font-semibold text-hampton-navy">{sales.title}</div>
                  <div className="text-4xl font-bold text-hampton-navy">{whole(sales.grossCents)}</div>
                  <div className="text-xs text-hampton-navy/50 mt-0.5">
                    {shortRange(sales.start, sales.end)} · {whole(sales.refundsCents)} refunded · {whole(sales.netCents)} net{d.ytd?.throughDate ? ` · books through ${shortDay(d.ytd.throughDate)}` : ''}
                  </div>
                  <ul className="mt-3 space-y-2">
                    {sales.comparisons.map(c => <Comparison key={c.label} c={c} current={sales.grossCents} />)}
                  </ul>
                  <p className="mt-1.5 text-[11px] text-hampton-navy/40">Each is held against the same stretch of that period (the same number of days in), so a part-finished {sales.button.toLowerCase()} is never set against a whole one.</p>
                  <div className="mt-3">
                    <Bars rows={sales.byGroup.filter(g => g.cents > 0).map(g => ({ label: g.group, value: g.cents, right: whole(g.cents) }))} />
                  </div>
                </>
              ) : (
                <Unavailable what="The books" />
              )}
            </Section>

            <Section title="Booking backlog" hint="What the parties booked from today on are worth.">
              <div className="text-4xl font-bold text-hampton-navy">{whole(d.backlog.totalCents)}</div>
              <div className="text-xs text-hampton-navy/50 mt-0.5">across {d.backlog.count} booked {d.backlog.count === 1 ? 'party' : 'parties'}</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Stat label="Collected" value={whole(d.backlog.collectedCents)} />
                <Stat label="Still to collect" value={whole(d.backlog.toCollectCents)} />
              </div>
            </Section>

            <Section title="Bookings made" hint="A party counts the day its first payment landed. Compared with the same stretch just before.">
              <div className="grid grid-cols-2 gap-2">
                {d.bookingsMade.map(w => (
                  <div key={w.key} className="rounded-xl bg-[#F6F1EB] p-3">
                    <div className="text-[11px] font-semibold text-hampton-navy/50">{w.label}</div>
                    <div className="text-2xl font-bold text-hampton-navy leading-tight">{w.count}</div>
                    <div className="text-sm font-semibold text-hampton-navy">{whole(w.cents)}</div>
                    <div className="mt-1 text-[11px] leading-snug">
                      <Delta now={w.count} prior={w.prior.count} />
                      <br />
                      <Delta now={w.cents} prior={w.prior.cents} money />
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Booked ahead" hint="Future bookings by kind.">
              <div className="flex items-baseline gap-2">
                <div className="text-3xl font-bold text-hampton-navy">{d.backlog.count}</div>
                <div className="text-sm text-hampton-navy/60">bookings · {whole(d.backlog.totalCents)}</div>
              </div>
              <div className="mt-3">
                <Bars rows={d.backlog.byType.map(t => ({ label: `${t.label} · ${t.count}`, value: t.totalCents, right: whole(t.totalCents) }))} />
              </div>
            </Section>

            <Section title="Upcoming events">
              {d.events ? (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <Stat label="Events" value={d.events.count} />
                    <Stat label="Sign-ups" value={d.events.signups} />
                    <Stat label="Revenue" value={whole(d.events.revenueCents)} />
                  </div>
                  {d.events.events.length === 0 ? (
                    <p className="mt-3 text-sm text-hampton-navy/60">No events on the calendar.</p>
                  ) : (
                    <ul className="mt-3 divide-y divide-hampton-navy/10">
                      {d.events.events.map(e => (
                        <li key={e.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                          <div className="min-w-0">
                            <div className="font-semibold text-hampton-navy truncate">{e.title}</div>
                            <div className="text-xs text-hampton-navy/50">{shortDay(e.date)}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-semibold text-hampton-navy">{e.signups}{e.capacity ? ` / ${e.capacity}` : ''} <span className="font-normal text-hampton-navy/50">signed up</span></div>
                            <div className="text-xs text-hampton-navy/60">{money(e.revenueCents)}</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <Unavailable what="The events" />
              )}
            </Section>

            <Section title="Leads" hint="Open inquiries and quotes that have not booked.">
              {d.leads ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="Active leads" value={d.leads.count} sub={d.leads.unpriced ? <span className="text-hampton-navy/50">{d.leads.unpriced} not priced yet</span> : undefined} />
                    <Stat label="Quoted value" value={whole(d.leads.valueCents)} />
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <div className="text-xs font-bold uppercase tracking-wider text-hampton-navy/50">New leads per week</div>
                    <span
                      className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                        d.leads.velocity.trend === 'up' ? 'bg-emerald-100 text-emerald-800' : d.leads.velocity.trend === 'down' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {d.leads.velocity.trend === 'up' ? '▲' : d.leads.velocity.trend === 'down' ? '▼' : '►'} {d.leads.velocity.trend === 'flat' ? 'steady' : `${d.leads.velocity.changePct > 0 ? '+' : ''}${d.leads.velocity.changePct}%`}
                    </span>
                  </div>
                  <LineChart series={d.leads.velocity.series} />
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Stat label="This week" value={d.leads.velocity.thisWeek} sub={<span className="text-hampton-navy/50">last week {d.leads.velocity.lastWeek}</span>} />
                    <Stat label="This month" value={d.leads.velocity.thisMonth} sub={<span className="text-hampton-navy/50">last month so far {d.leads.velocity.lastMonthSamePoint}</span>} />
                    <Stat label="Per week" value={d.leads.velocity.perWeekRecent} sub={<span className="text-hampton-navy/50">before {d.leads.velocity.perWeekEarlier}</span>} />
                  </div>
                  <p className="mt-2 text-[11px] text-hampton-navy/40">Per week is the average of the last four full weeks, against the four before them.</p>
                </>
              ) : (
                <Unavailable what="The leads" />
              )}
            </Section>
          </>
        )}
      </div>
    </CrewFrame>
  )
}
