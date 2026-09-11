'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, CheckCircle2, XCircle, Pencil, Inbox, MessageSquare, Mail, Sparkles, AlertTriangle, X,
} from 'lucide-react'

/* ── Types ─────────────────────────────────────────────── */

interface EventRow {
  id: string
  source: string
  external_id: string
  direction: string
  from_address: string | null
  subject: string | null
  body: string | null
  parsed: Record<string, unknown> | null
  status: string
  classification: string | null
  draft_id: string | null
  error: string | null
  created_at: string
}

interface DraftRow {
  id: string
  review_code: string
  status: string
  party_type: string
  contact_path: string
  missing_fields: string[] | null
  subject: string | null
  email_draft: string | null
  sms_draft: string | null
  error: string | null
  booking_id: string | null
  created_at: string
}

interface LedgerRow {
  id: string
  action: string
  actor: string
  from_status: string | null
  to_status: string | null
  cost_usd: number | null
  created_at: string
}

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800',
  claimed: 'bg-indigo-100 text-indigo-800',
  handled: 'bg-green-100 text-green-800',
  ignored: 'bg-gray-200 text-gray-500',
  error: 'bg-red-100 text-red-700',
  drafted: 'bg-gray-100 text-gray-700',
  sent_for_review: 'bg-amber-100 text-amber-800',
  revision_requested: 'bg-orange-100 text-orange-800',
  approved: 'bg-blue-100 text-blue-800',
  sent: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-200 text-gray-500',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  )
}

function leadLabel(e: EventRow): string {
  const p = e.parsed || {}
  const name = (p.name as string) || (p.contactName as string) || e.from_address || 'unknown'
  const route = (p.route as string) || e.source
  return `${name} · ${route}`
}

/* ── Component ─────────────────────────────────────────── */

