/**
 * bookingGapDetector.ts
 * Runs every Monday 7:00 AM as a scheduled cron task.
 * Detects gaps in the booking calendar and dispatches appropriate responses.
 *
 * Gap thresholds (from gap_fill_rules.thresholds memory):
 *   ≥ 3 days  → SOC awareness post (low urgency)
 *   ≥ 7 days  → OUTBOUND flash offer sequence (normal urgency)
 *   ≥ 14 days → Escalate to owner + PAID gap-fill campaign (high urgency)
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { BookingGap, GapAlert, TaskManifest, AgentName } from './types.js'
import { TaskQueue } from './taskQueue.js'

interface Booking {
  booking_date: string
  status: string
}

export class BookingGapDetector {
  constructor(
    private supabase: SupabaseClient,
    private taskQueue: TaskQueue
  ) {}

  /**
   * Main cron entry point — run every Monday at 7:00 AM
   */
  async run(): Promise<{ gaps_found: number; actions_taken: string[] }> {
    console.log('[BookingGapDetector] Running Monday gap check...')

    const today = new Date()
    const windowEnd = new Date(today)
    windowEnd.setDate(today.getDate() + 28)

    const bookings = await this.getBookings(today, windowEnd)
    const gaps = this.findGaps(today, windowEnd, bookings)
    const alerts = this.buildAlerts(gaps)

    if (alerts.length === 0) {
      console.log('[BookingGapDetector] No significant gaps found.')
      return { gaps_found: 0, actions_taken: [] }
    }

    const actions: string[] = []

    for (const alert of alerts) {
      await this.persistGapEvent(alert)
      const dispatched = await this.dispatchResponse(alert)
      actions.push(...dispatched)
    }

    console.log(`[BookingGapDetector] Found ${alerts.length} gaps, dispatched ${actions.length} tasks.`)
    return { gaps_found: alerts.length, actions_taken: actions }
  }

  /**
   * Fetch confirmed bookings in the window
   */
  private async getBookings(from: Date, to: Date): Promise<Booking[]> {
    const { data, error } = await this.supabase
      .from('bookings')
      .select('booking_date, status')
      .gte('booking_date', from.toISOString().split('T')[0])
      .lte('booking_date', to.toISOString().split('T')[0])
      .in('status', ['confirmed', 'deposit_paid', 'completed'])
      .order('booking_date', { ascending: true })

    if (error) {
      console.error('[BookingGapDetector] Failed to fetch bookings:', error.message)
      return []
    }

    return data ?? []
  }

  /**
   * Find consecutive day gaps in the booking calendar
   */
  private findGaps(from: Date, to: Date, bookings: Booking[]): BookingGap[] {
    const bookedDates = new Set(bookings.map(b => b.booking_date))
    const gaps: BookingGap[] = []

    let gapStart: Date | null = null

    const current = new Date(from)
    while (current <= to) {
      const dateStr = current.toISOString().split('T')[0]!
      const isBooked = bookedDates.has(dateStr)

      if (!isBooked && gapStart === null) {
        gapStart = new Date(current)
      } else if (isBooked && gapStart !== null) {
        const gapEnd = new Date(current)
        gapEnd.setDate(gapEnd.getDate() - 1)
        const gapDays = Math.floor((gapEnd.getTime() - gapStart.getTime()) / (1000 * 60 * 60 * 24)) + 1

        if (gapDays >= 3) {
          gaps.push({
            gap_start_date: gapStart.toISOString().split('T')[0]!,
            gap_end_date: gapEnd.toISOString().split('T')[0]!,
            gap_days: gapDays
          })
        }
        gapStart = null
      }

      current.setDate(current.getDate() + 1)
    }

    // Handle gap extending to end of window
    if (gapStart !== null) {
      const gapEnd = new Date(to)
      const gapDays = Math.floor((gapEnd.getTime() - gapStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
      if (gapDays >= 3) {
        gaps.push({
          gap_start_date: gapStart.toISOString().split('T')[0]!,
          gap_end_date: gapEnd.toISOString().split('T')[0]!,
          gap_days: gapDays
        })
      }
    }

    return gaps
  }

  /**
   * Convert gaps into action alerts based on thresholds
   */
  private buildAlerts(gaps: BookingGap[]): GapAlert[] {
    return gaps.map(gap => {
      if (gap.gap_days >= 14) {
        return {
          ...gap,
          action: 'paid_campaign_plus_escalate' as const,
          urgency: 'high' as const,
          agents: ['PAID', 'OUTBOUND'] as AgentName[],
          escalate: true
        }
      } else if (gap.gap_days >= 7) {
        return {
          ...gap,
          action: 'outbound_flash_offer' as const,
          urgency: 'normal' as const,
          agents: ['OUTBOUND'] as AgentName[],
          escalate: false
        }
      } else {
        return {
          ...gap,
          action: 'soc_awareness' as const,
          urgency: 'low' as const,
          agents: ['SOC'] as AgentName[],
          escalate: false
        }
      }
    })
  }

  /**
   * Persist gap event to Supabase for tracking
   */
  private async persistGapEvent(alert: GapAlert): Promise<void> {
    const { error } = await this.supabase.from('booking_gap_events').insert({
      gap_start_date: alert.gap_start_date,
      gap_end_date: alert.gap_end_date,
      detected_at: new Date().toISOString(),
      campaign_triggered: alert.agents.length > 0,
      resolution_status: 'open',
      notes: `Auto-detected: ${alert.gap_days} day gap, action=${alert.action}`
    })

    if (error) {
      console.error('[BookingGapDetector] Failed to persist gap event:', error.message)
    }
  }

  /**
   * Create and dispatch task manifests for each alert
   */
  private async dispatchResponse(alert: GapAlert): Promise<string[]> {
    const actions: string[] = []
    const gapContext = {
      gap_start_date: alert.gap_start_date,
      gap_end_date: alert.gap_end_date,
      gap_days: alert.gap_days,
      urgency: alert.urgency
    }

    if (alert.action === 'soc_awareness') {
      const task: Omit<TaskManifest, 'task_id'> = {
        assigned_to: 'SOC',
        priority: 'normal',
        input: {
          task_type: 'availability_awareness_post',
          gap: gapContext,
          instructions: `We have ${alert.gap_days} open days from ${alert.gap_start_date}. Post a soft availability reminder across IG + FB — keep it warm and community-first. Focus on our top 2 party themes.`
        },
        approval_tier: 'AUTO_EXECUTE'
      }
      await this.taskQueue.create(task)
      actions.push(`SOC: availability awareness post (${alert.gap_days} day gap)`)

    } else if (alert.action === 'outbound_flash_offer') {
      const task: Omit<TaskManifest, 'task_id'> = {
        assigned_to: 'OUTBOUND',
        priority: 'high',
        input: {
          task_type: 'flash_offer_sequence',
          gap: gapContext,
          instructions: `We have a ${alert.gap_days} day gap starting ${alert.gap_start_date}. Create a flash offer email + SMS to past customers and warm leads. Offer a small incentive (e.g. add-on upgrade) to book in this window.`
        },
        approval_tier: 'DRAFT_AND_SHOW'
      }
      await this.taskQueue.create(task)
      actions.push(`OUTBOUND: flash offer sequence (${alert.gap_days} day gap)`)

    } else if (alert.action === 'paid_campaign_plus_escalate') {
      // Escalate to owner
      await this.supabase.from('escalations').insert({
        triggered_by: 'HAMPTON',
        reason: `Extended booking gap detected: ${alert.gap_days} days (${alert.gap_start_date} to ${alert.gap_end_date})`,
        context: { gap: gapContext },
        priority: 'high',
        status: 'open',
        sms_alert_sent: false
      })
      actions.push(`ESCALATION: ${alert.gap_days} day gap flagged to owner`)

      // OUTBOUND flash offer
      const outboundTask: Omit<TaskManifest, 'task_id'> = {
        assigned_to: 'OUTBOUND',
        priority: 'high',
        input: {
          task_type: 'flash_offer_sequence',
          gap: gapContext,
          instructions: `URGENT: ${alert.gap_days} day gap starting ${alert.gap_start_date}. Build aggressive flash offer for all warm leads and past customers.`
        },
        approval_tier: 'DRAFT_AND_SHOW'
      }
      await this.taskQueue.create(outboundTask)
      actions.push(`OUTBOUND: urgent flash offer (${alert.gap_days} day gap)`)

      // PAID campaign — only if Phase 1B active (checked at runtime via operations.phase_status)
      const paidTask: Omit<TaskManifest, 'task_id'> = {
        assigned_to: 'PAID',
        priority: 'high',
        input: {
          task_type: 'gap_fill_campaign',
          gap: gapContext,
          instructions: `Launch a targeted Meta + Google campaign to fill ${alert.gap_days} day gap. Focus on birthday party audience within 25 miles. Budget $15/day for the campaign window.`
        },
        approval_tier: 'ALWAYS_ASK'   // paid spend always requires owner approval
      }
      await this.taskQueue.create(paidTask)
      actions.push(`PAID: gap-fill campaign created (awaiting owner approval)`)
    }

    return actions
  }
}
