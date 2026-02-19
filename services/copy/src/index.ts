/**
 * COPY Agent — Content Writing
 *
 * Subscribes to hampton:agent:copy Redis channel.
 * Receives TaskManifests, generates written content via Claude,
 * persists to content_library in Supabase,
 * updates agent_tasks to completed, publishes to hampton:task_complete.
 */

import 'dotenv/config'
import Redis from 'ioredis'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { TaskManifest, CopyTaskOutput } from './types.js'

// ─── Validate environment ────────────────────────────────────────
const required = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'REDIS_URL']
for (const key of required) {
  if (!process.env[key]) {
    console.error(`[COPY] Missing required env var: ${key}`)
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

subscriber.on('error', (err) => console.error('[COPY] Redis subscriber error:', err))
publisher.on('error',  (err) => console.error('[COPY] Redis publisher error:', err))

const CHANNEL = 'hampton:agent:copy'
const COMPLETE_CHANNEL = 'hampton:task_complete'

// ─── COPY System Prompt ──────────────────────────────────────────
const COPY_SYSTEM_PROMPT = `You are COPY, the content writing agent for Host Hampton — a boutique celebration studio in Speonk, NY run by Allie Larkin.

BRAND VOICE:
- Warm, fun, community-first. Never corporate or pushy.
- Use "we" — not "I". Speak directly to the reader as "you".
- Conversational but polished. Celebrate the moment. Make it feel real.
- NEVER say: "amazing", "incredible", "game-changer", "perfect", "seamless", "effortless"
- DO say: "beautiful", "real", "genuine", "we love", "your crew", "the good stuff"

CONTENT TYPES:
- social_caption: Platform-specific post copy (Instagram, Facebook, GBP, Nextdoor)
- email_subject: Subject line only, max 50 chars, no emojis in subject
- email_body: Full email HTML or plain text as specified
- sms: Max 160 chars. Punchy. Include opt-out note if first contact.
- ad_headline: Max 30 chars for Google / Max 40 chars for Meta
- ad_body: Max 125 chars for Meta / Max 90 chars for Google
- blog_post: 400-800 words, SEO-friendly, local keywords
- content_calendar: Structured 7 or 30-day posting plan in JSON

SERVICES (priority order):
1. Kids parties — Glow Party, Swiftie Party, Princess Party, Spa Party, Art Party
2. Permanent jewelry — add-on or standalone

LOCATION: 295 Montauk Highway, Speonk, NY — serving Hamptons-area families.
BOOKING: hosthampton.com | (631) 998-9325

Respond with ONLY valid JSON:
{
  "content_type": "social_caption|email_subject|email_body|sms|ad_headline|ad_body|blog_post|content_calendar",
  "headline": "optional headline or subject",
  "body": "the main content",
  "cta": "optional call-to-action text",
  "hashtags": ["optional", "hashtags"],
  "word_count": 0,
  "notes": "optional notes for owner review"
}`

// Content type → content_library content_type enum mapping
// Adjust if your DB enum differs
// Maps COPY output content_type → content_library DB enum values
// DB enum: caption, email_subject, email_body, ad_headline, ad_description,
//          sms, blog_post, hashtag_set, review_response, dm_reply, other
const CONTENT_TYPE_MAP: Record<string, string> = {
  social_caption:   'caption',
  email_subject:    'email_subject',
  email_body:       'email_body',
  sms:              'sms',
  ad_headline:      'ad_headline',
  ad_body:          'ad_description',
  blog_post:        'blog_post',
  content_calendar: 'other'
}

// ─── Load memory context from Supabase ──────────────────────────
async function loadMemory(taskInput: Record<string, unknown>): Promise<string> {
  const namespaceKeys = [
    { ns: 'brand', key: 'voice' },
    { ns: 'brand', key: 'hashtags' },
    { ns: 'services', key: 'priority_order' },
    { ns: 'campaigns', key: 'active' }
  ]

  // Load service-specific memory if specified
  const service = taskInput.service as string | undefined
  if (service) {
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

// ─── Persist to content_library ─────────────────────────────────
async function saveToContentLibrary(
  taskId: string,
  input: Record<string, unknown>,
  output: CopyTaskOutput
): Promise<void> {
  const dbContentType = CONTENT_TYPE_MAP[output.content_type] ?? 'social_post'

  const title = (output.headline ?? (input.task_type as string) ?? dbContentType).slice(0, 200)

  const { error } = await supabase
    .from('content_library')
    .insert({
      title,
      content_type: dbContentType,
      platform: (input.platform as string) ?? null,
      campaign_id: (input.campaign_id as string) ?? null,
      subject_line: output.headline ?? null,
      body: output.body,
      hashtags: output.hashtags ?? null,
      status: 'draft',
      created_by: 'COPY'
    })

  if (error) {
    // Non-fatal — log but don't fail the task
    console.warn(`[COPY] content_library insert failed (non-fatal): ${error.message}`)
  }
}

// ─── Mark task in_progress ───────────────────────────────────────
async function markInProgress(taskId: string): Promise<void> {
  await supabase
    .from('agent_tasks')
    .update({ status: 'in_progress' })
    .eq('task_id', taskId)
}

// ─── Complete a task ─────────────────────────────────────────────
async function completeTask(taskId: string, output: CopyTaskOutput): Promise<void> {
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
    agent: 'COPY',
    status: 'completed',
    output
  }))

  console.log(`[COPY] Task ${taskId} completed — ${output.content_type}`)
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
    agent: 'COPY',
    status: 'failed',
    error
  }))

  console.error(`[COPY] Task ${taskId} failed: ${error}`)
}

// ─── Process a single task ───────────────────────────────────────
async function processTask(manifest: TaskManifest): Promise<void> {
  const { task_id, input } = manifest
  console.log(`[COPY] Processing task ${task_id} — type: ${input.task_type}`)

  await markInProgress(task_id)

  try {
    const memoryContext = await loadMemory(input)

    const userPrompt = `${memoryContext}

---

Task: ${JSON.stringify(input, null, 2)}

Generate the content as specified. Follow all brand voice rules.`

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: COPY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Claude returned no valid JSON')

    const parsed = JSON.parse(jsonMatch[0]) as Omit<CopyTaskOutput, 'status'>
    const output: CopyTaskOutput = { status: 'completed', ...parsed }

    // Persist to content_library (non-blocking on failure)
    await saveToContentLibrary(task_id, input, output)

    await completeTask(task_id, output)

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await failTask(task_id, msg)
  }
}

// ─── Subscribe ───────────────────────────────────────────────────
async function start(): Promise<void> {
  await subscriber.subscribe(CHANNEL)
  console.log(`\n✍️  COPY Agent subscribed to ${CHANNEL}`)

  subscriber.on('message', (_channel: string, data: string) => {
    try {
      const manifest = JSON.parse(data) as TaskManifest
      processTask(manifest).catch((err) => {
        console.error(`[COPY] Unhandled error for task ${manifest.task_id}:`, err)
      })
    } catch (err) {
      console.error('[COPY] Failed to parse task manifest:', err)
    }
  })
}

start().catch((err) => {
  console.error('[COPY] Startup failed:', err)
  process.exit(1)
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[COPY] SIGTERM received — shutting down...')
  await subscriber.quit()
  await publisher.quit()
  process.exit(0)
})
