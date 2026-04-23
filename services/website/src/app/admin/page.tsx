'use client'

import { useState, useEffect } from 'react'
import {
  LogIn, ArrowLeft, RefreshCw, Calendar, Ticket, Receipt,
  Palette, Users, Megaphone, ListOrdered, LayoutDashboard,
  DollarSign, Menu, X, ChevronRight, LogOut, Sparkles, Image, Gift
} from 'lucide-react'
import EventsTab from './EventsTab'
import CalendarConfigTab from './CalendarConfigTab'
import OrdersTab from './OrdersTab'
import ThemesTab from './ThemesTab'
import ContactsTab from './ContactsTab'
import SequencesTab from './SequencesTab'
import CampaignsTab from './CampaignsTab'
import DashboardTab from './DashboardTab'
import FinancialsTab from './FinancialsTab'
import MediaTab from './MediaTab'
import GiftCardsTab from './GiftCardsTab'
import PartiesTab from './PartiesTab'

/* ─── Tab Config ────────────────────────────────────── */

type TabKey = 'dashboard' | 'events' | 'calendar' | 'orders' | 'parties' | 'themes' | 'media' | 'contacts' | 'sequences' | 'campaigns' | 'financials' | 'gift-cards'

const TABS: { key: TabKey; label: string; Icon: typeof Ticket; group: string }[] = [
  { key: 'dashboard',  label: 'Dashboard',  Icon: LayoutDashboard, group: 'overview' },
  { key: 'events',     label: 'Events',     Icon: Ticket,          group: 'manage' },
  { key: 'calendar',   label: 'Calendar',   Icon: Calendar,        group: 'manage' },
  { key: 'orders',     label: 'Orders',     Icon: Receipt,         group: 'manage' },
  { key: 'parties',    label: 'Parties',    Icon: Sparkles,        group: 'manage' },
  { key: 'financials', label: 'Financials', Icon: DollarSign,      group: 'manage' },
  { key: 'gift-cards', label: 'Gift Cards', Icon: Gift,           group: 'manage' },
  { key: 'themes',     label: 'Themes',     Icon: Palette,         group: 'content' },
  { key: 'media',      label: 'Media',      Icon: Image,           group: 'content' },
  { key: 'contacts',   label: 'Contacts',   Icon: Users,           group: 'marketing' },
  { key: 'sequences',  label: 'Sequences',  Icon: ListOrdered,     group: 'marketing' },
  { key: 'campaigns',  label: 'Campaigns',  Icon: Megaphone,       group: 'marketing' },
]

const GROUP_LABELS: Record<string, string> = {
  overview: 'Overview',
  manage: 'Manage',
  content: 'Content',
  marketing: 'Marketing',
}

/* ─── Login Gate ────────────────────────────────────── */

export default function AdminPage() {
  const [password, setPassword] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [loginError, setLoginError] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem('hh_admin_token')
    if (saved) setToken(saved)
  }, [])

  function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    localStorage.setItem('hh_admin_token', password)
    setToken(password)
    setLoginError('')
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1a2030] via-[#2F343B] to-[#1a2030] flex items-center justify-center px-4">
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage: 'radial-gradient(circle at 25% 25%, #8FA8BF 1px, transparent 1px), radial-gradient(circle at 75% 75%, #C7A36B 1px, transparent 1px)',
          backgroundSize: '60px 60px'
        }} />
        <form onSubmit={handleLogin} className="relative bg-white/10 backdrop-blur-xl rounded-3xl border border-white/20 p-8 w-full max-w-sm shadow-2xl">
          <div className="flex flex-col items-center gap-3 mb-8">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-hampton-blue to-hampton-pink flex items-center justify-center shadow-lg">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
            <h1 className="font-serif text-2xl text-white tracking-tight">Host Hampton</h1>
            <p className="text-white/50 text-sm">Admin Dashboard</p>
          </div>
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Enter admin password"
            className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-hampton-blue/50 focus:border-transparent transition-all mb-4"
            autoFocus
          />
          {loginError && <p className="text-red-400 text-sm mb-3">{loginError}</p>}
          <button type="submit" className="w-full py-3 rounded-xl bg-gradient-to-r from-hampton-blue to-[#7a9ab5] text-white font-semibold text-sm tracking-wider uppercase hover:opacity-90 transition-all shadow-lg">
            Sign In
          </button>
        </form>
      </div>
    )
  }

  return (
    <AdminDashboard
      token={token}
      onLogout={() => { localStorage.removeItem('hh_admin_token'); setToken(null) }}
    />
  )
}

