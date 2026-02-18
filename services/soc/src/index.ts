/**
 * SOC Agent — Social Media
 *
 * Subscribes to hampton:agent:soc Redis channel.
 * Receives TaskManifests, generates social post content via Claude,
 * updates agent_tasks in Supabase, publishes completion to hampton:task_complete.
 */

import 'dotenv/config'
import Redis from 'ioredis'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { TaskManifest, SocTaskOutput } from './types.js'

// ─── Validate environment ────────────────────────────────────────
const required = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'REDIS_URL']
for (const key of required) {
  if (!process.env[key]) {
    console.error(`[SOC] Missing required env var: ${key}`)
    process.exit(1)
  }
}

// ─── Clients ────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const subscriber = new Redis(process.env.REDIS_URL!)
const publisher  = new Redis(process.env.REDIS_URL!)

subscriber.on('error', (err) => console.error('[SOC] Redis subscriber error:', err))
publisher.on('error',  (err) => console.error('[SOC] Redis publisher error:', err))

const CHANNEL = 'hampton:agent:soc'
const COMPLETE_CHANNEL = 'hampton:task_complete'

// ─── SOC System Prompt ───────────────────────────────────────────
const SOC_SYSTEM_PROMPT = `You are SOC, the social media agent for Host Hampton — a boutique celebration studio in Speonk, NY.

You write and schedule social posts for: Instagram, Facebook, Google Business Profile, Nextdoor, and Facebook Groups.

BRAND VOICE: Warm, fun, community-first. Never corporate or pushy. Use "we" not "I". Speak to local families.

PLATFORM RULES:
- Instagram: 150-220 chars before hashtags. Hook in first 3 words. 15-20 hashtags.
- Facebook: 100-180 chars. Conversational. No hashtag stuffing (3-5 max). CTA always.
- Google Business Profile: 250-300 chars. Location keywords. Service-focused. No emojis.
- Nextdoor: 80-120 chars. Hyper-local. Mention neighborhood/town names. Warm neighbor tone.
- Facebook Groups: 60-100 chars intro + detail. Authentic. Ask a question to drive comments.

SERVICES: Kids parties (Glow, Swiftie, Princess, Spa, Art), Permanent jewelry.
LOCATION: 295 Montauk Highway, Speonk, NY 11972 — serving Hamptons area families.

Always respond with ONLY valid JSON:
{
  "platform": "instagram|facebook|gbp|nextdoor|fb_group",
  "caption": "the post text",
  "hashtags": ["tag1", "tag2"],
  "scheduled_for": "ISO timestamp or null",
  "notes": "any relevant notes for the owner"
}`

// ─── Load memory context from Supabase ──────────────────────────
async function loadMemory(): Promise<string> {
  const namespaceKeys = [
    { ns: 'brand', key: 'voice' },
    { ns: 'brand', key: 'hashtags' },
    { ns: 'brand', key: 'visual' },
    { ns: 'social', key: 'posting_schedule' },
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

// ─── Mark task in_progress ───────────────────────────────────────
async function markInProgress(taskId: string): Promise<void> {
  await supabase
    .from('agent_tasks')
    .update({ status: 'in_progress' })
    .eq('task_id', taskId)
}

// ─── Complete a task ─────────────────────────────────────────────
async function completeTask(taskId: string, output: SocTaskOutput): Promise<void> {
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
    agent: 'SOC',
    status: 'completed',
    output
  }))

  console.log(`[SOC] Task ${taskId} completed`)
}

// ─── Fail a task ─────────────────────────────────────────────────
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
    agent: 'SOC',
    status: 'failed',
    error
  }))

  console.error(`[SOC] Task ${taskId} failed: ${error}`)
}

// ─── Process a single task ───────────────────────────────────────
async function processTask(manifest: TaskManifest): Promise<void> {
  const { task_id, input } = manifest
  console.log(`[SOC] Processing task ${task_id} — type: ${input.task_type}`)

  await markInProgress(task_id)

  try {
    const memoryContext = await loadMemory()

    const userPrompt = `${memoryContext}

---

Task: ${JSON.stringify(input, null, 2)}

Generate the social post output as specified.`

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SOC_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Claude returned no valid JSON')

    const parsed = JSON.parse(jsonMatch[0]) as Omit<SocTaskOutput, 'status'>
    await completeTask(task_id, { status: 'completed', ...parsed })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await failTask(task_id, msg)
  }
}

// ─── Subscribe ───────────────────────────────────────────────────
async function start(): Promise<void> {
  await subscriber.subscribe(CHANNEL)
  console.log(`\n📱 SOC Agent subscribed to ${CHANNEL}`)

  subscriber.on('message', (_channel: string, data: string) => {
    try {
      const manifest = JSON.parse(data) as TaskManifest
      processTask(manifest).catch((err) => {
        console.error(`[SOC] Unhandled error for task ${manifest.task_id}:`, err)
      })
    } catch (err) {
      console.error('[SOC] Failed to parse task manifest:', err)
    }
  })
}

start().catch((err) => {
  console.error('[SOC] Startup failed:', err)
  process.exit(1)
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[SOC] SIGTERM received — shutting down...')
  await subscriber.quit()
  await publisher.quit()
  process.exit(0)
})
