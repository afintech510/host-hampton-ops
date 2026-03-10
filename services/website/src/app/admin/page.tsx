'use client'

import { useState, useEffect } from 'react'
import { LogIn, ArrowLeft, RefreshCw, Calendar, Ticket, Receipt, Palette, Users, Megaphone, ListOrdered } from 'lucide-react'
import EventsTab from './EventsTab'
import CalendarConfigTab from './CalendarConfigTab'
import OrdersTab from './OrdersTab'
import ThemesTab from './ThemesTab'
import ContactsTab from './ContactsTab'
import SequencesTab from './SequencesTab'
import CampaignsTab from './CampaignsTab'

/* ─── Page (Login Gate) ──────────────────────────────── */

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
      <div className="min-h-screen bg-hampton-ivory flex items-center justify-center px-4">
        <form onSubmit={handleLogin} className="bg-white rounded-2xl border border-hampton-pink/20 p-8 w-full max-w-sm">
          <div className="flex items-center gap-2 mb-6">
            <LogIn className="w-5 h-5 text-hampton-navy" />
            <h1 className="font-serif text-xl text-hampton-navy">Admin Access</h1>
          </div>
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Enter admin password" className="form-input mb-4" autoFocus
          />
          {loginError && <p className="text-red-600 text-sm mb-3">{loginError}</p>}
          <button type="submit" className="btn-primary w-full py-3">Sign In</button>
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

/* ─── Dashboard (Tabs) ───────────────────────────────── */

function AdminDashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<'events' | 'calendar' | 'orders' | 'themes' | 'contacts' | 'sequences' | 'campaigns'>('events')
  const [refreshKey, setRefreshKey] = useState(0)

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  return (
    <div className="min-h-screen bg-hampton-ivory">
      {/* Header */}
      <div className="bg-hampton-navy px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex items-center justify-between mb-2 sm:mb-0">
          <div className="flex items-center gap-3">
            <a href="/" className="text-hampton-blue hover:text-white transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </a>
            <h1 className="font-serif text-lg sm:text-xl text-white">Host Hampton Admin</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              className="text-hampton-blue hover:text-white transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={onLogout} className="text-hampton-blue hover:text-white text-sm">
              Logout
            </button>
          </div>
        </div>

        {/* Tab pills — scrollable row on mobile */}
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide -mx-1 px-1">
          {([
            { key: 'events' as const, label: 'Events', Icon: Ticket },
            { key: 'calendar' as const, label: 'Calendar', Icon: Calendar },
            { key: 'orders' as const, label: 'Orders', Icon: Receipt },
            { key: 'themes' as const, label: 'Themes', Icon: Palette },
            { key: 'contacts' as const, label: 'Contacts', Icon: Users },
            { key: 'sequences' as const, label: 'Sequences', Icon: ListOrdered },
            { key: 'campaigns' as const, label: 'Campaigns', Icon: Megaphone },
          ]).map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === key
                  ? 'bg-white/20 text-white'
                  : 'text-hampton-blue hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'events' && (
        <EventsTab key={`events-${refreshKey}`} headers={headers} onLogout={onLogout} />
      )}
      {activeTab === 'calendar' && (
        <CalendarConfigTab key={`calendar-${refreshKey}`} headers={headers} onLogout={onLogout} />
      )}
      {activeTab === 'orders' && (
        <OrdersTab key={`orders-${refreshKey}`} headers={headers} onLogout={onLogout} />
      )}
      {activeTab === 'themes' && (
        <ThemesTab key={`themes-${refreshKey}`} headers={headers} onLogout={onLogout} />
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
    </div>
  )
}
