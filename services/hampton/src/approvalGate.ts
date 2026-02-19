/**
 * approvalGate.ts
 * Enforces the 3-tier approval matrix before task execution.
 *
 * AUTO_EXECUTE   → dispatch immediately, report completion
 * DRAFT_AND_SHOW → surface to owner, auto-execute after 4-hour timeout if no response
 * ALWAYS_ASK     → hold indefinitely, never auto-execute
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { TaskManifest, ApprovalTier, TaskStatus } from './types.js'

const DRAFT_AND_SHOW_TIMEOUT_MS = 4 * 60 * 60 * 1000  // 4 hours

export class ApprovalGate {
  private pendingApprovals = new Map<string, NodeJS.Timeout>()

  constructor(
    private supabase: SupabaseClient,
    private onAutoExecute: (manifest: TaskManifest) => Promise<void>
  ) {}

  /**
   * Process a task manifest through the approval gate.
   * Returns the action taken.
   */
  async process(manifest: TaskManifest): Promise<{
    action: 'dispatched' | 'pending_approval' | 'held_for_owner'
    message: string
  }> {
    switch (manifest.approval_tier) {
      case 'AUTO_EXECUTE':
        await this.onAutoExecute(manifest)
        return {
          action: 'dispatched',
          message: `Task ${manifest.task_id} dispatched to ${manifest.assigned_to}`
        }

      case 'DRAFT_AND_SHOW':
        await this.holdForApproval(manifest, 'pending')
        this.scheduleAutoExecute(manifest)
        return {
          action: 'pending_approval',
          message: `Task ${manifest.task_id} sent to ${manifest.assigned_to} — awaiting your approval. Auto-executes in 4 hours if no response.`
        }

      case 'ALWAYS_ASK':
        await this.holdForApproval(manifest, 'pending')
        return {
          action: 'held_for_owner',
          message: `⚠️ Task ${manifest.task_id} requires your explicit approval before proceeding. Reply "approve ${manifest.task_id}" or "reject ${manifest.task_id}".`
        }
    }
  }

  /**
   * Owner explicitly approves a pending task
   */
  async approve(taskId: string): Promise<void> {
    this.cancelAutoExecuteTimer(taskId)

    const { data } = await this.supabase
      .from('agent_tasks')
      .select('*')
      .eq('task_id', taskId)
      .single()

    if (!data) throw new Error(`Task ${taskId} not found`)

    await this.supabase
      .from('agent_tasks')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('task_id', taskId)

    const manifest = data as unknown as TaskManifest
    await this.onAutoExecute(manifest)
  }

  /**
   * Owner explicitly rejects a pending task
   */
  async reject(taskId: string, reason?: string): Promise<void> {
    this.cancelAutoExecuteTimer(taskId)

    await this.supabase
      .from('agent_tasks')
      .update({
        status: 'rejected' as TaskStatus,
        rejected_at: new Date().toISOString(),
        rejection_reason: reason ?? 'Rejected by owner'
      })
      .eq('task_id', taskId)
  }

  /**
   * Check if a task is currently pending approval
   */
  isPending(taskId: string): boolean {
    return this.pendingApprovals.has(taskId)
  }

  private async holdForApproval(manifest: TaskManifest, status: TaskStatus): Promise<void> {
    await this.supabase
      .from('agent_tasks')
      .update({ status })
      .eq('task_id', manifest.task_id)
  }

  private scheduleAutoExecute(manifest: TaskManifest): void {
    const timer = setTimeout(async () => {
      this.pendingApprovals.delete(manifest.task_id)
      console.log(`[ApprovalGate] 4-hour timeout reached — auto-executing ${manifest.task_id}`)

      await this.supabase
        .from('agent_tasks')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('task_id', manifest.task_id)

      await this.onAutoExecute(manifest)
    }, DRAFT_AND_SHOW_TIMEOUT_MS)

    this.pendingApprovals.set(manifest.task_id, timer)
  }

  private cancelAutoExecuteTimer(taskId: string): void {
    const timer = this.pendingApprovals.get(taskId)
    if (timer) {
      clearTimeout(timer)
      this.pendingApprovals.delete(taskId)
    }
  }
}
