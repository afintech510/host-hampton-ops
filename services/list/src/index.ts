/**
 * LIST Agent - CRM segmentation + audience planning
 *
 * Subscribes to hampton:agent:list Redis channel.
 * Receives TaskManifests, generates audience segment plans via Claude,
 * stores segment memory in agent_memory (non-fatal),
 * updates agent_tasks to completed, publishes to hampton:task_complete.
 */

import 'dotenv/config'
import Redis from 'ioredis'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { ListTaskOutput, TaskManifest } from './types.js'

const required = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'REDIS_URL']
for (const key of required) {
  if (!process.env[key]) {
    console.error(`[LIST] Missing required env var: ${key}`)
    process.exit(1)
  }
}

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const subscriber = new Redis(process.env.REDIS_URL!)
const publisher = new Redis(process.env.REDIS_URL!)

subscriber.on('error', (err) => console.error('[LIST] Redis subscriber error:', err))
publisher.on('error', (err) => console.error('[LIST] Redis publisher error:', err))

const CHANNEL = 'hampton:agent:list'
const COMPLETE_CHANNEL = 'hampton:task_complete'

const LIST_SYSTEM_PROMPT = `You are LIST, the CRM + audience segmentation agent for Host Hampton - a boutique celebration studio in Speonk, NY.

Your job is to convert owner goals into actionable contact segments for outbound follow-up.

Output rules:
- Build practical segment filters that can be executed against the CRM.
- Prefer segments by service, lifecycle stage, recency, and location relevance.
- Keep recommendations specific and concise.

Respond with ONLY valid JSON:
{
  "segment_name": "human readable segment name",
  "audience_key": "stable_snake_case_key",
  "filters": {
    "status": ["lead", "prospect"],
    "service_interests": ["kids_party_glow"],
    "booked_within_days": 90
  },
  "estimated_size": 0,
  "recommended_channels": ["email", "sms"],
  "notes": "optional operating notes"
}`

async function loadMemory(input: Record<string, unknown>): Promise<string> {
  const namespaceKeys = [
    { ns: 'brand', key: 'voice' },
    { ns: 'campaigns', key: 'active' },
    { ns: 'crm', key: 'segments' },
    { ns: 'crm', key: 'suppression_rules' }
  ]

  const service = input.service
  if (typeof service === 'string' && service.trim()) {
    namespaceKeys.push({ ns: 'services', key: service })
  }

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

async function saveSegmentMemory(taskId: string, output: ListTaskOutput): Promise<void> {
  const { error } = await supabase
    .from('agent_memory')
    .upsert({
      namespace: 'crm',
      key: `segment_${output.audience_key || taskId}`,
      value: {
        task_id: taskId,
        segment_name: output.segment_name,
        audience_key: output.audience_key,
        filters: output.filters,
        estimated_size: output.estimated_size ?? null,
        recommended_channels: output.recommended_channels ?? [],
        notes: output.notes ?? null
      },
      description: `LIST generated segment from task ${taskId}`,
      updated_by: 'LIST'
    }, {
      onConflict: 'namespace,key'
    })

  if (error) {
    console.warn(`[LIST] agent_memory upsert failed (non-fatal): ${error.message}`)
  }
}

async function markInProgress(taskId: string): Promise<void> {
  await supabase
    .from('agent_tasks')
    .update({ status: 'in_progress' })
    .eq('task_id', taskId)
}

async function completeTask(taskId: string, output: ListTaskOutput): Promise<void> {
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
    agent: 'LIST',
    status: 'completed',
    output
  }))

  console.log(`[LIST] Task ${taskId} completed`)
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
    agent: 'LIST',
    status: 'failed',
    error
  }))

  console.error(`[LIST] Task ${taskId} failed: ${error}`)
}

async function processTask(manifest: TaskManifest): Promise<void> {
  const { task_id, input } = manifest
  console.log(`[LIST] Processing task ${task_id}`)

  await markInProgress(task_id)

  try {
    const memoryContext = await loadMemory(input)
    const userPrompt = `${memoryContext}

---

Task: ${JSON.stringify(input, null, 2)}

Generate a CRM audience segment plan as valid JSON.`

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: LIST_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Claude returned no valid JSON')

    const rawJson = jsonMatch[0]
    let parsed: Omit<ListTaskOutput, 'status'>
    try {
      parsed = JSON.parse(rawJson) as Omit<ListTaskOutput, 'status'>
    } catch {
      // Common failure: trailing commas before } or ]
      const sanitized = rawJson.replace(/,\s*([}\]])/g, '$1')
      parsed = JSON.parse(sanitized) as Omit<ListTaskOutput, 'status'>
    }
    const output: ListTaskOutput = {
      status: 'completed',
      segment_name: parsed.segment_name ?? 'Untitled Segment',
      audience_key: parsed.audience_key ?? `segment_${task_id.slice(0, 8)}`,
      filters: parsed.filters ?? {},
      estimated_size: parsed.estimated_size,
      recommended_channels: parsed.recommended_channels ?? [],
      notes: parsed.notes
    }

    await saveSegmentMemory(task_id, output)
    await completeTask(task_id, output)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await failTask(task_id, msg)
  }
}

async function start(): Promise<void> {
  await subscriber.subscribe(CHANNEL)
  console.log(`[LIST] Agent subscribed to ${CHANNEL}`)

  subscriber.on('message', (_channel: string, data: string) => {
    try {
      const manifest = JSON.parse(data) as TaskManifest
      processTask(manifest).catch((err) => {
        console.error(`[LIST] Unhandled error for task ${manifest.task_id}:`, err)
      })
    } catch (err) {
      console.error('[LIST] Failed to parse task manifest:', err)
    }
  })
}

start().catch((err) => {
  console.error('[LIST] Startup failed:', err)
  process.exit(1)
})

process.on('SIGTERM', async () => {
  console.log('[LIST] SIGTERM received - shutting down...')
  await subscriber.quit()
  await publisher.quit()
  process.exit(0)
})
