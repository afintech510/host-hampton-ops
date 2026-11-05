import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { callerKey, guardRate, chatRule, chatStartRule } from '@/lib/rateLimit'
import { originAllowed } from '@/lib/evites/rsvpHttp'
import { chatAvailability, turnstileConfigured } from '@/lib/chat/config'
import { verifyTurnstile } from '@/lib/chat/turnstile'
import { callerHash, createSession, loadSession, signSessionToken, verifySessionToken, type ChatSession } from '@/lib/chat/session'
import { cleanVisitorText } from '@/lib/chat/text'
import { runChatTurn } from '@/lib/chat/run'

export const dynamic = 'force-dynamic'

/**
 * `POST /api/chat` — one message to the website Host Assistant.
 *
 * Public by design: the caller is a visitor to the marketing site. Everything that
 * can refuse does so BEFORE the model is touched, in this order, and the order is
 * pinned by chatSurface.test.ts:
 *
 *   1. availability   — off unless PUBLIC_CHAT_ENABLED is exactly `true`, and in
 *                       production only with Turnstile + a provider key configured
 *   2. rate limit     — per caller and per route, before the first await
 *   3. Origin         — a browser on one of our own hosts
 *   4. the session    — an existing one (signed token, server-side history), or a
 *                       NEW one, which costs a stricter rate bucket AND a
 *                       Turnstile verification on this, its first message
 *   5. run the turn   — caps, priced model, daily USD cap, monthly budget, model,
 *                       then the reply screen (lib/chat/run.ts)
 *
 * It answers JSON, not a stream: the provider seam (lib/ai/provider.ts) is
 * request/response, and a reply is a few sentences. The widget shows a typing
 * indicator while it waits.
 *
 * The browser sends ONLY the new message and the signed session token. It never
 * sends history, a role, a tool result or a price.
 */

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status })
}

const OFF = { error: 'The chat is not available right now.', handoff: true }

function pathOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const p = raw.split('?')[0].split('#')[0].slice(0, 200)
  return p.startsWith('/') && !p.startsWith('//') ? p : null
}

export async function POST(req: NextRequest) {
  const available = chatAvailability()
  if (!available.ok) return json(OFF, 404)

  const limited = guardRate(req, chatRule())
  if (limited) return limited

  if (!originAllowed(req)) return json({ error: 'Forbidden' }, 403)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Bad request' }, 400)
  }
  const text = cleanVisitorText(body?.message)
  if (!text) return json({ error: 'Type a message first.' }, 400)

  const supabase = getSupabase()
  const { key } = callerKey(req)
  let session: ChatSession

  if (body.sessionToken !== undefined && body.sessionToken !== null && body.sessionToken !== '') {
    const id = verifySessionToken(body.sessionToken)
    if (!id) return json({ error: 'This chat has ended. Starting a new one.', restart: true }, 401)
    const loaded = await loadSession(supabase, id)
    if (loaded.kind === 'unavailable') {
      console.error('chat: session unreadable:', loaded.error)
      return json({ ...OFF }, 503)
    }
    if (loaded.kind === 'missing') return json({ error: 'This chat has ended. Starting a new one.', restart: true }, 410)
    session = loaded.session
    // A session without a passed challenge exists only outside production; refuse it there.
    if (!session.verified && turnstileConfigured()) return json({ error: 'Forbidden' }, 403)
  } else {
    // A NEW session: its own, tighter, bucket — and Turnstile, before the row or the model.
    const startLimited = guardRate(req, chatStartRule())
    if (startLimited) return startLimited

    const challenge = await verifyTurnstile(body.turnstileToken, key)
    if (challenge === 'failed') {
      return json({ error: 'We could not verify that you are a person. Please refresh and try again, or text us.', verification: true }, 403)
    }
    // `unconfigured` reaches here only outside production (chatAvailability keeps the chat off otherwise).
    const created = await createSession(supabase, { callerHash: callerHash(key), pagePath: pathOf(body.path), verified: challenge === 'ok' })
    if (created.kind !== 'created') {
      console.error('chat: could not create a session:', created.error)
      return json({ ...OFF }, 503)
    }
    session = created.session
  }

  const turn = await runChatTurn({ supabase, req, session, userText: text })
  const sessionToken = signSessionToken(session.id)

  if (turn.kind === 'conflict') return json({ error: turn.message, sessionToken }, 409)
  if (turn.kind === 'handoff') return json({ sessionToken, reply: turn.message, cards: [], handoff: true, reason: turn.reason })
  return json({ sessionToken, reply: turn.reply, cards: turn.cards, handoff: false, held: turn.held })
}
