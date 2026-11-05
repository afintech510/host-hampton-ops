import type { LlmBlock, LlmCall, LlmMessage, LlmProvider, LlmRequest, LlmStop, LlmTool } from '@/lib/ai/provider'

/**
 * The OpenAI adapter (Chat Completions with function tools), over plain
 * `fetch` so there is no SDK to carry. Selected by `ASSISTANT_PROVIDER=openai`
 * with `ASSISTANT_MODEL` naming the model; `OPENAI_API_KEY` is read at call
 * time. The model must be priced (lib/ai/pricing.ts) or the loop refuses
 * before calling this.
 *
 * The neutral history is Anthropic-shaped, so this converts at the edge:
 *   assistant tool_use blocks   → `tool_calls`
 *   user tool_result blocks     → one `role: 'tool'` message each
 *   anything else a provider    → dropped (OpenAI has no thinking blocks to replay)
 *   round-tripped opaquely
 */

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>

interface OaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

const ENDPOINT = 'https://api.openai.com/v1/chat/completions'

export function toOpenAiMessages(system: string, messages: LlmMessage[]): OaMessage[] {
  const out: OaMessage[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content })
      continue
    }
    if (m.role === 'assistant') {
      const text = m.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n')
      const calls = m.content.filter((b): b is Extract<LlmBlock, { type: 'tool_use' }> => b.type === 'tool_use')
        .map(b => ({ id: b.id, type: 'function' as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }))
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) })
      continue
    }
    for (const b of m.content) {
      if (b.type === 'tool_result') {
        const r = b as Extract<LlmBlock, { type: 'tool_result' }>
        out.push({ role: 'tool', tool_call_id: r.tool_use_id, content: r.content })
      } else if (b.type === 'text') {
        out.push({ role: 'user', content: (b as { text: string }).text })
      }
    }
  }
  return out
}

export function toOpenAiTools(tools: LlmTool[]) {
  return tools.map(t => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.input_schema } }))
}

function stopFrom(reason: string | null | undefined, hasCalls: boolean): LlmStop {
  if (hasCalls || reason === 'tool_calls') return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  if (reason === 'content_filter') return 'refusal'
  return 'end'
}

export function openaiProvider(opts: { apiKey?: string; fetchImpl?: FetchLike } = {}): LlmProvider {
  return {
    name: 'openai',
    async complete(req: LlmRequest): Promise<LlmCall> {
      const key = opts.apiKey ?? process.env.OPENAI_API_KEY
      if (!key) throw new Error('OPENAI_API_KEY is not configured.')
      const doFetch = opts.fetchImpl ?? (fetch as unknown as FetchLike)
      const res = await doFetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: req.model,
          messages: toOpenAiMessages(req.system, req.messages),
          ...(req.tools.length ? { tools: toOpenAiTools(req.tools) } : {}),
          max_completion_tokens: req.maxTokens ?? 16000,
        }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`OpenAI returned ${res.status}: ${text.slice(0, 200)}`)
      }
      const data = (await res.json()) as {
        model?: string
        choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }
      }
      const choice = data.choices?.[0]
      if (!choice?.message) throw new Error('OpenAI returned no choice')
      const blocks: LlmBlock[] = []
      if (choice.message.content) blocks.push({ type: 'text', text: choice.message.content })
      if (choice.message.refusal) blocks.push({ type: 'text', text: choice.message.refusal })
      for (const c of choice.message.tool_calls ?? []) {
        let input: unknown = {}
        try { input = JSON.parse(c.function.arguments || '{}') } catch { input = {} }
        blocks.push({ type: 'tool_use', id: c.id, name: c.function.name, input })
      }
      const prompt = data.usage?.prompt_tokens ?? 0
      const cached = data.usage?.prompt_tokens_details?.cached_tokens ?? 0
      return {
        blocks,
        stop: choice.message.refusal ? 'refusal' : stopFrom(choice.finish_reason, (choice.message.tool_calls ?? []).length > 0),
        // Cached prompt tokens bill at a fraction; weight them like the Anthropic adapter does.
        usage: { inputTokens: prompt - cached + cached * 0.1, outputTokens: data.usage?.completion_tokens ?? 0 },
        model: data.model ?? req.model,
      }
    },
  }
}
