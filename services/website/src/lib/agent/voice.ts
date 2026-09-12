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
import { normalizeLearningText, screenLearningText } from './learnings'

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
 * Screen every string in a voice profile.
 *
 * Each one is printed into the TRUSTED half of the draft prompt by
 * `voicePromptAddendum`, so each gets the same screen a learned rule gets.
 * Exemplars containing a figure are dropped on purpose: an exemplar is copied
 * in as "this is how she writes", and one containing "$850" is a standing
 * instruction to quote $850.
 *
 * ── Why this also runs on the way OUT, which it did not ───────────────────
 *
 * Phase 6 built this (in distill.ts) and ran it only on what the weekly
 * distiller PROPOSED. The profile that was actually LIVE had never been near
 * it — v1 was written by hand in Phase 1 — and it held seven exemplars, three
 * quoting mobile prices ($1,100 / $950 / $990 / $300 / $40 / $35), plus a tone
 * rule reading "real numbers inline with 'starting at'" and a pricing_style
 * reading "State a real starting number fast".
 *
 * Those went into the same prompt as the info-gather hard rule "ABSOLUTELY NO
 * PRICING. Not one number with a currency attached." The model was told both
 * at once, and HH-2026-4295 is what that looks like from outside: a draft
 * parked with "model included a dollar amount on an info-gather draft twice" —
 * it broke the rule, was corrected, and broke it again, because the trusted
 * half of its own prompt was showing it how.
 *
 * The output guardrails held and no wrong price reached a customer. That is the
 * distinction worth keeping: this was not a leak, it was the agent being
 * steered into breaking its own hard rule with a human paying for the
 * correction. Hard-won rule 8 — §23 asserted these strings "get the same
 * screen", and the one profile in production had never had it.
 */
export function sanitizeVoiceProfile(raw: unknown): { profile: VoiceProfile; dropped: string[] } {
  const dropped: string[] = []
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  const keep = (v: unknown, label: string): string | null => {
    const text = normalizeLearningText(v)
    if (!text) return null
    const reason = screenLearningText(text)
    if (reason) {
      dropped.push(`${label}: ${reason}`)
      return null
    }
    return text
  }
  const keepList = (v: unknown, label: string): string[] =>
    (Array.isArray(v) ? v : []).map((x, i) => keep(x, `${label}[${i}]`)).filter((s): s is string => !!s)

  const profile: VoiceProfile = {}
  const toneRules = keepList(p.tone_rules, 'tone_rules')
  if (toneRules.length) profile.tone_rules = toneRules
  const greeting = keep(p.greeting, 'greeting')
  if (greeting) profile.greeting = greeting
  const pricingStyle = keep(p.pricing_style, 'pricing_style')
  if (pricingStyle) profile.pricing_style = pricingStyle
  const dos = keepList(p.dos, 'dos')
  if (dos.length) profile.dos = dos
  const donts = keepList(p.donts, 'donts')
  if (donts.length) profile.donts = donts

  const exemplars = (Array.isArray(p.exemplars) ? p.exemplars : [])
    .map((e, i) => {
      const row = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
      const text = keep(row.text, `exemplars[${i}]`)
      if (!text) return null
      const context = normalizeLearningText(row.context)
      return { ...(context && !screenLearningText(context) ? { context } : {}), text }
    })
    .filter((e): e is { context?: string; text: string } => !!e)
  if (exemplars.length) profile.exemplars = exemplars

  return { profile, dropped }
}

/** True when there is enough in a profile to be worth putting in a prompt. */
export function profileIsSubstantive(p: VoiceProfile): boolean {
  return !!(p.tone_rules?.length || p.dos?.length || p.donts?.length || p.exemplars?.length || p.greeting || p.pricing_style)
}

export interface LoadedVoiceProfile {
  /** The active profile, every string screened. Null when there is none to use. */
  profile: VoiceProfile | null
  /** Strings the read-time screen removed, with the reason. Never silent (rule 10). */
  dropped: string[]
  /**
   * Non-null when the table could not be read AT ALL — not the same fact as
   * "there is no active profile", and it must not read like one (rule 12).
   */
  unavailable: string | null
}