/* ─── Dashboard Shell (Sidebar + Content) ───────────── */

function AdminDashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard')
  const [refreshKey, setRefreshKey] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const activeTabObj = TABS.find(t => t.key === activeTab)!

  // Group tabs for sidebar sections
  const groups = ['overview', 'manage', 'content', 'marketing']

  return (
    <div className="min-h-screen bg-[#f5f6f8] flex">
      {/* ── Mobile overlay ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside className={`
        fixed lg:sticky top-0 left-0 z-50 h-screen w-64 admin-sidebar
        transition-transform duration-300 ease-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Sidebar header */}
        <div className="p-5 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-hampton-blue to-hampton-pink flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="font-serif text-base text-white leading-tight">Host Hampton</h1>
                <p className="text-[10px] text-white/40 uppercase tracking-widest">Admin</p>
              </div>
            </div>
            <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-white/40 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
          {groups.map(group => {
            const groupTabs = TABS.filter(t => t.group === group)
            return (
              <div key={group}>
                <p className="text-[10px] font-semibold text-white/30 uppercase tracking-[0.2em] px-4 mb-2">
                  {GROUP_LABELS[group]}
                </p>
                <div className="space-y-0.5">
                  {groupTabs.map(({ key, label, Icon }) => (
                    <button
                      key={key}
                      onClick={() => { setActiveTab(key); setSidebarOpen(false) }}
                      className={`admin-sidebar-link w-full ${activeTab === key ? 'active' : ''}`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{label}</span>
                      {activeTab === key && (
                        <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-50" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </nav>

        {/* Sidebar footer */}
        <div className="p-4 border-t border-white/10">
          <a
            href="/"
            className="flex items-center gap-2 text-white/40 hover:text-white text-xs transition-colors mb-3"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to site
          </a>
          <button
            onClick={onLogout}
            className="flex items-center gap-2 text-white/40 hover:text-red-400 text-xs transition-colors w-full"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <div className="flex-1 min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-200/60">
          <div className="flex items-center justify-between px-4 sm:px-6 py-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 -ml-2 text-hampton-navy hover:bg-gray-100 rounded-xl transition-colors"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div>
                <h2 className="text-lg font-semibold text-hampton-navy tracking-tight">
                  {activeTabObj.label}
                </h2>
              </div>
            </div>
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              className="p-2 text-hampton-mauve hover:text-hampton-navy hover:bg-gray-100 rounded-xl transition-all"
              title="Refresh data"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Tab content */}
        <main className="animate-slide-in">
          {activeTab === 'dashboard' && (
            <DashboardTab key={`dash-${refreshKey}`} headers={headers} onLogout={onLogout} onNavigate={setActiveTab} />
          )}
          {activeTab === 'events' && (
            <EventsTab key={`events-${refreshKey}`} headers={headers} onLogout={onLogout} />
          )}
          {activeTab === 'calendar' && (
            <CalendarConfigTab key={`calendar-${refreshKey}`} headers={headers} onLogout={onLogout} />
          )}
          {activeTab === 'orders' && (
            <OrdersTab key={`orders-${refreshKey}`} headers={headers} onLogout={onLogout} />
          )}
          {activeTab === 'financials' && (
            <FinancialsTab key={`fin-${refreshKey}`} headers={headers} onLogout={onLogout} />
          )}
          {activeTab === 'themes' && (
            <ThemesTab key={`themes-${refreshKey}`} headers={headers} onLogout={onLogout} />
          )}
          {activeTab === 'media' && (
            <MediaTab key={`media-${refreshKey}`} headers={headers} onLogout={onLogout} />
          )}
          {activeTab === 'contacts' && (
            <ContactsTab key={`contacts-${refreshKey}`} headers={headers} onLogout={onLogout} />
          )}
          {activeTab === 'sequences' && (
            <SequencesTab key={`sequences-${refreshKey}`} headers={headers} onLogout={onLogout} />
          )}
          {activeTab === 'campaigns' && (
            <CampaignsTab key={`campaigns-${refreshKey}`} headers={headers} onLogout={onLogout} />
          )}
          {activeTab === 'parties' && (
            <PartiesTab key={`parties-${refreshKey}`} headers={headers} onLogout={onLogout} />
          )}
          {activeTab === 'gift-cards' && (
            <GiftCardsTab key={`gc-${refreshKey}`} headers={headers} onLogout={onLogout} />
          )}
        </main>
      </div>
    </div>
  )
}
