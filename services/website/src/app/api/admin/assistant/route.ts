import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { guardRate, HOUR_MS } from '@/lib/rateLimit'
import { featureEnabled } from '@/tenant'
import { runAssistantTurn, screenHistory } from '@/lib/assistant/run'
import { providerConfigured, providerName } from '@/lib/ai/select'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/admin/assistant — one turn of the Manager chat.
 *
 * Body: `{ messages?: <the history this route returned last time>, text: string }`.
 * Returns `{ messages, reply, proposals }`. A proposal is a card with a signed
 * token; nothing in this route writes to a booking, a contact or Stripe.
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

  const body = (await req.json().catch(() => null)) as { messages?: unknown; text?: unknown } | null
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 4000) : ''
  if (!text) return NextResponse.json({ error: 'Type a message.' }, { status: 400 })
  const history = screenHistory(body?.messages)
  if (!history.ok) return NextResponse.json({ error: history.reason }, { status: 400 })

  try {
    const turn = await runAssistantTurn({ history: history.messages, userText: text, actor: adminActorId(req) })
    return NextResponse.json({ messages: turn.messages, reply: turn.reply, proposals: turn.proposals })
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
