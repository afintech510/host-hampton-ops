export interface TaskManifest {
  task_id: string
  assigned_to: string
  priority: string
  depends_on?: string[]
  input: Record<string, unknown>
  approval_tier: string
  deadline?: string
  context?: Record<string, unknown>
}

export interface OutboundTaskOutput {
  status: 'completed' | 'failed'
  channel: 'email' | 'sms'
  audience_key?: string
  subject?: string
  body: string
  sms_text?: string
  call_to_action?: string
  notes?: string
  error?: string
}
