import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { guardRate, HOUR_MS } from '@/lib/rateLimit'
import { featureEnabled } from '@/tenant'
import { getSupabase } from '@/lib/supabase'
import { runAssistantTurn, screenHistory } from '@/lib/assistant/run'
import { contextKey, screenContext } from '@/lib/assistant/context'
import { expireStaleCards, readThread, writeThread, type ThreadCard, type ThreadLine } from '@/lib/assistant/threads'
import { providerConfigured, providerName } from '@/lib/ai/select'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/admin/assistant — one turn of the Manager chat.
 *
 * Body: `{ text: string, context?: { page, booking_ref } }`. The CONVERSATION is
 * held by the server (lib/assistant/threads.ts, one thread per admin per
 * context), so the browser sends a message, not a history. Returns
 * `{ reply, proposals, saved }`. A proposal is a card with a signed token;
 * nothing in this route writes to a booking, a contact or Stripe.
 *
 * Not streamed: the provider seam (lib/ai/provider.ts) returns whole completions,
 * and token streaming would mean rewriting both adapters and the tool loop. The
 * UI shows a typing indicator instead.
 */
const assistantRule = { route: 'admin/assistant', perCaller: 120, perRoute: 600, windowMs: HOUR_MS }

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  if (!featureEnabled('managerAssistant')) {
    return NextResponse.json({ error: 'The Manager assistant is not enabled on this site.' }, { status: 404 })
  }
  const limited = guardRate(req, assistantRule)
  if (limited) return limited
  if (!providerConfigured()) {
    return NextResponse.json({ error: providerName() === 'openai' ? 'OPENAI_API_KEY is not configured.' : 'ANTHROPIC_API_KEY is not configured.' }, { status: 503 })
  }

  const body = (await req.json().catch(() => null)) as { text?: unknown; context?: unknown } | null
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 4000) : ''
  if (!text) return NextResponse.json({ error: 'Type a message.' }, { status: 400 })

  const actor = adminActorId(req)
  const context = screenContext(body?.context)
  const key = contextKey(context)
  const supabase = getSupabase()

  const read = await readThread(supabase, actor, key)
  if (read.kind !== 'ok') {
    return NextResponse.json({ error: 'Could not load this conversation — try again.' }, { status: 503 })
  }
  const history = screenHistory(read.thread?.messages ?? [])
  if (!history.ok) return NextResponse.json({ error: history.reason }, { status: 400 })

  try {
    const turn = await runAssistantTurn({ history: history.messages, userText: text, actor, context })

    const cards: ThreadCard[] = turn.proposals.map(p => ({ ...p, state: 'pending' }))
    const lines: ThreadLine[] = [
      ...expireStaleCards(read.thread?.lines ?? []),
      { role: 'user', text },
      { role: 'assistant', text: turn.reply, cards },
    ]
    const saved = await writeThread(supabase, actor, key, context.bookingRef, turn.messages, lines)

    return NextResponse.json({ reply: turn.reply, proposals: cards, saved })
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'The AI service is busy — try again in a minute.' }, { status: 503 })
    }
    if (err instanceof Anthropic.APIError) {
      console.error('assistant: Anthropic API error', err.status, err.message)
      return NextResponse.json({ error: `The AI service returned an error (${err.status ?? 'network'}).` }, { status: 502 })
    }
    console.error('assistant: turn failed', err)
    return NextResponse.json({ error: 'Something went wrong — try again.' }, { status: 500 })
  }
}
