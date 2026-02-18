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

export interface SocTaskInput {
  task_type: string
  instructions: string
  platform?: string
  caption?: string
  image_url?: string
  hashtags?: string[]
  schedule_time?: string
  campaign_id?: string
  [key: string]: unknown
}

export interface SocTaskOutput {
  status: 'completed' | 'failed'
  platform?: string
  post_id?: string
  caption?: string
  hashtags?: string[]
  scheduled_for?: string
  notes?: string
  error?: string
}
