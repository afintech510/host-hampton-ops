/**
 * One visitor message in, one reply out.
 *
 * ── THE ORDER IS THE SAFETY ──
 *
 * Everything that can say "no" runs BEFORE a token is spent, cheapest first:
 *
 *   (the route, before this)  availability → rate limit → Origin → Turnstile (a new session)
 *   (here)                    turn / byte / per-chat caps → priced model →
 *                             daily USD cap → monthly budget → THEN the model
 *
 * and everything that reads what the model wrote runs before the visitor sees it
 * or the history stores it. A cap, a missing price or an unreadable ledger never
 * becomes an error page: it becomes a hand-off ("Text us"), because the visitor
 * came here to plan a party and a phone is always there.
 *
 * Failing to READ the day's spend is a hand-off too — "nothing spent today" is
 * the answer that turns a ceiling off (see agent-dispatch's spentTodayUsd).
 */

import { TENANT } from '@/tenant'
import { getSupabase } from '@/lib/supabase'
import { etToday } from '@/lib/bookingStatus'
import { runToolLoop, type LlmMessage, type LlmProvider } from '@/lib/ai/provider'
import { publicChatModel, selectProvider } from '@/lib/ai/select'
import { assertModelPriced, callUsd, UnpricedModelError } from '@/lib/ai/pricing'
import { assertLlmBudget, recordLlmSpend, BudgetExceededError } from '@/lib/marketing/budget'
import {
  CHAT_ENTITY, ESTIMATED_TURN_USD, MAX_HISTORY_BYTES, MAX_REPLY_TOKENS, MAX_SESSION_USD, MAX_TOOL_ITERATIONS,
  MAX_TURNS_PER_SESSION, dailyUsdCap,
} from '@/lib/chat/config'
import { CHAT_TOOLS, runChatTool, type ChatCard } from '@/lib/chat/tools'
import { chatSystemPrompt, fallbackReply } from '@/lib/chat/prompt'
import { allowedAmountsFrom, fenceVisitorText, screenReply, visitorTexts } from '@/lib/chat/text'
import { persistable, saveTurn, type ChatSession } from '@/lib/chat/session'

type Supa = ReturnType<typeof getSupabase>

export type HandoffReason =
  | 'turn_cap' | 'session_cap' | 'history_cap' | 'unpriced_model' | 'daily_cap' | 'budget' | 'unavailable' | 'provider'

export type TurnResult =
  | { kind: 'reply'; reply: string; cards: ChatCard[]; usd: number; held: boolean }
  /** The chat cannot (or should not) answer — the widget shows Text us / Call. */
  | { kind: 'handoff'; reason: HandoffReason; message: string }
  /** Another tab got there first. Nothing was stored; the visitor sends again. */
  | { kind: 'conflict'; message: string }

const handoff = (reason: HandoffReason, message?: string): TurnResult => ({
  kind: 'handoff',
  reason,
  message: message ?? `I'm not able to keep chatting right now. Tap Text us or Call below and ${TENANT.business.name} will help you directly.`,
})

/**
 * Today's spend by the public chat (UTC day), in USD. Null when it could not be read.
 * Counted by ENTITY, not by actor: the chat bills under one actor per session.
 */
export async function spentTodayUsd(supabase: Supa, now: Date = new Date()): Promise<number | null> {
  const start = new Date(now)
  start.setUTCHours(0, 0, 0, 0)
  const { data, error } = await supabase
    .from('marketing_ledger')
    .select('cost_usd')
    .eq('action', 'llm_call')
    .eq('entity_type', CHAT_ENTITY)
    .gte('created_at', start.toISOString())
  if (error || !data) {
    console.error('chat: could not read today’s spend:', error?.message ?? 'no data')
    return null
  }
  return data.reduce((sum, r) => sum + Number((r as { cost_usd: number | null }).cost_usd ?? 0), 0)
}

function endsWithAssistant(messages: LlmMessage[], text: string, replaceLast: boolean): LlmMessage[] {
  const out = [...messages]
  const block = { role: 'assistant' as const, content: [{ type: 'text' as const, text }] }
  const last = out[out.length - 1]
  if (last && last.role === 'assistant' && (replaceLast || typeof last.content === 'string')) out[out.length - 1] = block
  else if (!last || last.role !== 'assistant') out.push(block)
  return out
}

