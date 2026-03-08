'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp, Loader2, Plus, Send, Zap, FileText, X, Clock, Trash2, Edit2, Save, Mail } from 'lucide-react'

/* ─── Interfaces ─────────────────────────────────────── */

interface Campaign {
  id: string
  campaign_type: string
  subject: string | null
  body_html: string | null
  body_text: string | null
  target_segment: string | null
  status: string
  scheduled_for: string | null
  sent_at: string | null
  brevo_campaign_id: number | null
  total_recipients: number | null
  opened: number | null
  clicked: number | null
  unsubscribed: number | null
  bounced: number | null
  created_at: string
}

interface PendingReminder {
  id: string
  reminder_type: string
  channel: string
  scheduled_for: string
  contacts: { first_name: string; last_name: string; email: string; phone: string } | null
}

/* ─── Helpers ────────────────────────────────────────── */

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function campaignStatusColor(status: string) {
  switch (status) {
    case 'sent': return 'bg-emerald-100 text-emerald-800'
    case 'sending': return 'bg-blue-100 text-blue-800'
    case 'scheduled': return 'bg-yellow-100 text-yellow-800'
    case 'draft': return 'bg-gray-100 text-gray-700'
    case 'failed': return 'bg-red-100 text-red-800'
    case 'cancelled': return 'bg-gray-100 text-gray-400'
    default: return 'bg-gray-100 text-gray-700'
  }
}

function typeBadge(type: string) {
  return type === 'sms' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
}

/* ─── Campaigns Tab ──────────────────────────────────── */

