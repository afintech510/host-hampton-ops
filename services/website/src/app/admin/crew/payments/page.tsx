'use client'

/**
 * /admin/crew/payments - every payment, phone first: card, Venmo, Zelle, cash, other and
 * event tickets, newest first. Each tile says how much, how it arrived, who paid, what for,
 * and what the booking STILL owes, with a link to the booking. Read only.
 *
 * Pull buttons narrow it by where the money came from, how it was paid and how far back.
 */

import { useMemo } from 'react'
import Link from 'next/link'
import type { PayMethod, PaymentRow } from '@/lib/crewAppPayments'
import { etDateString, shiftEtDate } from '@/lib/partyTime'
import { PARTY_TYPE_LABELS } from '@/lib/pipelineStages'
import { Banner, CrewFrame, money } from '../_components/adminCrew'
import { useAdminData } from '../_components/adminData'
import { pill, useRemembered } from '../_components/PartyFilters'

const METHODS: Array<{ key: PayMethod; label: string; badge: string }> = [
  { key: 'card', label: 'Card', badge: 'bg-indigo-100 text-indigo-800' },
  { key: 'venmo', label: 'Venmo', badge: 'bg-sky-100 text-sky-800' },
  { key: 'zelle', label: 'Zelle', badge: 'bg-violet-100 text-violet-800' },
  { key: 'cash', label: 'Cash', badge: 'bg-emerald-100 text-emerald-800' },
  { key: 'other', label: 'Other', badge: 'bg-slate-100 text-slate-700' },
]
const METHOD = Object.fromEntries(METHODS.map(m => [m.key, m])) as Record<PayMethod, (typeof METHODS)[number]>

type Source = 'all' | 'booking' | 'event'
const SOURCES: Array<{ key: Source; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'booking', label: 'Parties' },
  { key: 'event', label: 'Events' },
]
type Period = '30' | '90' | 'year' | 'all'
const PERIODS: Array<{ key: Period; label: string }> = [
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All' },
]

const TYPE_WORD: Record<string, string> = { deposit: 'Deposit', partial: 'Payment', final: 'Balance', refund: 'Refund', tickets: 'Tickets' }

/** Whole-dollar-aware: $1,020.00. */
const dollars = (cents: number) => {
  const sign = cents < 0 ? '-' : ''
  const c = Math.abs(Math.round(cents))
  return `${sign}$${Math.floor(c / 100).toLocaleString('en-US')}.${String(c % 100).padStart(2, '0')}`
}

const dayOf = (iso: string) => etDateString(new Date(iso))
const shortDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const partyDay = (ymd: string | null) => (ymd ? new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : null)

