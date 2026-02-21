/**
 * index.ts — HAMPTON Orchestrator Entry Point
 *
 * HTTP + WebSocket server. Receives owner commands, runs the full
 * classify → load memory → plan → gate → dispatch pipeline.
 *
 * Endpoints:
 *   POST /chat              — owner sends a command
 *   GET  /health            — container health check
 *   GET  /tasks             — list active tasks
 *   POST /tasks/:id/approve — owner approves a DRAFT_AND_SHOW or ALWAYS_ASK task
 *   POST /tasks/:id/reject  — owner rejects a task
 *   GET  /status            — system phase + agent roster
 *
 * Cron jobs:
 *   Daily 06:00  — analytics overnight pull
 *   Daily 07:00  — social comment scan
 *   Daily 11:00  — end-of-day summary
 *   Monday 07:00 — booking gap detector
 *   Monday 09:00 — week ahead report
 *   Friday 16:00 — week in review report
 */

import 'dotenv/config'
import express, { Request, Response, NextFunction } from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'http'
import cron from 'node-cron'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import Redis from 'ioredis'

import { MemoryManager } from './memoryManager.js'
import { IntentClassifier } from './intentClassifier.js'
import { Router } from './router.js'
import { ApprovalGate } from './approvalGate.js'
import { TaskQueue } from './taskQueue.js'
import { BookingGapDetector } from './bookingGapDetector.js'
import { TaskManifest, PhaseStatus, EscalationRecord } from './types.js'

// ─── Validate environment ────────────────────────────────────────
const required = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'REDIS_URL']
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing required env var: ${key}`)
    process.exit(1)
  }
}

// ─── Clients ────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Services ───────────────────────────────────────────────────
const memory    = new MemoryManager(supabase)
const classifier = new IntentClassifier()
const router    = new Router()
const taskQueue = new TaskQueue(supabase, process.env.REDIS_URL!)

// Forward declared so ApprovalGate can reference taskQueue.dispatch
const gate = new ApprovalGate(supabase, async (manifest: TaskManifest) => {
  await taskQueue.dispatch(manifest)
  broadcast({ type: 'task_dispatched', task_id: manifest.task_id, agent: manifest.assigned_to })
})

const gapDetector = new BookingGapDetector(supabase, taskQueue)

// ─── Task completion subscriber ──────────────────────────────────
const taskCompleteSubscriber = new Redis(process.env.REDIS_URL!)
taskCompleteSubscriber.on('error', (err) => console.error('[HAMPTON] Redis task_complete error:', err))

taskCompleteSubscriber.subscribe('hampton:task_complete', (err) => {
  if (err) console.error('[HAMPTON] Failed to subscribe to task_complete:', err)
  else console.log('[HAMPTON] Listening on hampton:task_complete')
})

taskCompleteSubscriber.on('message', (_channel: string, data: string) => {
  try {
    const event = JSON.parse(data) as { task_id: string; agent: string; status: string; output?: unknown }
    console.log(`[HAMPTON] Task complete: ${event.task_id} by ${event.agent} — ${event.status}`)
    broadcast({ type: 'task_complete', ...event })
  } catch (err) {
    console.error('[HAMPTON] Failed to parse task_complete event:', err)
  }
})

// ─── Express + WS ───────────────────────────────────────────────
const app = express()

// CORS — allow dashboard at app.hosthampton.com
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://app.hosthampton.com')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.sendStatus(204); return }
  next()
})

app.use(express.json())

const httpServer = createServer(app)
const wss = new WebSocketServer({ server: httpServer })

const connectedClients = new Set<WebSocket>()

wss.on('connection', (ws) => {
  connectedClients.add(ws)
  ws.on('close', () => connectedClients.delete(ws))

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString()) as { content: string; session_id?: string }
      const response = await handleOwnerCommand(msg.content, msg.session_id ?? 'ws')
      ws.send(JSON.stringify({ type: 'hampton_response', ...response }))
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: 'Failed to process command' }))
    }
  })
})

function broadcast(payload: Record<string, unknown>): void {
  const data = JSON.stringify(payload)
  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) client.send(data)
  }
}

// ─── Core pipeline ──────────────────────────────────────────────

const HAMPTON_PERSONA = `You are HAMPTON, the AI orchestrator for Host Hampton — a boutique celebration studio at 295 Montauk Highway, Speonk, NY, run by Allie Larkin.

