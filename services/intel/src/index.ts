/**
 * INTEL Agent — Analytics + Reporting
 *
 * Subscribes to hampton:agent:intel Redis channel.
 * Handles:
 *   - overnight_analytics_pull  → GA4 + internal ops data, save to agent_memory
 *   - weekly_report (week_ahead / week_in_review) → briefing report
 *
 * GA4 is optional — if credentials are missing, falls back to internal Supabase data.
 */

import 'dotenv/config'
import Redis from 'ioredis'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import {
  TaskManifest,
  InternalMetrics,
  GA4Metrics,
  IntelReport,
  IntelTaskOutput
} from './types.js'

const required = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'REDIS_URL']
for (const key of required) {
  if (!process.env[key]) {
    console.error(`[INTEL] Missing required env var: ${key}`)
    process.exit(1)
  }
}

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const subscriber = new Redis(process.env.REDIS_URL!)
const publisher = new Redis(process.env.REDIS_URL!)

subscriber.on('error', (err) => console.error('[INTEL] Redis subscriber error:', err))
publisher.on('error', (err) => console.error('[INTEL] Redis publisher error:', err))

const CHANNEL = 'hampton:agent:intel'
const COMPLETE_CHANNEL = 'hampton:task_complete'

// ─── GA4 helpers ────────────────────────────────────────────────

// Supports two auth modes:
//   1. Service Account (preferred): GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY
//   2. OAuth2 refresh token (legacy): GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN
const hasServiceAccount = !!process.env.GA4_PROPERTY_ID &&
  !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  !!process.env.GOOGLE_PRIVATE_KEY

const hasOAuth = !!process.env.GA4_PROPERTY_ID &&
  !!process.env.GOOGLE_CLIENT_ID &&
  !!process.env.GOOGLE_CLIENT_SECRET &&
  !!process.env.GOOGLE_REFRESH_TOKEN

const ga4Available = hasServiceAccount || hasOAuth

if (hasServiceAccount) {
  console.log('[INTEL] GA4 service account configured — live analytics enabled')
} else if (hasOAuth) {
  console.log('[INTEL] GA4 OAuth2 credentials configured — live analytics enabled')
} else {
  console.log('[INTEL] GA4 not configured — running on internal metrics only')
}

function buildGA4Auth() {
  if (hasServiceAccount) {
    return new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/analytics.readonly']
    })
  }
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
  return auth
}

async function fetchGA4Metrics(days = 7): Promise<GA4Metrics | null> {
  if (!ga4Available) return null

  try {
    const auth = buildGA4Auth()

    const analyticsdata = google.analyticsdata({ version: 'v1beta', auth })
    const propertyId = process.env.GA4_PROPERTY_ID!

    const response = await analyticsdata.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'pagePath' }, { name: 'sessionDefaultChannelGroup' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'screenPageViews' }
        ]
      }
    })

    const rows = response.data.rows ?? []
    let totalSessions = 0
    let totalUsers = 0
    let totalPageViews = 0
    const pageMap: Record<string, number> = {}
    const sourceMap: Record<string, number> = {}

    for (const row of rows) {
      const page = row.dimensionValues?.[0]?.value ?? '(unknown)'
      const source = row.dimensionValues?.[1]?.value ?? '(unknown)'
      const sessions = parseInt(row.metricValues?.[0]?.value ?? '0', 10)
      const users = parseInt(row.metricValues?.[1]?.value ?? '0', 10)
      const views = parseInt(row.metricValues?.[2]?.value ?? '0', 10)

      totalSessions += sessions
      totalUsers += users
      totalPageViews += views
      pageMap[page] = (pageMap[page] ?? 0) + views
      sourceMap[source] = (sourceMap[source] ?? 0) + sessions
    }

    const topPages = Object.entries(pageMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([page, views]) => ({ page, views }))

    return {
      sessions_7d: totalSessions,
      users_7d: totalUsers,
      page_views_7d: totalPageViews,
      top_pages: topPages,
      traffic_source: sourceMap
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[INTEL] GA4 fetch failed (non-fatal): ${msg}`)
    return null
  }
}

// ─── Internal metrics from Supabase ─────────────────────────────

async function fetchInternalMetrics(): Promise<InternalMetrics> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: tasks } = await supabase
    .from('agent_tasks')
    .select('assigned_to, status')
    .in('status', ['completed', 'failed'])
    .gte('updated_at', since)

  const tasksByAgent: Record<string, number> = {}
  let tasksCompleted = 0
  for (const t of tasks ?? []) {
    if (t.status === 'completed') {
      tasksCompleted++
      tasksByAgent[t.assigned_to] = (tasksByAgent[t.assigned_to] ?? 0) + 1
    }
  }

  const { data: content } = await supabase
    .from('content_library')
    .select('content_type')
    .gte('created_at', since)

  const contentByType: Record<string, number> = {}
  for (const c of content ?? []) {
    contentByType[c.content_type] = (contentByType[c.content_type] ?? 0) + 1
  }

  const topContentType = Object.entries(contentByType).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  return {
    tasks_completed_7d: tasksCompleted,
    tasks_by_agent: tasksByAgent,
    content_items_7d: (content ?? []).length,
    content_by_type: contentByType,
    top_content_type: topContentType
  }
}

// ─── Load memory context ─────────────────────────────────────────

async function loadMemoryContext(): Promise<string> {
  const keys = [
    { ns: 'brand', key: 'voice' },
    { ns: 'campaigns', key: 'active' },
    { ns: 'analytics', key: 'last_report' }
  ]

  const lines: string[] = []
  await Promise.all(keys.map(async ({ ns, key }) => {
    const { data } = await supabase
      .from('agent_memory')
      .select('value')
      .eq('namespace', ns)
      .eq('key', key)
      .single()
    if (data?.value) {
      lines.push(`### ${ns}.${key}\n\`\`\`json\n${JSON.stringify(data.value, null, 2)}\n\`\`\``)
    }
  }))

  return lines.join('\n\n')
}

