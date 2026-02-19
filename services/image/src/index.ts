import 'dotenv/config'
import Redis from 'ioredis'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { ImageTaskInput, ImageTaskOutput, TaskManifest } from './types.js'

const required = [
  'ANTHROPIC_API_KEY',
  'REPLICATE_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'REDIS_URL'
]

for (const key of required) {
  if (!process.env[key]) {
    console.error(`[IMAGE] Missing required env var: ${key}`)
    process.exit(1)
  }
}

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const subscriber = new Redis(process.env.REDIS_URL!)
const publisher = new Redis(process.env.REDIS_URL!)

subscriber.on('error', (err) => console.error('[IMAGE] Redis subscriber error:', err))
publisher.on('error', (err) => console.error('[IMAGE] Redis publisher error:', err))

const CHANNEL = 'hampton:agent:image'
const COMPLETE_CHANNEL = 'hampton:task_complete'
const REPLICATE_MODEL = 'black-forest-labs/flux-schnell'

const IMAGE_SYSTEM_PROMPT = `You are IMAGE, the image generation agent for Host Hampton, a boutique celebration studio in Speonk, NY.

Your job is to turn owner intent into production-ready image prompts.

Rules:
- Keep prompts family-friendly and brand-appropriate.
- Style should feel warm, bright, celebratory, and local-community oriented.
- Prioritize outputs usable for social and marketing assets.
- Do not include text overlays unless explicitly requested.
- If platform is unknown, default to square-friendly composition.

Respond with ONLY valid JSON:
{
  "revised_prompt": "optimized generation prompt",
  "negative_prompt": "optional avoid list",
  "aspect_ratio": "1:1|4:5|16:9",
  "notes": "short implementation notes"
}`

async function loadMemory(): Promise<string> {
  const namespaceKeys = [
    { ns: 'brand', key: 'voice' },
    { ns: 'brand', key: 'visual' },
    { ns: 'campaigns', key: 'active' }
  ]

  const lines: string[] = ['## Business Context\n']

  await Promise.all(namespaceKeys.map(async ({ ns, key }) => {
    const { data } = await supabase
      .from('agent_memory')
      .select('value')
      .eq('namespace', ns)
      .eq('key', key)
      .single()

    if (data?.value) {
      lines.push(`### ${ns}.${key}\n\`\`\`json\n${JSON.stringify(data.value, null, 2)}\n\`\`\`\n`)
    }
  }))

  return lines.join('\n')
}

async function markInProgress(taskId: string): Promise<void> {
  await supabase
    .from('agent_tasks')
    .update({ status: 'in_progress' })
    .eq('task_id', taskId)
}

async function completeTask(taskId: string, output: ImageTaskOutput): Promise<void> {
  await supabase
    .from('agent_tasks')
    .update({
      status: 'completed',
      output,
      updated_at: new Date().toISOString()
    })
    .eq('task_id', taskId)

  await publisher.publish(COMPLETE_CHANNEL, JSON.stringify({
    task_id: taskId,
    agent: 'IMAGE',
    status: 'completed',
    output
  }))

  console.log(`[IMAGE] Task ${taskId} completed`)
}

async function failTask(taskId: string, error: string): Promise<void> {
  await supabase
    .from('agent_tasks')
    .update({
      status: 'failed',
      output: { status: 'failed', error },
      updated_at: new Date().toISOString()
    })
    .eq('task_id', taskId)

  await publisher.publish(COMPLETE_CHANNEL, JSON.stringify({
    task_id: taskId,
    agent: 'IMAGE',
    status: 'failed',
    error
  }))

  console.error(`[IMAGE] Task ${taskId} failed: ${error}`)
}

async function buildPromptWithClaude(input: ImageTaskInput, memoryContext: string): Promise<{
  revisedPrompt: string
  negativePrompt?: string
  aspectRatio: string
  notes?: string
}> {
  const originalPrompt =
    (typeof input.prompt === 'string' && input.prompt.trim()) ||
    (typeof input.instructions === 'string' && input.instructions.trim())

  if (!originalPrompt) {
    throw new Error('IMAGE task requires input.prompt or input.instructions')
  }

  const response = await claude.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: IMAGE_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `${memoryContext}

Task input:
\`\`\`json
${JSON.stringify(input, null, 2)}
\`\`\`

Base prompt:
${originalPrompt}`
    }]
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return { revisedPrompt: originalPrompt, aspectRatio: (input.aspect_ratio as string) ?? '1:1' }
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    revised_prompt?: string
    negative_prompt?: string
    aspect_ratio?: string
    notes?: string
  }

  return {
    revisedPrompt: parsed.revised_prompt?.trim() || originalPrompt,
    negativePrompt: parsed.negative_prompt?.trim() || undefined,
    aspectRatio: parsed.aspect_ratio?.trim() || (input.aspect_ratio as string) || '1:1',
    notes: parsed.notes
  }
}

