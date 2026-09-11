/**
 * Voice profile + learned rules — the one copy.
 *
 * `loadVoiceProfile` / `voicePromptAddendum` previously existed twice, in
 * lib/marketing/townDraft.ts and api/admin/marketing/fb-reply/route.ts, and had
 * already drifted (the fb-reply copy silently dropped dos/donts). Both now
 * import from here; this version is the superset.
 *
 * `loadLearnings` reads `agent_learnings`, which arrives in a later migration
 * (the learning loop, plan Phase 6). Until then it returns [] — every caller
 * must keep working against a database where that table does not exist.
 */

import { getSupabase } from '@/lib/supabase'

type Supa = ReturnType<typeof getSupabase>

export interface VoiceProfile {
  tone_rules?: string[]
  greeting?: string
  pricing_style?: string
  dos?: string[]
  donts?: string[]
  exemplars?: { context?: string; text: string }[]
}

export interface AgentLearning {
  kind: 'style' | 'rule' | 'fact' | 'pricing'
  text: string
  confidence?: number | null
}

/**
 * Reads the active voice_profile row so drafts sound like Allie. Defensive:
 * if the table/row doesn't exist or the query fails for any reason, returns
 * null and the caller falls back to the base system prompt unchanged.
 */
export async function loadVoiceProfile(supabase: Supa): Promise<VoiceProfile | null> {
  try {
    const { data, error } = await supabase
      .from('voice_profile')
      .select('profile')
      .eq('is_active', true)
      .maybeSingle()
    if (error || !data?.profile) return null
    return data.profile as VoiceProfile
  } catch {
    return null
  }
}

/** Prompt block describing how Allie actually writes. */
export function voicePromptAddendum(profile: VoiceProfile): string {
  const lines: string[] = ['', 'OPERATOR VOICE (match this — it is how Allie actually talks to customers):']
  if (profile.tone_rules?.length) {
    lines.push('Tone rules:')
    profile.tone_rules.forEach(r => lines.push(`- ${r}`))
  }
  if (profile.greeting) lines.push(`Greeting habit: ${profile.greeting}`)
  if (profile.pricing_style) lines.push(`Pricing style: ${profile.pricing_style}`)
  if (profile.dos?.length) lines.push(`Do: ${profile.dos.join('; ')}`)
  if (profile.donts?.length) lines.push(`Don't: ${profile.donts.join('; ')}`)
  if (profile.exemplars?.length) {
    lines.push('Exemplars of her real voice (style anchors, not content to copy verbatim):')
    profile.exemplars.slice(0, 5).forEach(e => lines.push(`- ${e.context ? `[${e.context}] ` : ''}${e.text}`))
  }
  return lines.join('\n')
}

/**
 * Active learned rules, highest confidence first. Fails soft to [] when the
 * table is absent (it ships with the Phase 6 migration) or the query errors.
 */
export async function loadLearnings(supabase: Supa, limit = 20): Promise<AgentLearning[]> {
  try {
    const { data, error } = await supabase
      .from('agent_learnings')
      .select('kind, text, confidence')
      .eq('is_active', true)
      .order('confidence', { ascending: false })
      .limit(limit)
    if (error || !data) return []
    return data as AgentLearning[]
  } catch {
    return []
  }
}

/** Prompt block for learned rules. Empty string when there are none. */
export function learningsPromptAddendum(learnings: AgentLearning[]): string {
  if (learnings.length === 0) return ''
  const lines = ['', 'LEARNED RULES (corrections Adam/Allie have already made — follow them):']
  learnings.forEach(l => lines.push(`- [${l.kind}] ${l.text}`))
  return lines.join('\n')
}
