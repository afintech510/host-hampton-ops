'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp, Loader2, Search, Mail, Send, RotateCcw, X, DollarSign } from 'lucide-react'

/* ─── Interfaces ─────────────────────────────────────── */

interface Order {
  id: string
  order_ref: string
  order_type: 'booking' | 'ticket'
  customer_name: string
  customer_email: string
  customer_phone: string | null
  amount_cents: number
  status: string
  event_title: string
  event_date: string | null
  event_time: string | null
  stripe_payment_intent_id: string | null
  created_at: string
  package_type?: string | null
  child_name?: string | null
  child_age?: number | null
  guest_count?: number | null
  event_type?: string | null
  notes?: string | null
  quantity?: number
  variant_label?: string | null
  session_id?: string | null
  unit_price_cents?: number
  group_ref?: string | null
  refund_amount_cents?: number | null
  refund_reason?: string | null
}

/* ─── Helpers ────────────────────────────────────────── */

function formatPrice(cents: number) {
  return cents === 0 ? 'Free' : `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

function formatDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function statusColor(status: string) {
  switch (status) {
    case 'confirmed': case 'deposit_paid': return 'bg-emerald-100 text-emerald-800'
    case 'refunded': case 'cancelled': return 'bg-red-100 text-red-800'
    case 'pending': case 'inquiry': return 'bg-yellow-100 text-yellow-800'
    default: return 'bg-gray-100 text-gray-700'
  }
}

function typeBadge(type: 'booking' | 'ticket') {
  return type === 'booking'
    ? 'bg-purple-100 text-purple-800'
    : 'bg-blue-100 text-blue-800'
}

/* ─── Orders Tab ─────────────────────────────────────── */

export default function OrdersTab({ headers, onLogout }: { headers: Record<string, string>; onLogout: () => void }) {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [typeFilter, setTypeFilter] = useState<'' | 'booking' | 'ticket'>('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null)

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    if (typeFilter) params.set('type', typeFilter)
    if (statusFilter) params.set('status', statusFilter)
    if (search.trim()) params.set('search', search.trim())

    const res = await fetch(`/api/admin/orders?${params}`, { headers })
    if (res.status === 401) { onLogout(); return }
    if (!res.ok) { setError('Failed to load orders'); setLoading(false); return }
    const data = await res.json()
    setOrders(data.orders || [])
    setLoading(false)
  }, [headers.Authorization, typeFilter, statusFilter, search])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  // Stats
  const totalRevenue = orders.reduce((sum, o) => {
    if (o.status !== 'refunded' && o.status !== 'cancelled') return sum + o.amount_cents
    return sum
  }, 0)
  const bookingCount = orders.filter(o => o.order_type === 'booking').length
  const ticketCount = orders.filter(o => o.order_type === 'ticket').length

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-hampton-pink/20 p-4 text-center">
          <p className="text-2xl font-bold text-hampton-navy">{orders.length}</p>
          <p className="text-xs text-gray-500">Total Orders</p>
        </div>
        <div className="bg-white rounded-xl border border-hampton-pink/20 p-4 text-center">
          <p className="text-2xl font-bold text-emerald-600">{formatPrice(totalRevenue)}</p>
          <p className="text-xs text-gray-500">Active Revenue</p>
        </div>
        <div className="bg-white rounded-xl border border-hampton-pink/20 p-4 text-center">
          <p className="text-2xl font-bold text-hampton-navy">{bookingCount}B / {ticketCount}T</p>
          <p className="text-xs text-gray-500">Bookings / Tickets</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Type pills */}
        <div className="flex items-center bg-white rounded-lg border border-hampton-pink/20 overflow-hidden text-sm">
          {(['', 'booking', 'ticket'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 font-medium transition-colors ${
                typeFilter === t ? 'bg-hampton-navy text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t === '' ? 'All' : t === 'booking' ? 'Bookings' : 'Tickets'}
            </button>
          ))}
        </div>

        {/* Status dropdown */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-sm border border-hampton-pink/20 rounded-lg px-3 py-1.5 bg-white"
        >
          <option value="">All Statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="deposit_paid">Deposit Paid</option>
          <option value="pending">Pending</option>
          <option value="refunded">Refunded</option>
          <option value="cancelled">Cancelled</option>
        </select>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search name, email, or ref..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full text-sm border border-hampton-pink/20 rounded-lg pl-9 pr-3 py-1.5 bg-white"
          />
        </div>
      </div>

      {/* Error */}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-hampton-navy" />
        </div>
      )}

      {/* Orders list */}
      {!loading && orders.length === 0 && (
        <div className="text-center py-12 text-gray-500">No orders found</div>
      )}

      {!loading && orders.length > 0 && (
        <div className="space-y-2">
          {orders.map(order => (
            <div key={`${order.order_type}-${order.id}`} className="bg-white rounded-xl border border-hampton-pink/20 overflow-hidden">
              {/* Row */}
              <button
                onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
              >
                <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${typeBadge(order.order_type)}`}>
                  {order.order_type === 'booking' ? 'BKG' : 'TKT'}
                </span>
                <span className="font-mono text-xs text-gray-400 w-28 shrink-0">{order.order_ref}</span>
                <span className="font-medium text-sm text-hampton-navy truncate flex-1">{order.customer_name}</span>
                <span className="text-xs text-gray-500 truncate max-w-[140px] hidden sm:block">{order.event_title}</span>
                <span className="text-xs text-gray-400 w-20 text-right hidden md:block">
                  {order.event_date ? formatDate(order.event_date) : '—'}
                </span>
                <span className="font-semibold text-sm w-16 text-right">{formatPrice(order.amount_cents)}</span>
                <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${statusColor(order.status)}`}>
                  {order.status.replace('_', ' ')}
                </span>
                {expandedOrder === order.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>

              {/* Expanded detail */}
              {expandedOrder === order.id && (
                <OrderDetail order={order} headers={headers} onRefresh={fetchOrders} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Order Detail Panel ─────────────────────────────── */

function OrderDetail({ order, headers, onRefresh }: { order: Order; headers: Record<string, string>; onRefresh: () => void }) {
  const [activeAction, setActiveAction] = useState<'email' | 'refund' | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMsg, setActionMsg] = useState('')

  async function resendConfirmation() {
    if (!confirm('Resend confirmation email to this customer?')) return
    setActionLoading(true)
    setActionMsg('')
    const res = await fetch(`/api/admin/orders/${order.id}/resend`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ order_type: order.order_type }),
    })
    setActionLoading(false)
    if (res.ok) setActionMsg('Confirmation email sent!')
    else {
      const d = await res.json()
      setActionMsg(`Error: ${d.error}`)
    }
  }

  const isRefundable = order.status !== 'refunded' && order.status !== 'cancelled' && order.amount_cents > 0

  return (
    <div className="border-t border-hampton-pink/10 px-4 py-4 bg-gray-50/50 space-y-4">
      {/* Customer info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5 text-sm">
          <h4 className="font-semibold text-hampton-navy text-xs uppercase tracking-wide">Customer</h4>
          <p>{order.customer_name}</p>
          <p className="text-gray-500">{order.customer_email}</p>
          {order.customer_phone && <p className="text-gray-500">{order.customer_phone}</p>}
        </div>
        <div className="space-y-1.5 text-sm">
          <h4 className="font-semibold text-hampton-navy text-xs uppercase tracking-wide">Order Details</h4>
          <p>Event: {order.event_title}</p>
          {order.event_date && <p>Date: {formatDate(order.event_date)}{order.event_time ? ` at ${order.event_time}` : ''}</p>}
          <p>Ordered: {formatDateTime(order.created_at)}</p>
          {order.order_type === 'ticket' && order.quantity && <p>Qty: {order.quantity}{order.variant_label ? ` (${order.variant_label})` : ''}</p>}
          {order.order_type === 'booking' && (
            <>
              {order.package_type && <p>Package: {order.package_type}</p>}
              {order.child_name && <p>Child: {order.child_name}{order.child_age ? `, age ${order.child_age}` : ''}</p>}
              {order.guest_count && <p>Guests: ~{order.guest_count}</p>}
            </>
          )}
          {order.notes && <p className="text-gray-400 italic">Notes: {order.notes}</p>}
          {order.refund_amount_cents != null && order.refund_amount_cents > 0 && (
            <p className="text-red-600">Refunded: {formatPrice(order.refund_amount_cents)}{order.refund_reason ? ` — ${order.refund_reason}` : ''}</p>
          )}
          {order.stripe_payment_intent_id && (
            <p className="text-gray-400 text-xs font-mono">PI: {order.stripe_payment_intent_id}</p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={resendConfirmation}
          disabled={actionLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-hampton-pink/30 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" /> Resend Confirmation
        </button>
        <button
          onClick={() => setActiveAction(activeAction === 'email' ? null : 'email')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-hampton-pink/30 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <Mail className="w-3.5 h-3.5" /> Quick Email
        </button>
        {isRefundable && (
          <button
            onClick={() => setActiveAction(activeAction === 'refund' ? null : 'refund')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-red-200 text-red-700 rounded-lg hover:bg-red-50 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Refund
          </button>
        )}
      </div>

      {/* Action message */}
      {actionMsg && (
        <div className={`text-sm px-3 py-2 rounded ${actionMsg.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {actionMsg}
        </div>
      )}

      {/* Quick Email Form */}
      {activeAction === 'email' && (
        <QuickEmailForm
          order={order}
          headers={headers}
          onClose={() => setActiveAction(null)}
          onSuccess={msg => { setActionMsg(msg); setActiveAction(null) }}
        />
      )}

      {/* Refund Form */}
      {activeAction === 'refund' && (
        <RefundForm
          order={order}
          headers={headers}
          onClose={() => setActiveAction(null)}
          onSuccess={() => { setActionMsg('Refund processed!'); setActiveAction(null); onRefresh() }}
        />
      )}
    </div>
  )
}

