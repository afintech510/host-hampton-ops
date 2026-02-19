const BASE = import.meta.env.VITE_API_URL ?? 'http://5.161.88.134'

export interface Task {
  id: string
  assigned_to: string
  status: 'pending' | 'in_progress' | 'approved' | 'rejected' | 'completed' | 'failed' | 'cancelled'
  approval_tier: 'AUTO_EXECUTE' | 'DRAFT_AND_SHOW' | 'ALWAYS_ASK'
  priority: string
  input: Record<string, unknown>
  output?: Record<string, unknown>
  approved_at?: string | null
  rejected_at?: string | null
  rejection_reason?: string | null
  created_at: string
  updated_at: string
}

export interface ContentItem {
  id: string
  title: string
  content_type: string
  platform?: string
  status: string
  body: string
  subject_line?: string
  hashtags?: string[]
  created_by?: string
  created_at: string
}

export interface ChatResponse {
  message: string
  tasks?: Task[]
  requires_approval?: boolean
}

export interface SystemStatus {
  agent: string
  phase: string
  active_agents: string[]
  timestamp: string
}

export async function sendCommand(message: string): Promise<ChatResponse> {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function getTasks(): Promise<Task[]> {
  const res = await fetch(`${BASE}/tasks`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.tasks ?? []
}

export async function approveTask(id: string): Promise<void> {
  const res = await fetch(`${BASE}/tasks/${id}/approve`, { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export async function rejectTask(id: string): Promise<void> {
  const res = await fetch(`${BASE}/tasks/${id}/reject`, { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export async function getHistory(): Promise<Task[]> {
  const res = await fetch(`${BASE}/tasks/history`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.tasks ?? []
}

export async function getContentLibrary(): Promise<ContentItem[]> {
  const res = await fetch(`${BASE}/content-library`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.items ?? []
}

export async function getStatus(): Promise<SystemStatus> {
  const res = await fetch(`${BASE}/status`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function connectWebSocket(onMessage: (data: unknown) => void): WebSocket {
  const wsBase = BASE.replace(/^http/, 'ws')
  const ws = new WebSocket(`${wsBase}/ws`)
  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)) } catch { /* ignore */ }
  }
  return ws
}
