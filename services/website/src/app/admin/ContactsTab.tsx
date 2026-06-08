'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp, Loader2, Search, Mail, Phone, X, Clock, AlertCircle, Download } from 'lucide-react'

/* ─── Interfaces ─────────────────────────────────────── */

interface Contact {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
  phone: string | null
  status: string
  source: string | null
  email_opt_in: boolean
  sms_opt_in: boolean
  lifetime_value: number | null
  booking_count: number | null
  last_engaged_at: string | null
  created_at: string
  notes: string | null
  child_ages: string | null
  service_interests: string[] | null
}

interface Interaction {
  id: string
  type: string
  metadata: Record<string, any> | null
  created_at: string
}

interface Reminder {
  id: string
  reminder_type: string
  channel: string
  scheduled_for: string
  status: string
}

/* ─── Helpers ────────────────────────────────────────── */

function contactName(c: Contact) {
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function statusColor(status: string) {
  switch (status) {
    case 'vip': case 'repeat': return 'bg-purple-100 text-purple-800'
    case 'booked': return 'bg-emerald-100 text-emerald-800'
    case 'prospect': return 'bg-blue-100 text-blue-800'
    case 'lead': return 'bg-yellow-100 text-yellow-800'
    case 'inactive': case 'unsubscribed': return 'bg-gray-100 text-gray-500'
    default: return 'bg-gray-100 text-gray-700'
  }
}

function interactionLabel(type: string) {
  const labels: Record<string, string> = {
    email_sent: 'Email Sent',
    email_opened: 'Email Opened',
    email_clicked: 'Email Clicked',
    email_unsubscribed: 'Email Unsubscribed',
    email_bounced: 'Email Bounced',
    sms_sent: 'SMS Sent',
    sms_replied: 'SMS Reply',
    sms_received: 'SMS Received',
    sms_unsubscribed: 'SMS Unsubscribed',
    booking_inquiry: 'Booking Inquiry',
    booking_confirmed: 'Booking Confirmed',
    form_submission: 'Form Submission',
    review_requested: 'Review Requested',
    review_left: 'Review Left',
  }
  return labels[type] || type.replace(/_/g, ' ')
}

/* ─── Contacts Tab ───────────────────────────────────── */

export default function ContactsTab({ headers, onLogout }: { headers: Record<string, string>; onLogout: () => void }) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [optInFilter, setOptInFilter] = useState<'' | 'email' | 'sms'>('')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [emailOptInCount, setEmailOptInCount] = useState(0)
  const [smsOptInCount, setSmsOptInCount] = useState(0)
  const LIMIT = 50

  const fetchContacts = useCallback(async () => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (optInFilter) params.set('opt_in', optInFilter)
    if (search.trim()) params.set('search', search.trim())
    params.set('limit', String(LIMIT))
    params.set('offset', String(offset))

    const res = await fetch(`/api/admin/contacts?${params}`, { headers })
    if (res.status === 401) { onLogout(); return }
    if (!res.ok) { setError('Failed to load contacts'); setLoading(false); return }
    const data = await res.json()
    setContacts(data.contacts || [])
    setTotal(data.total || 0)
    setEmailOptInCount(data.emailOptInCount || 0)
    setSmsOptInCount(data.smsOptInCount || 0)
    setLoading(false)
  }, [headers.Authorization, statusFilter, optInFilter, search, offset])

  useEffect(() => { fetchContacts() }, [fetchContacts])
  useEffect(() => { setOffset(0) }, [statusFilter, optInFilter, search])

  async function exportCSV(format: string) {
    setExporting(true)
    try {
      const res = await fetch(`/api/admin/contacts/export?format=${format}`, { headers })
      if (res.status === 401) { onLogout(); return }
      if (!res.ok) { setError('Export failed'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || `contacts-${format}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch { setError('Export failed') }
    finally { setExporting(false) }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      {/* Studio rental invite */}
      <StudioInviteCard headers={headers} />

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <div className="admin-kpi">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-blue-500/5 pointer-events-none" />
          <div className="relative">
            <p className="admin-kpi-value">{total}</p>
            <p className="admin-kpi-label">Total Contacts</p>
          </div>
        </div>
        <div className="admin-kpi">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 pointer-events-none" />
          <div className="relative">
            <p className="admin-kpi-value text-emerald-600">{emailOptInCount}</p>
            <p className="admin-kpi-label">Email Opted In</p>
          </div>
        </div>
        <div className="admin-kpi">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-blue-500/5 pointer-events-none" />
          <div className="relative">
            <p className="admin-kpi-value text-blue-600">{smsOptInCount}</p>
            <p className="admin-kpi-label">SMS Opted In</p>
          </div>
        </div>
      </div>

      {/* Export buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => exportCSV('google-ads')}
          disabled={exporting}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-hampton-navy/20 bg-white text-hampton-navy hover:bg-hampton-navy hover:text-white transition-colors disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5" />
          {exporting ? 'Exporting...' : 'Export for Google Ads'}
        </button>
        <button
          onClick={() => exportCSV('meta')}
          disabled={exporting}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-hampton-navy/20 bg-white text-hampton-navy hover:bg-hampton-navy hover:text-white transition-colors disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5" />
          {exporting ? 'Exporting...' : 'Export for Meta'}
        </button>
      </div>

      {/* Filters */}
      <div className="space-y-2 sm:space-y-0 sm:flex sm:flex-wrap sm:items-center sm:gap-2">
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="text-sm border border-hampton-pink/20 rounded-lg px-3 py-1.5 bg-white"
          >
            <option value="">All Statuses</option>
            <option value="lead">Lead</option>
            <option value="prospect">Prospect</option>
            <option value="booked">Booked</option>
            <option value="repeat">Repeat</option>
            <option value="vip">VIP</option>
            <option value="inactive">Inactive</option>
            <option value="unsubscribed">Unsubscribed</option>
          </select>

          <div className="flex items-center bg-white rounded-lg border border-hampton-pink/20 overflow-hidden text-sm">
            {(['', 'email', 'sms'] as const).map(f => (
              <button
                key={f}
                onClick={() => setOptInFilter(f)}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  optInFilter === f ? 'bg-hampton-navy text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {f === '' ? 'All' : f === 'email' ? 'Email' : 'SMS'}
              </button>
            ))}
          </div>
        </div>

        <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search name, email, or phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full text-sm border border-hampton-pink/20 rounded-lg pl-9 pr-3 py-1.5 bg-white"
          />
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-hampton-navy" />
        </div>
      )}

      {!loading && contacts.length === 0 && (
        <div className="text-center py-12 text-gray-500">No contacts found</div>
      )}

      {!loading && contacts.length > 0 && (
        <div className="space-y-2">
          {contacts.map(contact => (
            <div key={contact.id} className="bg-white rounded-xl border border-hampton-pink/20 overflow-hidden">
              <button
                onClick={() => setExpandedId(expandedId === contact.id ? null : contact.id)}
                className="w-full px-3 sm:px-4 py-3 text-left hover:bg-gray-50 transition-colors"
              >
                {/* Desktop row */}
                <div className="hidden sm:flex items-center gap-3">
                  <span className="font-medium text-sm text-hampton-navy truncate w-40">{contactName(contact)}</span>
                  <span className="text-xs text-gray-500 truncate flex-1">{contact.email}</span>
                  <span className="flex items-center gap-1">
                    <Mail className={`w-3.5 h-3.5 ${contact.email_opt_in ? 'text-emerald-500' : 'text-gray-300'}`} />
                    <Phone className={`w-3.5 h-3.5 ${contact.sms_opt_in ? 'text-emerald-500' : 'text-gray-300'}`} />
                  </span>
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${statusColor(contact.status)}`}>
                    {contact.status}
                  </span>
                  <span className="text-xs text-gray-400 w-20 text-right">
                    {contact.last_engaged_at ? formatDate(contact.last_engaged_at) : '—'}
                  </span>
                  {expandedId === contact.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </div>
                {/* Mobile row */}
                <div className="sm:hidden">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-sm text-hampton-navy truncate">{contactName(contact)}</span>
                      <Mail className={`w-3 h-3 shrink-0 ${contact.email_opt_in ? 'text-emerald-500' : 'text-gray-300'}`} />
                      <Phone className={`w-3 h-3 shrink-0 ${contact.sms_opt_in ? 'text-emerald-500' : 'text-gray-300'}`} />
                    </div>
                    {expandedId === contact.id ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="truncate">{contact.email}</span>
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ml-auto ${statusColor(contact.status)}`}>
                      {contact.status}
                    </span>
                  </div>
                </div>
              </button>

              {expandedId === contact.id && (
                <ContactDetail contactId={contact.id} headers={headers} onRefresh={fetchContacts} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && total > LIMIT && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-gray-500">
            Showing {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              disabled={offset === 0}
              className="text-xs px-3 py-1.5 rounded border border-hampton-pink/20 bg-white disabled:opacity-40"
            >
              Prev
            </button>
            <button
              onClick={() => setOffset(offset + LIMIT)}
              disabled={offset + LIMIT >= total}
              className="text-xs px-3 py-1.5 rounded border border-hampton-pink/20 bg-white disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Contact Detail Panel ───────────────────────────── */

function ContactDetail({ contactId, headers, onRefresh }: { contactId: string; headers: Record<string, string>; onRefresh: () => void }) {
  const [detail, setDetail] = useState<{ contact: Contact; interactions: Interaction[]; reminders: Reminder[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editNotes, setEditNotes] = useState<string | null>(null)
  const [editStatus, setEditStatus] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const res = await fetch(`/api/admin/contacts/${contactId}`, { headers })
      if (res.ok) {
        const data = await res.json()
        setDetail(data)
      }
      setLoading(false)
    }
    load()
  }, [contactId, headers.Authorization])

  async function saveField(field: string, value: any) {
    setSaving(true)
    setMsg('')
    const res = await fetch(`/api/admin/contacts/${contactId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ [field]: value }),
    })
    setSaving(false)
    if (res.ok) {
      setMsg('Saved')
      setEditNotes(null)
      setEditStatus(null)
      onRefresh()
      // Reload detail
      const res2 = await fetch(`/api/admin/contacts/${contactId}`, { headers })
      if (res2.ok) setDetail(await res2.json())
    } else {
      setMsg('Error saving')
    }
  }

  async function cancelReminder(id: string) {
    const res = await fetch('/api/admin/reminders', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ ids: [id] }),
    })
    if (res.ok && detail) {
      setDetail({
        ...detail,
        reminders: detail.reminders.filter(r => r.id !== id),
      })
    }
  }

  if (loading) {
    return (
      <div className="border-t border-hampton-pink/10 px-4 py-6 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-hampton-navy" />
      </div>
    )
  }

  if (!detail) return null

  const { contact, interactions, reminders } = detail

  return (
    <div className="border-t border-hampton-pink/10 px-4 py-4 bg-gray-50/50 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Contact Info */}
        <div className="space-y-1.5 text-sm">
          <h4 className="font-semibold text-hampton-navy text-xs uppercase tracking-wide">Contact Info</h4>
          <p>{contactName(contact)}</p>
          <p className="text-gray-500">{contact.email}</p>
          {contact.phone && <p className="text-gray-500">{contact.phone}</p>}
          <p className="text-gray-400 text-xs">Source: {contact.source || '—'}</p>
          {contact.child_ages && <p className="text-gray-400 text-xs">Child ages: {contact.child_ages}</p>}
          {contact.service_interests && contact.service_interests.length > 0 && (
            <p className="text-gray-400 text-xs">Interests: {contact.service_interests.join(', ')}</p>
          )}
          <p className="text-gray-400 text-xs">Added: {formatDate(contact.created_at)}</p>
          {contact.lifetime_value != null && contact.lifetime_value > 0 && (
            <p className="text-xs font-medium text-emerald-600">Lifetime: ${contact.lifetime_value}</p>
          )}

          {/* Editable status */}
          <div className="flex items-center gap-2 pt-2">
            <span className="text-xs text-gray-500">Status:</span>
            {editStatus !== null ? (
              <div className="flex items-center gap-1">
                <select
                  value={editStatus}
                  onChange={e => setEditStatus(e.target.value)}
                  className="text-xs border rounded px-2 py-1"
                >
                  {['lead', 'prospect', 'booked', 'repeat', 'vip', 'inactive', 'unsubscribed'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <button
                  onClick={() => saveField('status', editStatus)}
                  disabled={saving}
                  className="text-xs text-hampton-navy font-medium"
                >Save</button>
                <button onClick={() => setEditStatus(null)} className="text-xs text-gray-400">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setEditStatus(contact.status)}
                className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${statusColor(contact.status)} cursor-pointer`}
              >
                {contact.status}
              </button>
            )}
          </div>

          {/* Opt-in toggles */}
          <div className="flex items-center gap-3 pt-1">
            <label className="flex items-center gap-1 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={contact.email_opt_in}
                onChange={e => saveField('email_opt_in', e.target.checked)}
                className="rounded"
              />
              Email
            </label>
            <label className="flex items-center gap-1 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={contact.sms_opt_in}
                onChange={e => saveField('sms_opt_in', e.target.checked)}
                className="rounded"
              />
              SMS
            </label>
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-1.5 text-sm">
          <h4 className="font-semibold text-hampton-navy text-xs uppercase tracking-wide">Notes</h4>
          {editNotes !== null ? (
            <div className="space-y-2">
              <textarea
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                className="w-full text-xs border rounded px-3 py-2 h-20 resize-y"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => saveField('notes', editNotes || null)}
                  disabled={saving}
                  className="text-xs font-medium text-hampton-navy"
                >Save</button>
                <button onClick={() => setEditNotes(null)} className="text-xs text-gray-400">Cancel</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setEditNotes(contact.notes || '')}
              className="text-xs text-gray-500 text-left w-full hover:text-gray-700"
            >
              {contact.notes || 'Click to add notes...'}
            </button>
          )}

          {msg && (
            <p className={`text-xs ${msg === 'Saved' ? 'text-emerald-600' : 'text-red-600'}`}>{msg}</p>
          )}
        </div>
      </div>

      {/* Pending Reminders */}
      {reminders.length > 0 && (
        <div>
          <h4 className="font-semibold text-hampton-navy text-xs uppercase tracking-wide mb-2 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> Pending Reminders
          </h4>
          <div className="space-y-1">
            {reminders.map(r => (
              <div key={r.id} className="flex items-center justify-between bg-white rounded-lg border border-hampton-pink/10 px-3 py-2 text-xs">
                <span>
                  <span className="font-medium">{r.reminder_type}</span>
                  <span className="text-gray-400 mx-1">via {r.channel}</span>
                  <span className="text-gray-400">{formatDateTime(r.scheduled_for)}</span>
                </span>
                <button
                  onClick={() => cancelReminder(r.id)}
                  className="text-red-500 hover:text-red-700"
                  title="Cancel reminder"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {interactions.length > 0 && (
        <div>
          <h4 className="font-semibold text-hampton-navy text-xs uppercase tracking-wide mb-2 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5" /> Recent Activity
          </h4>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {interactions.map(i => (
              <div key={i.id} className="flex items-center gap-3 text-xs text-gray-600 py-1">
                <span className="text-gray-400 w-28 shrink-0">{formatDateTime(i.created_at)}</span>
                <span className="font-medium">{interactionLabel(i.type)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Studio Rental Invite card ─────────────────────────── */
function StudioInviteCard({ headers }: { headers: Record<string, string> }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function send() {
    setMsg(null)
    if (!name.trim() || !/.+@.+\..+/.test(email)) {
      setMsg({ ok: false, text: 'Enter a name and a valid email.' })
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/studio-rental/invite', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: phone.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMsg({ ok: false, text: data.error || 'Failed to send invite.' })
      } else {
        setMsg({ ok: true, text: `Invite sent to ${data.sentTo}.` })
        setName(''); setEmail(''); setPhone('')
      }
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Something went wrong.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Mail size={16} className="text-slate-500" />
        <h3 className="font-semibold text-slate-800 text-sm">Send Studio Rental Invite</h3>
      </div>
      <div className="grid sm:grid-cols-4 gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800" />
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800" />
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone (optional)"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800" />
        <button onClick={send} disabled={busy}
          className="rounded-lg bg-slate-800 text-white text-sm font-medium px-4 py-2 disabled:opacity-60 hover:bg-slate-700">
          {busy ? 'Sending…' : 'Send Invite'}
        </button>
      </div>
      {msg && (
        <p className={`mt-2 text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>
      )}
      <p className="mt-1 text-[11px] text-slate-400">Adds the contact and emails them the link to the studio rental booking page.</p>
    </div>
  )
}
