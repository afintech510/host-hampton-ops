/**
 * memoryManager.ts
 * Loads and updates agent_memory entries from Supabase.
 * All agents receive context from here before task execution.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { IntentCategory, MemoryEntry, AgentName } from './types.js'

// Which namespaces to load for each intent type
const INTENT_NAMESPACE_MAP: Record<IntentCategory, string[]> = {
  PUBLISH_CONTENT:    ['brand.voice', 'brand.hashtags', 'brand.visual', 'campaigns.active', 'social.posting_schedule'],
  CAMPAIGN_LAUNCH:    ['brand.voice', 'brand.visual', 'services.priority_order', 'calendar.seasonal_priorities', 'market.positioning', 'campaigns.active'],
  EMAIL_SMS_CAMPAIGN: ['brand.voice', 'services.priority_order', 'operations.booking_rules', 'campaigns.active'],
  PAID_ADS:           ['market.positioning', 'market.target_keywords', 'services.priority_order', 'analytics.channel_performance'],
  ANALYTICS_REPORT:   ['analytics.channel_performance', 'analytics.monthly_summary', 'campaigns.active'],
  WEBSITE_PAGE:       ['brand.voice', 'brand.visual', 'services.priority_order', 'market.target_keywords', 'website.migration_status'],
  CRM_CONTACTS:       ['operations.target_areas', 'operations.booking_rules'],
  IMAGE_PROCESSING:   ['brand.visual'],
  CONTENT_WRITING:    ['brand.voice', 'brand.hashtags', 'services.priority_order'],
  BOOKING_GAP:        ['gap_fill_rules.thresholds', 'services.priority_order', 'operations.booking_rules'],
  PRICING_POLICY:     ['operations.booking_rules', 'services.kids_party_themes'],
  STRATEGY_QUESTION:  ['brand.identity', 'services.priority_order', 'market.positioning', 'campaigns.active', 'analytics.channel_performance'],
  ESCALATION:         ['brand.identity', 'operations.phase_status'],
  UNKNOWN:            ['brand.identity', 'brand.voice', 'services.priority_order']
}

// Always-loaded namespaces regardless of intent
const BASELINE_NAMESPACES = ['brand.identity', 'brand.voice', 'services.priority_order', 'campaigns.active', 'operations.phase_status']

export class MemoryManager {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Load a single namespace.key entry
   */
  async load(namespace: string, key: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await this.supabase
      .from('agent_memory')
      .select('value')
      .eq('namespace', namespace)
      .eq('key', key)
      .single()

    if (error || !data) return null
    return data.value as Record<string, unknown>
  }

  /**
   * Load all entries for a namespace prefix (e.g. "brand" loads brand.identity, brand.voice, etc.)
   */
  async loadNamespace(namespace: string): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase
      .from('agent_memory')
      .select('key, value')
      .eq('namespace', namespace)

    if (error || !data) return {}
    return Object.fromEntries(data.map(row => [row.key, row.value]))
  }

  /**
   * Load context for a specific intent — returns flat map of namespace.key → value
   */
  async loadForIntent(intent: IntentCategory): Promise<Record<string, unknown>> {
    const namespaceKeys = [
      ...new Set([...BASELINE_NAMESPACES, ...(INTENT_NAMESPACE_MAP[intent] ?? [])])
    ]

    const results: Record<string, unknown> = {}

    await Promise.all(
      namespaceKeys.map(async (nsKey) => {
        const [namespace, key] = nsKey.split('.')
        if (!namespace || !key) return
        const value = await this.load(namespace, key)
        if (value !== null) results[nsKey] = value
      })
    )

    return results
  }

  /**
   * Update a memory entry (called after significant events)
   */
  async update(
    namespace: string,
    key: string,
    value: Record<string, unknown>,
    updatedBy: AgentName | 'HAMPTON' | 'bootstrap' = 'HAMPTON'
  ): Promise<void> {
    const { error } = await this.supabase
      .from('agent_memory')
      .upsert(
        { namespace, key, value, updated_by: updatedBy },
        { onConflict: 'namespace,key' }
      )

    if (error) {
      console.error(`[MemoryManager] Failed to update ${namespace}.${key}:`, error.message)
      throw error
    }
  }

  /**
   * Merge a partial update into an existing memory value
   */
  async merge(
    namespace: string,
    key: string,
    patch: Record<string, unknown>,
    updatedBy: AgentName | 'HAMPTON' = 'HAMPTON'
  ): Promise<void> {
    const current = await this.load(namespace, key)
    const merged = { ...(current ?? {}), ...patch }
    await this.update(namespace, key, merged, updatedBy)
  }

  /**
   * Get current phase status — used for phase gating decisions
   */
  async getPhaseStatus(): Promise<{ current_phase: string; active_agents: string[] }> {
    const phase = await this.load('operations', 'phase_status')
    return (phase as { current_phase: string; active_agents: string[] }) ?? {
      current_phase: '1A',
      active_agents: ['HAMPTON', 'SOC', 'COPY', 'IMAGE', 'OUTBOUND', 'LIST']
    }
  }

  /**
   * Format context as a string for inclusion in Claude prompts
   */
  formatContextForPrompt(context: Record<string, unknown>): string {
    const lines: string[] = ['## Loaded Business Context\n']
    for (const [key, value] of Object.entries(context)) {
      lines.push(`### ${key}\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`)
    }
    return lines.join('\n')
  }
}
