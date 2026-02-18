/**
 * router.ts
 * Decomposes a classified owner intent into an ordered list of TaskManifests.
 * Enforces:
 *   - Phase gating (no BUILD until Phase 2, no PAID/INTEL until 1B)
 *   - Dependency ordering (COPY → PIXEL → SOC, LIST before OUTBOUND, etc.)
 *   - Correct approval tiers per action type
 */

import Anthropic from '@anthropic-ai/sdk'
import { v4 as uuidv4 } from 'uuid'
import {
  IntentCategory,
  ClassificationResult,
  TaskManifest,
  AgentName,
  ApprovalTier,
  PhaseStatus
} from './types.js'

// Phase gates: which agents are locked behind which phase
const PHASE_GATES: Partial<Record<AgentName, '1B' | '2A'>> = {
  PAID:  '1B',
  INTEL: '1B',
  BUILD: '2A'
}

// Approval tier rules per action type
const APPROVAL_RULES: Record<string, ApprovalTier> = {
  social_post_scheduled:      'AUTO_EXECUTE',
  social_post_new_campaign:   'DRAFT_AND_SHOW',
  email_campaign:             'DRAFT_AND_SHOW',
  sms_campaign:               'DRAFT_AND_SHOW',
  paid_ad_launch:             'ALWAYS_ASK',
  paid_ad_optimize:           'AUTO_EXECUTE',
  website_page_new:           'DRAFT_AND_SHOW',
  website_page_content_edit:  'AUTO_EXECUTE',
  website_structural:         'ALWAYS_ASK',
  dns_change:                 'ALWAYS_ASK',
  pricing_change:             'ALWAYS_ASK',
  crm_import:                 'AUTO_EXECUTE',
  crm_segment:                'AUTO_EXECUTE',
  image_process:              'AUTO_EXECUTE',
  copy_write:                 'DRAFT_AND_SHOW',
  analytics_report:           'AUTO_EXECUTE'
}

const HAMPTON_SYSTEM_PROMPT = `You are HAMPTON, the AI orchestrator for Host Hampton — a boutique celebration studio in Speonk, NY.

Your job right now is to decompose an owner command into a structured list of agent tasks.

AGENT ROSTER (Phase 1A active: SOC, COPY, PIXEL, OUTBOUND, LIST, HAMPTON):
- SOC: Social media — IG, FB, GBP, Nextdoor, FB Groups
- COPY: All written content — captions, email, SMS, page copy, ads
- PIXEL: Image processing — resize, brand, format for all platforms
- BUILD: Website (Phase 2 only — not active yet)
- LIST: CRM + audiences — segmentation, retargeting lists, list health
- OUTBOUND: Email + SMS sequences — welcome, nurture, review velocity, direct outreach
- PAID: Meta + Google paid ads (Phase 1B only — not active yet)
- INTEL: Analytics + reporting (Phase 1B only — not active yet)

DEPENDENCY RULES (enforce strictly):
1. COPY must complete before PIXEL (PIXEL needs copy for overlay text)
2. COPY + PIXEL must complete before SOC (posts need both assets)
3. LIST segment must complete before OUTBOUND sends (need the audience first)
4. BUILD page must exist before PAID drives traffic to it

APPROVAL TIERS:
- AUTO_EXECUTE: Scheduled social posts, content edits, image resizing, internal data, analytics
- DRAFT_AND_SHOW: New campaigns, new email sequences, new ad creatives, new pages (auto-executes after 4 hours if no owner response)
- ALWAYS_ASK: Pricing changes, navigation/structural website changes, DNS changes, budget increases, policy decisions, paid ad launches

Respond with ONLY a valid JSON array of task objects. Each task:
{
  "assigned_to": "AGENT_NAME",
  "priority": "urgent|high|normal|low|async",
  "depends_on_task_indices": [],  // indices (0-based) of tasks in this array that must finish first
  "input": {
    "task_type": "description",
    "instructions": "detailed instructions for the agent",
    ... any other relevant fields
  },
  "approval_tier": "AUTO_EXECUTE|DRAFT_AND_SHOW|ALWAYS_ASK"
}

Do not include tasks for phase-gated agents (BUILD, PAID, INTEL) unless the phase allows it.
Do not include task_id — that is assigned by the system.`

export class Router {
  private claude: Anthropic

  constructor() {
    this.claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }

