import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { distillFeedback } from '@/lib/agent/distill'
import { agentEnabled } from '@/lib/agent/config'

export const dynamic = 'force-dynamic'

/**
 * The weekly learning distill (Phase 6, plan §5: cron-job.org, Monday 7am).
 *
 * Reads a week of `draft_feedback`, asks Claude what Allie and Adam keep
 * correcting, and PROPOSES `agent_learnings` rows and a voice profile v2. It
 * activates nothing — see lib/agent/distill.ts. A run on a quiet week makes no
 * model call and costs nothing.
 *
 * Auth: x-cron-secret / ?secret= (matches the other cron routes), and the same
 * `!!CRON_SECRET` check agent-dispatch uses — without it an unset secret makes
 * the route world-callable to anyone who sends no header at all.
 *
 * Behind AGENT_ENABLED, like every other agent surface: the kill switch has to
 * stop the whole agent, not the parts somebody remembered.
 *
 * `?days=` overrides the window for a manual catch-up run.
 */

function isCronAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  return !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET
}

/** A window wider than this is somebody's typo, not a catch-up. */
const MAX_DAYS = 120

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!agentEnabled()) {
    return NextResponse.json({ ok: true, skipped: 'AGENT_ENABLED is off', proposed: 0 })
  }

  const rawDays = Number(req.nextUrl.searchParams.get('days'))
  const sinceDays = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(rawDays, MAX_DAYS) : 7

  const result = await distillFeedback({ supabase: getSupabase(), sinceDays })

  // The status is the distiller's: a failed read of the view is a 503 so the
  // cron service shows a red run, rather than a green one reporting 0 proposals
  // every Monday while the loop is dead.
  return NextResponse.json(result, { status: result.status })
}
