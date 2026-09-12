/**
 * Shared town × service draft-generation pipeline (the COPY LLM node).
 *
 * Extracted from app/api/marketing/generate-draft/route.ts so the admin
 * on-demand route and the weekly-town-drafts cron can share one
 * check-act-record implementation instead of drifting apart.
 */

import { getSupabase } from '@/lib/supabase'
import { assertLlmBudget, recordLlmSpend, BudgetExceededError } from '@/lib/marketing/budget'
import { advance, writeLedger } from '@/lib/marketing/graph'
import { loadVoiceProfile, voicePromptAddendum, type VoiceProfile } from '@/lib/agent/voice'
import { MAX_TITLE_CHARS, MAX_DESCRIPTION_CHARS } from '@/lib/seo'
import { checkSlug } from '@/lib/content/slugSafety'
import { normalizeDraft, type NormalizedDraft } from '@/lib/content/draftNormalize'

// The voice profile now lives in lib/agent/voice.ts (one copy, shared with the
// booking agent). Re-exported here so existing importers keep working.
export { loadVoiceProfile, voicePromptAddendum }
export type { VoiceProfile }

type Supa = ReturnType<typeof getSupabase>

const COPY_ACTOR = 'COPY'

// Haiku 4.5 — fast + cheap. If you change the model, update PRICING so
// recordLlmSpend logs the real cost.
const MODEL = process.env.MARKETING_DRAFT_MODEL || 'claude-haiku-4-5-20251001'

// USD per 1M tokens (input / output).
const PRICING: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  'claude-haiku-4-5': { in: 1, out: 5 },
}

// Pre-reserved headroom checked against the monthly cap before the call. A
// town × service landing draft is small (~1.5k in / ~2k out ≈ $0.012); reserve
// a little extra so a call that would blow the cap is refused up front.
const ESTIMATED_USD = 0.05

const COPY_SYSTEM_PROMPT = `You are COPY, the content writing agent for Host Hampton — a boutique celebration studio in Speonk, NY run by Allie Larkin. Host Hampton serves the East End of Long Island (the Hamptons).

BRAND VOICE:
- Warm, fun, community-first. Never corporate or pushy.
- Use "we" — not "I". Speak directly to the reader as "you".
- Conversational but polished. Celebrate the moment. Make it feel real.
- NEVER say: "amazing", "incredible", "game-changer", "perfect", "seamless", "effortless".
- DO say: "beautiful", "real", "genuine", "we love", "your crew", "the good stuff".

You write local SEO landing pages for a specific town + service. Be specific to the town and genuinely helpful — no keyword stuffing, no invented facts, no fake reviews or credentials.

Respond ONLY with valid JSON — no markdown fences, no extra text.`

export type DraftResult = NormalizedDraft

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Pull the model's text out of a reply.
 *
 * Hard-won rule 1: `content[0]` is not necessarily the text — with extended
 * thinking enabled it is a `thinking` block, and the old
 * `content?.[0]?.type === 'text' ? … : ''` then produced an empty string, which
 * failed as "response did not contain JSON" rather than as the config change it
 * really was. Find the first block that IS text.
 */
function firstTextBlock(content: unknown): string {
  if (!Array.isArray(content)) return ''
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string') return text
    }
  }
  return ''
}

async function callClaude(
  town: string,
  service: string,
  voiceProfile: VoiceProfile | null
): Promise<{ draft: DraftResult; notes: string[]; inputTokens: number; outputTokens: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY as string
  const systemPrompt = voiceProfile ? COPY_SYSTEM_PROMPT + '\n' + voicePromptAddendum(voiceProfile) : COPY_SYSTEM_PROMPT

  const userPrompt = `Write a local landing page for this service in this town:
- Town: ${town}
- Service: ${service}

Respond with JSON exactly in this shape:
{
  "title": "SEO page title including the town and service, ending with '| Host Hampton'",
  "meta_description": "meta description, warm and specific to the town",
  "keywords": ["3-6 short lowercase local keyword phrases"],
  "sections": [
    { "heading": "short section heading", "text": "1-2 warm, specific paragraphs (plain text, no HTML)" }
  ],
  "faq": [
    { "q": "a real question a ${town} customer would ask about ${service}", "a": "a helpful, honest answer" }
  ]
}
Include 2-3 sections and 3 FAQ entries.

HARD LIMITS — these are what Google shows, not suggestions:
- "title" must be at most ${MAX_TITLE_CHARS} characters INCLUDING the " | Host Hampton" suffix. Google truncates past that and the tail of a long title is never read.
- "meta_description" must be at most ${MAX_DESCRIPTION_CHARS} characters.
- Every value must be plain text. No HTML tags, no markdown.
- Do not state a price, a package rate or a dollar figure anywhere.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Anthropic error ${res.status}: ${body}`)
  }

  const data = (await res.json()) as {
    content?: unknown
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  const text = firstTextBlock(data.content)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Anthropic response did not contain JSON')

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    throw new Error('Anthropic response was not valid JSON')
  }

  // The reply is data from a model, not a DraftResult because a cast said so.
  // Everything the row will publish — <title>, <meta>, the page body — is
  // bounded and stripped here before it can reach the database.
  const normalized = normalizeDraft(parsed)
  if (!normalized.ok) throw new Error(normalized.error)

  return {
    draft: normalized.draft,
    notes: normalized.notes,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  }
}

