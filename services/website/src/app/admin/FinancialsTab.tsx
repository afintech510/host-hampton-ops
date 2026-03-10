'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  DollarSign, Upload, Plus, Download, Filter, Search,
  Calendar, TrendingUp, CreditCard, Banknote, Store,
  FileSpreadsheet, X, ChevronDown, ChevronUp, Loader2, Check,
  ArrowUpRight, ArrowDownRight, PieChart, BarChart3,
  ChevronLeft, ChevronRight
} from 'lucide-react'

/* ─── Interfaces ─────────────────────────────────────── */

interface Transaction {
  id: string
  date: string
  description: string
  amount_cents: number
  source: 'stripe' | 'godaddy' | 'squarespace' | 'honeybook' | 'cash' | 'other'
  category: string
  customer_name: string | null
  reference: string | null
  notes: string | null
  created_at: string
}

interface SummaryData {
  totalRevenue: number
  totalCount: number
  thisMonth: number
  lastMonth: number
  thisQuarter: number
  sameQuarterLastYear: number
  ytd: number
  lastYearYtd: number
  annualRunRate: number
  quarterlyRunRate: number
  bySource: Record<string, { revenue: number; count: number }>
  byCategory: Record<string, number>
}

type ViewMode = 'overview' | 'transactions'
type SourceFilter = 'all' | Transaction['source']
type TimeFilter = 'all' | 'month' | 'last_month' | 'quarter' | 'ytd' | 'year' | 'custom'

