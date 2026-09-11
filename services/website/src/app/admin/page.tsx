'use client'

import { useState, useEffect } from 'react'
import {
  LogIn, ArrowLeft, RefreshCw, Calendar, Ticket, Receipt,
  Palette, Users, Megaphone, ListOrdered, LayoutDashboard,
  DollarSign, Menu, X, ChevronRight, LogOut, Sparkles, Image, Gift, Camera, Scissors, Rocket, TrendingUp, Inbox
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
import RevenueTab from './RevenueTab'
import MediaTab from './MediaTab'
import GiftCardsTab from './GiftCardsTab'
import PartiesTab from './PartiesTab'
import PhotosTab from './PhotosTab'
import SummerHairTab from './SummerHairTab'
import MarketingTab from './MarketingTab'
import InboxTab from './InboxTab'

/* ─── Tab Config ────────────────────────────────────── */

type TabKey = 'dashboard' | 'inbox' | 'events' | 'calendar' | 'orders' | 'parties' | 'photos' | 'themes' | 'media' | 'contacts' | 'sequences' | 'campaigns' | 'marketing' | 'financials' | 'revenue' | 'gift-cards' | 'summer-hair'

const TABS: { key: TabKey; label: string; Icon: typeof Ticket; group: string }[] = [
  { key: 'dashboard',  label: 'Dashboard',  Icon: LayoutDashboard, group: 'overview' },
  { key: 'inbox',      label: 'Inbox',      Icon: Inbox,           group: 'overview' },
  { key: 'summer-hair', label: 'Summer Hair', Icon: Scissors,        group: 'manage' },
  { key: 'events',     label: 'Events',     Icon: Ticket,          group: 'manage' },
  { key: 'calendar',   label: 'Calendar',   Icon: Calendar,        group: 'manage' },
  { key: 'orders',     label: 'Orders',     Icon: Receipt,         group: 'manage' },
  { key: 'parties',    label: 'Parties',    Icon: Sparkles,        group: 'manage' },
  { key: 'photos',     label: 'Photos',     Icon: Camera,          group: 'manage' },
  { key: 'financials', label: 'Financials', Icon: DollarSign,      group: 'manage' },
  { key: 'revenue',    label: 'Revenue Report', Icon: TrendingUp,  group: 'manage' },
  { key: 'gift-cards', label: 'Gift Cards', Icon: Gift,           group: 'manage' },
  { key: 'themes',     label: 'Themes',     Icon: Palette,         group: 'content' },
  { key: 'media',      label: 'Media',      Icon: Image,           group: 'content' },
  { key: 'contacts',   label: 'Contacts',   Icon: Users,           group: 'marketing' },
  { key: 'sequences',  label: 'Sequences',  Icon: ListOrdered,     group: 'marketing' },
  { key: 'campaigns',  label: 'Campaigns',  Icon: Megaphone,       group: 'marketing' },
  { key: 'marketing',  label: 'Marketing',  Icon: Rocket,          group: 'marketing' },
]

const GROUP_LABELS: Record<string, string> = {
  overview: 'Overview',
  manage: 'Manage',
  content: 'Content',
  marketing: 'Marketing',
}

/* ─── Login Gate ────────────────────────────────────── */

/**
 * Two ways in, deliberately (plan §11.1, migration 038):
 *
 *  1. **Email + personal password** → `/api/admin/auth/login`, which sets the
 *     HttpOnly `hh_admin` session cookie. This is the one that gives the ledger
 *     a real name: approvals land as `admin:allie@…` instead of `'ADMIN'`.
 *     There is no token in localStorage on this path — the cookie is HttpOnly
 *     precisely so a stray XSS cannot read it the way it could read the old one.
 *
 *  2. **The shared password**, exactly as before, kept in localStorage and sent
 *     as a Bearer header. This is the lockout guard and it is not going away:
 *     this change must never be the reason Adam cannot get into the panel he
 *     runs the business from. If `admin_users` is empty, unreachable, or the
 *     migration has not been applied, door 2 still opens.
 *
 * First sign-in on a seeded-but-unclaimed row also needs the shared password as
 * proof — see the login route for why (/admin is a public URL).
 */
export default function AdminPage() {
  const [mode, setMode] = useState<'person' | 'shared'>('person')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sharedPassword, setSharedPassword] = useState('')
  const [needsClaim, setNeedsClaim] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState(false)
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [loginError, setLoginError] = useState('')

  useEffect(() => {
    let cancelled = false
    // The session cookie is HttpOnly, so the page cannot read it and has to ask.
    fetch('/api/admin/auth/session')
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data?.authenticated) {
          setSignedIn(true)
          setDisplayName(data.displayName ?? data.email ?? null)
        } else {
          const saved = localStorage.getItem('hh_admin_token')
          if (saved) { setToken(saved); setSignedIn(true) }
        }
      })
      .catch(() => {
        // A failed session probe must not block the shared-password door.
        if (cancelled) return
        const saved = localStorage.getItem('hh_admin_token')
        if (saved) { setToken(saved); setSignedIn(true) }
      })
      .finally(() => { if (!cancelled) setChecking(false) })
    return () => { cancelled = true }
  }, [])

  async function handlePersonLogin(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setLoginError('')
    try {
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, sharedPassword: sharedPassword || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setLoginError(data?.error || 'Sign-in failed')
        if (data?.needsClaim) setNeedsClaim(true)
        return
      }
      setSignedIn(true)
      setDisplayName(data.displayName ?? data.email ?? null)
      setPassword('')
      setSharedPassword('')
    } catch {
      setLoginError('Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  function handleSharedLogin(e: React.FormEvent) {
    e.preventDefault()
    localStorage.setItem('hh_admin_token', password)
    setToken(password)
    setSignedIn(true)
    setLoginError('')
  }

  async function handleLogout() {
    localStorage.removeItem('hh_admin_token')
    setToken(null)
    setSignedIn(false)
    setDisplayName(null)
    setPassword('')
    try { await fetch('/api/admin/auth/logout', { method: 'POST' }) } catch { /* cookie may already be gone */ }
  }

  // Don't flash the login form at someone who already has a valid session.
  if (checking) {
    return <div className="min-h-screen bg-[#1a2030]" />
  }

  if (!signedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1a2030] via-[#2F343B] to-[#1a2030] flex items-center justify-center px-4">
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage: 'radial-gradient(circle at 25% 25%, #8FA8BF 1px, transparent 1px), radial-gradient(circle at 75% 75%, #C7A36B 1px, transparent 1px)',
          backgroundSize: '60px 60px'
        }} />
        <form
          onSubmit={mode === 'person' ? handlePersonLogin : handleSharedLogin}
          className="relative bg-white/10 backdrop-blur-xl rounded-3xl border border-white/20 p-8 w-full max-w-sm shadow-2xl"
        >
          <div className="flex flex-col items-center gap-3 mb-8">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-hampton-blue to-hampton-pink flex items-center justify-center shadow-lg">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
            <h1 className="font-serif text-2xl text-white tracking-tight">Host Hampton</h1>
            <p className="text-white/50 text-sm">Admin Dashboard</p>
          </div>

          {mode === 'person' && (
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@hosthampton.com"
              autoComplete="username"
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-hampton-blue/50 focus:border-transparent transition-all mb-3"
              autoFocus
            />
          )}

          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder={mode === 'person' ? 'Your password' : 'Shared admin password'}
            autoComplete={mode === 'person' ? 'current-password' : 'off'}
            className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-hampton-blue/50 focus:border-transparent transition-all mb-3"
            autoFocus={mode === 'shared'}
          />

          {mode === 'person' && needsClaim && (
            <>
              <p className="text-white/50 text-xs mb-2 leading-relaxed">
                First time signing in? Enter the shared admin password to claim your
                account — the password above then becomes yours.
              </p>
              <input
                type="password" value={sharedPassword} onChange={e => setSharedPassword(e.target.value)}
                placeholder="Shared admin password (first time only)"
                autoComplete="off"
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-hampton-blue/50 focus:border-transparent transition-all mb-3"
              />
            </>
          )}

          {loginError && <p className="text-red-400 text-sm mb-3">{loginError}</p>}

          <button
            type="submit" disabled={busy}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-hampton-blue to-[#7a9ab5] text-white font-semibold text-sm tracking-wider uppercase hover:opacity-90 transition-all shadow-lg disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign In'}
          </button>

          {/* The lockout guard, always reachable. See the comment on AdminPage. */}
          <button
            type="button"
            onClick={() => { setMode(mode === 'person' ? 'shared' : 'person'); setLoginError(''); setPassword('') }}
            className="w-full mt-4 text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            {mode === 'person' ? 'Use the shared admin password instead' : '← Sign in with your email'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <AdminDashboard
      token={token}
      displayName={displayName}
      onLogout={handleLogout}
    />
  )
}

