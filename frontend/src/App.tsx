import { useState, useEffect, useRef, useCallback } from 'react'
import {
  sendCommand, getTasks, approveTask, rejectTask, getStatus,
  getHistory, getContentLibrary, getReport,
  connectWebSocket, Task, ContentItem, ChatResponse, SystemStatus, IntelReport
} from './api'

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(s: Task['status']) {
  return {
    pending:           'bg-yellow-100 text-yellow-800',
    in_progress:       'bg-blue-100 text-blue-800',
    approved:          'bg-green-100 text-green-800',
    rejected:          'bg-red-100 text-red-800',
    completed:         'bg-green-100 text-green-800',
    failed:            'bg-red-100 text-red-800',
    cancelled:         'bg-gray-100 text-gray-600',
  }[s] ?? 'bg-gray-100 text-gray-600'
}

function tierBadge(t: Task['approval_tier']) {
  return {
    AUTO_EXECUTE:  'bg-green-50 text-green-700 border-green-200',
    DRAFT_AND_SHOW:'bg-blue-50 text-blue-700 border-blue-200',
    ALWAYS_ASK:    'bg-red-50 text-red-700 border-red-200',
  }[t] ?? ''
}

function contentTypeBadge(t: string) {
  return {
    caption:          'bg-pink-100 text-pink-800',
    email_subject:    'bg-purple-100 text-purple-800',
    email_body:       'bg-purple-100 text-purple-800',
    sms:              'bg-green-100 text-green-800',
    ad_headline:      'bg-orange-100 text-orange-800',
    ad_description:   'bg-orange-100 text-orange-800',
    blog_post:        'bg-blue-100 text-blue-800',
    hashtag_set:      'bg-teal-100 text-teal-800',
    review_response:  'bg-yellow-100 text-yellow-800',
    dm_reply:         'bg-indigo-100 text-indigo-800',
    other:            'bg-gray-100 text-gray-600',
  }[t] ?? 'bg-gray-100 text-gray-600'
}