const TIME_OPTIONS: { key: TimeFilter; label: string }[] = [
  { key: 'month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'quarter', label: 'This Quarter' },
  { key: 'ytd', label: 'YTD' },
  { key: 'year', label: 'This Year' },
  { key: 'all', label: 'All Time' },
  { key: 'custom', label: 'Custom' },
]

const SOURCE_CONFIG: Record<string, { label: string; color: string; icon: typeof DollarSign }> = {
  stripe:      { label: 'Stripe',      color: 'bg-purple-50 text-purple-700 ring-purple-200',   icon: CreditCard },
  godaddy:     { label: 'GoDaddy',     color: 'bg-green-50 text-green-700 ring-green-200',      icon: Store },
  squarespace: { label: 'Squarespace', color: 'bg-gray-50 text-gray-700 ring-gray-200',         icon: FileSpreadsheet },
  honeybook:   { label: 'HoneyBook',   color: 'bg-amber-50 text-amber-700 ring-amber-200',      icon: FileSpreadsheet },
  cash:        { label: 'Cash',        color: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: Banknote },
  other:       { label: 'Other',       color: 'bg-blue-50 text-blue-700 ring-blue-200',          icon: DollarSign },
}

const CATEGORIES = [
  'Party Booking', 'Event Ticket', 'Room Rental', 'Permanent Jewelry',
  'Canvas Bags', 'Trucker Hats', 'Food & Beverage', 'Merchandise',
  'Vendor Fee', 'Gift Card', 'Deposit', 'Other'
]

const PAGE_SIZE = 100

/* ─── Date range helpers ─────────────────────────────── */

function getDateRange(filter: TimeFilter, customStart: string, customEnd: string): { start?: string; end?: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()

  switch (filter) {
    case 'month':
      return { start: `${y}-${String(m + 1).padStart(2, '0')}-01` }
    case 'last_month': {
      const lm = new Date(y, m - 1, 1)
      const lmEnd = new Date(y, m, 0)
      return {
        start: `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, '0')}-01`,
        end: `${lmEnd.getFullYear()}-${String(lmEnd.getMonth() + 1).padStart(2, '0')}-${String(lmEnd.getDate()).padStart(2, '0')}`,
      }
    }
    case 'quarter': {
      const qStart = new Date(y, Math.floor(m / 3) * 3, 1)
      return { start: `${qStart.getFullYear()}-${String(qStart.getMonth() + 1).padStart(2, '0')}-01` }
    }
    case 'ytd':
      return { start: `${y}-01-01` }
    case 'year':
      return { start: `${y}-01-01`, end: `${y}-12-31` }
    case 'custom':
      return { start: customStart || undefined, end: customEnd || undefined }
    case 'all':
    default:
      return {}
  }
}

/* ─── Main Component ─────────────────────────────────── */

export default function FinancialsTab({ headers, onLogout }: { headers: Record<string, string>; onLogout: () => void }) {
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [totalTxns, setTotalTxns] = useState(0)
  const [page, setPage] = useState(0)
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [loadingTxns, setLoadingTxns] = useState(false)
  const [view, setView] = useState<ViewMode>('overview')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [showCashForm, setShowCashForm] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importSource, setImportSource] = useState<'godaddy' | 'squarespace' | 'honeybook'>('godaddy')

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Build query params from current filters
  const buildParams = useCallback(() => {
    const { start, end } = getDateRange(timeFilter, customStart, customEnd)
    const params = new URLSearchParams()
    if (start) params.set('start', start)
    if (end) params.set('end', end)
    if (sourceFilter !== 'all') params.set('source', sourceFilter)
    return params
  }, [timeFilter, customStart, customEnd, sourceFilter])

  // Load summary (KPIs + charts)
  const loadSummary = useCallback(async () => {
    setLoadingSummary(true)
    try {
      const params = buildParams()
      const res = await fetch(`/api/admin/financials/summary?${params}`, { headers })
      if (res.status === 401) { onLogout(); return }
      if (res.ok) {
        const data = await res.json()
        setSummary(data)
      }
    } catch (err) {
      console.error('Failed to load summary:', err)
    } finally {
      setLoadingSummary(false)
    }
  }, [buildParams, headers, onLogout])

  // Load transactions (paginated)
  const loadTransactions = useCallback(async (pageNum: number = 0, search: string = searchQuery) => {
    setLoadingTxns(true)
    try {
      const params = buildParams()
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', String(pageNum * PAGE_SIZE))
      if (search) params.set('search', search)
      const res = await fetch(`/api/admin/financials?${params}`, { headers })
      if (res.status === 401) { onLogout(); return }
      if (res.ok) {
        const data = await res.json()
        setTransactions(data.transactions || [])
        setTotalTxns(data.total || 0)
      }
    } catch (err) {
      console.error('Failed to load transactions:', err)
    } finally {
      setLoadingTxns(false)
    }
  }, [buildParams, headers, onLogout, searchQuery])

  // Reload on filter change
  useEffect(() => {
    loadSummary()
    setPage(0)
    if (view === 'transactions') loadTransactions(0)
  }, [timeFilter, customStart, customEnd, sourceFilter])

  // Load transactions when switching to transactions view
  useEffect(() => {
    if (view === 'transactions') loadTransactions(page)
  }, [view, page])

  // Initial load
  useEffect(() => { loadSummary() }, [])

  // Debounced search
  function handleSearchChange(val: string) {
    setSearchQuery(val)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      setPage(0)
      loadTransactions(0, val)
    }, 400)
  }

  function handlePageChange(newPage: number) {
    setPage(newPage)
  }

  function fmt(cents: number) {
    return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  function fmtShort(cents: number) {
    return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }

  const totalPages = Math.ceil(totalTxns / PAGE_SIZE)

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* ── Timeframe + View Controls ── */}
      <div className="admin-card p-3 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Timeframe pills */}
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
            <Calendar className="w-4 h-4 text-hampton-mauve mr-1 shrink-0" />
            {TIME_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTimeFilter(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  timeFilter === key
                    ? 'bg-hampton-navy text-white shadow-sm'
                    : 'text-gray-500 hover:text-hampton-navy hover:bg-gray-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
              {(['overview', 'transactions'] as ViewMode[]).map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    view === v ? 'bg-white text-hampton-navy shadow-sm' : 'text-gray-500 hover:text-hampton-navy'
                  }`}
                >
                  {v === 'overview' ? 'Overview' : 'Transactions'}
                </button>
              ))}
            </div>

            <button onClick={() => setShowCashForm(true)} className="admin-btn-secondary text-xs">
              <Plus className="w-3.5 h-3.5" /> Cash
            </button>
            <button onClick={() => setShowImportModal(true)} className="admin-btn-primary text-xs">
              <Upload className="w-3.5 h-3.5" /> Import
            </button>
          </div>
        </div>

        {/* Custom date range inputs */}
        {timeFilter === 'custom' && (
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <label className="text-xs text-hampton-mauve font-medium">From</label>
              <input
                type="date"
                value={customStart}
                onChange={e => setCustomStart(e.target.value)}
                className="form-input py-1.5 text-xs w-auto"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-hampton-mauve font-medium">To</label>
              <input
                type="date"
                value={customEnd}
                onChange={e => setCustomEnd(e.target.value)}
                className="form-input py-1.5 text-xs w-auto"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── KPI Row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="admin-kpi">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-blue-500/5 pointer-events-none" />
          <div className="relative">
            <div className="admin-kpi-icon mb-3"><DollarSign className="w-5 h-5 text-hampton-blue" /></div>
            <p className="admin-kpi-value">{loadingSummary ? '...' : fmtShort(summary?.totalRevenue || 0)}</p>
            <p className="admin-kpi-label">Total ({TIME_OPTIONS.find(t => t.key === timeFilter)?.label || timeFilter})</p>
            {!loadingSummary && summary && (
              <p className="text-[10px] text-gray-400 mt-1">{summary.totalCount.toLocaleString()} transactions</p>
            )}
          </div>
        </div>
        <div className="admin-kpi">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 pointer-events-none" />
          <div className="relative">
            <div className="admin-kpi-icon mb-3"><TrendingUp className="w-5 h-5 text-emerald-600" /></div>
            <p className="admin-kpi-value">{loadingSummary ? '...' : fmtShort(summary?.quarterlyRunRate || 0)}</p>
            <p className="admin-kpi-label">Quarterly Run Rate</p>
            {!loadingSummary && summary && (
              <PaceIndicator current={summary.thisQuarter} lastYear={summary.sameQuarterLastYear} label="vs same Q last year" />
            )}
          </div>
        </div>
        <div className="admin-kpi">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-purple-500/5 pointer-events-none" />
          <div className="relative">
            <div className="admin-kpi-icon mb-3"><BarChart3 className="w-5 h-5 text-purple-600" /></div>
            <p className="admin-kpi-value">{loadingSummary ? '...' : fmtShort(summary?.annualRunRate || 0)}</p>
            <p className="admin-kpi-label">Annual Run Rate</p>
            {!loadingSummary && summary && (
              <PaceIndicator current={summary.ytd} lastYear={summary.lastYearYtd} label="YTD vs last year" />
            )}
          </div>
        </div>
        <div className="admin-kpi">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-amber-500/5 pointer-events-none" />
          <div className="relative">
            <div className="admin-kpi-icon mb-3"><Calendar className="w-5 h-5 text-amber-600" /></div>
            <p className="admin-kpi-value">{loadingSummary ? '...' : fmtShort(summary?.thisMonth || 0)}</p>
            <p className="admin-kpi-label">This Month</p>
            {!loadingSummary && summary && summary.lastMonth > 0 && (
              <p className="text-[10px] text-gray-400 mt-1">Last month: {fmtShort(summary.lastMonth)}</p>
            )}
          </div>
        </div>
      </div>

      {view === 'overview' ? (
        <OverviewView summary={summary} loading={loadingSummary} fmtShort={fmtShort} />
      ) : (
        <>
          {/* ── Filters ── */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={searchQuery}
                onChange={e => handleSearchChange(e.target.value)}
                placeholder="Search transactions..."
                className="form-input pl-10"
              />
            </div>
            <select
              value={sourceFilter}
              onChange={e => setSourceFilter(e.target.value as SourceFilter)}
              className="form-input w-auto"
            >
              <option value="all">All Sources</option>
              {Object.entries(SOURCE_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>

          {/* ── Transaction List ── */}
          <TransactionList transactions={transactions} fmt={fmt} loading={loadingTxns} />

          {/* ── Pagination ── */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-hampton-mauve">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalTxns)} of {totalTxns.toLocaleString()}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page === 0}
                  className="admin-btn-ghost text-xs disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" /> Prev
                </button>
                <span className="text-xs text-gray-500">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages - 1}
                  className="admin-btn-ghost text-xs disabled:opacity-30"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Cash Entry Modal ── */}
      {showCashForm && (
        <CashEntryModal
          headers={headers}
          onClose={() => setShowCashForm(false)}
          onSaved={() => { setShowCashForm(false); loadSummary(); if (view === 'transactions') loadTransactions(page) }}
        />
      )}

      {/* ── Import Modal ── */}
      {showImportModal && (
        <ImportModal
          headers={headers}
          source={importSource}
          onSourceChange={setImportSource}
          onClose={() => setShowImportModal(false)}
          onImported={() => { setShowImportModal(false); loadSummary(); if (view === 'transactions') loadTransactions(page) }}
        />
      )}
    </div>
  )
}

/* ─── Pace Indicator ─────────────────────────────────── */

function PaceIndicator({ current, lastYear, label }: { current: number; lastYear: number; label: string }) {
  if (lastYear === 0 && current === 0) return null

  const pctChange = lastYear > 0 ? Math.round(((current - lastYear) / lastYear) * 100) : (current > 0 ? 100 : 0)
  const ahead = pctChange >= 0
  const paceText = lastYear === 0 ? 'No data last year' : ahead ? 'Ahead' : 'Behind'
  const color = ahead ? 'text-emerald-600' : 'text-red-500'

  return (
    <div className="flex items-center gap-1 mt-1">
      {lastYear > 0 ? (
        <>
          {ahead ? <ArrowUpRight className="w-3 h-3 text-emerald-600" /> : <ArrowDownRight className="w-3 h-3 text-red-500" />}
          <span className={`text-[10px] font-semibold ${color}`}>{Math.abs(pctChange)}% {paceText}</span>
        </>
      ) : (
        <span className="text-[10px] text-gray-400">{paceText}</span>
      )}
      <span className="text-[10px] text-gray-400 ml-0.5">{label}</span>
    </div>
  )
}

/* ─── Overview View ──────────────────────────────────── */

function OverviewView({ summary, loading, fmtShort }: { summary: SummaryData | null; loading: boolean; fmtShort: (n: number) => string }) {
  if (loading || !summary) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-hampton-blue animate-spin" />
      </div>
    )
  }

  const sortedSources = Object.entries(summary.bySource).sort((a, b) => b[1].revenue - a[1].revenue)
  const sortedCategories = Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1])
  const maxSource = sortedSources.length > 0 ? sortedSources[0][1].revenue : 1

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Revenue by Source */}
      <div className="admin-card p-6">
        <h3 className="admin-section-title mb-1">Revenue by Source</h3>
        <p className="text-xs text-hampton-mauve mb-5">Where your money comes from</p>
        {sortedSources.length === 0 ? (
          <p className="text-sm text-hampton-mauve py-8 text-center">No transaction data yet. Import your sales data to get started.</p>
        ) : (
          <div className="space-y-3">
            {sortedSources.map(([source, { revenue, count }]) => {
              const cfg = SOURCE_CONFIG[source] || SOURCE_CONFIG.other
              const pct = Math.round((revenue / (summary.totalRevenue || 1)) * 100)
              return (
                <div key={source}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`admin-badge ${cfg.color} ring-1`}>{cfg.label}</span>
                      <span className="text-[10px] text-gray-400">{count.toLocaleString()} txns</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-hampton-mauve">{pct}%</span>
                      <span className="text-sm font-semibold text-hampton-navy">{fmtShort(revenue)}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-hampton-blue to-hampton-blue/70 rounded-full transition-all duration-700"
                      style={{ width: `${Math.round((revenue / maxSource) * 100)}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Revenue by Category */}
      <div className="admin-card p-6">
        <h3 className="admin-section-title mb-1">Revenue by Category</h3>
        <p className="text-xs text-hampton-mauve mb-5">What generates the most revenue</p>
        {sortedCategories.length === 0 ? (
          <p className="text-sm text-hampton-mauve py-8 text-center">No transaction data yet.</p>
        ) : (
          <div className="space-y-2.5">
            {sortedCategories.map(([category, amount]) => {
              const pct = Math.round((amount / (summary.totalRevenue || 1)) * 100)
              return (
                <div key={category} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-hampton-blue/60" />
                    <span className="text-sm text-gray-700">{category}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-hampton-mauve bg-gray-50 px-2 py-0.5 rounded-full">{pct}%</span>
                    <span className="text-sm font-semibold text-hampton-navy min-w-[80px] text-right">{fmtShort(amount)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Transaction List ───────────────────────────────── */

function TransactionList({ transactions, fmt, loading }: { transactions: Transaction[]; fmt: (n: number) => string; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-hampton-blue animate-spin" />
      </div>
    )
  }

  return (
    <div className="admin-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-left py-3 px-4 text-xs font-semibold text-hampton-mauve uppercase tracking-wider">Date</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-hampton-mauve uppercase tracking-wider">Description</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-hampton-mauve uppercase tracking-wider">Customer</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-hampton-mauve uppercase tracking-wider">Source</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-hampton-mauve uppercase tracking-wider">Category</th>
              <th className="text-right py-3 px-4 text-xs font-semibold text-hampton-mauve uppercase tracking-wider">Amount</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map(t => {
              const cfg = SOURCE_CONFIG[t.source] || SOURCE_CONFIG.other
              return (
                <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                  <td className="py-3 px-4 text-gray-500 whitespace-nowrap">
                    {new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                  </td>
                  <td className="py-3 px-4 text-hampton-navy font-medium max-w-[250px] truncate">{t.description}</td>
                  <td className="py-3 px-4 text-gray-600">{t.customer_name || '—'}</td>
                  <td className="py-3 px-4">
                    <span className={`admin-badge ${cfg.color} ring-1`}>{cfg.label}</span>
                  </td>
                  <td className="py-3 px-4 text-gray-500 text-xs">{t.category}</td>
                  <td className="py-3 px-4 text-right font-semibold text-hampton-navy">{fmt(t.amount_cents)}</td>
                </tr>
              )
            })}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={6} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center">
                      <DollarSign className="w-6 h-6 text-gray-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-hampton-navy">No transactions found</p>
                      <p className="text-xs text-hampton-mauve mt-1">Import sales data or add a cash transaction to get started</p>
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ─── Cash Entry Modal ───────────────────────────────── */

function CashEntryModal({ headers, onClose, onSaved }: { headers: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    description: '',
    amount: '',
    category: 'Other',
    customer_name: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.description || !form.amount) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/financials', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          date: form.date,
          description: form.description,
          amount_cents: Math.round(parseFloat(form.amount) * 100),
          source: 'cash',
          category: form.category,
          customer_name: form.customer_name || null,
          notes: form.notes || null,
        }),
      })
      if (res.ok) onSaved()
    } catch (err) {
      console.error('Save error:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <form onSubmit={handleSave} className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Banknote className="w-5 h-5 text-emerald-600" />
            <h3 className="font-semibold text-hampton-navy">Cash Transaction</h3>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Date *</label>
              <input type="date" className="form-input" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required />
            </div>
            <div>
              <label className="form-label">Amount *</label>
              <input type="number" step="0.01" min="0" className="form-input" placeholder="0.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required />
            </div>
          </div>
          <div>
            <label className="form-label">Description *</label>
            <input className="form-input" placeholder="e.g. Walk-in hat purchase" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} required />
          </div>
          <div>
            <label className="form-label">Category</label>
            <select className="form-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Customer Name</label>
            <input className="form-input" placeholder="Optional" value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Notes</label>
            <textarea className="form-input" rows={2} placeholder="Optional notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50 rounded-b-2xl">
          <button type="button" onClick={onClose} className="admin-btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="admin-btn-primary text-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Save
          </button>
        </div>
      </form>
    </div>
  )
}

/* ─── Import Modal ───────────────────────────────────── */

function ImportModal({ headers, source, onSourceChange, onClose, onImported }: {
  headers: Record<string, string>
  source: 'godaddy' | 'squarespace' | 'honeybook'
  onSourceChange: (s: 'godaddy' | 'squarespace' | 'honeybook') => void
  onClose: () => void
  onImported: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null)

  async function handleImport() {
    if (!file) return
    setImporting(true)
    setResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('source', source)

      const res = await fetch('/api/admin/financials/import', {
        method: 'POST',
        headers: { Authorization: headers.Authorization },
        body: formData,
      })
      const data = await res.json()
      if (res.ok) {
        setResult({ imported: data.imported || 0, skipped: data.skipped || 0, errors: data.errors || [] })
      } else {
        setResult({ imported: 0, skipped: 0, errors: [data.error || 'Import failed'] })
      }
    } catch (err) {
      setResult({ imported: 0, skipped: 0, errors: ['Network error'] })
    } finally {
      setImporting(false)
    }
  }

  const sources: { key: 'godaddy' | 'squarespace' | 'honeybook'; label: string; desc: string }[] = [
    { key: 'godaddy', label: 'GoDaddy', desc: 'POS sales & paylink transactions' },
    { key: 'squarespace', label: 'Squarespace', desc: 'Legacy website sales (one-time import)' },
    { key: 'honeybook', label: 'HoneyBook', desc: 'Booking payments & invoices' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-hampton-blue" />
            <h3 className="font-semibold text-hampton-navy">Import Sales Data</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-5">
          {/* Source selector */}
          <div className="space-y-2">
            <label className="form-label">Select Source</label>
            <div className="grid grid-cols-3 gap-2">
              {sources.map(s => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => onSourceChange(s.key)}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${
                    source === s.key
                      ? 'border-hampton-navy bg-hampton-navy/5'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <p className={`text-sm font-semibold ${source === s.key ? 'text-hampton-navy' : 'text-gray-700'}`}>{s.label}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">{s.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* File upload */}
          <div>
            <label className="form-label">Upload CSV/Excel File</label>
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-hampton-blue hover:bg-hampton-blue/5 transition-all"
            >
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
              {file ? (
                <div className="flex items-center justify-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-hampton-navy" />
                  <span className="text-sm font-medium text-hampton-navy">{file.name}</span>
                  <button onClick={e => { e.stopPropagation(); setFile(null) }} className="text-gray-400 hover:text-red-500">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-600">Click to upload or drag & drop</p>
                  <p className="text-xs text-gray-400 mt-1">CSV or Excel file</p>
                </>
              )}
            </div>
          </div>

          {/* Import result */}
          {result && (
            <div className={`p-4 rounded-xl ${result.errors.length > 0 && result.imported === 0 ? 'bg-red-50 border border-red-200' : 'bg-emerald-50 border border-emerald-200'}`}>
              {result.imported > 0 && (
                <p className="text-sm text-emerald-700 font-medium">
                  <Check className="w-4 h-4 inline mr-1" />
                  Imported {result.imported} transactions{result.skipped > 0 ? ` (${result.skipped} skipped as duplicates)` : ''}
                </p>
              )}
              {result.errors.map((err, i) => (
                <p key={i} className="text-sm text-red-700 mt-1">{err}</p>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50 rounded-b-2xl">
          <button onClick={onClose} className="admin-btn-secondary text-sm">
            {result?.imported ? 'Done' : 'Cancel'}
          </button>
          {!result?.imported && (
            <button onClick={handleImport} disabled={!file || importing} className="admin-btn-primary text-sm disabled:opacity-50">
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Import
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
