'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search, Gift, RefreshCw, XCircle } from 'lucide-react'

interface GiftCard {
  id: string
  code: string
  amount_cents: number
  balance_cents: number
  purchaser_name: string
  purchaser_email: string
  recipient_name: string | null
  recipient_email: string | null
  personal_message: string | null
  status: string
  purchased_at: string
  expires_at: string | null
  redeemed_at: string | null
}

interface Summary {
  totalSold: number
  totalRedeemed: number
  totalOutstanding: number
  activeCount: number
  redeemedCount: number
  totalCount: number
}

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  redeemed: 'bg-blue-100 text-blue-700',
  expired: 'bg-yellow-100 text-yellow-700',
  cancelled: 'bg-red-100 text-red-700',
}

export default function GiftCardsTab({ headers, onLogout }: { headers: Record<string, string>; onLogout: () => void }) {
  const [cards, setCards] = useState<GiftCard[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  const fetchCards = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (search) params.set('search', search)
      const res = await fetch(`/api/admin/gift-cards?${params}`, { headers })
      if (res.status === 401) { onLogout(); return }
      const data = await res.json()
      setCards(data.cards || [])
      setSummary(data.summary || null)
    } catch { /* silent */ }
    setLoading(false)
  }, [headers, onLogout, statusFilter, search])

  useEffect(() => { fetchCards() }, [fetchCards])

  async function handleStatusChange(id: string, newStatus: string) {
    if (!confirm(`Change this gift card to "${newStatus}"?`)) return
    await fetch('/api/admin/gift-cards', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ id, status: newStatus }),
    })
    fetchCards()
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* KPI Cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="admin-kpi">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Total Sold</p>
            <p className="text-xl font-bold text-hampton-navy">{fmt(summary.totalSold)}</p>
            <p className="text-xs text-gray-400">{summary.totalCount} cards</p>
          </div>
          <div className="admin-kpi">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Redeemed</p>
            <p className="text-xl font-bold text-blue-600">{fmt(summary.totalRedeemed)}</p>
            <p className="text-xs text-gray-400">{summary.redeemedCount} fully used</p>
          </div>
          <div className="admin-kpi">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Outstanding</p>
            <p className="text-xl font-bold text-green-600">{fmt(summary.totalOutstanding)}</p>
            <p className="text-xs text-gray-400">{summary.activeCount} active</p>
          </div>
          <div className="admin-kpi">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Active</p>
            <p className="text-xl font-bold text-hampton-navy">{summary.activeCount}</p>
          </div>
          <div className="admin-kpi">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Avg Value</p>
            <p className="text-xl font-bold text-hampton-navy">
              {summary.totalCount > 0 ? fmt(Math.round(summary.totalSold / summary.totalCount)) : '$0'}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search code, name, or email..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-blue/30"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm bg-white"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="redeemed">Redeemed</option>
          <option value="cancelled">Cancelled</option>
          <option value="expired">Expired</option>
        </select>
        <button onClick={fetchCards} className="p-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-semibold text-gray-600">Code</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Amount</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Balance</th>
                <th className="px-4 py-3 font-semibold text-gray-600 hidden md:table-cell">Purchaser</th>
                <th className="px-4 py-3 font-semibold text-gray-600 hidden lg:table-cell">Recipient</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3 font-semibold text-gray-600 hidden sm:table-cell">Date</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cards.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                    <Gift className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    No gift cards found
                  </td>
                </tr>
              )}
              {cards.map(card => (
                <tr key={card.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-hampton-navy tracking-wider text-xs">
                    {card.code}
                  </td>
                  <td className="px-4 py-3 font-semibold">{fmt(card.amount_cents)}</td>
                  <td className="px-4 py-3">
                    <span className={card.balance_cents === 0 ? 'text-gray-400' : 'text-green-600 font-semibold'}>
                      {fmt(card.balance_cents)}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <div className="text-sm">{card.purchaser_name}</div>
                    <div className="text-xs text-gray-400">{card.purchaser_email}</div>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="text-sm">{card.recipient_name || '—'}</div>
                    <div className="text-xs text-gray-400">{card.recipient_email || ''}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[card.status] || 'bg-gray-100 text-gray-600'}`}>
                      {card.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 hidden sm:table-cell">
                    {fmtDate(card.purchased_at)}
                  </td>
                  <td className="px-4 py-3">
                    {card.status === 'active' && (
                      <button
                        onClick={() => handleStatusChange(card.id, 'cancelled')}
                        className="text-red-500 hover:text-red-700 transition-colors"
                        title="Cancel gift card"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                    {card.status === 'cancelled' && (
                      <button
                        onClick={() => handleStatusChange(card.id, 'active')}
                        className="text-green-500 hover:text-green-700 text-xs font-medium"
                        title="Reactivate"
                      >
                        Reactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
