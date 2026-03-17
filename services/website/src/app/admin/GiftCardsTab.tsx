'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search, Gift, RefreshCw, XCircle, Send, Mail, MessageSquare, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react'

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
  const [promoOpen, setPromoOpen] = useState(false)
  const [promoName, setPromoName] = useState('')
  const [promoEmail, setPromoEmail] = useState('')
  const [promoPhone, setPromoPhone] = useState('')
  const [promoChannel, setPromoChannel] = useState<'email' | 'sms' | 'both'>('email')
  const [promoSending, setPromoSending] = useState(false)
  const [promoResult, setPromoResult] = useState<{ ok: boolean; message: string } | null>(null)

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

  async function handleSendPromo() {
    if (!promoName.trim()) return
    if ((promoChannel === 'email' || promoChannel === 'both') && !promoEmail.trim()) return
    if ((promoChannel === 'sms' || promoChannel === 'both') && !promoPhone.trim()) return
    setPromoSending(true)
    setPromoResult(null)
    try {
      const res = await fetch('/api/admin/gift-cards/send-promo', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: promoName.trim(),
          email: promoEmail.trim() || null,
          phone: promoPhone.trim() || null,
          channel: promoChannel,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')
      setPromoResult({ ok: true, message: data.results?.join(' & ') || 'Sent!' })
      setPromoName('')
      setPromoEmail('')
      setPromoPhone('')
    } catch (err: any) {
      setPromoResult({ ok: false, message: err.message || 'Failed to send' })
    } finally {
      setPromoSending(false)
    }
  }

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

      {/* Send Gift Card Promo */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <button
          onClick={() => setPromoOpen(!promoOpen)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#E8C7CB] to-[#A1B5C8] flex items-center justify-center">
              <Send className="w-4 h-4 text-white" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-hampton-navy">Send Gift Card Promo</p>
              <p className="text-xs text-gray-400">Email or text someone a link to buy a gift card</p>
            </div>
          </div>
          {promoOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>

        {promoOpen && (
          <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Name *</label>
                <input
                  type="text"
                  value={promoName}
                  onChange={e => setPromoName(e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-blue/30"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Email</label>
                <input
                  type="email"
                  value={promoEmail}
                  onChange={e => setPromoEmail(e.target.value)}
                  placeholder="jane@example.com"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-blue/30"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Phone</label>
                <input
                  type="tel"
                  value={promoPhone}
                  onChange={e => setPromoPhone(e.target.value)}
                  placeholder="+16315551234"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-blue/30"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Send via:</span>
              <div className="flex gap-2">
                {(['email', 'sms', 'both'] as const).map(ch => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setPromoChannel(ch)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      promoChannel === ch
                        ? 'bg-hampton-navy text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {ch === 'email' && <Mail className="w-3 h-3" />}
                    {ch === 'sms' && <MessageSquare className="w-3 h-3" />}
                    {ch === 'both' && <Send className="w-3 h-3" />}
                    {ch === 'email' ? 'Email' : ch === 'sms' ? 'SMS' : 'Both'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleSendPromo}
                disabled={promoSending || !promoName.trim() || ((promoChannel === 'email' || promoChannel === 'both') && !promoEmail.trim()) || ((promoChannel === 'sms' || promoChannel === 'both') && !promoPhone.trim())}
                className="px-5 py-2.5 rounded-xl bg-hampton-navy text-white text-sm font-semibold disabled:opacity-50 hover:bg-hampton-navy/90 transition-colors flex items-center gap-2"
              >
                <Send className="w-3.5 h-3.5" />
                {promoSending ? 'Sending...' : 'Send Promo'}
              </button>
              {promoResult && (
                <p className={`text-sm flex items-center gap-1.5 ${promoResult.ok ? 'text-green-600' : 'text-red-500'}`}>
                  {promoResult.ok && <CheckCircle2 className="w-4 h-4" />}
                  {promoResult.message}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

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
