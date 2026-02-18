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

export interface CopyTaskInput {
  task_type: string
  instructions: string
  platform?: string
  service?: string
  tone?: string
  word_count?: number
  campaign_id?: string
  [key: string]: unknown
}

export interface CopyTaskOutput {
  status: 'completed' | 'failed'
  content_type: string
  body: string
  headline?: string
  cta?: string
  hashtags?: string[]
  word_count?: number
  notes?: string
  error?: string
}
