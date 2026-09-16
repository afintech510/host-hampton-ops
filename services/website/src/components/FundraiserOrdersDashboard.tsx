'use client'

import { useState, useEffect, useCallback } from 'react'
import { CheckCircle, XCircle, ChevronDown, ChevronUp, Download, RefreshCw, LogOut } from 'lucide-react'

/**
 * The organizer order book, shared by every fundraiser.
 *
 * `/cm-cheer/orders` and `/esm-sharks/orders` are the SAME screen over the same
 * table with a different `team` filter and a different set of colours. Copying
 * 440 lines to add the Sharks would have meant two password-gated views of real
 * customers' names, emails and phone numbers drifting apart — and the history of
 * this exact surface is that duplication is what goes wrong on it: the CM Cheer
 * credential check existed in five places and four of them were broken. So there
 * is one component and a theme table.
 *
 * ── THE FILTER IS THE POINT ──
 *
 * `team` is sent on every read and every write. Without it the API returns every
 * fundraiser's orders, so a CM Cheer parent volunteer would see the Sharks'
 * customer list, the CSV export would carry it, and "Total Raised" would be the
 * sum of two schools' money. Both dashboards authenticate with the same
 * `CM_CHEER_PASSWORD`, so this filter — not the password — is what keeps the two
 * fundraisers apart.
 *
 * The password itself is NOT in this bundle and the server is the only judge of
 * it. It used to be read from a `NEXT_PUBLIC_` variable with a literal default,
 * which published the real production credential to every visitor. Now the typed
 * value is sent to the API, the server decides (`lib/cmCheerAuth.ts`, fail-closed
 * when unset), and it lives in sessionStorage for the tab only.
 */

export interface FundraiserDashboardTheme {
  /** `cm_cheer_orders.team` — the filter on every request this screen makes. */
  teamSlug: string
  title: string
  subtitle: string
  logoSrc: string
  logoAlt: string
  /** sessionStorage key. Per-team so signing out of one is not signing out of both. */
  tokenKey: string
  /** Filename stem for the CSV export. */
  csvPrefix: string
  /**
   * What this fundraiser calls the young person an order is for — "Athlete" for
   * a squad, "Child" for a PTO. Mirrors `personLabel` in `lib/fundraiserTeams`.
   * The underlying column stays `athlete_name` for every team.
   */
  personLabel: string
  /**
   * Full Tailwind class strings, not fragments. Tailwind scans source text, so
   * a class assembled at runtime (`bg-${x}-600`) is never emitted into the CSS.
   */
  headerBar: string
  headerBorder: string
  accentText: string
  accentBorder: string
  accentSolid: string
  focusRing: string
  darkButton: string
}

interface OrderItem { name: string; qty: number; unit_price: number; line_total: number }
interface Order {
  id: string; order_ref: string; team: string; athlete_name: string; parent_name: string
  email: string; phone: string; payment_method: string; items: OrderItem[]
  /**
   * How this order reaches the family. `delivery_address` is present exactly
   * when `delivery_method` is 'home' — the DB constraint guarantees it, so the
   * organizer never sees a delivery with nowhere to take it.
   *
   * Optional in the type because rows created before migration 054 are read
   * back by an older deployment during a rollout, and a dashboard that renders
   * `undefined` as "classroom" is telling the truth about those orders anyway.
   */
  delivery_method?: 'classroom' | 'home'
  delivery_address?: string | null
  delivery_fee_cents?: number
  subtotal_cents: number; profit_cents: number; status: string; status_note: string | null; notes: string | null; created_at: string
}

/** Rows written before migration 054 were all handed over in class. */
function isHomeDelivery(o: Order) { return o.delivery_method === 'home' }

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