export default function CampaignsTab({ headers, onLogout }: { headers: Record<string, string>; onLogout: () => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [reminders, setReminders] = useState<PendingReminder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState('')
  const [showComposer, setShowComposer] = useState(false)
  const [showReminders, setShowReminders] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)

    const [campRes, remRes] = await Promise.all([
      fetch(`/api/admin/campaigns?${params}`, { headers }),
      fetch('/api/admin/reminders', { headers }),
    ])

    if (campRes.status === 401) { onLogout(); return }

    if (campRes.ok) {
      const d = await campRes.json()
      setCampaigns(d.campaigns || [])
    } else {
      setError('Failed to load campaigns')
    }

    if (remRes.ok) {
      const d = await remRes.json()
      setReminders(d.reminders || [])
    }

    setLoading(false)
  }, [headers.Authorization, statusFilter])

  useEffect(() => { fetchData() }, [fetchData])

  async function runAction(action: string) {
    setActionLoading(action)
    setActionMsg('')
    const res = await fetch('/api/admin/campaigns/actions', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action }),
    })
    const data = await res.json()
    setActionLoading(null)
    setActionMsg(data.message || data.error || 'Done')
    fetchData()
  }

  async function cancelReminders(ids: string[]) {
    await fetch('/api/admin/reminders', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ ids }),
    })
    fetchData()
  }

  const sentCount = campaigns.filter(c => c.status === 'sent').length
  const draftCount = campaigns.filter(c => c.status === 'draft').length

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="bg-white rounded-xl border border-hampton-pink/20 p-3 sm:p-4 text-center">
          <p className="text-lg sm:text-2xl font-bold text-hampton-navy">{campaigns.length}</p>
          <p className="text-[10px] sm:text-xs text-gray-500">Total Campaigns</p>
        </div>
        <div className="bg-white rounded-xl border border-hampton-pink/20 p-3 sm:p-4 text-center">
          <p className="text-lg sm:text-2xl font-bold text-amber-600">{reminders.length}</p>
          <p className="text-[10px] sm:text-xs text-gray-500">Pending Reminders</p>
        </div>
        <div className="bg-white rounded-xl border border-hampton-pink/20 p-3 sm:p-4 text-center">
          <p className="text-lg sm:text-2xl font-bold text-emerald-600">{sentCount}S / {draftCount}D</p>
          <p className="text-[10px] sm:text-xs text-gray-500">Sent / Drafts</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => runAction('draft-newsletter')}
          disabled={actionLoading === 'draft-newsletter'}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-hampton-pink/30 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          {actionLoading === 'draft-newsletter' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
          Draft Newsletter
        </button>
        <button
          onClick={() => runAction('process-reminders')}
          disabled={actionLoading === 'process-reminders'}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-hampton-pink/30 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          {actionLoading === 'process-reminders' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          Process Reminders
        </button>
        <button
          onClick={() => setShowComposer(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-hampton-navy text-white rounded-lg hover:bg-hampton-navy/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> New Campaign
        </button>
        <button
          onClick={() => setShowReminders(!showReminders)}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-hampton-pink/30 rounded-lg hover:bg-gray-50 transition-colors ml-auto"
        >
          <Clock className="w-3.5 h-3.5" /> Reminders ({reminders.length})
        </button>
      </div>

      {actionMsg && (
        <div className={`text-sm px-3 py-2 rounded ${actionMsg.startsWith('Error') || actionMsg.startsWith('Failed') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {actionMsg}
        </div>
      )}

      {/* Campaign Composer Modal */}
      {showComposer && (
        <CampaignComposer
          headers={headers}
          onClose={() => setShowComposer(false)}
          onCreated={() => { setShowComposer(false); fetchData() }}
        />
      )}

      {/* Pending Reminders Section */}
      {showReminders && reminders.length > 0 && (
        <div className="bg-white rounded-xl border border-hampton-pink/20 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-hampton-navy flex items-center gap-1.5">
              <Clock className="w-4 h-4" /> Pending Reminders
            </h4>
            {reminders.length > 1 && (
              <button
                onClick={() => cancelReminders(reminders.map(r => r.id))}
                className="text-xs text-red-500 hover:text-red-700"
              >
                Cancel All
              </button>
            )}
          </div>
          {reminders.map(r => (
            <div key={r.id} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2">
              <span>
                <span className="font-medium">{r.contacts?.first_name || 'Unknown'}</span>
                <span className="text-gray-400 mx-1">—</span>
                <span>{r.reminder_type}</span>
                <span className="text-gray-400 mx-1">via {r.channel}</span>
                <span className="text-gray-400">{formatDateTime(r.scheduled_for)}</span>
              </span>
              <button onClick={() => cancelReminders([r.id])} className="text-red-400 hover:text-red-600">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Filter pills */}
      <div className="flex items-center bg-white rounded-lg border border-hampton-pink/20 overflow-hidden text-sm w-fit">
        {(['', 'draft', 'scheduled', 'sent', 'failed'] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 font-medium transition-colors ${
              statusFilter === s ? 'bg-hampton-navy text-white' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-hampton-navy" />
        </div>
      )}

      {!loading && campaigns.length === 0 && (
        <div className="text-center py-12 text-gray-500">No campaigns found. Click &ldquo;New Campaign&rdquo; or &ldquo;Draft Newsletter&rdquo; to get started.</div>
      )}

      {!loading && campaigns.length > 0 && (
        <div className="space-y-2">
          {campaigns.map(campaign => (
            <div key={campaign.id} className="bg-white rounded-xl border border-hampton-pink/20 overflow-hidden">
              <button
                onClick={() => setExpandedId(expandedId === campaign.id ? null : campaign.id)}
                className="w-full px-3 sm:px-4 py-3 text-left hover:bg-gray-50 transition-colors"
              >
                <div className="hidden sm:flex items-center gap-3">
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${typeBadge(campaign.campaign_type)}`}>
                    {campaign.campaign_type}
                  </span>
                  <span className="font-medium text-sm text-hampton-navy truncate flex-1">{campaign.subject || '(no subject)'}</span>
                  <span className="text-xs text-gray-400 w-24 text-right">{formatDateTime(campaign.created_at)}</span>
                  {campaign.sent_at && (
                    <span className="text-xs text-gray-400">Sent {formatDateTime(campaign.sent_at)}</span>
                  )}
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${campaignStatusColor(campaign.status)}`}>
                    {campaign.status}
                  </span>
                  {expandedId === campaign.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </div>
                <div className="sm:hidden">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${typeBadge(campaign.campaign_type)}`}>
                        {campaign.campaign_type}
                      </span>
                      <span className="font-medium text-sm text-hampton-navy truncate">{campaign.subject || '(no subject)'}</span>
                    </div>
                    {expandedId === campaign.id ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span>{formatDateTime(campaign.created_at)}</span>
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ml-auto ${campaignStatusColor(campaign.status)}`}>
                      {campaign.status}
                    </span>
                  </div>
                </div>
              </button>

              {expandedId === campaign.id && (
                <CampaignDetail campaign={campaign} headers={headers} onRefresh={fetchData} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Campaign Detail ────────────────────────────────── */

function CampaignDetail({ campaign, headers, onRefresh }: { campaign: Campaign; headers: Record<string, string>; onRefresh: () => void }) {
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [editSubject, setEditSubject] = useState(campaign.subject || '')
  const [editBodyHtml, setEditBodyHtml] = useState(campaign.body_html || '')
  const [saving, setSaving] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testSending, setTestSending] = useState(false)
  const [sendListId, setSendListId] = useState(3)

  const isDraft = campaign.status === 'draft' || campaign.status === 'scheduled'

  async function handleSave() {
    setSaving(true)
    setMsg('')
    const res = await fetch(`/api/admin/campaigns/${campaign.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ subject: editSubject, body_html: editBodyHtml }),
    })
    setSaving(false)
    if (res.ok) {
      setMsg('Saved!')
      setEditMode(false)
      onRefresh()
    } else {
      const d = await res.json()
      setMsg(`Error: ${d.error}`)
    }
  }

  async function handleSendTest() {
    if (!testEmail) return
    setTestSending(true)
    setMsg('')
    const res = await fetch(`/api/admin/campaigns/${campaign.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ action: 'test', testEmail }),
    })
    setTestSending(false)
    const d = await res.json()
    setMsg(res.ok ? `Test email sent to ${testEmail}` : `Error: ${d.error}`)
  }

  async function handleSend() {
    const label = sendListId === 3 ? 'all email opt-ins (List 3)' : `List ${sendListId}`
    if (!confirm(`Send "${editMode ? editSubject : campaign.subject}" to ${label}? This cannot be undone.`)) return
    setSending(true)
    setMsg('')
    const res = await fetch(`/api/admin/campaigns/${campaign.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'sending', listId: sendListId }),
    })
    setSending(false)
    if (res.ok) {
      setMsg('Campaign sent via Brevo!')
      onRefresh()
    } else {
      const d = await res.json()
      setMsg(`Error: ${d.error}`)
    }
  }

  async function handleCancel() {
    if (!confirm('Cancel this campaign?')) return
    const res = await fetch(`/api/admin/campaigns/${campaign.id}`, { method: 'DELETE', headers })
    if (res.ok) onRefresh()
  }

  const previewHtml = editMode ? editBodyHtml : campaign.body_html

  return (
    <div className="border-t border-hampton-pink/10 px-4 py-5 bg-gray-50/50 space-y-5">

      {/* Stats (if sent) */}
      {campaign.status === 'sent' && (
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            { label: 'Recipients', val: campaign.total_recipients },
            { label: 'Opened', val: campaign.opened },
            { label: 'Clicked', val: campaign.clicked },
            { label: 'Bounced', val: campaign.bounced },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-lg border border-hampton-pink/10 p-2">
              <p className="text-sm font-bold text-hampton-navy">{s.val ?? '—'}</p>
              <p className="text-[10px] text-gray-400">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Edit / Preview */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-hampton-navy uppercase tracking-wide">
            {editMode ? 'Edit Campaign' : 'Preview'}
          </h4>
          {isDraft && (
            <button
              onClick={() => { setEditMode(!editMode); setMsg('') }}
              className="flex items-center gap-1 text-xs font-medium text-hampton-blue hover:text-hampton-navy transition-colors"
            >
              <Edit2 className="w-3 h-3" />
              {editMode ? 'Cancel Edit' : 'Edit'}
            </button>
          )}
        </div>

        {editMode ? (
          <div className="space-y-3">
            <input
              type="text"
              value={editSubject}
              onChange={e => setEditSubject(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
              placeholder="Subject"
            />
            <textarea
              value={editBodyHtml}
              onChange={e => setEditBodyHtml(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 h-44 resize-y font-mono bg-white"
              placeholder="HTML body"
            />
            {editBodyHtml && (
              <div className="bg-white rounded-xl border border-hampton-pink/10 overflow-hidden shadow-sm">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide px-3 py-1.5 border-b border-gray-100 bg-gray-50">Live Preview</p>
                <iframe
                  srcDoc={editBodyHtml}
                  title="Live preview"
                  className="w-full border-0"
                  style={{ height: '460px' }}
                  sandbox=""
                />
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-hampton-navy text-white rounded-lg disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save Changes
              </button>
              <button
                onClick={() => { setEditMode(false); setEditSubject(campaign.subject || ''); setEditBodyHtml(campaign.body_html || '') }}
                className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg bg-white"
              >
                Discard
              </button>
            </div>
          </div>
        ) : previewHtml ? (
          <div className="bg-white rounded-xl border border-hampton-pink/10 overflow-hidden shadow-sm">
            <iframe
              srcDoc={previewHtml}
              title="Campaign preview"
              className="w-full border-0"
              style={{ height: '500px' }}
              sandbox=""
            />
          </div>
        ) : campaign.body_text ? (
          <p className="text-sm text-gray-700 whitespace-pre-wrap bg-white rounded-xl border border-hampton-pink/10 p-4">
            {campaign.body_text}
          </p>
        ) : null}
      </div>

      {/* Meta */}
      <div className="text-xs text-gray-400 space-y-0.5">
        {campaign.target_segment && <p>Segment: {campaign.target_segment}</p>}
        {campaign.scheduled_for && <p>Scheduled: {formatDateTime(campaign.scheduled_for)}</p>}
        {campaign.brevo_campaign_id && <p>Brevo ID: {campaign.brevo_campaign_id}</p>}
      </div>

      {/* Draft actions */}
      {isDraft && (
        <div className="space-y-4">
          {/* Test email */}
          <div>
            <p className="text-xs font-semibold text-hampton-navy mb-2">Send Test Email</p>
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="test@example.com"
                value={testEmail}
                onChange={e => setTestEmail(e.target.value)}
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white min-w-0"
              />
              <button
                onClick={handleSendTest}
                disabled={testSending || !testEmail}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-hampton-navy text-hampton-navy rounded-lg hover:bg-hampton-navy hover:text-white transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {testSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                Send Test
              </button>
            </div>
          </div>

          {/* Segment + send */}
          <div>
            <p className="text-xs font-semibold text-hampton-navy mb-2">Send Campaign</p>
            <div className="flex flex-wrap gap-2 items-center">
              <select
                value={sendListId}
                onChange={e => setSendListId(Number(e.target.value))}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
              >
                <option value={3}>All Email Opt-Ins (List 3)</option>
              </select>
              <button
                onClick={handleSend}
                disabled={sending}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-hampton-navy text-white rounded-lg disabled:opacity-50 hover:bg-hampton-navy/90"
              >
                {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Send Now
              </button>
              <button
                onClick={handleCancel}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-red-200 text-red-700 rounded-lg hover:bg-red-50 ml-auto"
              >
                <Trash2 className="w-3.5 h-3.5" /> Cancel Campaign
              </button>
            </div>
          </div>
        </div>
      )}

      {msg && (
        <div className={`text-sm px-3 py-2 rounded-lg ${msg.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {msg}
        </div>
      )}
    </div>
  )
}

/* ─── Campaign Composer ──────────────────────────────── */

function CampaignComposer({ headers, onClose, onCreated }: { headers: Record<string, string>; onClose: () => void; onCreated: () => void }) {
  const [type, setType] = useState<'email' | 'sms'>('email')
  const [subject, setSubject] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [segment, setSegment] = useState('email_opted_in')
  const [scheduledFor, setScheduledFor] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!subject.trim()) { setError('Subject required'); return }

    setCreating(true)
    setError('')
    const res = await fetch('/api/admin/campaigns', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        campaign_type: type,
        subject,
        body_html: type === 'email' ? bodyHtml : null,
        body_text: type === 'sms' ? bodyText : null,
        target_segment: segment,
        scheduled_for: scheduledFor || null,
      }),
    })
    setCreating(false)

    if (res.ok) {
      onCreated()
    } else {
      const d = await res.json()
      setError(d.error || 'Failed to create')
    }
  }

  return (
    <form onSubmit={handleCreate} className="bg-white rounded-xl border border-hampton-pink/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-hampton-navy">New Campaign</h4>
        <button type="button" onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
      </div>

      {/* Type toggle */}
      <div className="flex gap-2">
        {(['email', 'sms'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              type === t ? 'bg-hampton-navy text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      <input
        type="text"
        placeholder="Subject / Title"
        value={subject}
        onChange={e => setSubject(e.target.value)}
        className="w-full text-sm border border-gray-200 rounded px-3 py-2"
        required
      />

      {type === 'email' ? (
        <textarea
          placeholder="HTML body (paste your email HTML here)"
          value={bodyHtml}
          onChange={e => setBodyHtml(e.target.value)}
          className="w-full text-sm border border-gray-200 rounded px-3 py-2 h-32 resize-y font-mono"
        />
      ) : (
        <div>
          <textarea
            placeholder="SMS message text (160 chars = 1 segment)"
            value={bodyText}
            onChange={e => setBodyText(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded px-3 py-2 h-20 resize-y"
            maxLength={480}
          />
          <p className="text-xs text-gray-400 mt-1">{bodyText.length}/160 chars ({Math.ceil(bodyText.length / 160) || 0} segment{bodyText.length > 160 ? 's' : ''})</p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Target</label>
          <select
            value={segment}
            onChange={e => setSegment(e.target.value)}
            className="text-sm border border-gray-200 rounded px-3 py-1.5"
          >
            <option value="email_opted_in">Email Opted-In</option>
            <option value="sms_opted_in">SMS Opted-In</option>
            <option value="customers">Customers Only</option>
            <option value="leads">Leads Only</option>
            <option value="all">All Contacts</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Schedule (optional)</label>
          <input
            type="datetime-local"
            value={scheduledFor}
            onChange={e => setScheduledFor(e.target.value)}
            className="text-sm border border-gray-200 rounded px-3 py-1.5"
          />
        </div>
      </div>

      {error && <p className="text-red-600 text-xs">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="text-xs text-gray-500 px-3 py-1.5">Cancel</button>
        <button
          type="submit"
          disabled={creating}
          className="flex items-center gap-1.5 text-xs font-medium bg-hampton-navy text-white px-4 py-1.5 rounded-lg disabled:opacity-50"
        >
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          {scheduledFor ? 'Schedule' : 'Save Draft'}
        </button>
      </div>
    </form>
  )
}
