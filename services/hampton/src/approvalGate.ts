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
  async approve(rowId: string): Promise<void> {
    // rowId is the DB primary key (id column) passed from the frontend
    const { data, error: fetchError } = await this.supabase
      .from('agent_tasks')
      .select('*')
      .eq('id', rowId)
      .single()

    if (fetchError || !data) throw new Error(`Task ${rowId} not found: ${fetchError?.message ?? 'no data'}`)

    // Cancel any pending auto-execute timer using the task_id
    this.cancelAutoExecuteTimer(data.task_id)

    // Set approved_at; status goes to in_progress immediately via dispatch below
    const { error: updateError } = await this.supabase
      .from('agent_tasks')
      .update({ status: 'approved' as TaskStatus, approved_at: new Date().toISOString() })
      .eq('id', rowId)

    if (updateError) {
      console.error(`[ApprovalGate] approve DB update failed for ${rowId}:`, updateError.message)
      // Still dispatch even if status update failed — agent work should proceed
    }

    const manifest = data as unknown as TaskManifest
    await this.onAutoExecute(manifest)
  }

  /**
   * Owner explicitly rejects a pending task
   */
  async reject(rowId: string, reason?: string): Promise<void> {
    // rowId is the DB primary key (id column) passed from the frontend
    const { data, error: fetchError } = await this.supabase
      .from('agent_tasks')
      .select('task_id')
      .eq('id', rowId)
      .single()

    if (fetchError) throw new Error(`Task ${rowId} not found: ${fetchError.message}`)

    if (data?.task_id) this.cancelAutoExecuteTimer(data.task_id)

    const { error: updateError } = await this.supabase
      .from('agent_tasks')
      .update({
        status: 'rejected' as TaskStatus,
        rejected_at: new Date().toISOString(),
        rejection_reason: reason ?? 'Rejected by owner'
      })
      .eq('id', rowId)

    if (updateError) {
      throw new Error(`Failed to reject task ${rowId}: ${updateError.message}`)
    }
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

      const { error } = await this.supabase
        .from('agent_tasks')
        .update({ status: 'approved' as TaskStatus, approved_at: new Date().toISOString() })
        .eq('task_id', manifest.task_id)

      if (error) console.error(`[ApprovalGate] auto-execute status update failed:`, error.message)

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
