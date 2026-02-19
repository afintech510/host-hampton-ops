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

export interface ListTaskOutput {
  status: 'completed' | 'failed'
  segment_name: string
  audience_key: string
  filters: Record<string, unknown>
  estimated_size?: number
  recommended_channels?: string[]
  notes?: string
  error?: string
}