export async function runChatTurn(opts: {
  supabase: Supa
  req: Request
  session: ChatSession
  /** Already cleaned by cleanVisitorText. */
  userText: string
  provider?: LlmProvider
  env?: NodeJS.ProcessEnv
  now?: Date
}): Promise<TurnResult> {
  const { supabase, session } = opts
  const env = opts.env ?? process.env
  const now = opts.now ?? new Date()

  // ── caps that need no I/O ──
  if (session.turnCount >= MAX_TURNS_PER_SESSION) return handoff('turn_cap', `We've covered a lot! To keep going, tap Text us or Call below and ${TENANT.business.name} will pick it up from here.`)
  if (session.spentUsd >= MAX_SESSION_USD) return handoff('session_cap')
  if (JSON.stringify(session.messages).length > MAX_HISTORY_BYTES) return handoff('history_cap', `This chat has gotten long. Tap Text us or Call below, or refresh to start a new chat.`)

  // ── an unpriced model is refused before a token is spent ──
  const model = publicChatModel(env)
  try {
    assertModelPriced(model, env)
  } catch (err) {
    if (err instanceof UnpricedModelError) {
      console.error(`chat: refusing — ${err.message}`)
      return handoff('unpriced_model')
    }
    throw err
  }

  // ── the daily ceiling, then the monthly budget ──
  const spent = await spentTodayUsd(supabase, now)
  if (spent === null) return handoff('unavailable')
  if (spent + ESTIMATED_TURN_USD > dailyUsdCap(env)) {
    console.warn(`chat: daily cap reached ($${spent.toFixed(2)} of $${dailyUsdCap(env).toFixed(2)}) — handing off`)
    return handoff('daily_cap')
  }
  const actor = `chat:${session.id.slice(0, 8)}`
  try {
    await assertLlmBudget(supabase, { estimatedUsd: ESTIMATED_TURN_USD, actor, entityType: CHAT_ENTITY, entityId: session.id })
  } catch (err) {
    if (err instanceof BudgetExceededError) return handoff('budget')
    console.error('chat: could not read the LLM budget — handing off:', err instanceof Error ? err.message : err)
    return handoff('unavailable')
  }

  // ── the model ──
  const cards: ChatCard[] = []
  let usd = 0
  const visitorSaid = [...visitorTexts(session.messages), opts.userText]
  let loop
  try {
    loop = await runToolLoop({
      provider: opts.provider ?? selectProvider(env),
      model,
      system: chatSystemPrompt(etToday(now), { bookingRef: session.bookingRef, inquirySent: !!session.inquirySentAt }),
      history: session.messages,
      userText: fenceVisitorText(opts.userText),
      tools: CHAT_TOOLS,
      maxIterations: MAX_TOOL_ITERATIONS,
      maxTokens: MAX_REPLY_TOKENS,
      maxToolResultChars: 12_000,
      // Spend is recorded on EVERY call: a turn that dies on iteration 4 still spent 1-3.
      async onCall(call) {
        const cost = callUsd(model, call.usage.inputTokens, call.usage.outputTokens, env)
        usd += cost
        await recordLlmSpend(supabase, {
          usd: cost,
          tokens: Math.round(call.usage.inputTokens + call.usage.outputTokens),
          actor,
          entityType: CHAT_ENTITY,
          entityId: session.id,
          meta: { model: call.model, input_tokens: call.usage.inputTokens, output_tokens: call.usage.outputTokens },
        }).catch(err => console.error('chat: recordLlmSpend failed', err))
      },
      runTool: (name, input) => runChatTool(name, input, { supabase, req: opts.req, sessionId: session.id, visitorSaid, cards, now }),
    })
  } catch (err) {
    console.error('chat: the model call failed:', err instanceof Error ? err.message : err)
    return handoff('provider')
  }

  // ── what the model said is checked before anyone reads or stores it ──
  const screen = screenReply(loop.reply, allowedAmountsFrom(loop.messages))
  let reply = loop.reply
  if (!screen.ok) {
    console.warn(`chat: held a reply for session ${session.id.slice(0, 8)} — ${screen.reason}`)
    reply = fallbackReply()
  }
  const stored = persistable(endsWithAssistant(loop.messages, reply, !screen.ok))

  const saved = await saveTurn(supabase, session, { messages: stored, spentUsd: usd })
  if (saved === 'conflict') return { kind: 'conflict', message: 'I got two messages at once. Please send that again.' }
  if (saved === 'failed') return handoff('unavailable')

  return { kind: 'reply', reply, cards, usd, held: !screen.ok }
}
