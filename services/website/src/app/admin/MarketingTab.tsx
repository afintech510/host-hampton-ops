'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, CheckCircle2, XCircle, Send, Eye, Archive, DollarSign, FileText, ShieldCheck, Sparkles, ListChecks, BookMarked, MessageSquare, X, AlertTriangle, Pencil } from 'lucide-react'
import { ContentRenderBody, type ContentRenderRow } from '@/components/content/ContentRenderBody'
import { checkSlug } from '@/lib/content/slugSafety'
import { MAX_TITLE_CHARS, MAX_DESCRIPTION_CHARS } from '@/lib/seo'
import type { Locale } from '@/lib/content/slug'

/* ── Types ─────────────────────────────────────────────── */

interface ContentRow {
  id: string
  slug: string
  title: string
  meta_description: string | null
  status: string
  locale: string
  page_type: string
  created_by: string | null
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

/** Length readout for a field Google truncates. Amber at 90%, red over. */
function Budget({ label, value, max }: { label: string; value: string; max: number }) {
  const n = value.length
  const tone = n > max ? 'text-red-600 font-semibold' : n > max * 0.9 ? 'text-amber-600' : 'text-gray-400'
  return (
    <span className={`text-[11px] ${tone}`}>
      {label} {n}/{max}
      {n > max ? ' — Google will cut this' : ''}
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
  const [editId, setEditId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editSlug, setEditSlug] = useState('')

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

  function startEdit(row: ContentRow) {
    setEditId(row.id)
    setEditTitle(row.title || '')
    setEditDesc(row.meta_description || '')
    setEditSlug(row.slug || '')
    setError(null)
  }

  // The reviewer's fix-it path: the title, the description and the slug are the
  // three fields an LLM gets wrong in ways only a human can judge. `status` is
  // NOT editable here — it moves through advance() and nowhere else, so this
  // cannot become a second, ungated publish door.
  async function saveEdit(id: string) {
    setBusyId(id); setError(null); setNotice(null)
    try {
      const res = await fetch('/api/admin/marketing/content', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id, title: editTitle, meta_description: editDesc, slug: editSlug }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Save failed'); return }
      // Rule 10: if the server trimmed something to fit the budget, say so —
      // otherwise the field silently differs from what was typed.
      if (data.notes?.length) setNotice(`Saved. ${data.notes.join('; ')}.`)
      else setNotice('Saved.')
      setEditId(null)
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
      // The normaliser's notes are the difference between "the model wrote
      // this" and "the model wrote this and we cut 40 characters off the
      // title". The reviewer is approving the second thing.
      const trimmed = data.notes?.length ? ` (${data.notes.join('; ')})` : ''
      setNotice(`Draft created for ${town} · ${service} — review it below.${trimmed}`)
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
          {content.map(row => {
            // Where this row will actually live, and whether anything can ever
            // render there. All four English drafts in the table collide with a
            // hand-built page; publishing one changes nothing a visitor sees.
            const slugState = checkSlug(row.slug, (row.locale === 'es' ? 'es' : 'en') as Locale)
            const canPublish = slugState.ok
            return (
            <div key={row.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-hampton-navy text-sm">{row.title}</span>
                  <StatusBadge status={row.status} />
                  {row.locale !== 'en' && <span className="text-[10px] uppercase text-gray-400">{row.locale}</span>}
                  {row.created_by && (
                    <span className="text-[10px] uppercase text-gray-400" title="Who wrote this row">{row.created_by}</span>
                  )}
                  {row.references_child_media && (
                    <span className="flex items-center gap-1 text-[10px] text-amber-700" title="References child media — consent gated">
                      <ShieldCheck className="w-3 h-3" /> child media
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-3 flex-wrap">
                  <span>{slugState.path} · {row.page_type}</span>
                  <Budget label="title" value={row.title || ''} max={MAX_TITLE_CHARS} />
                  <Budget label="desc" value={row.meta_description || ''} max={MAX_DESCRIPTION_CHARS} />
                  {row.status === 'published' && canPublish && (
                    <a href={slugState.path} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">view ↗</a>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => startEdit(row)}
                  className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg text-hampton-navy hover:bg-gray-100 transition-all"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
                {row.status !== 'published' && (
                  <button
                    onClick={() => openPreview(row.id)}
                    className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg text-hampton-navy hover:bg-gray-100 transition-all"
                  >
                    <Eye className="w-3.5 h-3.5" /> Preview
                  </button>
                )}
                {(CONTENT_ACTIONS[row.status] || []).map(a => {
                  // The publish button is the one action a bad slug makes
                  // pointless. Disable it and say why on the button itself — a
                  // banner elsewhere is something you scroll past.
                  const blocked = a.to === 'published' && !canPublish
                  return (
                  <button
                    key={a.to}
                    disabled={busyId === row.id || blocked}
                    title={blocked ? slugState.message : undefined}
                    onClick={() => advanceContent(row.id, a.to)}
                    className={`flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                      a.danger ? 'text-red-600 hover:bg-red-50' : 'text-hampton-navy hover:bg-gray-100'
                    }`}
                  >
                    <a.Icon className="w-3.5 h-3.5" /> {a.label}
                  </button>
                  )
                })}
              </div>
              </div>

              {!canPublish && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{slugState.message}</span>
                </div>
              )}

              {editId === row.id && (
                <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                  <label className="block">
                    <span className="text-[11px] text-gray-500">Title</span>
                    <input
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      className="w-full mt-0.5 text-sm rounded-lg border border-gray-300 px-2 py-1.5"
                    />
                    <Budget label="title" value={editTitle} max={MAX_TITLE_CHARS} />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-gray-500">Meta description</span>
                    <textarea
                      value={editDesc}
                      onChange={e => setEditDesc(e.target.value)}
                      rows={3}
                      className="w-full mt-0.5 text-sm rounded-lg border border-gray-300 px-2 py-1.5"
                    />
                    <Budget label="desc" value={editDesc} max={MAX_DESCRIPTION_CHARS} />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-gray-500">Slug</span>
                    <input
                      value={editSlug}
                      onChange={e => setEditSlug(e.target.value)}
                      className="w-full mt-0.5 text-sm rounded-lg border border-gray-300 px-2 py-1.5 font-mono"
                    />
                    {(() => {
                      const s = checkSlug(editSlug, (row.locale === 'es' ? 'es' : 'en') as Locale)
                      return (
                        <span className={`text-[11px] ${s.ok ? 'text-gray-400' : 'text-red-600'}`}>
                          {s.ok ? `will publish at ${s.path}` : s.message}
                        </span>
                      )
                    })()}
                  </label>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => saveEdit(row.id)}
                      disabled={busyId === row.id}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg bg-hampton-navy text-white disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button onClick={() => setEditId(null)} className="text-xs px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
            )
          })}
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