  /**
   * Build an ordered list of task manifests from owner command + classification.
   * Returns manifests with dependency task_ids resolved.
   */
  async buildTaskPlan(
    ownerCommand: string,
    classification: ClassificationResult,
    memoryContext: string,
    phaseStatus: PhaseStatus
  ): Promise<TaskManifest[]> {

    // Hard block for ALWAYS_ASK intents — return a single blocked task
    if (classification.intent === 'PRICING_POLICY') {
      return this.buildAlwaysAskBlock(ownerCommand, classification)
    }

    // Strategy questions and unknown intents → no tasks, answer directly
    if (classification.intent === 'STRATEGY_QUESTION' || classification.intent === 'UNKNOWN') {
      return []
    }

    // Ask Claude to build the task plan
    const rawTasks = await this.askClaudeForPlan(ownerCommand, memoryContext, phaseStatus)

    // Convert raw Claude output → proper TaskManifests with UUIDs and resolved deps
    return this.resolveManifests(rawTasks, phaseStatus)
  }

  private async askClaudeForPlan(
    ownerCommand: string,
    memoryContext: string,
    phaseStatus: PhaseStatus
  ): Promise<RawClaudeTask[]> {
    const phaseNote = `CURRENT PHASE: ${phaseStatus.current_phase}. Active agents: ${phaseStatus.active_agents.join(', ')}.`

    try {
      const response = await this.claude.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 2048,
        system: HAMPTON_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `${phaseNote}\n\n${memoryContext}\n\n---\n\nOwner command: "${ownerCommand}"\n\nBuild the task plan.`
          }
        ]
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : '[]'

      // Extract JSON array from response (Claude may wrap in markdown)
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) return []

      return JSON.parse(jsonMatch[0]) as RawClaudeTask[]
    } catch (err) {
      console.error('[Router] Failed to get task plan from Claude:', err)
      return []
    }
  }

  private resolveManifests(rawTasks: RawClaudeTask[], phaseStatus: PhaseStatus): TaskManifest[] {
    const taskIds: string[] = rawTasks.map(() => uuidv4())
    const manifests: TaskManifest[] = []

    for (let i = 0; i < rawTasks.length; i++) {
      const raw = rawTasks[i]!
      const agent = raw.assigned_to as AgentName

      // Phase gate check — skip if agent not active in current phase
      if (this.isPhaseGated(agent, phaseStatus)) {
        console.log(`[Router] Skipping ${agent} — not active in Phase ${phaseStatus.current_phase}`)
        continue
      }

      // Resolve dependency indices → task_ids
      const depends_on = (raw.depends_on_task_indices ?? [])
        .map((idx: number) => taskIds[idx])
        .filter((id): id is string => id !== undefined)

      manifests.push({
        task_id: taskIds[i]!,
        assigned_to: agent,
        priority: (raw.priority ?? 'normal') as 'urgent' | 'high' | 'normal' | 'low' | 'async',
        depends_on: depends_on.length > 0 ? depends_on : undefined,
        input: raw.input ?? {},
        approval_tier: raw.approval_tier as ApprovalTier ?? 'DRAFT_AND_SHOW'
      })
    }

    return manifests
  }

  private buildAlwaysAskBlock(
    ownerCommand: string,
    _classification: ClassificationResult
  ): TaskManifest[] {
    return [{
      task_id: uuidv4(),
      assigned_to: 'HAMPTON',
      priority: 'normal',
      input: {
        task_type: 'pricing_policy_change',
        original_command: ownerCommand,
        blocked_reason: 'Pricing and policy changes require explicit owner confirmation before any agent acts.'
      },
      approval_tier: 'ALWAYS_ASK'
    }]
  }

  private isPhaseGated(agent: AgentName, phaseStatus: PhaseStatus): boolean {
    const requiredPhase = PHASE_GATES[agent]
    if (!requiredPhase) return false
    return !phaseStatus.active_agents.includes(agent)
  }

  /**
   * Export approval rules for use in other modules
   */
  getApprovalTier(actionType: string): ApprovalTier {
    return APPROVAL_RULES[actionType] ?? 'DRAFT_AND_SHOW'
  }
}

// Internal type for Claude's raw task output
interface RawClaudeTask {
  assigned_to: string
  priority: string
  depends_on_task_indices: number[]
  input: Record<string, unknown>
  approval_tier: string
}
