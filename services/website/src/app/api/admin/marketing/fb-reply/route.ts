import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { assertLlmBudget, recordLlmSpend, BudgetExceededError } from '@/lib/marketing/budget'
import { writeLedger } from '@/lib/marketing/graph'

export const dynamic = 'force-dynamic'

/**
 * Facebook-assist LLM node, Phase 3.
 *
 * Drafts a reply to an inbound Facebook comment/message the admin pastes in.
 * NEVER calls the Facebook Graph API — there is no write path to Facebook
 * anywhere in this route or anywhere in the codebase, by design (the plan's
 * hard constraint: "no FB write API, ever"). The draft lands as an
 * ALWAYS_ASK `marketing_tasks` row (task_type='fb_reply', pending_review);
 * the owner copies/pastes it into Facebook herself.
 *
 * Same budget + voice-profile pattern as generate-draft: check-before /
 * record-after LLM spend, and the active voice_profile row (if any) is
 * folded into the system prompt so the draft sounds like Allie.
 */

const COPY_ACTOR = 'COPY'

const MODEL = process.env.MARKETING_DRAFT_MODEL || 'claude-haiku-4-5-20251001'

const PRICING: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  'claude-haiku-4-5': { in: 1, out: 5 },
}

// A reply draft is small (~0.5k in / ~0.3k out) — reserve headroom similar in
// spirit to generate-draft but scaled down for the shorter output.
const ESTIMATED_USD = 0.02

const FB_REPLY_SYSTEM_PROMPT = `You are COPY, drafting a reply to a Facebook comment or message for Host Hampton — a boutique celebration studio in Speonk, NY run by Allie Larkin, serving the East End of Long Island (the Hamptons).

Write ONE short, warm reply in Allie's voice — never corporate, never pushy. Answer the question directly. If pricing is asked, give a real starting number with "depending on...". If you don't know a specific fact (exact date availability, a name), say so honestly rather than inventing it.

Respond ONLY with valid JSON — no markdown fences, no extra text.`

interface VoiceProfile {
  tone_rules?: string[]
  greeting?: string
  pricing_style?: string
  dos?: string[]
  donts?: string[]
  exemplars?: { context?: string; text: string }[]
}

async function loadVoiceProfile(supabase: ReturnType<typeof getSupabase>): Promise<VoiceProfile | null> {
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

function voicePromptAddendum(profile: VoiceProfile): string {
  const lines: string[] = ['', 'OPERATOR VOICE (match this — it is how Allie actually talks to customers):']
  if (profile.tone_rules?.length) {
    lines.push('Tone rules:')
    profile.tone_rules.forEach(r => lines.push(`- ${r}`))
  }
  if (profile.greeting) lines.push(`Greeting habit: ${profile.greeting}`)
  if (profile.pricing_style) lines.push(`Pricing style: ${profile.pricing_style}`)
  if (profile.exemplars?.length) {
    lines.push('Exemplars of her real voice (style anchors, not content to copy verbatim):')
    profile.exemplars.slice(0, 5).forEach(e => lines.push(`- ${e.context ? `[${e.context}] ` : ''}${e.text}`))
  }
  return lines.join('\n')
}

async function draftReply(
  inboundText: string,
  voiceProfile: VoiceProfile | null
): Promise<{ reply: string; inputTokens: number; outputTokens: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY as string
  const systemPrompt = voiceProfile ? FB_REPLY_SYSTEM_PROMPT + '\n' + voicePromptAddendum(voiceProfile) : FB_REPLY_SYSTEM_PROMPT

  const userPrompt = `Facebook comment/message to reply to:\n"""\n${inboundText}\n"""\n\nRespond with JSON exactly in this shape:\n{ "reply": "the drafted reply text" }`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: systemPrompt,
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

  const parsed = JSON.parse(jsonMatch[0]) as { reply: string }
  return {
    reply: parsed.reply,
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

  const body = (await req.json()) as { text?: string; source?: string }
  const inboundText = body.text?.trim()

  if (!inboundText) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured on the server' },
      { status: 503 }
    )
  }

  const supabase = getSupabase()

  try {
    await assertLlmBudget(supabase, {
      estimatedUsd: ESTIMATED_USD,
      actor: COPY_ACTOR,
      entityType: 'marketing_task',
    })
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json({ error: err.message }, { status: 402 })
    }
    throw err
  }

  const voiceProfile = await loadVoiceProfile(supabase)

  let generated
  try {
    generated = await draftReply(inboundText, voiceProfile)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'reply draft generation failed'
    console.error('fb-reply:', msg)
    return NextResponse.json({ error: 'Draft generation failed' }, { status: 502 })
  }

  const { reply, inputTokens, outputTokens } = generated

  // This row is DATA, not a status transition — inserted directly, landing as
  // pending_review. task_type='fb_reply' is ALWAYS_ASK: the owner copies the
  // drafted reply and pastes it into Facebook herself. No FB API call, ever.
  const { data: row, error: insErr } = await supabase
    .from('marketing_tasks')
    .insert({
      task_type: 'fb_reply',
      title: `FB reply draft: ${inboundText.slice(0, 60)}${inboundText.length > 60 ? '…' : ''}`,
      approval_tier: 'ALWAYS_ASK',
      status: 'pending_review',
      entity_type: 'fb_message',
      created_by: COPY_ACTOR,
      context: { inbound_text: inboundText, source: body.source || 'facebook', draft_reply: reply },
    })
    .select('id')
    .single()

  if (insErr || !row) {
    console.error('fb-reply insert error:', insErr?.message)
    return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 })
  }

  const usd = costUsd(MODEL, inputTokens, outputTokens)
  await recordLlmSpend(supabase, {
    usd,
    tokens: inputTokens + outputTokens,
    actor: COPY_ACTOR,
    entityType: 'marketing_task',
    entityId: row.id,
    meta: { model: MODEL, task_type: 'fb_reply', input_tokens: inputTokens, output_tokens: outputTokens },
  })

  await writeLedger(supabase, {
    entityType: 'marketing_task',
    entityId: row.id,
    action: 'note',
    actor: COPY_ACTOR,
    meta: { job: 'fb_reply_draft' },
  })

  return NextResponse.json({ ok: true, id: row.id, status: 'pending_review', reply, costUsd: usd, tokens: inputTokens + outputTokens })
}