export default function FundraiserOrdersDashboard({ theme }: { theme: FundraiserDashboardTheme }) {
  const [authed, setAuthed] = useState(false)
  const [pwInput, setPwInput] = useState('')
  const [token, setToken] = useState('')
  const [pwError, setPwError] = useState('')
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  /**
   * Filtered in the BROWSER, unlike status and payment.
   *
   * Those two are query parameters the API understands; delivery is not, and
   * adding it there would mean the "To Deliver" tile counted a different set
   * than the list below it whenever the filter was on. Everything the tiles
   * summarise is derived from `filtered`, so the filter has to live where
   * `filtered` does.
   */
  const [deliveryFilter, setDeliveryFilter] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)
  const [cancelNote, setCancelNote] = useState('')
  const [cancelTarget, setCancelTarget] = useState<string | null>(null)
  const [editingNotes, setEditingNotes] = useState<string | null>(null)
  const [notesInput, setNotesInput] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  useEffect(() => {
    const saved = sessionStorage.getItem(theme.tokenKey)
    if (saved) { setToken(saved); setAuthed(true) }
  }, [theme.tokenKey])

  async function login(e: React.FormEvent) {
    e.preventDefault()
    setPwError('')
    // Ask the server. A 401 is the only thing that means 'wrong password', and a
    // network or server fault must not read as one (rule 12).
    try {
      const res = await fetch(`/api/cm-cheer-orders?team=${encodeURIComponent(theme.teamSlug)}`, {
        headers: { Authorization: 'Bearer ' + pwInput },
      })
      if (res.status === 401) { setPwError('Incorrect password.'); return }
      if (!res.ok) { setPwError('Could not reach the order book — please try again.'); return }
      sessionStorage.setItem(theme.tokenKey, pwInput)
      setToken(pwInput)
      setAuthed(true)
    } catch {
      setPwError('Could not reach the order book — please try again.')
    }
  }

  function logout() { sessionStorage.removeItem(theme.tokenKey); setToken(''); setAuthed(false) }

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('team', theme.teamSlug)
    if (statusFilter) params.set('status', statusFilter)
    if (paymentFilter) params.set('payment_method', paymentFilter)
    const res = await fetch(`/api/cm-cheer-orders?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json()
    setOrders(data.orders || [])
    setLoading(false)
  }, [statusFilter, paymentFilter, token, theme.teamSlug])

  useEffect(() => { if (authed) fetchOrders() }, [authed, fetchOrders])

  async function updateStatus(id: string, status: string, note?: string) {
    setUpdating(id)
    await fetch(`/api/cm-cheer-orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status, status_note: note || null, team: theme.teamSlug }),
    })
    await fetchOrders()
    setUpdating(null)
    setCancelTarget(null)
    setCancelNote('')
  }

  async function saveNotes(id: string) {
    setSavingNotes(true)
    await fetch(`/api/cm-cheer-orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ notes: notesInput, team: theme.teamSlug }),
    })
    await fetchOrders()
    setSavingNotes(false)
    setEditingNotes(null)
  }

  const filtered = orders.filter(o => {
    if (deliveryFilter === 'home' && !isHomeDelivery(o)) return false
    if (deliveryFilter === 'classroom' && isHomeDelivery(o)) return false
    if (!search) return true
    const q = search.toLowerCase()
    // The address is searchable too — "who else is on Oak Street" is how a
    // delivery run actually gets planned.
    return o.athlete_name.toLowerCase().includes(q) || o.parent_name.toLowerCase().includes(q)
      || o.email.toLowerCase().includes(q) || o.order_ref.toLowerCase().includes(q)
      || (o.delivery_address || '').toLowerCase().includes(q)
  })

  function exportCSV() {
    // Fulfilment sits next to the contact details on purpose: this CSV is what
    // gets printed for the handout pile and the delivery run, and a sheet that
    // makes you cross-reference two columns far apart is a sheet that gets a
    // box left on the wrong doorstep.
    const rows = [['Order Ref',theme.personLabel,'Parent','Email','Phone','Fulfilment','Delivery Address','Delivery Fee','Payment','Total','Status','Items','Notes','Date']]
    filtered.forEach(o => rows.push([
      o.order_ref, o.athlete_name, o.parent_name, o.email, o.phone,
      isHomeDelivery(o) ? 'Home delivery' : 'In class',
      o.delivery_address || '',
      o.delivery_fee_cents ? fmt(o.delivery_fee_cents) : '',
      o.payment_method, fmt(o.subtotal_cents), o.status,
      o.items.map(i => `${i.qty}x ${i.name}`).join(' | '),
      o.notes || '',
      fmtDate(o.created_at),
    ]))
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `${theme.csvPrefix}-orders-${new Date().toISOString().slice(0,10)}.csv`; a.click()
  }

  const nonCancelled = filtered.filter(o => o.status !== 'cancelled')
  const totalRevenue = nonCancelled.reduce((s, o) => s + o.subtotal_cents, 0)
  const totalRaised = nonCancelled.reduce((s, o) => s + (o.profit_cents || 0), 0)
  const pendingCount = filtered.filter(o => o.status === 'pending_payment').length
  const paidCount = filtered.filter(o => o.status === 'paid').length

  // The delivery run, and what it raised. Cancelled orders are excluded from
  // both — nobody drives to a cancelled order, and its fee was never collected.
  const deliverCount = nonCancelled.filter(isHomeDelivery).length
  const deliveryFees = nonCancelled.reduce((s, o) => s + (o.delivery_fee_cents || 0), 0)

  // Aggregate items sold across non-cancelled orders
  const itemSummary: Record<string, number> = {}
  nonCancelled.forEach(o => o.items?.forEach(i => {
    itemSummary[i.name] = (itemSummary[i.name] || 0) + i.qty
  }))
  const itemSummaryList = Object.entries(itemSummary).sort((a, b) => b[1] - a[1])

  // ── Login gate ──
  if (!authed) {
    return (
      <div className="min-h-screen bg-zinc-900 flex items-center justify-center p-4">
        <div className={`bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border-t-4 ${theme.headerBorder}`}>
          <div className={`${theme.headerBar} px-8 py-6 text-center`}>
            <img src={theme.logoSrc} alt={theme.logoAlt} className="w-16 h-16 object-contain mx-auto mb-3 rounded-full bg-white p-1" />
            <h1 className="text-white font-bold text-lg tracking-widest uppercase">{theme.title}</h1>
            <p className="text-zinc-400 text-xs mt-1">Organizer Access</p>
          </div>
          <form onSubmit={login} className="p-8 space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Password</label>
              <input
                type="password" value={pwInput} onChange={e => { setPwInput(e.target.value); setPwError('') }}
                placeholder="Enter password" autoFocus
                className={`w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none ${theme.focusRing}`}
              />
              {pwError && <p className="text-red-600 text-xs mt-1">{pwError}</p>}
            </div>
            <button type="submit" className={`w-full ${theme.accentSolid} text-white font-bold py-3 rounded-xl transition-colors text-sm uppercase tracking-widest`}>
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
      <div className={`${theme.headerBar} border-b-4 ${theme.headerBorder} px-4 py-4`}>
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={theme.logoSrc} alt={theme.logoAlt} className="w-10 h-10 object-contain rounded-full bg-white p-0.5" />
            <div>
              <h1 className="text-white font-bold text-lg tracking-wide leading-none">{theme.title}</h1>
              <p className="text-zinc-400 text-xs mt-0.5">{theme.subtitle}</p>
            </div>
          </div>
          <button onClick={logout} className="flex items-center gap-1.5 text-zinc-400 hover:text-white text-xs font-medium transition-colors">
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-2.5 sm:p-4 text-center shadow-sm">
            <p className="text-[10px] sm:text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Orders</p>
            <p className="text-2xl sm:text-3xl font-black text-zinc-900">{filtered.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-yellow-200 p-2.5 sm:p-4 text-center shadow-sm">
            <p className="text-[10px] sm:text-xs font-bold text-yellow-600 uppercase tracking-wider mb-1">Pending</p>
            <p className="text-2xl sm:text-3xl font-black text-yellow-600">{pendingCount}</p>
          </div>
          <div className="bg-white rounded-xl border border-green-200 p-2.5 sm:p-4 text-center shadow-sm">
            <p className="text-[10px] sm:text-xs font-bold text-green-600 uppercase tracking-wider mb-1">Collected</p>
            <p className="text-xl sm:text-3xl font-black text-green-700">{fmt(totalRevenue)}</p>
            <p className="text-[10px] sm:text-xs text-gray-400">{paidCount} paid</p>
          </div>
          <div className={`bg-white rounded-xl border-2 ${theme.accentBorder} p-2.5 sm:p-4 text-center shadow-sm`}>
            <p className={`text-[10px] sm:text-xs font-bold ${theme.accentText} uppercase tracking-wider mb-1`}>Total Raised</p>
            <p className={`text-xl sm:text-3xl font-black ${theme.accentText}`}>{fmt(totalRaised)}</p>
            <p className="text-[10px] sm:text-xs text-gray-400">sales − cost</p>
          </div>
        </div>

        {/*
          The delivery run.

          Its own strip rather than a fifth summary tile: the tiles answer "how
          is the fundraiser doing", and this answers "what do I have to go and
          do" — and it carries an action, which a tile cannot. It renders only
          when there is a run to make, so a fundraiser with no deliveries never
          sees a row of zeroes it has to learn to ignore.
        */}
        {deliverCount > 0 && (
          <div className="bg-white rounded-xl border-2 border-amber-200 p-3 sm:p-4 shadow-sm flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-3 flex-1">
              <div className="w-10 h-10 shrink-0 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center font-black">
                {deliverCount}
              </div>
              <div>
                <p className="text-sm font-bold text-zinc-900 leading-tight">
                  {deliverCount === 1 ? '1 order needs home delivery' : `${deliverCount} orders need home delivery`}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {fmt(deliveryFees)} in delivery charges · 100% to the PTO
                  {' · '}everything else is handed to the {theme.personLabel.toLowerCase()} in class
                </p>
              </div>
            </div>
            <button
              onClick={() => setDeliveryFilter(deliveryFilter === 'home' ? '' : 'home')}
              className={`shrink-0 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                deliveryFilter === 'home'
                  ? 'bg-amber-600 text-white hover:bg-amber-700'
                  : 'border-2 border-amber-200 text-amber-700 hover:bg-amber-50'
              }`}
            >
              {deliveryFilter === 'home' ? 'Showing deliveries — clear' : 'Show the delivery run'}
            </button>
          </div>
        )}

        {/* Items sold summary */}
        {itemSummaryList.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 shadow-sm">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Items Sold</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {itemSummaryList.map(([name, qty]) => (
                <div key={name} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-sm text-gray-700 truncate mr-2">{name}</span>
                  <span className="text-sm font-black text-zinc-900 shrink-0">{qty}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters + actions */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 shadow-sm flex flex-col sm:flex-row gap-2 sm:gap-3 items-stretch sm:items-center">
          <input
            type="text" placeholder={`Search ${theme.personLabel.toLowerCase()}, parent, email, ref…`} value={search} onChange={e => setSearch(e.target.value)}
            className={`w-full sm:flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none ${theme.focusRing}`}
          />
          <div className="flex gap-2">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="flex-1 sm:flex-none border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
              <option value="">All Statuses</option>
              <option value="pending_payment">Pending</option>
              <option value="paid">Paid</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)}
              className="flex-1 sm:flex-none border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
              <option value="">All Payments</option>
              <option value="venmo">Venmo</option>
              <option value="cash">Cash</option>
            </select>
            <select value={deliveryFilter} onChange={e => setDeliveryFilter(e.target.value)}
              className="flex-1 sm:flex-none border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
              <option value="">All Fulfilment</option>
              <option value="home">Home Delivery</option>
              <option value="classroom">In Class</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={fetchOrders} className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2 text-sm hover:bg-gray-50 transition-colors">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={exportCSV} className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 ${theme.darkButton} text-white rounded-lg px-3 py-2 text-sm transition-colors`}>
              <Download size={14} /> Export CSV
            </button>
          </div>
        </div>

        {/* Orders list */}
        <div className="space-y-2">
          {loading && <p className="text-center text-gray-400 py-10 text-sm">Loading orders…</p>}
          {!loading && filtered.length === 0 && <p className="text-center text-gray-400 py-10 text-sm">No orders found.</p>}
          {!loading && filtered.map(order => (
            <div key={order.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              {/* Row */}
              <div
                className="flex items-start sm:items-center gap-2 sm:gap-3 p-3 sm:p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setExpanded(expanded === order.id ? null : order.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                    <span className="font-bold text-zinc-900 text-sm">{order.athlete_name}</span>
                    <span className="text-gray-400 text-xs hidden sm:inline">·</span>
                    <span className="text-gray-500 text-xs hidden sm:inline">{order.parent_name}</span>
                    <span className={`text-[10px] sm:text-xs font-bold px-1.5 sm:px-2 py-0.5 rounded-full border ${statusBadge(order.status)}`}>{statusLabel(order.status)}</span>
                    <span className={`text-[10px] sm:text-xs font-medium px-1.5 sm:px-2 py-0.5 rounded-full border ${paymentBadge(order.payment_method)}`}>{order.payment_method === 'venmo' ? 'Venmo' : 'Cash'}</span>
                    {/* Only home delivery gets a badge. "In class" is the norm,
                        and badging the norm is how the exception stops standing out. */}
                    {isHomeDelivery(order) && (
                      <span className="text-[10px] sm:text-xs font-bold px-1.5 sm:px-2 py-0.5 rounded-full border bg-amber-100 text-amber-800 border-amber-200">
                        🚚 Deliver
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] sm:text-xs text-gray-400 mt-0.5">{order.order_ref} · {fmtDate(order.created_at)}</p>
                  <p className="text-xs text-gray-500 sm:hidden mt-0.5">{order.parent_name}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-black text-zinc-900 text-sm sm:text-base">{fmt(order.subtotal_cents)}</p>
                </div>
                {expanded === order.id ? <ChevronUp size={16} className="text-gray-400 shrink-0" /> : <ChevronDown size={16} className="text-gray-400 shrink-0" />}
              </div>

              {/* Expanded detail */}
              {expanded === order.id && (
                <div className="border-t border-gray-100 p-3 sm:p-4 bg-gray-50 space-y-3 sm:space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-bold text-gray-400 uppercase mb-2">Contact</p>
                      <p className="text-sm"><span className="text-gray-500">Email:</span> <a href={`mailto:${order.email}`} className="font-medium text-zinc-900 hover:underline">{order.email}</a></p>
                      <p className="text-sm"><span className="text-gray-500">Phone:</span> <a href={`tel:${order.phone}`} className="font-medium text-zinc-900 hover:underline">{order.phone}</a></p>

                      <p className="text-xs font-bold text-gray-400 uppercase mt-3 mb-2">Fulfilment</p>
                      {isHomeDelivery(order) ? (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          <p className="text-sm font-bold text-amber-900">
                            🚚 Home delivery
                            {order.delivery_fee_cents ? <span className="font-medium"> · {fmt(order.delivery_fee_cents)} to the PTO</span> : null}
                          </p>
                          {/* A map link, because the next thing the organizer does
                              with an address is drive to it. */}
                          <a
                            href={`https://maps.google.com/?q=${encodeURIComponent(order.delivery_address || '')}`}
                            target="_blank" rel="noopener noreferrer"
                            className="block text-sm text-amber-900 mt-1 whitespace-pre-wrap hover:underline"
                          >
                            {order.delivery_address}
                          </a>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-600">
                          🎒 Given to <span className="font-medium text-zinc-900">{order.athlete_name}</span> in class — no delivery charge.
                        </p>
                      )}
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
                        <span>Total</span><span className={theme.accentText}>{fmt(order.subtotal_cents)}</span>
                      </div>
                    </div>
                  </div>

                  {order.status_note && (
                    <p className="text-xs text-gray-500 bg-white border border-gray-200 rounded-lg px-3 py-2">
                      <span className="font-bold">Status Note:</span> {order.status_note}
                    </p>
                  )}

                  {/* Editable notes */}
                  <div className="bg-white border border-gray-200 rounded-lg p-3">
                    <p className="text-xs font-bold text-gray-400 uppercase mb-1.5">Notes</p>
                    {editingNotes === order.id ? (
                      <div className="space-y-2">
                        <textarea
                          value={notesInput}
                          onChange={e => setNotesInput(e.target.value)}
                          rows={2}
                          placeholder="Add a note about this order…"
                          className={`w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none ${theme.focusRing}`}
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveNotes(order.id)}
                            disabled={savingNotes}
                            className={`${theme.darkButton} text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50`}
                          >
                            {savingNotes ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            onClick={() => setEditingNotes(null)}
                            className="border border-gray-200 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        onClick={() => { setEditingNotes(order.id); setNotesInput(order.notes || '') }}
                        className="text-sm text-gray-600 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5 -mx-1 transition-colors min-h-[28px]"
                      >
                        {order.notes || <span className="text-gray-300 italic">Click to add note…</span>}
                      </div>
                    )}
                  </div>

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