You are the owner's trusted business partner. You plan, delegate, monitor, and report. You never execute tasks yourself.

PERSONALITY: Confident and decisive. Brand guardian. Strategic by default. Proactive. Concise in updates.

RESPONSE FORMAT:
- For task execution: "✅ Got it — [task]. Routing to: [agents]. [any key choices]."
- For strategy questions: Direct answer in 2-4 sentences + 1-2 specific recommendations.
- For reports: Lead with the most actionable number or insight.
- For ALWAYS_ASK items: Clearly explain what requires confirmation and why.

BRAND: warm, fun, community-first, never corporate or pushy.
PHASE: 1A — SOC, COPY, IMAGE, OUTBOUND, LIST are active. Website stays on Squarespace. No PAID or INTEL yet.`

async function handleOwnerCommand(
  ownerMessage: string,
  sessionId: string
): Promise<{ message: string; tasks: TaskManifest[]; requires_input: boolean }> {

  console.log(`\n[HAMPTON] Command received: "${ownerMessage}"`)

  // 1. Classify intent
  const classification = await classifier.classify(ownerMessage)
  console.log(`[HAMPTON] Intent: ${classification.intent} (${classification.confidence})`)

  // 2. If clarification needed, ask before proceeding
  if (classification.clarification_needed && classification.confidence === 'low') {
    return {
      message: classification.clarification_needed,
      tasks: [],
      requires_input: true
    }
  }

  // 3. Load memory context for this intent
  const memoryContext = await memory.loadForIntent(classification.intent)
  const memoryString = memory.formatContextForPrompt(memoryContext)

  // 4. Get current phase status
  const phaseStatus = await memory.getPhaseStatus() as PhaseStatus

  // 5. For strategy questions — answer directly with Claude
  if (classification.intent === 'STRATEGY_QUESTION' || classification.intent === 'UNKNOWN') {
    const answer = await answerDirectly(ownerMessage, memoryString)
    return { message: answer, tasks: [], requires_input: false }
  }

  // 6. Build task plan
  const manifests = await router.buildTaskPlan(
    ownerMessage,
    classification,
    memoryString,
    phaseStatus
  )

  // 7. Create tasks in DB + process through approval gate
  const gateResults: string[] = []
  const createdManifests: TaskManifest[] = []

  for (const manifest of manifests) {
    // Create in DB first
    const taskId = await taskQueue.create(manifest)
    const fullManifest = { ...manifest, task_id: taskId }
    createdManifests.push(fullManifest)

    const result = await gate.process(fullManifest)
    gateResults.push(result.message)
  }

  // 8. Generate owner-facing response
  const ownerResponse = await generateOwnerResponse(
    ownerMessage,
    classification.intent,
    createdManifests,
    gateResults,
    memoryString
  )

  return {
    message: ownerResponse,
    tasks: createdManifests,
    requires_input: false
  }
}

async function answerDirectly(question: string, memoryContext: string): Promise<string> {
  const response = await claude.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 512,
    system: HAMPTON_PERSONA,
    messages: [
      {
        role: 'user',
        content: `${memoryContext}\n\n---\n\nOwner question: ${question}`
      }
    ]
  })
  return response.content[0].type === 'text' ? response.content[0].text : 'Unable to generate response.'
}

async function generateOwnerResponse(
  originalCommand: string,
  intent: string,
  manifests: TaskManifest[],
  gateResults: string[],
  memoryContext: string
): Promise<string> {
  const taskSummary = manifests
    .map(m => `- ${m.assigned_to}: ${JSON.stringify(m.input.task_type ?? m.input.instructions ?? '').slice(0, 80)} [${m.approval_tier}]`)
    .join('\n')

  const response = await claude.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 420,
    system: HAMPTON_PERSONA,
    messages: [
      {
        role: 'user',
        content: `Original command: "${originalCommand}"