export default function InboxTab({ headers, onLogout }: { headers: Record<string, string>; onLogout: () => void }) {
  const [events, setEvents] = useState<EventRow[]>([])
  const [drafts, setDrafts] = useState<DraftRow[]>([])
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [enabled, setEnabled] = useState(false)
  const [model, setModel] = useState('')
  const [reviewerPhoneCount, setReviewerPhoneCount] = useState(0)
  const [loadErrors, setLoadErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<DraftRow | null>(null)
  const [editEmail, setEditEmail] = useState('')
  const [editSms, setEditSms] = useState('')

  const fetchSnapshot = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/agent', { headers })
      if (res.status === 401) { onLogout(); return }
      const data = await res.json()
      setEvents(data.events || [])
      setDrafts(data.drafts || [])
      setLedger(data.ledger || [])
      setEnabled(!!data.enabled)
      setModel(data.model || '')
      setReviewerPhoneCount(data.reviewerPhoneCount || 0)
      setLoadErrors(data.errors || [])
    } catch (err) {
      console.error('Failed to fetch agent snapshot:', err)
    } finally {
      setLoading(false)
    }
  }, [headers, onLogout])

  useEffect(() => { fetchSnapshot() }, [fetchSnapshot])

  async function act(id: string, action: string, extra: Record<string, unknown> = {}) {
    setBusyId(id); setError(null); setNotice(null)
    try {
      const res = await fetch('/api/admin/agent', {
        method: 'POST',
        headers,
        body: JSON.stringify({ id, action, ...extra }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Action failed'); return false }
      setNotice(
        action === 'approve'
          ? 'Approved. Nothing was sent — the real send lands in Phase 2.'
          : action === 'draft'
            ? `Drafted ${data.reviewCode || ''} — review it below.`
            : 'Done.',
      )
      await fetchSnapshot()
      return true
    } finally {
      setBusyId(null)
    }
  }

  function openEdit(d: DraftRow) {
    setEditing(d)
    setEditEmail(d.email_draft || '')
    setEditSms(d.sms_draft || '')
  }

  async function saveEdit() {
    if (!editing) return
    const ok = await act(editing.id, 'edit', { emailDraft: editEmail, smsDraft: editSms })
    if (ok) setEditing(null)
  }

  const openDrafts = drafts.filter(d => !['sent', 'cancelled'].includes(d.status))
  const closedDrafts = drafts.filter(d => ['sent', 'cancelled'].includes(d.status))

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-500">
          Agent drafts land here for review.{' '}
          <span className="text-gray-400">Nothing reaches a customer without approval.</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${enabled ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-500'}`}>
            {enabled ? 'AGENT ON' : 'AGENT OFF'}
          </span>
          {model && <span className="text-[11px] text-gray-400">{model}</span>}
          <span className="text-[11px] text-gray-400">{reviewerPhoneCount} reviewer phone{reviewerPhoneCount === 1 ? '' : 's'}</span>
          <button onClick={fetchSnapshot} className="p-2 text-gray-500 hover:text-hampton-navy hover:bg-gray-100 rounded-lg transition-all">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loadErrors.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 inline mr-1.5 -mt-0.5" />
          {loadErrors.join(' · ')} — check that migrations 028, 032 and 033 have been applied.
        </div>
      )}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}
      {notice && <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl px-4 py-3">{notice}</div>}

      {/* ── Open drafts ── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-hampton-navy mb-3">
          <Sparkles className="w-4 h-4" /> Drafts awaiting review ({openDrafts.length})
        </h3>
        <div className="space-y-2">
          {openDrafts.length === 0 && <p className="text-sm text-gray-400">No drafts waiting.</p>}
          {openDrafts.map(d => (
            <div key={d.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold text-hampton-navy">{d.review_code}</span>
                <StatusBadge status={d.status} />
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                  {d.party_type.replace(/_/g, ' ')}
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                  {d.contact_path === 'quote' ? 'quote' : 'info gather'}
                </span>
                <span className="ml-auto text-xs text-gray-400">{new Date(d.created_at).toLocaleString()}</span>
              </div>

              {d.error && (
                <p className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">
                  Held back: {d.error}
                </p>
              )}
              {d.missing_fields && d.missing_fields.length > 0 && (
                <p className="text-xs text-amber-700">Missing: {d.missing_fields.join(', ')}</p>
              )}

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    <Mail className="w-3 h-3" /> {d.subject || 'no subject'}
                  </p>
                  <pre className="whitespace-pre-wrap font-sans text-xs text-gray-700 leading-relaxed">{d.email_draft}</pre>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    <MessageSquare className="w-3 h-3" /> SMS · {(d.sms_draft || '').length} chars
                  </p>
                  <pre className="whitespace-pre-wrap font-sans text-xs text-gray-700 leading-relaxed">{d.sms_draft}</pre>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  disabled={busyId === d.id}
                  onClick={() => act(d.id, 'approve')}
                  className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg text-hampton-navy hover:bg-gray-100 transition-all disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                </button>
                <button
                  disabled={busyId === d.id}
                  onClick={() => openEdit(d)}
                  className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg text-hampton-navy hover:bg-gray-100 transition-all disabled:opacity-50"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
                <button
                  disabled={busyId === d.id}
                  onClick={() => act(d.id, 'dismiss')}
                  className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-all disabled:opacity-50"
                >
                  <XCircle className="w-3.5 h-3.5" /> Dismiss
                </button>
                <span className="ml-auto text-[11px] text-gray-400">Approving does not send (Phase 2).</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Edit modal ── */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4 sm:p-8" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl mt-4 mb-8 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <span className="text-sm font-semibold text-hampton-navy">Edit {editing.review_code}</span>
              <button onClick={() => setEditing(null)} className="p-1.5 text-gray-400 hover:text-hampton-navy hover:bg-gray-100 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</label>
                <textarea
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  rows={10}
                  className="mt-1 w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-blue/40"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  SMS · {editSms.length} chars
                </label>
                <textarea
                  value={editSms}
                  onChange={e => setEditSms(e.target.value)}
                  rows={5}
                  className="mt-1 w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-blue/40"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setEditing(null)} className="text-xs font-medium px-4 py-2 rounded-lg text-gray-500 hover:bg-gray-100">
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  disabled={busyId === editing.id}
                  className="text-xs font-semibold px-4 py-2 rounded-lg bg-hampton-navy text-white hover:opacity-90 disabled:opacity-50"
                >
                  Save draft
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Inbound events ── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-hampton-navy mb-3">
          <Inbox className="w-4 h-4" /> Inbound events ({events.length})
        </h3>
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {events.length === 0 && <p className="text-sm text-gray-400 p-4">Nothing has come in yet.</p>}
          {events.map(e => (
            <div key={e.id} className="px-4 py-3 flex flex-wrap items-center gap-2 text-xs">
              <StatusBadge status={e.status} />
              <span className="font-medium text-hampton-navy">{leadLabel(e)}</span>
              {e.subject && <span className="text-gray-500 truncate max-w-xs">{e.subject}</span>}
              {e.error && <span className="text-red-600 truncate max-w-xs">{e.error}</span>}
              <span className="ml-auto text-gray-400">{new Date(e.created_at).toLocaleString()}</span>
              {e.status !== 'handled' && !e.draft_id && (
                <button
                  disabled={busyId === e.id}
                  onClick={() => act(e.id, 'draft')}
                  className="flex items-center gap-1 font-medium px-2.5 py-1 rounded-lg text-hampton-navy hover:bg-gray-100 disabled:opacity-50"
                >
                  <Sparkles className="w-3 h-3" /> Draft
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Closed drafts ── */}
      {closedDrafts.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-hampton-navy mb-3">Closed drafts ({closedDrafts.length})</h3>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {closedDrafts.map(d => (
              <div key={d.id} className="px-4 py-2 flex items-center gap-3 text-xs">
                <span className="font-mono text-hampton-navy">{d.review_code}</span>
                <StatusBadge status={d.status} />
                <span className="text-gray-500">{d.party_type.replace(/_/g, ' ')}</span>
                <span className="ml-auto text-gray-400">{new Date(d.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Agent activity ── */}
      <section>
        <h3 className="text-sm font-semibold text-hampton-navy mb-3">Agent activity</h3>
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {ledger.length === 0 && <p className="text-sm text-gray-400 p-4">No agent activity yet.</p>}
          {ledger.map(l => (
            <div key={l.id} className="px-4 py-2 flex items-center gap-3 text-xs">
              <span className="text-gray-400 w-32 shrink-0">{new Date(l.created_at).toLocaleString()}</span>
              <span className="font-medium text-hampton-navy">{l.action}</span>
              {l.from_status && <span className="text-gray-400">{l.from_status} → {l.to_status}</span>}
              {l.cost_usd != null && <span className="text-gray-400">${Number(l.cost_usd).toFixed(4)}</span>}
              <span className="ml-auto text-gray-400">{l.actor}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
