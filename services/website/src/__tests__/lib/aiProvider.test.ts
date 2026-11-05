/**
 * The provider seam (lib/ai/*): the tool loop, the OpenAI conversion, and the
 * refusal to price an unknown model.
 */
import fs from 'fs'
import path from 'path'
import { runToolLoop, type LlmCall, type LlmProvider, type LlmRequest } from '@/lib/ai/provider'
import { openaiProvider, toOpenAiMessages, toOpenAiTools } from '@/lib/ai/openaiProvider'
import { assertModelPriced, callUsd, priceFor, UnpricedModelError } from '@/lib/ai/pricing'
import { assistantModel, providerConfigured, providerName, publicChatModel } from '@/lib/ai/select'

const usage = { inputTokens: 1000, outputTokens: 100 }
const scripted = (calls: LlmCall[]): LlmProvider & { seen: LlmRequest[] } => {
  const seen: LlmRequest[] = []
  return { name: 'anthropic', seen, async complete(req) { seen.push(JSON.parse(JSON.stringify(req))); return calls.shift() as LlmCall } }
}
const tools = [{ name: 'get_pricing', description: 'd', input_schema: { type: 'object' as const, properties: {} } }]

describe('runToolLoop', () => {
  it('runs a tool, sends ALL results back in one user message, and ends on a text answer', async () => {
    const p = scripted([
      { stop: 'tool_use', model: 'm', usage, blocks: [
        { type: 'text', text: 'checking' },
        { type: 'tool_use', id: 'a', name: 'get_pricing', input: {} },
        { type: 'tool_use', id: 'b', name: 'get_pricing', input: { x: 1 } },
      ] },
      { stop: 'end', model: 'm', usage, blocks: [{ type: 'text', text: 'It is $850.' }] },
    ])
    const ran: string[] = []
    const calls: number[] = []
    const out = await runToolLoop({
      provider: p, model: 'm', system: 's', history: [], userText: 'price?', tools,
      onCall: () => { calls.push(1) },
      runTool: async (n, i) => { ran.push(`${n}:${JSON.stringify(i)}`); return { result: { ok: true } } },
    })
    expect(out.reply).toBe('It is $850.')
    expect(out.ended).toBe('end')
    expect(ran).toHaveLength(2)
    expect(calls).toHaveLength(2) // spend is reported per CALL
    const results = p.seen[1].messages[p.seen[1].messages.length - 1]
    expect(results.role).toBe('user')
    expect((results.content as unknown[]).length).toBe(2)
  })

  it('a throwing tool becomes an error result, not a crashed turn', async () => {
    const p = scripted([
      { stop: 'tool_use', model: 'm', usage, blocks: [{ type: 'tool_use', id: 'a', name: 'get_pricing', input: {} }] },
      { stop: 'end', model: 'm', usage, blocks: [{ type: 'text', text: 'sorry' }] },
    ])
    const out = await runToolLoop({ provider: p, model: 'm', system: 's', history: [], userText: 'x', tools, runTool: async () => { throw new Error('boom') } })
    expect(out.reply).toBe('sorry')
    const block = (p.seen[1].messages[2].content as { is_error?: boolean; content: string }[])[0]
    expect(block.is_error).toBe(true)
    expect(block.content).toContain('boom')
  })

  it('stops at the iteration cap and says so', async () => {
    const loopCall: LlmCall = { stop: 'tool_use', model: 'm', usage, blocks: [{ type: 'tool_use', id: 'a', name: 'get_pricing', input: {} }] }
    const p = scripted(Array.from({ length: 3 }, () => loopCall))
    const out = await runToolLoop({ provider: p, model: 'm', system: 's', history: [], userText: 'x', tools, maxIterations: 3, runTool: async () => ({ result: 1 }) })
    expect(out.ended).toBe('iteration_cap')
    expect(out.reply).toMatch(/keep going/)
  })

  it('refusal and max_tokens end the turn with their own words', async () => {
    const r = await runToolLoop({ provider: scripted([{ stop: 'refusal', model: 'm', usage, blocks: [] }]), model: 'm', system: 's', history: [], userText: 'x', tools, runTool: async () => ({ result: 1 }) })
    expect(r.ended).toBe('refusal')
    const t = await runToolLoop({ provider: scripted([{ stop: 'max_tokens', model: 'm', usage, blocks: [{ type: 'text', text: 'part' }] }]), model: 'm', system: 's', history: [], userText: 'x', tools, runTool: async () => ({ result: 1 }) })
    expect(t.ended).toBe('max_tokens')
    expect(t.reply).toMatch(/^part/)
  })

  it('clips a huge tool result', async () => {
    const p = scripted([
      { stop: 'tool_use', model: 'm', usage, blocks: [{ type: 'tool_use', id: 'a', name: 'get_pricing', input: {} }] },
      { stop: 'end', model: 'm', usage, blocks: [{ type: 'text', text: 'ok' }] },
    ])
    await runToolLoop({ provider: p, model: 'm', system: 's', history: [], userText: 'x', tools, maxToolResultChars: 50, runTool: async () => ({ result: 'x'.repeat(500) }) })
    const c = (p.seen[1].messages[2].content as { content: string }[])[0].content
    expect(c.length).toBeLessThan(100)
    expect(c).toMatch(/truncated/)
  })
})