Intent classified as: ${intent}

Tasks created:
${taskSummary || '(none — answered directly)'}

Gate results:
${gateResults.join('\n') || '(no tasks)'}

${memoryContext}

Format your reply as follows, with emoji + line breaks:
- Start with a single sentence summary prefixed by "✅".
- Add a "📝 Tasks" section with bullets describing the outstanding tasks and their approval status.
- Add a "🚧 Next Actions" section with numbered steps for the owner.
- Wrap any quoted JSON in triple backticks so it stays readable.

Use short paragraphs so the dashboard chat shows line breaks clearly.`
      }
    ]
  })

  return response.content[0].type === 'text' ? response.content[0].text : 'Tasks dispatched.'
}

// ─── Escalation helper ──────────────────────────────────────────
async function escalate(record: EscalationRecord): Promise<void> {
  await supabase.from('escalations').insert({
    ...record,
    status: 'open',
    sms_alert_sent: false
  })

  if (['urgent', 'high'].includes(record.priority) && process.env.OWNER_PHONE) {
    // Twilio SMS alert — dispatched via OUTBOUND agent task
    await taskQueue.create({
      assigned_to: 'OUTBOUND',
      priority: 'urgent',
      input: {
        task_type: 'owner_sms_alert',
        phone: process.env.OWNER_PHONE,
        message: `⚠️ HAMPTON ALERT: ${record.reason}. Check dashboard.`
      },
      approval_tier: 'AUTO_EXECUTE'
    })
  }

  broadcast({ type: 'escalation', priority: record.priority, reason: record.reason })
}

// ─── HTTP Routes ─────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', agent: 'HAMPTON', timestamp: new Date().toISOString() })
})

app.post('/chat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message, session_id } = req.body as { message: string; session_id?: string }
    if (!message) return res.status(400).json({ error: 'message is required' })

    const result = await handleOwnerCommand(message, session_id ?? 'http')
    res.json(result)
  } catch (err) {
    next(err)
  }
})

app.get('/tasks/history', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const tasks = await taskQueue.getCompleted()
    res.json({ tasks })
  } catch (err) {
    next(err)
  }
})

app.get('/content-library', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await taskQueue.getContentLibrary()
    res.json({ items })
  } catch (err) {
    next(err)
  }
})

app.get('/report', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { data } = await supabase
      .from('agent_memory')
      .select('value, updated_at')
      .eq('namespace', 'analytics')
      .eq('key', 'last_report')
      .single()
    res.json({ report: data?.value ?? null, updated_at: (data as { updated_at?: string } | null)?.updated_at ?? null })
  } catch (err) {
    next(err)
  }
})

app.get('/tasks', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const tasks = await taskQueue.getActive()
    res.json({ tasks })
  } catch (err) {
    next(err)
  }
})

app.post('/tasks/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await gate.approve(req.params.id!)
    res.json({ approved: true, task_id: req.params.id })
  } catch (err) {
    next(err)
  }
})

app.post('/tasks/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reason } = req.body as { reason?: string }
    await gate.reject(req.params.id!, reason)
    res.json({ rejected: true, task_id: req.params.id })
  } catch (err) {
    next(err)
  }
})

app.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const phase = await memory.getPhaseStatus()
    const activeTasks = await taskQueue.getActive()
    res.json({
      agent: 'HAMPTON',
      phase: phase.current_phase,
      active_agents: phase.active_agents,
      active_tasks: activeTasks.length,
      timestamp: new Date().toISOString()
    })
  } catch (err) {
    next(err)
  }
})

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[HAMPTON] Unhandled error:', err.message)
  res.status(500).json({ error: 'Internal server error' })
})

// ─── Cron Jobs ──────────────────────────────────────────────────

// Monday 07:00 AM — Booking Gap Detector
cron.schedule('0 7 * * 1', async () => {
  console.log('[CRON] Running booking gap detector...')
  try {
    const result = await gapDetector.run()
    if (result.gaps_found > 0) {
      broadcast({ type: 'gap_detection', ...result })
    }
  } catch (err) {
    console.error('[CRON] Gap detector failed:', err)
  }
}, { timezone: 'America/New_York' })

// Daily 06:00 AM — Analytics overnight pull flag
cron.schedule('0 6 * * *', async () => {
  console.log('[CRON] Daily analytics check...')
  try {
    const phase = await memory.getPhaseStatus()
    if (phase.active_agents.includes('INTEL')) {
      const cronInput = { task_type: 'overnight_analytics_pull', instructions: 'Pull overnight analytics across all active channels. Flag anomalies. Queue for morning briefing.' }
      const task_id = await taskQueue.create({ assigned_to: 'INTEL', priority: 'async', input: cronInput, approval_tier: 'AUTO_EXECUTE' })
      await gate.process({ task_id, assigned_to: 'INTEL', priority: 'async', input: cronInput, approval_tier: 'AUTO_EXECUTE' })
    }
  } catch (err) {
    console.error('[CRON] Analytics cron failed:', err)
  }
}, { timezone: 'America/New_York' })

// Daily 07:00 AM — Social comment scan
cron.schedule('0 7 * * *', async () => {
  console.log('[CRON] Social comment scan...')
  try {
    const cronInput = { task_type: 'comment_scan', instructions: 'Scan for new comments and reviews needing response. Auto-draft replies for obvious FAQ comments via COPY. Flag sensitive ones.' }
    const task_id = await taskQueue.create({ assigned_to: 'SOC', priority: 'high', input: cronInput, approval_tier: 'AUTO_EXECUTE' })
    await gate.process({ task_id, assigned_to: 'SOC', priority: 'high', input: cronInput, approval_tier: 'AUTO_EXECUTE' })
  } catch (err) {
    console.error('[CRON] Comment scan cron failed:', err)
  }
}, { timezone: 'America/New_York' })

// Monday 09:00 AM — Week ahead report
cron.schedule('0 9 * * 1', async () => {
  console.log('[CRON] Week ahead report...')
  try {
    const phase = await memory.getPhaseStatus()
    if (phase.active_agents.includes('INTEL')) {
      const cronInput = { task_type: 'weekly_report', report_type: 'week_ahead', instructions: 'Generate the week-ahead briefing: upcoming bookings, content to publish, revenue opportunities. Deliver as a concise summary.' }
      const task_id = await taskQueue.create({ assigned_to: 'INTEL', priority: 'high', input: cronInput, approval_tier: 'AUTO_EXECUTE' })
      await gate.process({ task_id, assigned_to: 'INTEL', priority: 'high', input: cronInput, approval_tier: 'AUTO_EXECUTE' })
    }
  } catch (err) {
    console.error('[CRON] Week ahead report failed:', err)
  }
}, { timezone: 'America/New_York' })

// Friday 16:00 PM — Week in review
cron.schedule('0 16 * * 5', async () => {
  console.log('[CRON] Week in review report...')
  try {
    const phase = await memory.getPhaseStatus()
    if (phase.active_agents.includes('INTEL')) {
      const cronInput = { task_type: 'weekly_report', report_type: 'week_in_review', instructions: 'Generate the week-in-review: tasks completed, content published, what worked, what to improve next week.' }
      const task_id = await taskQueue.create({ assigned_to: 'INTEL', priority: 'high', input: cronInput, approval_tier: 'AUTO_EXECUTE' })
      await gate.process({ task_id, assigned_to: 'INTEL', priority: 'high', input: cronInput, approval_tier: 'AUTO_EXECUTE' })
    }
  } catch (err) {
    console.error('[CRON] Week in review report failed:', err)
  }
}, { timezone: 'America/New_York' })

// ─── Start server ────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3000

httpServer.listen(PORT, () => {
  console.log(`\n🧠 HAMPTON Orchestrator running on port ${PORT}`)
  console.log(`   HTTP: http://localhost:${PORT}`)
  console.log(`   WS:   ws://localhost:${PORT}`)
  console.log(`   Health: http://localhost:${PORT}/health\n`)
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[HAMPTON] SIGTERM received — shutting down gracefully...')
  await taskQueue.disconnect()
  await taskCompleteSubscriber.quit()
  process.exit(0)
})
