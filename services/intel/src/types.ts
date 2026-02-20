/**
 * types.ts — Shared types for the INTEL analytics agent
 */

export interface TaskManifest {
  task_id: string
  assigned_to: string
  priority: 'urgent' | 'high' | 'normal' | 'low' | 'async'
  input: Record<string, unknown>
  approval_tier: 'AUTO_EXECUTE' | 'DRAFT_AND_SHOW' | 'ALWAYS_ASK'
  depends_on?: string[]
  context?: Record<string, unknown>
}

export interface InternalMetrics {
  tasks_completed_7d: number
  tasks_by_agent: Record<string, number>
  content_items_7d: number
  content_by_type: Record<string, number>
  top_content_type: string | null
}

export interface GA4Metrics {
  sessions_7d: number
  users_7d: number
  page_views_7d: number
  top_pages: Array<{ page: string; views: number }>
  traffic_source: Record<string, number>
}

export interface IntelReport {
  report_type: 'overnight_analytics' | 'week_ahead' | 'week_in_review'
  generated_at: string
  internal_metrics: InternalMetrics
  ga4_metrics: GA4Metrics | null
  ga4_available: boolean
  summary: string
  insights: string[]
  recommended_actions: string[]
}

export interface IntelTaskOutput {
  status: 'completed' | 'failed'
  report?: IntelReport
  error?: string
}
