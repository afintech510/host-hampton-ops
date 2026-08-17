import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { assertLlmBudget, recordLlmSpend, BudgetExceededError } from '@/lib/marketing/budget'
import { advance } from '@/lib/marketing/graph'

export const dynamic = 'force-dynamic'

/**
 * LLM node: Claude drafts a town × service `website_content` row.
 *
 * "Graph as data": this is the draft-generation node of the marketing graph.
 * It NEVER publishes. The generated row is inserted as `draft` and then moved
 * to `pending_review` via advance() (the only status writer) — a human approves
 * it later in the Marketing tab (draft → approved → published are the human
 * gates). It can never skip the approval gate: pending_review is the terminal
 * state this route produces, and only an authenticated admin can advance a
 * website_content row into approved/published.
 *
 * Budget: the check-act-record pattern. assertLlmBudget() runs BEFORE the model
 * call (refusal is logged to the ledger and throws BudgetExceededError);
 * recordLlmSpend() runs AFTER with the real USD cost + token counts.
 *
 * Client: raw fetch to the Anthropic Messages API — matches the existing
 * precedent in app/api/cron/draft-newsletter/route.ts (no @anthropic-ai/sdk
 * dependency, single global.fetch mock surface for Jest).
 *
 * Auth: admin only (LLM calls cost money + spend the monthly cap).
 */

const COPY_ACTOR = 'COPY'

// Haiku 4.5 — fast + cheap, matches the newsletter route. If you change the
// model, update PRICING so recordLlmSpend logs the real cost.
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

interface DraftResult {
  title: string
  meta_description: string
  keywords: string[]
  sections: { heading: string; text: string }[]
  faq: { q: string; a: string }[]
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function generateDraft(town: string, service: string): Promise<{ draft: DraftResult; inputTokens: number; outputTokens: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY as string

  const userPrompt = `Write a local landing page for this service in this town:
- Town: ${town}
- Service: ${service}

Respond with JSON exactly in this shape:
{
  "title": "SEO page title, ~55-60 chars, includes the town and service, ends with '| Host Hampton'",
  "meta_description": "meta description, ~150 chars, warm and specific to the town",
  "keywords": ["3-6 short lowercase local keyword phrases"],
  "sections": [
    { "heading": "short section heading", "text": "1-2 warm, specific paragraphs (plain text, no HTML)" }
  ],
  "faq": [
    { "q": "a real question a ${town} customer would ask about ${service}", "a": "a helpful, honest answer" }
  ]
}
Include 2-3 sections and 3 FAQ entries.`

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
      system: COPY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Anthropic error ${res.status}: ${body}`)
  }

  const data = (await res.json()) as {
    content: { type: string; text: string }[]
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  const text = data.content?.[0]?.type === 'text' ? data.content[0].text : ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Anthropic response did not contain JSON')

  const draft = JSON.parse(jsonMatch[0]) as DraftResult
  return {
    draft,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  }
}

function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[model] || PRICING['claude-haiku-4-5-20251001']
  return (inputTokens / 1_000_000) * price.in + (outputTokens / 1_000_000) * price.out
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const body = (await req.json()) as { town?: string; service?: string; slug?: string; locale?: string }
  const town = body.town?.trim()
  const service = body.service?.trim()
  const locale = body.locale === 'es' ? 'es' : 'en'

  if (!town || !service) {
    return NextResponse.json({ error: 'town and service are required' }, { status: 400 })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured on the server' },
      { status: 503 }
    )
  }

  const supabase = getSupabase()
  const slug = body.slug?.trim() || `${slugify(service)}-${slugify(town)}`

  // 1. CHECK budget before the model call (refusal is logged + throws).
  try {
    await assertLlmBudget(supabase, {
      estimatedUsd: ESTIMATED_USD,
      actor: COPY_ACTOR,
      entityType: 'website_content',
    })
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json({ error: err.message }, { status: 402 })
    }
    throw err
  }

  // 2. ACT — call Claude.
  let generated
  try {
    generated = await generateDraft(town, service)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'draft generation failed'
    console.error('generate-draft:', msg)
    return NextResponse.json({ error: 'Draft generation failed' }, { status: 502 })
  }

  const { draft, inputTokens, outputTokens } = generated

  // 3. Insert the draft row (status 'draft' — NEVER published here).
  const { data: row, error: insErr } = await supabase
    .from('website_content')
    .insert({
      slug,
      locale,
      page_type: 'landing',
      title: draft.title,
      meta_description: draft.meta_description,
      keywords: draft.keywords ?? [],
      status: 'draft',
      created_by: COPY_ACTOR,
      references_child_media: false,
      structured: { sections: draft.sections ?? [], faq: draft.faq ?? [] },
    })
    .select('id')
    .single()

  if (insErr || !row) {
    // 23505 = unique (slug, locale) violation → a draft already exists.
    if ((insErr as { code?: string } | null)?.code === '23505') {
      return NextResponse.json(
        { error: `Content already exists for slug "${slug}" (${locale}).` },
        { status: 409 }
      )
    }
    console.error('generate-draft insert error:', insErr?.message)
    return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 })
  }

  // 4. RECORD the real spend + tokens (after the call really happened).
  const usd = costUsd(MODEL, inputTokens, outputTokens)
  await recordLlmSpend(supabase, {
    usd,
    tokens: inputTokens + outputTokens,
    actor: COPY_ACTOR,
    entityType: 'website_content',
    entityId: row.id,
    meta: { model: MODEL, town, service, slug, input_tokens: inputTokens, output_tokens: outputTokens },
  })

  // 5. Advance draft → pending_review (advance() is the ONLY status writer).
  //    pending_review is NOT a gated status, so the COPY system actor may make
  //    this transition; approved/published still require an admin actor.
  await advance({
    entity: 'website_content',
    id: row.id,
    to: 'pending_review',
    actor: { id: COPY_ACTOR },
    supabase,
    meta: { generated_by: 'llm', model: MODEL },
  })

  return NextResponse.json({
    ok: true,
    id: row.id,
    slug,
    locale,
    status: 'pending_review',
    costUsd: usd,
    tokens: inputTokens + outputTokens,
  })
}
