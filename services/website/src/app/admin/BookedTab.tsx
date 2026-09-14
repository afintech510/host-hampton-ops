'use client'

import { useState, useEffect, useMemo } from 'react'
import { formatMoney } from '@/lib/partyPricing'
import { PARTY_TYPE_LABELS } from '@/lib/pipelineStages'
import { foodSummary, type FoodSelections } from '@/lib/partyFood'
import {
  Search, ArrowUpDown, ArrowUp, ArrowDown, X, ExternalLink, Pizza, Cake,
  AlertTriangle, CheckCircle2, Clock, Users, CalendarDays, Phone, Mail,
} from 'lucide-react'

/**
 * Booked Parties — every party money has actually landed on.
 *
 * The Parties tab is the pipeline (every lead, newest first). This is the
 * OPERATIONAL list: who is coming, what they owe, and what they're eating. The
 * server decides what "booked" means and says which evidence it used — see
 * `api/admin/booked/route.ts`. This component does not re-derive it.
 *
 * Sorting and filtering are client-side on purpose. The whole booked set is ~20
 * rows and will be ~200 in five years; a server round-trip per column click
 * would be slower and would make "sort by balance" a new endpoint parameter for
 * no gain. The one thing that is NOT client-side is the money: `balance_cents`
 * and `paid_cents` come from the receipts through lib/bookingBalance.ts, so this
 * screen and the customer's portal cannot disagree about what is owed.
 */

interface BookedParty {
  id: string
  booking_ref: string
  status: string
  party_type: string | null
  event_type: string | null
  source: string | null
  party_date: string | null
  party_time: string | null
  package_type: string | null
  guest_count_approx: number | null
  child_name: string | null
  child_age: number | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  total_cents: number | null
  balance_cents: number
  stored_balance_cents: number | null
  paid_cents: number
  overpaid_cents: number
  paid_in_full: boolean
  invoice_number: string | null
  notes: string | null
  admin_notes: string | null
  photo_gallery_url: string | null
  checkin_status: string | null
  approved_at: string | null
  paid_in_full_at: string | null
  created_at: string | null
  food: FoodSelections
  evidence: 'payment' | 'status_only'
  payment_count: number
  payment_methods: string[]
  first_paid_at: string | null
  last_paid_at: string | null
}

interface Totals {
  count: number
  withPaymentRow: number
  paidCents: number
  outstandingCents: number
}

interface PartyDetail extends BookedParty {
  line_items?: { id: string; name: string; quantity: number; unit_price_cents: number; guest_multiplied: boolean; category: string }[]
  payments?: { id: string; payment_type: string; payment_method: string; amount_cents: number; paid_at: string; recorded_by: string; notes: string | null }[]
}

const STATUS_STYLE: Record<string, string> = {
  lead: 'bg-slate-100 text-slate-700',
  quoted: 'bg-indigo-100 text-indigo-800',
  awaiting_deposit: 'bg-yellow-100 text-yellow-800',
  pending_review: 'bg-blue-100 text-blue-800',
  deposit_paid: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
  modifications_locked: 'bg-gray-100 text-gray-800',
  paid_in_full: 'bg-emerald-100 text-emerald-800',
  completed: 'bg-purple-100 text-purple-800',
  confirmed: 'bg-teal-100 text-teal-800',
  cancelled: 'bg-red-100 text-red-800',
}