function PaymentTile({ p }: { p: PaymentRow }) {
  const m = METHOD[p.method]
  const refund = p.amountCents < 0
  const tipped = !refund && p.tipCents > 0
  const day = shortDay(dayOf(p.at))
  const kind = p.partyType ? PARTY_TYPE_LABELS[p.partyType] : null
  return (
    <article className="bg-white rounded-2xl shadow-sm p-3" data-payment-tile data-id={p.id}>
      <div className="flex gap-3">
        <div className="shrink-0 w-[4.25rem] rounded-xl bg-[#F6F1EB] py-2 text-center leading-tight self-start">
          <div className="text-[15px] font-bold text-hampton-navy">{day}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[17px] font-semibold text-hampton-navy leading-tight truncate">{p.person}</div>
              <div className="text-sm text-hampton-navy/60 truncate">
                {p.what}
                {p.kind === 'event' ? '' : kind ? ` · ${kind}` : ''}
                {partyDay(p.partyDate) ? ` · ${partyDay(p.partyDate)}` : ''}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className={`text-lg font-bold leading-tight ${refund ? 'text-red-700' : 'text-emerald-700'}`}>{refund ? '' : '+'}{dollars(p.amountCents)}</div>
              {tipped && <div className="text-xs font-bold text-amber-700">+ {dollars(p.tipCents)} tip</div>}
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${m.badge}`}>{m.label}</span>
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-hampton-navy/10 text-hampton-navy">{TYPE_WORD[p.type] ?? p.type}</span>
            {tipped && <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-200 text-amber-900">🎁 Tip</span>}
            {p.kind === 'event' && <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800">Event</span>}
            {p.refunded && p.type !== 'refund' && <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-red-100 text-red-700">Refunded</span>}
          </div>

          {tipped && (
            <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900" data-tip-note>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">Tip for the party team</span>
                <span className="font-bold">{dollars(p.tipCents)}</span>
              </div>
              <div className="text-xs text-amber-900/70">
                On top of the payment, not counted toward the balance · {dollars(p.amountCents + p.tipCents)} with the tip
              </div>
            </div>
          )}

          {p.bookingId && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-[#F6F1EB] px-3 py-2">
              <div className="text-sm">
                {p.totalCents && p.totalCents > 0 ? (
                  p.balanceCents && p.balanceCents > 0 ? (
                    <>
                      <span className="font-bold text-hampton-navy">{money(p.balanceCents)}</span> <span className="text-hampton-navy/60">still owed of {money(p.totalCents)}</span>
                    </>
                  ) : (
                    <span className="font-bold text-emerald-700">✓ Paid in full <span className="font-normal text-hampton-navy/60">· {money(p.totalCents)}</span></span>
                  )
                ) : (
                  <span className="text-hampton-navy/60">Not priced yet</span>
                )}
                {p.bookingStatus === 'cancelled' && <span className="ml-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Cancelled</span>}
              </div>
              <Link href={`/admin/crew/bookings?party=${p.bookingId}`} prefetch className="shrink-0 text-sm font-semibold text-hampton-navy underline">
                Open booking
              </Link>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

export default function CrewPaymentsPage() {
  const { data, error, loading, refreshing } = useAdminData<{ payments: PaymentRow[]; truncated?: boolean }>('/api/admin/crew-app/payments')
  const [source, setSource] = useRemembered<Source>('payments.source', 'all')
  const [methods, setMethods] = useRemembered<PayMethod[]>('payments.methods', [])
  const [period, setPeriod] = useRemembered<Period>('payments.period', '30')
  const [tipsOnly, setTipsOnly] = useRemembered<boolean>('payments.tipsOnly', false)

  const today = etDateString()
  const since = period === '30' ? shiftEtDate(today, -29) : period === '90' ? shiftEtDate(today, -89) : period === 'year' ? `${today.slice(0, 4)}-01-01` : '0000-00-00'
  const all = useMemo(() => data?.payments ?? [], [data])
  const shown = useMemo(
    () => all.filter(p => (source === 'all' || p.kind === source) && (methods.length === 0 || methods.includes(p.method)) && dayOf(p.at) >= since && (!tipsOnly || (p.amountCents > 0 && p.tipCents > 0))),
    [all, source, methods, since, tipsOnly],
  )
  const net = shown.reduce((s, p) => s + p.amountCents, 0)
  const tipped = shown.filter(p => p.amountCents > 0 && p.tipCents > 0)
  const tipTotal = tipped.reduce((s, p) => s + p.tipCents, 0)
  const byMethod = METHODS.map(m => ({ ...m, cents: shown.filter(p => p.method === m.key).reduce((s, p) => s + p.amountCents, 0), n: shown.filter(p => p.method === m.key).length })).filter(m => m.n > 0)

  return (
    <CrewFrame active="/admin/crew/payments" title="Payments" compact sub={refreshing ? 'refreshing…' : null}>
      <div className="max-w-3xl mx-auto">
        {error && !data && <Banner tone="error">{error}</Banner>}
        {loading && <div className="text-center text-hampton-navy/50 py-10">Loading the payments…</div>}
        {data && (
          <>
            <div className="flex flex-col items-center gap-1.5" data-payment-filters>
              <div className="flex flex-wrap justify-center gap-1.5" role="group" aria-label="Where from">
                {SOURCES.map(s => (
                  <button key={s.key} type="button" aria-pressed={source === s.key} onClick={() => setSource(s.key)} className={pill(source === s.key)}>
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap justify-center gap-1.5" role="group" aria-label="How paid">
                {METHODS.map(m => {
                  const on = methods.includes(m.key)
                  return (
                    <button key={m.key} type="button" aria-pressed={on} onClick={() => setMethods(on ? methods.filter(x => x !== m.key) : [...methods, m.key])} className={pill(on)}>
                      {m.label}
                    </button>
                  )
                })}
                <button type="button" aria-pressed={tipsOnly} onClick={() => setTipsOnly(!tipsOnly)} className={pill(tipsOnly)}>
                  🎁 With a tip
                </button>
              </div>
              <div className="flex flex-wrap justify-center gap-1.5" role="group" aria-label="How far back">
                {PERIODS.map(pd => (
                  <button key={pd.key} type="button" aria-pressed={period === pd.key} onClick={() => setPeriod(pd.key)} className={pill(period === pd.key)}>
                    {pd.label}
                  </button>
                ))}
              </div>
            </div>

            <section className="mt-3 bg-white rounded-2xl shadow-sm p-3 text-center">
              <div className="text-xs font-bold uppercase tracking-wider text-hampton-navy/50">Collected</div>
              <div className="text-4xl font-bold text-hampton-navy">{dollars(net)}</div>
              <div className="text-xs text-hampton-navy/50">{shown.length} {shown.length === 1 ? 'payment' : 'payments'}, refunds taken off</div>
              {tipTotal > 0 && (
                <div className="mt-2 text-sm font-semibold text-amber-800" data-tip-total>
                  🎁 Plus {dollars(tipTotal)} in tips from {tipped.length} {tipped.length === 1 ? 'payment' : 'payments'}
                  <span className="font-normal text-hampton-navy/50"> · not counted above</span>
                </div>
              )}
              {byMethod.length > 0 && (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {byMethod.map(m => (
                    <span key={m.key} className={`text-xs font-bold px-3 py-1 rounded-full ${m.badge}`}>
                      {m.label} {dollars(m.cents)} · {m.n}
                    </span>
                  ))}
                </div>
              )}
            </section>

            {data.truncated && <div className="mt-3"><Banner tone="info">Showing the most recent payments only; older ones are not listed.</Banner></div>}
            <div className="mt-3 space-y-3">
              {shown.length === 0 && <div className="text-center text-hampton-navy/60 py-10">No payments match those buttons.</div>}
              {shown.map(p => (
                <PaymentTile key={p.id} p={p} />
              ))}
            </div>
          </>
        )}
      </div>
    </CrewFrame>
  )
}