/* ─── Quick Email Form ───────────────────────────────── */

function QuickEmailForm({
  order, headers, onClose, onSuccess
}: { order: Order; headers: Record<string, string>; onClose: () => void; onSuccess: (msg: string) => void }) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!subject.trim() || !body.trim()) return
    setSending(true)
    const res = await fetch(`/api/admin/orders/${order.id}/email`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        customer_email: order.customer_email,
        subject,
        htmlBody: body.replace(/\n/g, '<br>'),
      }),
    })
    setSending(false)
    if (res.ok) onSuccess('Email sent!')
    else {
      const d = await res.json()
      onSuccess(`Error: ${d.error}`)
    }
  }

  return (
    <form onSubmit={handleSend} className="bg-white rounded-lg border border-hampton-pink/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-hampton-navy">Quick Email to {order.customer_name}</h4>
        <button type="button" onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
      </div>
      <input
        type="text"
        placeholder="Subject"
        value={subject}
        onChange={e => setSubject(e.target.value)}
        className="w-full text-sm border border-gray-200 rounded px-3 py-2"
        required
      />
      <textarea
        placeholder="Message body (plain text, line breaks will be preserved)"
        value={body}
        onChange={e => setBody(e.target.value)}
        className="w-full text-sm border border-gray-200 rounded px-3 py-2 h-24 resize-y"
        required
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="text-xs text-gray-500 px-3 py-1.5">Cancel</button>
        <button
          type="submit"
          disabled={sending}
          className="flex items-center gap-1.5 text-xs font-medium bg-hampton-navy text-white px-4 py-1.5 rounded-lg disabled:opacity-50"
        >
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Send
        </button>
      </div>
    </form>
  )
}

