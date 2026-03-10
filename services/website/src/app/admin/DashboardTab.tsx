'use client'

import { useState, useEffect } from 'react'
import {
  DollarSign, Users, Calendar, Ticket, TrendingUp, TrendingDown,
  ArrowUpRight, Clock, Star, ShoppingBag, Mail, MessageSquare
} from 'lucide-react'

interface DashboardTabProps {
  headers: Record<string, string>
  onLogout: () => void
  onNavigate: (tab: any) => void
}

interface DashboardData {
  revenue: { total: number; thisMonth: number; lastMonth: number }
  orders: { total: number; thisMonth: number; pending: number }
  contacts: { total: number; newThisMonth: number; optedIn: number }
  events: { upcoming: number; totalTickets: number }
  recentOrders: { id: string; customer: string; amount: number; type: string; date: string; status: string }[]
}

export default function DashboardTab({ headers, onLogout, onNavigate }: DashboardTabProps) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    setLoading(true)
    try {
      // Fetch orders and contacts in parallel
      const [ordersRes, contactsRes, eventsRes] = await Promise.all([
        fetch('/api/admin/orders', { headers }).then(r => r.ok ? r.json() : null),
        fetch('/api/admin/contacts', { headers }).then(r => r.ok ? r.json() : null),
        fetch('/api/admin/events', { headers }).then(r => r.ok ? r.json() : null),
      ])

      const orders = ordersRes?.orders || []
      const contacts = contactsRes?.contacts || []
      const events = eventsRes?.events || []

      const now = new Date()
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

      // Revenue calculations
      const paidOrders = orders.filter((o: any) => o.status === 'paid' || o.status === 'confirmed')
      const totalRevenue = paidOrders.reduce((s: number, o: any) => s + (o.amount_cents || 0), 0)
      const thisMonthRevenue = paidOrders
        .filter((o: any) => new Date(o.created_at) >= thisMonthStart)
        .reduce((s: number, o: any) => s + (o.amount_cents || 0), 0)
      const lastMonthRevenue = paidOrders
        .filter((o: any) => new Date(o.created_at) >= lastMonthStart && new Date(o.created_at) < thisMonthStart)
        .reduce((s: number, o: any) => s + (o.amount_cents || 0), 0)

      // Orders
      const thisMonthOrders = orders.filter((o: any) => new Date(o.created_at) >= thisMonthStart).length
      const pendingOrders = orders.filter((o: any) => o.status === 'pending').length

      // Contacts
      const newContacts = contacts.filter((c: any) => new Date(c.created_at) >= thisMonthStart).length
      const optedIn = contacts.filter((c: any) => c.email_opt_in).length

      // Events
      const upcomingEvents = events.filter((e: any) => e.is_active && new Date(e.event_date) >= now).length
      const totalTickets = events.reduce((s: number, e: any) => s + (e.confirmed_tickets || 0), 0)

      // Recent orders
      const recentOrders = orders
        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 8)
        .map((o: any) => ({
          id: o.order_ref,
          customer: o.customer_name || 'Unknown',
          amount: o.amount_cents || 0,
          type: o.order_type,
          date: o.created_at,
          status: o.status,
        }))

      setData({
        revenue: { total: totalRevenue, thisMonth: thisMonthRevenue, lastMonth: lastMonthRevenue },
        orders: { total: orders.length, thisMonth: thisMonthOrders, pending: pendingOrders },
        contacts: { total: contacts.length, newThisMonth: newContacts, optedIn },
        events: { upcoming: upcomingEvents, totalTickets },
        recentOrders,
      })
    } catch (err) {
      console.error('Dashboard load error:', err)
    } finally {
      setLoading(false)
    }
  }

  function fmt(cents: number) {
    return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }

  function fmtDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  function pctChange(curr: number, prev: number) {
    if (prev === 0) return curr > 0 ? 100 : 0
    return Math.round(((curr - prev) / prev) * 100)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-8 h-8 border-2 border-hampton-blue/30 border-t-hampton-blue rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <p className="text-hampton-mauve text-sm">Unable to load dashboard data.</p>
      </div>
    )
  }

  const revChange = pctChange(data.revenue.thisMonth, data.revenue.lastMonth)

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KPICard
          icon={<DollarSign className="w-5 h-5 text-hampton-blue" />}
          label="Revenue (This Month)"
          value={fmt(data.revenue.thisMonth)}
          change={revChange}
          gradient="from-blue-500/10 to-blue-500/5"
        />
        <KPICard
          icon={<ShoppingBag className="w-5 h-5 text-emerald-600" />}
          label="Orders (This Month)"
          value={String(data.orders.thisMonth)}
          sub={`${data.orders.pending} pending`}
          gradient="from-emerald-500/10 to-emerald-500/5"
        />
        <KPICard
          icon={<Users className="w-5 h-5 text-purple-600" />}
          label="Total Contacts"
          value={data.contacts.total.toLocaleString()}
          sub={`${data.contacts.newThisMonth} new this month`}
          gradient="from-purple-500/10 to-purple-500/5"
        />
        <KPICard
          icon={<Ticket className="w-5 h-5 text-amber-600" />}
          label="Upcoming Events"
          value={String(data.events.upcoming)}
          sub={`${data.events.totalTickets} tickets sold`}
          gradient="from-amber-500/10 to-amber-500/5"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Revenue Overview ── */}
        <div className="lg:col-span-2 admin-card p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="admin-section-title">Revenue Overview</h3>
              <p className="text-sm text-hampton-mauve mt-0.5">All-time: {fmt(data.revenue.total)}</p>
            </div>
            <button
              onClick={() => onNavigate('financials')}
              className="admin-btn-ghost text-xs"
            >
              View Financials <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Simple visual bar comparison */}
          <div className="space-y-4">
            <RevenueBar label="This Month" amount={data.revenue.thisMonth} max={Math.max(data.revenue.thisMonth, data.revenue.lastMonth)} color="bg-hampton-blue" />
            <RevenueBar label="Last Month" amount={data.revenue.lastMonth} max={Math.max(data.revenue.thisMonth, data.revenue.lastMonth)} color="bg-hampton-mauve/50" />
          </div>
        </div>

        {/* ── Quick Stats ── */}
        <div className="admin-card p-6">
          <h3 className="admin-section-title mb-4">Quick Stats</h3>
          <div className="space-y-4">
            <QuickStat icon={<Mail className="w-4 h-4" />} label="Email Opt-ins" value={String(data.contacts.optedIn)} />
            <QuickStat icon={<ShoppingBag className="w-4 h-4" />} label="Total Orders" value={String(data.orders.total)} />
            <QuickStat icon={<Calendar className="w-4 h-4" />} label="Events Active" value={String(data.events.upcoming)} />
            <QuickStat icon={<Star className="w-4 h-4" />} label="Total Revenue" value={fmt(data.revenue.total)} />
          </div>
        </div>
      </div>

      {/* ── Recent Orders ── */}
      <div className="admin-card mt-6 overflow-hidden">
        <div className="flex items-center justify-between p-6 pb-0">
          <h3 className="admin-section-title">Recent Orders</h3>
          <button onClick={() => onNavigate('orders')} className="admin-btn-ghost text-xs">
            View All <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm mt-4">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-3 px-6 text-xs font-semibold text-hampton-mauve uppercase tracking-wider">Order</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-hampton-mauve uppercase tracking-wider">Customer</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-hampton-mauve uppercase tracking-wider">Type</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-hampton-mauve uppercase tracking-wider">Amount</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-hampton-mauve uppercase tracking-wider">Status</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-hampton-mauve uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody>
              {data.recentOrders.map((order, i) => (
                <tr key={order.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                  <td className="py-3 px-6 font-medium text-hampton-navy">{order.id}</td>
                  <td className="py-3 px-6 text-gray-600">{order.customer}</td>
                  <td className="py-3 px-6">
                    <span className={`admin-badge ${order.type === 'ticket' ? 'admin-badge-info' : 'admin-badge-neutral'}`}>
                      {order.type}
                    </span>
                  </td>
                  <td className="py-3 px-6 font-medium text-hampton-navy">{fmt(order.amount)}</td>
                  <td className="py-3 px-6">
                    <span className={`admin-badge ${
                      order.status === 'paid' || order.status === 'confirmed' ? 'admin-badge-success' :
                      order.status === 'refunded' ? 'admin-badge-danger' :
                      'admin-badge-warning'
                    }`}>
                      {order.status}
                    </span>
                  </td>
                  <td className="py-3 px-6 text-gray-500">{fmtDate(order.date)}</td>
                </tr>
              ))}
              {data.recentOrders.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-hampton-mauve">No orders yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ─── Sub-components ──────────────────────────────── */

function KPICard({ icon, label, value, change, sub, gradient }: {
  icon: React.ReactNode
  label: string
  value: string
  change?: number
  sub?: string
  gradient: string
}) {
  return (
    <div className="admin-kpi">
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient} pointer-events-none`} />
      <div className="relative">
        <div className="flex items-start justify-between mb-3">
          <div className="admin-kpi-icon">{icon}</div>
          {change !== undefined && (
            <div className={`flex items-center gap-0.5 text-xs font-semibold ${change >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {change >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {Math.abs(change)}%
            </div>
          )}
        </div>
        <p className="admin-kpi-value">{value}</p>
        <p className="admin-kpi-label">{sub || label}</p>
      </div>
    </div>
  )
}

function RevenueBar({ label, amount, max, color }: { label: string; amount: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((amount / max) * 100) : 0
  const fmt = '$' + (amount / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm text-gray-600">{label}</span>
        <span className="text-sm font-semibold text-hampton-navy">{fmt}</span>
      </div>
      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-700 ease-out`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function QuickStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-hampton-mauve">
          {icon}
        </div>
        <span className="text-sm text-gray-600">{label}</span>
      </div>
      <span className="text-sm font-semibold text-hampton-navy">{value}</span>
    </div>
  )
}