/**
 * Reads the active voice_profile row so drafts sound like Allie, and screens it
 * on the way out. Defensive: if the table/row doesn't exist or the query fails
 * for any reason the caller falls back to the base system prompt unchanged —
 * but it is told WHICH of those happened.
 */
export async function loadVoiceProfile(supabase: Supa): Promise<LoadedVoiceProfile> {
  try {
    const { data, error } = await supabase
      .from('voice_profile')
      .select('profile')
      .eq('is_active', true)
      .maybeSingle()
    if (error) return { profile: null, dropped: [], unavailable: error.message }
    if (!data?.profile) return { profile: null, dropped: [], unavailable: null }

    const { profile, dropped } = sanitizeVoiceProfile(data.profile)
    if (dropped.length) {
      // A guardrail that stops something has to say that it stopped it (rule
      // 10). This one fires on the LIVE profile, so silence here is how a voice
      // quietly changes and nobody can say when.
      console.warn(`loadVoiceProfile: dropped ${dropped.length} string(s) from the active profile — ${dropped.join('; ')}`)
    }
    return { profile: profileIsSubstantive(profile) ? profile : null, dropped, unavailable: null }
  } catch (err) {
    return { profile: null, dropped: [], unavailable: err instanceof Error ? err.message : 'voice_profile read failed' }
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

  // `nextVoiceVersion` is a read followed by an insert, so two runs overlapping
  // — two cron hits, or a manual catch-up beside the Monday job — both compute
  // the same next version and the second gets 23505 from
  // `voice_profile_version_uniq`. The comment on `nextVoiceVersion` has always
  // said the caller "retries rather than guessing at" it. No caller did: this
  // function returned the error and `distillFeedback` pushed it onto `errors`,
  // so a whole week's voice profile was lost to a collision that re-reading the
  // table would have resolved. Rule 8, and rule 3 — a transient failure must
  // not be terminal. Bounded, because an unbounded retry on a real constraint
  // violation is an infinite loop.
  let lastError = ''
  for (let attempt = 0; attempt < 3; attempt++) {
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
    if (!error) return { ok: true, id: String(data.id), version }
    lastError = error.message
    // By CODE, not by message text — the message is the database's to change.
    if ((error as { code?: string }).code !== '23505') return { ok: false, error: lastError }
  }
  return { ok: false, error: `${lastError} (three version collisions in a row)` }
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

  // Re-screen at the moment of activation, exactly as `setLearningActive` does.
  // A profile could have been proposed before a screen rule was tightened, or
  // written straight into Postgres, and this is the last point at which
  // refusing it is free. Without this the two gates had drifted: a learned
  // sentence was re-screened on activation and a whole voice profile was not.
  const { profile: screened, dropped } = sanitizeVoiceProfile(row.profile)
  if (!profileIsSubstantive(screened)) {
    return {
      ok: false,
      status: 422,
      error: `Refused to activate: nothing in this profile survives the screen. ${dropped.join('; ') || 'It is empty.'}`,
    }
  }

  const { error: offErr } = await supabase
    .from('voice_profile')
    .update({ is_active: false })
    .eq('is_active', true)
  if (offErr) return { ok: false, status: 500, error: offErr.message }

  const { error: onErr } = await supabase.from('voice_profile').update({ is_active: true }).eq('id', id)
  if (onErr) {
    // Say what state this left behind — but SAY IT AFTER LOOKING. The previous
    // version asserted "No voice profile is active" unconditionally, and the
    // one failure mode that actually reaches this branch is the 23505 from the
    // partial unique index `voice_profile_one_active`, which happens when a
    // CONCURRENT activation won the race between the two statements above. In
    // exactly that case a profile IS active, and the message named the wrong
    // state to the only person who could fix it (rules 12 and 14).
    const { data: liveNow } = await supabase.from('voice_profile').select('version').eq('is_active', true).maybeSingle()
    const state = liveNow
      ? `Voice profile v${String(liveNow.version)} is the active one — another activation may have won the race.`
      : 'No voice profile is active — drafts are using the base prompt until one is.'
    return { ok: false, status: 500, error: `${onErr.message}. ${state}` }
  }
  return { ok: true, version: Number(row.version) }
}
