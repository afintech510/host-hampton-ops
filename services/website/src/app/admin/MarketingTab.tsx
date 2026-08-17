'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, CheckCircle2, XCircle, Send, Eye, Archive, DollarSign, FileText, ShieldCheck, Sparkles, ListChecks, BookMarked, MessageSquare, X } from 'lucide-react'
import { ContentRenderBody, type ContentRenderRow } from '@/components/content/ContentRenderBody'

/* ── Types ─────────────────────────────────────────────── */

interface ContentRow {
  id: string
  slug: string
  title: string
  status: string
  locale: string
  page_type: string
  references_child_media: boolean
  consent_release_ids: string[] | null
  reviewed_by: string | null
  reviewed_at: string | null
  updated_at: string
}
interface TaskRow {
  id: string
  task_type: string
  title: string
  approval_tier: string
  status: string
  entity_type: string | null
  entity_id: string | null
  rejection_reason: string | null
  updated_at: string
}
interface BudgetRow {
  month: string
  llm_usd_spent: number
  llm_usd_cap: number
  sms_sent: number
  sms_cap: number
}
interface ReleaseRow {
  id: string
  child_name: string | null
  status: string
  created_at: string
}
interface LedgerRow {
  id: string
  entity_type: string
  action: string
  actor: string
  from_status: string | null
  to_status: string | null
  cost_usd: number | null
  created_at: string
}

/* ── Status styling + legal actions ────────────────────── */

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  pending_review: 'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800',
  published: 'bg-green-100 text-green-800',
  archived: 'bg-gray-200 text-gray-500',
  rejected: 'bg-red-100 text-red-700',
  executing: 'bg-indigo-100 text-indigo-800',
  done: 'bg-green-100 text-green-800',
  escalated: 'bg-orange-100 text-orange-800',
}

// Buttons offered per content status (must be legal per graph.ts).
const CONTENT_ACTIONS: Record<string, { to: string; label: string; Icon: typeof Eye; danger?: boolean }[]> = {
  draft: [{ to: 'pending_review', label: 'Submit for review', Icon: Eye }],
  pending_review: [
    { to: 'approved', label: 'Approve', Icon: CheckCircle2 },
    { to: 'draft', label: 'Reject', Icon: XCircle, danger: true },
  ],
  approved: [
    { to: 'published', label: 'Publish', Icon: Send },
    { to: 'draft', label: 'Back to draft', Icon: XCircle },
  ],
  published: [{ to: 'archived', label: 'Archive', Icon: Archive, danger: true }],
}

const TASK_ACTIONS: Record<string, { to: string; label: string; Icon: typeof Eye; danger?: boolean }[]> = {
  draft: [{ to: 'pending_review', label: 'Submit', Icon: Eye }],
  pending_review: [
    { to: 'approved', label: 'Approve', Icon: CheckCircle2 },
    { to: 'rejected', label: 'Reject', Icon: XCircle, danger: true },
  ],
  approved: [{ to: 'executing', label: 'Start', Icon: Send }],
  executing: [{ to: 'done', label: 'Mark done', Icon: CheckCircle2 }],
  escalated: [
    { to: 'approved', label: 'Approve', Icon: CheckCircle2 },
    { to: 'rejected', label: 'Reject', Icon: XCircle, danger: true },
  ],
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  )
}

/* ── Component ─────────────────────────────────────────── */