function statusLabel(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

type SortKey = 'party_date' | 'contact_name' | 'total_cents' | 'paid_cents' | 'balance_cents' | 'status' | 'party_type'
type TimeFilter = 'upcoming' | 'past' | 'all'
type PaidFilter = 'all' | 'balance_due' | 'paid_in_full'

/** Today in the venue's own terms — a date string, compared as a date string. */
function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(d: string | null) {
  if (!d) return 'TBD'
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatTime(t: string | null) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  if (!Number.isFinite(h)) return t
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${String(m ?? 0).padStart(2, '0')} ${ampm}`
}

/** Days until the party. Negative = past. Null = no date. */
function daysAway(d: string | null): number | null {
  if (!d) return null
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return null
  const then = Date.UTC(y, m - 1, day)
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((then - today) / 86400000)
}

export default function BookedTab({ headers, onLogout }: { headers: HeadersInit; onLogout: () => void }) {
  const [parties, setParties] = useState<BookedParty[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('upcoming')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [paidFilter, setPaidFilter] = useState<PaidFilter>('all')
  const [foodFilter, setFoodFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState<SortKey>('party_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const [selected, setSelected] = useState<PartyDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [invoiceBusy, setInvoiceBusy] = useState(false)

  /**
   * Open the clean printable invoice.
   *
   * NOT a plain link to `/plan/<ref>/summary`: that page is gated by
   * `planAccess`, which takes an `hh_admin` session cookie or the customer's own
   * `hh_portal` cookie for that exact ref, and deliberately NOT the shared admin
   * password — a Bearer header a browser never sends on a navigation. Half of
   * the ways into this panel would have got a 404 from an href. Minting a portal
   * link works from both doors and hands back the same URL you would give the
   * customer.
   */
  async function openInvoice(p: BookedParty) {
    setInvoiceBusy(true)
    // Opened before the await: a popup blocker only trusts a window opened
    // inside the click's own task, and this one is two round-trips away.
    const win = window.open('', '_blank')
    try {
      const r = await fetch(`/api/admin/parties/${p.id}`, {
        method: 'POST',
        headers: { ...Object.fromEntries(new Headers(headers).entries()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate_portal_url', destination: 'invoice' }),
      })
      if (r.status === 401) { win?.close(); onLogout(); return }
      const data = await r.json().catch(() => ({}))
      if (data?.portalUrl && win) win.location.href = data.portalUrl
      else win?.close()
    } catch {
      win?.close()
    } finally {
      setInvoiceBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/admin/booked', { headers })
      .then(async r => {
        if (r.status === 401) { onLogout(); return null }
        const data = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(data?.error || `Request failed (${r.status})`)
        return data
      })
      .then(data => {
        if (cancelled || !data) return
        setParties(data.parties || [])
        setTotals(data.totals || null)
        setError('')
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load booked parties') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function openDetail(p: BookedParty) {
    // Show what we already have immediately, then fill in line items + payments.
    setSelected(p)
    setDetailLoading(true)
    try {
      const r = await fetch(`/api/admin/parties/${p.id}`, { headers })
      if (r.status === 401) { onLogout(); return }
      if (!r.ok) return
      const full = await r.json()
      // The list row's money is the derived one and must win over the stored
      // columns the detail endpoint returns verbatim.
      setSelected(cur => (cur && cur.id === p.id ? { ...full, ...p, line_items: full.line_items, payments: full.payments } : cur))
    } catch {
      /* the panel still shows the list row — a failed enrich is not a failed open */
    } finally {
      setDetailLoading(false)
    }
  }

  const partyTypes = useMemo(
    () => Array.from(new Set(parties.map(p => p.party_type || 'unknown'))).sort(),
    [parties],
  )

  const visible = useMemo(() => {
    const today = todayISO()
    const term = search.trim().toLowerCase()

    let rows = parties.filter(p => {
      if (timeFilter === 'upcoming' && p.party_date && p.party_date < today) return false
      if (timeFilter === 'past' && (!p.party_date || p.party_date >= today)) return false

      if (typeFilter !== 'all' && (p.party_type || 'unknown') !== typeFilter) return false

      if (paidFilter === 'balance_due' && p.balance_cents <= 0) return false
      if (paidFilter === 'paid_in_full' && p.balance_cents > 0) return false

      if (foodFilter !== 'all') {
        if (foodFilter === 'pizza' || foodFilter === 'bagels') {
          if (p.food.main?.value !== foodFilter) return false
        } else if (foodFilter === 'vanilla' || foodFilter === 'chocolate') {
          if (p.food.cupcake?.value !== foodFilter) return false
        }
      }

      if (term) {
        const hay = [
          p.booking_ref, p.contact_name, p.contact_email, p.contact_phone,
          p.child_name, p.package_type, p.invoice_number, p.event_type,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })

    const dir = sortDir === 'asc' ? 1 : -1
    rows = [...rows].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      // Undated / unpriced rows sort to the bottom in BOTH directions — they are
      // "unknown", not "smallest", and burying them under a descending sort is
      // how a party with no date gets forgotten.
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
    return rows
  }, [parties, search, timeFilter, typeFilter, paidFilter, foodFilter, sortKey, sortDir])

  const visibleTotals = useMemo(
    () =>
      visible.reduce(
        (acc, p) => {
          acc.total += p.total_cents ?? 0
          acc.paid += p.paid_cents
          acc.due += p.balance_cents
          return acc
        },
        { total: 0, paid: 0, due: 0 },
      ),
    [visible],
  )

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'party_date' || key === 'contact_name' ? 'asc' : 'desc') }
  }

  function SortHeader({ label, k, align = 'left' }: { label: string; k: SortKey; align?: 'left' | 'right' | 'center' }) {
    const active = sortKey === k
    const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown
    return (
      <th className={`py-2 px-3 font-medium text-${align}`}>
        <button
          onClick={() => toggleSort(k)}
          className={`inline-flex items-center gap-1 hover:text-hampton-navy transition-colors ${active ? 'text-hampton-navy' : 'text-gray-500'}`}
        >
          {label}
          <Icon className="w-3 h-3" />
        </button>
      </th>
    )
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading booked parties…</div>

  if (error) {
    return (
      <div className="p-6">
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Could not load the booked list.</p>
            <p className="text-red-700/80 mt-1">{error}</p>
            <p className="text-red-700/80 mt-2">
              Nothing is shown rather than a partial list — a short list of booked
              parties that looks complete is worse than no list.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* ── Summary ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Booked parties" value={String(visible.length)} sub={`of ${totals?.count ?? parties.length} on the books`} />
        <SummaryCard label="Contract value" value={formatMoney(visibleTotals.total)} sub="sum of totals shown" />
        <SummaryCard label="Collected" value={formatMoney(visibleTotals.paid)} sub="recorded payments" tone="good" />
        <SummaryCard label="Still owed" value={formatMoney(visibleTotals.due)} sub="across parties shown" tone={visibleTotals.due > 0 ? 'warn' : 'good'} />
      </div>

      {/* ── Filters ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, ref, child, email, phone, theme…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-hampton-blue/40"
            />
          </div>
          <div className="flex gap-2">
            <Select value={timeFilter} onChange={v => setTimeFilter(v as TimeFilter)} options={[
              ['upcoming', 'Upcoming'], ['past', 'Past'], ['all', 'All dates'],
            ]} />
            <Select value={paidFilter} onChange={v => setPaidFilter(v as PaidFilter)} options={[
              ['all', 'Any balance'], ['balance_due', 'Balance due'], ['paid_in_full', 'Settled'],
            ]} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <FilterChip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>All types</FilterChip>
          {partyTypes.map(t => (
            <FilterChip key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)}>
              {PARTY_TYPE_LABELS[t] ?? t}
            </FilterChip>
          ))}
          <span className="w-px bg-gray-200 mx-1" />
          <FilterChip active={foodFilter === 'all'} onClick={() => setFoodFilter('all')}>Any food</FilterChip>
          <FilterChip active={foodFilter === 'pizza'} onClick={() => setFoodFilter('pizza')}>🍕 Pizza</FilterChip>
          <FilterChip active={foodFilter === 'bagels'} onClick={() => setFoodFilter('bagels')}>🥯 Bagels</FilterChip>
          <FilterChip active={foodFilter === 'vanilla'} onClick={() => setFoodFilter('vanilla')}>Vanilla</FilterChip>
          <FilterChip active={foodFilter === 'chocolate'} onClick={() => setFoodFilter('chocolate')}>Chocolate</FilterChip>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-xs uppercase tracking-wide">
              <tr>
                <SortHeader label="Date" k="party_date" />
                <SortHeader label="Customer" k="contact_name" />
                <th className="py-2 px-3 font-medium text-gray-500 text-left">Party</th>
                <th className="py-2 px-3 font-medium text-gray-500 text-left">Food</th>
                <SortHeader label="Type" k="party_type" />
                <SortHeader label="Status" k="status" />
                <SortHeader label="Total" k="total_cents" align="right" />
                <SortHeader label="Paid" k="paid_cents" align="right" />
                <SortHeader label="Owed" k="balance_cents" align="right" />
              </tr>
            </thead>
            <tbody>
              {visible.map(p => {
                const away = daysAway(p.party_date)
                const food = foodSummary(p.food)
                return (
                  <tr
                    key={p.id}
                    onClick={() => openDetail(p)}
                    className="border-b border-gray-100 last:border-0 hover:bg-hampton-blue/5 cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="font-medium text-hampton-navy">{formatDate(p.party_date)}</div>
                      <div className="text-xs text-gray-400">
                        {formatTime(p.party_time)}
                        {away !== null && away >= 0 && away <= 14 && (
                          <span className="ml-1 text-amber-600 font-medium">
                            {away === 0 ? '· today' : away === 1 ? '· tomorrow' : `· in ${away}d`}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-hampton-navy">{p.contact_name || '—'}</div>
                      <div className="text-xs text-gray-400 font-mono">{p.booking_ref}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div>{p.child_name || p.package_type || '—'}</div>
                      <div className="text-xs text-gray-400">
                        {p.guest_count_approx ? `${p.guest_count_approx} guests` : ''}
                        {p.package_type && p.child_name ? ` · ${p.package_type}` : ''}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      {food ? (
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-100">
                            {p.food.main?.value === 'bagels' ? '🥯' : '🍕'} {p.food.main?.label}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded border ${p.food.cupcake?.value === 'chocolate' ? 'bg-stone-100 text-stone-800 border-stone-200' : 'bg-yellow-50 text-yellow-800 border-yellow-100'}`}>
                            🧁 {p.food.cupcake?.label}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">not recorded</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-gray-600">{PARTY_TYPE_LABELS[p.party_type || 'unknown'] ?? p.party_type}</td>
                    <td className="py-2.5 px-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[p.status] ?? 'bg-gray-100 text-gray-700'}`}>
                        {statusLabel(p.status)}
                      </span>
                      {p.evidence === 'status_only' && (
                        <span
                          className="ml-1 text-[10px] text-gray-400"
                          title="No payment row on file — this party is booked according to its status only."
                        >
                          no receipt
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">{p.total_cents ? formatMoney(p.total_cents) : '—'}</td>
                    <td className="py-2.5 px-3 text-right text-emerald-700">{p.paid_cents ? formatMoney(p.paid_cents) : '—'}</td>
                    <td className={`py-2.5 px-3 text-right font-medium ${p.balance_cents > 0 ? 'text-hampton-navy' : 'text-emerald-600'}`}>
                      {p.balance_cents > 0 ? formatMoney(p.balance_cents) : <CheckCircle2 className="w-4 h-4 inline" />}
                    </td>
                  </tr>
                )
              })}
              {!visible.length && (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-sm text-gray-400">
                    No booked parties match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totals && totals.withPaymentRow < totals.count && (
        <p className="text-xs text-gray-500">
          {totals.count - totals.withPaymentRow} of these are booked by <strong>status only</strong> — no
          payment row on file, so their &ldquo;paid&rdquo; figure is blank rather than assumed.
        </p>
      )}

      {selected && (
        <DetailPanel
          party={selected}
          loading={detailLoading}
          onClose={() => setSelected(null)}
          onOpenInvoice={() => openInvoice(selected)}
          invoiceBusy={invoiceBusy}
        />
      )}
    </div>
  )
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

function SummaryCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' }) {
  const valueColor = tone === 'good' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-hampton-navy'
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3">
      <p className="text-[10px] uppercase tracking-widest text-gray-400">{label}</p>
      <p className={`text-xl font-semibold mt-0.5 ${valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
        active
          ? 'bg-hampton-navy text-white border-hampton-navy'
          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
      }`}
    >
      {children}
    </button>
  )
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="text-sm border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-hampton-blue/40"
    >
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}

function DetailPanel({
  party, loading, onClose, onOpenInvoice, invoiceBusy,
}: {
  party: PartyDetail
  loading: boolean
  onClose: () => void
  onOpenInvoice: () => void
  invoiceBusy: boolean
}) {
  const guests = party.guest_count_approx || 1
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-white h-full overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-serif text-lg text-hampton-navy">{party.contact_name || 'Booking'}</h3>
            <p className="text-xs text-gray-400 font-mono">{party.booking_ref}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenInvoice}
              disabled={invoiceBusy}
              className="text-xs inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-50"
              title="Open the customer-facing invoice for this party"
            >
              {invoiceBusy ? 'Opening…' : <>Invoice <ExternalLink className="w-3 h-3" /></>}
            </button>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Money */}
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Total" value={party.total_cents ? formatMoney(party.total_cents) : '—'} />
            <MiniStat label="Paid" value={formatMoney(party.paid_cents)} tone="good" />
            <MiniStat label="Owed" value={formatMoney(party.balance_cents)} tone={party.balance_cents > 0 ? 'warn' : 'good'} />
          </div>

          {party.overpaid_cents > 0 && (
            <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2.5">
              Overpaid by {formatMoney(party.overpaid_cents)}.
            </p>
          )}

          {/* The two things that decide the morning of the party. */}
          <section>
            <SectionTitle>Food selections</SectionTitle>
            {party.food.main || party.food.cupcake ? (
              <div className="space-y-2">
                <FoodRow
                  Icon={Pizza}
                  label="Main"
                  value={party.food.main?.label ?? 'Not recorded'}
                  isDefault={party.food.main?.isDefault ?? false}
                />
                <FoodRow
                  Icon={Cake}
                  label="Cupcakes"
                  value={party.food.cupcake?.label ?? 'Not recorded'}
                  isDefault={party.food.cupcake?.isDefault ?? false}
                />
                {party.food.mobileCupcakes && (
                  <p className="text-xs text-gray-600 pl-6">+ mobile cupcake add-on ($5/guest)</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                This booking has no planner snapshot — hand-entered or pre-planner, so no food choice was
                ever captured.
              </p>
            )}
          </section>

          {/* Logistics */}
          <section>
            <SectionTitle>Party</SectionTitle>
            <dl className="text-sm space-y-1.5">
              <Row Icon={CalendarDays} label="Date">{formatDate(party.party_date)} {formatTime(party.party_time)}</Row>
              <Row Icon={Users} label="Guests">{party.guest_count_approx ?? '—'}</Row>
              <Row label="Theme">{party.package_type || '—'}</Row>
              <Row label="Child">{party.child_name ? `${party.child_name}${party.child_age ? `, age ${party.child_age}` : ''}` : '—'}</Row>
              <Row label="Type">{PARTY_TYPE_LABELS[party.party_type || 'unknown'] ?? party.party_type}</Row>
              <Row Icon={Clock} label="Check-in">{party.checkin_status || 'pending'}</Row>
            </dl>
          </section>

          <section>
            <SectionTitle>Contact</SectionTitle>
            <dl className="text-sm space-y-1.5">
              <Row Icon={Mail} label="Email">
                {party.contact_email
                  ? <a className="text-hampton-blue hover:underline" href={`mailto:${party.contact_email}`}>{party.contact_email}</a>
                  : '—'}
              </Row>
              <Row Icon={Phone} label="Phone">
                {party.contact_phone
                  ? <a className="text-hampton-blue hover:underline" href={`tel:${party.contact_phone}`}>{party.contact_phone}</a>
                  : '—'}
              </Row>
            </dl>
          </section>

          {/* Payments */}
          <section>
            <SectionTitle>Payments ({party.payment_count})</SectionTitle>
            {loading && !party.payments && <p className="text-sm text-gray-400">Loading…</p>}
            {(party.payments || []).map(pay => (
              <div key={pay.id} className="flex items-start justify-between py-1.5 text-sm border-b border-gray-100 last:border-0">
                <div>
                  <span className="font-medium">{formatMoney(pay.amount_cents)}</span>
                  <span className="text-gray-400 ml-2 text-xs">{pay.payment_method} · {pay.payment_type}</span>
                  {pay.notes && <p className="text-xs text-gray-400 mt-0.5">{pay.notes}</p>}
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap ml-3">{(pay.paid_at || '').slice(0, 10)}</span>
              </div>
            ))}
            {!loading && !(party.payments || []).length && (
              <p className="text-sm text-gray-400">
                No payment rows. This party is on the list by its status alone.
              </p>
            )}
          </section>

          {/* Line items */}
          {!!(party.line_items || []).length && (
            <section>
              <SectionTitle>Quote</SectionTitle>
              {(party.line_items || []).map(li => {
                const amt = li.guest_multiplied
                  ? li.unit_price_cents * li.quantity * guests
                  : li.unit_price_cents * li.quantity
                return (
                  <div key={li.id} className="flex items-center justify-between py-1 text-sm border-b border-gray-100 last:border-0">
                    <span className="text-gray-700">
                      {li.name}
                      {li.quantity > 1 && <span className="text-gray-400"> ×{li.quantity}</span>}
                      {li.guest_multiplied && <span className="text-gray-400"> ×{guests} guests</span>}
                    </span>
                    <span className={amt < 0 ? 'text-emerald-600' : 'text-gray-700'}>{formatMoney(amt)}</span>
                  </div>
                )
              })}
            </section>
          )}

          {(party.notes || party.admin_notes) && (
            <section>
              <SectionTitle>Notes</SectionTitle>
              {party.notes && <p className="text-sm text-gray-600 whitespace-pre-wrap">{party.notes}</p>}
              {party.admin_notes && <p className="text-sm text-gray-500 mt-2 whitespace-pre-wrap"><strong>Admin:</strong> {party.admin_notes}</p>}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[10px] uppercase tracking-widest text-gray-400 mb-2">{children}</h4>
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' }) {
  const color = tone === 'good' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-hampton-navy'
  return (
    <div className="bg-gray-50 rounded-lg p-2.5 text-center">
      <p className="text-[10px] uppercase tracking-widest text-gray-400">{label}</p>
      <p className={`text-base font-semibold ${color}`}>{value}</p>
    </div>
  )
}

function Row({ Icon, label, children }: { Icon?: typeof Users; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      {Icon ? <Icon className="w-3.5 h-3.5 text-gray-300 shrink-0" /> : <span className="w-3.5 shrink-0" />}
      <dt className="text-gray-400 w-20 shrink-0 text-xs">{label}</dt>
      <dd className="text-gray-800">{children}</dd>
    </div>
  )
}

function FoodRow({ Icon, label, value, isDefault }: { Icon: typeof Pizza; label: string; value: string; isDefault: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="w-4 h-4 text-hampton-blue shrink-0" />
      <span className="text-gray-400 w-20 shrink-0 text-xs">{label}</span>
      <span className="font-medium text-hampton-navy">{value}</span>
      {isDefault && (
        <span
          className="text-[10px] text-gray-400 border border-gray-200 rounded px-1"
          title="This is the planner's starting value — the customer may never have touched the control. Confirm before ordering."
        >
          default
        </span>
      )}
    </div>
  )
}
