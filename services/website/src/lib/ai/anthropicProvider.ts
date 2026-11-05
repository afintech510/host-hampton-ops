import Anthropic from '@anthropic-ai/sdk'
import type { LlmBlock, LlmCall, LlmProvider, LlmRequest, LlmStop } from '@/lib/ai/provider'

/**
 * The Anthropic adapter: the call the manager assistant has always made —
 * adaptive thinking, medium effort, automatic prompt caching, and a server-side
 * fallback so a refusal is routed rather than silently ending the turn.
 */

type BetaClient = Pick<Anthropic, 'beta'>

function stopFrom(reason: string | null | undefined): LlmStop {
  switch (reason) {
    case 'tool_use': return 'tool_use'
    case 'refusal': return 'refusal'
    case 'pause_turn': return 'pause'
    case 'max_tokens': return 'max_tokens'
    default: return 'end'
  }
}

export function anthropicProvider(client: BetaClient = new Anthropic()): LlmProvider {
  return {
    name: 'anthropic',
    async complete(req: LlmRequest): Promise<LlmCall> {
      const response = await client.beta.messages.create({
        model: req.model,
        max_tokens: req.maxTokens ?? 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        cache_control: { type: 'ephemeral' },
        system: req.system,
        tools: req.tools as unknown as Anthropic.Beta.BetaTool[],
        messages: req.messages as unknown as Anthropic.Beta.BetaMessageParam[],
      })
      const u = response.usage
      return {
        blocks: response.content as unknown as LlmBlock[],
        stop: stopFrom(response.stop_reason),
        usage: {
          inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1,
          outputTokens: u.output_tokens ?? 0,
        },
        model: response.model,
      }
    },
  }
}