/* ─── Dashboard Shell (Sidebar + Content) ───────────── */

function AdminDashboard({
  token,
  displayName,
  onLogout,
}: { token: string | null; displayName: string | null; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard')
  const [refreshKey, setRefreshKey] = useState(0)
  /**
   * A review code the Inbox should open focused on, set when another tab sends
   * you there — today only Parties' "that draft is already open" refusal.
   * Cleared by InboxTab once it has highlighted it, so it does not re-focus on
   * every later visit to the tab.
   */
  const [inboxFocus, setInboxFocus] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Two doors, one header object. On the shared-password path `token` is the
  // password and goes out as the Bearer header the ~56 admin routes already
  // expect. On the per-person path there is NO token — the HttpOnly `hh_admin`
  // cookie rides along on these same-origin fetches and `isAdminAuthorized`
  // accepts it. Sending `Bearer null` instead of omitting the header would be a
  // failed auth attempt on every request, hence the conditional.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }

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
          {/* Who the ledger will record for anything approved from here. */}
          <p className="text-white/30 text-xs mb-2 truncate" title={displayName ?? undefined}>
            {displayName ? `Signed in as ${displayName}` : 'Shared admin password'}
          </p>
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
          {activeTab === 'inbox' && (
            <InboxTab
              key={`inbox-${refreshKey}`}
              headers={headers}
              onLogout={onLogout}
              focusReviewCode={inboxFocus}
              onFocusHandled={() => setInboxFocus(null)}
            />
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
          {activeTab === 'revenue' && (
            <RevenueTab key={`rev-${refreshKey}`} headers={headers} onLogout={onLogout} />
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
          {activeTab === 'marketing' && (
            <MarketingTab key={`marketing-${refreshKey}`} headers={headers} onLogout={onLogout} />
          )}
          {activeTab === 'parties' && (
            <PartiesTab
              key={`parties-${refreshKey}`}
              headers={headers}
              onLogout={onLogout}
              onOpenInbox={code => {
                setInboxFocus(code)
                setActiveTab('inbox')
                setSidebarOpen(false)
              }}
            />
          )}
          {activeTab === 'photos' && (
            <PhotosTab key={`photos-${refreshKey}`} headers={headers} onLogout={onLogout} />
          )}
          {activeTab === 'gift-cards' && (
            <GiftCardsTab key={`gc-${refreshKey}`} headers={headers} onLogout={onLogout} />
          )}
          {activeTab === 'summer-hair' && (
            <SummerHairTab key={`sh-${refreshKey}`} headers={headers} onLogout={onLogout} />
          )}
        </main>
      </div>
    </div>
  )
}
