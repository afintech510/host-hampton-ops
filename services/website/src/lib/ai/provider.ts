/**
 * The model-provider seam for every AI surface that runs a tool loop (the
 * manager assistant today; the website Host Assistant and the admin overlay
 * next). One interface, two adapters (Anthropic, OpenAI), one loop.
 *
 * The safety model does not depend on the provider: no model ever writes. A
 * `propose_*` tool returns a signed card and a human click replays the admin
 * route (lib/assistant/execute.ts). Swapping the model swaps the voice, never
 * the authority.
 *
 * The neutral content blocks ARE Anthropic's block shapes (text / tool_use /
 * tool_result). The browser holds the conversation and sends it back each
 * turn, so keeping that shape means the history format did not change when
 * this seam was introduced; the OpenAI adapter converts at its edge.
 */

export interface LlmTool {
  name: string
  description: string
  input_schema: { type: 'object'; properties?: Record<string, unknown>; required?: string[]; [k: string]: unknown }
}

export type LlmBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  // Anything else an adapter round-trips opaquely (e.g. Anthropic thinking blocks).
  | { type: string; [k: string]: unknown }

export interface LlmMessage {
  role: 'user' | 'assistant'
  content: string | LlmBlock[]
}

export type LlmStop = 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'pause'

export interface LlmUsage {
  /** Fresh input tokens, plus cache-write tokens at 1.25x and cache-read at 0.1x, already weighted. */
  inputTokens: number
  outputTokens: number
}

export interface LlmCall {
  blocks: LlmBlock[]
  stop: LlmStop
  usage: LlmUsage
  /** The model that actually answered (a fallback may differ from the one asked for). */
  model: string
}

export interface LlmRequest {
  model: string
  system: string
  messages: LlmMessage[]
  tools: LlmTool[]
  maxTokens?: number
}

export interface LlmProvider {
  readonly name: 'anthropic' | 'openai'
  complete(req: LlmRequest): Promise<LlmCall>
}

export interface ToolRunResult {
  /** JSON-serialisable result handed back to the model. */
  result: unknown
  isError?: boolean
}

export interface ToolLoopOptions {
  provider: LlmProvider
  model: string
  system: string
  history: LlmMessage[]
  userText: string
  tools: LlmTool[]
  runTool(name: string, input: unknown): Promise<ToolRunResult>
  /** Called after EVERY model call, so a turn that dies on iteration 5 still records iterations 1-4. */
  onCall?(call: LlmCall): Promise<void> | void
  maxIterations?: number
  maxTokens?: number
  maxToolResultChars?: number
}

export interface ToolLoopResult {
  messages: LlmMessage[]
  reply: string
  /** Why the loop ended, in the words the UI may want. */
  ended: 'end' | 'refusal' | 'max_tokens' | 'iteration_cap'
}

const DEFAULT_MAX_ITERATIONS = 8
const DEFAULT_MAX_RESULT = 30_000

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}… [truncated]` : s
}

export async function runToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  const max = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS
  const clipAt = opts.maxToolResultChars ?? DEFAULT_MAX_RESULT
  const messages: LlmMessage[] = [...opts.history, { role: 'user', content: opts.userText }]
  let reply = ''

  for (let i = 0; i < max; i++) {
    const call = await opts.provider.complete({
      model: opts.model, system: opts.system, messages, tools: opts.tools, maxTokens: opts.maxTokens,
    })
    if (opts.onCall) await opts.onCall(call)

    messages.push({ role: 'assistant', content: call.blocks })
    const text = call.blocks
      .filter((b): b is Extract<LlmBlock, { type: 'text' }> => b.type === 'text' && typeof (b as { text?: unknown }).text === 'string')
      .map(b => b.text).join('\n').trim()
    if (text) reply = text

    if (call.stop === 'refusal') return { messages, reply: reply || "I can't help with that one.", ended: 'refusal' }
    if (call.stop === 'pause') continue
    if (call.stop === 'max_tokens') {
      return { messages, reply: `${reply}\n\n(My reply was cut off — ask me to continue.)`.trim(), ended: 'max_tokens' }
    }
    if (call.stop !== 'tool_use') return { messages, reply: reply || 'Done.', ended: 'end' }

    const uses = call.blocks.filter((b): b is Extract<LlmBlock, { type: 'tool_use' }> => b.type === 'tool_use')
    if (uses.length === 0) return { messages, reply: reply || 'Done.', ended: 'end' }

    // Every tool_result for this turn goes back in ONE user message.
    const results = await Promise.all(uses.map(async (u): Promise<LlmBlock> => {
      let out: ToolRunResult
      try {
        out = await opts.runTool(u.name, u.input)
      } catch (e) {
        out = { result: { error: e instanceof Error ? e.message : 'tool failed' }, isError: true }
      }
      return {
        type: 'tool_result', tool_use_id: u.id, content: clip(JSON.stringify(out.result), clipAt),
        ...(out.isError ? { is_error: true } : {}),
      }
    }))
    messages.push({ role: 'user', content: results })
    if (i === max - 1) {
      return { messages, reply: `${reply}\n\n(I stopped after several lookups — ask me to keep going.)`.trim(), ended: 'iteration_cap' }
    }
  }
  return { messages, reply: reply || 'Done.', ended: 'end' }
}
