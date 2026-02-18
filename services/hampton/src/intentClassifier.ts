/**
 * intentClassifier.ts
 * Classifies owner input into an IntentCategory using keyword rules + Claude fallback.
 * Fast keyword matching for common patterns; Claude for ambiguous cases.
 */

import Anthropic from '@anthropic-ai/sdk'
import {
  IntentCategory,
  ClassificationResult,
  AgentName,
  ApprovalTier
} from './types.js'

// ─── Keyword rules (fast path, no API call) ─────────────────────
const KEYWORD_RULES: Array<{
  patterns: RegExp[]
  intent: IntentCategory
  agents: AgentName[]
  namespaces: string[]
  approval: ApprovalTier
  phase?: '1A' | '1B' | '2A' | '2B' | '3'
}> = [
  {
    patterns: [/\bpost\b.*photo/i, /\bschedule\b.*post/i, /\bpublish\b/i, /\bshare\b.*to\b.*(ig|instagram|facebook|fb|gbp|google)/i],
    intent: 'PUBLISH_CONTENT',
    agents: ['SOC', 'COPY', 'PIXEL'],
    namespaces: ['brand.voice', 'brand.hashtags', 'brand.visual', 'social.posting_schedule'],
    approval: 'AUTO_EXECUTE'
  },
  {
    patterns: [/\blaunch\b.*campaign/i, /\bcampaign\b/i, /\bspring\b.*birthday/i, /\bsummer\b.*campaign/i, /\bfall\b.*campaign/i, /\bholiday\b.*campaign/i],
    intent: 'CAMPAIGN_LAUNCH',
    agents: ['COPY', 'PIXEL', 'SOC', 'OUTBOUND', 'LIST'],
    namespaces: ['brand.voice', 'services.priority_order', 'calendar.seasonal_priorities', 'market.positioning'],
    approval: 'DRAFT_AND_SHOW'
  },
  {
    patterns: [/\bemail\b/i, /\bsms\b/i, /\btext\b.*contacts/i, /\bsequence\b/i, /\boutreach\b/i, /\bre-engage/i, /\bre engage/i],
    intent: 'EMAIL_SMS_CAMPAIGN',
    agents: ['OUTBOUND', 'COPY', 'LIST'],
    namespaces: ['brand.voice', 'operations.booking_rules'],
    approval: 'DRAFT_AND_SHOW'
  },
  {
    patterns: [/\bads?\b/i, /\bgoogle ads/i, /\bmeta ads/i, /\bpaid\b/i, /\badvertis/i, /\bppc\b/i],
    intent: 'PAID_ADS',
    agents: ['PAID', 'COPY', 'PIXEL', 'LIST'],
    namespaces: ['market.positioning', 'market.target_keywords'],
    approval: 'DRAFT_AND_SHOW',
    phase: '1B'
  },
  {
    patterns: [/\bhow are we doing/i, /\bperformance/i, /\breport\b/i, /\banalytics\b/i, /\bstats\b/i, /\bmetrics\b/i, /\bwhat.*numbers/i],
    intent: 'ANALYTICS_REPORT',
    agents: ['INTEL'],
    namespaces: ['analytics.channel_performance', 'analytics.monthly_summary'],
    approval: 'AUTO_EXECUTE',
    phase: '1B'
  },
  {
    patterns: [/\blanding page/i, /\bwebsite\b/i, /\bbuild\b.*page/i, /\bnew page/i, /\bseo\b/i],
    intent: 'WEBSITE_PAGE',
    agents: ['BUILD', 'COPY', 'PIXEL'],
    namespaces: ['brand.voice', 'brand.visual', 'market.target_keywords', 'website.migration_status'],
    approval: 'DRAFT_AND_SHOW',
    phase: '2A'
  },
  {
    patterns: [/\bcontacts?\b/i, /\bimport\b/i, /\bsegment\b/i, /\bcrm\b/i, /\blist\b/i, /\bsubscribers?\b/i],
    intent: 'CRM_CONTACTS',
    agents: ['LIST'],
    namespaces: ['operations.booking_rules'],
    approval: 'AUTO_EXECUTE'
  },
  {
    patterns: [/\bimages?\b/i, /\bresize\b/i, /\bprocess\b.*photo/i, /\boptimize\b.*photo/i, /\bphotos?\b.*format/i],
    intent: 'IMAGE_PROCESSING',
    agents: ['PIXEL'],
    namespaces: ['brand.visual'],
    approval: 'AUTO_EXECUTE'
  },
  {
    patterns: [/\bwrite\b/i, /\bdraft\b/i, /\bcaption\b/i, /\bcopy\b/i, /\bcontent\b/i, /\bblog\b/i],
    intent: 'CONTENT_WRITING',
    agents: ['COPY'],
    namespaces: ['brand.voice', 'brand.hashtags'],
    approval: 'DRAFT_AND_SHOW'
  },
  {
    patterns: [/\bpric(e|ing)/i, /\bchange.*fee/i, /\bupdate.*deposit/i, /\bpolic(y|ies)/i, /\bcancellation\b/i],
    intent: 'PRICING_POLICY',
    agents: [],
    namespaces: ['operations.booking_rules'],
    approval: 'ALWAYS_ASK'
  },
  {
    patterns: [/\bgaps?\b/i, /\bopen slots?\b/i, /\bavailabilit/i, /\bslow week/i, /\bquiet\b/i, /\bno bookings/i],
    intent: 'BOOKING_GAP',
    agents: ['SOC', 'OUTBOUND'],
    namespaces: ['gap_fill_rules.thresholds', 'operations.booking_rules'],
    approval: 'AUTO_EXECUTE'
  }
]

