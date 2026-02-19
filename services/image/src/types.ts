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

export interface ImageTaskInput {
  task_type?: string
  instructions?: string
  prompt?: string
  negative_prompt?: string
  aspect_ratio?: string
  width?: number
  height?: number
  campaign_id?: string
  service?: string
  platform?: string
  [key: string]: unknown
}

export interface ImageTaskOutput {
  status: 'completed' | 'failed'
  prompt: string
  revised_prompt?: string
  image_url?: string
  replicate_prediction_id?: string
  model?: string
  width?: number
  height?: number
  notes?: string
  error?: string
}
