/**
 * OUTBOUND Agent - Email + SMS sequences
 *
 * Subscribes to hampton:agent:outbound Redis channel.
 * Receives TaskManifests, generates outbound drafts via Claude,
 * stores to content_library (non-fatal),
 * updates agent_tasks to completed, publishes to hampton:task_complete.
 */

import 'dotenv/config'
import Redis from 'ioredis'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { OutboundTaskOutput, TaskManifest } from './types.js'

const required = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'REDIS_URL']
for (const key of required) {
  if (!process.env[key]) {
    console.error(`[OUTBOUND] Missing required env var: ${key}`)
    process.exit(1)
  }
}

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const subscriber = new Redis(process.env.REDIS_URL!)
const publisher = new Redis(process.env.REDIS_URL!)

// Resend email client — optional, only active when RESEND_API_KEY is set
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'Host Hampton <onboarding@resend.dev>'
if (resend) {
  console.log('[OUTBOUND] Resend email sending enabled')
} else {
  console.log('[OUTBOUND] Resend not configured — drafts only (set RESEND_API_KEY to enable sending)')
}

subscriber.on('error', (err) => console.error('[OUTBOUND] Redis subscriber error:', err))
publisher.on('error', (err) => console.error('[OUTBOUND] Redis publisher error:', err))

const CHANNEL = 'hampton:agent:outbound'
const COMPLETE_CHANNEL = 'hampton:task_complete'

const OUTBOUND_SYSTEM_PROMPT = `You are OUTBOUND, the email + SMS agent for Host Hampton - a boutique celebration studio in Speonk, NY.

You draft conversion-focused but warm outreach for local families.

Rules:
- Email subject lines should be clear, local, and under 50 characters.
- SMS must stay under 160 characters.
- Keep tone community-first and never pushy.
- Include one direct call to action.

Respond with ONLY valid JSON:
{
  "channel": "email|sms",
  "audience_key": "optional audience reference",
  "subject": "required for email",
  "body": "full email body or primary message",
  "sms_text": "required for sms",
  "call_to_action": "short CTA text",
  "notes": "optional notes"
}`

async function loadMemory(input: Record<string, unknown>): Promise<string> {
  const namespaceKeys = [
    { ns: 'brand', key: 'voice' },
    { ns: 'campaigns', key: 'active' },
    { ns: 'crm', key: 'suppression_rules' }
  ]

  const audienceKey = input.audience_key
  if (typeof audienceKey === 'string' && audienceKey.trim()) {
    namespaceKeys.push({ ns: 'crm', key: `segment_${audienceKey}` })
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

async function loadBookingLinks(): Promise<Record<string, string> | null> {
  const { data } = await supabase
    .from('agent_memory')
    .select('value')
    .eq('namespace', 'services')
    .eq('key', 'booking_links')
    .single()
  return data?.value as Record<string, string> | null
}

async function saveToContentLibrary(input: Record<string, unknown>, output: OutboundTaskOutput): Promise<void> {
  const contentType = output.channel === 'sms' ? 'sms' : 'email_body'
  const title = typeof input.task_type === 'string'
    ? input.task_type
    : `${output.channel}_campaign`

  const body = output.channel === 'sms'
    ? (output.sms_text || output.body)
    : output.body

  const { error } = await supabase
    .from('content_library')
    .insert({
      title,
      content_type: contentType,
      platform: output.channel,
      campaign_id: typeof input.campaign_id === 'string' ? input.campaign_id : null,
      body,
      subject_line: output.subject ?? null,
      status: 'draft',
      created_by: 'OUTBOUND',
      notes: output.notes ?? null
    })

  if (error) {
    console.warn(`[OUTBOUND] content_library insert failed (non-fatal): ${error.message}`)
  }
}

async function markInProgress(taskId: string): Promise<void> {
  await supabase
    .from('agent_tasks')
    .update({ status: 'in_progress' })
    .eq('task_id', taskId)
}

async function completeTask(taskId: string, output: OutboundTaskOutput): Promise<void> {
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
    agent: 'OUTBOUND',
    status: 'completed',
    output
  }))

  console.log(`[OUTBOUND] Task ${taskId} completed`)
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
    agent: 'OUTBOUND',
    status: 'failed',
    error
  }))

  console.error(`[OUTBOUND] Task ${taskId} failed: ${error}`)
}

