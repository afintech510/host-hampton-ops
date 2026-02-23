'use client'

import { useState, useEffect } from 'react'
import { LogIn, ArrowLeft, RefreshCw, Calendar, Ticket } from 'lucide-react'
import EventsTab from './EventsTab'
import CalendarConfigTab from './CalendarConfigTab'

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
  const [activeTab, setActiveTab] = useState<'events' | 'calendar'>('events')
  const [refreshKey, setRefreshKey] = useState(0)

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  return (
    <div className="min-h-screen bg-hampton-ivory">
      {/* Header */}
      <div className="bg-hampton-navy px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/" className="text-hampton-blue hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </a>
          <h1 className="font-serif text-xl text-white">Host Hampton Admin</h1>

          {/* Tab pills */}
          <div className="flex items-center gap-1 ml-4">
            <button
              onClick={() => setActiveTab('events')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === 'events'
                  ? 'bg-white/20 text-white'
                  : 'text-hampton-blue hover:text-white'
              }`}
            >
              <Ticket className="w-3.5 h-3.5" />
              Events
            </button>
            <button
              onClick={() => setActiveTab('calendar')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === 'calendar'
                  ? 'bg-white/20 text-white'
                  : 'text-hampton-blue hover:text-white'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              Calendar
            </button>
          </div>
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

      {/* Tab content */}
      {activeTab === 'events' && (
        <EventsTab key={`events-${refreshKey}`} headers={headers} onLogout={onLogout} />
      )}
      {activeTab === 'calendar' && (
        <CalendarConfigTab key={`calendar-${refreshKey}`} headers={headers} onLogout={onLogout} />
      )}
    </div>
  )
}