// ─── Save report to agent_memory ────────────────────────────────

async function saveReport(report: IntelReport): Promise<void> {
  const { error } = await supabase
    .from('agent_memory')
    .upsert(
      {
        namespace: 'analytics',
        key: 'last_report',
        description: 'Most recent INTEL analytics report',
        value: report as unknown as Record<string, unknown>,
        updated_by: 'INTEL',
        version: 1
      },
      { onConflict: 'namespace,key' }
    )

  if (error) {
    console.warn(`[INTEL] Failed to save report to agent_memory: ${error.message}`)
  } else {
    console.log('[INTEL] Report saved to agent_memory(analytics.last_report)')
  }
}

// ─── Task lifecycle ──────────────────────────────────────────────

async function markInProgress(taskId: string): Promise<void> {
  await supabase
    .from('agent_tasks')
    .update({ status: 'in_progress' })
    .eq('task_id', taskId)
}

async function completeTask(taskId: string, output: IntelTaskOutput): Promise<void> {
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
    agent: 'INTEL',
    status: 'completed',
    output
  }))

  console.log(`[INTEL] Task ${taskId} completed`)
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
    agent: 'INTEL',
    status: 'failed',
    error
  }))

  console.error(`[INTEL] Task ${taskId} failed: ${error}`)
}

// ─── Core processing ─────────────────────────────────────────────

async function processTask(manifest: TaskManifest): Promise<void> {
  const { task_id, input } = manifest
  const taskType = (input.task_type as string) ?? 'overnight_analytics_pull'
  const reportType = (input.report_type as string) ?? taskType

  console.log(`[INTEL] Processing task ${task_id} (${taskType})`)
  await markInProgress(task_id)

  try {
    const [internalMetrics, ga4Metrics, memoryContext] = await Promise.all([
      fetchInternalMetrics(),
      fetchGA4Metrics(7),
      loadMemoryContext()
    ])

    const dataContext = `
## Internal Operations (last 7 days)
- Tasks completed: ${internalMetrics.tasks_completed_7d}
- By agent: ${JSON.stringify(internalMetrics.tasks_by_agent)}
- Content items created: ${internalMetrics.content_items_7d}
- Content by type: ${JSON.stringify(internalMetrics.content_by_type)}

## Website Analytics (GA4 — last 7 days)
${ga4Metrics ? `
- Sessions: ${ga4Metrics.sessions_7d}
- Users: ${ga4Metrics.users_7d}
- Page views: ${ga4Metrics.page_views_7d}
- Top pages: ${JSON.stringify(ga4Metrics.top_pages)}
- Traffic sources: ${JSON.stringify(ga4Metrics.traffic_source)}
` : '(GA4 not configured — using internal data only)'}

## Business Memory Context
${memoryContext}
`

    const systemPrompt = `You are INTEL, the analytics and reporting agent for Host Hampton — a boutique celebration studio in Speonk, NY.

Your job is to synthesize operational data and website metrics into clear, actionable business intelligence for the owner (Allie).

Rules:
- Be concise and specific — no fluff.
- Focus on revenue opportunities and content gaps.
- Highlight what's working and what needs attention.
- Recommended actions should be executable by the other agents (COPY, SOC, OUTBOUND, LIST).

Respond with ONLY valid JSON:
{
  "summary": "2-3 sentence executive summary",
  "insights": ["insight 1", "insight 2", "insight 3"],
  "recommended_actions": ["action 1", "action 2"]
}`

    const userPrompt = `${dataContext}

---

Task: ${taskType}
Instructions: ${typeof input.instructions === 'string' ? input.instructions : 'Generate a business intelligence report.'}

Generate the analytics report as valid JSON.`

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Claude returned no valid JSON')

    let parsed: { summary: string; insights: string[]; recommended_actions: string[] }
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      const sanitized = jsonMatch[0].replace(/,\s*([}\]])/g, '$1')
      parsed = JSON.parse(sanitized)
    }

    const report: IntelReport = {
      report_type: reportType.includes('week_ahead') ? 'week_ahead'
        : reportType.includes('week_in_review') ? 'week_in_review'
        : 'overnight_analytics',
      generated_at: new Date().toISOString(),
      internal_metrics: internalMetrics,
      ga4_metrics: ga4Metrics,
      ga4_available: ga4Metrics !== null,
      summary: parsed.summary ?? '',
      insights: parsed.insights ?? [],
      recommended_actions: parsed.recommended_actions ?? []
    }

    await saveReport(report)

    const output: IntelTaskOutput = { status: 'completed', report }
    await completeTask(task_id, output)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await failTask(task_id, msg)
  }
}

// ─── Subscriber ──────────────────────────────────────────────────

async function start(): Promise<void> {
  await subscriber.subscribe(CHANNEL)
  console.log(`[INTEL] Agent subscribed to ${CHANNEL}`)

  subscriber.on('message', (_channel: string, data: string) => {
    try {
      const manifest = JSON.parse(data) as TaskManifest
      processTask(manifest).catch((err) => {
        console.error(`[INTEL] Unhandled error for task ${manifest.task_id}:`, err)
      })
    } catch (err) {
      console.error('[INTEL] Failed to parse task manifest:', err)
    }
  })
}

start().catch((err) => {
  console.error('[INTEL] Startup failed:', err)
  process.exit(1)
})

process.on('SIGTERM', async () => {
  console.log('[INTEL] SIGTERM received - shutting down...')
  await subscriber.quit()
  await publisher.quit()
  process.exit(0)
})