function timeAgo(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60)  return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs/60)}m ago`
  if (secs < 86400) return `${Math.floor(secs/3600)}h ago`
  return `${Math.floor(secs/86400)}d ago`
}

// ── Task Card ─────────────────────────────────────────────────────────────────

function TaskCard({ task, onApprove, onReject }: {
  task: Task
  onApprove: (id: string) => void
  onReject: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const needsAction =
    task.status === 'pending' &&
    task.approval_tier !== 'AUTO_EXECUTE' &&
    !task.approved_at &&
    !task.rejected_at

  return (
    <div className={`rounded-xl border p-4 transition-all ${needsAction ? 'border-orange-300 bg-orange-50 shadow-md' : 'border-stone-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-hampton-navy">{task.assigned_to}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(task.status)}`}>
              {needsAction ? 'needs approval' : task.status.replace('_', ' ')}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded border font-medium ${tierBadge(task.approval_tier)}`}>
              {task.approval_tier}
            </span>
            <span className="text-xs text-stone-400">{timeAgo(task.created_at)}</span>
          </div>

          {task.input?.task_type != null && (
            <p className="mt-1 text-sm text-stone-600 truncate">
              {String(task.input.task_type).replace(/_/g, ' ')}
              {task.input.instructions != null ? ` — ${String(task.input.instructions).slice(0, 80)}…` : ''}
            </p>
          )}
        </div>

        <button
          onClick={() => setExpanded(v => !v)}
          className="text-stone-400 hover:text-stone-600 text-xs shrink-0"
        >
          {expanded ? '▲ less' : '▼ more'}
        </button>
      </div>

      {expanded && (
        <pre className="mt-3 text-xs bg-stone-100 rounded p-3 overflow-auto max-h-40 text-stone-700">
          {JSON.stringify({ input: task.input, output: task.output }, null, 2)}
        </pre>
      )}

      {needsAction && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => onApprove(task.id)}
            className="flex-1 bg-hampton-navy text-white text-sm font-medium py-2 rounded-lg hover:bg-blue-900 transition"
          >
            ✓ Approve
          </button>
          <button
            onClick={() => onReject(task.id)}
            className="flex-1 border border-stone-300 text-stone-600 text-sm font-medium py-2 rounded-lg hover:bg-stone-100 transition"
          >
            ✕ Reject
          </button>
        </div>
      )}
    </div>
  )
}

// ── History Card ──────────────────────────────────────────────────────────────

function HistoryCard({ task }: { task: Task }) {
  const [expanded, setExpanded] = useState(false)
  const output = task.output

  // Try to surface readable content from output
  const bodyText = output
    ? (output.body ?? output.content ?? output.caption ?? output.text ?? output.message) as string | undefined
    : undefined

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-hampton-navy">{task.assigned_to}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(task.status)}`}>
              {task.status.replace('_', ' ')}
            </span>
            <span className="text-xs text-stone-400">{timeAgo(task.updated_at)}</span>
          </div>
          {task.input?.task_type != null && (
            <p className="mt-1 text-sm text-stone-500">
              {String(task.input.task_type).replace(/_/g, ' ')}
            </p>
          )}
          {bodyText && !expanded && (
            <p className="mt-2 text-sm text-stone-700 line-clamp-3">{bodyText}</p>
          )}
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-stone-400 hover:text-stone-600 text-xs shrink-0"
        >
          {expanded ? '▲ less' : '▼ more'}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2">
          {bodyText && (
            <div className="text-sm text-stone-800 bg-stone-50 rounded p-3 whitespace-pre-wrap">{bodyText}</div>
          )}
          <pre className="text-xs bg-stone-100 rounded p-3 overflow-auto max-h-48 text-stone-600">
            {JSON.stringify(output, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── Content Card ──────────────────────────────────────────────────────────────

function ContentCard({ item }: { item: ContentItem }) {
  const [expanded, setExpanded] = useState(false)
  const preview = item.body?.slice(0, 160)
  const hasMore = (item.body?.length ?? 0) > 160

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${contentTypeBadge(item.content_type)}`}>
              {item.content_type.replace(/_/g, ' ')}
            </span>
            {item.platform && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-600">
                {item.platform}
              </span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              item.status === 'published' ? 'bg-green-100 text-green-800' :
              item.status === 'approved'  ? 'bg-blue-100 text-blue-800' :
                                            'bg-yellow-100 text-yellow-800'
            }`}>
              {item.status}
            </span>
            <span className="text-xs text-stone-400">{timeAgo(item.created_at)}</span>
          </div>

          {item.subject_line && (
            <p className="mt-2 text-sm font-medium text-hampton-navy">
              Subject: {item.subject_line}
            </p>
          )}

          <p className="mt-2 text-sm text-stone-700 whitespace-pre-wrap">
            {expanded ? item.body : preview}{hasMore && !expanded ? '…' : ''}
          </p>

          {item.hashtags && item.hashtags.length > 0 && (
            <p className="mt-2 text-xs text-stone-400">{item.hashtags.join(' ')}</p>
          )}
        </div>

        {hasMore && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-stone-400 hover:text-stone-600 text-xs shrink-0"
          >
            {expanded ? '▲ less' : '▼ more'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Report View ───────────────────────────────────────────────────────────────

function ReportView({ report, updatedAt, onRefresh, refreshing }: {
  report: IntelReport | null
  updatedAt: string | null
  onRefresh: () => void
  refreshing: boolean
}) {
  if (!report) {
    return (
      <div className="text-center py-16 space-y-4">
        <p className="text-stone-400 text-sm">No analytics report yet.</p>
        <p className="text-stone-400 text-xs">Reports generate daily at 6am or on demand.</p>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="mt-2 bg-hampton-navy text-white text-sm px-5 py-2.5 rounded-xl hover:bg-blue-900 transition disabled:opacity-40"
        >
          {refreshing ? 'Running…' : 'Run Report Now'}
        </button>
      </div>
    )
  }

  const m = report.internal_metrics
  const g = report.ga4_metrics
  const reportLabel = report.report_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-stone-400 uppercase tracking-wide font-medium">{reportLabel}</p>
          {updatedAt && (
            <p className="text-xs text-stone-400">{timeAgo(updatedAt)}</p>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="text-xs bg-hampton-navy text-white px-4 py-2 rounded-lg hover:bg-blue-900 transition disabled:opacity-40"
        >
          {refreshing ? 'Running…' : 'Refresh'}
        </button>
      </div>

      {/* Summary */}
      <div className="bg-white rounded-xl border border-stone-200 p-4">
        <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">Summary</p>
        <p className="text-sm text-hampton-navy leading-relaxed">{report.summary}</p>
      </div>

      {/* Internal Metrics */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Tasks (7d)</p>
          <p className="text-2xl font-bold text-hampton-navy">{m.tasks_completed_7d}</p>
          {Object.entries(m.tasks_by_agent).length > 0 && (
            <div className="mt-2 space-y-0.5">
              {Object.entries(m.tasks_by_agent).map(([agent, count]) => (
                <p key={agent} className="text-xs text-stone-500">{agent}: {count}</p>
              ))}
            </div>
          )}
        </div>
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Content (7d)</p>
          <p className="text-2xl font-bold text-hampton-navy">{m.content_items_7d}</p>
          {m.top_content_type && (
            <p className="text-xs text-stone-500 mt-2">Top: {m.top_content_type.replace(/_/g, ' ')}</p>
          )}
        </div>

        {/* GA4 Metrics */}
        {g ? (
          <>
            <div className="bg-white rounded-xl border border-stone-200 p-4">
              <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Sessions (7d)</p>
              <p className="text-2xl font-bold text-hampton-navy">{g.sessions_7d.toLocaleString()}</p>
              <p className="text-xs text-stone-500 mt-1">{g.users_7d.toLocaleString()} users</p>
            </div>
            <div className="bg-white rounded-xl border border-stone-200 p-4">
              <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Page Views (7d)</p>
              <p className="text-2xl font-bold text-hampton-navy">{g.page_views_7d.toLocaleString()}</p>
            </div>
          </>
        ) : (
          <div className="col-span-2 bg-stone-50 rounded-xl border border-stone-200 p-4 text-center">
            <p className="text-xs text-stone-400">GA4 not connected — website traffic unavailable</p>
          </div>
        )}
      </div>

      {/* Top Pages */}
      {g && g.top_pages.length > 0 && (
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">Top Pages</p>
          <div className="space-y-2">
            {g.top_pages.map(({ page, views }) => (
              <div key={page} className="flex items-center justify-between text-sm">
                <span className="text-stone-600 truncate max-w-[75%]">{page}</span>
                <span className="text-stone-400 text-xs">{views.toLocaleString()} views</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Traffic Sources */}
      {g && Object.keys(g.traffic_source).length > 0 && (
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">Traffic Sources</p>
          <div className="space-y-2">
            {Object.entries(g.traffic_source).sort((a, b) => b[1] - a[1]).map(([source, sessions]) => (
              <div key={source} className="flex items-center justify-between text-sm">
                <span className="text-stone-600">{source}</span>
                <span className="text-stone-400 text-xs">{sessions} sessions</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Insights */}
      {report.insights.length > 0 && (
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">Insights</p>
          <ul className="space-y-2">
            {report.insights.map((insight, i) => (
              <li key={i} className="flex gap-2 text-sm text-stone-700">
                <span className="text-hampton-navy mt-0.5 shrink-0">→</span>
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommended Actions */}
      {report.recommended_actions.length > 0 && (
        <div className="bg-hampton-navy rounded-xl p-4">
          <p className="text-xs font-semibold text-blue-200 uppercase tracking-wide mb-3">Recommended Actions</p>
          <ul className="space-y-2">
            {report.recommended_actions.map((action, i) => (
              <li key={i} className="flex gap-2 text-sm text-white">
                <span className="text-blue-300 mt-0.5 shrink-0">{i + 1}.</span>
                <span>{action}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Chat Bubble ───────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'hampton'
  text: string
  ts: Date
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'hampton', text: 'Hey Allie! I\'m online and ready. What do you need?', ts: new Date() }
  ])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([])
  const [history, setHistory] = useState<Task[]>([])
  const [contentItems, setContentItems] = useState<ContentItem[]>([])
  const [report, setReport] = useState<IntelReport | null>(null)
  const [reportUpdatedAt, setReportUpdatedAt] = useState<string | null>(null)
  const [reportRefreshing, setReportRefreshing] = useState(false)
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [tab, setTab] = useState<'chat' | 'tasks' | 'history' | 'content' | 'reports'>('chat')
  const bottomRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const loadTasks = useCallback(async () => {
    try { setTasks(await getTasks()) } catch { /* ignore */ }
  }, [])

  const loadHistory = useCallback(async () => {
    try { setHistory(await getHistory()) } catch { /* ignore */ }
  }, [])

  const loadContent = useCallback(async () => {
    try { setContentItems(await getContentLibrary()) } catch { /* ignore */ }
  }, [])

  const loadReport = useCallback(async () => {
    try {
      const { report: r, updated_at } = await getReport()
      setReport(r)
      setReportUpdatedAt(updated_at)
    } catch { /* ignore */ }
  }, [])

  const runReportNow = useCallback(async () => {
    setReportRefreshing(true)
    try {
      await sendCommand('Run an analytics report for the last 7 days')
      // Poll for the result — INTEL takes ~15s
      setTimeout(async () => {
        await loadReport()
        setReportRefreshing(false)
      }, 18000)
    } catch {
      setReportRefreshing(false)
    }
  }, [loadReport])

  // Initial load
  useEffect(() => {
    loadTasks()
    getStatus().then(setStatus).catch(() => {})
  }, [loadTasks])

  // Poll tasks every 15s
  useEffect(() => {
    const t = setInterval(loadTasks, 15000)
    return () => clearInterval(t)
  }, [loadTasks])

  // WebSocket
  useEffect(() => {
    const ws = connectWebSocket((data: unknown) => {
      const d = data as { type?: string; message?: string }
      if (d?.type === 'task_update' || d?.type === 'task_created') loadTasks()
      if (d?.type === 'task_complete') {
        loadTasks()
        loadHistory()
        loadContent()
      }
      if (d?.type === 'escalation' && typeof d.message === 'string') {
        setMessages(m => [...m, { role: 'hampton', text: `🚨 ${d.message as string}`, ts: new Date() }])
      }
    })
    ws.onopen  = () => setWsStatus('connected')
    ws.onclose = () => setWsStatus('disconnected')
    wsRef.current = ws
    return () => ws.close()
  }, [loadTasks, loadHistory, loadContent])

  // Scroll chat to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleTabChange(t: typeof tab) {
    setTab(t)
    if (t === 'history') loadHistory()
    if (t === 'content') loadContent()
    if (t === 'reports') loadReport()
  }

  async function handleSend() {
    const msg = input.trim()
    if (!msg || sending) return
    setInput('')
    setSending(true)
    setMessages(m => [...m, { role: 'user', text: msg, ts: new Date() }])

    try {
      const res: ChatResponse = await sendCommand(msg)
      setMessages(m => [...m, { role: 'hampton', text: res.message, ts: new Date() }])
      if (res.tasks?.length) loadTasks()
    } catch (e) {
      setMessages(m => [...m, { role: 'hampton', text: `⚠️ Connection error. Is the VPS reachable?`, ts: new Date() }])
    } finally {
      setSending(false)
    }
  }

  async function handleApprove(id: string) {
    try {
      await approveTask(id)
      loadTasks()
    } catch (e) {
      setMessages(m => [...m, { role: 'hampton', text: `⚠️ Approve failed: ${e instanceof Error ? e.message : String(e)}`, ts: new Date() }])
    }
  }

  async function handleReject(id: string) {
    try {
      await rejectTask(id)
      loadTasks()
      loadHistory()
    } catch (e) {
      setMessages(m => [...m, { role: 'hampton', text: `⚠️ Reject failed: ${e instanceof Error ? e.message : String(e)}`, ts: new Date() }])
    }
  }

  const quickPrompts = [
    { label: '📣 Social Post', text: 'Write an Instagram caption for our Glow Party this weekend in Speonk. Keep it warm, local, and include a CTA.' },
    { label: '✉️ Email Draft', text: 'Draft an email subject + body for a Swiftie Party promo for Hamptons families. Keep it non-pushy and scannable.' },
    { label: '📱 SMS Draft', text: 'Write a short SMS for leads who inquired but did not book in the last 14 days. Friendly, one question at the end.' },
    { label: '📊 Analytics', text: 'Run an analytics report for the last 7 days and give me insights on what to focus on.' },
    { label: '🧩 Build Segment', text: 'Create a CRM segment for families with kids ages 6–10 on the East End who have not booked in 6 months. Recommend channels.' },
    { label: '🖼️ Image Prompt', text: 'Generate an image for a Princess Party promo: bright, celebratory, no text overlay. Square format for Instagram.' },
  ]

  const pendingApproval = tasks.filter(t =>
    t.status === 'pending' &&
    t.approval_tier !== 'AUTO_EXECUTE' &&
    !t.approved_at &&
    !t.rejected_at
  )

  const tabLabel = (t: typeof tab) => {
    if (t === 'tasks' && pendingApproval.length > 0) return `Tasks (${pendingApproval.length})`
    return t.charAt(0).toUpperCase() + t.slice(1)
  }

  return (
    <div className="min-h-screen font-sans bg-hampton-cream flex flex-col">

      {/* Header */}
      <header className="bg-hampton-navy text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div>
          <h1 className="text-lg font-bold tracking-wide">HAMPTON</h1>
          <p className="text-xs text-blue-200">Host Hampton Command Center</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {status && (
            <span className="hidden sm:block text-blue-200">Phase {status.phase}</span>
          )}
          <span className={`flex items-center gap-1 ${wsStatus === 'connected' ? 'text-green-300' : 'text-red-300'}`}>
            <span className={`w-2 h-2 rounded-full ${wsStatus === 'connected' ? 'bg-green-400' : 'bg-red-400'}`} />
            {wsStatus}
          </span>
        </div>
      </header>

      {/* Approval banner */}
      {pendingApproval.length > 0 && (
        <div className="bg-orange-500 text-white text-center text-sm py-2 px-4 font-medium">
          {pendingApproval.length} task{pendingApproval.length > 1 ? 's' : ''} waiting for your approval
          <button onClick={() => handleTabChange('tasks')} className="ml-2 underline">Review →</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-stone-200 bg-white">
        {(['chat', 'tasks', 'history', 'content', 'reports'] as const).map(t => (
          <button
            key={t}
            onClick={() => handleTabChange(t)}
            className={`flex-1 py-3 text-xs font-medium capitalize transition ${tab === t ? 'border-b-2 border-hampton-navy text-hampton-navy' : 'text-stone-400 hover:text-stone-600'}`}
          >
            {tabLabel(t)}
          </button>
        ))}
      </div>

      {/* Chat */}
      {tab === 'chat' && (
        <div className="flex-1 flex flex-col max-w-2xl w-full mx-auto px-4 pb-4">
          <div className="flex-1 overflow-y-auto py-4 space-y-3 min-h-0" style={{ maxHeight: 'calc(100vh - 220px)' }}>
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-hampton-navy text-white rounded-br-sm'
                    : 'bg-white border border-stone-200 text-hampton-navy rounded-bl-sm shadow-sm'
                }`}>
                  <div className="whitespace-pre-wrap break-words">{m.text}</div>
                  <div className={`text-xs mt-1 ${m.role === 'user' ? 'text-blue-200' : 'text-stone-400'}`}>
                    {m.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-white border border-stone-200 rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-stone-400 shadow-sm">
                  <span className="animate-pulse">HAMPTON is thinking…</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="flex gap-2 pt-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder="Tell HAMPTON what you need…"
              className="flex-1 border border-stone-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-hampton-navy bg-white"
            />
            <button
              onClick={handleSend}
              disabled={sending || !input.trim()}
              className="bg-hampton-navy text-white px-5 py-3 rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-blue-900 transition"
            >
              Send
            </button>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            {quickPrompts.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setInput(p.text)}
                className="text-xs px-3 py-2 rounded-full border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:text-stone-800 transition"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tasks */}
      {tab === 'tasks' && (
        <div className="flex-1 overflow-y-auto max-w-2xl w-full mx-auto px-4 py-4 space-y-3">
          {tasks.length === 0 ? (
            <div className="text-center text-stone-400 py-16">No active tasks</div>
          ) : (
            tasks.map(t => (
              <TaskCard key={t.id} task={t} onApprove={handleApprove} onReject={handleReject} />
            ))
          )}
        </div>
      )}

      {/* History */}
      {tab === 'history' && (
        <div className="flex-1 overflow-y-auto max-w-2xl w-full mx-auto px-4 py-4 space-y-3">
          {history.length === 0 ? (
            <div className="text-center text-stone-400 py-16">No completed tasks yet</div>
          ) : (
            history.map(t => (
              <HistoryCard key={t.id} task={t} />
            ))
          )}
        </div>
      )}

      {/* Content */}
      {tab === 'content' && (
        <div className="flex-1 overflow-y-auto max-w-2xl w-full mx-auto px-4 py-4 space-y-3">
          {contentItems.length === 0 ? (
            <div className="text-center text-stone-400 py-16">No content generated yet</div>
          ) : (
            contentItems.map(item => (
              <ContentCard key={item.id} item={item} />
            ))
          )}
        </div>
      )}

      {/* Reports */}
      {tab === 'reports' && (
        <div className="flex-1 overflow-y-auto max-w-2xl w-full mx-auto px-4 py-4">
          <ReportView
            report={report}
            updatedAt={reportUpdatedAt}
            onRefresh={runReportNow}
            refreshing={reportRefreshing}
          />
        </div>
      )}
    </div>
  )
}