async function processTask(manifest: TaskManifest): Promise<void> {
  const { task_id, input } = manifest
  console.log(`[OUTBOUND] Processing task ${task_id}`)

  await markInProgress(task_id)

  try {
    const memoryContext = await loadMemory(input)
    const userPrompt = `${memoryContext}

---

Task: ${JSON.stringify(input, null, 2)}

Generate outbound message output as valid JSON.`

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1400,
      system: OUTBOUND_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Claude returned no valid JSON')

    const rawJson = jsonMatch[0]
    let parsed: Omit<OutboundTaskOutput, 'status'>
    try {
      parsed = JSON.parse(rawJson) as Omit<OutboundTaskOutput, 'status'>
    } catch {
      const sanitized = rawJson.replace(/,\s*([}\]])/g, '$1')
      parsed = JSON.parse(sanitized) as Omit<OutboundTaskOutput, 'status'>
    }
    const channel = parsed.channel === 'sms' ? 'sms' : 'email'
    const output: OutboundTaskOutput = {
      status: 'completed',
      channel,
      audience_key: parsed.audience_key,
      subject: parsed.subject,
      body: parsed.body ?? '',
      sms_text: parsed.sms_text,
      call_to_action: parsed.call_to_action,
      notes: parsed.notes
    }

    if (channel === 'sms' && !output.sms_text) {
      output.sms_text = output.body
    }

    // Load booking links from agent_memory and inject into CTA if not already present
    const bookingLinks = await loadBookingLinks()
    if (bookingLinks && output.body && !output.body.includes('hosthampton.com')) {
      const ctaLine = bookingLinks.kids_party
        ? `\n\n👉 Book your date: ${bookingLinks.kids_party}`
        : `\n\n👉 Visit us: https://hosthampton.com`
      output.body += ctaLine
    }

    // Send via Resend if send_immediately flag is set
    if (channel === 'email' && input.send_immediately === true && resend) {
      const toAddresses = typeof input.send_to_email === 'string'
        ? [input.send_to_email]
        : (Array.isArray(input.send_to_email) ? input.send_to_email as string[] : ['allie@hosthampton.com'])

      const htmlBody = output.body
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>')

      const { error: sendError } = await resend.emails.send({
        from: FROM_EMAIL,
        to: toAddresses,
        subject: output.subject ?? 'Message from Host Hampton',
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">${htmlBody}</div>`,
      })

      if (sendError) {
        console.warn(`[OUTBOUND] Resend failed (non-fatal): ${sendError.message}`)
        output.send_error = sendError.message
      } else {
        output.sent = true
        output.sent_to = toAddresses
        console.log(`[OUTBOUND] Email sent via Resend to ${toAddresses.join(', ')}`)
      }
    }

    await saveToContentLibrary(input, output)
    await completeTask(task_id, output)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await failTask(task_id, msg)
  }
}

async function start(): Promise<void> {
  await subscriber.subscribe(CHANNEL)
  console.log(`[OUTBOUND] Agent subscribed to ${CHANNEL}`)

  subscriber.on('message', (_channel: string, data: string) => {
    try {
      const manifest = JSON.parse(data) as TaskManifest
      processTask(manifest).catch((err) => {
        console.error(`[OUTBOUND] Unhandled error for task ${manifest.task_id}:`, err)
      })
    } catch (err) {
      console.error('[OUTBOUND] Failed to parse task manifest:', err)
    }
  })
}

start().catch((err) => {
  console.error('[OUTBOUND] Startup failed:', err)
  process.exit(1)
})

process.on('SIGTERM', async () => {
  console.log('[OUTBOUND] SIGTERM received - shutting down...')
  await subscriber.quit()
  await publisher.quit()
  process.exit(0)
})
