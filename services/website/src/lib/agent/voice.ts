/**
 * Voice profile + learned rules — the one copy.
 *
 * `loadVoiceProfile` / `voicePromptAddendum` previously existed twice, in
 * lib/marketing/townDraft.ts and api/admin/marketing/fb-reply/route.ts, and had
 * already drifted (the fb-reply copy silently dropped dos/donts). Both now
 * import from here; this version is the superset.
 *
 * The learned-rules half moved to ./learnings in Phase 6. It grew a screen, a
 * fence and a write path of its own once `agent_learnings` became a real table,
 * and leaving a second `loadLearnings` here would have been exactly the shape
 * of hard-won rule 11.
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
 * The next version number for a proposed profile. `voice_profile_version_uniq`
 * makes a collision a 23505, which the caller retries rather than guessing at.
 */
async function nextVoiceVersion(supabase: Supa): Promise<number> {
  const { data } = await supabase
    .from('voice_profile')
    .select('version')
    .order('version', { ascending: false })
    .limit(1)
  const top = Number((data as { version?: unknown }[] | null)?.[0]?.version)
  return Number.isFinite(top) ? top + 1 : 2
}

/**
 * Record a proposed voice profile. INACTIVE, always — same rule as a proposed
 * learning: the weekly distiller may describe how Allie writes, it may not
 * change how the agent writes. `activateVoiceProfile` is the admin-only gate.
 */
export async function proposeVoiceProfile(args: {
  supabase: Supa
  profile: VoiceProfile
  createdBy: string
  corpusNotes?: string | null
  confidence?: 'low' | 'medium' | 'high'
}): Promise<{ ok: true; id: string; version: number } | { ok: false; error: string }> {
  const { supabase, profile, createdBy } = args
  const version = await nextVoiceVersion(supabase)
  const { data, error } = await supabase
    .from('voice_profile')
    .insert({
      version,
      is_active: false,
      profile,
      corpus_notes: args.corpusNotes ?? null,
      confidence: args.confidence ?? 'low',
      created_by: createdBy,
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, id: String(data.id), version }
}

/**
 * Make a proposed profile the live one.
 *
 * Deactivate-then-activate, two statements, because `voice_profile_one_active`
 * is a partial UNIQUE index and doing it the other way round is refused. The
 * window between them has ZERO active profiles, which is the safe direction to
 * fail: `loadVoiceProfile` returns null and drafts fall back to the base system
 * prompt, rather than two profiles fighting or the old one silently winning.
 */
export async function activateVoiceProfile(args: {
  supabase: Supa
  id: string
  actor: string
}): Promise<{ ok: true; version: number } | { ok: false; status: number; error: string }> {
  const { supabase, id } = args
  const { data: row, error: readErr } = await supabase
    .from('voice_profile')
    .select('id, version, profile')
    .eq('id', id)
    .maybeSingle()
  if (readErr) return { ok: false, status: 503, error: `Could not read the voice profile: ${readErr.message}` }
  if (!row) return { ok: false, status: 404, error: 'Voice profile not found' }

  const { error: offErr } = await supabase
    .from('voice_profile')
    .update({ is_active: false })
    .eq('is_active', true)
  if (offErr) return { ok: false, status: 500, error: offErr.message }

  const { error: onErr } = await supabase.from('voice_profile').update({ is_active: true }).eq('id', id)
  if (onErr) {
    return {
      ok: false,
      status: 500,
      // Say what state this left behind. There is now NO active profile, which
      // is safe but is not what the caller asked for, and silence about it is
      // how someone spends an afternoon wondering why drafts changed tone.
      error: `${onErr.message}. No voice profile is active — drafts are using the base prompt until one is.`,
    }
  }
  return { ok: true, version: Number(row.version) }
}
