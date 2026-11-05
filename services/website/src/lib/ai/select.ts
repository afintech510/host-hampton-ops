import { anthropicProvider } from '@/lib/ai/anthropicProvider'
import { openaiProvider } from '@/lib/ai/openaiProvider'
import type { LlmProvider } from '@/lib/ai/provider'

/**
 * Which provider and model an AI surface runs on.
 *
 * `ASSISTANT_PROVIDER` is `anthropic` (default) or `openai`; ANYTHING else reads
 * as anthropic, so a typo cannot switch the assistant onto an unconfigured
 * provider. `ASSISTANT_MODEL` names the model for the manager surfaces;
 * `PUBLIC_CHAT_MODEL` for the website chat. The default is Sonnet, not Opus
 * (Adam, 2026-11-04): the manager surfaces are lookups and card-building, and
 * Sonnet 5.5 is $2/$10 per MTok.
 */

export const DEFAULT_ASSISTANT_MODEL = 'claude-sonnet-5-5'

export type ProviderName = 'anthropic' | 'openai'

export function providerName(env: NodeJS.ProcessEnv = process.env): ProviderName {
  return (env.ASSISTANT_PROVIDER || '').trim().toLowerCase() === 'openai' ? 'openai' : 'anthropic'
}

export function assistantModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.ASSISTANT_MODEL?.trim() || DEFAULT_ASSISTANT_MODEL
}

export function publicChatModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.PUBLIC_CHAT_MODEL?.trim() || DEFAULT_ASSISTANT_MODEL
}

/** Is the key for the selected provider present? (Checked before a turn, so the UI says so rather than 500s.) */
export function providerConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return providerName(env) === 'openai' ? !!env.OPENAI_API_KEY : !!env.ANTHROPIC_API_KEY
}

export function selectProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  return providerName(env) === 'openai' ? openaiProvider() : anthropicProvider()
}