// ─── Claude-based classifier (for ambiguous inputs) ──────────────
const CLASSIFICATION_SYSTEM_PROMPT = `You are the intent classifier for HAMPTON, an AI orchestrator for Host Hampton — a boutique party studio in Speonk, NY.

Classify the owner's message into exactly ONE of these intent categories:
PUBLISH_CONTENT, CAMPAIGN_LAUNCH, EMAIL_SMS_CAMPAIGN, PAID_ADS, ANALYTICS_REPORT,
WEBSITE_PAGE, CRM_CONTACTS, IMAGE_PROCESSING, CONTENT_WRITING, BOOKING_GAP,
PRICING_POLICY, STRATEGY_QUESTION, ESCALATION, UNKNOWN

Rules:
- PRICING_POLICY if any mention of changing prices, fees, deposits, or policies
- STRATEGY_QUESTION for "how", "what should", "advice", "should we" questions
- CAMPAIGN_LAUNCH if multi-channel or seasonal push is implied
- When in doubt, choose the most actionable category

Respond with ONLY valid JSON matching this schema:
{
  "intent": "INTENT_CATEGORY",
  "confidence": "high|medium|low",
  "clarification_needed": null | "ONE question if truly ambiguous"
}`

export class IntentClassifier {
  private claude: Anthropic

  constructor() {
    this.claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }

  async classify(ownerMessage: string): Promise<ClassificationResult> {
    // Fast path: keyword matching
    const keywordMatch = this.matchKeywords(ownerMessage)
    if (keywordMatch) return keywordMatch

    // Slow path: Claude API
    return this.classifyWithClaude(ownerMessage)
  }

  private matchKeywords(message: string): ClassificationResult | null {
    for (const rule of KEYWORD_RULES) {
      if (rule.patterns.some(p => p.test(message))) {
        return {
          intent: rule.intent,
          confidence: 'high',
          relevant_agents: rule.agents,
          relevant_memory_namespaces: rule.namespaces,
          requires_phase: rule.phase ?? null,
          is_phase_gated: false,   // resolved in router with actual phase status
          suggested_approval_tier: rule.approval,
          clarification_needed: null
        }
      }
    }
    return null
  }

  private async classifyWithClaude(message: string): Promise<ClassificationResult> {
    try {
      const response = await this.claude.messages.create({
        model: 'claude-haiku-4-5-20251001',   // fast + cheap for classification
        max_tokens: 256,
        system: CLASSIFICATION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: message }]
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      const parsed = JSON.parse(text) as { intent: IntentCategory; confidence: string; clarification_needed: string | null }

      // Find matching rule for agent list
      const matchingRule = KEYWORD_RULES.find(r => r.intent === parsed.intent)

      return {
        intent: parsed.intent,
        confidence: parsed.confidence as 'high' | 'medium' | 'low',
        relevant_agents: matchingRule?.agents ?? [],
        relevant_memory_namespaces: matchingRule?.namespaces ?? ['brand.identity', 'brand.voice'],
        requires_phase: matchingRule?.phase ?? null,
        is_phase_gated: false,
        suggested_approval_tier: matchingRule?.approval ?? 'DRAFT_AND_SHOW',
        clarification_needed: parsed.clarification_needed
      }
    } catch {
      // Fallback: strategy question
      return {
        intent: 'STRATEGY_QUESTION',
        confidence: 'low',
        relevant_agents: [],
        relevant_memory_namespaces: ['brand.identity', 'services.priority_order'],
        requires_phase: null,
        is_phase_gated: false,
        suggested_approval_tier: 'AUTO_EXECUTE',
        clarification_needed: null
      }
    }
  }
}
