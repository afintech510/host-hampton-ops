import { useState, useEffect, useRef, useCallback } from 'react'
import {
  sendCommand, getTasks, approveTask, rejectTask, getStatus,
  connectWebSocket, Task, ChatResponse, SystemStatus
} from './api'

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(s: Task['status']) {
  return {
    pending:           'bg-yellow-100 text-yellow-800',
    in_progress:       'bg-blue-100 text-blue-800',
    awaiting_approval: 'bg-orange-100 text-orange-800',
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

function timeAgo(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60)  return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs/60)}m ago`
  return `${Math.floor(secs/3600)}h ago`
}

// ── Task Card ─────────────────────────────────────────────────────────────────

function TaskCard({ task, onApprove, onReject }: {
  task: Task
  onApprove: (id: string) => void
  onReject: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const needsAction = task.status === 'awaiting_approval'

  return (
    <div className={`rounded-xl border p-4 transition-all ${needsAction ? 'border-orange-300 bg-orange-50 shadow-md' : 'border-stone-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-hampton-navy">{task.assigned_to}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(task.status)}`}>
              {task.status.replace('_', ' ')}
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
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [tab, setTab] = useState<'chat' | 'tasks'>('chat')
  const bottomRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const loadTasks = useCallback(async () => {
    try { setTasks(await getTasks()) } catch { /* ignore */ }
  }, [])

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
      if (d?.type === 'escalation' && typeof d.message === 'string') {
        setMessages(m => [...m, { role: 'hampton', text: `🚨 ${d.message as string}`, ts: new Date() }])
      }
    })
    ws.onopen  = () => setWsStatus('connected')
    ws.onclose = () => setWsStatus('disconnected')
    wsRef.current = ws
    return () => ws.close()
  }, [loadTasks])

  // Scroll chat to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
    await approveTask(id)
    loadTasks()
  }

  async function handleReject(id: string) {
    await rejectTask(id)
    loadTasks()
  }

  const pendingApproval = tasks.filter(t => t.status === 'awaiting_approval')

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
          <button onClick={() => setTab('tasks')} className="ml-2 underline">Review →</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-stone-200 bg-white">
        {(['chat', 'tasks'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium capitalize transition ${tab === t ? 'border-b-2 border-hampton-navy text-hampton-navy' : 'text-stone-400 hover:text-stone-600'}`}
          >
            {t === 'tasks' && pendingApproval.length > 0
              ? `Tasks (${pendingApproval.length})`
              : t.charAt(0).toUpperCase() + t.slice(1)}
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
                  {m.text}
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
    </div>
  )
}
