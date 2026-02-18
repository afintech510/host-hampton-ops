/**
 * taskQueue.ts
 * Creates tasks in Supabase and publishes dispatch events via Redis pub/sub.
 * Agents subscribe to their own Redis channel and receive task manifests.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'
import { TaskManifest, TaskStatus, AgentName, TaskRecord } from './types.js'

// Redis channel naming: one channel per agent
const agentChannel = (agent: AgentName) => `hampton:agent:${agent.toLowerCase()}`

export class TaskQueue {
  private publisher: Redis

  constructor(
    private supabase: SupabaseClient,
    redisUrl: string
  ) {
    this.publisher = new Redis(redisUrl)
    this.publisher.on('error', (err) => console.error('[TaskQueue] Redis error:', err))
  }

  /**
   * Create a task manifest, persist to Supabase, publish to Redis.
   * Returns the task_id.
   */
  async create(manifest: Omit<TaskManifest, 'task_id'>): Promise<string> {
    const task_id = uuidv4()
    const full: TaskManifest = { ...manifest, task_id }

    // Persist to Supabase tasks table
    const { error } = await this.supabase.from('agent_tasks').insert({
      task_id,
      assigned_to: full.assigned_to,
      status: 'pending' as TaskStatus,
      priority: full.priority,
      depends_on: full.depends_on ?? null,
      input: full.input,
      output: null,
      approval_tier: full.approval_tier,
      deadline: full.deadline?.toISOString() ?? null
    })

    if (error) {
      console.error(`[TaskQueue] Failed to create task for ${full.assigned_to}:`, error.message)
      throw error
    }

    console.log(`[TaskQueue] Created task ${task_id} → ${full.assigned_to} (${full.priority}, ${full.approval_tier})`)
    return task_id
  }

  /**
   * Dispatch a task to its agent via Redis pub/sub.
   * Only called after approval gate clears.
   */
  async dispatch(manifest: TaskManifest): Promise<void> {
    await this.supabase
      .from('agent_tasks')
      .update({ status: 'in_progress' as TaskStatus })
      .eq('task_id', manifest.task_id)

    await this.publisher.publish(
      agentChannel(manifest.assigned_to),
      JSON.stringify(manifest)
    )

    console.log(`[TaskQueue] Dispatched ${manifest.task_id} → ${manifest.assigned_to}`)
  }

  /**
   * Update task status and optionally store agent output
   */
  async updateStatus(
    taskId: string,
    status: TaskStatus,
    output?: Record<string, unknown>
  ): Promise<void> {
    const update: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString()
    }
    if (output) update.output = output

    await this.supabase
      .from('agent_tasks')
      .update(update)
      .eq('task_id', taskId)
  }

  /**
   * Get all pending tasks, optionally filtered by agent
   */
  async getPending(agent?: AgentName): Promise<TaskRecord[]> {
    let query = this.supabase
      .from('agent_tasks')
      .select('*')
      .in('status', ['pending', 'awaiting_approval'])
      .order('created_at', { ascending: true })

    if (agent) query = query.eq('assigned_to', agent)

    const { data, error } = await query
    if (error) return []
    return (data ?? []) as TaskRecord[]
  }

  /**
   * Get output of a completed task
   */
  async getOutput(taskId: string): Promise<Record<string, unknown> | null> {
    const { data } = await this.supabase
      .from('agent_tasks')
      .select('output, status')
      .eq('task_id', taskId)
      .single()

    if (!data || data.status !== 'completed') return null
    return data.output as Record<string, unknown>
  }

  /**
   * Get all active tasks (in_progress + awaiting_approval) — for owner status view
   */
  async getActive(): Promise<TaskRecord[]> {
    const { data } = await this.supabase
      .from('agent_tasks')
      .select('*')
      .in('status', ['pending', 'in_progress', 'awaiting_approval'])
      .order('created_at', { ascending: false })
      .limit(50)

    return (data ?? []) as TaskRecord[]
  }

  /**
   * Cancel a task
   */
  async cancel(taskId: string): Promise<void> {
    await this.supabase
      .from('agent_tasks')
      .update({ status: 'cancelled' as TaskStatus })
      .eq('task_id', taskId)

    console.log(`[TaskQueue] Cancelled task ${taskId}`)
  }

  async disconnect(): Promise<void> {
    await this.publisher.quit()
  }
}
