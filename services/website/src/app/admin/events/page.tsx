'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Users, Mail, Archive, Edit3, Printer, Download, RefreshCw, ChevronDown, ChevronUp, Loader2, LogIn, X, Send, ArrowLeft } from 'lucide-react'

interface Event {
  id: string; slug: string; title: string; category: string; price_cents: number
  event_date: string | null; event_time: string | null; max_tickets: number
  available_tickets: number; is_active: boolean; is_featured: boolean
  has_variants: boolean; variants: any[]; has_sessions: boolean
  description: string | null; short_description: string | null
  image_url: string | null; location: string; confirmed_tickets: number
}

interface Ticket {
  id: string; ticket_ref: string; customer_name: string; customer_email: string
  customer_phone: string | null; quantity: number; variant_label: string | null
  total_cents: number; status: string; created_at: string
  stripe_payment_intent_id: string | null
}

function formatPrice(cents: number) { return cents === 0 ? 'Free' : `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}` }
function formatDate(d: string) { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }

export default function AdminEventsPage() {
  const [password, setPassword] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [loginError, setLoginError] = useState('')

  // Load saved token
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
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Enter admin password"
            className="form-input mb-4"
            autoFocus
          />
          {loginError && <p className="text-red-600 text-sm mb-3">{loginError}</p>}
          <button type="submit" className="btn-primary w-full py-3">Sign In</button>
        </form>
      </div>
    )
  }

  return <AdminDashboard token={token} onLogout={() => { localStorage.removeItem('hh_admin_token'); setToken(null) }} />
}

function AdminDashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null)

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/events', { headers })
    if (res.status === 401) { onLogout(); return }
    const data = await res.json()
    setEvents(data.events || [])
    setLoading(false)
  }, [token])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  const filteredEvents = showArchived ? events : events.filter(e => e.is_active)

  async function archiveEvent(id: string) {
    if (!confirm('Archive this event? It will be hidden from the public site.')) return
    await fetch(`/api/admin/events/${id}`, { method: 'DELETE', headers })
    fetchEvents()
  }

  return (
    <div className="min-h-screen bg-hampton-ivory">
      {/* Header */}
      <div className="bg-hampton-navy px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="/" className="text-hampton-blue hover:text-white transition-colors"><ArrowLeft className="w-5 h-5" /></a>
          <h1 className="font-serif text-xl text-white">Event Management</h1>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchEvents} className="text-hampton-blue hover:text-white transition-colors" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={onLogout} className="text-hampton-blue hover:text-white text-sm">Logout</button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Actions bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowCreate(!showCreate)}
              className="btn-primary px-4 py-2 flex items-center gap-2 text-sm">
              <Plus className="w-4 h-4" /> New Event
            </button>
            <label className="flex items-center gap-2 text-sm text-hampton-mauve cursor-pointer">
              <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} className="accent-hampton-navy" />
              Show archived
            </label>
          </div>
          <p className="text-sm text-hampton-mauve">{filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''}</p>
        </div>

        {/* Create form */}
        {showCreate && <CreateEventForm headers={headers} onCreated={() => { setShowCreate(false); fetchEvents() }} onCancel={() => setShowCreate(false)} />}

        {error && <p className="text-red-600 bg-red-50 p-3 rounded-lg mb-4 text-sm">{error}</p>}

        {loading ? (
          <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin mx-auto text-hampton-mauve" /></div>
        ) : filteredEvents.length === 0 ? (
          <p className="text-center text-hampton-mauve py-12">No events yet. Create your first one above!</p>
        ) : (
          <div className="space-y-3">
            {filteredEvents.map(event => (
              <div key={event.id} className={`bg-white rounded-xl border ${event.is_active ? 'border-hampton-pink/20' : 'border-gray-200 opacity-60'}`}>
                {/* Event row */}
                <div className="flex items-center gap-4 p-4 cursor-pointer" onClick={() => setExpandedEvent(expandedEvent === event.id ? null : event.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-hampton-navy text-sm truncate">{event.title}</h3>
                      <span className="text-xs bg-hampton-navy/10 text-hampton-navy px-2 py-0.5 rounded-full capitalize">{event.category}</span>
                      {event.is_featured && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Featured</span>}
                      {!event.is_active && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Archived</span>}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-hampton-mauve">
                      <span>{event.event_date ? formatDate(event.event_date) : event.has_sessions ? 'Multiple dates' : 'Date TBD'}</span>
                      <span>{formatPrice(event.price_cents)}</span>
                      <span>{event.max_tickets - event.available_tickets}/{event.max_tickets} sold</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={e => { e.stopPropagation(); archiveEvent(event.id) }} className="p-2 text-hampton-mauve hover:text-red-600 transition-colors" title="Archive">
                      <Archive className="w-4 h-4" />
                    </button>
                    {expandedEvent === event.id ? <ChevronUp className="w-4 h-4 text-hampton-mauve" /> : <ChevronDown className="w-4 h-4 text-hampton-mauve" />}
                  </div>
                </div>

                {/* Expanded panel */}
                {expandedEvent === event.id && (
                  <EventDetailPanel event={event} headers={headers} onRefresh={fetchEvents} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CreateEventForm({ headers, onCreated, onCancel }: { headers: Record<string, string>; onCreated: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    title: '', description: '', shortDescription: '', category: 'workshop',
    priceDollars: '', eventDate: '', eventTime: '', maxTickets: '30',
    imageUrl: '', isFeatured: false,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string, v: any) => setForm(prev => ({ ...prev, [k]: v }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title) { setError('Title is required'); return }
    setSaving(true); setError('')

    const res = await fetch('/api/admin/events', {
      method: 'POST', headers,
      body: JSON.stringify({
        title: form.title,
        description: form.description,
        shortDescription: form.shortDescription,
        category: form.category,
        priceCents: Math.round(parseFloat(form.priceDollars || '0') * 100),
        eventDate: form.eventDate || null,
        eventTime: form.eventTime || null,
        maxTickets: parseInt(form.maxTickets) || 30,
        imageUrl: form.imageUrl || null,
        isFeatured: form.isFeatured,
      }),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error || 'Failed to create event')
      setSaving(false)
      return
    }

    onCreated()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-hampton-pink/20 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-serif text-lg text-hampton-navy">New Event</h2>
        <button type="button" onClick={onCancel} className="text-hampton-mauve hover:text-hampton-navy"><X className="w-5 h-5" /></button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="form-label">Title *</label>
          <input value={form.title} onChange={e => set('title', e.target.value)} className="form-input" required />
        </div>
        <div>
          <label className="form-label">Category</label>
          <select value={form.category} onChange={e => set('category', e.target.value)} className="form-input">
            <option value="workshop">Workshop</option>
            <option value="class">Class</option>
            <option value="reading">Reading</option>
            <option value="market">Market</option>
            <option value="drop-off">Drop-off</option>
            <option value="recurring">Recurring</option>
          </select>
        </div>
        <div>
          <label className="form-label">Price ($)</label>
          <input type="number" step="0.01" min="0" value={form.priceDollars} onChange={e => set('priceDollars', e.target.value)} className="form-input" placeholder="0 = Free" />
        </div>
        <div>
          <label className="form-label">Max Tickets</label>
          <input type="number" min="1" value={form.maxTickets} onChange={e => set('maxTickets', e.target.value)} className="form-input" />
        </div>
        <div>
          <label className="form-label">Event Date</label>
          <input type="date" value={form.eventDate} onChange={e => set('eventDate', e.target.value)} className="form-input" />
        </div>
        <div>
          <label className="form-label">Event Time</label>
          <input type="text" value={form.eventTime} onChange={e => set('eventTime', e.target.value)} className="form-input" placeholder="e.g. 6:00 PM" />
        </div>
      </div>

      <div className="mb-4">
        <label className="form-label">Short Description</label>
        <input value={form.shortDescription} onChange={e => set('shortDescription', e.target.value)} className="form-input" placeholder="One-liner for cards" />
      </div>
      <div className="mb-4">
        <label className="form-label">Full Description</label>
        <textarea value={form.description} onChange={e => set('description', e.target.value)} className="form-input" rows={3} />
      </div>
      <div className="mb-4">
        <label className="form-label">Image URL</label>
        <input value={form.imageUrl} onChange={e => set('imageUrl', e.target.value)} className="form-input" placeholder="https://..." />
      </div>
      <div className="flex items-center gap-2 mb-5">
        <input type="checkbox" checked={form.isFeatured} onChange={e => set('isFeatured', e.target.checked)} className="accent-hampton-navy" id="featured" />
        <label htmlFor="featured" className="text-sm text-hampton-mauve cursor-pointer">Featured event</label>
      </div>

      {error && <p className="text-red-600 text-sm mb-3 bg-red-50 p-2 rounded">{error}</p>}

      <div className="flex gap-3">
        <button type="submit" disabled={saving} className="btn-primary px-6 py-2 flex items-center gap-2 text-sm">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {saving ? 'Creating...' : 'Create Event'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary px-6 py-2 text-sm">Cancel</button>
      </div>
    </form>
  )
}

function EventDetailPanel({ event, headers, onRefresh }: { event: Event; headers: Record<string, string>; onRefresh: () => void }) {
  const [tab, setTab] = useState<'attendees' | 'email'>('attendees')
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loadingTickets, setLoadingTickets] = useState(true)
  const [refunding, setRefunding] = useState<string | null>(null)
  const [refundReason, setRefundReason] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailResult, setEmailResult] = useState('')

  useEffect(() => {
    fetchTickets()
  }, [event.id])

  async function fetchTickets() {
    setLoadingTickets(true)
    const res = await fetch(`/api/admin/events/${event.id}/tickets`, { headers })
    const data = await res.json()
    setTickets(data.tickets || [])
    setLoadingTickets(false)
  }

  async function processRefund(ticketId: string) {
    if (!confirm('Process full refund for this ticket?')) return
    setRefunding(ticketId)
    const res = await fetch(`/api/admin/events/${event.id}/tickets/${ticketId}/refund`, {
      method: 'POST', headers,
      body: JSON.stringify({ reason: refundReason }),
    })
    if (res.ok) {
      fetchTickets()
      onRefresh()
    }
    setRefunding(null)
    setRefundReason('')
  }

  async function sendEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!emailSubject || !emailBody) return
    setSendingEmail(true); setEmailResult('')
    const res = await fetch(`/api/admin/events/${event.id}/email`, {
      method: 'POST', headers,
      body: JSON.stringify({ subject: emailSubject, htmlBody: `<p>${emailBody.replace(/\n/g, '</p><p>')}</p>` }),
    })
    const data = await res.json()
    if (res.ok) {
      setEmailResult(`Sent to ${data.sent} attendee${data.sent !== 1 ? 's' : ''}${data.failed ? ` (${data.failed} failed)` : ''}`)
      setEmailSubject(''); setEmailBody('')
    } else {
      setEmailResult(data.error || 'Failed to send')
    }
    setSendingEmail(false)
  }

  function printAttendees() {
    const confirmed = tickets.filter(t => t.status === 'confirmed')
    const html = `<html><head><title>Attendees - ${event.title}</title>
      <style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:8px 12px;border:1px solid #ddd;text-align:left;font-size:13px}th{background:#f5f5f5;font-weight:bold}.title{font-size:18px;margin-bottom:4px}.meta{color:#888;font-size:13px;margin-bottom:16px}</style></head>
      <body><div class="title">${event.title}</div><div class="meta">${confirmed.length} confirmed attendees · ${confirmed.reduce((s, t) => s + t.quantity, 0)} total tickets</div>
      <table><thead><tr><th>#</th><th>Name</th><th>Email</th><th>Phone</th><th>Qty</th><th>Option</th></tr></thead><tbody>
      ${confirmed.map((t, i) => `<tr><td>${i + 1}</td><td>${t.customer_name}</td><td>${t.customer_email}</td><td>${t.customer_phone || '—'}</td><td>${t.quantity}</td><td>${t.variant_label || '—'}</td></tr>`).join('')}
      </tbody></table></body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); w.print() }
  }

  function downloadCSV() {
    const confirmed = tickets.filter(t => t.status === 'confirmed')
    const csv = 'Name,Email,Phone,Qty,Option,Paid,Ref\n' +
      confirmed.map(t => `"${t.customer_name}","${t.customer_email}","${t.customer_phone || ''}",${t.quantity},"${t.variant_label || ''}","${formatPrice(t.total_cents)}","${t.ticket_ref}"`).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${event.slug}-attendees.csv`; a.click()
  }

  const confirmed = tickets.filter(t => t.status === 'confirmed')
  const refunded = tickets.filter(t => t.status === 'refunded')

  return (
    <div className="border-t border-hampton-pink/10 px-4 pb-4">
      {/* Tabs */}
      <div className="flex items-center gap-1 py-3 border-b border-hampton-pink/10 mb-4">
        <button onClick={() => setTab('attendees')}
          className={`px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1.5 ${tab === 'attendees' ? 'bg-hampton-navy text-white' : 'text-hampton-mauve hover:bg-hampton-navy/5'}`}>
          <Users className="w-3.5 h-3.5" /> Attendees ({confirmed.length})
        </button>
        <button onClick={() => setTab('email')}
          className={`px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1.5 ${tab === 'email' ? 'bg-hampton-navy text-white' : 'text-hampton-mauve hover:bg-hampton-navy/5'}`}>
          <Mail className="w-3.5 h-3.5" /> Send Email
        </button>
      </div>

      {tab === 'attendees' && (
        <>
          {/* Action buttons */}
          <div className="flex gap-2 mb-4">
            <button onClick={printAttendees} className="text-xs text-hampton-mauve hover:text-hampton-navy flex items-center gap-1 transition-colors">
              <Printer className="w-3.5 h-3.5" /> Print List
            </button>
            <button onClick={downloadCSV} className="text-xs text-hampton-mauve hover:text-hampton-navy flex items-center gap-1 transition-colors">
              <Download className="w-3.5 h-3.5" /> Download CSV
            </button>
          </div>

          {loadingTickets ? (
            <Loader2 className="w-5 h-5 animate-spin mx-auto my-6 text-hampton-mauve" />
          ) : confirmed.length === 0 ? (
            <p className="text-sm text-hampton-mauve py-4 text-center">No tickets sold yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-hampton-mauve border-b border-hampton-pink/10">
                    <th className="pb-2 pr-3">Ref</th>
                    <th className="pb-2 pr-3">Name</th>
                    <th className="pb-2 pr-3">Email</th>
                    <th className="pb-2 pr-3">Phone</th>
                    <th className="pb-2 pr-3">Qty</th>
                    <th className="pb-2 pr-3">Paid</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmed.map(t => (
                    <tr key={t.id} className="border-b border-hampton-pink/5">
                      <td className="py-2 pr-3 text-xs font-mono text-hampton-navy">{t.ticket_ref}</td>
                      <td className="py-2 pr-3">{t.customer_name}</td>
                      <td className="py-2 pr-3 text-hampton-mauve">{t.customer_email}</td>
                      <td className="py-2 pr-3 text-hampton-mauve">{t.customer_phone || '—'}</td>
                      <td className="py-2 pr-3">{t.quantity}</td>
                      <td className="py-2 pr-3">{formatPrice(t.total_cents)}</td>
                      <td className="py-2">
                        {t.stripe_payment_intent_id ? (
                          <button
                            onClick={() => processRefund(t.id)}
                            disabled={refunding === t.id}
                            className="text-xs text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
                          >
                            {refunding === t.id ? 'Refunding...' : 'Refund'}
                          </button>
                        ) : (
                          <span className="text-xs text-green-600">Free</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {refunded.length > 0 && (
            <details className="mt-4">
              <summary className="text-xs text-hampton-mauve cursor-pointer">{refunded.length} refunded ticket{refunded.length !== 1 ? 's' : ''}</summary>
              <div className="mt-2 space-y-1">
                {refunded.map(t => (
                  <p key={t.id} className="text-xs text-gray-400">{t.ticket_ref} — {t.customer_name} — {formatPrice(t.total_cents)}</p>
                ))}
              </div>
            </details>
          )}
        </>
      )}

      {tab === 'email' && (
        <form onSubmit={sendEmail}>
          <p className="text-xs text-hampton-mauve mb-3">
            Send an email to all {confirmed.length} confirmed attendee{confirmed.length !== 1 ? 's' : ''} for this event.
          </p>
          <div className="mb-3">
            <label className="form-label">Subject</label>
            <input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} className="form-input" placeholder="Event reminder..." required />
          </div>
          <div className="mb-4">
            <label className="form-label">Message</label>
            <textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} className="form-input" rows={4} placeholder="Hi everyone,&#10;&#10;Just a reminder about..." required />
          </div>
          {emailResult && <p className={`text-sm mb-3 p-2 rounded ${emailResult.includes('Failed') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>{emailResult}</p>}
          <button type="submit" disabled={sendingEmail || confirmed.length === 0} className="btn-primary px-5 py-2 text-sm flex items-center gap-2 disabled:opacity-50">
            {sendingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sendingEmail ? 'Sending...' : `Send to ${confirmed.length} attendee${confirmed.length !== 1 ? 's' : ''}`}
          </button>
        </form>
      )}
    </div>
  )
}
