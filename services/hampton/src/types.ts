/**
 * types.ts — Shared types for the HAMPTON orchestrator
 */

// ─── Agent Names ────────────────────────────────────────────────
export type AgentName =
  | 'HAMPTON'
  | 'SOC'
  | 'COPY'
  | 'IMAGE'
  | 'BUILD'
  | 'LIST'
  | 'OUTBOUND'
  | 'PAID'
  | 'INTEL'

// ─── Approval Tiers ─────────────────────────────────────────────
export type ApprovalTier =
  | 'AUTO_EXECUTE'       // Execute immediately, report completion
  | 'DRAFT_AND_SHOW'     // Surface to owner, auto-execute after 4-hour timeout
  | 'ALWAYS_ASK'         // Never proceed without explicit owner confirmation

// ─── Intent Categories ──────────────────────────────────────────
export type IntentCategory =
  | 'PUBLISH_CONTENT'        // Post to social / schedule posts
  | 'CAMPAIGN_LAUNCH'        // Multi-channel campaign
  | 'EMAIL_SMS_CAMPAIGN'     // Email or SMS sequences
  | 'PAID_ADS'               // Google / Meta ad campaigns
  | 'ANALYTICS_REPORT'       // Performance reports / how are we doing
  | 'WEBSITE_PAGE'           // Build / update landing pages
  | 'CRM_CONTACTS'           // Import, segment, manage contacts
  | 'IMAGE_PROCESSING'       // Resize / process images
  | 'CONTENT_WRITING'        // Write copy for specific asset
  | 'BOOKING_GAP'            // Revenue / availability analysis
  | 'PRICING_POLICY'         // Pricing or policy change (ALWAYS_ASK)
  | 'STRATEGY_QUESTION'      // Owner asking for advice / status
  | 'ESCALATION'             // Needs human decision
  | 'UNKNOWN'                // Cannot classify

// ─── Task Status ────────────────────────────────────────────────
export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'failed'
  | 'cancelled'

// ─── Task Manifest ──────────────────────────────────────────────
export interface TaskManifest {
  task_id: string
  assigned_to: AgentName
  priority: 'urgent' | 'high' | 'normal' | 'low' | 'async'
  depends_on?: string[]         // task_ids that must complete first
  input: Record<string, unknown>
  approval_tier: ApprovalTier
  deadline?: Date
  context?: Record<string, unknown>   // memory context passed to agent
}

// ─── Task Record (as stored in Supabase) ────────────────────────
export interface TaskRecord {
  id: string
  task_id: string
  assigned_to: AgentName
  status: TaskStatus
  priority: string
  depends_on: string[] | null
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  approval_tier: ApprovalTier
  approved_at: string | null
  rejected_at: string | null
  rejection_reason: string | null
  created_at: string
  updated_at: string
  deadline: string | null
}

// ─── Memory Entry ───────────────────────────────────────────────
export interface MemoryEntry {
  namespace: string
  key: string
  description: string
  value: Record<string, unknown>
  updated_by?: string
  updated_at?: string
}

// ─── Classification Result ──────────────────────────────────────
export interface ClassificationResult {
  intent: IntentCategory
  confidence: 'high' | 'medium' | 'low'
  relevant_agents: AgentName[]
  relevant_memory_namespaces: string[]
  requires_phase: '1A' | '1B' | '2A' | '2B' | '3' | null
  is_phase_gated: boolean          // true if agent not active in current phase
  suggested_approval_tier: ApprovalTier
  clarification_needed: string | null   // ONE question to ask if ambiguous
}

// ─── Owner Message ──────────────────────────────────────────────
export interface OwnerMessage {
  id: string
  content: string
  timestamp: Date
  session_id: string
}

// ─── HAMPTON Response ───────────────────────────────────────────
export interface HamptonResponse {
  message: string              // owner-facing response
  tasks_created: TaskManifest[]
  requires_input: boolean
  clarification_question?: string
}

// ─── Booking Gap ────────────────────────────────────────────────
export interface BookingGap {
  gap_start_date: string
  gap_end_date: string
  gap_days: number
}

export interface GapAlert extends BookingGap {
  action: 'soc_awareness' | 'outbound_flash_offer' | 'paid_campaign_plus_escalate'
  urgency: 'low' | 'normal' | 'high'
  agents: AgentName[]
  escalate: boolean
}

// ─── Escalation ─────────────────────────────────────────────────
export type EscalationPriority = 'urgent' | 'high' | 'normal' | 'low'

export interface EscalationRecord {
  triggered_by: AgentName
  reason: string
  context: Record<string, unknown>
  priority: EscalationPriority
}

// ─── Phase Status ───────────────────────────────────────────────
export interface PhaseStatus {
  current_phase: '1A' | '1B' | '2A' | '2B' | '3'
  active_agents: AgentName[]
  phase_1b_start: string | null
  phase_2_start: string | null
  squarespace_status: string
}