describe('the OpenAI adapter', () => {
  it('converts Anthropic-shaped history: tool_use → tool_calls, tool_result → role tool', () => {
    const msgs = toOpenAiMessages('SYS', [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'looking' }, { type: 'tool_use', id: 'c1', name: 'get_pricing', input: { a: 1 } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"ok":1}' }] },
    ])
    expect(msgs[0]).toEqual({ role: 'system', content: 'SYS' })
    expect(msgs[2]).toEqual({ role: 'assistant', content: 'looking', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_pricing', arguments: '{"a":1}' } }] })
    expect(msgs[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '{"ok":1}' })
    expect(JSON.stringify(msgs)).not.toContain('thinking')
    expect(toOpenAiTools(tools)[0]).toEqual({ type: 'function', function: { name: 'get_pricing', description: 'd', parameters: tools[0].input_schema } })
  })

  it('maps a tool-calling response and weights cached tokens, with a fake fetch', async () => {
    const bodies: unknown[] = []
    const p = openaiProvider({
      apiKey: 'k',
      fetchImpl: async (_u, init) => {
        bodies.push(JSON.parse(init.body))
        return { ok: true, status: 200, text: async () => '', json: async () => ({
          model: 'gpt-x',
          choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'get_pricing', arguments: '{"a":2}' } }] } }],
          usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 500 } },
        }) }
      },
    })
    const r = await p.complete({ model: 'gpt-x', system: 's', messages: [{ role: 'user', content: 'q' }], tools })
    expect(r.stop).toBe('tool_use')
    expect(r.blocks).toEqual([{ type: 'tool_use', id: 'c1', name: 'get_pricing', input: { a: 2 } }])
    expect(r.usage).toEqual({ inputTokens: 550, outputTokens: 50 })
    expect(r.model).toBe('gpt-x')
    expect((bodies[0] as { tools: unknown[] }).tools).toHaveLength(1)
  })

  it('an HTTP error throws with the status, a missing key throws, bad tool JSON becomes {}', async () => {
    await expect(openaiProvider({ apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 429, text: async () => 'slow down', json: async () => ({}) }) })
      .complete({ model: 'm', system: 's', messages: [], tools: [] })).rejects.toThrow(/429/)
    const prev = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    await expect(openaiProvider().complete({ model: 'm', system: 's', messages: [], tools: [] })).rejects.toThrow(/OPENAI_API_KEY/)
    if (prev) process.env.OPENAI_API_KEY = prev
    const r = await openaiProvider({ apiKey: 'k', fetchImpl: async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({
      choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'c', function: { name: 'n', arguments: '{oops' } }] } }] }) }) })
      .complete({ model: 'm', system: 's', messages: [], tools: [] })
    expect(r.blocks).toEqual([{ type: 'tool_use', id: 'c', name: 'n', input: {} }])
  })
})

describe('pricing fails closed', () => {
  it('knows the Anthropic models and REFUSES an unknown one', () => {
    expect(priceFor('claude-sonnet-5-5', {})).toEqual({ in: 2, out: 10 })
    expect(priceFor('gpt-mystery', {})).toBeNull()
    expect(() => assertModelPriced('gpt-mystery', {})).toThrow(UnpricedModelError)
    expect(() => callUsd('gpt-mystery', 1000, 1000, {})).toThrow(UnpricedModelError)
  })

  it('an env price makes a model usable, but only if BOTH halves are positive numbers', () => {
    expect(callUsd('gpt-mystery', 1_000_000, 1_000_000, { ASSISTANT_PRICE_IN_PER_MTOK: '1.5', ASSISTANT_PRICE_OUT_PER_MTOK: '6' } as never)).toBeCloseTo(7.5)
    for (const env of [{ ASSISTANT_PRICE_IN_PER_MTOK: '1.5' }, { ASSISTANT_PRICE_IN_PER_MTOK: '0', ASSISTANT_PRICE_OUT_PER_MTOK: '6' }, { ASSISTANT_PRICE_IN_PER_MTOK: 'abc', ASSISTANT_PRICE_OUT_PER_MTOK: '6' }, { ASSISTANT_PRICE_IN_PER_MTOK: '-1', ASSISTANT_PRICE_OUT_PER_MTOK: '6' }]) {
      expect(priceFor('gpt-mystery', env as never)).toBeNull()
    }
  })

  it('the manager assistant refuses before spending when its model is unpriced (source order)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'assistant', 'run.ts'), 'utf8').replace(/\r\n/g, '\n')
    const body = src.slice(src.indexOf('export async function runAssistantTurn'))
    expect(body.indexOf('assertModelPriced(model)')).toBeGreaterThan(-1)
    expect(body.indexOf('assertModelPriced(model)')).toBeLessThan(body.indexOf('assertLlmBudget('))
    expect(body.indexOf('assertLlmBudget(')).toBeLessThan(body.indexOf('runToolLoop('))
  })
})

describe('selection', () => {
  it('defaults to Anthropic + Sonnet; a typo cannot select an unconfigured provider', () => {
    expect(providerName({} as never)).toBe('anthropic')
    expect(providerName({ ASSISTANT_PROVIDER: 'opnai' } as never)).toBe('anthropic')
    expect(providerName({ ASSISTANT_PROVIDER: ' OpenAI ' } as never)).toBe('openai')
    expect(assistantModel({} as never)).toBe('claude-sonnet-5-5')
    expect(publicChatModel({ PUBLIC_CHAT_MODEL: 'x' } as never)).toBe('x')
    expect(providerConfigured({ ASSISTANT_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'a' } as never)).toBe(false)
    expect(providerConfigured({ ASSISTANT_PROVIDER: 'openai', OPENAI_API_KEY: 'o' } as never)).toBe(true)
  })
})
