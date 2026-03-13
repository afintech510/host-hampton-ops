'use client'

import { useState, useEffect, useCallback } from 'react'
import { CheckCircle, XCircle, ChevronDown, ChevronUp, Download, RefreshCw, LogOut } from 'lucide-react'

const CM_PASSWORD = process.env.NEXT_PUBLIC_CM_CHEER_PASSWORD || 'cmcheer2026'
const TOKEN_KEY = 'cm_cheer_token'

interface OrderItem { name: string; qty: number; unit_price: number; line_total: number }
interface Order {
  id: string; order_ref: string; athlete_name: string; parent_name: string
  email: string; phone: string; payment_method: string; items: OrderItem[]
  subtotal_cents: number; status: string; status_note: string | null; created_at: string
}

function fmt(cents: number) { return `$${(cents / 100).toFixed(2)}` }
function fmtDate(iso: string) { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }

function statusBadge(status: string) {
  if (status === 'paid') return 'bg-green-100 text-green-800 border-green-200'
  if (status === 'cancelled') return 'bg-red-100 text-red-800 border-red-200'
  return 'bg-yellow-100 text-yellow-800 border-yellow-200'
}
function statusLabel(status: string) {
  if (status === 'paid') return 'Paid'
  if (status === 'cancelled') return 'Cancelled'
  return 'Pending Payment'
}
function paymentBadge(method: string) {
  return method === 'venmo'
    ? 'bg-blue-100 text-blue-800 border-blue-200'
    : 'bg-gray-100 text-gray-700 border-gray-200'
}