export default function MarketingTab({ headers, onLogout }: { headers: Record<string, string>; onLogout: () => void }) {
  const [content, setContent] = useState<ContentRow[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [budget, setBudget] = useState<BudgetRow | null>(null)
  const [releases, setReleases] = useState<ReleaseRow[]>([])
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewRow, setPreviewRow] = useState<(ContentRenderRow & { locale: string; status: string }) | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const fetchSnapshot = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/marketing', { headers })
      if (res.status === 401) { onLogout(); return }
      const data = await res.json()
      setContent(data.content || [])
      setTasks(data.tasks || [])
      setBudget(data.budget || null)
      setReleases(data.releases || [])
      setLedger(data.ledger || [])
    } catch (err) {
      console.error('Failed to fetch marketing snapshot:', err)
    } finally {
      setLoading(false)
    }
  }, [headers, onLogout])

  useEffect(() => { fetchSnapshot() }, [fetchSnapshot])

  async function advanceContent(id: string, to: string) {
    let reason: string | undefined
    if (to === 'draft' || to === 'archived') {
      reason = window.prompt('Reason (optional):') || undefined
    }
    setBusyId(id); setError(null)
    try {
      const res = await fetch('/api/admin/marketing/content', {
        method: 'POST',
        headers,
        body: JSON.stringify({ id, to, reason }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Action failed'); return }
      await fetchSnapshot()
    } finally {
      setBusyId(null)
    }
  }

  // Preview any content row (draft/pending_review/approved/published) exactly
  // as it will render, before it's approved or published.
  async function openPreview(id: string) {
    setPreviewOpen(true); setPreviewLoading(true); setPreviewError(null); setPreviewRow(null)
    try {
      const res = await fetch(`/api/admin/marketing/preview/${id}`, { headers })
      const data = await res.json()
      if (!res.ok) { setPreviewError(data.error || 'Failed to load preview'); return }
      setPreviewRow(data.content)
    } catch {
      setPreviewError('Failed to load preview')
    } finally {
      setPreviewLoading(false)
    }
  }

  async function advanceTask(id: string, to: string) {
    let reason: string | undefined
    if (to === 'rejected') reason = window.prompt('Rejection reason:') || undefined
    setBusyId(id); setError(null)
    try {
      const res = await fetch('/api/admin/marketing/tasks', {
        method: 'POST',
        headers,
        body: JSON.stringify({ id, to, reason }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Action failed'); return }
      await fetchSnapshot()
    } finally {
      setBusyId(null)
    }
  }

  // Generate a town × service landing draft via the Claude LLM node. Lands as
  // pending_review — it never auto-publishes.
  async function generateDraft() {
    const town = window.prompt('Town (e.g. Southampton):')?.trim()
    if (!town) return
    const service = window.prompt('Service (e.g. permanent jewelry):')?.trim()
    if (!service) return
    setRunning('generate'); setError(null); setNotice(null)
    try {
      const res = await fetch('/api/marketing/generate-draft', {
        method: 'POST',
        headers,
        body: JSON.stringify({ town, service }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Draft generation failed'); return }
      setNotice(`Draft created for ${town} · ${service} — review it below.`)
      await fetchSnapshot()
    } finally {
      setRunning(null)
    }
  }

  // Seed one ALWAYS_ASK checklist task per active theme (idempotent).
  async function runThemeAudit() {
    setRunning('theme-audit'); setError(null); setNotice(null)
    try {
      const res = await fetch('/api/admin/marketing/theme-audit', { method: 'POST', headers })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Theme audit failed'); return }
      setNotice(`Theme audit: ${data.created} new, ${data.skipped} existing.`)
      await fetchSnapshot()
    } finally {
      setRunning(null)
    }
  }

  // Seed ALWAYS_ASK directory-listing tasks (PartySlate, NAP consistency).
  async function runDirectoryListings() {
    setRunning('directory-listings'); setError(null); setNotice(null)
    try {
      const res = await fetch('/api/admin/marketing/directory-listings', { method: 'POST', headers })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Directory listing seed failed'); return }
      setNotice(`Directory listings: ${data.created} new, ${data.skipped} existing.`)
      await fetchSnapshot()
    } finally {
      setRunning(null)
    }
  }

  // Draft a Facebook reply from pasted-in inbound text. Lands as an
  // ALWAYS_ASK fb_reply task — copy/paste into Facebook yourself; this never
  // calls the Facebook API.
  async function draftFbReply() {
    const text = window.prompt('Paste the Facebook comment/message to reply to:')?.trim()
    if (!text) return
    setRunning('fb-reply'); setError(null); setNotice(null)
    try {
      const res = await fetch('/api/admin/marketing/fb-reply', {
        method: 'POST',
        headers,
        body: JSON.stringify({ text }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'FB reply draft failed'); return }
      setNotice('FB reply drafted — review it in Marketing tasks below.')
      await fetchSnapshot()
    } finally {
      setRunning(null)
    }
  }

  const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0)

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">Approval queue — nothing publishes without you.</p>
        <div className="flex items-center gap-2">
          <button
            onClick={generateDraft}
            disabled={running !== null}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-hampton-navy hover:bg-gray-100 transition-all disabled:opacity-50"
          >
            <Sparkles className={`w-3.5 h-3.5 ${running === 'generate' ? 'animate-pulse' : ''}`} /> Generate draft
          </button>
          <button
            onClick={runThemeAudit}
            disabled={running !== null}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-hampton-navy hover:bg-gray-100 transition-all disabled:opacity-50"
          >
            <ListChecks className={`w-3.5 h-3.5 ${running === 'theme-audit' ? 'animate-pulse' : ''}`} /> Run theme audit
          </button>
          <button
            onClick={runDirectoryListings}
            disabled={running !== null}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-hampton-navy hover:bg-gray-100 transition-all disabled:opacity-50"
          >
            <BookMarked className={`w-3.5 h-3.5 ${running === 'directory-listings' ? 'animate-pulse' : ''}`} /> Directory listings
          </button>
          <button
            onClick={draftFbReply}
            disabled={running !== null}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-hampton-navy hover:bg-gray-100 transition-all disabled:opacity-50"
          >
            <MessageSquare className={`w-3.5 h-3.5 ${running === 'fb-reply' ? 'animate-pulse' : ''}`} /> Draft FB reply
          </button>
          <button onClick={fetchSnapshot} className="p-2 text-gray-500 hover:text-hampton-navy hover:bg-gray-100 rounded-lg transition-all">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}
      {notice && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl px-4 py-3">{notice}</div>
      )}

      {/* ── Budget ── */}
      <section className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-hampton-navy mb-4">
          <DollarSign className="w-4 h-4" /> This month{budget ? ` · ${budget.month}` : ''}
        </h3>
        {budget ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>LLM spend</span>
                <span>${Number(budget.llm_usd_spent).toFixed(2)} / ${Number(budget.llm_usd_cap).toFixed(2)}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500" style={{ width: `${pct(budget.llm_usd_spent, budget.llm_usd_cap)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>Marketing SMS</span>
                <span>{budget.sms_sent} / {budget.sms_cap}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-pink-500" style={{ width: `${pct(budget.sms_sent, budget.sms_cap)}%` }} />
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400">No budget row yet this month.</p>
        )}
      </section>

      {/* ── Content pipeline ── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-hampton-navy mb-3">
          <FileText className="w-4 h-4" /> Content pipeline ({content.length})
        </h3>
        <div className="space-y-2">
          {content.length === 0 && <p className="text-sm text-gray-400">No content in the pipeline.</p>}
          {content.map(row => (
            <div key={row.id} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-hampton-navy text-sm">{row.title}</span>
                  <StatusBadge status={row.status} />
                  {row.locale !== 'en' && <span className="text-[10px] uppercase text-gray-400">{row.locale}</span>}
                  {row.references_child_media && (
                    <span className="flex items-center gap-1 text-[10px] text-amber-700" title="References child media — consent gated">
                      <ShieldCheck className="w-3 h-3" /> child media
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  /{row.slug} · {row.page_type}
                  {row.status === 'published' && (
                    <a href={`/${row.slug}`} target="_blank" rel="noreferrer" className="ml-2 text-blue-500 hover:underline">view ↗</a>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {row.status !== 'published' && (
                  <button
                    onClick={() => openPreview(row.id)}
                    className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg text-hampton-navy hover:bg-gray-100 transition-all"
                  >
                    <Eye className="w-3.5 h-3.5" /> Preview
                  </button>
                )}
                {(CONTENT_ACTIONS[row.status] || []).map(a => (
                  <button
                    key={a.to}
                    disabled={busyId === row.id}
                    onClick={() => advanceContent(row.id, a.to)}
                    className={`flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg transition-all disabled:opacity-50 ${
                      a.danger ? 'text-red-600 hover:bg-red-50' : 'text-hampton-navy hover:bg-gray-100'
                    }`}
                  >
                    <a.Icon className="w-3.5 h-3.5" /> {a.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Preview modal ── */}
      {previewOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-3xl mt-4 mb-8 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 sticky top-0 bg-white rounded-t-2xl">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold text-hampton-navy">Preview</span>
                {previewRow && <StatusBadge status={previewRow.status} />}
                {previewRow && previewRow.locale !== 'en' && (
                  <span className="text-[10px] uppercase text-gray-400">{previewRow.locale}</span>
                )}
              </div>
              <button onClick={() => setPreviewOpen(false)} className="p-1.5 text-gray-400 hover:text-hampton-navy hover:bg-gray-100 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-8">
              {previewLoading && <p className="text-sm text-gray-400">Loading preview…</p>}
              {previewError && <p className="text-sm text-red-600">{previewError}</p>}
              {previewRow && <ContentRenderBody row={previewRow} locale={previewRow.locale === 'es' ? 'es' : 'en'} />}
            </div>
          </div>
        </div>
      )}

      {/* ── Tasks ── */}
      <section>
        <h3 className="text-sm font-semibold text-hampton-navy mb-3">Marketing tasks ({tasks.length})</h3>
        <div className="space-y-2">
          {tasks.length === 0 && <p className="text-sm text-gray-400">No active tasks.</p>}
          {tasks.map(t => (
            <div key={t.id} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-hampton-navy text-sm">{t.title}</span>
                  <StatusBadge status={t.status} />
                  <span className="text-[10px] uppercase text-gray-400">{t.approval_tier}</span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{t.task_type}</div>
              </div>
              <div className="flex items-center gap-2">
                {(TASK_ACTIONS[t.status] || []).map(a => (
                  <button
                    key={a.to}
                    disabled={busyId === t.id}
                    onClick={() => advanceTask(t.id, a.to)}
                    className={`flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg transition-all disabled:opacity-50 ${
                      a.danger ? 'text-red-600 hover:bg-red-50' : 'text-hampton-navy hover:bg-gray-100'
                    }`}
                  >
                    <a.Icon className="w-3.5 h-3.5" /> {a.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Consent releases (pending) ── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-hampton-navy mb-3">
          <ShieldCheck className="w-4 h-4" /> Consent releases — awaiting signature ({releases.length})
        </h3>
        <div className="space-y-2">
          {releases.length === 0 && <p className="text-sm text-gray-400">No pending releases.</p>}
          {releases.map(r => (
            <div key={r.id} className="bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-3 text-sm">
              <span className="flex-1">{r.child_name || 'Unnamed child'}</span>
              <StatusBadge status={r.status} />
              <span className="text-xs text-gray-400">{new Date(r.created_at).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Recent ledger ── */}
      <section>
        <h3 className="text-sm font-semibold text-hampton-navy mb-3">Recent activity</h3>
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {ledger.length === 0 && <p className="text-sm text-gray-400 p-4">No activity yet.</p>}
          {ledger.map(l => (
            <div key={l.id} className="px-4 py-2 flex items-center gap-3 text-xs">
              <span className="text-gray-400 w-32 shrink-0">{new Date(l.created_at).toLocaleString()}</span>
              <span className="font-medium text-hampton-navy">{l.action}</span>
              <span className="text-gray-500">{l.entity_type}</span>
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