async function createReplicatePrediction(payload: Record<string, unknown>): Promise<{
  id: string
  urls: { get: string }
}> {
  const response = await fetch(
    `https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${process.env.REPLICATE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ input: payload })
    }
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Replicate create prediction failed (${response.status}): ${body}`)
  }

  return await response.json() as { id: string; urls: { get: string } }
}

async function waitForPrediction(getUrl: string): Promise<{
  output?: unknown
  status: string
}> {
  const maxAttempts = 60
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(getUrl, {
      headers: { Authorization: `Token ${process.env.REPLICATE_API_KEY}` }
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Replicate polling failed (${response.status}): ${body}`)
    }

    const prediction = await response.json() as { status: string; output?: unknown; error?: string }
    if (prediction.status === 'succeeded') return { status: prediction.status, output: prediction.output }
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      throw new Error(`Replicate prediction ${prediction.status}: ${prediction.error ?? 'unknown error'}`)
    }

    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  throw new Error('Replicate prediction timed out')
}

function resolveImageUrl(output: unknown): string | undefined {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) {
    const first = output.find((item) => typeof item === 'string')
    return typeof first === 'string' ? first : undefined
  }
  return undefined
}

async function saveImageAsset(input: ImageTaskInput, imageUrl: string): Promise<void> {
  const tags = [
    'agent:image',
    typeof input.task_type === 'string' ? input.task_type : null
  ].filter((x): x is string => !!x)

  const { error } = await supabase
    .from('image_assets')
    .insert({
      r2_url: imageUrl,
      service: (input.service as string) ?? null,
      platform: (input.platform as string) ?? null,
      campaign_id: (input.campaign_id as string) ?? null,
      tags
    })

  if (error) {
    console.warn(`[IMAGE] image_assets insert failed (non-fatal): ${error.message}`)
  }
}

async function processTask(manifest: TaskManifest): Promise<void> {
  const { task_id } = manifest
  const input = manifest.input as ImageTaskInput

  console.log(`[IMAGE] Processing task ${task_id}`)
  await markInProgress(task_id)

  try {
    const memoryContext = await loadMemory()
    const promptBuild = await buildPromptWithClaude(input, memoryContext)

    const replicateInput: Record<string, unknown> = {
      prompt: promptBuild.revisedPrompt,
      aspect_ratio: promptBuild.aspectRatio,
      output_format: 'png'
    }

    if (promptBuild.negativePrompt) {
      replicateInput.negative_prompt = promptBuild.negativePrompt
    }

    if (typeof input.width === 'number') replicateInput.width = input.width
    if (typeof input.height === 'number') replicateInput.height = input.height

    const prediction = await createReplicatePrediction(replicateInput)
    const finalResult = await waitForPrediction(prediction.urls.get)
    const imageUrl = resolveImageUrl(finalResult.output)

    if (!imageUrl) {
      throw new Error('Replicate succeeded but no image URL was returned')
    }

    await saveImageAsset(input, imageUrl)

    const output: ImageTaskOutput = {
      status: 'completed',
      prompt: (input.prompt as string) || (input.instructions as string) || '',
      revised_prompt: promptBuild.revisedPrompt,
      image_url: imageUrl,
      replicate_prediction_id: prediction.id,
      model: REPLICATE_MODEL,
      width: typeof input.width === 'number' ? input.width : undefined,
      height: typeof input.height === 'number' ? input.height : undefined,
      notes: promptBuild.notes
    }

    await completeTask(task_id, output)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await failTask(task_id, msg)
  }
}

async function start(): Promise<void> {
  await subscriber.subscribe(CHANNEL)
  console.log(`[IMAGE] Agent subscribed to ${CHANNEL}`)

  subscriber.on('message', (_channel: string, data: string) => {
    try {
      const manifest = JSON.parse(data) as TaskManifest
      processTask(manifest).catch((err) => {
        console.error(`[IMAGE] Unhandled error for task ${manifest.task_id}:`, err)
      })
    } catch (err) {
      console.error('[IMAGE] Failed to parse task manifest:', err)
    }
  })
}

start().catch((err) => {
  console.error('[IMAGE] Startup failed:', err)
  process.exit(1)
})

process.on('SIGTERM', async () => {
  console.log('[IMAGE] SIGTERM received, shutting down...')
  await subscriber.quit()
  await publisher.quit()
  process.exit(0)
})