function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[model] || PRICING['claude-haiku-4-5-20251001']
  return (inputTokens / 1_000_000) * price.in + (outputTokens / 1_000_000) * price.out
}

export type TownDraftOutcome =
  | {
      ok: true
      status: 200
      id: string
      slug: string
      locale: string
      contentStatus: 'pending_review'
      costUsd: number
      tokens: number
      /** What the normaliser trimmed or dropped — shown to the reviewer (rule 10). */
      notes: string[]
    }
  | { ok: false; status: number; error: string }

/**
 * Full check-act-record pipeline for one town × service draft: budget check,
 * Claude call (with voice profile folded in when available), insert as
 * `draft`, record real spend, then advance() to `pending_review`. NEVER
 * publishes — pending_review is terminal here; a human approves via the
 * Marketing tab. Mirrors app/api/marketing/generate-draft/route.ts exactly.
 */
export async function createTownServiceDraft(
  supabase: Supa,
  opts: { town: string; service: string; slug?: string; locale?: 'en' | 'es'; actor?: string }
): Promise<TownDraftOutcome> {
  const town = opts.town.trim()
  const service = opts.service.trim()
  const locale = opts.locale ?? 'en'
  const slug = opts.slug?.trim() || `${slugify(service)}-${slugify(town)}`
  const actor = opts.actor ?? COPY_ACTOR

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, status: 503, error: 'ANTHROPIC_API_KEY is not configured on the server' }
  }

  // Check the URL BEFORE spending money on the copy. A slug shadowed by a
  // hand-built page can never render, so a draft under it is a page nobody will
  // ever see and a review nobody should be asked for — and the check costs
  // nothing, while the Claude call costs real budget.
  const slugCheck = checkSlug(slug, locale)
  if (!slugCheck.ok) {
    return { ok: false, status: 422, error: `Cannot draft "${slug}" (${locale}): ${slugCheck.message}` }
  }

  try {
    await assertLlmBudget(supabase, { estimatedUsd: ESTIMATED_USD, actor, entityType: 'website_content' })
  } catch (err) {
    if (err instanceof BudgetExceededError) return { ok: false, status: 402, error: err.message }
    throw err
  }

  const { profile: voiceProfile } = await loadVoiceProfile(supabase)
  let generated
  try {
    generated = await callClaude(town, service, voiceProfile)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'draft generation failed'
    console.error('createTownServiceDraft:', msg)
    return { ok: false, status: 502, error: 'Draft generation failed' }
  }

  const { draft, notes, inputTokens, outputTokens } = generated

  const { data: row, error: insErr } = await supabase
    .from('website_content')
    .insert({
      slug,
      locale,
      page_type: 'landing',
      title: draft.title,
      meta_description: draft.meta_description,
      keywords: draft.keywords,
      status: 'draft',
      created_by: actor,
      references_child_media: false,
      structured: { sections: draft.sections, faq: draft.faq },
    })
    .select('id')
    .single()

  if (insErr || !row) {
    if ((insErr as { code?: string } | null)?.code === '23505') {
      return { ok: false, status: 409, error: `Content already exists for slug "${slug}" (${locale}).` }
    }
    console.error('createTownServiceDraft insert error:', insErr?.message)
    return { ok: false, status: 500, error: 'Failed to save draft' }
  }

  const usd = costUsd(MODEL, inputTokens, outputTokens)
  await recordLlmSpend(supabase, {
    usd,
    tokens: inputTokens + outputTokens,
    actor,
    entityType: 'website_content',
    entityId: row.id,
    meta: { model: MODEL, town, service, slug, input_tokens: inputTokens, output_tokens: outputTokens },
  })

  await advance({
    entity: 'website_content',
    id: row.id,
    to: 'pending_review',
    actor: { id: actor },
    supabase,
    meta: { generated_by: 'llm', model: MODEL, normalizer_notes: notes },
  })

  // Rule 10: the normaliser trimming a title or stripping markup is a thing
  // that HAPPENED to the copy a human is about to approve. A ledger note is
  // where that fact lives permanently; the route also returns it to the panel.
  if (notes.length > 0) {
    await writeLedger(supabase, {
      entityType: 'website_content',
      entityId: row.id,
      action: 'note',
      actor,
      meta: { normalizer_notes: notes, slug, locale },
    })
  }

  return {
    ok: true,
    status: 200,
    id: row.id,
    slug,
    locale,
    contentStatus: 'pending_review',
    costUsd: usd,
    tokens: inputTokens + outputTokens,
    notes,
  }
}