/* ─── Refund Form ────────────────────────────────────── */

function RefundForm({
  order, headers, onClose, onSuccess
}: { order: Order; headers: Record<string, string>; onClose: () => void; onSuccess: () => void }) {
  const [refundType, setRefundType] = useState<'full' | 'partial'>('full')
  const [partialAmount, setPartialAmount] = useState('')
  const [reason, setReason] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')

  const fullAmountCents = order.amount_cents
  const partialCents = Math.round(parseFloat(partialAmount || '0') * 100)

  async function handleRefund(e: React.FormEvent) {
    e.preventDefault()
    const amountCents = refundType === 'full' ? fullAmountCents : partialCents

    if (amountCents <= 0) { setError('Invalid refund amount'); return }
    if (amountCents > fullAmountCents) { setError('Refund exceeds order amount'); return }

    if (!confirm(`Process ${formatPrice(amountCents)} refund for ${order.customer_name}?`)) return

    setProcessing(true)
    setError('')
    const res = await fetch(`/api/admin/orders/${order.id}/refund`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        order_type: order.order_type,
        amountCents,
        reason: reason || undefined,
      }),
    })
    setProcessing(false)

    if (res.ok) {
      onSuccess()
    } else {
      const d = await res.json()
      setError(d.error || 'Refund failed')
    }
  }

  return (
    <form onSubmit={handleRefund} className="bg-white rounded-lg border border-red-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-red-700 flex items-center gap-1.5">
          <DollarSign className="w-4 h-4" /> Refund — {order.order_ref}
        </h4>
        <button type="button" onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
      </div>

      {!order.stripe_payment_intent_id && (
        <div className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2">
          No Stripe payment found. This was a free order — status will be updated but no money will be refunded.
        </div>
      )}

      {/* Full / Partial toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setRefundType('full')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            refundType === 'full' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-600'
          }`}
        >
          Full ({formatPrice(fullAmountCents)})
        </button>
        <button
          type="button"
          onClick={() => setRefundType('partial')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            refundType === 'partial' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-600'
          }`}
        >
          Partial
        </button>
      </div>

      {refundType === 'partial' && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">$</span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            max={(fullAmountCents / 100).toFixed(2)}
            value={partialAmount}
            onChange={e => setPartialAmount(e.target.value)}
            placeholder="Amount"
            className="w-32 text-sm border border-gray-200 rounded px-3 py-2"
            required
          />
        </div>
      )}

      <input
        type="text"
        placeholder="Reason (optional)"
        value={reason}
        onChange={e => setReason(e.target.value)}
        className="w-full text-sm border border-gray-200 rounded px-3 py-2"
      />

      {error && <p className="text-red-600 text-xs">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="text-xs text-gray-500 px-3 py-1.5">Cancel</button>
        <button
          type="submit"
          disabled={processing}
          className="flex items-center gap-1.5 text-xs font-medium bg-red-600 text-white px-4 py-1.5 rounded-lg disabled:opacity-50"
        >
          {processing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
          Process Refund
        </button>
      </div>
    </form>
  )
}