export default function CMCheerOrdersPage() {
  const [authed, setAuthed] = useState(false)
  const [pwInput, setPwInput] = useState('')
  const [pwError, setPwError] = useState('')
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)
  const [cancelNote, setCancelNote] = useState('')
  const [cancelTarget, setCancelTarget] = useState<string | null>(null)

  useEffect(() => {
    if (localStorage.getItem(TOKEN_KEY) === CM_PASSWORD) setAuthed(true)
  }, [])

  function login(e: React.FormEvent) {
    e.preventDefault()
    if (pwInput === CM_PASSWORD) {
      localStorage.setItem(TOKEN_KEY, CM_PASSWORD)
      setAuthed(true)
    } else {
      setPwError('Incorrect password.')
    }
  }

  function logout() { localStorage.removeItem(TOKEN_KEY); setAuthed(false) }

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (paymentFilter) params.set('payment_method', paymentFilter)
    const res = await fetch(`/api/cm-cheer-orders?${params}`, {
      headers: { Authorization: `Bearer ${CM_PASSWORD}` },
    })
    const data = await res.json()
    setOrders(data.orders || [])
    setLoading(false)
  }, [statusFilter, paymentFilter])

  useEffect(() => { if (authed) fetchOrders() }, [authed, fetchOrders])

  async function updateStatus(id: string, status: string, note?: string) {
    setUpdating(id)
    await fetch(`/api/cm-cheer-orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CM_PASSWORD}` },
      body: JSON.stringify({ status, status_note: note || null }),
    })
    await fetchOrders()
    setUpdating(null)
    setCancelTarget(null)
    setCancelNote('')
  }

  const filtered = orders.filter(o => {
    if (!search) return true
    const q = search.toLowerCase()
    return o.athlete_name.toLowerCase().includes(q) || o.parent_name.toLowerCase().includes(q) || o.email.toLowerCase().includes(q) || o.order_ref.toLowerCase().includes(q)
  })

  function exportCSV() {
    const rows = [['Order Ref','Athlete','Parent','Email','Phone','Payment','Total','Status','Items','Date']]
    filtered.forEach(o => rows.push([
      o.order_ref, o.athlete_name, o.parent_name, o.email, o.phone,
      o.payment_method, fmt(o.subtotal_cents), o.status,
      o.items.map(i => `${i.qty}x ${i.name}`).join(' | '),
      fmtDate(o.created_at),
    ]))
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `cm-cheer-orders-${new Date().toISOString().slice(0,10)}.csv`; a.click()
  }

  const totalRevenue = filtered.filter(o => o.status !== 'cancelled').reduce((s, o) => s + o.subtotal_cents, 0)
  const pendingCount = filtered.filter(o => o.status === 'pending_payment').length
  const paidCount = filtered.filter(o => o.status === 'paid').length

  // ── Login gate ──
  if (!authed) {
    return (
      <div className="min-h-screen bg-zinc-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border-t-4 border-red-600">
          <div className="bg-zinc-900 px-8 py-6 text-center">
            <img src="https://images.squarespace-cdn.com/content/66b583cc5e40c13a4c5600b6/beace53a-cee5-46ab-88dd-8db7abc9d773/logo_CM-cheer.png" alt="CM Cheer" className="w-16 h-16 object-contain mx-auto mb-3 rounded-full bg-white p-1" />
            <h1 className="text-white font-bold text-lg tracking-widest uppercase">CM Cheer Orders</h1>
            <p className="text-zinc-400 text-xs mt-1">Organizer Access</p>
          </div>
          <form onSubmit={login} className="p-8 space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Password</label>
              <input
                type="password" value={pwInput} onChange={e => { setPwInput(e.target.value); setPwError('') }}
                placeholder="Enter password" autoFocus
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-red-500"
              />
              {pwError && <p className="text-red-600 text-xs mt-1">{pwError}</p>}
            </div>
            <button type="submit" className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl transition-colors text-sm uppercase tracking-widest">
              Sign In
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ── Main dashboard ──
  return (
    <div className="min-h-screen bg-zinc-100">
      {/* Header */}
      <div className="bg-zinc-900 border-b-4 border-red-600 px-4 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="https://images.squarespace-cdn.com/content/66b583cc5e40c13a4c5600b6/beace53a-cee5-46ab-88dd-8db7abc9d773/logo_CM-cheer.png" alt="CM Cheer" className="w-10 h-10 object-contain rounded-full bg-white p-0.5" />
            <div>
              <h1 className="text-white font-bold text-lg tracking-wide leading-none">CM Cheer Orders</h1>
              <p className="text-zinc-400 text-xs mt-0.5">Fundraiser Management</p>
            </div>
          </div>
          <button onClick={logout} className="flex items-center gap-1.5 text-zinc-400 hover:text-white text-xs font-medium transition-colors">
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center shadow-sm">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Total Orders</p>
            <p className="text-3xl font-black text-zinc-900">{filtered.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-yellow-200 p-4 text-center shadow-sm">
            <p className="text-xs font-bold text-yellow-600 uppercase tracking-wider mb-1">Pending</p>
            <p className="text-3xl font-black text-yellow-600">{pendingCount}</p>
          </div>
          <div className="bg-white rounded-xl border border-green-200 p-4 text-center shadow-sm">
            <p className="text-xs font-bold text-green-600 uppercase tracking-wider mb-1">Collected</p>
            <p className="text-3xl font-black text-green-700">{fmt(totalRevenue)}</p>
            <p className="text-xs text-gray-400">{paidCount} paid</p>
          </div>
        </div>

        {/* Filters + actions */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <input
            type="text" placeholder="Search athlete, parent, email, ref…" value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-400"
          />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
            <option value="">All Statuses</option>
            <option value="pending_payment">Pending</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
            <option value="">All Payments</option>
            <option value="venmo">Venmo</option>
            <option value="cash">Cash</option>
          </select>
          <button onClick={fetchOrders} className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2 text-sm hover:bg-gray-50 transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={exportCSV} className="flex items-center gap-1.5 bg-zinc-900 text-white rounded-lg px-3 py-2 text-sm hover:bg-zinc-700 transition-colors">
            <Download size={14} /> Export CSV
          </button>
        </div>

        {/* Orders list */}
        <div className="space-y-2">
          {loading && <p className="text-center text-gray-400 py-10 text-sm">Loading orders…</p>}
          {!loading && filtered.length === 0 && <p className="text-center text-gray-400 py-10 text-sm">No orders found.</p>}
          {!loading && filtered.map(order => (
            <div key={order.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              {/* Row */}
              <div
                className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setExpanded(expanded === order.id ? null : order.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-zinc-900 text-sm">{order.athlete_name}</span>
                    <span className="text-gray-400 text-xs">·</span>
                    <span className="text-gray-500 text-xs">{order.parent_name}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${statusBadge(order.status)}`}>{statusLabel(order.status)}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${paymentBadge(order.payment_method)}`}>{order.payment_method === 'venmo' ? 'Venmo' : 'Cash'}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{order.order_ref} · {fmtDate(order.created_at)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-black text-zinc-900 text-base">{fmt(order.subtotal_cents)}</p>
                </div>
                {expanded === order.id ? <ChevronUp size={16} className="text-gray-400 shrink-0" /> : <ChevronDown size={16} className="text-gray-400 shrink-0" />}
              </div>

              {/* Expanded detail */}
              {expanded === order.id && (
                <div className="border-t border-gray-100 p-4 bg-gray-50 space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-bold text-gray-400 uppercase mb-2">Contact</p>
                      <p className="text-sm"><span className="text-gray-500">Email:</span> <a href={`mailto:${order.email}`} className="font-medium text-zinc-900 hover:underline">{order.email}</a></p>
                      <p className="text-sm"><span className="text-gray-500">Phone:</span> <a href={`tel:${order.phone}`} className="font-medium text-zinc-900 hover:underline">{order.phone}</a></p>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-gray-400 uppercase mb-2">Items Ordered</p>
                      <ul className="space-y-1">
                        {order.items.map((item, i) => (
                          <li key={i} className="flex justify-between text-sm">
                            <span className="text-gray-700">{item.qty}× {item.name}</span>
                            <span className="font-semibold text-zinc-900">${item.line_total.toFixed(2)}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="border-t border-gray-200 mt-2 pt-2 flex justify-between text-sm font-bold">
                        <span>Total</span><span className="text-red-600">{fmt(order.subtotal_cents)}</span>
                      </div>
                    </div>
                  </div>

                  {order.status_note && (
                    <p className="text-xs text-gray-500 bg-white border border-gray-200 rounded-lg px-3 py-2">
                      <span className="font-bold">Note:</span> {order.status_note}
                    </p>
                  )}

                  {/* Actions */}
                  {order.status === 'pending_payment' && (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        onClick={() => updateStatus(order.id, 'paid')}
                        disabled={updating === order.id}
                        className="flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors disabled:opacity-50"
                      >
                        <CheckCircle size={15} />
                        {updating === order.id ? 'Updating…' : 'Mark as Paid'}
                      </button>
                      <button
                        onClick={() => setCancelTarget(order.id)}
                        className="flex items-center justify-center gap-1.5 border-2 border-red-200 text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg text-sm font-bold transition-colors"
                      >
                        <XCircle size={15} /> Cancel Order
                      </button>
                    </div>
                  )}
                  {order.status === 'paid' && (
                    <button
                      onClick={() => updateStatus(order.id, 'pending_payment')}
                      disabled={updating === order.id}
                      className="text-xs text-gray-400 hover:text-gray-600 underline transition-colors"
                    >
                      Undo — move back to Pending
                    </button>
                  )}
                </div>
              )}

              {/* Cancel modal inline */}
              {cancelTarget === order.id && (
                <div className="border-t border-red-100 p-4 bg-red-50">
                  <p className="text-sm font-bold text-red-700 mb-2">Cancel this order?</p>
                  <input
                    type="text" value={cancelNote} onChange={e => setCancelNote(e.target.value)}
                    placeholder="Reason (e.g. no payment received after 2 weeks)"
                    className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-400 mb-3"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateStatus(order.id, 'cancelled', cancelNote)}
                      disabled={updating === order.id}
                      className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors disabled:opacity-50"
                    >
                      {updating === order.id ? 'Cancelling…' : 'Confirm Cancel'}
                    </button>
                    <button onClick={() => { setCancelTarget(null); setCancelNote('') }}
                      className="border border-gray-200 bg-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
                      Back
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
